'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  JOB_LEVELS,
  JOB_LEVEL_LABELS,
  EMPLOYMENT_TYPES,
  GENDERS,
  CURRENCIES,
  createEmployeeSchema,
} from '@salary/shared';
import { createEmployee, getFilterOptions, ApiError, type CreateEmployeeBody } from '@/lib/api';
import { humanise } from '@/lib/format';
import { Card, CardHeader, Button, Input, Select, Field } from '@/components/ui';

/**
 * Onboard a new employee.
 *
 * Validated with the same Zod schema the API uses — imported from @salary/shared
 * rather than re-declared. That is the main reason this repo is a monorepo: the
 * rule the form enforces and the rule the server enforces cannot drift apart.
 *
 * Starting salary is required, not optional. An employee with no salary record is
 * invisible to every analytics query, so allowing one would silently corrupt the
 * dashboard rather than produce a visible error.
 */
export default function NewEmployeePage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const filters = useQuery({ queryKey: ['filters'], queryFn: getFilterOptions });

  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    email: '',
    countryCode: '',
    departmentId: '',
    jobTitle: '',
    level: 'L3',
    employmentType: 'FULL_TIME',
    gender: 'UNDISCLOSED',
    hireDate: new Date().toISOString().slice(0, 10),
    baseAmount: '',
    currency: 'USD',
    payFrequency: 'ANNUAL',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  function set(field: keyof typeof form) {
    return (value: string) => {
      setForm((current) => ({ ...current, [field]: value }));
      // Clear the error as soon as the user edits the field: keeping it visible
      // while they fix it is just noise.
      setErrors((current) => {
        if (!current[field]) return current;
        const { [field]: _removed, ...rest } = current;
        return rest;
      });
    };
  }

  /** Selecting a country defaults the currency to that country's own. */
  function onCountryChange(code: string) {
    set('countryCode')(code);
    const country = filters.data?.countries.find((entry) => entry.code === code);
    if (country) set('currency')(country.currencyCode);
  }

  const mutation = useMutation({
    mutationFn: (body: CreateEmployeeBody) => createEmployee(body),
    onSuccess: (created) => {
      void queryClient.invalidateQueries({ queryKey: ['employees'] });
      void queryClient.invalidateQueries({ queryKey: ['overview'] });
      void queryClient.invalidateQueries({ queryKey: ['breakdown'] });
      router.push(`/employees/${created.id}`);
    },
    onError: (error) => {
      if (error instanceof ApiError && error.fieldErrors) {
        const mapped: Record<string, string> = {};
        for (const [field, messages] of Object.entries(error.fieldErrors)) {
          if (messages?.[0]) mapped[field] = messages[0];
        }
        setErrors(mapped);
      }
    },
  });

  function submit(event: React.FormEvent) {
    event.preventDefault();

    const candidate = { ...form, baseAmount: Number(form.baseAmount) };
    // Validated client-side with the server's own schema, so the user gets
    // field-level feedback without a round-trip. The server validates again
    // regardless — client validation is a convenience, never a guarantee.
    const parsed = createEmployeeSchema.safeParse(candidate);

    if (!parsed.success) {
      const mapped: Record<string, string> = {};
      for (const [field, messages] of Object.entries(parsed.error.flatten().fieldErrors)) {
        if (messages?.[0]) mapped[field] = messages[0];
      }
      setErrors(mapped);
      return;
    }

    mutation.mutate({ ...candidate, hireDate: form.hireDate } as CreateEmployeeBody);
  }

  const generalError =
    mutation.error instanceof ApiError && !mutation.error.fieldErrors
      ? mutation.error.message
      : null;

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <Link href="/employees" className="text-sm text-ink-muted hover:text-ink">
        ← Back to employees
      </Link>

      <Card>
        <CardHeader
          title="Add employee"
          description="Starting compensation is required — an employee without a salary record would be missing from every pay report"
        />

        <form onSubmit={submit} className="space-y-4 p-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="First name" error={errors.firstName}>
              <Input
                value={form.firstName}
                onChange={(event) => set('firstName')(event.target.value)}
                required
              />
            </Field>
            <Field label="Last name" error={errors.lastName}>
              <Input
                value={form.lastName}
                onChange={(event) => set('lastName')(event.target.value)}
                required
              />
            </Field>
          </div>

          <Field label="Email" error={errors.email}>
            <Input
              type="email"
              value={form.email}
              onChange={(event) => set('email')(event.target.value)}
              required
            />
          </Field>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Country" error={errors.countryCode}>
              <Select
                value={form.countryCode}
                onChange={(event) => onCountryChange(event.target.value)}
                required
              >
                <option value="">Select a country</option>
                {filters.data?.countries.map((country) => (
                  <option key={country.code} value={country.code}>
                    {country.name}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Department" error={errors.departmentId}>
              <Select
                value={form.departmentId}
                onChange={(event) => set('departmentId')(event.target.value)}
                required
              >
                <option value="">Select a department</option>
                {filters.data?.departments.map((department) => (
                  <option key={department.id} value={department.id}>
                    {department.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <Field label="Job title" error={errors.jobTitle}>
            <Input
              value={form.jobTitle}
              onChange={(event) => set('jobTitle')(event.target.value)}
              placeholder="Software Engineer"
              required
            />
          </Field>

          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Level" error={errors.level}>
              <Select value={form.level} onChange={(event) => set('level')(event.target.value)}>
                {JOB_LEVELS.map((level) => (
                  <option key={level} value={level}>
                    {JOB_LEVEL_LABELS[level]}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Employment type" error={errors.employmentType}>
              <Select
                value={form.employmentType}
                onChange={(event) => set('employmentType')(event.target.value)}
              >
                {EMPLOYMENT_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {humanise(type)}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Gender" error={errors.gender} hint="Used only for pay-gap reporting">
              <Select value={form.gender} onChange={(event) => set('gender')(event.target.value)}>
                {GENDERS.map((gender) => (
                  <option key={gender} value={gender}>
                    {humanise(gender)}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <Field label="Hire date" error={errors.hireDate}>
            <Input
              type="date"
              value={form.hireDate}
              onChange={(event) => set('hireDate')(event.target.value)}
              required
            />
          </Field>

          <div className="rounded-lg border border-border bg-surface p-4">
            <p className="mb-3 text-xs font-semibold text-ink">Starting compensation</p>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Amount" error={errors.baseAmount}>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={form.baseAmount}
                  onChange={(event) => set('baseAmount')(event.target.value)}
                  placeholder="95000"
                  required
                />
              </Field>

              <Field label="Currency" error={errors.currency}>
                <Select
                  value={form.currency}
                  onChange={(event) => set('currency')(event.target.value)}
                >
                  {Object.keys(CURRENCIES).map((code) => (
                    <option key={code} value={code}>
                      {code}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field label="Frequency" error={errors.payFrequency}>
                <Select
                  value={form.payFrequency}
                  onChange={(event) => set('payFrequency')(event.target.value)}
                >
                  <option value="ANNUAL">Annual</option>
                  <option value="MONTHLY">Monthly</option>
                </Select>
              </Field>
            </div>
          </div>

          {generalError ? (
            <p role="alert" className="rounded-lg bg-negative/10 px-3 py-2 text-sm text-negative">
              {generalError}
            </p>
          ) : null}

          <div className="flex justify-end gap-2 pt-1">
            <Link href="/employees">
              <Button type="button" variant="secondary">
                Cancel
              </Button>
            </Link>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? 'Creating…' : 'Create employee'}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
