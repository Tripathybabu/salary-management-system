/**
 * Statistics for compensation analysis.
 *
 * Postgres computes percentiles for the dashboard aggregates (PERCENTILE_CONT, in SQL,
 * where the data already is). These functions exist for three other jobs:
 *
 *   1. Client-side summaries of an already-fetched page of rows.
 *   2. The pay-gap and outlier logic, which needs more care than a SQL expression.
 *   3. A reference implementation the SQL is tested against — if the two disagree,
 *      one of them is wrong, and that is worth knowing.
 */

export interface PercentileSet {
  p25: number;
  p50: number;
  p75: number;
  p90: number;
}

export interface DistributionSummary extends PercentileSet {
  count: number;
  min: number;
  max: number;
  mean: number;
  /** p50 restated, because "median" reads more clearly at call sites than "p50". */
  median: number;
}

/**
 * Linear-interpolation percentile, matching Postgres `PERCENTILE_CONT`.
 *
 * Deliberately the *continuous* variant: `PERCENTILE_DISC` would pick an actual data
 * point, which for an even-sized set means the median is one real person's salary
 * rather than the midpoint. Interpolating keeps the two implementations comparable
 * and avoids pointing at an individual.
 *
 * @param sorted Ascending-sorted values. Sorting is the caller's job so that
 *               computing several percentiles over one dataset sorts only once.
 */
export function percentileFromSorted(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) {
    throw new RangeError('Cannot compute a percentile of an empty dataset');
  }
  if (fraction < 0 || fraction > 1 || !Number.isFinite(fraction)) {
    throw new RangeError(`Percentile fraction must be between 0 and 1, received: ${fraction}`);
  }
  if (sorted.length === 1) return sorted[0]!;

  const position = fraction * (sorted.length - 1);
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);

  const lower = sorted[lowerIndex]!;
  if (lowerIndex === upperIndex) return lower;

  const upper = sorted[upperIndex]!;
  return lower + (upper - lower) * (position - lowerIndex);
}

/** Convenience wrapper that sorts a copy first. Prefer the sorted variant in hot paths. */
export function percentile(values: readonly number[], fraction: number): number {
  return percentileFromSorted(sortAscending(values), fraction);
}

/**
 * Sort a copy ascending.
 *
 * The explicit comparator matters: `Array.prototype.sort` defaults to *string*
 * comparison, which would order salaries as 100000 < 20000.
 */
export function sortAscending(values: readonly number[]): number[] {
  return [...values].sort((a, b) => a - b);
}

