'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { ANALYTICS_DIMENSIONS, JOB_LEVELS, type AnalyticsDimension } from '@salary/shared';
import { getBreakdown, getPayGap, getOutliers, getFilterOptions, ApiError } from '@/lib/api';
import { formatUsdWhole, formatNumber, formatShare, formatPercent, humanise } from '@/lib/format';
import { Card, CardHeader, Select, Badge, Skeleton, ErrorState, Button } from '@/components/ui';
import { PayGapChart, DistributionChart } from '@/components/charts';

const DIMENSION_LABELS: Record<AnalyticsDimension, string> = {
  country: 'Country',
  department: 'Department',
  level: 'Level',
  employmentType: 'Employment type',
};

/**
 * Pay analysis.
 *
 * Three questions, in the order an HR manager asks them:
 *   1. How is pay distributed across the org?
 *   2. Is there a gender pay gap, and where?
 *   3. Who specifically is paid out of line with their peers?
 *
 * Every figure here carries its sample size, because the honest answer to most
 * pay questions is "it depends how many people that is".
 */
export default function AnalyticsPage() {
  const [dimension, setDimension] = useState<AnalyticsDimension>('department');
  const [countryCode, setCountryCode] = useState('');
  const [level, setLevel] = useState('');
  const [threshold, setThreshold] = useState(20);
  const [direction, setDirection] = useState<'below' | 'above' | 'both'>('below');

  const filters = useQuery({ queryKey: ['filters'], queryFn: getFilterOptions });

  const scope = {
    countryCode: countryCode || undefined,
    level: (level || undefined) as (typeof JOB_LEVELS)[number] | undefined,
  };

  const breakdown = useQuery({
    queryKey: ['breakdown', dimension, scope],
    queryFn: () => getBreakdown({ dimension, ...scope }),
  });
  const payGap = useQuery({
    queryKey: ['pay-gap', dimension, scope],
    queryFn: () => getPayGap({ dimension, ...scope }),
  });
  const outliers = useQuery({
    queryKey: ['outliers', threshold, direction, scope],
    queryFn: () => getOutliers({ thresholdPercent: threshold, direction, limit: 50, ...scope }),
  });

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-ink">Pay analysis</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Distribution, pay gap and equity outliers across the organisation.
        </p>
      </div>

      <Card className="p-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-ink">Group by</span>
            <Select
              value={dimension}
              onChange={(event) => setDimension(event.target.value as AnalyticsDimension)}
            >
              {ANALYTICS_DIMENSIONS.map((value) => (
                <option key={value} value={value}>
                  {DIMENSION_LABELS[value]}
                </option>
              ))}
            </Select>
          </label>

          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-ink">Country</span>
            <Select value={countryCode} onChange={(event) => setCountryCode(event.target.value)}>
              <option value="">All countries</option>
              {filters.data?.countries.map((country) => (
                <option key={country.code} value={country.code}>
                  {country.name}
                </option>
              ))}
            </Select>
          </label>

          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-ink">Level</span>
            <Select value={level} onChange={(event) => setLevel(event.target.value)}>
              <option value="">All levels</option>
              {JOB_LEVELS.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </Select>
          </label>
        </div>
      </Card>

      <Card>
        <CardHeader
          title={`Salary distribution by ${DIMENSION_LABELS[dimension].toLowerCase()}`}
          description="Bar spans the 25th–75th percentile; the tick marks the median"
        />
        <div className="p-5">
          {breakdown.isError ? (
            <ErrorState
              message={
                breakdown.error instanceof ApiError
                  ? breakdown.error.message
                  : 'Could not load the breakdown.'
              }
              onRetry={() => void breakdown.refetch()}
            />
          ) : breakdown.isPending ? (
            <Skeleton className="h-64 w-full" />
          ) : (
            <DistributionChart groups={breakdown.data.groups} />
          )}
        </div>
      </Card>

      <Card>
        <CardHeader
          title={`Gender pay gap by ${DIMENSION_LABELS[dimension].toLowerCase()}`}
          description="A raw median gap, not an equal-pay-for-equal-work measure — a gap can arise from how roles and seniority are distributed"
        />

        {payGap.isPending ? (
          <div className="p-5">
            <Skeleton className="h-56 w-full" />
          </div>
        ) : payGap.data ? (
          <>
            <div className="flex flex-wrap gap-4 border-b border-border px-5 py-3 text-sm">
              <div>
                <span className="text-xs text-ink-muted">Overall median gap: </span>
                {payGap.data.overall.medianGapPercent !== null ? (
                  <Badge
                    tone={payGap.data.overall.medianGapPercent > 0 ? 'negative' : 'positive'}
                  >
                    {formatPercent(payGap.data.overall.medianGapPercent)}
                  </Badge>
                ) : (
                  <span className="text-ink-muted">Not reportable</span>
                )}
              </div>
              {/*
                Coverage is stated up front. A gap measured across 70% of staff is a
                different claim from one across 99%, and the user needs to know which.
              */}
              <div className="text-xs text-ink-muted">
                Based on {formatNumber(payGap.data.overall.maleCount)} men and{' '}
                {formatNumber(payGap.data.overall.femaleCount)} women ·{' '}
                {formatShare(payGap.data.coveragePercent)} of employees have a recorded gender
              </div>
            </div>

            <div className="p-5">
              <PayGapChart rows={payGap.data.rows} />
            </div>

            <div className="overflow-x-auto border-t border-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-ink-muted">
                    <th className="px-5 py-2.5 font-medium">{DIMENSION_LABELS[dimension]}</th>
                    <th className="px-5 py-2.5 text-right font-medium">Men</th>
                    <th className="px-5 py-2.5 text-right font-medium">Women</th>
                    <th className="px-5 py-2.5 text-right font-medium">Median (men)</th>
                    <th className="px-5 py-2.5 text-right font-medium">Median (women)</th>
                    <th className="px-5 py-2.5 text-right font-medium">Gap</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {payGap.data.rows.map((row) => (
                    <tr key={row.key} className="hover:bg-surface">
                      <td className="px-5 py-2.5 font-medium text-ink">{row.label}</td>
                      <td className="tabular px-5 py-2.5 text-right text-ink-muted">
                        {row.maleCount}
                      </td>
                      <td className="tabular px-5 py-2.5 text-right text-ink-muted">
                        {row.femaleCount}
                      </td>
                      {row.suppressed ? (
                        <td colSpan={3} className="px-5 py-2.5 text-right text-xs text-ink-muted">
                          Withheld — fewer than {payGap.data.minGroupSize} in a group
                        </td>
                      ) : (
                        <>
                          <td className="tabular px-5 py-2.5 text-right text-ink">
                            {formatUsdWhole(row.maleMedianUsd ?? 0)}
                          </td>
                          <td className="tabular px-5 py-2.5 text-right text-ink">
                            {formatUsdWhole(row.femaleMedianUsd ?? 0)}
                          </td>
                          <td className="px-5 py-2.5 text-right">
                            {row.medianGapPercent !== null ? (
                              <Badge tone={row.medianGapPercent > 0 ? 'negative' : 'positive'}>
                                {formatPercent(row.medianGapPercent)}
                              </Badge>
                            ) : (
                              <span className="text-xs text-ink-muted">—</span>
                            )}
                          </td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : null}
      </Card>

      <Card id="outliers">
        <CardHeader
          title="Pay equity outliers"
          description="Compared against the median for the same level and country — never across markets"
          action={
            <div className="flex items-center gap-2">
              <Select
                value={direction}
                onChange={(event) =>
                  setDirection(event.target.value as 'below' | 'above' | 'both')
                }
                className="w-auto"
                aria-label="Outlier direction"
              >
                <option value="below">Below band</option>
                <option value="above">Above band</option>
                <option value="both">Both</option>
              </Select>
              <Select
                value={String(threshold)}
                onChange={(event) => setThreshold(Number(event.target.value))}
                className="w-auto"
                aria-label="Deviation threshold"
              >
                {[10, 15, 20, 25, 30, 40].map((value) => (
                  <option key={value} value={value}>
                    ±{value}%
                  </option>
                ))}
              </Select>
            </div>
          }
        />

        {outliers.isPending ? (
          <div className="space-y-2 p-5">
            {Array.from({ length: 5 }).map((_, index) => (
              <Skeleton key={index} className="h-12 w-full" />
            ))}
          </div>
        ) : outliers.data && outliers.data.outliers.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-ink-muted">
                  <th className="px-5 py-2.5 font-medium">Employee</th>
                  <th className="px-5 py-2.5 font-medium">Band</th>
                  <th className="px-5 py-2.5 text-right font-medium">Salary</th>
                  <th className="px-5 py-2.5 text-right font-medium">Band median</th>
                  <th className="px-5 py-2.5 text-right font-medium">Deviation</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {outliers.data.outliers.map((row) => (
                  <tr key={row.employeeId} className="hover:bg-surface">
                    <td className="px-5 py-2.5">
                      <Link href={`/employees/${row.employeeId}`} className="block">
                        <span className="block font-medium text-ink">{row.name}</span>
                        <span className="block text-xs text-ink-muted">
                          {row.employeeCode} · {row.jobTitle} · {row.departmentName}
                        </span>
                      </Link>
                    </td>
                    <td className="px-5 py-2.5 text-xs text-ink-muted">
                      {row.level} · {row.countryCode}
                      {/* Band size is shown so the reader can judge how solid the median is. */}
                      <span className="block">n={row.bandSize}</span>
                    </td>
                    <td className="tabular px-5 py-2.5 text-right text-ink">
                      {formatUsdWhole(row.salaryUsd)}
                    </td>
                    <td className="tabular px-5 py-2.5 text-right text-ink-muted">
                      {formatUsdWhole(row.bandMedianUsd)}
                    </td>
                    <td className="px-5 py-2.5 text-right">
                      <Badge tone={row.direction === 'below' ? 'negative' : 'warning'}>
                        {formatPercent(row.deviationPercent)}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="px-5 py-10 text-center text-sm text-ink-muted">
            No employees deviate more than {threshold}% from their band median.
          </p>
        )}
      </Card>
    </div>
  );
}
