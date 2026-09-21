import { describe, it, expect } from 'vitest';
import {
  percentile,
  percentileFromSorted,
  sortAscending,
  mean,
  median,
  summarise,
  calculatePayGap,
  classifyOutlier,
  compaRatio,
  MIN_GROUP_SIZE_FOR_REPORTING,
} from './statistics.js';

describe('sortAscending', () => {
  it('sorts numerically, not lexicographically', () => {
    // The default Array#sort would give [100000, 20000, 9000] here.
    expect(sortAscending([20000, 100000, 9000])).toEqual([9000, 20000, 100000]);
  });

  it('does not mutate its input', () => {
    const original = [3, 1, 2];
    sortAscending(original);
    expect(original).toEqual([3, 1, 2]);
  });
});

describe('percentile', () => {
  it('returns the single value for a one-element set', () => {
    expect(percentile([42], 0.5)).toBe(42);
    expect(percentile([42], 0)).toBe(42);
    expect(percentile([42], 1)).toBe(42);
  });

  it('returns exact min and max at the extremes', () => {
    const values = [10, 20, 30, 40, 50];
    expect(percentile(values, 0)).toBe(10);
    expect(percentile(values, 1)).toBe(50);
  });

  it('interpolates between data points, matching PERCENTILE_CONT', () => {
    // Position = 0.5 * (4-1) = 1.5 → midway between 20 and 30.
    expect(percentile([10, 20, 30, 40], 0.5)).toBe(25);
  });

  it('computes quartiles on a known dataset', () => {
    const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(percentile(values, 0.25)).toBeCloseTo(3.25, 10);
    expect(percentile(values, 0.5)).toBeCloseTo(5.5, 10);
    expect(percentile(values, 0.75)).toBeCloseTo(7.75, 10);
  });

  it('sorts unsorted input before computing', () => {
    expect(percentile([50, 10, 30, 20, 40], 0.5)).toBe(30);
  });

  it('throws on an empty dataset rather than returning NaN', () => {
    expect(() => percentile([], 0.5)).toThrow(RangeError);
  });

  it('rejects fractions outside [0, 1]', () => {
    expect(() => percentile([1, 2, 3], 1.5)).toThrow(RangeError);
    expect(() => percentile([1, 2, 3], -0.1)).toThrow(RangeError);
    expect(() => percentile([1, 2, 3], NaN)).toThrow(RangeError);
  });
});

describe('percentileFromSorted', () => {
  it('agrees with the sorting wrapper', () => {
    const sorted = [10, 20, 30, 40, 50];
    expect(percentileFromSorted(sorted, 0.75)).toBe(percentile(sorted, 0.75));
  });
});

describe('mean', () => {
  it('averages the values', () => {
    expect(mean([10, 20, 30])).toBe(20);
  });

  it('throws on an empty dataset', () => {
    expect(() => mean([])).toThrow(RangeError);
  });
});

describe('median', () => {
  it('returns the middle value for an odd-sized set', () => {
    expect(median([30, 10, 20])).toBe(20);
  });

  it('interpolates for an even-sized set', () => {
    expect(median([10, 20, 30, 40])).toBe(25);
  });

  it('resists the skew that distorts the mean', () => {
    // One founder-level salary among junior staff: the mean says 270k, which
    // describes nobody in this list. This is why the dashboard leads with median.
    const salaries = [50_000, 55_000, 60_000, 65_000, 1_120_000];
    expect(median(salaries)).toBe(60_000);
    expect(mean(salaries)).toBe(270_000);
  });
});

describe('summarise', () => {
  it('reports every statistic in one pass', () => {
    const result = summarise([10, 20, 30, 40, 50]);
    expect(result).toMatchObject({
      count: 5,
      min: 10,
      max: 50,
      mean: 30,
      median: 30,
      p50: 30,
    });
  });

  it('keeps median and p50 in agreement', () => {
    const result = summarise([15, 82, 33, 47, 91, 6]);
    expect(result.median).toBe(result.p50);
  });

  it('orders the percentiles monotonically', () => {
    const salaries = [45_000, 52_000, 61_000, 75_000, 88_000, 95_000, 130_000];
    const { p25, p50, p75, p90, min, max } = summarise(salaries);
    expect(min).toBeLessThanOrEqual(p25);
    expect(p25).toBeLessThanOrEqual(p50);
    expect(p50).toBeLessThanOrEqual(p75);
    expect(p75).toBeLessThanOrEqual(p90);
    expect(p90).toBeLessThanOrEqual(max);
  });

  it('throws on an empty dataset', () => {
    expect(() => summarise([])).toThrow(RangeError);
  });
});

