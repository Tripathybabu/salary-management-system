/**
 * Salary changes.
 *
 * The whole system's integrity rests on this file. Recording a change means closing
 * the current record and opening a new one — two writes that must both succeed, and
 * which must not interleave with a concurrent change to the same employee.
 */

import { Prisma } from '@prisma/client';
import {
  convertToBaseCurrency,
  percentageChange,
  type CurrencyCode,
  type CreateSalaryRecordInput,
} from '@salary/shared';
import { prisma } from '../lib/prisma.js';
import { NotFoundError, ConflictError, BusinessRuleError } from '../lib/errors.js';

type ParsedSalaryInput = {
  baseAmount: number;
  currency: string;
  payFrequency: 'ANNUAL' | 'MONTHLY';
  effectiveFrom: Date;
  changeReason:
    | 'HIRE'
    | 'MERIT_INCREASE'
    | 'PROMOTION'
    | 'MARKET_ADJUSTMENT'
    | 'ROLE_CHANGE'
    | 'CORRECTION'
    | 'DEMOTION';
  note?: string;
};

export interface SalaryChangeResult {
  record: {
    id: string;
    baseAmount: number;
    currency: string;
    annualAmountUsd: number;
    effectiveFrom: Date;
    changeReason: string;
  };
  previous: {
    baseAmount: number;
    currency: string;
    annualAmountUsd: number;
  } | null;
  /** Percentage change vs the previous salary, in the employee's own currency. */
  changePercent: number | null;
}

/**
 * Record a salary change.
 *
 * Runs inside a transaction at Serializable isolation. The reasoning:
 *
 * Read-then-write is the classic race — two concurrent raises both read the same
 * current record, both close it, and both insert an open row. The partial unique
 * index would reject the second insert, so the data can never actually corrupt, but
 * the caller would see an opaque constraint violation. Serializable turns that into
 * a clean, retryable serialization failure, and the current record is re-read
 * *inside* the transaction so the decision is made on committed state.
 */
export async function recordSalaryChange(
  employeeId: string,
  input: ParsedSalaryInput,
  actor = 'system',
): Promise<SalaryChangeResult> {
  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: { id: true, status: true, hireDate: true, terminationDate: true },
  });

  if (!employee) throw new NotFoundError('Employee', employeeId);

  if (employee.status === 'TERMINATED') {
    throw new BusinessRuleError(
      'Cannot record a salary change for a terminated employee',
    );
  }

  // A salary cannot start before the person joined.
  if (input.effectiveFrom < employee.hireDate) {
    throw new BusinessRuleError(
      `Effective date cannot precede the hire date (${formatDate(employee.hireDate)})`,
    );
  }

  const currency = input.currency as CurrencyCode;
  const amountUsd = convertToBaseCurrency(input.baseAmount, currency);
  const annualUsd = input.payFrequency === 'MONTHLY' ? amountUsd * 12 : amountUsd;

  return prisma.$transaction(
    async (tx) => {
      // Re-read inside the transaction: anything read before BEGIN is a stale
      // snapshot and cannot be the basis for closing a record.
      const current = await tx.salaryRecord.findFirst({
        where: { employeeId, effectiveTo: null },
        orderBy: { effectiveFrom: 'desc' },
      });

      if (current) {
        // Backdating before the current record's start would leave the history
        // out of order and make point-in-time queries ambiguous. Corrections to
        // an earlier period need a different operation than "change pay now".
        if (input.effectiveFrom <= current.effectiveFrom) {
          throw new ConflictError(
            `Effective date must be after the current salary's start date ` +
              `(${formatDate(current.effectiveFrom)}). To amend an earlier period, ` +
              `correct that record directly.`,
          );
        }

        // The previous record ends the day before the new one begins, so the two
        // are contiguous with no gap and no overlap.
        await tx.salaryRecord.update({
          where: { id: current.id },
          data: { effectiveTo: previousDay(input.effectiveFrom) },
        });
      }

      const created = await tx.salaryRecord.create({
        data: {
          employeeId,
          baseAmount: new Prisma.Decimal(input.baseAmount.toFixed(2)),
          currency,
          baseAmountUsd: new Prisma.Decimal(amountUsd.toFixed(2)),
          annualAmountUsd: new Prisma.Decimal(annualUsd.toFixed(2)),
          payFrequency: input.payFrequency,
          effectiveFrom: input.effectiveFrom,
          effectiveTo: null,
          changeReason: input.changeReason,
          note: input.note ?? null,
          changedBy: actor,
        },
      });

      // Percentage change is computed in the employee's own currency. Comparing
      // USD-normalised figures would attribute an FX difference to a pay rise.
      const previousAmount = current ? current.baseAmount.toNumber() : null;
      const comparable = current !== null && current.currency === currency;

      return {
        record: {
          id: created.id,
          baseAmount: created.baseAmount.toNumber(),
          currency: created.currency,
          annualAmountUsd: created.annualAmountUsd.toNumber(),
          effectiveFrom: created.effectiveFrom,
          changeReason: created.changeReason,
        },
        previous: current
          ? {
              baseAmount: current.baseAmount.toNumber(),
              currency: current.currency,
              annualAmountUsd: current.annualAmountUsd.toNumber(),
            }
          : null,
        changePercent:
          comparable && previousAmount !== null
            ? percentageChange(previousAmount, input.baseAmount)
            : null,
      };
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      timeout: 10_000,
    },
  );
}

/** Full salary history for an employee, newest first. */
export async function getSalaryHistory(employeeId: string) {
  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: { id: true },
  });
  if (!employee) throw new NotFoundError('Employee', employeeId);

  const records = await prisma.salaryRecord.findMany({
    where: { employeeId },
    orderBy: { effectiveFrom: 'desc' },
  });

  // Each record is annotated with its change versus the one before it, so the UI
  // can render a timeline without recomputing deltas.
  return records.map((record, index) => {
    const older = records[index + 1];
    const comparable = older !== undefined && older.currency === record.currency;

    return {
      id: record.id,
      baseAmount: record.baseAmount.toNumber(),
      currency: record.currency,
      baseAmountUsd: record.baseAmountUsd.toNumber(),
      annualAmountUsd: record.annualAmountUsd.toNumber(),
      payFrequency: record.payFrequency,
      effectiveFrom: record.effectiveFrom,
      effectiveTo: record.effectiveTo,
      changeReason: record.changeReason,
      note: record.note,
      changedBy: record.changedBy,
      isCurrent: record.effectiveTo === null,
      changePercent: comparable
        ? percentageChange(older.baseAmount.toNumber(), record.baseAmount.toNumber())
        : null,
    };
  });
}

/** The day before `date`, at UTC midnight. */
function previousDay(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - 1),
  );
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}
