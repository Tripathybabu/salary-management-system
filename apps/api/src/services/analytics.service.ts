/**
 * Compensation analytics — "how does this organisation pay people?"
 *
 * Every query here aggregates in Postgres. Pulling 10,000 salary rows into Node to
 * compute a median would be the obvious wrong answer: it moves ~1MB over the wire
 * per request and discards the database's own optimised percentile implementation.
 *
 * `PERCENTILE_CONT` is used throughout, matching the interpolating implementation in
 * @salary/shared so the two agree and can be tested against each other.
 */

import { Prisma } from '@prisma/client';
import {
  MIN_GROUP_SIZE_FOR_REPORTING,
  type AnalyticsDimension,
} from '@salary/shared';
import { prisma } from '../lib/prisma.js';

export interface AnalyticsFilters {
  countryCode?: string;
  departmentId?: string;
  level?: string;
  activeOnly: boolean;
}

/**
 * The base row set: every employee joined to their currently-effective salary.
 *
 * An INNER JOIN on `effective_to IS NULL` is correct here, unlike in the list view:
 * an employee with no current salary has no compensation to analyse, and including
 * them would understate every average.
 */
function currentCompensationCte(filters: AnalyticsFilters): Prisma.Sql {
  const conditions: Prisma.Sql[] = [];

  if (filters.activeOnly) {
    // Leavers still on the books would inflate headcount and payroll cost.
    conditions.push(Prisma.sql`e.status = 'ACTIVE'::"EmploymentStatus"`);
  }
  if (filters.countryCode) {
    conditions.push(Prisma.sql`e.country_code = ${filters.countryCode}`);
  }
  if (filters.departmentId) {
    conditions.push(Prisma.sql`e.department_id = ${filters.departmentId}::uuid`);
  }
  if (filters.level) {
    conditions.push(Prisma.sql`e.level = ${filters.level}::"JobLevel"`);
  }

  const where =
    conditions.length > 0 ? Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}` : Prisma.empty;

  return Prisma.sql`
    SELECT
      e.id, e.gender, e.level, e.country_code, e.department_id,
      e.employment_type, c.name AS country_name, d.name AS department_name,
      sr.annual_amount_usd AS amount
    FROM employees e
    JOIN salary_records sr ON sr.employee_id = e.id AND sr.effective_to IS NULL
    JOIN countries c ON c.code = e.country_code
    JOIN departments d ON d.id = e.department_id
    ${where}
  `;
}

export interface OverviewMetrics {
  headcount: number;
  totalAnnualCostUsd: number;
  medianSalaryUsd: number;
  meanSalaryUsd: number;
  p25SalaryUsd: number;
  p75SalaryUsd: number;
  p90SalaryUsd: number;
  minSalaryUsd: number;
  maxSalaryUsd: number;
  countryCount: number;
  departmentCount: number;
}

/** Top-line numbers for the dashboard header. */
export async function getOverview(filters: AnalyticsFilters): Promise<OverviewMetrics> {
  const base = currentCompensationCte(filters);

  const result = await prisma.$queryRaw<[Record<string, unknown>]>`
    WITH current_comp AS (${base})
    SELECT
      COUNT(*)::int AS headcount,
      COALESCE(SUM(amount), 0)::float8 AS total_annual_cost_usd,
      COALESCE(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY amount), 0)::float8 AS median_salary_usd,
      COALESCE(AVG(amount), 0)::float8 AS mean_salary_usd,
      COALESCE(PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY amount), 0)::float8 AS p25_salary_usd,
      COALESCE(PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY amount), 0)::float8 AS p75_salary_usd,
      COALESCE(PERCENTILE_CONT(0.90) WITHIN GROUP (ORDER BY amount), 0)::float8 AS p90_salary_usd,
      COALESCE(MIN(amount), 0)::float8 AS min_salary_usd,
      COALESCE(MAX(amount), 0)::float8 AS max_salary_usd,
      COUNT(DISTINCT country_code)::int AS country_count,
      COUNT(DISTINCT department_id)::int AS department_count
    FROM current_comp
  `;

  const row = result[0] ?? {};
  return {
    headcount: Number(row.headcount ?? 0),
    totalAnnualCostUsd: round2(Number(row.total_annual_cost_usd ?? 0)),
    medianSalaryUsd: round2(Number(row.median_salary_usd ?? 0)),
    meanSalaryUsd: round2(Number(row.mean_salary_usd ?? 0)),
    p25SalaryUsd: round2(Number(row.p25_salary_usd ?? 0)),
    p75SalaryUsd: round2(Number(row.p75_salary_usd ?? 0)),
    p90SalaryUsd: round2(Number(row.p90_salary_usd ?? 0)),
    minSalaryUsd: round2(Number(row.min_salary_usd ?? 0)),
    maxSalaryUsd: round2(Number(row.max_salary_usd ?? 0)),
    countryCount: Number(row.country_count ?? 0),
    departmentCount: Number(row.department_count ?? 0),
  };
}

export interface GroupBreakdown {
  key: string;
  label: string;
  headcount: number;
  totalAnnualCostUsd: number;
  medianSalaryUsd: number;
  meanSalaryUsd: number;
  p25SalaryUsd: number;
  p75SalaryUsd: number;
  /** Share of total payroll cost, as a percentage. */
  costSharePercent: number;
}

/** SQL fragments for each groupable dimension. */
const DIMENSION_COLUMNS: Record<AnalyticsDimension, { key: string; label: string }> = {
  country: { key: 'country_code', label: 'country_name' },
  department: { key: 'department_id::text', label: 'department_name' },
  level: { key: 'level::text', label: 'level::text' },
  employmentType: { key: 'employment_type::text', label: 'employment_type::text' },
};

/**
 * Break compensation down by one dimension.
 *
 * Both the key and label expressions come from the fixed table above, never from
 * user input — `dimension` is constrained to that key set by Zod before it arrives.
 */
export async function getBreakdown(
  dimension: AnalyticsDimension,
  filters: AnalyticsFilters,
): Promise<GroupBreakdown[]> {
  const base = currentCompensationCte(filters);
  const column = DIMENSION_COLUMNS[dimension];
  const keyExpr = Prisma.raw(column.key);
  const labelExpr = Prisma.raw(column.label);

  const rows = await prisma.$queryRaw<Record<string, unknown>[]>`
    WITH current_comp AS (${base}),
    grouped AS (
      SELECT
        ${keyExpr} AS group_key,
        ${labelExpr} AS group_label,
        COUNT(*)::int AS headcount,
        SUM(amount)::float8 AS total_cost,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY amount)::float8 AS median_salary,
        AVG(amount)::float8 AS mean_salary,
        PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY amount)::float8 AS p25_salary,
        PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY amount)::float8 AS p75_salary
      FROM current_comp
      GROUP BY 1, 2
    )
    SELECT
      g.*,
      (g.total_cost / NULLIF(SUM(g.total_cost) OVER (), 0) * 100)::float8 AS cost_share
    FROM grouped g
    ORDER BY g.total_cost DESC
  `;

  return rows.map((row) => ({
    key: String(row.group_key),
    label: String(row.group_label),
    headcount: Number(row.headcount),
    totalAnnualCostUsd: round2(Number(row.total_cost)),
    medianSalaryUsd: round2(Number(row.median_salary)),
    meanSalaryUsd: round2(Number(row.mean_salary)),
    p25SalaryUsd: round2(Number(row.p25_salary)),
    p75SalaryUsd: round2(Number(row.p75_salary)),
    costSharePercent: round2(Number(row.cost_share ?? 0)),
  }));
}

export interface PayGapRow {
  key: string;
  label: string;
  maleCount: number;
  femaleCount: number;
  maleMedianUsd: number | null;
  femaleMedianUsd: number | null;
  medianGapPercent: number | null;
  meanGapPercent: number | null;
  suppressed: boolean;
}

export interface PayGapReport {
  rows: PayGapRow[];
  overall: {
    medianGapPercent: number | null;
    maleCount: number;
    femaleCount: number;
  };
  /**
   * Share of employees with a recorded MALE/FEMALE gender. A gap computed over 60%
   * of staff is a different claim from one computed over 98%, and the UI says so.
   */
  coveragePercent: number;
  minGroupSize: number;
}

/**
 * Gender pay gap by dimension.
 *
 * This reports a *raw* gap — the difference in median pay between two populations.
 * It is not an equal-pay-for-equal-work measure: a gap can arise entirely from how
 * roles and seniority are distributed. Grouping by level is what starts to separate
 * those explanations, which is why `dimension` matters here.
 *
 * Groups smaller than `minGroupSize` are suppressed. The statistical reason is that
 * small samples are noise; the stronger reason is disclosure — a median across two
 * people reveals both salaries to anyone who can see the report.
 */
export async function getPayGapReport(
  dimension: AnalyticsDimension,
  filters: AnalyticsFilters,
  minGroupSize: number = MIN_GROUP_SIZE_FOR_REPORTING,
): Promise<PayGapReport> {
  const base = currentCompensationCte(filters);
  const column = DIMENSION_COLUMNS[dimension];
  const keyExpr = Prisma.raw(column.key);
  const labelExpr = Prisma.raw(column.label);

  const [rows, overallResult, coverageResult] = await Promise.all([
    prisma.$queryRaw<Record<string, unknown>[]>`
      WITH current_comp AS (${base})
      SELECT
        ${keyExpr} AS group_key,
        ${labelExpr} AS group_label,
        COUNT(*) FILTER (WHERE gender = 'MALE')::int AS male_count,
        COUNT(*) FILTER (WHERE gender = 'FEMALE')::int AS female_count,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY amount)
          FILTER (WHERE gender = 'MALE')::float8 AS male_median,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY amount)
          FILTER (WHERE gender = 'FEMALE')::float8 AS female_median,
        AVG(amount) FILTER (WHERE gender = 'MALE')::float8 AS male_mean,
        AVG(amount) FILTER (WHERE gender = 'FEMALE')::float8 AS female_mean
      FROM current_comp
      GROUP BY 1, 2
      ORDER BY 2
    `,
    prisma.$queryRaw<[Record<string, unknown>]>`
      WITH current_comp AS (${base})
      SELECT
        COUNT(*) FILTER (WHERE gender = 'MALE')::int AS male_count,
        COUNT(*) FILTER (WHERE gender = 'FEMALE')::int AS female_count,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY amount)
          FILTER (WHERE gender = 'MALE')::float8 AS male_median,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY amount)
          FILTER (WHERE gender = 'FEMALE')::float8 AS female_median
      FROM current_comp
    `,
    prisma.$queryRaw<[Record<string, unknown>]>`
      WITH current_comp AS (${base})
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE gender IN ('MALE', 'FEMALE'))::int AS covered
      FROM current_comp
    `,
  ]);

  const mapped: PayGapRow[] = rows.map((row) => {
    const maleCount = Number(row.male_count);
    const femaleCount = Number(row.female_count);
    const suppressed = maleCount < minGroupSize || femaleCount < minGroupSize;

    const maleMedian = row.male_median === null ? null : Number(row.male_median);
    const femaleMedian = row.female_median === null ? null : Number(row.female_median);
    const maleMean = row.male_mean === null ? null : Number(row.male_mean);
    const femaleMean = row.female_mean === null ? null : Number(row.female_mean);

    return {
      key: String(row.group_key),
      label: String(row.group_label),
      maleCount,
      femaleCount,
      // Medians are withheld alongside the gap: publishing them would defeat the
      // disclosure protection the suppression exists for.
      maleMedianUsd: suppressed ? null : round2(maleMedian ?? 0),
      femaleMedianUsd: suppressed ? null : round2(femaleMedian ?? 0),
      medianGapPercent: suppressed ? null : gapPercent(maleMedian, femaleMedian),
      meanGapPercent: suppressed ? null : gapPercent(maleMean, femaleMean),
      suppressed,
    };
  });

  const overallRow = overallResult[0] ?? {};
  const coverageRow = coverageResult[0] ?? {};
  const total = Number(coverageRow.total ?? 0);
  const covered = Number(coverageRow.covered ?? 0);

  return {
    rows: mapped,
    overall: {
      medianGapPercent: gapPercent(
        overallRow.male_median === null ? null : Number(overallRow.male_median),
        overallRow.female_median === null ? null : Number(overallRow.female_median),
      ),
      maleCount: Number(overallRow.male_count ?? 0),
      femaleCount: Number(overallRow.female_count ?? 0),
    },
    coveragePercent: total > 0 ? round2((covered / total) * 100) : 0,
    minGroupSize,
  };
}

function gapPercent(reference: number | null, comparison: number | null): number | null {
  if (reference === null || comparison === null || reference === 0) return null;
  return round2(((reference - comparison) / reference) * 100);
}

export interface OutlierRow {
  employeeId: string;
  employeeCode: string;
  name: string;
  jobTitle: string;
  level: string;
  countryCode: string;
  departmentName: string;
  salaryUsd: number;
  bandMedianUsd: number;
  bandSize: number;
  deviationPercent: number;
  direction: 'below' | 'above';
}

/**
 * Employees paid anomalously relative to their (level × country) peer band.
 *
 * This is the screen that turns the dashboard into an action list: not "here is our
 * median", but "here are the eleven people you should look at on Monday".
 *
 * Band = level × country, over full-time employees only. Three deliberate choices:
 *
 * 1. **Country is in the band key.** Comparing across countries would flag every
 *    employee in a lower-cost market as underpaid — noise, not a finding.
 *
 * 2. **Only full-time employees are compared.** A part-timer on 0.55 FTE and an
 *    intern earn a fraction of a full-time salary *by design*; measuring them
 *    against a full-time median reports a contract term as a pay-equity problem.
 *    Against the seeded dataset this was not a marginal effect: every intern and
 *    94% of part-timers were flagged, versus 11% of full-time staff, which buried
 *    the real findings under a list of people whose pay was exactly right.
 *    Fixing this properly needs an FTE fraction on the employee record so
 *    part-time pay can be annualised to a full-time equivalent and compared
 *    honestly; that field does not exist yet, so they are excluded rather than
 *    silently mis-reported. Recorded in docs/REQUIREMENTS.md §4.
 *
 * 3. Bands below `minBandSize` are skipped — a "median" of three people is not a band.
 */
export async function getPayOutliers(
  filters: AnalyticsFilters,
  options: {
    thresholdPercent: number;
    direction: 'below' | 'above' | 'both';
    minBandSize: number;
    limit: number;
  },
): Promise<OutlierRow[]> {
  const base = currentCompensationCte(filters);
  const threshold = options.thresholdPercent / 100;

  const directionCondition =
    options.direction === 'below'
      ? Prisma.sql`deviation <= ${-threshold}`
      : options.direction === 'above'
        ? Prisma.sql`deviation >= ${threshold}`
        : Prisma.sql`ABS(deviation) >= ${threshold}`;

  const rows = await prisma.$queryRaw<Record<string, unknown>[]>`
    WITH current_comp AS (${base}),
    -- Comparable population: full-time only, so a pro-rated salary is never
    -- measured against a full-time median. Both the band and the people scored
    -- against it come from this set.
    comparable AS (
      SELECT * FROM current_comp
      WHERE employment_type = 'FULL_TIME'::"EmploymentType"
    ),
    bands AS (
      SELECT level, country_code,
             PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY amount) AS band_median,
             COUNT(*)::int AS band_size
      FROM comparable
      GROUP BY level, country_code
      HAVING COUNT(*) >= ${options.minBandSize}
    ),
    scored AS (
      SELECT
        cc.id, cc.amount, b.band_median, b.band_size,
        ((cc.amount - b.band_median) / NULLIF(b.band_median, 0))::float8 AS deviation
      FROM comparable cc
      JOIN bands b ON b.level = cc.level AND b.country_code = cc.country_code
    )
    SELECT
      s.id, s.amount::float8, s.band_median::float8, s.band_size, s.deviation,
      e.employee_code, e.first_name, e.last_name, e.job_title,
      e.level::text AS level, e.country_code, d.name AS department_name
    FROM scored s
    JOIN employees e ON e.id = s.id
    JOIN departments d ON d.id = e.department_id
    WHERE ${directionCondition}
    ORDER BY ABS(s.deviation) DESC
    LIMIT ${options.limit}
  `;

  return rows.map((row) => {
    const deviation = Number(row.deviation);
    return {
      employeeId: String(row.id),
      employeeCode: String(row.employee_code),
      name: `${row.first_name} ${row.last_name}`,
      jobTitle: String(row.job_title),
      level: String(row.level),
      countryCode: String(row.country_code),
      departmentName: String(row.department_name),
      salaryUsd: round2(Number(row.amount)),
      bandMedianUsd: round2(Number(row.band_median)),
      bandSize: Number(row.band_size),
      deviationPercent: round2(deviation * 100),
      direction: deviation < 0 ? 'below' : 'above',
    };
  });
}

export interface TrendPoint {
  period: string;
  headcount: number;
  totalAnnualCostUsd: number;
  medianSalaryUsd: number;
}

/**
 * Payroll cost and median salary over time.
 *
 * This is only answerable *because* salary records are effective-dated: for each
 * month we find the record that was in effect then. A mutable salary column would
 * have overwritten this history and the question would be unanswerable.
 */
export async function getCompensationTrend(
  filters: AnalyticsFilters,
  months: number,
): Promise<TrendPoint[]> {
  const statusCondition = filters.activeOnly
    ? Prisma.sql`AND e.status <> 'TERMINATED'::"EmploymentStatus"`
    : Prisma.empty;

  const countryCondition = filters.countryCode
    ? Prisma.sql`AND e.country_code = ${filters.countryCode}`
    : Prisma.empty;
  const deptCondition = filters.departmentId
    ? Prisma.sql`AND e.department_id = ${filters.departmentId}::uuid`
    : Prisma.empty;
  const levelCondition = filters.level
    ? Prisma.sql`AND e.level = ${filters.level}::"JobLevel"`
    : Prisma.empty;

  const rows = await prisma.$queryRaw<Record<string, unknown>[]>`
    WITH periods AS (
      SELECT generate_series(
        DATE_TRUNC('month', CURRENT_DATE) - (${months - 1} || ' months')::interval,
        DATE_TRUNC('month', CURRENT_DATE),
        '1 month'::interval
      )::date AS period_start
    )
    SELECT
      TO_CHAR(p.period_start, 'YYYY-MM') AS period,
      COUNT(sr.id)::int AS headcount,
      COALESCE(SUM(sr.annual_amount_usd), 0)::float8 AS total_cost,
      COALESCE(
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY sr.annual_amount_usd), 0
      )::float8 AS median_salary
    FROM periods p
    LEFT JOIN salary_records sr
      ON sr.effective_from <= p.period_start
     AND (sr.effective_to IS NULL OR sr.effective_to >= p.period_start)
    LEFT JOIN employees e
      ON e.id = sr.employee_id
     AND e.hire_date <= p.period_start
     ${statusCondition} ${countryCondition} ${deptCondition} ${levelCondition}
    WHERE e.id IS NOT NULL OR sr.id IS NULL
    GROUP BY p.period_start
    ORDER BY p.period_start
  `;

  return rows.map((row) => ({
    period: String(row.period),
    headcount: Number(row.headcount),
    totalAnnualCostUsd: round2(Number(row.total_cost)),
    medianSalaryUsd: round2(Number(row.median_salary)),
  }));
}

/** Round to 2dp. Currency values must not surface with float noise. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
