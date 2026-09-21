/**
 * Base UI primitives.
 *
 * A small hand-rolled set rather than a component library. The app needs perhaps
 * eight primitives; pulling in a full library to get them would add a dependency
 * and a styling system for no benefit at this size. Each one here is a few lines
 * and does exactly what this app needs.
 */

import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import type { ReactNode, ButtonHTMLAttributes, InputHTMLAttributes, SelectHTMLAttributes } from 'react';

/** Merge Tailwind classes, letting a caller's class override a default. */
export function cn(...inputs: Parameters<typeof clsx>): string {
  return twMerge(clsx(inputs));
}

export function Card({
  children,
  className,
  id,
}: {
  children: ReactNode;
  className?: string;
  /** Allows a card to be an anchor target, e.g. the dashboard's link to #outliers. */
  id?: string;
}) {
  return (
    <div
      id={id}
      className={cn(
        'rounded-xl border border-border bg-surface-raised shadow-sm',
        className,
      )}
    >
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
      <div>
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
        {description ? (
          <p className="mt-0.5 text-xs text-ink-muted">{description}</p>
        ) : null}
      </div>
      {action}
    </div>
  );
}

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-brand text-white hover:opacity-90',
  secondary: 'border border-border bg-surface-raised text-ink hover:bg-surface',
  ghost: 'text-ink-muted hover:bg-surface hover:text-ink',
  danger: 'bg-negative text-white hover:opacity-90',
};

export function Button({
  variant = 'primary',
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition',
        // Disabled state must be visible as well as non-interactive.
        'disabled:cursor-not-allowed disabled:opacity-50',
        BUTTON_VARIANTS[variant],
        className,
      )}
      {...props}
    />
  );
}

export function Input({
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        'w-full rounded-lg border border-border bg-surface-raised px-3 py-2 text-sm text-ink',
        'placeholder:text-ink-muted focus:border-brand focus:outline-none',
        className,
      )}
      {...props}
    />
  );
}

export function Select({
  className,
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        'w-full rounded-lg border border-border bg-surface-raised px-3 py-2 text-sm text-ink',
        'focus:border-brand focus:outline-none',
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
}

export function Field({
  label,
  error,
  children,
  hint,
}: {
  label: string;
  error?: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-ink">{label}</span>
      {children}
      {/* role=alert so a screen reader announces a validation failure. */}
      {error ? (
        <span role="alert" className="mt-1 block text-xs text-negative">
          {error}
        </span>
      ) : hint ? (
        <span className="mt-1 block text-xs text-ink-muted">{hint}</span>
      ) : null}
    </label>
  );
}

type BadgeTone = 'neutral' | 'positive' | 'negative' | 'warning' | 'brand';

const BADGE_TONES: Record<BadgeTone, string> = {
  neutral: 'bg-surface text-ink-muted border-border',
  positive: 'bg-positive/10 text-positive border-positive/20',
  negative: 'bg-negative/10 text-negative border-negative/20',
  warning: 'bg-warning/10 text-warning border-warning/20',
  brand: 'bg-brand/10 text-brand border-brand/20',
};

export function Badge({
  tone = 'neutral',
  children,
}: {
  tone?: BadgeTone;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium',
        BADGE_TONES[tone],
      )}
    >
      {children}
    </span>
  );
}

/** Map employment status to a colour, so the list scans without reading. */
export function statusTone(status: string): BadgeTone {
  if (status === 'ACTIVE') return 'positive';
  if (status === 'TERMINATED') return 'negative';
  return 'warning';
}

/**
 * Skeleton placeholder.
 *
 * Preferred over a spinner because it reserves the final layout, so content does
 * not jump when it arrives.
 */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded bg-border/60', className)} />;
}

/**
 * Empty state.
 *
 * Always says what to do next. "No results" alone leaves the user stuck; telling
 * them to clear a filter gives them the action.
 */
export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <p className="text-sm font-medium text-ink">{title}</p>
      <p className="mt-1 max-w-sm text-sm text-ink-muted">{description}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <p className="text-sm font-medium text-negative">Something went wrong</p>
      <p className="mt-1 max-w-md text-sm text-ink-muted">{message}</p>
      {onRetry ? (
        <Button variant="secondary" className="mt-4" onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}
