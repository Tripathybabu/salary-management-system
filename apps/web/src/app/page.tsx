'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import {
  getOverview,
  getBreakdown,
  getOutliers,
  getTrend,
  ApiError,
} from '@/lib/api';
import {
  formatUsd,
  formatUsdWhole,
  formatNumber,
  formatShare,
  formatPercent,
} from '@/lib/format';
import { Card, CardHeader, Skeleton, ErrorState, Badge, Button } from '@/components/ui';
import { CostByGroupChart, TrendChart } from '@/components/charts';

/**
 * Dashboard — the answer to "how does this organisation pay people?"
 *
 * Ordered by what an HR manager needs first: the headline numbers, then where the
 * money goes, then the trend, then the list of people who need attention. The
 * outlier panel is last but is the only part with actions, because it is the only
 * part that implies work.
 */
export default function DashboardPage() {
  const overview = useQuery({ queryKey: ['overview'], queryFn: () => getOverview() });
  const byDepartment = useQuery({
    queryKey: ['breakdown', 'department'],
    queryFn: () => getBreakdown({ dimension: 'department' }),
  });
  const byCountry = useQuery({
    queryKey: ['breakdown', 'country'],
    queryFn: () => getBreakdown({ dimension: 'country' }),
  });
  const trend = useQuery({
    queryKey: ['trend', 18],
    queryFn: () => getTrend({ months: 18 }),
  });
  const outliers = useQuery({
    queryKey: ['outliers', 'dashboard'],
    queryFn: () => getOutliers({ thresholdPercent: 25, direction: 'below', limit: 6 }),
  });

  if (overview.isError) {
    const error = overview.error;
    return (
      <ErrorState
        message={error instanceof ApiError ? error.message : 'Could not load the dashboard.'}
        onRetry={() => void overview.refetch()}
      />
    );
  }

  const metrics = overview.data;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-ink">Compensation overview</h1>
        <p className="mt-1 text-sm text-ink-muted">
          How ACME pays people, across{' '}
          {metrics ? `${metrics.countryCount} countries and ${metrics.departmentCount} departments` : 'the organisation'}.
        </p>
      </div>

      {/* Headline metrics. Median leads; the mean sits beside it as context. */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <MetricTile
          label="Active headcount"
          value={metrics ? formatNumber(metrics.headcount) : undefined}
          hint="Excludes leavers"
        />
        <MetricTile
          label="Annual payroll"
          value={metrics ? formatUsd(metrics.totalAnnualCostUsd) : undefined}
          hint="Normalised to USD"
        />
        <MetricTile
          label="Median salary"
          value={metrics ? formatUsdWhole(metrics.medianSalaryUsd) : undefined}
          hint={metrics ? `Mean ${formatUsdWhole(metrics.meanSalaryUsd)}` : undefined}
        />
        <MetricTile
          label="Salary range"
          value={metrics ? `${formatUsd(metrics.p25SalaryUsd)} – ${formatUsd(metrics.p90SalaryUsd)}` : undefined}
          hint="25th to 90th percentile"
        />
      </div>

      {/*
        The distribution strip makes skew visible. A median well below the mean is
        the signal that a handful of senior salaries dominate the average — the
        reason this app reports percentiles rather than a single number.
      */}
      {metrics && metrics.headcount > 0 ? (
        <Card className="px-5 py-4">
          <p className="text-xs font-medium text-ink">Salary distribution</p>
          <div className="mt-3 flex items-end gap-1.5">
            {(
              [
                ['Min', metrics.minSalaryUsd],
                ['p25', metrics.p25SalaryUsd],
                ['Median', metrics.medianSalaryUsd],
                ['p75', metrics.p75SalaryUsd],
                ['p90', metrics.p90SalaryUsd],
                ['Max', metrics.maxSalaryUsd],
              ] as const
            ).map(([label, value]) => (
              <div key={label} className="flex-1">
                <div
                  className={
                    label === 'Median'
                      ? 'h-2 rounded-full bg-brand'
                      : 'h-2 rounded-full bg-brand/25'
                  }
                />
                <p className="mt-1.5 text-[11px] text-ink-muted">{label}</p>
                <p className="tabular text-xs font-medium text-ink">{formatUsd(value)}</p>
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Payroll cost by department" description="Share of total annual cost" />
          <div className="p-5">
            {byDepartment.isPending ? (
              <Skeleton className="h-64 w-full" />
            ) : byDepartment.data ? (
              <CostByGroupChart groups={byDepartment.data.groups} />
            ) : null}
          </div>
        </Card>

        <Card>
          <CardHeader title="Payroll cost by country" description="Share of total annual cost" />
          <div className="p-5">
            {byCountry.isPending ? (
              <Skeleton className="h-64 w-full" />
            ) : byCountry.data ? (
              <CostByGroupChart groups={byCountry.data.groups} />
            ) : null}
          </div>
        </Card>
      </div>

      <Card>
        <CardHeader
          title="Compensation trend"
          description="Payroll cost and median salary over the last 18 months, reconstructed from effective-dated history"
        />
        <div className="p-5">
          {trend.isPending ? (
            <Skeleton className="h-72 w-full" />
          ) : trend.data ? (
            <TrendChart points={trend.data.points} />
          ) : null}
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Pay equity — who to look at"
          description="Employees more than 25% below the median for their level and country"
          action={
            <Link href="/analytics#outliers">
              <Button variant="secondary">View all</Button>
            </Link>
          }
        />
        {outliers.isPending ? (
          <div className="space-y-2 p-5">
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} className="h-11 w-full" />
            ))}
          </div>
        ) : outliers.data && outliers.data.outliers.length > 0 ? (
          <ul className="divide-y divide-border">
            {outliers.data.outliers.map((row) => (
              <li key={row.employeeId}>
                <Link
                  href={`/employees/${row.employeeId}`}
                  className="flex items-center justify-between gap-4 px-5 py-3 hover:bg-surface"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-ink">{row.name}</p>
                    <p className="truncate text-xs text-ink-muted">
                      {row.jobTitle} · {row.level} · {row.countryCode} · {row.departmentName}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <div className="text-right">
                      <p className="tabular text-sm font-medium text-ink">
                        {formatUsdWhole(row.salaryUsd)}
                      </p>
                      {/* The band median is shown so the flag is auditable, not just asserted. */}
                      <p className="tabular text-[11px] text-ink-muted">
                        band {formatUsdWhole(row.bandMedianUsd)} · n={row.bandSize}
                      </p>
                    </div>
                    <Badge tone="negative">{formatPercent(row.deviationPercent)}</Badge>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-5 py-8 text-center text-sm text-ink-muted">
            No one is more than 25% below their band median.
          </p>
        )}
      </Card>

      {byDepartment.data ? (
        <Card>
          <CardHeader
            title="Department detail"
            description="Median reported alongside the mean — a single senior salary can pull a mean well above typical pay"
          />
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-ink-muted">
                  <th className="px-5 py-2.5 font-medium">Department</th>
                  <th className="px-5 py-2.5 text-right font-medium">Headcount</th>
                  <th className="px-5 py-2.5 text-right font-medium">Median</th>
                  <th className="px-5 py-2.5 text-right font-medium">Mean</th>
                  <th className="px-5 py-2.5 text-right font-medium">Annual cost</th>
                  <th className="px-5 py-2.5 text-right font-medium">Share</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {byDepartment.data.groups.map((group) => (
                  <tr key={group.key} className="hover:bg-surface">
                    <td className="px-5 py-2.5 font-medium text-ink">{group.label}</td>
                    <td className="tabular px-5 py-2.5 text-right text-ink-muted">
                      {formatNumber(group.headcount)}
                    </td>
                    <td className="tabular px-5 py-2.5 text-right text-ink">
                      {formatUsdWhole(group.medianSalaryUsd)}
                    </td>
                    <td className="tabular px-5 py-2.5 text-right text-ink-muted">
                      {formatUsdWhole(group.meanSalaryUsd)}
                    </td>
                    <td className="tabular px-5 py-2.5 text-right text-ink">
                      {formatUsd(group.totalAnnualCostUsd)}
                    </td>
                    <td className="tabular px-5 py-2.5 text-right text-ink-muted">
                      {formatShare(group.costSharePercent)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}
    </div>
  );
}

function MetricTile({
  label,
  value,
  hint,
}: {
  label: string;
  value?: string;
  hint?: string;
}) {
  return (
    <Card className="px-5 py-4">
      <p className="text-xs font-medium text-ink-muted">{label}</p>
      {value === undefined ? (
        <Skeleton className="mt-2 h-7 w-28" />
      ) : (
        <p className="tabular mt-1 text-2xl font-semibold text-ink">{value}</p>
      )}
      {hint ? <p className="mt-1 text-xs text-ink-muted">{hint}</p> : null}
    </Card>
  );
}
