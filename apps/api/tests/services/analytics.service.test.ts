/**
 * Analytics aggregation.
 *
 * The fixtures here are deliberately tiny and the expected values are computed by
 * hand in the comments. A test that asserts a median by calling the same median
 * function the code under test uses proves nothing; these assert against numbers a
 * reader can verify with arithmetic.
 *
 * This is also where the SQL implementation is checked against the reference
 * implementation in @salary/shared — if PERCENTILE_CONT and percentileFromSorted
 * ever disagree, one of them is wrong, and that is worth catching.
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { median, percentile } from '@salary/shared';
import {
  resetDatabase,
  seedReferenceData,
  createTestEmployee,
  resetEmployeeCounter,
  disconnect,
  date,
} from '../helpers/database.js';
import {
  getOverview,
  getBreakdown,
  getPayGapReport,
  getPayOutliers,
  type AnalyticsFilters,
} from '../../src/services/analytics.service.js';

let engineeringId: string;
let salesId: string;

beforeEach(async () => {
  await resetDatabase();
  resetEmployeeCounter();
  ({ engineeringId, salesId } = await seedReferenceData());
});

afterAll(disconnect);

const ALL: AnalyticsFilters = { activeOnly: true };

/** Create several USD employees at given salaries in one department. */
async function createCohort(
  departmentId: string,
  salaries: readonly number[],
  overrides: Partial<Parameters<typeof createTestEmployee>[0]> = {},
) {
  for (const salary of salaries) {
    await createTestEmployee({ departmentId, salary, salaryUsd: salary, ...overrides });
  }
}

describe('getOverview', () => {
  it('computes headcount, total cost and the distribution', async () => {
    // Five salaries, chosen so every statistic is checkable by hand.
    await createCohort(engineeringId, [50_000, 60_000, 70_000, 80_000, 240_000]);

    const overview = await getOverview(ALL);

    expect(overview.headcount).toBe(5);
    expect(overview.totalAnnualCostUsd).toBe(500_000);
    // Median is the middle value; the mean is dragged up by the single 240k.
    expect(overview.medianSalaryUsd).toBe(70_000);
    expect(overview.meanSalaryUsd).toBe(100_000);
    expect(overview.minSalaryUsd).toBe(50_000);
    expect(overview.maxSalaryUsd).toBe(240_000);
  });

  it('reports a median that matches the shared reference implementation', async () => {
    // An even-sized set, where PERCENTILE_CONT interpolates between the two middle
    // values rather than picking one of them.
    const salaries = [42_000, 55_500, 61_250, 78_900, 90_100, 143_750];
    await createCohort(engineeringId, salaries);

    const overview = await getOverview(ALL);

    expect(overview.medianSalaryUsd).toBeCloseTo(median(salaries), 2);
    expect(overview.p25SalaryUsd).toBeCloseTo(percentile(salaries, 0.25), 2);
    expect(overview.p75SalaryUsd).toBeCloseTo(percentile(salaries, 0.75), 2);
    expect(overview.p90SalaryUsd).toBeCloseTo(percentile(salaries, 0.9), 2);
  });

  it('excludes terminated employees by default', async () => {
    // Leavers on the books would inflate both headcount and payroll cost.
    await createCohort(engineeringId, [100_000, 100_000]);
    await createTestEmployee({
      departmentId: engineeringId,
      salary: 500_000,
      salaryUsd: 500_000,
      status: 'TERMINATED',
    });

    const activeOnly = await getOverview({ activeOnly: true });
    expect(activeOnly.headcount).toBe(2);
    expect(activeOnly.totalAnnualCostUsd).toBe(200_000);

    const everyone = await getOverview({ activeOnly: false });
    expect(everyone.headcount).toBe(3);
  });

  it('returns zeroes rather than nulls for an empty result set', async () => {
    // A filter matching nobody is a normal user action, not an error. Nulls here
    // would surface as "NaN" or a crash in the dashboard.
    const overview = await getOverview({ ...ALL, countryCode: 'IN' });

    expect(overview.headcount).toBe(0);
    expect(overview.totalAnnualCostUsd).toBe(0);
    expect(overview.medianSalaryUsd).toBe(0);
  });

  it('compares employees across currencies using the normalised USD amount', async () => {
    // 8,320,000 INR is exactly 100,000 USD at the fixed 83.2 rate. The Indian
    // employee must count the same as the US one in the payroll total.
    await createTestEmployee({
      departmentId: engineeringId,
      salary: 100_000,
      salaryUsd: 100_000,
    });
    await createTestEmployee({
      departmentId: engineeringId,
      countryCode: 'IN',
      salary: 8_320_000,
      currency: 'INR',
      salaryUsd: 100_000,
    });

    const overview = await getOverview(ALL);

    expect(overview.totalAnnualCostUsd).toBe(200_000);
    expect(overview.medianSalaryUsd).toBe(100_000);
  });
});

