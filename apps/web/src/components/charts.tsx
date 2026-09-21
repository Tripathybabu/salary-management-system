'use client';

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  ComposedChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { GroupBreakdown, TrendPoint } from '@/lib/api';
import { formatUsd, formatUsdWhole, formatNumber, formatPeriod, formatShare } from '@/lib/format';

/**
 * Charts.
 *
 * Two deliberate choices run through this file:
 *
 * 1. Currency axes are formatted compactly ("$120k"), because a full axis label
 *    of "$120,000.00" crowds out the plot area at this size.
 * 2. Tooltips carry the exact figure, so the compact axis never costs precision
 *    when the user actually interrogates a point.
 */

const AXIS = {
  stroke: 'rgb(var(--ink-muted))',
  fontSize: 11,
};

const GRID = 'rgb(var(--border))';

/**
 * Coerce a Recharts tooltip value to a number.
 *
 * Recharts types a datum as `string | number | (string | number)[]` because a
 * chart can carry non-numeric series. Ours are always numeric, so this narrows
 * once here rather than casting at four call sites.
 */
function toNumber(value: unknown): number {
  const raw = Array.isArray(value) ? value[0] : value;
  return typeof raw === 'number' ? raw : Number(raw ?? 0);
}

/** Shared tooltip styling, matching the app surface in both themes. */
const TOOLTIP_STYLE = {
  backgroundColor: 'rgb(var(--surface-raised))',
  border: '1px solid rgb(var(--border))',
  borderRadius: '0.5rem',
  fontSize: '12px',
  color: 'rgb(var(--ink))',
} as const;

/**
 * Horizontal bars of payroll cost per group.
 *
 * Horizontal rather than vertical because the labels are words ("Customer
 * Support"), and vertical bars would force them to rotate or truncate.
 */
