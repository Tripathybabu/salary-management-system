/**
 * Employee queries and mutations.
 *
 * The design constraint throughout: 10,000 employees must never all be loaded into
 * Node. Filtering, sorting, and pagination happen in Postgres.
 */

import { Prisma } from '@prisma/client';
import {
  buildPagination,
  convertToBaseCurrency,
  type CurrencyCode,
  type EmployeeQueryParsed,
  type CreateEmployeeParsed,
  type PaginatedResult,
} from '@salary/shared';
import { prisma } from '../lib/prisma.js';
import { NotFoundError, ConflictError } from '../lib/errors.js';

export interface EmployeeListItem {
  id: string;
  employeeCode: string;
  firstName: string;
  lastName: string;
  email: string;
  jobTitle: string;
  level: string;
  status: string;
  employmentType: string;
  countryCode: string;
  countryName: string;
  departmentId: string;
  departmentName: string;
  hireDate: Date;
  currentSalary: {
    baseAmount: number;
    currency: string;
    annualAmountUsd: number;
    effectiveFrom: Date;
  } | null;
}

/**
 * Map a sort key to its SQL expression.
 *
 * A lookup table rather than string interpolation of user input: `sortBy` reaches
 * raw SQL, so it must only ever be one of these fixed expressions. The Zod enum
 * already constrains it, but defence in depth is cheap here and SQL injection via
 * an ORDER BY clause is a classic hole.
 */
const SORT_EXPRESSIONS = {
  name: 'e.last_name, e.first_name',
  salary: 'cur.annual_amount_usd',
  hireDate: 'e.hire_date',
  level: 'e.level',
  country: 'e.country_code',
  department: 'd.name',
} as const satisfies Record<EmployeeQueryParsed['sortBy'], string>;

/**
 * List employees with filtering, sorting and pagination.
 *
 * Written as raw SQL rather than a Prisma query for one reason: "sort by current
 * salary" requires joining the open salary record and ordering by it. Prisma cannot
 * express an ordered join on a filtered relation, and the alternatives - fetching
 * everything and sorting in Node, or N+1 salary lookups - both fail at 10k rows.
 *
 * Every user value is passed as a bound parameter; only the sort expression is
 * interpolated, and only from the fixed table above.
 */
export async function listEmployees(
  query: EmployeeQueryParsed,
): Promise<PaginatedResult<EmployeeListItem>> {
  const conditions: Prisma.Sql[] = [];

  if (query.search) {
    // Matched against the same lowercased expressions the trigram indexes cover.
    const term = `%${query.search.toLowerCase()}%`;
    conditions.push(
      Prisma.sql`(
        LOWER(e.first_name) || ' ' || LOWER(e.last_name) LIKE ${term}
        OR LOWER(e.email) LIKE ${term}
        OR LOWER(e.employee_code) LIKE ${term}
      )`,
    );
  }

  if (query.countryCode?.length) {
    conditions.push(Prisma.sql`e.country_code IN (${Prisma.join(query.countryCode)})`);
  }
  if (query.departmentId?.length) {
    conditions.push(
      Prisma.sql`e.department_id IN (${Prisma.join(
        query.departmentId.map((id) => Prisma.sql`${id}::uuid`),
      )})`,
    );
  }
  if (query.level?.length) {
    conditions.push(
      Prisma.sql`e.level IN (${Prisma.join(query.level.map((l) => Prisma.sql`${l}::"JobLevel"`))})`,
    );
  }
  if (query.status?.length) {
    conditions.push(
      Prisma.sql`e.status IN (${Prisma.join(
        query.status.map((s) => Prisma.sql`${s}::"EmploymentStatus"`),
      )})`,
    );
  }
  if (query.employmentType?.length) {
    conditions.push(
      Prisma.sql`e.employment_type IN (${Prisma.join(
        query.employmentType.map((t) => Prisma.sql`${t}::"EmploymentType"`),
      )})`,
    );
  }

  // Salary filters compare normalised USD so a range means the same thing regardless
  // of the employee's local currency.
  if (query.minSalary !== undefined) {
    conditions.push(Prisma.sql`cur.annual_amount_usd >= ${query.minSalary}`);
  }
  if (query.maxSalary !== undefined) {
    conditions.push(Prisma.sql`cur.annual_amount_usd <= ${query.maxSalary}`);
  }

  const where =
    conditions.length > 0
      ? Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`
      : Prisma.empty;

  // LEFT JOIN, not INNER: a terminated employee has no open salary record, and an
  // inner join would silently drop them from the list entirely.
  const fromClause = Prisma.sql`
    FROM employees e
    JOIN departments d ON d.id = e.department_id
    JOIN countries c ON c.code = e.country_code
    LEFT JOIN salary_records cur
      ON cur.employee_id = e.id AND cur.effective_to IS NULL
  `;

  const direction = query.sortOrder === 'desc' ? 'DESC' : 'ASC';
  // NULLS LAST keeps employees without a current salary at the end rather than
  // heading the list when sorting by pay.
  const orderBy = Prisma.raw(
    `ORDER BY ${SORT_EXPRESSIONS[query.sortBy]} ${direction} NULLS LAST, e.id ASC`,
  );

  const offset = (query.page - 1) * query.pageSize;

  // Count and page fetched concurrently - they are independent queries.
  const [rows, countResult] = await Promise.all([
    prisma.$queryRaw<RawEmployeeRow[]>`
      SELECT
        e.id, e.employee_code, e.first_name, e.last_name, e.email,
        e.job_title, e.level::text AS level, e.status::text AS status,
        e.employment_type::text AS employment_type,
        e.country_code, c.name AS country_name,
        e.department_id, d.name AS department_name,
        e.hire_date,
        cur.base_amount, cur.currency, cur.annual_amount_usd, cur.effective_from
      ${fromClause}
      ${where}
      ${orderBy}
      LIMIT ${query.pageSize} OFFSET ${offset}
    `,
    prisma.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(*)::bigint AS count ${fromClause} ${where}
    `,
  ]);

  // COUNT returns bigint, which JSON.stringify cannot serialise.
  const totalCount = Number(countResult[0]?.count ?? 0);

  return {
    data: rows.map(toEmployeeListItem),
    pagination: buildPagination(query.page, query.pageSize, totalCount),
  };
}

