/**
 * Display formatting.
 *
 * These are pure functions with no I/O, so they are exhaustive on the cases that
 * actually bite: zero-decimal currencies, the sign on a percentage, and the
 * timezone handling on calendar dates.
 */

import { describe, it, expect } from 'vitest';
import {
  formatUsd,
  formatUsdWhole,
  formatLocal,
  formatPercent,
  formatShare,
  formatDate,
  formatPeriod,
  formatNumber,
  humanise,
  initials,
} from '@/lib/format';

describe('formatUsd', () => {
  it('switches to compact notation above a million', () => {
    // "$717.3M" is readable at a glance in a dashboard tile; the full figure is
    // not, and the precision is noise in a headline number.
    expect(formatUsd(717_283_577)).toBe('$717.3M');
    expect(formatUsd(1_500_000)).toBe('$1.5M');
  });

  it('keeps full precision below a million', () => {
    expect(formatUsd(95_000)).toBe('$95,000.00');
  });

  it('honours an explicit compact override', () => {
    expect(formatUsd(95_000, { compact: true })).toBe('$95K');
  });
});

describe('formatUsdWhole', () => {
  it('drops decimals for table cells', () => {
    expect(formatUsdWhole(62_621.76)).toBe('$62,622');
  });
});

describe('formatLocal', () => {
  it('formats in the employee own currency', () => {
    expect(formatLocal(1_537_000, 'INR')).toContain('1,537,000');
  });

  it('respects a zero-decimal currency', () => {
    // JPY has no minor unit. Rendering "¥5,000,000.00" would be wrong.
    expect(formatLocal(5_000_000, 'JPY')).not.toContain('.00');
  });

  it('falls back to USD for an unrecognised code rather than throwing', () => {
    // Intl throws on an invalid currency code, which would blank an entire table
    // row over one bad value.
    expect(() => formatLocal(1000, 'XYZ')).not.toThrow();
  });
});

describe('formatPercent', () => {
  it('shows an explicit plus sign on an increase', () => {
    // The sign is the point: a bare "12%" does not say whether pay went up.
    expect(formatPercent(12)).toBe('+12.0%');
  });

  it('shows a minus sign on a decrease', () => {
    expect(formatPercent(-7.5)).toBe('-7.5%');
  });

  it('treats zero as unsigned', () => {
    expect(formatPercent(0)).toBe('0.0%');
  });
});

describe('formatShare', () => {
  it('omits the forced sign, since a share is never negative', () => {
    expect(formatShare(35.71)).toBe('35.7%');
  });
});

describe('formatDate', () => {
  it('renders a calendar date in UTC', () => {
    // Parsed as UTC deliberately: rendering in local time can shift the day
    // backwards for anyone west of UTC, so an effective date of the 1st would
    // display as the previous month.
    expect(formatDate('2025-03-01T00:00:00.000Z')).toBe('1 Mar 2025');
  });

  it('does not roll a month boundary backwards', () => {
    expect(formatDate('2026-01-01T00:00:00.000Z')).toBe('1 Jan 2026');
  });
});

describe('formatPeriod', () => {
  it('renders a YYYY-MM trend bucket', () => {
    expect(formatPeriod('2026-09')).toBe('Sept 2026');
  });

  it('returns the input unchanged when it is not a period', () => {
    expect(formatPeriod('nonsense')).toBe('nonsense');
  });
});

describe('formatNumber', () => {
  it('groups thousands', () => {
    expect(formatNumber(10_000)).toBe('10,000');
  });
});

describe('humanise', () => {
  it('turns an enum constant into a label', () => {
    expect(humanise('ON_LEAVE')).toBe('On leave');
    expect(humanise('MERIT_INCREASE')).toBe('Merit increase');
  });
});

describe('initials', () => {
  it('takes the first letter of each name, uppercased', () => {
    expect(initials('ada', 'lovelace')).toBe('AL');
  });
});