describe('getBreakdown', () => {
  it('groups by department with cost share summing to 100%', async () => {
    await createCohort(engineeringId, [100_000, 140_000]); // 240k total
    await createCohort(salesId, [80_000]); //                  80k total

    const groups = await getBreakdown('department', ALL);

    expect(groups).toHaveLength(2);
    // Ordered by total cost descending, so the biggest line item is first.
    expect(groups[0]!.label).toBe('Engineering');
    expect(groups[0]!.totalAnnualCostUsd).toBe(240_000);
    expect(groups[0]!.medianSalaryUsd).toBe(120_000);
    expect(groups[0]!.costSharePercent).toBe(75);
    expect(groups[1]!.costSharePercent).toBe(25);

    const shareTotal = groups.reduce((sum, g) => sum + g.costSharePercent, 0);
    expect(shareTotal).toBeCloseTo(100, 2);
  });

  it('groups by country', async () => {
    await createCohort(engineeringId, [100_000, 120_000]);
    await createTestEmployee({
      departmentId: engineeringId,
      countryCode: 'IN',
      salary: 2_496_000,
      currency: 'INR',
      salaryUsd: 30_000,
    });

    const groups = await getBreakdown('country', ALL);
    const india = groups.find((g) => g.key === 'IN');

    expect(groups).toHaveLength(2);
    expect(india?.headcount).toBe(1);
    expect(india?.totalAnnualCostUsd).toBe(30_000);
  });

  it('applies filters before grouping', async () => {
    await createCohort(engineeringId, [100_000], { level: 'L3' });
    await createCohort(engineeringId, [200_000], { level: 'L6' });

    const groups = await getBreakdown('department', { ...ALL, level: 'L6' });

    expect(groups).toHaveLength(1);
    expect(groups[0]!.headcount).toBe(1);
    expect(groups[0]!.totalAnnualCostUsd).toBe(200_000);
  });
});

describe('getPayGapReport', () => {
  it('computes a median gap where women are paid less', async () => {
    // Six men at a 100k median, six women at a 90k median: a 10% gap.
    await createCohort(engineeringId, [90_000, 100_000, 100_000, 100_000, 100_000, 110_000], {
      gender: 'MALE',
    });
    await createCohort(engineeringId, [80_000, 90_000, 90_000, 90_000, 90_000, 100_000], {
      gender: 'FEMALE',
    });

    const report = await getPayGapReport('department', ALL);

    expect(report.rows).toHaveLength(1);
    const row = report.rows[0]!;
    expect(row.suppressed).toBe(false);
    expect(row.maleCount).toBe(6);
    expect(row.femaleCount).toBe(6);
    expect(row.maleMedianUsd).toBe(100_000);
    expect(row.femaleMedianUsd).toBe(90_000);
    // (100000 - 90000) / 100000 = 10%. Positive means women are paid less.
    expect(row.medianGapPercent).toBe(10);
  });

  it('reports a negative gap when women are paid more', async () => {
    await createCohort(engineeringId, [90_000, 90_000, 90_000, 90_000, 90_000], { gender: 'MALE' });
    await createCohort(engineeringId, [99_000, 99_000, 99_000, 99_000, 99_000], {
      gender: 'FEMALE',
    });

    const report = await getPayGapReport('department', ALL);

    expect(report.rows[0]!.medianGapPercent).toBe(-10);
  });

  it('suppresses a group below the minimum size, medians included', async () => {
    // Four women is under the threshold of five. Publishing the median of a group
    // that small would let a reader infer individual salaries.
    await createCohort(engineeringId, [100_000, 100_000, 100_000, 100_000, 100_000], {
      gender: 'MALE',
    });
    await createCohort(engineeringId, [70_000, 70_000, 70_000, 70_000], { gender: 'FEMALE' });

    const report = await getPayGapReport('department', ALL);
    const row = report.rows[0]!;

    expect(row.suppressed).toBe(true);
    expect(row.medianGapPercent).toBeNull();
    // The medians must be withheld too, or suppression achieves nothing.
    expect(row.maleMedianUsd).toBeNull();
    expect(row.femaleMedianUsd).toBeNull();
    // Counts are still reported, so the user can see why it was suppressed.
    expect(row.femaleCount).toBe(4);
  });

  it('reports gender coverage so a partial gap is not read as universal', async () => {
    await createCohort(engineeringId, [100_000, 100_000, 100_000, 100_000, 100_000], {
      gender: 'MALE',
    });
    await createCohort(engineeringId, [90_000, 90_000, 90_000, 90_000, 90_000], {
      gender: 'FEMALE',
    });
    await createCohort(engineeringId, [95_000, 95_000, 95_000, 95_000, 95_000], {
      gender: 'UNDISCLOSED',
    });

    const report = await getPayGapReport('department', ALL);

    // 10 of 15 employees have a recorded MALE/FEMALE gender.
    expect(report.coveragePercent).toBeCloseTo(66.67, 1);
  });

  it('separates the gap by level, which is where composition effects show up', async () => {
    // A raw org-wide gap can be produced entirely by seniority distribution rather
    // than by unequal pay for equal work. Grouping by level starts to tell those
    // apart: here pay is equal within each level, so every level gap is zero.
    await createCohort(engineeringId, Array(5).fill(80_000), { gender: 'MALE', level: 'L2' });
    await createCohort(engineeringId, Array(5).fill(80_000), { gender: 'FEMALE', level: 'L2' });
    await createCohort(engineeringId, Array(5).fill(200_000), { gender: 'MALE', level: 'L7' });
    await createCohort(engineeringId, Array(5).fill(200_000), { gender: 'FEMALE', level: 'L7' });

    const report = await getPayGapReport('level', ALL);

    expect(report.rows).toHaveLength(2);
    for (const row of report.rows) {
      expect(row.medianGapPercent).toBe(0);
    }
  });
});

