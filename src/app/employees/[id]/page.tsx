'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { SALARY_CHANGE_REASON_LABELS, JOB_LEVEL_LABELS } from '@salary/shared';
import { getEmployee, getSalaryHistory, ApiError } from '@/lib/api';
import {
  formatUsdWhole,
  formatLocal,
  formatDate,
  formatPercent,
  humanise,
  initials,
} from '@/lib/format';
import { Card, CardHeader, Button, Badge, Skeleton, ErrorState, statusTone } from '@/components/ui';
import { SalaryChangeDialog } from '@/components/salary-change-dialog';

/**
 * Employee detail.
 *
 * Two jobs: show who this person is, and show the full story of how their pay got
 * to where it is. The history timeline is the part a spreadsheet cannot give you —
 * it exists because salary records are effective-dated rather than overwritten.
 */
export default function EmployeeDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [dialogOpen, setDialogOpen] = useState(false);

  const employee = useQuery({ queryKey: ['employee', id], queryFn: () => getEmployee(id) });
  const history = useQuery({
    queryKey: ['salary-history', id],
    queryFn: () => getSalaryHistory(id),
  });

  if (employee.isError) {
    const error = employee.error;
    const notFound = error instanceof ApiError && error.status === 404;
    return (
      <ErrorState
        message={notFound ? 'That employee does not exist.' : 'Could not load this employee.'}
        onRetry={notFound ? undefined : () => void employee.refetch()}
      />
    );
  }

  if (employee.isPending) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-28 w-full" />
        <div className="grid gap-5 lg:grid-cols-3">
          <Skeleton className="h-64 lg:col-span-2" />
          <Skeleton className="h-64" />
        </div>
      </div>
    );
  }

  const person = employee.data;
  const current = person.currentSalary;
  const canChangePay = person.status !== 'TERMINATED';

  return (
    <div className="space-y-5">
      <Link href="/employees" className="text-sm text-ink-muted hover:text-ink">
        ← Back to employees
      </Link>

      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-4">
            <span className="grid h-14 w-14 place-items-center rounded-full bg-brand-soft text-lg font-semibold text-brand">
              {initials(person.firstName, person.lastName)}
            </span>
            <div>
              <h1 className="text-xl font-semibold text-ink">
                {person.firstName} {person.lastName}
              </h1>
              <p className="text-sm text-ink-muted">
                {person.jobTitle} · {person.department.name}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Badge tone={statusTone(person.status)}>{humanise(person.status)}</Badge>
                <Badge tone="brand">{JOB_LEVEL_LABELS[person.level] ?? person.level}</Badge>
                <Badge>{person.employeeCode}</Badge>
              </div>
            </div>
          </div>

          <div className="text-right">
            {current ? (
              <>
                <p className="text-xs text-ink-muted">Current annual salary</p>
                <p className="tabular text-2xl font-semibold text-ink">
                  {formatUsdWhole(Number(current.annualAmountUsd))}
                </p>
                {current.currency !== 'USD' ? (
                  <p className="tabular text-sm text-ink-muted">
                    {formatLocal(Number(current.baseAmount), current.currency)} {current.currency}
                  </p>
                ) : null}
                <p className="mt-0.5 text-xs text-ink-muted">
                  Effective {formatDate(current.effectiveFrom)}
                </p>
              </>
            ) : (
              <p className="text-sm text-ink-muted">No current salary on record</p>
            )}

            {canChangePay ? (
              <Button className="mt-3" onClick={() => setDialogOpen(true)}>
                Record salary change
              </Button>
            ) : (
              <p className="mt-3 text-xs text-ink-muted">
                Pay cannot be changed for a terminated employee
              </p>
            )}
          </div>
        </div>
      </Card>

      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Salary history"
            description="Every change is a new record — nothing is overwritten"
          />

          {history.isPending ? (
            <div className="space-y-2 p-5">
              {Array.from({ length: 3 }).map((_, index) => (
                <Skeleton key={index} className="h-16 w-full" />
              ))}
            </div>
          ) : history.data && history.data.length > 0 ? (
            <ol className="divide-y divide-border">
              {history.data.map((entry) => (
                <li key={entry.id} className="flex gap-4 px-5 py-4">
                  {/* Timeline rail: the current record is filled, history is hollow. */}
                  <div className="flex flex-col items-center pt-1">
                    <span
                      className={
                        entry.isCurrent
                          ? 'h-2.5 w-2.5 rounded-full bg-brand'
                          : 'h-2.5 w-2.5 rounded-full border border-border bg-surface'
                      }
                    />
                    <span className="mt-1 w-px flex-1 bg-border" />
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="tabular text-sm font-semibold text-ink">
                          {formatLocal(entry.baseAmount, entry.currency)}
                        </span>
                        {entry.currency !== 'USD' ? (
                          <span className="tabular text-xs text-ink-muted">
                            ({formatUsdWhole(entry.annualAmountUsd)})
                          </span>
                        ) : null}
                        {entry.changePercent !== null ? (
                          <Badge tone={entry.changePercent >= 0 ? 'positive' : 'negative'}>
                            {formatPercent(entry.changePercent)}
                          </Badge>
                        ) : null}
                        {entry.isCurrent ? <Badge tone="brand">Current</Badge> : null}
                      </div>
                      <span className="text-xs text-ink-muted">
                        {formatDate(entry.effectiveFrom)}
                        {entry.effectiveTo ? ` – ${formatDate(entry.effectiveTo)}` : ' – present'}
                      </span>
                    </div>

                    <p className="mt-1 text-xs text-ink-muted">
                      {SALARY_CHANGE_REASON_LABELS[entry.changeReason] ?? entry.changeReason}
                      {' · '}
                      {/* The audit trail: who made this change. */}
                      <span title="Recorded by">{entry.changedBy}</span>
                    </p>
                    {entry.note ? (
                      <p className="mt-1 text-xs italic text-ink-muted">“{entry.note}”</p>
                    ) : null}
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <p className="px-5 py-10 text-center text-sm text-ink-muted">
              No salary records yet.
            </p>
          )}
        </Card>

        <Card>
          <CardHeader title="Details" />
          <dl className="divide-y divide-border text-sm">
            <DetailRow label="Email" value={person.email} />
            <DetailRow label="Country" value={`${person.country.name} (${person.country.currencyCode})`} />
            <DetailRow label="Department" value={person.department.name} />
            <DetailRow label="Employment type" value={humanise(person.employmentType)} />
            <DetailRow label="Gender" value={humanise(person.gender)} />
            <DetailRow label="Hire date" value={formatDate(person.hireDate)} />
            {person.terminationDate ? (
              <DetailRow label="Termination date" value={formatDate(person.terminationDate)} />
            ) : null}
            <DetailRow
              label="Manager"
              value={
                person.manager ? (
                  <Link
                    href={`/employees/${person.manager.id}`}
                    className="text-brand hover:underline"
                  >
                    {person.manager.firstName} {person.manager.lastName}
                  </Link>
                ) : (
                  '—'
                )
              }
            />
            <DetailRow label="Direct reports" value={String(person.directReportCount)} />
          </dl>
        </Card>
      </div>

      {dialogOpen ? (
        <SalaryChangeDialog
          employeeId={id}
          employeeName={`${person.firstName} ${person.lastName}`}
          currentCurrency={current?.currency ?? person.country.currencyCode}
          currentAmount={current ? Number(current.baseAmount) : null}
          onClose={() => setDialogOpen(false)}
        />
      ) : null}
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 px-5 py-2.5">
      <dt className="shrink-0 text-xs text-ink-muted">{label}</dt>
      <dd className="truncate text-right text-sm text-ink">{value}</dd>
    </div>
  );
}