interface RawEmployeeRow {
  id: string;
  employee_code: string;
  first_name: string;
  last_name: string;
  email: string;
  job_title: string;
  level: string;
  status: string;
  employment_type: string;
  country_code: string;
  country_name: string;
  department_id: string;
  department_name: string;
  hire_date: Date;
  base_amount: Prisma.Decimal | null;
  currency: string | null;
  annual_amount_usd: Prisma.Decimal | null;
  effective_from: Date | null;
}

function toEmployeeListItem(row: RawEmployeeRow): EmployeeListItem {
  return {
    id: row.id,
    employeeCode: row.employee_code,
    firstName: row.first_name,
    lastName: row.last_name,
    email: row.email,
    jobTitle: row.job_title,
    level: row.level,
    status: row.status,
    employmentType: row.employment_type,
    countryCode: row.country_code,
    countryName: row.country_name,
    departmentId: row.department_id,
    departmentName: row.department_name,
    hireDate: row.hire_date,
    currentSalary:
      row.annual_amount_usd !== null && row.base_amount !== null
        ? {
            baseAmount: row.base_amount.toNumber(),
            currency: row.currency!,
            annualAmountUsd: row.annual_amount_usd.toNumber(),
            effectiveFrom: row.effective_from!,
          }
        : null,
  };
}

/** Full employee detail, including the complete salary history. */
export async function getEmployeeById(id: string) {
  const employee = await prisma.employee.findUnique({
    where: { id },
    include: {
      department: true,
      country: true,
      manager: {
        select: { id: true, firstName: true, lastName: true, jobTitle: true, employeeCode: true },
      },
      salaryRecords: { orderBy: { effectiveFrom: 'desc' } },
      _count: { select: { reports: true } },
    },
  });

  if (!employee) throw new NotFoundError('Employee', id);

  const { salaryRecords, ...rest } = employee;

  return {
    ...rest,
    directReportCount: employee._count.reports,
    currentSalary: salaryRecords.find((record) => record.effectiveTo === null) ?? null,
    salaryHistory: salaryRecords,
  };
}

/**
 * Create an employee together with their initial salary record.
 *
 * Both writes happen in one transaction: an employee with no salary record would be
 * invisible to every analytics query, so a half-completed create is worse than a
 * failed one.
 */
