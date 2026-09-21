'use client';

import { useQuery, keepPreviousData } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { JOB_LEVELS, EMPLOYMENT_STATUSES } from '@salary/shared';
import { listEmployees, getFilterOptions, ApiError, type EmployeeListParams } from '@/lib/api';
import { formatUsdWhole, formatLocal, formatNumber, formatDate, humanise, initials } from '@/lib/format';
import {
  Card,
  Button,
  Input,
  Select,
  Badge,
  Skeleton,
  EmptyState,
  ErrorState,
  statusTone,
} from '@/components/ui';
import { useDebounced } from '@/hooks/use-debounced';

type SortBy = NonNullable<EmployeeListParams['sortBy']>;

const PAGE_SIZE = 25;

/**
 * Employee directory.
 *
 * The central constraint: 10,000 employees must never all reach the browser.
 * Every filter, sort and page is a server-side query returning at most 25 rows.
 *
 * Filter state lives in React rather than the URL. That is a trade-off — a
 * shareable filtered URL would be better, and is the first thing I would add —
 * but it keeps this page a single client component with no router round-trips
 * on every keystroke.
 */
export default function EmployeesPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [countryCode, setCountryCode] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [level, setLevel] = useState('');
  const [status, setStatus] = useState('ACTIVE');
  const [sortBy, setSortBy] = useState<SortBy>('name');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');

  // Debounced so typing a name issues one request, not one per character.
  const debouncedSearch = useDebounced(search, 300);

  const filters = useQuery({ queryKey: ['filters'], queryFn: getFilterOptions });

  const params: EmployeeListParams = {
    page,
    pageSize: PAGE_SIZE,
    search: debouncedSearch || undefined,
    countryCode: countryCode ? [countryCode] : undefined,
    departmentId: departmentId ? [departmentId] : undefined,
    level: level ? [level] : undefined,
    status: status ? [status] : undefined,
    sortBy,
    sortOrder,
  };

  const employees = useQuery({
    queryKey: ['employees', params],
    queryFn: () => listEmployees(params),
    // Keeps the previous page visible while the next loads, so the table does
    // not collapse to a skeleton on every pagination click.
    placeholderData: keepPreviousData,
  });

  /** Changing a filter must reset to page 1, or the user lands on an empty page. */
  function updateFilter(setter: (value: string) => void) {
    return (value: string) => {
      setter(value);
      setPage(1);
    };
  }

  function toggleSort(column: SortBy) {
    if (sortBy === column) {
      setSortOrder((order) => (order === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(column);
      // Money reads most usefully highest-first; names read A-Z.
      setSortOrder(column === 'salary' ? 'desc' : 'asc');
    }
    setPage(1);
  }

  const hasActiveFilters = Boolean(search || countryCode || departmentId || level) || status !== 'ACTIVE';

  function clearFilters() {
    setSearch('');
    setCountryCode('');
    setDepartmentId('');
    setLevel('');
    setStatus('ACTIVE');
    setPage(1);
  }

  const pagination = employees.data?.pagination;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink">Employees</h1>
          <p className="mt-1 text-sm text-ink-muted">
            {pagination
              ? `${formatNumber(pagination.totalCount)} ${pagination.totalCount === 1 ? 'person' : 'people'} match your filters`
              : 'Search and filter the directory'}
          </p>
        </div>
        <Link href="/employees/new">
          <Button>Add employee</Button>
        </Link>
      </div>

      <Card className="p-4">
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-5">
          <div className="lg:col-span-2">
            <Input
              type="search"
              placeholder="Search name, email or employee code…"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
              aria-label="Search employees"
            />
          </div>

          <Select
            value={countryCode}
            onChange={(event) => updateFilter(setCountryCode)(event.target.value)}
            aria-label="Filter by country"
          >
            <option value="">All countries</option>
            {filters.data?.countries.map((country) => (
              <option key={country.code} value={country.code}>
                {country.name}
              </option>
            ))}
          </Select>

          <Select
            value={departmentId}
            onChange={(event) => updateFilter(setDepartmentId)(event.target.value)}
            aria-label="Filter by department"
          >
            <option value="">All departments</option>
            {filters.data?.departments.map((department) => (
              <option key={department.id} value={department.id}>
                {department.name}
              </option>
            ))}
          </Select>

          <div className="flex gap-3">
            <Select
              value={level}
              onChange={(event) => updateFilter(setLevel)(event.target.value)}
              aria-label="Filter by level"
            >
              <option value="">All levels</option>
              {JOB_LEVELS.map((jobLevel) => (
                <option key={jobLevel} value={jobLevel}>
                  {jobLevel}
                </option>
              ))}
            </Select>

            <Select
              value={status}
              onChange={(event) => updateFilter(setStatus)(event.target.value)}
              aria-label="Filter by status"
            >
              <option value="">Any status</option>
              {EMPLOYMENT_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {humanise(value)}
                </option>
              ))}
            </Select>
          </div>
        </div>

        {hasActiveFilters ? (
          <div className="mt-3 flex justify-end">
            <Button variant="ghost" onClick={clearFilters}>
              Clear filters
            </Button>
          </div>
        ) : null}
      </Card>

      <Card>
        {employees.isError ? (
          <ErrorState
            message={
              employees.error instanceof ApiError
                ? employees.error.message
                : 'Could not load employees.'
            }
            onRetry={() => void employees.refetch()}
          />
        ) : employees.isPending ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 8 }).map((_, index) => (
              <Skeleton key={index} className="h-12 w-full" />
            ))}
          </div>
        ) : employees.data.data.length === 0 ? (
          <EmptyState
            title="No employees match those filters"
            description="Try a different search term, or clear the filters to see everyone."
            action={
              hasActiveFilters ? (
                <Button variant="secondary" onClick={clearFilters}>
                  Clear filters
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-ink-muted">
                  <SortableHeader
                    label="Employee"
                    column="name"
                    sortBy={sortBy}
                    sortOrder={sortOrder}
                    onSort={toggleSort}
                  />
                  <SortableHeader
                    label="Department"
                    column="department"
                    sortBy={sortBy}
                    sortOrder={sortOrder}
                    onSort={toggleSort}
                  />
                  <SortableHeader
                    label="Level"
                    column="level"
                    sortBy={sortBy}
                    sortOrder={sortOrder}
                    onSort={toggleSort}
                  />
                  <SortableHeader
                    label="Country"
                    column="country"
                    sortBy={sortBy}
                    sortOrder={sortOrder}
                    onSort={toggleSort}
                  />
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <SortableHeader
                    label="Salary"
                    column="salary"
                    align="right"
                    sortBy={sortBy}
                    sortOrder={sortOrder}
                    onSort={toggleSort}
                  />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {employees.data.data.map((employee) => (
                  <tr key={employee.id} className="hover:bg-surface">
                    <td className="px-4 py-2.5">
                      <Link href={`/employees/${employee.id}`} className="flex items-center gap-3">
                        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand-soft text-[11px] font-semibold text-brand">
                          {initials(employee.firstName, employee.lastName)}
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate font-medium text-ink">
                            {employee.firstName} {employee.lastName}
                          </span>
                          <span className="block truncate text-xs text-ink-muted">
                            {employee.employeeCode} · {employee.jobTitle}
                          </span>
                        </span>
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 text-ink-muted">{employee.departmentName}</td>
                    <td className="px-4 py-2.5 text-ink-muted">{employee.level}</td>
                    <td className="px-4 py-2.5 text-ink-muted">{employee.countryName}</td>
                    <td className="px-4 py-2.5">
                      <Badge tone={statusTone(employee.status)}>{humanise(employee.status)}</Badge>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {employee.currentSalary ? (
                        <>
                          <span className="tabular block font-medium text-ink">
                            {formatUsdWhole(employee.currentSalary.annualAmountUsd)}
                          </span>
                          {/* Local currency shown below, since that is what the
                              employee is actually paid. */}
                          {employee.currentSalary.currency !== 'USD' ? (
                            <span className="tabular block text-xs text-ink-muted">
                              {formatLocal(
                                employee.currentSalary.baseAmount,
                                employee.currentSalary.currency,
                              )}
                            </span>
                          ) : null}
                        </>
                      ) : (
                        <span className="text-xs text-ink-muted">No current salary</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {pagination && pagination.totalPages > 1 ? (
          <div className="flex items-center justify-between border-t border-border px-4 py-3">
            <p className="text-xs text-ink-muted">
              Showing {(pagination.page - 1) * pagination.pageSize + 1}–
              {Math.min(pagination.page * pagination.pageSize, pagination.totalCount)} of{' '}
              {formatNumber(pagination.totalCount)}
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                disabled={!pagination.hasPreviousPage}
                onClick={() => setPage((current) => current - 1)}
              >
                Previous
              </Button>
              <span className="tabular text-xs text-ink-muted">
                Page {pagination.page} of {formatNumber(pagination.totalPages)}
              </span>
              <Button
                variant="secondary"
                disabled={!pagination.hasNextPage}
                onClick={() => setPage((current) => current + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        ) : null}
      </Card>
    </div>
  );
}

function SortableHeader({
  label,
  column,
  sortBy,
  sortOrder,
  onSort,
  align = 'left',
}: {
  label: string;
  column: SortBy;
  sortBy: SortBy;
  sortOrder: 'asc' | 'desc';
  onSort: (column: SortBy) => void;
  align?: 'left' | 'right';
}) {
  const isActive = sortBy === column;

  return (
    <th
      className={`px-4 py-2.5 font-medium ${align === 'right' ? 'text-right' : ''}`}
      // aria-sort tells a screen reader the current sort, which a caret alone does not.
      aria-sort={isActive ? (sortOrder === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <button
        type="button"
        onClick={() => onSort(column)}
        className={`inline-flex items-center gap-1 hover:text-ink ${isActive ? 'text-ink' : ''}`}
      >
        {label}
        <span aria-hidden="true" className="text-[10px]">
          {isActive ? (sortOrder === 'asc' ? '▲' : '▼') : '⇅'}
        </span>
      </button>
    </th>
  );
}
