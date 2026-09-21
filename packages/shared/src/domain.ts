/**
 * Domain vocabulary shared by the API and the web app.
 *
 * These mirror the Prisma enums. Keeping them here rather than importing the generated
 * Prisma client means the frontend gets the same constants without depending on the
 * database layer.
 */

export const EMPLOYMENT_STATUSES = ['ACTIVE', 'ON_LEAVE', 'TERMINATED'] as const;
export type EmploymentStatus = (typeof EMPLOYMENT_STATUSES)[number];

export const EMPLOYMENT_TYPES = ['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERN'] as const;
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];

/**
 * Gender is optional throughout and includes non-disclosure as a first-class value.
 * Pay-gap analysis covers only employees with a recorded MALE/FEMALE value, and the
 * dashboard states the coverage rate so a gap computed over 60% of staff is not read
 * as a gap across everyone.
 */
export const GENDERS = ['MALE', 'FEMALE', 'NON_BINARY', 'UNDISCLOSED'] as const;
export type Gender = (typeof GENDERS)[number];

/**
 * Job levels, ordered from junior to senior. The numeric suffix is load-bearing:
 * pay bands are computed per (level × country), so the level must be a closed set
 * rather than free text.
 */
export const JOB_LEVELS = ['L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L7', 'L8'] as const;
export type JobLevel = (typeof JOB_LEVELS)[number];

export const JOB_LEVEL_LABELS: Record<JobLevel, string> = {
  L1: 'L1 · Associate',
  L2: 'L2 · Junior',
  L3: 'L3 · Mid',
  L4: 'L4 · Senior',
  L5: 'L5 · Staff',
  L6: 'L6 · Principal',
  L7: 'L7 · Director',
  L8: 'L8 · VP',
};

/**
 * Why a salary record was created.
 *
 * This is the field that turns a history table into an answerable dataset: without it,
 * "how much did we spend on merit increases last year?" is unanswerable.
 */
export const SALARY_CHANGE_REASONS = [
  'HIRE',
  'MERIT_INCREASE',
  'PROMOTION',
  'MARKET_ADJUSTMENT',
  'ROLE_CHANGE',
  'CORRECTION',
  'DEMOTION',
] as const;
export type SalaryChangeReason = (typeof SALARY_CHANGE_REASONS)[number];

export const SALARY_CHANGE_REASON_LABELS: Record<SalaryChangeReason, string> = {
  HIRE: 'New hire',
  MERIT_INCREASE: 'Merit increase',
  PROMOTION: 'Promotion',
  MARKET_ADJUSTMENT: 'Market adjustment',
  ROLE_CHANGE: 'Role change',
  CORRECTION: 'Correction',
  DEMOTION: 'Demotion',
};

export const PAY_FREQUENCIES = ['ANNUAL', 'MONTHLY'] as const;
export type PayFrequency = (typeof PAY_FREQUENCIES)[number];

/** Dimensions the analytics endpoints can group by. */
export const ANALYTICS_DIMENSIONS = ['country', 'department', 'level', 'employmentType'] as const;
export type AnalyticsDimension = (typeof ANALYTICS_DIMENSIONS)[number];

export interface PaginatedResult<T> {
  data: T[];
  pagination: {
    page: number;
    pageSize: number;
    totalCount: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  };
}

export function buildPagination(
  page: number,
  pageSize: number,
  totalCount: number,
): PaginatedResult<never>['pagination'] {
  const totalPages = pageSize > 0 ? Math.ceil(totalCount / pageSize) : 0;
  return {
    page,
    pageSize,
    totalCount,
    totalPages,
    hasNextPage: page < totalPages,
    hasPreviousPage: page > 1 && totalCount > 0,
  };
}
