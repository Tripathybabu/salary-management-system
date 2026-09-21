# Architecture & Design Decisions

Companion to `REQUIREMENTS.md`. This records *why* the system is shaped the way it is.

## 1. Stack

| Layer | Choice | Reasoning |
|---|---|---|
| Backend | Node 24 + Express 5 + TypeScript | Explicit, inspectable HTTP layer. The brief asks to see engineering decisions; a thin framework keeps those decisions visible rather than hidden behind conventions. |
| ORM | Prisma 6 | Typed queries, real migrations, and a clean escape hatch (`$queryRaw`) for the analytical SQL that ORMs model badly. |
| Database | PostgreSQL 17 | Relational, as the brief requires. Chosen over SQLite specifically for `PERCENTILE_CONT` — the percentile maths is the heart of the analytics and Postgres does it in the database. |
| Frontend | Next.js 15 (App Router) + TypeScript | Server Components fetch dashboard data without a client-side waterfall. |
| UI | Tailwind CSS + shadcn/ui | Accessible primitives (Radix) without inheriting a heavy component framework's opinions. |
| Charts | Recharts | Composable, React-native, sufficient for the five chart types needed. |
| Tests | Vitest + Supertest + Testing Library | One runner across both apps. Fast, ESM-native, good TypeScript support. |

### Monorepo layout

```
/apps/api      Express backend, Prisma schema, seed script
/apps/web      Next.js frontend
/packages/shared   Types, Zod schemas, currency & stats utilities shared by both
/docs          Requirements, architecture, AI usage notes
```

npm workspaces — not Turborepo/Nx. Two apps and one shared package does not justify a build
orchestrator. `packages/shared` exists so the API's validation schemas and the frontend's
form validation are *the same code*, which is the main reason to have a monorepo at all.

## 2. The central decision: effective-dated salary records

A naive schema puts `salary` on the employee row. That is what the spreadsheet does, and it
is why the spreadsheet cannot answer the interesting questions. Overwriting a salary
destroys the history needed for every trend, audit, and "when did this gap appear?" query.

Instead:

```
Employee 1 ──< SalaryRecord
                 effectiveFrom  DATE
                 effectiveTo    DATE NULL   -- NULL = currently in effect
                 baseAmount     DECIMAL
                 currency       CHAR(3)
                 baseAmountUsd  DECIMAL     -- normalised at write time
                 changeReason   ENUM
```

**Consequences, good and bad:**

- ✅ Full audit trail; no salary change is ever lost.
- ✅ Point-in-time queries: "what was payroll in Q1?" is answerable.
- ✅ Corrections are modelled honestly — a `CORRECTION` record, not a silent overwrite.
- ⚠️ "Current salary" becomes a join rather than a column read. Mitigated with a partial
  index on `effectiveTo IS NULL`, which makes the current-record lookup effectively a
  direct index hit.
- ⚠️ Writing a new record must close the previous one. This is a two-statement invariant,
  so it runs inside a transaction (see §4).

I consider this trade the single highest-value decision in the system: it is what turns a
CRUD app into something that can answer questions.

## 3. Money

Two rules, both non-negotiable:

1. **Never floating point.** Postgres `DECIMAL(14,2)`; in application code, amounts are
   handled as integer minor units. `0.1 + 0.2 !== 0.3` is not acceptable in payroll.
2. **Store both local and normalised.** An employee in Bangalore is paid in INR; comparing
   them to a Berlin colleague requires a common unit. `baseAmountUsd` is computed **at write
   time** from a versioned rate table and stored.

Computing USD at *read* time would mean historical reports silently change as rates move.
A report that gives a different answer on Tuesday is broken. Fixed rates make analytics
reproducible and tests deterministic; the rate table is versioned and swappable for a live
feed later.

## 4. Invariants enforced in transactions

Salary changes have an invariant the type system cannot express: *exactly one open record
per employee*. Writing a raise means closing the current record and opening a new one —
two statements that must both succeed.

Every salary mutation therefore runs inside `prisma.$transaction`, and the service layer
re-reads the current record **inside** the transaction before closing it. A unique partial
index on `(employeeId) WHERE effectiveTo IS NULL` backstops this at the database level, so
a race that slips past the application still cannot corrupt the data.

## 5. Statistics: median over mean

Salary distributions are right-skewed — a handful of senior people pull the mean well above
what a typical employee earns. Reporting the mean as "what we pay" is actively misleading,
and for a gender pay gap figure it can invert the conclusion.

So the analytics report **p25 / p50 / p75 / p90** via Postgres `PERCENTILE_CONT`, computed
in SQL. The mean is shown alongside, never alone.

Two guardrails on the pay-gap numbers:

- Every figure carries its **sample size**. A 40% "gap" across three people is noise, and the
  UI must let the user see that.
- Groups below a minimum headcount are **suppressed** rather than shown — both because the
  number is untrustworthy and because tiny groups make individual salaries inferable.

## 6. Performance at 10k

| Concern | Approach |
|---|---|
| Listing | Server-side pagination; the full set never reaches the browser. |
| Filtering/sorting | Composite indexes on `(countryCode, departmentId, level)` and the status/level filters. |
| Current salary lookup | Partial index on `effectiveTo IS NULL`. |
| Analytics | Aggregated in SQL via `$queryRaw`. Pulling 10k rows into Node to compute a median would be the obvious wrong answer. |
| Seeding | Batched `createMany` in chunks, not 10k round-trips. |

Measured against the real seeded dataset and recorded in `docs/PERFORMANCE.md` — asserting
performance without measuring it is not an engineering claim.

## 7. Layering

```
Route  →  Validation (Zod)  →  Service  →  Prisma  →  Postgres
```

- **Routes** handle HTTP only: parse, delegate, serialise. No business logic.
- **Services** own business rules and transactions. Pure enough to test without HTTP.
- **Validation** at the boundary via shared Zod schemas, so invalid data never reaches a service.
- **Errors**: services throw typed domain errors; one Express error middleware maps them to
  status codes. No status codes scattered through business logic.

**Where auth would go:** a single `requireAuth` middleware in `apps/api/src/app.ts`, plus an
`actorId` already threaded through the service layer for audit fields. The seam exists; the
implementation is deliberately out of scope (see `REQUIREMENTS.md` §4).

## 8. Testing strategy

- **Unit** — currency conversion, percentile maths, pay-gap calculation, date-range logic.
  Pure functions, no I/O, exhaustive on edge cases.
- **Integration** — API endpoints against a real Postgres test database, covering the
  transactional invariants that unit tests cannot reach (concurrent raises, history
  correctness).
- **Component** — key React pieces with Testing Library.

Determinism: seeded RNG, injected fixed clock, no network. Tests that fail intermittently
train people to ignore failures, so a flaky test is treated as a broken test.
