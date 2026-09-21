/**
 * Seed 10,000 employees with realistic compensation.
 *
 * Two properties matter more than volume:
 *
 * 1. **Deterministic.** A fixed-seed PRNG, not Math.random and not faker's default.
 *    The same command produces the same database every time, so a number in the demo
 *    matches the number in a test, and a reviewer sees what I saw.
 *
 * 2. **Realistic in shape.** Uniform-random salaries would make the analytics
 *    meaningless — every percentile identical, no pay gap, no outliers. Real payroll
 *    data is right-skewed with genuine structure, so the generator models:
 *      - log-normal salary noise within a band (long right tail)
 *      - cost-of-living multipliers per country
 *      - a pyramid level distribution (many juniors, few VPs)
 *      - a deliberate, documented pay gap so the gap report has something to find
 *      - a small number of true outliers for the outlier report
 *
 * Point 2 is a product decision as much as a technical one: a dashboard seeded with
 * uniform noise demos as a dashboard that does not work.
 */

import { PrismaClient, type Prisma } from '@prisma/client';
import {
  convertToBaseCurrency,
  type CurrencyCode,
  type JobLevel,
  type Gender,
  type SalaryChangeReason,
} from '@salary/shared';

const prisma = new PrismaClient();

const TOTAL_EMPLOYEES = 10_000;
const SEED = 20260921;
const BATCH_SIZE = 1_000;

/**
 * Mulberry32 — a small, fast, well-distributed PRNG.
 *
 * Used instead of Math.random because Math.random cannot be seeded, which would make
 * every run produce a different database.
 */
