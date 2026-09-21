/**
 * Analytics API surface.
 *
 * The aggregation maths is covered in analytics.service.test.ts. These tests cover
 * the HTTP contract: query parsing, defaults, bounds, and the response shapes the
 * dashboard renders.
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import {
  resetDatabase,
  seedReferenceData,
  createTestEmployee,
  resetEmployeeCounter,
  disconnect,
} from '../helpers/database.js';

const app = createApp();

let engineeringId: string;
let salesId: string;

beforeEach(async () => {
  await resetDatabase();
  resetEmployeeCounter();
  ({ engineeringId, salesId } = await seedReferenceData());

  // A small mixed population: two departments, two countries, both genders, and
  // one terminated employee to check the default active-only filter.
  for (const salary of [90_000, 100_000, 110_000, 120_000, 130_000]) {
    await createTestEmployee({
      departmentId: engineeringId, level: 'L4', gender: 'MALE',
      salary, salaryUsd: salary,
    });
  }
  for (const salary of [80_000, 90_000, 100_000, 110_000, 120_000]) {
    await createTestEmployee({
      departmentId: engineeringId, level: 'L4', gender: 'FEMALE',
      salary, salaryUsd: salary,
    });
  }
  await createTestEmployee({
    departmentId: salesId, countryCode: 'IN', level: 'L3', currency: 'INR',
    salary: 4_160_000, salaryUsd: 50_000,
  });
  await createTestEmployee({
    departmentId: salesId, status: 'TERMINATED', salary: 400_000, salaryUsd: 400_000,
  });
});

afterAll(disconnect);

describe('GET /api/analytics/overview', () => {
  it('returns the headline metrics, excluding leavers by default', async () => {
    const res = await request(app).get('/api/analytics/overview').expect(200);

    expect(res.body.headcount).toBe(11);
    expect(res.body.countryCount).toBe(2);
    expect(res.body.departmentCount).toBe(2);
    // Median and mean are both present - reporting a mean alone would misrepresent
    // a skewed salary distribution.
    expect(res.body.medianSalaryUsd).toBe(100_000);
    expect(typeof res.body.meanSalaryUsd).toBe('number');
    expect(res.body.p25SalaryUsd).toBeLessThan(res.body.p75SalaryUsd);
  });

  it('includes leavers when activeOnly is false', async () => {
    const res = await request(app)
      .get('/api/analytics/overview?activeOnly=false')
      .expect(200);

    expect(res.body.headcount).toBe(12);
  });

  it('applies a country filter', async () => {
    const res = await request(app).get('/api/analytics/overview?countryCode=IN').expect(200);

    expect(res.body.headcount).toBe(1);
    expect(res.body.totalAnnualCostUsd).toBe(50_000);
  });

  it('rejects a malformed country code', async () => {
    await request(app).get('/api/analytics/overview?countryCode=USA').expect(400);
  });
});

describe('GET /api/analytics/breakdown', () => {
  it('defaults to grouping by department', async () => {
    const res = await request(app).get('/api/analytics/breakdown').expect(200);

    expect(res.body.dimension).toBe('department');
    expect(res.body.groups).toHaveLength(2);
    // Ordered by cost, so the largest line item leads.
    expect(res.body.groups[0].label).toBe('Engineering');
    expect(res.body.groups[0].headcount).toBe(10);
  });

  it('groups by each supported dimension', async () => {
    for (const dimension of ['country', 'level', 'employmentType'] as const) {
      const res = await request(app)
        .get(`/api/analytics/breakdown?dimension=${dimension}`)
        .expect(200);

      expect(res.body.dimension).toBe(dimension);
      expect(res.body.groups.length).toBeGreaterThan(0);
      expect(res.body.groups[0]).toHaveProperty('medianSalaryUsd');
      expect(res.body.groups[0]).toHaveProperty('costSharePercent');
    }
  });

  it('rejects an unknown dimension rather than defaulting silently', async () => {
    // A silent default would render a chart labelled with the wrong grouping.
    await request(app).get('/api/analytics/breakdown?dimension=favourite_colour').expect(400);
  });
});

describe('GET /api/analytics/pay-gap', () => {
  it('returns gap rows with counts and coverage', async () => {
    const res = await request(app).get('/api/analytics/pay-gap?dimension=department').expect(200);

    const engineering = res.body.rows.find(
      (r: { label: string }) => r.label === 'Engineering',
    );
    expect(engineering.maleCount).toBe(5);
    expect(engineering.femaleCount).toBe(5);
    // Male median 110k, female median 100k: a 9.09% gap.
    expect(engineering.medianGapPercent).toBeCloseTo(9.09, 1);
    expect(engineering.suppressed).toBe(false);

    // Coverage lets the user judge how much of the org the figure speaks for.
    expect(res.body.coveragePercent).toBeGreaterThan(0);
    expect(res.body.minGroupSize).toBe(5);
  });

  it('suppresses groups too small to report', async () => {
    const res = await request(app).get('/api/analytics/pay-gap?dimension=department').expect(200);

    const sales = res.body.rows.find((r: { label: string }) => r.label === 'Sales');
    expect(sales.suppressed).toBe(true);
    expect(sales.medianGapPercent).toBeNull();
    expect(sales.maleMedianUsd).toBeNull();
  });
});

describe('GET /api/analytics/outliers', () => {
  it('returns outliers with the band they were judged against', async () => {
    // Band of five L4 US males plus five females, median 105k. Someone at 50k is
    // well past the default 20% threshold.
    await createTestEmployee({
      departmentId: engineeringId, level: 'L4', salary: 50_000, salaryUsd: 50_000,
      firstName: 'Well', lastName: 'Underpaid',
    });

    const res = await request(app).get('/api/analytics/outliers').expect(200);

    expect(res.body.thresholdPercent).toBe(20);
    expect(res.body.direction).toBe('below');

    const flagged = res.body.outliers.find(
      (o: { name: string }) => o.name === 'Well Underpaid',
    );
    expect(flagged).toBeDefined();
    // The band median and size are returned so the finding is auditable rather
    // than an unexplained flag.
    expect(flagged.bandMedianUsd).toBeGreaterThan(0);
    expect(flagged.bandSize).toBeGreaterThanOrEqual(5);
    expect(flagged.deviationPercent).toBeLessThan(-20);
  });

  it('honours a custom threshold', async () => {
    const strict = await request(app)
      .get('/api/analytics/outliers?thresholdPercent=80')
      .expect(200);

    expect(strict.body.thresholdPercent).toBe(80);
    expect(strict.body.outliers).toHaveLength(0);
  });

  it('rejects an out-of-range threshold', async () => {
    await request(app).get('/api/analytics/outliers?thresholdPercent=0').expect(400);
    await request(app).get('/api/analytics/outliers?thresholdPercent=95').expect(400);
  });
});

describe('GET /api/analytics/trend', () => {
  it('returns one point per month, oldest first', async () => {
    const res = await request(app).get('/api/analytics/trend?months=6').expect(200);

    expect(res.body.months).toBe(6);
    expect(res.body.points).toHaveLength(6);
    expect(res.body.points[0].period).toMatch(/^\d{4}-\d{2}$/);

    const periods = res.body.points.map((p: { period: string }) => p.period);
    expect([...periods].sort()).toEqual(periods);
  });

  it('defaults to 24 months and bounds the range', async () => {
    const defaulted = await request(app).get('/api/analytics/trend').expect(200);
    expect(defaulted.body.months).toBe(24);

    // An unbounded range would let a client ask for an arbitrarily expensive scan.
    await request(app).get('/api/analytics/trend?months=600').expect(400);
  });
});

describe('GET /health', () => {
  it('reports database connectivity, not just process liveness', async () => {
    const res = await request(app).get('/health').expect(200);

    expect(res.body.status).toBe('ok');
    expect(res.body.database).toBe('connected');
  });
});