export function CostByGroupChart({ groups }: { groups: GroupBreakdown[] }) {
  if (groups.length === 0) {
    return <p className="py-12 text-center text-sm text-ink-muted">No data to display.</p>;
  }

  // Cap at eight bars: beyond that the chart is a table with extra steps.
  const data = groups.slice(0, 8).map((group) => ({
    label: group.label,
    cost: group.totalAnnualCostUsd,
    headcount: group.headcount,
    median: group.medianSalaryUsd,
    share: group.costSharePercent,
  }));

  return (
    <ResponsiveContainer width="100%" height={Math.max(240, data.length * 38)}>
      <BarChart data={data} layout="vertical" margin={{ left: 8, right: 16 }}>
        <CartesianGrid horizontal={false} stroke={GRID} />
        <XAxis
          type="number"
          tickFormatter={(value: number) => formatUsd(value, { compact: true })}
          {...AXIS}
        />
        <YAxis type="category" dataKey="label" width={120} {...AXIS} />
        <Tooltip
          contentStyle={TOOLTIP_STYLE}
          cursor={{ fill: 'rgb(var(--brand) / 0.06)' }}
          formatter={(value) => [formatUsdWhole(toNumber(value)), 'Annual cost']}
          labelFormatter={(label) => {
            const row = data.find((d) => d.label === label);
            return row
              ? `${row.label} — ${formatNumber(row.headcount)} people, median ${formatUsdWhole(row.median)}`
              : String(label ?? '');
          }}
        />
        <Bar dataKey="cost" radius={[0, 4, 4, 0]}>
          {data.map((entry) => (
            // Opacity encodes cost share, so the dominant cost centre reads first.
            <Cell
              key={entry.label}
              fill="rgb(var(--brand))"
              fillOpacity={0.45 + Math.min(entry.share / 100, 0.55)}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/**
 * Payroll cost and median salary over time.
 *
 * Two series on two axes: total cost is in hundreds of millions and median salary
 * in tens of thousands, so a shared axis would flatten the median into a straight
 * line at zero.
 */
export function TrendChart({ points }: { points: TrendPoint[] }) {
  if (points.length === 0) {
    return <p className="py-12 text-center text-sm text-ink-muted">No trend data available.</p>;
  }

  const data = points.map((point) => ({
    period: formatPeriod(point.period),
    cost: point.totalAnnualCostUsd,
    median: point.medianSalaryUsd,
    headcount: point.headcount,
  }));

  return (
    <ResponsiveContainer width="100%" height={300}>
      <ComposedChart data={data} margin={{ left: 8, right: 8 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="period" {...AXIS} />
        <YAxis
          yAxisId="cost"
          tickFormatter={(value: number) => formatUsd(value, { compact: true })}
          {...AXIS}
        />
        <YAxis
          yAxisId="median"
          orientation="right"
          tickFormatter={(value: number) => formatUsd(value, { compact: true })}
          {...AXIS}
        />
        <Tooltip
          contentStyle={TOOLTIP_STYLE}
          formatter={(value, name) => [
            formatUsdWhole(toNumber(value)),
            name === 'cost' ? 'Annual payroll' : 'Median salary',
          ]}
        />
        <Legend
          wrapperStyle={{ fontSize: 12, color: 'rgb(var(--ink-muted))' }}
          formatter={(value) => (value === 'cost' ? 'Annual payroll' : 'Median salary')}
        />
        <Bar yAxisId="cost" dataKey="cost" fill="rgb(var(--brand))" fillOpacity={0.25} radius={[4, 4, 0, 0]} />
        <Line
          yAxisId="median"
          type="monotone"
          dataKey="median"
          stroke="rgb(var(--brand))"
          strokeWidth={2}
          dot={false}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

/**
 * Median pay by group, split by gender.
 *
 * Grouped bars rather than a single "gap %" bar: showing both medians lets the
 * reader see the magnitudes the percentage is derived from. A 10% gap between
 * two £200k salaries is a different conversation from 10% between two £30k ones.
 */
export function PayGapChart({
  rows,
}: {
  rows: { label: string; maleMedianUsd: number | null; femaleMedianUsd: number | null; suppressed: boolean }[];
}) {
  // Suppressed rows have nothing to plot; they remain visible in the table.
  const data = rows
    .filter((row) => !row.suppressed && row.maleMedianUsd !== null && row.femaleMedianUsd !== null)
    .map((row) => ({
      label: row.label,
      male: row.maleMedianUsd ?? 0,
      female: row.femaleMedianUsd ?? 0,
    }));

  if (data.length === 0) {
    return (
      <p className="py-12 text-center text-sm text-ink-muted">
        No groups are large enough to report a gap.
      </p>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={Math.max(260, data.length * 46)}>
      <BarChart data={data} layout="vertical" margin={{ left: 8, right: 16 }}>
        <CartesianGrid horizontal={false} stroke={GRID} />
        <XAxis
          type="number"
          tickFormatter={(value: number) => formatUsd(value, { compact: true })}
          {...AXIS}
        />
        <YAxis type="category" dataKey="label" width={120} {...AXIS} />
        <Tooltip
          contentStyle={TOOLTIP_STYLE}
          cursor={{ fill: 'rgb(var(--brand) / 0.06)' }}
          formatter={(value, name) => [
            formatUsdWhole(toNumber(value)),
            name === 'male' ? 'Median (men)' : 'Median (women)',
          ]}
        />
        <Legend
          wrapperStyle={{ fontSize: 12, color: 'rgb(var(--ink-muted))' }}
          formatter={(value) => (value === 'male' ? 'Men' : 'Women')}
        />
        <Bar dataKey="male" fill="rgb(var(--brand))" radius={[0, 3, 3, 0]} />
        <Bar dataKey="female" fill="rgb(var(--warning))" radius={[0, 3, 3, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Percentile spread per group: p25, median and p75 as a labelled range. */
export function DistributionChart({ groups }: { groups: GroupBreakdown[] }) {
  if (groups.length === 0) {
    return <p className="py-12 text-center text-sm text-ink-muted">No data to display.</p>;
  }

  const max = Math.max(...groups.map((group) => group.p75SalaryUsd));

  return (
    <div className="space-y-3">
      {groups.slice(0, 10).map((group) => {
        const left = (group.p25SalaryUsd / max) * 100;
        const right = (group.p75SalaryUsd / max) * 100;
        const median = (group.medianSalaryUsd / max) * 100;

        return (
          <div key={group.key}>
            <div className="flex items-baseline justify-between text-xs">
              <span className="font-medium text-ink">{group.label}</span>
              <span className="tabular text-ink-muted">
                {formatUsdWhole(group.p25SalaryUsd)} – {formatUsdWhole(group.p75SalaryUsd)}
                <span className="ml-2 text-ink">median {formatUsdWhole(group.medianSalaryUsd)}</span>
              </span>
            </div>
            {/* The bar is the interquartile range; the tick is the median. */}
            <div className="relative mt-1.5 h-2.5 rounded-full bg-surface">
              <div
                className="absolute h-2.5 rounded-full bg-brand/30"
                style={{ left: `${left}%`, width: `${Math.max(right - left, 0.5)}%` }}
              />
              <div
                className="absolute h-2.5 w-0.5 bg-brand"
                style={{ left: `${median}%` }}
                title={`Median ${formatUsdWhole(group.medianSalaryUsd)}`}
              />
            </div>
            <p className="mt-0.5 text-[11px] text-ink-muted">
              {formatNumber(group.headcount)} people · {formatShare(group.costSharePercent)} of payroll
            </p>
          </div>
        );
      })}
    </div>
  );
}
