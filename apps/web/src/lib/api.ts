/**
 * Typed API client.
 *
 * One place that knows how to talk to the backend: how the base URL is resolved,
 * how query strings are built, and how an error envelope becomes a thrown error.
 * Components call named functions and never touch `fetch` directly, so a change to
 * the transport is a change to this file alone.
 */

import type {
  AnalyticsDimension,
  EmploymentStatus,
  EmploymentType,
  Gender,
  JobLevel,
  PaginatedResult,
  PayFrequency,
  SalaryChangeReason,
} from '@salary/shared';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

// ---------------------------------------------------------------------------
// Response types — the contract the API actually returns.
// ---------------------------------------------------------------------------

export interface CurrentSalary {
  baseAmount: number;
  currency: string;
  annualAmountUsd: number;
  effectiveFrom: string;
}

export interface EmployeeListItem {
  id: string;
  employeeCode: string;
  firstName: string;
  lastName: string;
  email: string;
  jobTitle: string;
  level: JobLevel;
  status: EmploymentStatus;
  employmentType: EmploymentType;
  countryCode: string;
  countryName: string;
  departmentId: string;
  departmentName: string;
  hireDate: string;
  currentSalary: CurrentSalary | null;
}

export interface SalaryHistoryEntry {
  id: string;
  baseAmount: number;
  currency: string;
  baseAmountUsd: number;
  annualAmountUsd: number;
  payFrequency: PayFrequency;
  effectiveFrom: string;
  effectiveTo: string | null;
  changeReason: SalaryChangeReason;
  note: string | null;
  changedBy: string;
  isCurrent: boolean;
  changePercent: number | null;
}

export interface EmployeeDetail {
  id: string;
  employeeCode: string;
  firstName: string;
  lastName: string;
  email: string;
  jobTitle: string;
  level: JobLevel;
  status: EmploymentStatus;
  employmentType: EmploymentType;
  gender: Gender;
  countryCode: string;
  departmentId: string;
  hireDate: string;
  terminationDate: string | null;
  directReportCount: number;
  department: { id: string; name: string; costCentre: string | null };
  country: { code: string; name: string; currencyCode: string };
  manager: {
    id: string;
    firstName: string;
    lastName: string;
    jobTitle: string;
    employeeCode: string;
  } | null;
  currentSalary: {
    baseAmount: string;
    currency: string;
    annualAmountUsd: string;
    effectiveFrom: string;
  } | null;
  salaryHistory: unknown[];
}

export interface FilterOptions {
  departments: { id: string; name: string }[];
  countries: { code: string; name: string; currencyCode: string }[];
}

export interface OverviewMetrics {
  headcount: number;
  totalAnnualCostUsd: number;
  medianSalaryUsd: number;
  meanSalaryUsd: number;
  p25SalaryUsd: number;
  p75SalaryUsd: number;
  p90SalaryUsd: number;
  minSalaryUsd: number;
  maxSalaryUsd: number;
  countryCount: number;
  departmentCount: number;
}

export interface GroupBreakdown {
  key: string;
  label: string;
  headcount: number;
  totalAnnualCostUsd: number;
  medianSalaryUsd: number;
  meanSalaryUsd: number;
  p25SalaryUsd: number;
  p75SalaryUsd: number;
  costSharePercent: number;
}

export interface PayGapRow {
  key: string;
  label: string;
  maleCount: number;
  femaleCount: number;
  maleMedianUsd: number | null;
  femaleMedianUsd: number | null;
  medianGapPercent: number | null;
  meanGapPercent: number | null;
  suppressed: boolean;
}

export interface PayGapReport {
  rows: PayGapRow[];
  overall: { medianGapPercent: number | null; maleCount: number; femaleCount: number };
  coveragePercent: number;
  minGroupSize: number;
}

export interface OutlierRow {
  employeeId: string;
  employeeCode: string;
  name: string;
  jobTitle: string;
  level: JobLevel;
  countryCode: string;
  departmentName: string;
  salaryUsd: number;
  bandMedianUsd: number;
  bandSize: number;
  deviationPercent: number;
  direction: 'below' | 'above';
}

export interface TrendPoint {
  period: string;
  headcount: number;
  totalAnnualCostUsd: number;
  medianSalaryUsd: number;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * An error carrying the API's structured detail.
 *
 * `fieldErrors` is surfaced separately so a form can highlight the offending
 * input rather than showing one generic message above everything.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fieldErrors?: Record<string, string[]>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

type QueryValue = string | number | boolean | undefined | null | readonly string[];

/**
 * Build a query string, dropping empty values.
 *
 * Empty filters must not appear as `?search=&level=`: the API would treat an empty
 * string as a real filter value and return nothing.
 */
export function buildQuery(params: Record<string, QueryValue>): string {
  const search = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      if (value.length === 0) continue;
      search.set(key, value.join(','));
    } else {
      search.set(key, String(value));
    }
  }

  const query = search.toString();
  return query ? `?${query}` : '';
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;

  try {
    response = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        // Stands in for the authenticated user until auth lands; the API records
        // it on every salary change. See docs/ARCHITECTURE.md §7.
        'x-actor-id': 'hr.manager@acme.example',
        ...init?.headers,
      },
      cache: 'no-store',
    });
  } catch {
    // A network-level failure has no response body to parse, and "Failed to
    // fetch" is not an actionable message for an HR manager.
    throw new ApiError(0, 'NETWORK_ERROR', 'Could not reach the API. Is the server running?');
  }

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const error = body?.error;
    throw new ApiError(
      response.status,
      error?.code ?? 'UNKNOWN',
      error?.message ?? `Request failed with status ${response.status}`,
      error?.details,
    );
  }

  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Employees