export function mean(values: readonly number[]): number {
  if (values.length === 0) {
    throw new RangeError('Cannot compute the mean of an empty dataset');
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function median(values: readonly number[]): number {
  return percentile(values, 0.5);
}

/** Full distribution summary in a single pass, sorting once. */
export function summarise(values: readonly number[]): DistributionSummary {
  if (values.length === 0) {
    throw new RangeError('Cannot summarise an empty dataset');
  }
  const sorted = sortAscending(values);
  const p50 = percentileFromSorted(sorted, 0.5);

  return {
    count: sorted.length,
    min: sorted[0]!,
    max: sorted[sorted.length - 1]!,
    mean: mean(sorted),
    median: p50,
    p25: percentileFromSorted(sorted, 0.25),
    p50,
    p75: percentileFromSorted(sorted, 0.75),
    p90: percentileFromSorted(sorted, 0.9),
  };
}

/**
 * Minimum group size before a statistic is reported.
 *
 * Two reasons, and the privacy one is the stronger:
 *   - Statistical: a "42% pay gap" across three people is noise.
 *   - Privacy: in a group of two, showing the median reveals both salaries.
 */
export const MIN_GROUP_SIZE_FOR_REPORTING = 5;

export interface PayGapResult {
  /**
   * Median gap as a percentage: how much less the comparison group earns than the
   * reference group. Positive means the comparison group earns less.
   *
   * Null when either group is below the reporting threshold.
   */
  medianGapPercent: number | null;
  meanGapPercent: number | null;
  referenceMedian: number | null;
  comparisonMedian: number | null;
  referenceCount: number;
  comparisonCount: number;
  /** True when the result was withheld for small sample size. */
  suppressed: boolean;
}

/**
 * Compare pay between two groups — typically men as reference, women as comparison,
 * which is the convention used by UK gender pay gap reporting.
 *
 * This reports a *raw* gap: the difference in median pay between two populations. It
 * is not an equal-pay-for-equal-work measure, and it is not evidence of discrimination
 * on its own — a gap can arise from role or seniority distribution. The UI must present
 * it with that caveat and with the headcounts attached.
 */
export function calculatePayGap(
  referenceGroup: readonly number[],
  comparisonGroup: readonly number[],
  minGroupSize: number = MIN_GROUP_SIZE_FOR_REPORTING,
): PayGapResult {
  const referenceCount = referenceGroup.length;
  const comparisonCount = comparisonGroup.length;

  if (referenceCount < minGroupSize || comparisonCount < minGroupSize) {
    return {
      medianGapPercent: null,
      meanGapPercent: null,
      referenceMedian: null,
      comparisonMedian: null,
      referenceCount,
      comparisonCount,
      suppressed: true,
    };
  }

  const referenceMedian = median(referenceGroup);
  const comparisonMedian = median(comparisonGroup);
  const referenceMean = mean(referenceGroup);
  const comparisonMean = mean(comparisonGroup);

  return {
    medianGapPercent: gapPercent(referenceMedian, comparisonMedian),
    meanGapPercent: gapPercent(referenceMean, comparisonMean),
    referenceMedian,
    comparisonMedian,
    referenceCount,
    comparisonCount,
    suppressed: false,
  };
}

/** (reference - comparison) / reference, as a percentage rounded to two decimals. */
function gapPercent(reference: number, comparison: number): number | null {
  if (reference === 0) return null;
  return Math.round(((reference - comparison) / reference) * 10000) / 100;
}

export interface OutlierThresholds {
  /** Fraction below the band median that flags someone as underpaid. 0.2 = 20% below. */
  belowMedian: number;
  /** Fraction above the band median that flags someone as an overpay outlier. */
  aboveMedian: number;
}

export const DEFAULT_OUTLIER_THRESHOLDS: OutlierThresholds = {
  belowMedian: 0.2,
  aboveMedian: 0.3,
};

export type OutlierDirection = 'below' | 'above';

/**
 * Classify a salary against its peer-band median.
 *
 * Compared against the *median* rather than the mean, for the reason in
 * docs/ARCHITECTURE.md §5: one very senior outlier drags a mean upward and would
 * make half the band look underpaid.
 *
 * Returns null when the salary sits inside the acceptable range.
 */
export function classifyOutlier(
  salary: number,
  bandMedian: number,
  thresholds: OutlierThresholds = DEFAULT_OUTLIER_THRESHOLDS,
): { direction: OutlierDirection; deviationPercent: number } | null {
  if (bandMedian <= 0) return null;

  const deviation = (salary - bandMedian) / bandMedian;
  const deviationPercent = Math.round(deviation * 10000) / 100;

  if (deviation <= -thresholds.belowMedian) {
    return { direction: 'below', deviationPercent };
  }
  if (deviation >= thresholds.aboveMedian) {
    return { direction: 'above', deviationPercent };
  }
  return null;
}

/**
 * Compa-ratio: salary as a proportion of the band midpoint, the standard compensation
 * metric. 1.0 means paid exactly at midpoint; 0.8 means 20% below.
 */
export function compaRatio(salary: number, bandMidpoint: number): number | null {
  if (bandMidpoint <= 0) return null;
  return Math.round((salary / bandMidpoint) * 10000) / 10000;
}
