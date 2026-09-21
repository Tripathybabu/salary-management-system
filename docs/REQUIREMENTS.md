# Requirements — Salary Management System

**Author:** Tapan · **Date:** 2026-09-21 · **Status:** Pre-build baseline

## 1. Goal

Give ACME's HR Manager a web application that replaces the spreadsheets currently used to
track salary data for ~10,000 employees across multiple countries — and, more importantly,
lets them **answer questions about how the organisation pays people** without exporting
anything to Excel.

The second half of that sentence is the real product. Storing salaries is table stakes; a
spreadsheet already does that. What a spreadsheet does *badly* is answer "are we paying
people in Bangalore fairly relative to their band?" across 10,000 rows and multiple
currencies. That is where this tool earns its place.

## 2. User & context

**Primary persona: HR Manager.** Single role, full access. They are an operational user,
not an analyst — they need answers rendered, not a query builder.

Core jobs-to-be-done, in priority order:

1. Find a specific employee and see their current compensation and salary history.
2. Record a salary change (raise, promotion, correction) with a reason and effective date.
3. Onboard a new employee; mark a leaver as inactive.
4. Answer questions about pay distribution — by country, department, level, and gender.
5. Spot people who are paid anomalously relative to their peer band.

## 3. Scope — what I am building

### 3.1 Employee management
- Paginated, server-side-filtered employee list (10k rows never reach the browser at once).
- Filter by country, department, level, employment status; free-text search on name/email/
  employee code. Sortable columns.
- Employee detail view: profile, current compensation, full salary history timeline.
- Create and edit employees; deactivate rather than delete (see §4).

### 3.2 Compensation management
- Salary records are **immutable, effective-dated rows**, not a mutable `salary` column.
  A raise appends a new record; it does not overwrite the old one. This is the single most
  important modelling decision in the system — see `docs/ARCHITECTURE.md`.
- Every change carries an effective date, a change reason (`HIRE`, `MERIT_INCREASE`,
  `PROMOTION`, `MARKET_ADJUSTMENT`, `CORRECTION`, ...), and an audit trail of who changed it.
- Multi-currency: amounts stored in local currency with the currency code, plus a
  normalised base-currency (USD) amount computed at write time for cross-country comparison.

### 3.3 Analytics — "how do we pay people?"
The dashboard answers, with server-side SQL aggregation:
- **Headcount and total payroll cost** — overall and grouped by country, department, level.
- **Compensation distribution** — p25 / median / p75 / p90 per group, not just the mean.
  Means are misleading for salary data; a single VP distorts a department average.
- **Gender pay gap** — median and mean gap per department and per level, with headcounts
  so the user can see when a figure rests on too small a sample to trust.
- **Pay-equity outliers** — employees more than a configurable threshold below their
  (level × country) band median. This is the "who should I look at on Monday?" screen.
- **Compensation trend** — total payroll cost and median salary over time, derived from the
  effective-dated history.

### 3.4 Platform
- REST API with validated request/response boundaries.
- Seed script generating 10,000 realistic, deterministic employees.
- Unit and integration tests covering compensation maths, statistics, validation, and the
  API surface.

## 4. Out of scope — and why

These are deliberate exclusions, not oversights. Each one is a considered trade-off.

| Excluded | Reasoning |
|---|---|
| **Authentication & multi-role RBAC** | One persona in the brief. Real auth (sessions, password reset, MFA) is a week of work that demonstrates no product thinking about *salary*. I instead structure the API so an auth middleware slots in at one place, and document exactly where. Building a fake login screen would be worse than none. |
| **Payroll processing / payslips / tax** | This is a *management and analysis* tool, not a payroll engine. Tax withholding is jurisdiction-specific and would be a multi-country compliance project on its own. |
| **Live FX rate integration** | Cross-country comparison needs a common currency, so I store a normalised USD amount. But I use a **fixed, versioned rate table** rather than a live API: analytics must be deterministic and reproducible. A report that changes because the rate moved is a bug, not a feature. The rate table is swappable. |
| **Approval workflows** | Multi-step approval implies multiple roles. Out of scope with one persona. The immutable history model means approvals could be layered on later without reshaping the data. |
| **Bulk Excel import/export** | Tempting, since they're migrating *from* Excel. Excluded because a robust importer (column mapping, partial-failure handling, dry-run preview) is a feature in its own right and would crowd out the analytics that actually differentiate this from the spreadsheet they already have. This is the first thing I would build next. |
| **Org chart / reporting hierarchy** | The schema carries `managerId` so the data is there, but hierarchy *visualisation* and rollup aggregation is a distinct problem. Not needed to answer pay questions. |
| **Employee self-service portal** | Different persona. Explicitly not the brief. |
| **Hard deletes** | Compensation data is financial-audit material. Employees deactivate; salary records never mutate. |

## 5. Non-functional requirements

- **Performance at 10k scale.** The list endpoint must paginate server-side and stay under
  ~200ms; analytics aggregate in SQL, never by loading rows into Node. Indexes on every
  filter and group-by column. I verify this against the seeded 10k dataset rather than
  asserting it.
- **Correctness of money.** No floating-point currency. Amounts are stored as `Decimal`
  and handled as integer minor units in application logic.
- **Deterministic tests.** Seeded RNG, fixed clock, no network, no test-order coupling.
- **Deterministic seed.** The same seed produces the same 10,000 employees, so numbers in
  the demo and in the tests are stable and reviewable.

## 6. Success criteria

The build is done when the HR Manager can, without touching a spreadsheet:

1. Find any of 10,000 employees in under three interactions.
2. Give someone a raise and see it reflected in their history and in dashboard totals.
3. Answer "what is our median salary in Germany for L4 engineers?" in one screen.
4. Get a list of people who look underpaid for their band.
5. Trust the numbers — because the maths behind them is unit-tested.