describe('getPayOutliers', () => {
  const options = {
    thresholdPercent: 20,
    direction: 'below' as const,
    minBandSize: 5,
    limit: 50,
  };

  it('flags someone paid well below their level-and-country band median', async () => {
    // Five peers at 100k give a band median of 100k. One person at 70k is 30%
    // below, past the 20% threshold.
    await createCohort(engineeringId, Array(5).fill(100_000), { level: 'L3' });
    await createTestEmployee({
      departmentId: engineeringId,
      level: 'L3',
      salary: 70_000,
      salaryUsd: 70_000,
      firstName: 'Underpaid',
      lastName: 'Person',
    });

    const outliers = await getPayOutliers(ALL, options);

    expect(outliers).toHaveLength(1);
    expect(outliers[0]!.name).toBe('Underpaid Person');
    expect(outliers[0]!.direction).toBe('below');
    expect(outliers[0]!.deviationPercent).toBe(-30);
    expect(outliers[0]!.bandMedianUsd).toBe(100_000);
  });

  it('does not flag someone inside the threshold', async () => {
    await createCohort(engineeringId, Array(5).fill(100_000), { level: 'L3' });
    // 15% below is within tolerance; flagging it would bury the real findings.
    await createTestEmployee({
      departmentId: engineeringId,
      level: 'L3',
      salary: 85_000,
      salaryUsd: 85_000,
    });

    expect(await getPayOutliers(ALL, options)).toHaveLength(0);
  });

  it('skips bands smaller than the minimum, where a median is meaningless', async () => {
    // Three people do not make a band. A "median" across them would generate a
    // confident-looking finding from nothing.
    await createCohort(engineeringId, [100_000, 100_000], { level: 'L5' });
    await createTestEmployee({
      departmentId: engineeringId,
      level: 'L5',
      salary: 40_000,
      salaryUsd: 40_000,
    });

    expect(await getPayOutliers(ALL, options)).toHaveLength(0);
  });

  it('bands by country, so a lower-cost market is not flagged wholesale', async () => {
    // Without country in the band key, every Indian employee would appear
    // underpaid against a US-weighted median - noise, not a finding.
    await createCohort(engineeringId, Array(5).fill(100_000), { level: 'L3' });
    await createCohort(engineeringId, Array(5).fill(30_000), {
      level: 'L3',
      countryCode: 'IN',
      currency: 'INR',
    });

    expect(await getPayOutliers(ALL, options)).toHaveLength(0);
  });

  it('finds overpay outliers when asked for direction above', async () => {
    await createCohort(engineeringId, Array(5).fill(100_000), { level: 'L3' });
    await createTestEmployee({
      departmentId: engineeringId,
      level: 'L3',
      salary: 150_000,
      salaryUsd: 150_000,
    });

    const outliers = await getPayOutliers(ALL, { ...options, direction: 'above' });

    expect(outliers).toHaveLength(1);
    expect(outliers[0]!.direction).toBe('above');
    expect(outliers[0]!.deviationPercent).toBe(50);
  });

  it('orders by the size of the deviation, so the worst case is first', async () => {
    await createCohort(engineeringId, Array(5).fill(100_000), { level: 'L3' });
    await createTestEmployee({
      departmentId: engineeringId, level: 'L3', salary: 75_000, salaryUsd: 75_000,
      firstName: 'Mildly', lastName: 'Under',
    });
    await createTestEmployee({
      departmentId: engineeringId, level: 'L3', salary: 40_000, salaryUsd: 40_000,
      firstName: 'Badly', lastName: 'Under',
    });

    const outliers = await getPayOutliers(ALL, options);

    expect(outliers.map((o) => o.name)).toEqual(['Badly Under', 'Mildly Under']);
  });
});
