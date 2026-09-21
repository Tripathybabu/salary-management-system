/**
 * Test-database harness.
 *
 * Integration tests run against a real PostgreSQL database rather than a mock or
 * SQLite. That is a deliberate cost: the analytics layer is built on
 * PERCENTILE_CONT, FILTER clauses and partial indexes, and a test that mocks
 * Prisma would verify only that the mock was called — precisely the code most
 * worth testing would go untested.
 *
 * Isolation strategy: every test file truncates and builds the exact rows it
 * needs. Truncation is far cheaper than re-running migrations per file, and
 * building fixtures explicitly keeps each test readable on its own — a reader
 * never has to go and look at a shared seed to understand what a number means.
 */

import { PrismaClient, type Prisma } from '@prisma/client';

/**
 * Tests use their own database, configured via .env.test. Pointing them at the
 * development database would truncate the seeded 10,000 employees.
 */
export const prisma = new PrismaClient();

/**
 * Remove all data while leaving the schema in place.
 *
 * One statement so the tables go down together regardless of foreign keys;
 * RESTART IDENTITY keeps sequences predictable across runs.
 */
export async function resetDatabase(): Promise<void> {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE salary_records, employees, departments, countries RESTART IDENTITY CASCADE',
  );
}

export async function disconnect(): Promise<void> {
  await prisma.$disconnect();
}

/**
 * Fixed reference data. Two countries with very different currencies and cost
 * levels, because the interesting bugs in this system live in currency
 * normalisation and in cross-country comparison.
 */
export const TEST_COUNTRIES = [
  { code: 'US', name: 'United States', currencyCode: 'USD' },
  { code: 'IN', name: 'India', currencyCode: 'INR' },
] as const;

export async function seedReferenceData(): Promise<{
  engineeringId: string;
  salesId: string;
}> {
  await prisma.country.createMany({ data: [...TEST_COUNTRIES] });

  const engineering = await prisma.department.create({
    data: { name: 'Engineering', costCentre: 'CC-1000' },
  });
  const sales = await prisma.department.create({
    data: { name: 'Sales', costCentre: 'CC-2000' },
  });

  return { engineeringId: engineering.id, salesId: sales.id };
}

/** UTC midnight, matching how calendar dates are stored. See schemas.ts. */
export function date(iso: string): Date {
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(Date.UTC(year!, month! - 1, day!));
}

let employeeCounter = 0;

export function resetEmployeeCounter(): void {
  employeeCounter = 0;
}

interface EmployeeFixture {
  firstName?: string;
  lastName?: string;
  email?: string;
  countryCode?: string;
  departmentId: string;
  jobTitle?: string;
  level?: Prisma.EmployeeCreateInput['level'];
  employmentType?: Prisma.EmployeeCreateInput['employmentType'];
  status?: Prisma.EmployeeCreateInput['status'];
  gender?: Prisma.EmployeeCreateInput['gender'];
  hireDate?: Date;
  /** Annual amount in the employee's local currency. Omit for no salary record. */
  salary?: number;
  currency?: string;
  salaryUsd?: number;
  effectiveFrom?: Date;
}

/**
 * Create an employee and, unless `salary` is omitted, their open salary record.
 *
 * `salaryUsd` is supplied explicitly rather than converted here so a test can state
 * the exact USD figure its assertions depend on, keeping the expected value visible
 * in the test instead of hidden behind a conversion.
 */
export async function createTestEmployee(fixture: EmployeeFixture) {
  employeeCounter += 1;
  const code = `ACME-${String(employeeCounter).padStart(5, '0')}`;

  const employee = await prisma.employee.create({
    data: {
      employeeCode: code,
      firstName: fixture.firstName ?? 'Test',
      lastName: fixture.lastName ?? `Person${employeeCounter}`,
      email: fixture.email ?? `test.person${employeeCounter}@acme.example`,
      countryCode: fixture.countryCode ?? 'US',
      departmentId: fixture.departmentId,
      jobTitle: fixture.jobTitle ?? 'Software Engineer',
      level: fixture.level ?? 'L3',
      employmentType: fixture.employmentType ?? 'FULL_TIME',
      status: fixture.status ?? 'ACTIVE',
      gender: fixture.gender ?? 'UNDISCLOSED',
      hireDate: fixture.hireDate ?? date('2020-01-01'),
    },
  });

  if (fixture.salary !== undefined) {
    const currency = fixture.currency ?? 'USD';
    const usd = fixture.salaryUsd ?? fixture.salary;

    await prisma.salaryRecord.create({
      data: {
        employeeId: employee.id,
        baseAmount: fixture.salary.toFixed(2),
        currency,
        baseAmountUsd: usd.toFixed(2),
        annualAmountUsd: usd.toFixed(2),
        payFrequency: 'ANNUAL',
        effectiveFrom: fixture.effectiveFrom ?? fixture.hireDate ?? date('2020-01-01'),
        effectiveTo: null,
        changeReason: 'HIRE',
        changedBy: 'test',
      },
    });
  }

  return employee;
}
