# ACME Salary Management System

Compensation management and pay analytics for a 10,000-employee organisation,
built for the HR Manager persona.

The premise: storing salaries is table stakes — a spreadsheet already does that.
What a spreadsheet does badly is answer *"are we paying people fairly?"* across
10,000 rows and eleven currencies. That question is what this system is built
around.

---

## Quick start

**Prerequisites:** Node 20+, PostgreSQL 14+ (17 recommended).

```bash
# 1. Install
npm install

# 2. Configure — set your database password in each
cp .env.example .env
cp apps/api/.env.example apps/api/.env          # Prisma reads this one
cp apps/web/.env.example apps/web/.env.local

# 3. Create the schema and seed 10,000 employees (~30s)
npm run db:migrate
npm run db:seed

# 4. Run both apps
npm run dev
```

- Web UI → <http://localhost:3000>
- API → <http://localhost:4000>

### Tests

```bash
npm test          # 178 tests: 65 shared, 83 API, 30 web
```

The API suite runs against a **separate** PostgreSQL database, because it
truncates tables between files. Create it once:

```bash
createdb salary_management_test
cp apps/api/.env.test.example apps/api/.env.test    # then set your password
npm run test:setup -w @salary/api                   # applies migrations
```

---

## What it does

| Screen | Purpose |
|---|---|
| **Dashboard** | Headline payroll metrics, cost by department and country, 12-month trend, and the pay-equity list. |
| **Employees** | Server-side search, filter, sort and pagination over 10,000 records. |
| **Employee detail** | Profile plus the full salary-history timeline, with the reason and actor for every change. |
| **Pay analysis** | Distribution by any dimension, gender pay gap with suppression, and configurable outlier detection. |

---

## The decisions that matter

Full reasoning lives in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). The three
that shaped everything else:

**1. Salary records are immutable and effective-dated.**
A raise appends a row; it never overwrites one. This is what turns a CRUD app
into something that can answer questions — point-in-time reporting, trend
analysis and a real audit trail all fall out of it. The cost is that "current
salary" becomes a join, mitigated with a partial index on `effective_to IS NULL`,
and that every change is a two-statement invariant, so it runs in a transaction
at `Serializable` isolation with a unique partial index as a database-level
backstop.

**2. Median over mean, everywhere.**
Salary distributions are right-skewed. In the seeded data the mean is $76,453 and
the median $62,622 — reporting the mean alone would overstate what a typical
employee earns by 22%. Percentiles are computed in Postgres with
`PERCENTILE_CONT` and cross-checked in tests against a reference implementation
in `@salary/shared`.

**3. Money is never a float, and FX rates are fixed.**
Amounts are `DECIMAL` in the database and integer minor units in application
logic. Each record stores both the local amount and a USD normalisation computed
**at write time** from a versioned rate table — computing it at read time would
mean last quarter's report silently changes when a rate moves.

---

## Two things worth reading the code for

Both were found by running the system against the seeded data and looking at the
output, not by the tests passing.

**The outlier report was flagging the wrong people.** Every intern (93/93) and
94% of part-timers were reported as severely underpaid, against 11% of full-time
staff. Their pay is pro-rated *by contract* — measuring it against a full-time
band median reports a contract term as a pay-equity problem, and buried the
genuine cases under a list of people whose pay was exactly right. Bands are now
full-time only. The honest fix needs an FTE fraction on the employee record;
that is written up rather than faked.

**The trend endpoint missed its performance target, and the fix that should have
worked didn't.** A composite index made no difference — `EXPLAIN` showed the
planner ignoring it for a sequential scan, because the predicate carries an
`OR ... IS NULL` and matches 22% of the table. It was reverted rather than left
in place looking useful. [`docs/PERFORMANCE.md`](docs/PERFORMANCE.md) records the
measurements, including what failed.

---

## Testing approach

**178 tests.** Integration tests run against real PostgreSQL rather than mocks,
because the analytics layer is built on `PERCENTILE_CONT`, `FILTER` clauses and
partial indexes — a suite that mocked Prisma would verify only that the mock was
called, leaving the code most worth testing uncovered.

What they actually protect:

- **Invariants** — records close contiguously, superseded amounts never mutate,
  and two racing raises resolve to one winner rather than two open records.
- **Maths** — fixtures small enough that every expected value is checkable by
  hand, with the SQL percentiles cross-checked against the reference
  implementation.
- **Judgement** — that small groups have their medians suppressed, that a
  percentage change is withheld across a currency change, and that `PATCH`
  cannot alter pay.

Determinism throughout: fixed fixtures, seeded RNG, no network, single fork.

---

## Layout

```
apps/api            Express 5 + Prisma. Routes → services → Postgres.
apps/web            Next.js 16 (App Router), Tailwind, Recharts.
packages/shared     Money, statistics, domain types and Zod schemas.
docs/               Requirements, architecture, performance, AI usage.
```

`packages/shared` exists so the API's validation and the web app's form
validation are *the same code* — the main reason this is a monorepo.

---

## Deliberately out of scope

Authentication, payroll processing, live FX, approval workflows, bulk Excel
import and org-chart visualisation. Each exclusion and its reasoning is in
[`docs/REQUIREMENTS.md`](docs/REQUIREMENTS.md) §4. The auth seam is marked in
`apps/api/src/app.ts` and an `actor` is already threaded through every service
for audit fields, so wiring real auth touches one middleware and one function.
