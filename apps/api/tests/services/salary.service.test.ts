/**
 * Salary change invariants.
 *
 * This is the most important test file in the API. The system's central claim is
 * that compensation history is complete and never silently overwritten; these
 * tests are what make that claim checkable rather than aspirational.
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import {
  prisma,
  resetDatabase,
  seedReferenceData,
  createTestEmployee,
  resetEmployeeCounter,
  disconnect,
  date,
} from '../helpers/database.js';
import { recordSalaryChange, getSalaryHistory } from '../../src/services/salary.service.js';
import { NotFoundError, ConflictError, BusinessRuleError } from '../../src/lib/errors.js';

let engineeringId: string;

beforeEach(async () => {
  await resetDatabase();
  resetEmployeeCounter();
  ({ engineeringId } = await seedReferenceData());
});

afterAll(disconnect);

const MISSING_ID = '11111111-1111-4111-8111-111111111111';

/** The standard input, so each test states only the field it is about. */
function salaryInput(overrides: Partial<Parameters<typeof recordSalaryChange>[1]> = {}) {
  return {
    baseAmount: 120_000,
    currency: 'USD',
    payFrequency: 'ANNUAL' as const,
    effectiveFrom: date('2025-01-01'),
    changeReason: 'MERIT_INCREASE' as const,
    ...overrides,
  };
}

/** An employee on 100k USD since 2020, the starting point for most cases here. */
function employeeOn100k(effectiveFrom = date('2020-01-01')) {
  return createTestEmployee({
    departmentId: engineeringId,
    salary: 100_000,
    hireDate: date('2020-01-01'),
    effectiveFrom,
  });
}

describe('recordSalaryChange', () => {
  it('closes the previous record the day before the new one starts', async () => {
    const employee = await employeeOn100k();

    await recordSalaryChange(employee.id, salaryInput({ effectiveFrom: date('2025-03-01') }));

    const records = await prisma.salaryRecord.findMany({
      where: { employeeId: employee.id },
      orderBy: { effectiveFrom: 'asc' },
    });

    expect(records).toHaveLength(2);
    // Contiguous: the old period ends exactly one day before the new one begins,
    // so a point-in-time query on any date resolves to exactly one record.
    expect(records[0]!.effectiveTo).toEqual(date('2025-02-28'));
    expect(records[1]!.effectiveFrom).toEqual(date('2025-03-01'));
    expect(records[1]!.effectiveTo).toBeNull();
  });

  it('leaves exactly one open record after several changes', async () => {
    const employee = await employeeOn100k();

    await recordSalaryChange(employee.id, salaryInput({ effectiveFrom: date('2023-01-01'), baseAmount: 110_000 }));
    await recordSalaryChange(employee.id, salaryInput({ effectiveFrom: date('2024-01-01'), baseAmount: 125_000 }));
    await recordSalaryChange(employee.id, salaryInput({ effectiveFrom: date('2025-01-01'), baseAmount: 140_000 }));

    const open = await prisma.salaryRecord.findMany({
      where: { employeeId: employee.id, effectiveTo: null },
    });

    expect(open).toHaveLength(1);
    expect(open[0]!.baseAmount.toNumber()).toBe(140_000);

    // The history is preserved in full - this is the whole point of the model.
    expect(await prisma.salaryRecord.count({ where: { employeeId: employee.id } })).toBe(4);
  });

  it('never mutates the amount on a superseded record', async () => {
    const employee = await employeeOn100k();
    const original = await prisma.salaryRecord.findFirstOrThrow({
      where: { employeeId: employee.id },
    });

    await recordSalaryChange(employee.id, salaryInput());

    const after = await prisma.salaryRecord.findUniqueOrThrow({ where: { id: original.id } });
    // Only effectiveTo may change. The amount and the reason are immutable history.
    expect(after.baseAmount.toNumber()).toBe(100_000);
    expect(after.changeReason).toBe('HIRE');
  });

  it('normalises a non-USD amount to USD at write time', async () => {
    const employee = await createTestEmployee({
      departmentId: engineeringId,
      countryCode: 'IN',
      salary: 2_000_000,
      currency: 'INR',
      salaryUsd: 24_038.46,
      hireDate: date('2020-01-01'),
      effectiveFrom: date('2020-01-01'),
    });

    const result = await recordSalaryChange(
      employee.id,
      salaryInput({ baseAmount: 3_328_000, currency: 'INR' }),
    );

    // 3,328,000 INR at the fixed rate of 83.2 per USD is exactly 40,000 USD.
    expect(result.record.annualAmountUsd).toBe(40_000);
  });

  it('annualises a monthly salary so payroll cost is not understated 12x', async () => {
    const employee = await employeeOn100k();

    const result = await recordSalaryChange(
      employee.id,
      salaryInput({ baseAmount: 10_000, payFrequency: 'MONTHLY' }),
    );

    expect(result.record.annualAmountUsd).toBe(120_000);
    // The local amount stays as entered - it is what the employee is actually paid.
    expect(result.record.baseAmount).toBe(10_000);
  });

  it('reports the percentage change against the previous salary', async () => {
    const employee = await employeeOn100k();

    const result = await recordSalaryChange(employee.id, salaryInput({ baseAmount: 110_000 }));

    expect(result.changePercent).toBe(10);
    expect(result.previous?.baseAmount).toBe(100_000);
  });

  it('withholds the percentage change when the currency changed', async () => {
    // An employee relocating from India to the US has a new salary in a new
    // currency. A percentage here would attribute the FX difference to a pay
    // rise, putting a false number on the raise history.
    const employee = await createTestEmployee({
      departmentId: engineeringId,
      countryCode: 'IN',
      salary: 2_000_000,
      currency: 'INR',
      salaryUsd: 24_038.46,
      hireDate: date('2020-01-01'),
      effectiveFrom: date('2020-01-01'),
    });

    const result = await recordSalaryChange(employee.id, salaryInput({ currency: 'USD' }));

    expect(result.changePercent).toBeNull();
  });

  it('records the acting user for the audit trail', async () => {
    const employee = await employeeOn100k();

    await recordSalaryChange(employee.id, salaryInput(), 'hr.manager@acme.example');

    const current = await prisma.salaryRecord.findFirstOrThrow({
      where: { employeeId: employee.id, effectiveTo: null },
    });
    expect(current.changedBy).toBe('hr.manager@acme.example');
  });

  it('creates the first record for an employee who has none', async () => {
    const employee = await createTestEmployee({
      departmentId: engineeringId,
      hireDate: date('2020-01-01'),
      // No salary fixture: there is nothing to close.
    });

    const result = await recordSalaryChange(employee.id, salaryInput());

    expect(result.previous).toBeNull();
    expect(result.changePercent).toBeNull();
    expect(await prisma.salaryRecord.count({ where: { employeeId: employee.id } })).toBe(1);
  });
});

