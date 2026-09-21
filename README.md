# ACME Salary Management — Web

Frontend for a compensation management and pay-analytics system covering 10,000
employees across eleven countries. Built for the HR Manager persona.

**API repository:** <https://github.com/Tripathybabu/salary-management-system-api>

The premise: storing salaries is table stakes — a spreadsheet already does that.
What a spreadsheet does badly is answer *"are we paying people fairly?"* across
10,000 rows and eleven currencies. That question is what these screens are built
around.

---

## Quick start

**The API must be running first.** Set it up from the repository linked above,
then:

```bash
npm install

# Points the app at the API
cp .env.example .env.local

npm run dev          # http://localhost:3000
```

### Tests

```bash
npm test             # 95 tests: 65 shared, 30 component
```

---

## Screens

| Screen | Purpose |
|---|---|
| **Dashboard** (`/`) | Headline payroll metrics, cost by department and country, 12-month trend, and the pay-equity list. |
| **Employees** (`/employees`) | Server-side search, filter, sort and pagination over 10,000 records. |
| **Employee detail** (`/employees/[id]`) | Profile plus the full salary-history timeline, with the reason and actor for every change. |
| **Pay analysis** (`/analytics`) | Distribution by any dimension, gender pay gap with suppression, configurable outlier detection. |

---

## The decisions that matter

**1. Ten thousand rows never reach the browser.**
Every filter, sort and page is a server-side query returning at most 25 rows.
Search is debounced, so typing a name issues one request rather than one per
keystroke, and React Query keeps the previous page visible while the next loads
so the table never collapses to a skeleton mid-navigation.

**2. The consequence of a salary change is visible before it is committed.**
The change dialog computes the percentage difference live as you type, so a
mistyped extra zero reads as `+900%` at the moment it is entered rather than
being discovered later in the dashboard totals. It is deliberately withheld
across a currency change, where part of the difference is FX and labelling it a
raise would be a false number.

**3. Every figure carries the context needed to judge it.**
Medians lead, with means beside them — a mean alone misrepresents a skewed salary
distribution. Pay-gap rows show their headcounts and the org-wide gender
coverage, and groups too small to report have their medians withheld entirely,
because a median across two people discloses both salaries. Outlier rows show the
band median and band size, so a flag is auditable rather than asserted.

**4. Validation is the API's own schema.**
Forms validate with the Zod schemas from `packages/shared` — the same objects the
server enforces — so the two cannot drift apart. Client validation is a
convenience for fast feedback; the server still validates everything.

---

## Notes from building it

**Charts rendered nothing despite a clean build.** The dashboard compiled,
type-checked and served HTTP 200 while every bar chart was empty: Recharts 2.x
does not properly support React 19. Only screenshotting the running page in a
real browser surfaced it. Pinned to Recharts 3.

**UI primitives are hand-rolled.** The app needs about eight of them —
card, button, input, select, field, badge, skeleton, empty state — and each is a
few lines. Pulling in a component library to get them would have added a
dependency and a second styling system for no benefit at this size.

---

## Layout

```
src/app/           Routes: dashboard, employees, detail, new, analytics.
src/components/    UI primitives, charts, salary change dialog.
src/lib/           Typed API client and display formatting.
src/hooks/         useDebounced, for the search box.
tests/             Formatting and component suites.
packages/shared/   Money, statistics, domain types, Zod schemas.
docs/              Requirements, architecture, performance, AI usage.
```

`packages/shared` is duplicated in the API repository so both sides validate with
the same schemas. It is the one piece of deliberate duplication across the two
repos; in the original monorepo it was a single workspace package.

---

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | `http://localhost:4000` | Base URL of the API |

There is no authentication — one persona in the brief, and a fake login screen
would be worse than none. The API client sends an `x-actor-id` header that the
backend records on every salary change, so the audit trail is real and the auth
seam is a single change when it is needed. Reasoning in
[`docs/REQUIREMENTS.md`](docs/REQUIREMENTS.md) §4.