export async function createEmployee(input: CreateEmployeeParsed, actor = 'system') {
  const [department, country, existingEmail] = await Promise.all([
    prisma.department.findUnique({ where: { id: input.departmentId } }),
    prisma.country.findUnique({ where: { code: input.countryCode } }),
    prisma.employee.findUnique({ where: { email: input.email }, select: { id: true } }),
  ]);

  if (!department) throw new NotFoundError('Department', input.departmentId);
  if (!country) throw new NotFoundError('Country', input.countryCode);
  if (existingEmail) throw new ConflictError(`An employee with email '${input.email}' already exists`);

  if (input.managerId) {
    const manager = await prisma.employee.findUnique({
      where: { id: input.managerId },
      select: { id: true },
    });
    if (!manager) throw new NotFoundError('Manager', input.managerId);
  }

  const currency = input.currency as CurrencyCode;
  const amountUsd = convertToBaseCurrency(input.baseAmount, currency);
  const annualUsd = input.payFrequency === 'MONTHLY' ? amountUsd * 12 : amountUsd;

  return prisma.$transaction(async (tx) => {
    const employeeCode = await nextEmployeeCode(tx);

    const employee = await tx.employee.create({
      data: {
        employeeCode,
        firstName: input.firstName,
        lastName: input.lastName,
        email: input.email,
        countryCode: input.countryCode,
        departmentId: input.departmentId,
        jobTitle: input.jobTitle,
        level: input.level,
        employmentType: input.employmentType,
        gender: input.gender,
        hireDate: input.hireDate,
        managerId: input.managerId ?? null,
      },
    });

    await tx.salaryRecord.create({
      data: {
        employeeId: employee.id,
        baseAmount: new Prisma.Decimal(input.baseAmount.toFixed(2)),
        currency,
        baseAmountUsd: new Prisma.Decimal(amountUsd.toFixed(2)),
        annualAmountUsd: new Prisma.Decimal(annualUsd.toFixed(2)),
        payFrequency: input.payFrequency,
        effectiveFrom: input.hireDate,
        effectiveTo: null,
        changeReason: 'HIRE',
        changedBy: actor,
      },
    });

    return employee;
  });
}

/**
 * Allocate the next employee code.
 *
 * Derived from the current maximum rather than a counter table. Runs inside the
 * caller's transaction so two concurrent creates cannot read the same maximum - the
 * unique constraint on employee_code is the final backstop.
 */
async function nextEmployeeCode(tx: Prisma.TransactionClient): Promise<string> {
  const result = await tx.$queryRaw<[{ max_code: string | null }]>`
    SELECT MAX(employee_code) AS max_code FROM employees
    WHERE employee_code ~ '^ACME-[0-9]+$'
  `;

  const current = result[0]?.max_code;
  const nextNumber = current ? Number.parseInt(current.slice(5), 10) + 1 : 1;
  return `ACME-${String(nextNumber).padStart(5, '0')}`;
}

/** Update employee attributes. Compensation is deliberately not updatable here. */
export async function updateEmployee(
  id: string,
  input: Record<string, unknown>,
  _actor = 'system',
) {
  const existing = await prisma.employee.findUnique({ where: { id }, select: { id: true } });
  if (!existing) throw new NotFoundError('Employee', id);

  if (typeof input.managerId === 'string') {
    if (input.managerId === id) {
      throw new ConflictError('An employee cannot be their own manager');
    }
    const manager = await prisma.employee.findUnique({
      where: { id: input.managerId },
      select: { id: true },
    });
    if (!manager) throw new NotFoundError('Manager', input.managerId);
  }

  if (typeof input.email === 'string') {
    const clash = await prisma.employee.findUnique({
      where: { email: input.email },
      select: { id: true },
    });
    if (clash && clash.id !== id) {
      throw new ConflictError(`An employee with email '${input.email}' already exists`);
    }
  }

  return prisma.employee.update({ where: { id }, data: input as Prisma.EmployeeUpdateInput });
}

/** Filter options for the list view's dropdowns. */
export async function getFilterOptions() {
  const [departments, countries] = await Promise.all([
    prisma.department.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } }),
    prisma.country.findMany({
      orderBy: { name: 'asc' },
      select: { code: true, name: true, currencyCode: true },
    }),
  ]);
  return { departments, countries };
}
