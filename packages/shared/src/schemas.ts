/**
 * Validation schemas, shared between the API boundary and the web app's forms.
 *
 * Defining these once is the main reason this monorepo has a shared package: the rules
 * the server enforces and the rules the form displays are the same object, so they
 * cannot drift apart.
 */

import { z } from 'zod';
import {
  EMPLOYMENT_STATUSES,
  EMPLOYMENT_TYPES,
  GENDERS,
  JOB_LEVELS,
  SALARY_CHANGE_REASONS,
  PAY_FREQUENCIES,
  ANALYTICS_DIMENSIONS,
} from './domain.js';
import { CURRENCIES } from './money.js';

const currencyCodes = Object.keys(CURRENCIES) as [string, ...string[]];

/**
 * Accepts a `YYYY-MM-DD` string or a Date, and normalises to a UTC midnight Date.
 *
 * Salary effective dates are calendar dates, not instants. Parsing "2026-03-01" with
 * `new Date()` in a UTC+5:30 timezone yields a local-time value that can serialise back
 * as February 28th, which would silently shift an effective date across a month
 * boundary. Constructing at UTC midnight avoids that entirely.
 */
export const calendarDateSchema = z
  .union([z.string(), z.date()])
  .transform((value, ctx) => {
    if (value instanceof Date) {
      if (Number.isNaN(value.getTime())) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid date' });
        return z.NEVER;
      }
      return new Date(
        Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()),
      );
    }

    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
    if (!match) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Date must be in YYYY-MM-DD format',
      });
      return z.NEVER;
    }

    const [, year, month, day] = match;
    const parsed = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));

    // Catches calendar-invalid dates like 2026-02-31, which Date would roll forward
    // to March 3rd rather than reject.
    if (
      parsed.getUTCFullYear() !== Number(year) ||
      parsed.getUTCMonth() !== Number(month) - 1 ||
      parsed.getUTCDate() !== Number(day)
    ) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Date is not a valid calendar date' });
      return z.NEVER;
    }
    return parsed;
  });

/**
 * A salary amount.
 *
 * Capped at 100 million to catch a misplaced decimal point or a paste error before it
 * reaches the database and distorts every aggregate on the dashboard. Multiplied by two
 * decimal places, so fractional cents are rejected rather than silently rounded.
 */
export const salaryAmountSchema = z
  .number({ invalid_type_error: 'Salary must be a number' })
  .finite('Salary must be a finite number')
  .positive('Salary must be greater than zero')
  .max(100_000_000, 'Salary exceeds the maximum supported value')
  .refine(
    (value) => Number.isInteger(Math.round(value * 100)) && Math.abs(value * 100 - Math.round(value * 100)) < 1e-6,
    'Salary cannot have more than two decimal places',
  );

export const currencySchema = z.enum(currencyCodes, {
  errorMap: () => ({ message: 'Unsupported currency code' }),
});

export const createEmployeeSchema = z.object({
  firstName: z.string().trim().min(1, 'First name is required').max(100),
  lastName: z.string().trim().min(1, 'Last name is required').max(100),
  email: z.string().trim().toLowerCase().email('Must be a valid email address').max(255),
  countryCode: z
    .string()
    .trim()
    .toUpperCase()
    .length(2, 'Country must be a 2-letter ISO code'),
  departmentId: z.string().uuid('Department is required'),
  jobTitle: z.string().trim().min(1, 'Job title is required').max(150),
  level: z.enum(JOB_LEVELS),
  employmentType: z.enum(EMPLOYMENT_TYPES).default('FULL_TIME'),
  gender: z.enum(GENDERS).default('UNDISCLOSED'),
  hireDate: calendarDateSchema,
  managerId: z.string().uuid().nullish(),

  // Starting compensation. Required at creation: an employee with no salary record
  // would be invisible to every analytics query, which is worse than rejecting the input.
  baseAmount: salaryAmountSchema,
  currency: currencySchema,
  payFrequency: z.enum(PAY_FREQUENCIES).default('ANNUAL'),
});

