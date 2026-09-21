'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import {
  SALARY_CHANGE_REASONS,
  SALARY_CHANGE_REASON_LABELS,
  CURRENCIES,
  percentageChange,
} from '@salary/shared';
import { recordSalaryChange, ApiError, type RecordSalaryBody } from '@/lib/api';
import { formatLocal, formatPercent } from '@/lib/format';
import { Button, Input, Select, Field, Badge } from './ui';

/**
 * Record a salary change.
 *
 * The design goal is that the user sees the consequence before they commit: the
 * percentage change is computed live as they type, so a fat-fingered extra zero
 * shows up as "+900%" rather than being discovered after the write.
 *
 * Server errors are mapped back onto the offending field where the API tells us
 * which one it was, rather than being shown as one message above the form.
 */
export function SalaryChangeDialog({
  employeeId,
  employeeName,
  currentCurrency,
  currentAmount,
  onClose,
}: {
  employeeId: string;
  employeeName: string;
  currentCurrency: string;
  currentAmount: number | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const dialogRef = useRef<HTMLDivElement>(null);

  const [amount, setAmount] = useState(currentAmount ? String(currentAmount) : '');
  const [currency, setCurrency] = useState(currentCurrency);
  const [effectiveFrom, setEffectiveFrom] = useState(() => todayIso());
  const [changeReason, setChangeReason] = useState<RecordSalaryBody['changeReason']>('MERIT_INCREASE');
  const [note, setNote] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // Escape closes the dialog — expected of any modal, and the only way out for
  // a keyboard user who has not tabbed to the Cancel button.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const mutation = useMutation({
    mutationFn: (body: RecordSalaryBody) => recordSalaryChange(employeeId, body),
    onSuccess: () => {
      // Everything derived from this employee's pay is now stale: their detail
      // page, their history, the directory listing, and every dashboard figure.
      void queryClient.invalidateQueries({ queryKey: ['employee', employeeId] });
      void queryClient.invalidateQueries({ queryKey: ['salary-history', employeeId] });
      void queryClient.invalidateQueries({ queryKey: ['employees'] });
      void queryClient.invalidateQueries({ queryKey: ['overview'] });
      void queryClient.invalidateQueries({ queryKey: ['breakdown'] });
      void queryClient.invalidateQueries({ queryKey: ['outliers'] });
      void queryClient.invalidateQueries({ queryKey: ['trend'] });
      onClose();
    },
    onError: (error) => {
      if (error instanceof ApiError && error.fieldErrors) {
        const mapped: Record<string, string> = {};
        for (const [field, messages] of Object.entries(error.fieldErrors)) {
          if (messages?.[0]) mapped[field] = messages[0];
        }
        setFieldErrors(mapped);
      }
    },
  });

  const parsedAmount = Number(amount);
  const amountIsValid = amount !== '' && Number.isFinite(parsedAmount) && parsedAmount > 0;

  // Only meaningful within one currency: across currencies the difference is
  // partly FX, and labelling that as a raise would be a false number.
  const livePercent =
    amountIsValid && currentAmount !== null && currency === currentCurrency
      ? percentageChange(currentAmount, parsedAmount)
      : null;

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setFieldErrors({});

    if (!amountIsValid) {
      setFieldErrors({ baseAmount: 'Enter an amount greater than zero' });
      return;
    }

    mutation.mutate({
      baseAmount: parsedAmount,
      currency,
      effectiveFrom,
      changeReason,
      note: note.trim() || undefined,
    });
  }

  const generalError =
    mutation.error instanceof ApiError && !mutation.error.fieldErrors
      ? mutation.error.message
      : null;

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="salary-dialog-title"
      // Clicking the backdrop closes; clicks inside must not bubble out to it.
      onMouseDown={(event) => {
        if (!dialogRef.current?.contains(event.target as Node)) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className="w-full max-w-lg rounded-xl border border-border bg-surface-raised shadow-xl"
      >
        <div className="border-b border-border px-5 py-4">
          <h2 id="salary-dialog-title" className="text-sm font-semibold text-ink">
            Record salary change
          </h2>
          <p className="mt-0.5 text-xs text-ink-muted">
            {employeeName}
            {currentAmount !== null
              ? ` · currently ${formatLocal(currentAmount, currentCurrency)}`
              : ''}
          </p>
        </div>

        <form onSubmit={submit} className="space-y-4 px-5 py-4">
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <Field label="New amount" error={fieldErrors.baseAmount}>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                  placeholder="120000"
                  autoFocus
                  required
                />
              </Field>
            </div>
            <Field label="Currency" error={fieldErrors.currency}>
              <Select value={currency} onChange={(event) => setCurrency(event.target.value)}>
                {Object.keys(CURRENCIES).map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          {/* Live feedback: the consequence of the number is visible before commit. */}
          {livePercent !== null ? (
            <div className="flex items-center gap-2 rounded-lg bg-surface px-3 py-2">
              <span className="text-xs text-ink-muted">Change from current:</span>
              <Badge tone={livePercent >= 0 ? 'positive' : 'negative'}>
                {formatPercent(livePercent)}
              </Badge>
              {Math.abs(livePercent) >= 50 ? (
                <span className="text-xs text-warning">
                  That is a large change — check the amount
                </span>
              ) : null}
            </div>
          ) : null}

          <div className="grid grid-cols-2 gap-3">
            <Field
              label="Effective from"
              error={fieldErrors.effectiveFrom}
              hint="Must be after the current record starts"
            >
              <Input
                type="date"
                value={effectiveFrom}
                onChange={(event) => setEffectiveFrom(event.target.value)}
                required
              />
            </Field>

            <Field label="Reason" error={fieldErrors.changeReason}>
              <Select
                value={changeReason}
                onChange={(event) =>
                  setChangeReason(event.target.value as RecordSalaryBody['changeReason'])
                }
              >
                {SALARY_CHANGE_REASONS.map((reason) => (
                  <option key={reason} value={reason}>
                    {SALARY_CHANGE_REASON_LABELS[reason]}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <Field label="Note (optional)" error={fieldErrors.note}>
            <Input
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Context for this change"
              maxLength={500}
            />
          </Field>

          {generalError ? (
            <p role="alert" className="rounded-lg bg-negative/10 px-3 py-2 text-xs text-negative">
              {generalError}
            </p>
          ) : null}

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? 'Saving…' : 'Record change'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

/** Today as YYYY-MM-DD, which is what a date input expects. */
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
