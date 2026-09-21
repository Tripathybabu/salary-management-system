# How AI was used on this project

The brief asks for intentional use of AI tools while maintaining correctness and
quality. This is an honest account of how the work was actually done, including
where the AI was wrong and how that was caught.

**Tooling:** Claude (Opus) via Claude Code, working directly in the repository
with shell, file and database access.

---

## The approach: verification over generation

Generating plausible code is the easy part, and it is not where the risk is. For
a system that computes salary statistics, the failure mode that matters is code
that *looks* correct, type-checks, passes its tests, and is quietly wrong. A
median computed over the wrong population is not a crash — it is a number on a
dashboard that an HR manager will act on.

So the working rule throughout was: **nothing counts as done until it has been
run against real data and the output has been read.**

Concretely, at every stage:

1. Design decisions were settled first, in writing, before code
   (`REQUIREMENTS.md` and `ARCHITECTURE.md` predate the implementation commits).
2. Code was generated against those decisions.
3. It was then executed — the API booted, endpoints called, the UI rendered in a
   real browser, queries `EXPLAIN`ed — and the *output* inspected, not just the
   exit code.

Steps 1 and 3 are where the engineering happened. Step 2 was the fast part.

---

## Three things this caught

These are the substantive findings. Each one passed type-checking and tests
before it was caught by looking at actual output.

### 1. The outlier report was flagging the wrong people

The pay-equity screen is the product's most valuable feature — it answers "who
should I look at on Monday?". The implementation was correct against its
specification and fully tested.

Rendering it against the seeded 10,000 employees showed the top findings were all
interns at roughly **-77% below band**. Querying the distribution made the scale
clear: **every intern (93/93) and 94% of part-timers (289/306) were flagged,
versus 11% of full-time staff.**

The bug was conceptual, not mechanical. Part-time and intern pay is pro-rated *by
contract*; comparing it against a full-time band median reports a contract term
as a pay-equity problem. Worse, it buried the genuine cases under a list of
people whose pay was exactly right — making the screen useless for its one job.

No unit test would have caught this, because the code did exactly what it was
asked to. It required looking at the output and asking whether the *answer* was
sensible.

### 2. A performance fix that didn't work

The trend endpoint measured 687 ms against a 200 ms target. The obvious fix — a
composite index on `(effective_from, effective_to)` — was written, migrated and
measured: **no improvement.**

`EXPLAIN (ANALYZE)` showed why: the planner ignored the index and chose a
sequential scan, because the predicate carries an `OR effective_to IS NULL` and
matches ~22% of the table. A covering variant behaved identically.

The index was reverted. It would have looked like an optimisation in a diff while
costing write throughput on every salary change and misleading the next reader.
The negative result is recorded in the schema comment and in `PERFORMANCE.md` so
the experiment is not repeated. Accepting the measurement over the plausible
story is the part that mattered.

### 3. Charts that rendered nothing

The dashboard built, type-checked and served HTTP 200. Screenshotting it in a
real browser showed the bar charts were empty — Recharts 2.x does not properly
support React 19. Status codes would never have revealed this; only rendering the
page did.

*(A related false alarm: a later screenshot also showed blank charts, which
turned out to be the capture racing Recharts' enter animation. Worth noting
because verification tooling can lie too — the DOM inspection that followed
showed the bars were present with correct geometry and fill.)*

---

## Where AI was genuinely good

- **Breadth at speed.** A Prisma schema with considered indexes, a seed generator
  with log-normal salary distributions and cost-of-living multipliers, and four
  React screens — scaffolded in a fraction of the time hand-writing would take.
- **Consistency.** Naming, error handling, comment density and file structure
  stay uniform across ~4,000 lines, which is exactly what tends to drift when a
  human writes the same volume over several sessions.
- **Test enumeration.** Given a stated invariant ("exactly one open salary record
  per employee"), it reliably proposed the edge cases worth covering — the
  concurrent-raise race, the currency-change percentage, backdating.
- **SQL.** `PERCENTILE_CONT` with `FILTER` clauses and window functions for cost
  share is fiddly to write correctly by hand, and it got it right.

## Where it needed correcting

- **Plausible-but-wrong domain logic.** The outlier bug is the clearest case: a
  confident, well-tested, well-commented implementation of the wrong idea.
- **Over-claiming.** First drafts of comments and docs asserted things like
  "sub-100ms at 10k scale" with nothing behind them. Every performance claim in
  this repository now points at a measurement, and the one target that was missed
  says so.
- **Self-confirming tests.** An early instinct was to assert a median by calling
  the same helper the implementation uses. Fixtures were rewritten small enough
  that expected values are computed by hand in the comments.
- **Version assumptions.** Defaulted to Recharts 2.x with React 19, and to a
  Next.js version carrying a vulnerable bundled PostCSS. Both were caught by
  running and auditing, not by reading the code.

---

## What I would tell someone doing this

The bottleneck is not generation, and treating it as one produces a system that
demos well and is wrong in ways nobody notices until it matters. The leverage is
in **stating the design constraints precisely up front** — effective-dated
records, median over mean, never floats for money — and then **insisting on real
output at every step**: boot it, query it, render it, `EXPLAIN` it, read it.

Every genuine defect in this project was found in step three. None were found by
reading the generated code.