export type CreateEmployeeInput = z.input<typeof createEmployeeSchema>;
export type CreateEmployeeParsed = z.output<typeof createEmployeeSchema>;

/**
 * Updating an employee never touches compensation — that goes through the salary
 * endpoint so it produces a history record. Omitting the salary fields here is the
 * mechanism that makes the audit trail unbypassable.
 */
export const updateEmployeeSchema = createEmployeeSchema
  .omit({ baseAmount: true, currency: true, payFrequency: true })
  .partial()
  .refine((data) => Object.keys(data).length > 0, 'At least one field must be provided');

export type UpdateEmployeeInput = z.input<typeof updateEmployeeSchema>;

export const createSalaryRecordSchema = z.object({
  baseAmount: salaryAmountSchema,
  currency: currencySchema,
  payFrequency: z.enum(PAY_FREQUENCIES).default('ANNUAL'),
  effectiveFrom: calendarDateSchema,
  changeReason: z.enum(SALARY_CHANGE_REASONS),
  note: z.string().trim().max(500).optional(),
});

export type CreateSalaryRecordInput = z.input<typeof createSalaryRecordSchema>;

/** Comma-separated query parameter (`?level=L3,L4`) to array. */
const csvArray = <T extends readonly [string, ...string[]]>(values: T) =>
  z
    .union([z.string(), z.array(z.enum(values))])
    .optional()
    .transform((value) => {
      if (value === undefined) return undefined;
      if (Array.isArray(value)) return value;
      const parts = value.split(',').map((part) => part.trim()).filter(Boolean);
      return parts.length > 0 ? parts : undefined;
    })
    .pipe(z.array(z.enum(values)).optional());

export const employeeQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  // Capped at 100: the point of server-side pagination is that a client cannot ask
  // for all 10,000 rows in one request.
  pageSize: z.coerce.number().int().positive().max(100).default(25),
  search: z.string().trim().max(200).optional(),
  countryCode: z
    .string()
    .trim()
    .toUpperCase()
    .optional()
    .transform((v) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : undefined)),
  departmentId: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : undefined)),
  level: csvArray(JOB_LEVELS),
  status: csvArray(EMPLOYMENT_STATUSES),
  employmentType: csvArray(EMPLOYMENT_TYPES),
  minSalary: z.coerce.number().nonnegative().optional(),
  maxSalary: z.coerce.number().positive().optional(),
  sortBy: z
    .enum(['name', 'salary', 'hireDate', 'level', 'country', 'department'])
    .default('name'),
  sortOrder: z.enum(['asc', 'desc']).default('asc'),
})
  .refine(
    (q) => q.minSalary === undefined || q.maxSalary === undefined || q.minSalary <= q.maxSalary,
    { message: 'minSalary cannot exceed maxSalary', path: ['minSalary'] },
  );

export type EmployeeQueryInput = z.input<typeof employeeQuerySchema>;
export type EmployeeQueryParsed = z.output<typeof employeeQuerySchema>;

export const analyticsQuerySchema = z.object({
  dimension: z.enum(ANALYTICS_DIMENSIONS).default('department'),
  countryCode: z.string().trim().toUpperCase().length(2).optional(),
  departmentId: z.string().uuid().optional(),
  level: z.enum(JOB_LEVELS).optional(),
  /** Restrict to currently-employed staff. Defaults on: leavers distort headcount cost. */
  activeOnly: z
    .union([z.boolean(), z.string()])
    .default(true)
    .transform((v) => (typeof v === 'boolean' ? v : v !== 'false')),
});

export type AnalyticsQueryInput = z.input<typeof analyticsQuerySchema>;

export const outlierQuerySchema = z.object({
  thresholdPercent: z.coerce.number().min(1).max(90).default(20),
  direction: z.enum(['below', 'above', 'both']).default('below'),
  minBandSize: z.coerce.number().int().min(2).max(100).default(5),
  limit: z.coerce.number().int().positive().max(200).default(50),
});

export type OutlierQueryInput = z.input<typeof outlierQuerySchema>;