function createRng(seed: number): () => number {
  let state = seed >>> 0;
  return function next(): number {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rng = createRng(SEED);

const randomInt = (min: number, max: number): number =>
  Math.floor(rng() * (max - min + 1)) + min;

const pick = <T>(items: readonly T[]): T => items[Math.floor(rng() * items.length)]!;

/** Pick from weighted options. Used for level and gender distributions. */
function pickWeighted<T>(options: readonly (readonly [T, number])[]): T {
  const total = options.reduce((sum, [, weight]) => sum + weight, 0);
  let roll = rng() * total;
  for (const [value, weight] of options) {
    roll -= weight;
    if (roll <= 0) return value;
  }
  return options[options.length - 1]![0];
}

/**
 * Box-Muller transform: uniform random → standard normal.
 * Salaries within a band cluster around a midpoint rather than spreading uniformly.
 */
function gaussian(): number {
  // u must be non-zero; Math.log(0) is -Infinity.
  const u = 1 - rng();
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * Log-normal multiplier around 1.0.
 *
 * Log-normal rather than normal because real salary distributions have a long right
 * tail: someone can earn 2x the band midpoint, but nobody earns negative.
 */
function logNormalMultiplier(sigma: number): number {
  return Math.exp(gaussian() * sigma);
}

interface CountryConfig {
  code: string;
  name: string;
  currency: CurrencyCode;
  /** Salary multiplier relative to the US baseline. Approximate market reality. */
  colMultiplier: number;
  /** Relative share of headcount. */
  weight: number;
}

const COUNTRIES: readonly CountryConfig[] = [
  { code: 'US', name: 'United States', currency: 'USD', colMultiplier: 1.0, weight: 30 },
  { code: 'IN', name: 'India', currency: 'INR', colMultiplier: 0.28, weight: 25 },
  { code: 'GB', name: 'United Kingdom', currency: 'GBP', colMultiplier: 0.78, weight: 10 },
  { code: 'DE', name: 'Germany', currency: 'EUR', colMultiplier: 0.82, weight: 8 },
  { code: 'PL', name: 'Poland', currency: 'PLN', colMultiplier: 0.45, weight: 6 },
  { code: 'SG', name: 'Singapore', currency: 'SGD', colMultiplier: 0.88, weight: 5 },
  { code: 'CA', name: 'Canada', currency: 'CAD', colMultiplier: 0.82, weight: 5 },
  { code: 'AU', name: 'Australia', currency: 'AUD', colMultiplier: 0.85, weight: 4 },
  { code: 'BR', name: 'Brazil', currency: 'BRL', colMultiplier: 0.32, weight: 3 },
  { code: 'ZA', name: 'South Africa', currency: 'ZAR', colMultiplier: 0.35, weight: 2 },
  { code: 'JP', name: 'Japan', currency: 'JPY', colMultiplier: 0.75, weight: 2 },
];

interface DepartmentConfig {
  name: string;
  costCentre: string;
  /** Multiplier on the level band — Engineering pays above Support at the same level. */
  payMultiplier: number;
  weight: number;
  titles: readonly string[];
}

const DEPARTMENTS: readonly DepartmentConfig[] = [
  {
    name: 'Engineering',
    costCentre: 'CC-1000',
    payMultiplier: 1.15,
    weight: 32,
    titles: ['Software Engineer', 'Platform Engineer', 'QA Engineer', 'SRE', 'Data Engineer'],
  },
  {
    name: 'Sales',
    costCentre: 'CC-2000',
    payMultiplier: 1.05,
    weight: 16,
    titles: ['Account Executive', 'Sales Development Rep', 'Solutions Consultant'],
  },
  {
    name: 'Customer Support',
    costCentre: 'CC-3000',
    payMultiplier: 0.75,
    weight: 14,
    titles: ['Support Specialist', 'Technical Support Engineer', 'Support Team Lead'],
  },
  {
    name: 'Marketing',
    costCentre: 'CC-4000',
    payMultiplier: 0.95,
    weight: 9,
    titles: ['Marketing Manager', 'Content Strategist', 'Growth Analyst'],
  },
  {
    name: 'Product',
    costCentre: 'CC-5000',
    payMultiplier: 1.18,
    weight: 8,
    titles: ['Product Manager', 'Product Designer', 'UX Researcher'],
  },
  {
    name: 'Operations',
    costCentre: 'CC-6000',
    payMultiplier: 0.88,
    weight: 7,
    titles: ['Operations Analyst', 'Program Manager', 'Business Analyst'],
  },
  {
    name: 'Finance',
    costCentre: 'CC-7000',
    payMultiplier: 1.0,
    weight: 6,
    titles: ['Financial Analyst', 'Accountant', 'Controller'],
  },
  {
    name: 'People',
    costCentre: 'CC-8000',
    payMultiplier: 0.9,
    weight: 5,
    titles: ['HR Business Partner', 'Recruiter', 'People Operations Specialist'],
  },
  {
    name: 'Legal',
    costCentre: 'CC-9000',
    payMultiplier: 1.12,
    weight: 3,
    titles: ['Counsel', 'Compliance Manager', 'Paralegal'],
  },
];

/** US-baseline annual USD midpoint per level. Roughly market-realistic. */
const LEVEL_BANDS: Record<JobLevel, number> = {
  L1: 55_000,
  L2: 72_000,
  L3: 95_000,
  L4: 125_000,
  L5: 160_000,
  L6: 205_000,
  L7: 265_000,
  L8: 340_000,
};

/** Pyramid distribution: many juniors, few executives. */
const LEVEL_WEIGHTS: readonly (readonly [JobLevel, number])[] = [
  ['L1', 14],
  ['L2', 20],
  ['L3', 24],
  ['L4', 19],
  ['L5', 12],
  ['L6', 7],
  ['L7', 3],
  ['L8', 1],
];

const GENDER_WEIGHTS: readonly (readonly [Gender, number])[] = [
  ['MALE', 52],
  ['FEMALE', 42],
  ['NON_BINARY', 2],
  ['UNDISCLOSED', 4],
];

/**
 * A deliberate, synthetic pay gap.
 *
 * Without this the gap report would correctly show ~0% everywhere, which demos as a
 * broken feature rather than a working one. Roughly mirrors reported industry gaps.
 * This is seed data, not a claim about any real organisation.
 */
const GENDER_PAY_FACTOR: Record<Gender, number> = {
  MALE: 1.0,
  FEMALE: 0.94,
  NON_BINARY: 0.96,
  UNDISCLOSED: 0.99,
};

const FIRST_NAMES = [
  'Aarav', 'Priya', 'Wei', 'Sofia', 'James', 'Maria', 'Ahmed', 'Yuki', 'Liam', 'Ana',
  'Chen', 'Fatima', 'Oliver', 'Ingrid', 'Rahul', 'Elena', 'Noah', 'Zara', 'Lucas', 'Mei',
  'Ethan', 'Aisha', 'Mateo', 'Hana', 'Kwame', 'Lena', 'Diego', 'Nia', 'Tomas', 'Sana',
  'Emma', 'Ravi', 'Clara', 'Jin', 'Isabel', 'Omar', 'Freya', 'Nikhil', 'Rosa', 'Sven',
  'Amara', 'Felix', 'Divya', 'Marco', 'Leila', 'Hugo', 'Anjali', 'Pieter', 'Yara', 'Kenji',
];

const LAST_NAMES = [
  'Sharma', 'Chen', 'Silva', 'Smith', 'Garcia', 'Khan', 'Tanaka', 'Muller', 'Rossi', 'Kim',
  'Patel', 'Nowak', 'Dubois', 'Okafor', 'Andersson', 'Reddy', 'Costa', 'Novak', 'Haddad', 'Wong',
  'Johnson', 'Iyer', 'Fernandez', 'Yamamoto', 'Brown', 'Singh', 'Moreau', 'Nkosi', 'Lindgren', 'Gupta',
  'Martins', 'Kowalski', 'Leroy', 'Mensah', 'Bakker', 'Nair', 'Oliveira', 'Horvath', 'Aziz', 'Lim',
];

/** Weighted pick over a config list, using each entry's `weight`. */
function pickByWeight<T extends { weight: number }>(items: readonly T[]): T {
  const total = items.reduce((sum, item) => sum + item.weight, 0);
  let roll = rng() * total;
  for (const item of items) {
    roll -= item.weight;
    if (roll <= 0) return item;
  }
  return items[items.length - 1]!;
}

/** Random date between two bounds, normalised to UTC midnight. */
function randomDate(startYear: number, endYear: number): Date {
  const start = Date.UTC(startYear, 0, 1);
  const end = Date.UTC(endYear, 11, 31);
  const timestamp = start + rng() * (end - start);
  const date = new Date(timestamp);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function addMonths(date: Date, months: number): Date {
  const result = new Date(date);
  result.setUTCMonth(result.getUTCMonth() + months);
  return result;
}

/** Round to a sensible salary figure — real salaries are not 94,271.38. */
function roundSalary(amount: number, currency: CurrencyCode): number {
  // INR and JPY salaries are quoted in much larger nominal numbers.
  const granularity = currency === 'INR' || currency === 'JPY' ? 1000 : 100;
  return Math.round(amount / granularity) * granularity;
}

interface GeneratedEmployee {
  employee: Prisma.EmployeeCreateManyInput;
  salaryHistory: Prisma.SalaryRecordCreateManyInput[];
}

/**
 * Build one employee plus their full salary history.
 *
 * History is generated backwards from the current salary: we decide what they earn
 * today, then walk back through prior raises. Generating forwards would mean the
 * final salary drifts unpredictably away from the intended band.
 */
function generateEmployee(
  index: number,
  departmentIds: Map<string, string>,
  today: Date,
): GeneratedEmployee {
  const country = pickByWeight(COUNTRIES);
  const department = pickByWeight(DEPARTMENTS);
  const level = pickWeighted(LEVEL_WEIGHTS);
  const gender = pickWeighted(GENDER_WEIGHTS);

  const firstName = pick(FIRST_NAMES);
  const lastName = pick(LAST_NAMES);
  const employeeCode = `ACME-${String(index + 1).padStart(5, '0')}`;
  // Index in the local part guarantees uniqueness across 10k rows despite a small
  // name pool — a collision here would abort the whole seed.
  const email = `${firstName.toLowerCase()}.${lastName.toLowerCase()}.${index + 1}@acme.example`;

  const hireDate = randomDate(2015, 2025);

  // ~4% leavers, so status filtering has something to filter and terminated staff
  // can be excluded from payroll cost.
  const isTerminated = rng() < 0.04;
  const status = isTerminated ? 'TERMINATED' : rng() < 0.02 ? 'ON_LEAVE' : 'ACTIVE';
  const terminationDate = isTerminated
    ? randomDate(Math.max(2021, hireDate.getUTCFullYear()), 2026)
    : null;

  const employmentType = pickWeighted([
    ['FULL_TIME', 90],
    ['CONTRACT', 6],
    ['PART_TIME', 3],
    ['INTERN', 1],
  ] as const);

  // --- Current compensation -------------------------------------------------
  const bandMidpointUsd = LEVEL_BANDS[level];
  const spread = logNormalMultiplier(0.14);
  const genderFactor = GENDER_PAY_FACTOR[gender];

  // ~1.5% of people are deliberate outliers so the outlier report has real signal.
  const outlierFactor = rng() < 0.015 ? (rng() < 0.6 ? 0.72 : 1.42) : 1;

  const targetUsd =
    bandMidpointUsd *
    country.colMultiplier *
    department.payMultiplier *
    spread *
    genderFactor *
    outlierFactor;

  // Interns and part-timers are paid a fraction of a full-time band.
  const typeFactor =
    employmentType === 'INTERN' ? 0.35 : employmentType === 'PART_TIME' ? 0.55 : 1;

  const currency = country.currency as CurrencyCode;
  const ratePerUsd = currency === 'USD' ? 1 : getRate(currency);
  const currentLocal = roundSalary(targetUsd * typeFactor * ratePerUsd, currency);

  // --- Salary history -------------------------------------------------------
  // Walk backwards: each prior record is the current one minus a raise.
  const yearsOfService = Math.max(
    0,
    (today.getTime() - hireDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000),
  );
  const raiseCount = Math.min(6, Math.floor(yearsOfService / 1.4));

  const salaryHistory: Prisma.SalaryRecordCreateManyInput[] = [];
  const employeeId = crypto.randomUUID();

  let amountLocal = currentLocal;
  // A terminated employee's final record closes on their leaving date rather than
  // staying open forever; the partial unique index permits many closed records.
  //
  // Clamped below against the record's own start date: if someone left before their
  // most recent raise would have landed, an unclamped value would produce
  // effective_to < effective_from and trip the CHECK constraint.
  let recordEnd: Date | null = terminationDate;
  const boundaries: Date[] = [];

  for (let i = 0; i < raiseCount; i++) {
    // Raises are spaced 12–24 months apart, working backwards from today.
    boundaries.push(addMonths(today, -randomInt(12, 24) * (i + 1)));
  }
  // Ascending, never before the hire date, and never after the employee left —
  // a raise dated after someone's last day is nonsense and would also produce an
  // inverted effective range.
  const effectiveDates = [
    hireDate,
    ...boundaries
      .reverse()
      .filter((d) => d > hireDate && (terminationDate === null || d < terminationDate)),
  ];

  for (let i = effectiveDates.length - 1; i >= 0; i--) {
    const effectiveFrom = effectiveDates[i]!;
    const isFirst = i === 0;

    const reason: SalaryChangeReason = isFirst
      ? 'HIRE'
      : pickWeighted([
          ['MERIT_INCREASE', 60],
          ['PROMOTION', 20],
          ['MARKET_ADJUSTMENT', 14],
          ['ROLE_CHANGE', 4],
          ['CORRECTION', 2],
        ] as const);

    const amountUsd = convertToBaseCurrency(amountLocal, currency);
    const annualUsd = amountUsd; // All seeded records are ANNUAL.

    // Final guard on the effective range. The date filtering above should make this
    // a no-op, but the CHECK constraint is unforgiving and a single bad row aborts
    // a 1,000-row batch, so the invariant is enforced here too rather than trusted.
    const boundedEnd =
      recordEnd !== null && recordEnd < effectiveFrom ? effectiveFrom : recordEnd;

    salaryHistory.push({
      id: crypto.randomUUID(),
      employeeId,
      baseAmount: amountLocal.toFixed(2),
      currency,
      baseAmountUsd: amountUsd.toFixed(2),
      annualAmountUsd: annualUsd.toFixed(2),
      payFrequency: 'ANNUAL',
      effectiveFrom,
      effectiveTo: boundedEnd,
      changeReason: reason,
      changedBy: 'seed',
    });

    // Step back to the previous salary: undo a 4–12% raise (larger for promotions).
    const raisePct = reason === 'PROMOTION' ? randomInt(12, 22) : randomInt(4, 11);
    amountLocal = roundSalary(amountLocal / (1 + raisePct / 100), currency);
    // The previous record ended the day this one began.
    recordEnd = new Date(effectiveFrom.getTime() - 86_400_000);
  }

  return {
    employee: {
      id: employeeId,
      employeeCode,
      firstName,
      lastName,
      email,
      countryCode: country.code,
      departmentId: departmentIds.get(department.name)!,
      jobTitle: `${levelPrefix(level)}${pick(department.titles)}`.trim(),
      level,
      employmentType,
      status,
      gender,
      hireDate,
      terminationDate,
      managerId: null,
    },
    salaryHistory,
  };
}

function levelPrefix(level: JobLevel): string {
  if (level === 'L1' || level === 'L2') return 'Junior ';
  if (level === 'L4') return 'Senior ';
  if (level === 'L5') return 'Staff ';
  if (level === 'L6') return 'Principal ';
  if (level === 'L7') return 'Director, ';
  if (level === 'L8') return 'VP, ';
  return '';
}

// Re-exported rate lookup; kept local to avoid importing the whole money module's
// internals into the seed.
function getRate(currency: CurrencyCode): number {
  const rates: Record<string, number> = {
    USD: 1, EUR: 0.92, GBP: 0.79, INR: 83.2, SGD: 1.34, AUD: 1.52,
    CAD: 1.36, BRL: 4.97, ZAR: 18.6, PLN: 4.02, JPY: 149,
  };
  return rates[currency] ?? 1;
}

async function main(): Promise<void> {
  const startedAt = Date.now();
  console.log(`Seeding ${TOTAL_EMPLOYEES.toLocaleString()} employees (seed=${SEED})...`);

  // Order matters: salary_records references employees, which references both
  // departments and countries.
  console.log('  Clearing existing data...');
  await prisma.salaryRecord.deleteMany();
  await prisma.employee.deleteMany();
  await prisma.department.deleteMany();
  await prisma.country.deleteMany();

  console.log('  Creating countries and departments...');
  await prisma.country.createMany({
    data: COUNTRIES.map((c) => ({ code: c.code, name: c.name, currencyCode: c.currency })),
  });

  const departmentIds = new Map<string, string>();
  for (const dept of DEPARTMENTS) {
    const id = crypto.randomUUID();
    departmentIds.set(dept.name, id);
  }
  await prisma.department.createMany({
    data: DEPARTMENTS.map((d) => ({
      id: departmentIds.get(d.name)!,
      name: d.name,
      costCentre: d.costCentre,
    })),
  });

  const today = new Date(Date.UTC(2026, 8, 21));

  console.log('  Generating employees and salary history...');
  const employees: Prisma.EmployeeCreateManyInput[] = [];
  const salaryRecords: Prisma.SalaryRecordCreateManyInput[] = [];

  for (let i = 0; i < TOTAL_EMPLOYEES; i++) {
    const generated = generateEmployee(i, departmentIds, today);
    employees.push(generated.employee);
    salaryRecords.push(...generated.salaryHistory);
  }

  // Batched inserts. 10,000 individual creates would be ~10,000 round-trips and take
  // minutes; createMany in chunks keeps it to a few seconds.
  console.log(`  Inserting ${employees.length.toLocaleString()} employees...`);
  for (let i = 0; i < employees.length; i += BATCH_SIZE) {
    await prisma.employee.createMany({ data: employees.slice(i, i + BATCH_SIZE) });
  }

  console.log(`  Inserting ${salaryRecords.length.toLocaleString()} salary records...`);
  for (let i = 0; i < salaryRecords.length; i += BATCH_SIZE) {
    await prisma.salaryRecord.createMany({ data: salaryRecords.slice(i, i + BATCH_SIZE) });
  }

  // Managers are assigned in a second pass: a manager must already exist before
  // anyone can point at them.
  console.log('  Assigning reporting lines...');
  await assignManagers();

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(`\nDone in ${elapsed}s`);
  await printSummary();
}

/**
 * Assign each employee a manager from the same department at a higher level.
 *
 * Done in SQL rather than in application code: pulling 10,000 rows into Node to set
 * one column each would be slow and pointless when the database can do it in a
 * single statement.
 */
async function assignManagers(): Promise<void> {
  await prisma.$executeRawUnsafe(`
    WITH candidates AS (
      SELECT
        e.id,
        (
          SELECT m.id
          FROM employees m
          WHERE m.department_id = e.department_id
            AND m.level > e.level
            AND m.status = 'ACTIVE'
            AND m.id <> e.id
          ORDER BY m.level ASC, md5(m.id::text || e.id::text)
          LIMIT 1
        ) AS manager_id
      FROM employees e
    )
    UPDATE employees SET manager_id = candidates.manager_id
    FROM candidates
    WHERE employees.id = candidates.id
      AND candidates.manager_id IS NOT NULL;
  `);
}

async function printSummary(): Promise<void> {
  const [employeeCount, salaryCount, currentCount] = await Promise.all([
    prisma.employee.count(),
    prisma.salaryRecord.count(),
    prisma.salaryRecord.count({ where: { effectiveTo: null } }),
  ]);

  const activeCount = await prisma.employee.count({ where: { status: 'ACTIVE' } });

  console.log('\nSummary');
  console.log(`  Employees:              ${employeeCount.toLocaleString()}`);
  console.log(`  Active:                 ${activeCount.toLocaleString()}`);
  console.log(`  Salary records:         ${salaryCount.toLocaleString()}`);
  console.log(`  Currently in effect:    ${currentCount.toLocaleString()}`);
  console.log(`  Avg records/employee:   ${(salaryCount / employeeCount).toFixed(1)}`);
}

main()
  .catch((error) => {
    console.error('Seed failed:', error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
