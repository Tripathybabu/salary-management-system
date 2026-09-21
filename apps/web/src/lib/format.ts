/**
 * Display formatting.
 *
 * Presentation-only helpers. All money arithmetic lives in @salary/shared; these
 * functions render already-computed numbers and never do maths on currency.
 */

import { formatMoney, isCurrencyCode, type CurrencyCode } from '@salary/shared';

/**
 * Format a USD figure for a dashboard tile.
 *
 * Compact above a million, because "$717.3M" is readable at a glance where
 * "$717,283,577.49" is not — the precision is noise in a headline number.
 */
export function formatUsd(amount: number, options: { compact?: boolean } = {}): string {
  const compact = options.compact ?? Math.abs(amount) >= 1_000_000;
  return formatMoney(amount, 'USD', { compact });
}

/** Format an amount in the employee's own currency, falling back to USD. */
export function formatLocal(amount: number, currency: string): string {
  return isCurrencyCode(currency)
    ? formatMoney(amount, currency as CurrencyCode)
    : formatMoney(amount, 'USD');
}

/** Whole-number USD, for table cells where decimals add nothing. */
export function formatUsdWhole(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-US').format(value);
}

/**
 * Format a percentage with an explicit sign.
 *
 * The sign is the point: "+12%" and "-12%" mean opposite things on a raise, and a
 * bare "12%" is ambiguous.
 */
export function formatPercent(value: number, decimals = 1): string {
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(decimals)}%`;
}

/** Percentage without a forced sign, for shares and coverage figures. */
export function formatShare(value: number, decimals = 1): string {
  return `${value.toFixed(decimals)}%`;
}

/**
 * Format an ISO date for display.
 *
 * Parsed as UTC. These are calendar dates, and rendering them in local time can
 * shift the displayed day backwards for anyone west of UTC.
 */
export function formatDate(iso: string | Date): string {
  const date = typeof iso === 'string' ? new Date(iso) : iso;
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

/** "Mar 2025" for a YYYY-MM trend period. */
export function formatPeriod(period: string): string {
  const [year, month] = period.split('-');
  if (!year || !month) return period;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, 1));
  return new Intl.DateTimeFormat('en-GB', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

export function initials(firstName: string, lastName: string): string {
  return `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase();
}

/** Turn an enum constant into a human label: ON_LEAVE -> On leave. */
export function humanise(value: string): string {
  const lower = value.replace(/_/g, ' ').toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}