// ---------------------------------------------------------------------------

export interface EmployeeListParams {
  page?: number;
  pageSize?: number;
  search?: string;
  countryCode?: readonly string[];
  departmentId?: readonly string[];
  level?: readonly string[];
  status?: readonly string[];
  employmentType?: readonly string[];
  minSalary?: number;
  maxSalary?: number;
  sortBy?: 'name' | 'salary' | 'hireDate' | 'level' | 'country' | 'department';
  sortOrder?: 'asc' | 'desc';
}

export function listEmployees(
  params: EmployeeListParams = {},
): Promise<PaginatedResult<EmployeeListItem>> {
  return apiFetch(`/api/employees${buildQuery(params as Record<string, QueryValue>)}`);
}

export function getEmployee(id: string): Promise<EmployeeDetail> {
  return apiFetch(`/api/employees/${id}`);
}

export function getSalaryHistory(id: string): Promise<SalaryHistoryEntry[]> {
  return apiFetch(`/api/employees/${id}/salary-history`);
}

export function getFilterOptions(): Promise<FilterOptions> {
  return apiFetch('/api/employees/filters');
}

export interface CreateEmployeeBody {
  firstName: string;
  lastName: string;
  email: string;
  countryCode: string;
  departmentId: string;
  jobTitle: string;
  level: JobLevel;
  employmentType?: EmploymentType;
  gender?: Gender;
  hireDate: string;
  baseAmount: number;
  currency: string;
  payFrequency?: PayFrequency;
}

export function createEmployee(body: CreateEmployeeBody): Promise<{ id: string }> {
  return apiFetch('/api/employees', { method: 'POST', body: JSON.stringify(body) });
}

export function updateEmployee(
  id: string,
  body: Record<string, unknown>,
): Promise<EmployeeDetail> {
  return apiFetch(`/api/employees/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
}

export interface RecordSalaryBody {
  baseAmount: number;
  currency: string;
  payFrequency?: PayFrequency;
  effectiveFrom: string;
  changeReason: SalaryChangeReason;
  note?: string;
}

export interface SalaryChangeResult {
  record: {
    id: string;
    baseAmount: number;
    currency: string;
    annualAmountUsd: number;
    effectiveFrom: string;
    changeReason: SalaryChangeReason;
  };
  previous: { baseAmount: number; currency: string; annualAmountUsd: number } | null;
  changePercent: number | null;
}

export function recordSalaryChange(
  id: string,
  body: RecordSalaryBody,
): Promise<SalaryChangeResult> {
  return apiFetch(`/api/employees/${id}/salary`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------------
// Analytics
// ---------------------------------------------------------------------------

export interface AnalyticsParams {
  dimension?: AnalyticsDimension;
  countryCode?: string;
  departmentId?: string;
  level?: JobLevel;
  activeOnly?: boolean;
}

export function getOverview(params: AnalyticsParams = {}): Promise<OverviewMetrics> {
  return apiFetch(`/api/analytics/overview${buildQuery(params as Record<string, QueryValue>)}`);
}

export function getBreakdown(
  params: AnalyticsParams = {},
): Promise<{ dimension: AnalyticsDimension; groups: GroupBreakdown[] }> {
  return apiFetch(`/api/analytics/breakdown${buildQuery(params as Record<string, QueryValue>)}`);
}

export function getPayGap(params: AnalyticsParams = {}): Promise<PayGapReport> {
  return apiFetch(`/api/analytics/pay-gap${buildQuery(params as Record<string, QueryValue>)}`);
}

export interface OutlierParams extends AnalyticsParams {
  thresholdPercent?: number;
  direction?: 'below' | 'above' | 'both';
  minBandSize?: number;
  limit?: number;
}

export function getOutliers(params: OutlierParams = {}): Promise<{
  thresholdPercent: number;
  direction: string;
  outliers: OutlierRow[];
}> {
  return apiFetch(`/api/analytics/outliers${buildQuery(params as Record<string, QueryValue>)}`);
}

export function getTrend(
  params: AnalyticsParams & { months?: number } = {},
): Promise<{ months: number; points: TrendPoint[] }> {
  return apiFetch(`/api/analytics/trend${buildQuery(params as Record<string, QueryValue>)}`);
}
