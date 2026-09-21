/**
 * Money handling.
 *
 * Rule 1: never use floating point for currency. `0.1 + 0.2 !== 0.3` is a rounding
 * curiosity in most software and a payroll defect here. All arithmetic happens on
 * integer minor units (cents, paise, yen).
 *
 * Rule 2: conversion rates are fixed and versioned, not live. Analytics must be
 * reproducible — a report that returns different numbers tomorrow because an FX API
 * moved is a bug. See docs/ARCHITECTURE.md §3.
 */

export type CurrencyCode = keyof typeof CURRENCIES;

interface CurrencyMeta {
  /** Decimal places in the currency's minor unit. JPY has 0, USD has 2. */
  readonly decimals: number;
  readonly symbol: string;
  readonly name: string;
}

export const CURRENCIES = {
  USD: { decimals: 2, symbol: '$', name: 'US Dollar' },
  EUR: { decimals: 2, symbol: '€', name: 'Euro' },
  GBP: { decimals: 2, symbol: '£', name: 'British Pound' },
  INR: { decimals: 2, symbol: '₹', name: 'Indian Rupee' },
  SGD: { decimals: 2, symbol: 'S$', name: 'Singapore Dollar' },
  AUD: { decimals: 2, symbol: 'A$', name: 'Australian Dollar' },
  CAD: { decimals: 2, symbol: 'C$', name: 'Canadian Dollar' },
  BRL: { decimals: 2, symbol: 'R$', name: 'Brazilian Real' },
  ZAR: { decimals: 2, symbol: 'R', name: 'South African Rand' },
  PLN: { decimals: 2, symbol: 'zł', name: 'Polish Zloty' },
  // JPY is included deliberately: it has zero minor units, which catches any code
  // that assumes "multiply by 100" is universally correct.
  JPY: { decimals: 0, symbol: '¥', name: 'Japanese Yen' },
} as const satisfies Record<string, CurrencyMeta>;

export const BASE_CURRENCY: CurrencyCode = 'USD';

/**
 * Units of `currency` per 1 USD, as of the rate-table version below.
 *
 * Fixed on purpose. Swapping in a live feed means replacing this table and adding a
 * `rateVersion` column to SalaryRecord so historical rows keep the rate they were
 * written with.
 */
export const FX_RATE_VERSION = '2026-01-01';

const RATES_PER_USD: Record<CurrencyCode, number> = {
  USD: 1,
  EUR: 0.92,
  GBP: 0.79,
  INR: 83.2,
  SGD: 1.34,
  AUD: 1.52,
  CAD: 1.36,
  BRL: 4.97,
  ZAR: 18.6,
  PLN: 4.02,
  JPY: 149,
};

export function isCurrencyCode(value: string): value is CurrencyCode {
  return Object.prototype.hasOwnProperty.call(CURRENCIES, value);
}

export function getCurrencyMeta(currency: CurrencyCode): CurrencyMeta {
  return CURRENCIES[currency];
}

/** 10 ** decimals — how many minor units make one major unit. */
function minorUnitFactor(currency: CurrencyCode): number {
  return 10 ** CURRENCIES[currency].decimals;
}

/**
 * Round half away from zero, which is what finance expects.
 *
 * `Math.round` rounds half *up* (toward +Infinity), so `Math.round(-0.5)` is `-0`.
 * For a negative salary adjustment that asymmetry is wrong, so we round the magnitude
 * and reapply the sign.
 */
function roundHalfAwayFromZero(value: number): number {
  return value < 0 ? -Math.round(-value) : Math.round(value);
}

/**
 * Convert a major-unit amount (12345.67) to integer minor units (1234567).
 *
 * Multiplying by 100 in floating point can land just under the target —
 * `19.99 * 100` is `1998.9999999999998` — so the result is rounded, not truncated.
 */
export function toMinorUnits(amount: number, currency: CurrencyCode): number {
  if (!Number.isFinite(amount)) {
    throw new RangeError(`Cannot convert non-finite amount: ${amount}`);
  }
  return roundHalfAwayFromZero(amount * minorUnitFactor(currency));
}

/** Convert integer minor units back to a major-unit number. */
export function fromMinorUnits(minor: number, currency: CurrencyCode): number {
  if (!Number.isInteger(minor)) {
    throw new RangeError(`Minor units must be an integer, received: ${minor}`);
  }
  return minor / minorUnitFactor(currency);
}

/**
 * Convert an amount to the base currency (USD).
 *
 * Works in minor units throughout and rounds once, at the end. Converting via
 * major-unit floats would accumulate error across 10,000 employees.
 */
export function convertToBaseCurrency(amount: number, from: CurrencyCode): number {
  if (!Number.isFinite(amount)) {
    throw new RangeError(`Cannot convert non-finite amount: ${amount}`);
  }
  if (from === BASE_CURRENCY) {
    // Still normalise through minor units so USD takes the same rounding path as
    // every other currency — no special-case drift.
    return fromMinorUnits(toMinorUnits(amount, from), BASE_CURRENCY);
  }

  const rate = RATES_PER_USD[from];
  const sourceMinor = toMinorUnits(amount, from);
  const sourceMajor = sourceMinor / minorUnitFactor(from);
  const baseMinor = roundHalfAwayFromZero(
    (sourceMajor / rate) * minorUnitFactor(BASE_CURRENCY),
  );

  return fromMinorUnits(baseMinor, BASE_CURRENCY);
}

/** Convert from the base currency into a target currency. */
export function convertFromBaseCurrency(amountUsd: number, to: CurrencyCode): number {
  if (!Number.isFinite(amountUsd)) {
    throw new RangeError(`Cannot convert non-finite amount: ${amountUsd}`);
  }
  if (to === BASE_CURRENCY) {
    return fromMinorUnits(toMinorUnits(amountUsd, to), BASE_CURRENCY);
  }

  const rate = RATES_PER_USD[to];
  const targetMinor = roundHalfAwayFromZero(
    amountUsd * rate * minorUnitFactor(to),
  );

  return fromMinorUnits(targetMinor, to);
}

export function getRatePerUsd(currency: CurrencyCode): number {
  return RATES_PER_USD[currency];
}

/**
 * Format for display. Uses Intl so locale conventions (₹12,34,567 in India,
 * 1.234.567 € in Germany) are handled by the platform rather than reinvented.
 */
export function formatMoney(
  amount: number,
  currency: CurrencyCode,
  options: { compact?: boolean; locale?: string } = {},
): string {
  const { compact = false, locale = 'en-US' } = options;
  const { decimals } = CURRENCIES[currency];

  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    notation: compact ? 'compact' : 'standard',
    maximumFractionDigits: compact ? 1 : decimals,
    minimumFractionDigits: compact ? 0 : decimals,
  }).format(amount);
}

/**
 * Percentage change from `previous` to `current`, rounded to two decimals.
 *
 * Returns null when `previous` is 0 — the change is mathematically undefined and
 * reporting "Infinity%" or "100%" in a raise history would both be lies.
 */
export function percentageChange(previous: number, current: number): number | null {
  if (previous === 0) return null;
  return Math.round(((current - previous) / Math.abs(previous)) * 10000) / 100;
}
