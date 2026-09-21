# Performance

Measured, not asserted. `ARCHITECTURE.md` §6 makes claims about behaviour at 10k
scale; this file is the evidence, including the one place the claim did not hold.

## Method

- Dataset: the full seeded database — 10,000 employees, 43,143 salary records,
  9,574 currently in effect.
- PostgreSQL 17, Node 24, API and database on the same machine. Absolute numbers
  would differ on deployed hardware; the shape of the results is the point.
- 10 requests per endpoint over a warm cache, reporting p50 and p95 of total
  round-trip time including JSON serialisation.
- Query plans captured with `EXPLAIN (ANALYZE, BUFFERS)`.

## Results

| Endpoint | p50 | p95 |
|---|---:|---:|
| `GET /api/employees?pageSize=25` | 15 ms | 17 ms |
| `GET /api/employees` sorted by current salary | 39 ms | 42 ms |
| `GET /api/employees?search=john` | 22 ms | 28 ms |
| `GET /api/employees?countryCode=IN&level=L4` | 10 ms | 15 ms |
| `GET /api/analytics/overview` | 29 ms | 30 ms |
| `GET /api/analytics/breakdown?dimension=department` | 29 ms | 31 ms |
| `GET /api/analytics/breakdown?dimension=country` | 28 ms | 31 ms |
| `GET /api/analytics/pay-gap?dimension=level` | 39 ms | 43 ms |
| `GET /api/analytics/outliers` | 50 ms | 55 ms |
| `GET /api/analytics/trend?months=18` | **687 ms** | **805 ms** |

Nine of ten endpoints sit comfortably inside the 200 ms target from
`REQUIREMENTS.md` §5. The trend endpoint does not, and that is worth being
precise about rather than quietly dropping the target.

## Why listing 10,000 employees costs 15 ms

Pagination happens in Postgres, so the page size — not the table size — determines
the work. The count and the page are issued concurrently as independent queries.
Sorting by current salary costs more (39 ms) because it joins the open salary
record and orders by it; the partial index on `effective_to IS NULL` keeps that
join to an index hit rather than a scan of all 43,143 records.

## Why the analytics endpoints cost ~30 ms

Every aggregate is computed in SQL via `PERCENTILE_CONT`. The alternative —
fetching 9,574 rows into Node and sorting them per request — would move roughly a
megabyte over the wire and discard the database's own percentile implementation.
The overview aggregates the full active population in a single pass.

## The trend endpoint: an honest negative result

The trend query answers "what was payroll, and the median salary, in each of the
last N months?" It is only answerable because salary records are effective-dated
— but it is the most expensive query in the system, and it stayed that way.

**What I tried, and what actually happened.**

1. **Composite index on `(effective_from, effective_to)`.** The hypothesis was that
   the point-in-time predicate could be satisfied from the index instead of
   reading and discarding rows. I wrote the migration, applied it, and
   re-measured: **no improvement** (687 ms → 723 ms, within noise).

   `EXPLAIN` showed why: the planner ignored the index and chose a sequential
   scan. The predicate carries an `OR effective_to IS NULL`, which is not
   index-friendly, and it matches ~9,600 of 43,143 rows — about 22% of the table,
   comfortably past the point where a sequential scan is genuinely cheaper.

2. **Covering index** with `INCLUDE (employee_id, annual_amount_usd)`. Same
   result: still a sequential scan.

   I reverted both. An index the planner never uses is not free — it costs write
   throughput on every salary change and misleads the next person reading the
   schema into thinking the query is indexed. The schema comment now records the
   measurement so nobody repeats the experiment.

3. **Restructuring the query** to aggregate per period inside a `LATERAL` rather
   than joining every record against every period and grouping afterwards. This
   *did* help — 687 ms → 395 ms — by removing a 6.3 MB external merge sort over
   169,000 intermediate rows.

   I did not ship it. It is a real improvement but still misses the target, it
   drops an edge case the current query handles, and trading correctness for a
   figure that is still too slow is a bad exchange.

**The actual constraint.** A single period costs ~26 ms, and that is almost
entirely one median over ~9,600 rows. Eighteen periods means eighteen medians.
The cost is linear in the range and no index removes it, because the work is the
percentile itself, not finding the rows.

**What I did instead.** The default range is 12 months (~300 ms) and the maximum
is 36 (~900 ms), replacing a 60-month ceiling that would have taken ~1.5 s. The
dashboard renders the rest of the page while the trend loads, so this never
blocks the numbers an HR manager looks at first. The bound is enforced by Zod at
the route, with the cost written down at the call site.

**What I would build next.** A `monthly_compensation_snapshot` table, one row per
month per group, written by a scheduled job. The trend then becomes a primary-key
range scan over ~36 rows instead of 36 medians over 9,600. That is the right fix,
and it is a scheduled-job-and-backfill feature rather than a query tweak — too
much to add here without cutting something that matters more.

## Seeding

10,000 employees and 43,143 salary records insert in batches of 1,000 via
`createMany`. Row-at-a-time inserts would mean 53,000 round-trips.

## What is not measured here

Concurrent load, cold-cache behaviour, and performance on deployed hardware with
network latency between the API and the database. Single-user timings on one
machine are the right measurement for the claims in `ARCHITECTURE.md` §6; they are
not a capacity model, and I would not present them as one.
