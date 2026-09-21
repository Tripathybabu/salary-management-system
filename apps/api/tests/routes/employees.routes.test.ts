/**
 * API surface tests.
 *
 * These run the real Express app against a real database via supertest. What they
 * add over the service tests is everything between the two: query-string parsing,
 * validation at the boundary, status-code mapping, and JSON serialisation.
 *
 * The focus is on contract — the status codes and shapes a frontend depends on —
 * rather than re-testing business rules already covered at the service level.
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import {
  prisma,
  resetDatabase,
  seedReferenceData,
  createTestEmployee,
  resetEmployeeCounter,
  disconnect,
  date,
} from '../helpers/database.js';

const app = createApp();

let engineeringId: string;
let salesId: string;

beforeEach(async () => {
  await resetDatabase();
  resetEmployeeCounter();
  ({ engineeringId, salesId } = await seedReferenceData());
});

afterAll(disconnect);

const MISSING_ID = '11111111-1111-4111-8111-111111111111';

describe('GET /api/employees', () => {
  beforeEach(async () => {
    await createTestEmployee({
      departmentId: engineeringId, firstName: 'Ada', lastName: 'Lovelace',
      email: 'ada@acme.example', level: 'L6', salary: 180_000, salaryUsd: 180_000,
    });
    await createTestEmployee({
      departmentId: salesId, firstName: 'Grace', lastName: 'Hopper',
      email: 'grace@acme.example', level: 'L4', salary: 120_000, salaryUsd: 120_000,
    });
    await createTestEmployee({
      departmentId: engineeringId, firstName: 'Alan', lastName: 'Turing',
      email: 'alan@acme.example', level: 'L3', countryCode: 'IN',
      salary: 4_160_000, currency: 'INR', salaryUsd: 50_000,
    });
  });

  it('returns a paginated envelope', async () => {
    const res = await request(app).get('/api/employees').expect(200);

    expect(res.body.data).toHaveLength(3);
    expect(res.body.pagination).toMatchObject({
      page: 1, pageSize: 25, totalCount: 3, totalPages: 1,
      hasNextPage: false, hasPreviousPage: false,
    });
  });

  it('paginates without returning the whole table', async () => {
    const res = await request(app).get('/api/employees?page=1&pageSize=2').expect(200);

    expect(res.body.data).toHaveLength(2);
    expect(res.body.pagination).toMatchObject({
      totalCount: 3, totalPages: 2, hasNextPage: true, hasPreviousPage: false,
    });

    const second = await request(app).get('/api/employees?page=2&pageSize=2').expect(200);
    expect(second.body.data).toHaveLength(1);
    expect(second.body.pagination.hasPreviousPage).toBe(true);
  });

  it('caps pageSize so a client cannot request all 10,000 rows at once', async () => {
    await request(app).get('/api/employees?pageSize=5000').expect(400);
  });

  it('sorts by current salary across currencies', async () => {
    // Sorting must use the normalised USD amount: 4,160,000 INR is 50,000 USD and
    // belongs last, not first.
    const res = await request(app)
      .get('/api/employees?sortBy=salary&sortOrder=desc')
      .expect(200);

    expect(res.body.data.map((e: { firstName: string }) => e.firstName)).toEqual([
      'Ada', 'Grace', 'Alan',
    ]);
  });

  it('searches by name, email and employee code', async () => {
    const byName = await request(app).get('/api/employees?search=hopper').expect(200);
    expect(byName.body.data).toHaveLength(1);
    expect(byName.body.data[0].firstName).toBe('Grace');

    const byEmail = await request(app).get('/api/employees?search=ada@acme').expect(200);
    expect(byEmail.body.data).toHaveLength(1);

    const byCode = await request(app).get('/api/employees?search=ACME-00001').expect(200);
    expect(byCode.body.data).toHaveLength(1);
  });

  it('filters by country, department and level', async () => {
    const byCountry = await request(app).get('/api/employees?countryCode=IN').expect(200);
    expect(byCountry.body.data).toHaveLength(1);
    expect(byCountry.body.data[0].firstName).toBe('Alan');

    const byDept = await request(app)
      .get(`/api/employees?departmentId=${engineeringId}`)
      .expect(200);
    expect(byDept.body.data).toHaveLength(2);

    // Comma-separated multi-select, as the filter UI sends it.
    const byLevels = await request(app).get('/api/employees?level=L4,L6').expect(200);
    expect(byLevels.body.data).toHaveLength(2);
  });

  it('filters by salary range using normalised USD', async () => {
    const res = await request(app)
      .get('/api/employees?minSalary=100000&maxSalary=150000')
      .expect(200);

    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].firstName).toBe('Grace');
  });

  it('rejects a salary range whose minimum exceeds its maximum', async () => {
    await request(app).get('/api/employees?minSalary=200000&maxSalary=100000').expect(400);
  });

  it('keeps an employee with no current salary in the list', async () => {
    // A LEFT JOIN, not an INNER one: dropping people without an open salary record
    // would make them silently unreachable in the UI.
    await createTestEmployee({
      departmentId: engineeringId, firstName: 'NoSalary', lastName: 'Person',
      email: 'nosalary@acme.example',
    });

    const res = await request(app).get('/api/employees?search=nosalary').expect(200);

    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].currentSalary).toBeNull();
  });
});

describe('GET /api/employees/:id', () => {
  it('returns the profile, current salary and full history', async () => {
    const employee = await createTestEmployee({
      departmentId: engineeringId, salary: 100_000, salaryUsd: 100_000,
      hireDate: date('2020-01-01'), effectiveFrom: date('2020-01-01'),
    });

    await request(app)
      .post(`/api/employees/${employee.id}/salary`)
      .send({
        baseAmount: 115_000, currency: 'USD', effectiveFrom: '2025-01-01',
        changeReason: 'MERIT_INCREASE',
      })
      .expect(201);

    const res = await request(app).get(`/api/employees/${employee.id}`).expect(200);

    expect(res.body.currentSalary.baseAmount).toBe('115000');
    expect(res.body.salaryHistory).toHaveLength(2);
    expect(res.body.department.name).toBe('Engineering');
  });

  it('returns 404 for an unknown id', async () => {
    const res = await request(app).get(`/api/employees/${MISSING_ID}`).expect(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('returns 400 rather than 500 for a malformed id', async () => {
    // Without boundary validation this reaches Postgres as invalid uuid syntax and
    // surfaces as an opaque 500.
    const res = await request(app).get('/api/employees/not-a-uuid').expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('POST /api/employees', () => {
  const validEmployee = () => ({
    firstName: 'New', lastName: 'Starter', email: 'new.starter@acme.example',
    countryCode: 'US', departmentId: engineeringId, jobTitle: 'Software Engineer',
    level: 'L3', hireDate: '2026-01-15', baseAmount: 95_000, currency: 'USD',
  });

  it('creates an employee with their opening salary record', async () => {
    const res = await request(app).post('/api/employees').send(validEmployee()).expect(201);

    expect(res.body.employeeCode).toMatch(/^ACME-\d{5}$/);

    // The salary record is what makes them visible to analytics; creating an
    // employee without one would be a silent data gap.
    const records = await prisma.salaryRecord.findMany({ where: { employeeId: res.body.id } });
    expect(records).toHaveLength(1);
    expect(records[0]!.changeReason).toBe('HIRE');
    expect(records[0]!.effectiveTo).toBeNull();
  });

  it('allocates sequential employee codes', async () => {
    const first = await request(app).post('/api/employees').send(validEmployee()).expect(201);
    const second = await request(app)
      .post('/api/employees')
      .send({ ...validEmployee(), email: 'another.starter@acme.example' })
      .expect(201);

    expect(second.body.employeeCode).not.toBe(first.body.employeeCode);
  });

  it('rejects a duplicate email with 409', async () => {
    await request(app).post('/api/employees').send(validEmployee()).expect(201);
    const res = await request(app).post('/api/employees').send(validEmployee()).expect(409);
    expect(res.body.error.code).toBe('CONFLICT');
  });

  it('rejects an unknown department with 404', async () => {
    await request(app)
      .post('/api/employees')
      .send({ ...validEmployee(), departmentId: MISSING_ID })
      .expect(404);
  });

  it('rejects invalid input with field-level detail', async () => {
    const res = await request(app)
      .post('/api/employees')
      .send({ ...validEmployee(), email: 'not-an-email', baseAmount: -100 })
      .expect(400);

    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    // Field-keyed details are what a form needs to highlight the offending input.
    expect(res.body.error.details).toHaveProperty('email');
    expect(res.body.error.details).toHaveProperty('baseAmount');
  });

  it('rejects an unsupported currency', async () => {
    await request(app)
      .post('/api/employees')
      .send({ ...validEmployee(), currency: 'XYZ' })
      .expect(400);
  });

  it('rejects a calendar-invalid date', async () => {
    // Date would roll 2026-02-31 forward to March 3rd rather than reject it.
    await request(app)
      .post('/api/employees')
      .send({ ...validEmployee(), hireDate: '2026-02-31' })
      .expect(400);
  });

  it('does not create an employee when the salary record cannot be written', async () => {
    // Both writes share a transaction, so a rejected input leaves nothing behind.
    await request(app)
      .post('/api/employees')
      .send({ ...validEmployee(), baseAmount: 0 })
      .expect(400);

    expect(await prisma.employee.count()).toBe(0);
  });
});

describe('PATCH /api/employees/:id', () => {
  it('updates profile attributes', async () => {
    const employee = await createTestEmployee({ departmentId: engineeringId });

    const res = await request(app)
      .patch(`/api/employees/${employee.id}`)
      .send({ jobTitle: 'Staff Engineer', level: 'L5' })
      .expect(200);

    expect(res.body.jobTitle).toBe('Staff Engineer');
    expect(res.body.level).toBe('L5');
  });

  it('ignores compensation fields, so pay can only change via the salary endpoint', async () => {
    // This is the mechanism that makes the audit trail unbypassable: the update
    // schema has no salary fields, so a PATCH carrying one is rejected outright
    // rather than silently changing pay without a history record.
    const employee = await createTestEmployee({
      departmentId: engineeringId, salary: 100_000, salaryUsd: 100_000,
    });

    await request(app)
      .patch(`/api/employees/${employee.id}`)
      .send({ baseAmount: 999_999 })
      .expect(400);

    const current = await prisma.salaryRecord.findFirstOrThrow({
      where: { employeeId: employee.id, effectiveTo: null },
    });
    expect(current.baseAmount.toNumber()).toBe(100_000);
  });

  it('rejects making an employee their own manager', async () => {
    const employee = await createTestEmployee({ departmentId: engineeringId });

    await request(app)
      .patch(`/api/employees/${employee.id}`)
      .send({ managerId: employee.id })
      .expect(409);
  });

  it('rejects an empty update', async () => {
    const employee = await createTestEmployee({ departmentId: engineeringId });
    await request(app).patch(`/api/employees/${employee.id}`).send({}).expect(400);
  });
});

describe('POST /api/employees/:id/salary', () => {
  it('records a raise and reports the change', async () => {
    const employee = await createTestEmployee({
      departmentId: engineeringId, salary: 100_000, salaryUsd: 100_000,
      hireDate: date('2020-01-01'), effectiveFrom: date('2020-01-01'),
    });

    const res = await request(app)
      .post(`/api/employees/${employee.id}/salary`)
      .set('x-actor-id', 'hr.manager@acme.example')
      .send({
        baseAmount: 112_000, currency: 'USD', effectiveFrom: '2025-06-01',
        changeReason: 'PROMOTION', note: 'Promoted to Staff Engineer',
      })
      .expect(201);

    expect(res.body.record.baseAmount).toBe(112_000);
    expect(res.body.changePercent).toBe(12);
    expect(res.body.previous.baseAmount).toBe(100_000);

    const current = await prisma.salaryRecord.findFirstOrThrow({
      where: { employeeId: employee.id, effectiveTo: null },
    });
    expect(current.changedBy).toBe('hr.manager@acme.example');
  });

  it('maps a backdated change to 409', async () => {
    const employee = await createTestEmployee({
      departmentId: engineeringId, salary: 100_000, salaryUsd: 100_000,
      hireDate: date('2020-01-01'), effectiveFrom: date('2024-01-01'),
    });

    const res = await request(app)
      .post(`/api/employees/${employee.id}/salary`)
      .send({ baseAmount: 90_000, currency: 'USD', effectiveFrom: '2023-01-01', changeReason: 'CORRECTION' })
      .expect(409);

    expect(res.body.error.code).toBe('CONFLICT');
  });

  it('maps a terminated employee to 422', async () => {
    const employee = await createTestEmployee({
      departmentId: engineeringId, status: 'TERMINATED', salary: 100_000,
      salaryUsd: 100_000, hireDate: date('2020-01-01'), effectiveFrom: date('2020-01-01'),
    });

    const res = await request(app)
      .post(`/api/employees/${employee.id}/salary`)
      .send({ baseAmount: 120_000, currency: 'USD', effectiveFrom: '2025-01-01', changeReason: 'MERIT_INCREASE' })
      .expect(422);

    expect(res.body.error.code).toBe('BUSINESS_RULE_VIOLATION');
  });

  it('requires a change reason, so history is never unexplained', async () => {
    const employee = await createTestEmployee({
      departmentId: engineeringId, salary: 100_000, salaryUsd: 100_000,
    });

    await request(app)
      .post(`/api/employees/${employee.id}/salary`)
      .send({ baseAmount: 120_000, currency: 'USD', effectiveFrom: '2025-01-01' })
      .expect(400);
  });
});

describe('GET /api/employees/filters', () => {
  it('returns departments and countries for the filter dropdowns', async () => {
    const res = await request(app).get('/api/employees/filters').expect(200);

    expect(res.body.departments).toHaveLength(2);
    expect(res.body.countries).toHaveLength(2);
    expect(res.body.countries[0]).toHaveProperty('currencyCode');
  });
});

describe('unmatched routes', () => {
  it('returns a structured 404', async () => {
    const res = await request(app).get('/api/does-not-exist').expect(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});
