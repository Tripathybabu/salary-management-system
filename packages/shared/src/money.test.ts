import { describe, it, expect } from 'vitest';
import {
  toMinorUnits,
  fromMinorUnits,
  convertToBaseCurrency,
  convertFromBaseCurrency,
  formatMoney,
  percentageChange,
  isCurrencyCode,
  getRatePerUsd,
  BASE_CURRENCY,
} from './money.js';

describe('toMinorUnits', () => {
  it('converts major units to integer minor units', () => {
    expect(toMinorUnits(123.45, 'USD')).toBe(12345);
    expect(toMinorUnits(0, 'USD')).toBe(0);
  });

  it('handles currencies with no minor unit', () => {
    // JPY has 0 decimals — multiplying by 100 would be wrong by two orders of magnitude.
    expect(toMinorUnits(5000, 'JPY')).toBe(5000);
  });

  it('rounds rather than truncates float multiplication error', () => {
    // These all land fractionally under their target when multiplied by 100 in
    // IEEE-754 (19.99 * 100 === 1998.9999999999998). Truncating would make every
    // one of them a cent short — across 10,000 salaries that is a visible error in
    // total payroll cost.
    // Every value here is verified to be inexact under `* 100` — each one would come
    // out a cent short if the implementation truncated instead of rounding.
    expect(19.99 * 100).not.toBe(1999); // guards the premise of this test
    expect(toMinorUnits(19.99, 'USD')).toBe(1999);

    expect(40000.02 * 100).not.toBe(4000002);
    expect(toMinorUnits(40000.02, 'USD')).toBe(4000002);

    expect(40000.45 * 100).not.toBe(4000045);
    expect(toMinorUnits(40000.45, 'USD')).toBe(4000045);
  });

  it('rounds down when the literal is already below the halfway point', () => {
    // Documents a genuine limit rather than hiding it: the double nearest to 1.005
    // is 1.00499999999999989, so this rounds to 100 and no amount of rounding
    // strategy in our code can recover the "intended" 1.005.
    //
    // This is why money crosses our boundaries as integer minor units wherever
    // possible, and why the DB column is DECIMAL rather than DOUBLE PRECISION. A
    // float is only ever an approximation of the operator's typed input.
    expect(toMinorUnits(1.005, 'USD')).toBe(100);
  });

  it('rounds half away from zero, symmetrically for negatives', () => {
    expect(toMinorUnits(0.125, 'USD')).toBe(13);
    expect(toMinorUnits(-0.125, 'USD')).toBe(-13);
  });

  it('rejects non-finite input rather than producing NaN downstream', () => {
    expect(() => toMinorUnits(NaN, 'USD')).toThrow(RangeError);
    expect(() => toMinorUnits(Infinity, 'USD')).toThrow(RangeError);
  });
});

describe('fromMinorUnits', () => {
  it('round-trips with toMinorUnits', () => {
    for (const amount of [0, 1, 99.99, 150000, 1234567.89]) {
      expect(fromMinorUnits(toMinorUnits(amount, 'USD'), 'USD')).toBe(amount);
    }
  });

  it('respects zero-decimal currencies', () => {
    expect(fromMinorUnits(5000, 'JPY')).toBe(5000);
  });

  it('rejects non-integer minor units, which signal a bug upstream', () => {
    expect(() => fromMinorUnits(12.5, 'USD')).toThrow(RangeError);
  });
});

describe('convertToBaseCurrency', () => {
  it('is identity-valued for the base currency itself', () => {
    expect(convertToBaseCurrency(1000, BASE_CURRENCY)).toBe(1000);
  });

  it('divides by the rate to reach USD', () => {
    // 83.2 INR per USD
    expect(convertToBaseCurrency(83200, 'INR')).toBe(1000);
    expect(convertToBaseCurrency(920, 'EUR')).toBe(1000);
  });

  it('converts zero-decimal currencies correctly', () => {
    // 149 JPY per USD
    expect(convertToBaseCurrency(14900, 'JPY')).toBe(100);
  });

  it('always returns at most 2 decimal places', () => {
    const result = convertToBaseCurrency(12345.67, 'INR');
    expect(Number.isInteger(Math.round(result * 100))).toBe(true);
    expect(result).toBe(Math.round(result * 100) / 100);
  });

  it('handles a realistic salary without drift', () => {
    // A Bangalore salary of ₹2,500,000 at 83.2 is $30,048.08.
    expect(convertToBaseCurrency(2_500_000, 'INR')).toBeCloseTo(30048.08, 2);
  });

  it('rejects non-finite input', () => {
    expect(() => convertToBaseCurrency(NaN, 'EUR')).toThrow(RangeError);
  });
});

describe('convertFromBaseCurrency', () => {
  it('inverts convertToBaseCurrency within rounding tolerance', () => {
    // Exact round-tripping is impossible — each direction rounds to minor units —
    // so the assertion is that error stays sub-cent-scale, not that it is zero.
    for (const currency of ['EUR', 'INR', 'GBP', 'JPY'] as const) {
      const originalUsd = 75000;
      const local = convertFromBaseCurrency(originalUsd, currency);
      const backToUsd = convertToBaseCurrency(local, currency);
      expect(backToUsd).toBeCloseTo(originalUsd, 1);
    }
  });

  it('multiplies by the rate to leave USD', () => {
    expect(convertFromBaseCurrency(1000, 'INR')).toBe(83200);
    expect(convertFromBaseCurrency(1000, 'EUR')).toBe(920);
  });
});

describe('isCurrencyCode', () => {
  it('accepts supported codes and rejects everything else', () => {
    expect(isCurrencyCode('USD')).toBe(true);
    expect(isCurrencyCode('INR')).toBe(true);
    expect(isCurrencyCode('XYZ')).toBe(false);
    expect(isCurrencyCode('usd')).toBe(false);
  });

  it('is not fooled by inherited Object properties', () => {
    // A naive `code in CURRENCIES` check would return true for these.
    expect(isCurrencyCode('toString')).toBe(false);
    expect(isCurrencyCode('constructor')).toBe(false);
  });
});

describe('getRatePerUsd', () => {
  it('returns 1 for the base currency', () => {
    expect(getRatePerUsd('USD')).toBe(1);
  });
});

describe('formatMoney', () => {
  it('renders the currency symbol and decimals', () => {
    expect(formatMoney(1234.5, 'USD')).toBe('$1,234.50');
  });

  it('omits decimals for zero-decimal currencies', () => {
    expect(formatMoney(5000, 'JPY')).toBe('¥5,000');
  });

  it('supports compact notation for dashboard tiles', () => {
    expect(formatMoney(1_500_000, 'USD', { compact: true })).toBe('$1.5M');
  });
});

describe('percentageChange', () => {
  it('computes a raise as a positive percentage', () => {
    expect(percentageChange(100000, 110000)).toBe(10);
  });

  it('computes a decrease as negative', () => {
    expect(percentageChange(100000, 90000)).toBe(-10);
  });

  it('returns null when the previous value is zero', () => {
    // Undefined mathematically; reporting Infinity% or 100% would both mislead.
    expect(percentageChange(0, 50000)).toBeNull();
  });

  it('rounds to two decimal places', () => {
    expect(percentageChange(3, 4)).toBe(33.33);
  });

  it('returns zero when nothing changed', () => {
    expect(percentageChange(85000, 85000)).toBe(0);
  });
});
