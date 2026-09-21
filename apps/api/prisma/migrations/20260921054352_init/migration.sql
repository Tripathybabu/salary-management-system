-- CreateEnum
CREATE TYPE "EmploymentStatus" AS ENUM ('ACTIVE', 'ON_LEAVE', 'TERMINATED');

-- CreateEnum
CREATE TYPE "EmploymentType" AS ENUM ('FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERN');

-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('MALE', 'FEMALE', 'NON_BINARY', 'UNDISCLOSED');

-- CreateEnum
CREATE TYPE "JobLevel" AS ENUM ('L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L7', 'L8');

-- CreateEnum
CREATE TYPE "SalaryChangeReason" AS ENUM ('HIRE', 'MERIT_INCREASE', 'PROMOTION', 'MARKET_ADJUSTMENT', 'ROLE_CHANGE', 'CORRECTION', 'DEMOTION');

-- CreateEnum
CREATE TYPE "PayFrequency" AS ENUM ('ANNUAL', 'MONTHLY');

-- CreateTable
CREATE TABLE "departments" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "cost_centre" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "departments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "countries" (
    "code" CHAR(2) NOT NULL,
    "name" TEXT NOT NULL,
    "currency_code" CHAR(3) NOT NULL,

    CONSTRAINT "countries_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "employees" (
    "id" UUID NOT NULL,
    "employee_code" TEXT NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "country_code" CHAR(2) NOT NULL,
    "department_id" UUID NOT NULL,
    "job_title" TEXT NOT NULL,
    "level" "JobLevel" NOT NULL,
    "employment_type" "EmploymentType" NOT NULL DEFAULT 'FULL_TIME',
    "status" "EmploymentStatus" NOT NULL DEFAULT 'ACTIVE',
    "gender" "Gender" NOT NULL DEFAULT 'UNDISCLOSED',
    "hire_date" DATE NOT NULL,
    "termination_date" DATE,
    "manager_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "salary_records" (
    "id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "base_amount" DECIMAL(14,2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "base_amount_usd" DECIMAL(14,2) NOT NULL,
    "annual_amount_usd" DECIMAL(14,2) NOT NULL,
    "pay_frequency" "PayFrequency" NOT NULL DEFAULT 'ANNUAL',
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "change_reason" "SalaryChangeReason" NOT NULL,
    "note" VARCHAR(500),
    "changed_by" TEXT NOT NULL DEFAULT 'system',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "salary_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "departments_name_key" ON "departments"("name");

-- CreateIndex
CREATE UNIQUE INDEX "employees_employee_code_key" ON "employees"("employee_code");

-- CreateIndex
CREATE UNIQUE INDEX "employees_email_key" ON "employees"("email");

-- CreateIndex
CREATE INDEX "employees_country_code_department_id_level_idx" ON "employees"("country_code", "department_id", "level");

-- CreateIndex
CREATE INDEX "employees_status_idx" ON "employees"("status");

-- CreateIndex
CREATE INDEX "employees_level_country_code_idx" ON "employees"("level", "country_code");

-- CreateIndex
CREATE INDEX "employees_department_id_idx" ON "employees"("department_id");

-- CreateIndex
CREATE INDEX "employees_last_name_first_name_idx" ON "employees"("last_name", "first_name");

-- CreateIndex
CREATE INDEX "employees_manager_id_idx" ON "employees"("manager_id");

-- CreateIndex
CREATE INDEX "salary_records_employee_id_effective_to_idx" ON "salary_records"("employee_id", "effective_to");

-- CreateIndex
CREATE INDEX "salary_records_employee_id_effective_from_idx" ON "salary_records"("employee_id", "effective_from" DESC);

-- CreateIndex
CREATE INDEX "salary_records_effective_from_idx" ON "salary_records"("effective_from");

-- CreateIndex
CREATE INDEX "salary_records_change_reason_idx" ON "salary_records"("change_reason");

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_country_code_fkey" FOREIGN KEY ("country_code") REFERENCES "countries"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_manager_id_fkey" FOREIGN KEY ("manager_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "salary_records" ADD CONSTRAINT "salary_records_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Invariant: an employee has at most ONE salary record currently in effect.
--
-- The service layer enforces this inside a transaction, but application-level
-- checks lose races. This partial unique index makes the invariant impossible to
-- violate regardless of concurrency, application bugs, or manual SQL.
--
-- Prisma's schema language cannot express partial indexes, so it lives here.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX "salary_records_one_current_per_employee"
  ON "salary_records" ("employee_id")
  WHERE "effective_to" IS NULL;

-- Covering index for the hot "current salary" lookup. The partial predicate keeps
-- it to one row per employee, so joining current compensation stays an index hit
-- rather than a scan of the full history.
CREATE INDEX "salary_records_current_lookup"
  ON "salary_records" ("employee_id", "annual_amount_usd")
  WHERE "effective_to" IS NULL;

-- A record cannot end before it starts. Cheap to enforce, and it turns a subtle
-- reporting corruption into an immediate, obvious write failure.
ALTER TABLE "salary_records"
  ADD CONSTRAINT "salary_records_effective_range_valid"
  CHECK ("effective_to" IS NULL OR "effective_to" >= "effective_from");

-- Compensation is never zero or negative. A demotion is still a positive number.
ALTER TABLE "salary_records"
  ADD CONSTRAINT "salary_records_base_amount_positive"
  CHECK ("base_amount" > 0 AND "base_amount_usd" > 0 AND "annual_amount_usd" > 0);

-- Case-insensitive search on names and email. Without this, the employee list's
-- ILIKE search degrades to a sequential scan across 10,000 rows on every keystroke.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX "employees_name_search"
  ON "employees" USING gin (
    (LOWER("first_name") || ' ' || LOWER("last_name")) gin_trgm_ops
  );

CREATE INDEX "employees_email_search"
  ON "employees" USING gin (LOWER("email") gin_trgm_ops);

CREATE INDEX "employees_code_search"
  ON "employees" USING gin (LOWER("employee_code") gin_trgm_ops);