describe('recordSalaryChange - rejected changes', () => {
  it('rejects an unknown employee', async () => {
    await expect(recordSalaryChange(MISSING_ID, salaryInput())).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('rejects a change for a terminated employee', async () => {
    const employee = await createTestEmployee({
      departmentId: engineeringId,
      status: 'TERMINATED',
      salary: 100_000,
      hireDate: date('2020-01-01'),
      effectiveFrom: date('2020-01-01'),
    });

    await expect(recordSalaryChange(employee.id, salaryInput())).rejects.toBeInstanceOf(
      BusinessRuleError,
    );
  });

  it('rejects an effective date before the hire date', async () => {
    const employee = await createTestEmployee({
      departmentId: engineeringId,
      salary: 100_000,
      hireDate: date('2024-06-01'),
      effectiveFrom: date('2024-06-01'),
    });

    await expect(
      recordSalaryChange(employee.id, salaryInput({ effectiveFrom: date('2024-01-01') })),
    ).rejects.toBeInstanceOf(BusinessRuleError);
  });

  it('rejects backdating before the current record and leaves history untouched', async () => {
    const employee = await employeeOn100k(date('2024-01-01'));

    await expect(
      recordSalaryChange(employee.id, salaryInput({ effectiveFrom: date('2023-06-01') })),
    ).rejects.toBeInstanceOf(ConflictError);

    // The rejection must not half-apply: the original record is still open.
    const records = await prisma.salaryRecord.findMany({ where: { employeeId: employee.id } });
    expect(records).toHaveLength(1);
    expect(records[0]!.effectiveTo).toBeNull();
  });

  it('rejects an effective date equal to the current record', async () => {
    const employee = await employeeOn100k(date('2024-01-01'));

    await expect(
      recordSalaryChange(employee.id, salaryInput({ effectiveFrom: date('2024-01-01') })),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});

describe('concurrent salary changes', () => {
  it('never leaves two open records when two raises race', async () => {
    // The scenario Serializable isolation exists for: two HR users submitting a
    // raise for the same person at the same moment. One must win and the other
    // must fail cleanly. Two open records would be unacceptable, because
    // "current salary" would then be ambiguous.
    const employee = await employeeOn100k();

    const results = await Promise.allSettled([
      recordSalaryChange(employee.id, salaryInput({ baseAmount: 110_000 })),
      recordSalaryChange(employee.id, salaryInput({ baseAmount: 120_000 })),
    ]);

    const open = await prisma.salaryRecord.findMany({
      where: { employeeId: employee.id, effectiveTo: null },
    });

    expect(open).toHaveLength(1);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  });
});

describe('getSalaryHistory', () => {
  it('returns records newest first, annotated with the change from the prior one', async () => {
    const employee = await employeeOn100k();

    await recordSalaryChange(employee.id, salaryInput({ effectiveFrom: date('2023-01-01'), baseAmount: 110_000 }));
    await recordSalaryChange(employee.id, salaryInput({ effectiveFrom: date('2025-01-01'), baseAmount: 132_000 }));

    const history = await getSalaryHistory(employee.id);

    expect(history).toHaveLength(3);
    expect(history[0]!.baseAmount).toBe(132_000);
    expect(history[0]!.isCurrent).toBe(true);
    expect(history[0]!.changePercent).toBe(20);
    expect(history[1]!.changePercent).toBe(10);
    // The oldest record has nothing to compare against.
    expect(history[2]!.changePercent).toBeNull();
    expect(history[2]!.isCurrent).toBe(false);
  });

  it('rejects an unknown employee rather than returning an empty history', async () => {
    // An empty array would read as "this person has never been paid", which is a
    // different and more alarming statement than "this person does not exist".
    await expect(getSalaryHistory(MISSING_ID)).rejects.toBeInstanceOf(NotFoundError);
  });
});