describe('calculatePayGap', () => {
  const men = [100_000, 105_000, 110_000, 115_000, 120_000];
  const women = [90_000, 95_000, 100_000, 105_000, 110_000];

  it('reports a positive gap when the comparison group earns less', () => {
    const result = calculatePayGap(men, women);
    expect(result.suppressed).toBe(false);
    // Medians 110k vs 100k → 9.09% gap.
    expect(result.medianGapPercent).toBeCloseTo(9.09, 2);
  });

  it('reports a negative gap when the comparison group earns more', () => {
    const result = calculatePayGap(women, men);
    expect(result.medianGapPercent).toBeCloseTo(-10, 2);
  });

  it('reports zero when the groups are paid equally', () => {
    const result = calculatePayGap(men, [...men]);
    expect(result.medianGapPercent).toBe(0);
    expect(result.meanGapPercent).toBe(0);
  });

  it('suppresses the result when either group is too small', () => {
    // A gap computed across two people is noise, and it also exposes their salaries.
    const result = calculatePayGap(men, [90_000, 95_000]);
    expect(result.suppressed).toBe(true);
    expect(result.medianGapPercent).toBeNull();
    expect(result.comparisonMedian).toBeNull();
  });

  it('still reports the raw headcounts when suppressed', () => {
    // The user needs to know a group exists even when its statistic is withheld.
    const result = calculatePayGap(men, [90_000, 95_000]);
    expect(result.referenceCount).toBe(5);
    expect(result.comparisonCount).toBe(2);
  });

  it('reports at exactly the threshold size', () => {
    expect(men).toHaveLength(MIN_GROUP_SIZE_FOR_REPORTING);
    expect(calculatePayGap(men, women).suppressed).toBe(false);
  });

  it('suppresses empty groups instead of dividing by zero', () => {
    expect(calculatePayGap(men, []).suppressed).toBe(true);
    expect(calculatePayGap([], []).suppressed).toBe(true);
  });

  it('honours a custom minimum group size', () => {
    const result = calculatePayGap(men, [90_000, 95_000], 2);
    expect(result.suppressed).toBe(false);
  });
});

describe('classifyOutlier', () => {
  const bandMedian = 100_000;

  it('flags salaries meaningfully below the band', () => {
    const result = classifyOutlier(75_000, bandMedian);
    expect(result).toEqual({ direction: 'below', deviationPercent: -25 });
  });

  it('flags salaries meaningfully above the band', () => {
    const result = classifyOutlier(140_000, bandMedian);
    expect(result).toEqual({ direction: 'above', deviationPercent: 40 });
  });

  it('returns null inside the acceptable range', () => {
    expect(classifyOutlier(95_000, bandMedian)).toBeNull();
    expect(classifyOutlier(110_000, bandMedian)).toBeNull();
    expect(classifyOutlier(bandMedian, bandMedian)).toBeNull();
  });

  it('treats the threshold as inclusive on both sides', () => {
    // Exactly 20% below and exactly 30% above both count as outliers.
    expect(classifyOutlier(80_000, bandMedian)?.direction).toBe('below');
    expect(classifyOutlier(130_000, bandMedian)?.direction).toBe('above');
  });

  it('respects custom thresholds', () => {
    const strict = { belowMedian: 0.05, aboveMedian: 0.05 };
    expect(classifyOutlier(94_000, bandMedian, strict)?.direction).toBe('below');
  });

  it('returns null for a non-positive band median instead of dividing by zero', () => {
    expect(classifyOutlier(50_000, 0)).toBeNull();
    expect(classifyOutlier(50_000, -100)).toBeNull();
  });
});

describe('compaRatio', () => {
  it('returns 1 at the band midpoint', () => {
    expect(compaRatio(100_000, 100_000)).toBe(1);
  });

  it('returns below 1 for under-midpoint pay', () => {
    expect(compaRatio(80_000, 100_000)).toBe(0.8);
  });

  it('returns above 1 for over-midpoint pay', () => {
    expect(compaRatio(115_000, 100_000)).toBe(1.15);
  });

  it('returns null for a non-positive midpoint', () => {
    expect(compaRatio(50_000, 0)).toBeNull();
  });
});
