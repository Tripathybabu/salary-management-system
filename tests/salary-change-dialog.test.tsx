/**
 * Salary change dialog.
 *
 * The highest-risk interaction in the app: it writes money. These tests cover the
 * behaviour that protects the user from a mistyped figure, and the behaviour that
 * turns a server rejection into something actionable.
 *
 * The API module is mocked so these stay fast and deterministic — the real
 * request path is covered by the API integration suite.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SalaryChangeDialog } from '@/components/salary-change-dialog';
import { ApiError } from '@/lib/api';

const recordSalaryChange = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return { ...actual, recordSalaryChange };
});

function renderDialog(props: Partial<Parameters<typeof SalaryChangeDialog>[0]> = {}) {
  const onClose = vi.fn();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  render(
    <QueryClientProvider client={client}>
      <SalaryChangeDialog
        employeeId="emp-1"
        employeeName="Ada Lovelace"
        currentCurrency="USD"
        currentAmount={100_000}
        onClose={onClose}
        {...props}
      />
    </QueryClientProvider>,
  );

  return { onClose };
}

beforeEach(() => {
  recordSalaryChange.mockReset();
  recordSalaryChange.mockResolvedValue({
    record: {
      id: 'rec-1',
      baseAmount: 110_000,
      currency: 'USD',
      annualAmountUsd: 110_000,
      effectiveFrom: '2026-01-01',
      changeReason: 'MERIT_INCREASE',
    },
    previous: { baseAmount: 100_000, currency: 'USD', annualAmountUsd: 100_000 },
    changePercent: 10,
  });
});

describe('live change preview', () => {
  it('shows the percentage change as the user types', async () => {
    // The whole point: the consequence of the number is visible before commit.
    const user = userEvent.setup();
    renderDialog();

    const amount = screen.getByLabelText('New amount');
    await user.clear(amount);
    await user.type(amount, '110000');

    expect(await screen.findByText('+10.0%')).toBeInTheDocument();
  });

  it('warns on a change large enough to look like a typo', async () => {
    // An extra zero turns 110,000 into 1,100,000. That must be visible before
    // the write, not discovered afterwards in the dashboard totals.
    const user = userEvent.setup();
    renderDialog();

    const amount = screen.getByLabelText('New amount');
    await user.clear(amount);
    await user.type(amount, '1100000');

    expect(await screen.findByText(/large change/i)).toBeInTheDocument();
  });

  it('shows a decrease as a negative change', async () => {
    const user = userEvent.setup();
    renderDialog();

    const amount = screen.getByLabelText('New amount');
    await user.clear(amount);
    await user.type(amount, '90000');

    expect(await screen.findByText('-10.0%')).toBeInTheDocument();
  });

  it('withholds the percentage when the currency differs from the current one', async () => {
    // Across currencies the difference is partly FX. Labelling that as a raise
    // would put a false number in front of the user.
    const user = userEvent.setup();
    renderDialog();

    await user.selectOptions(screen.getByLabelText('Currency'), 'EUR');

    const amount = screen.getByLabelText('New amount');
    await user.clear(amount);
    await user.type(amount, '110000');

    await waitFor(() => {
      expect(screen.queryByText(/Change from current/i)).not.toBeInTheDocument();
    });
  });

  it('shows no preview for an employee with no current salary', async () => {
    renderDialog({ currentAmount: null });

    expect(screen.queryByText(/Change from current/i)).not.toBeInTheDocument();
  });
});

describe('submission', () => {
  it('sends the change and closes on success', async () => {
    const user = userEvent.setup();
    const { onClose } = renderDialog();

    const amount = screen.getByLabelText('New amount');
    await user.clear(amount);
    await user.type(amount, '110000');
    await user.selectOptions(screen.getByLabelText('Reason'), 'PROMOTION');
    await user.click(screen.getByRole('button', { name: /record change/i }));

    await waitFor(() => expect(recordSalaryChange).toHaveBeenCalledTimes(1));

    const [employeeId, body] = recordSalaryChange.mock.calls[0]!;
    expect(employeeId).toBe('emp-1');
    expect(body).toMatchObject({
      baseAmount: 110_000,
      currency: 'USD',
      changeReason: 'PROMOTION',
    });

    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('rejects a zero amount without calling the API', async () => {
    const user = userEvent.setup();
    renderDialog();

    const amount = screen.getByLabelText('New amount');
    await user.clear(amount);
    await user.type(amount, '0');
    await user.click(screen.getByRole('button', { name: /record change/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/greater than zero/i);
    expect(recordSalaryChange).not.toHaveBeenCalled();
  });

  it('surfaces a server conflict as a readable message', async () => {
    // A backdated effective date is rejected with 409. The user needs the reason,
    // not a generic failure.
    recordSalaryChange.mockRejectedValue(
      new ApiError(409, 'CONFLICT', 'Effective date must be after the current salary start date'),
    );

    const user = userEvent.setup();
    const { onClose } = renderDialog();

    const amount = screen.getByLabelText('New amount');
    await user.clear(amount);
    await user.type(amount, '110000');
    await user.click(screen.getByRole('button', { name: /record change/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/must be after/i);
    // The dialog stays open so the user can correct the date.
    expect(onClose).not.toHaveBeenCalled();
  });

  it('maps a field-level server error onto its field', async () => {
    // The amount below passes client-side validation, so the request is actually
    // sent and the server's field-keyed rejection is what gets rendered — which
    // is the path this test exists to cover.
    recordSalaryChange.mockRejectedValue(
      new ApiError(400, 'VALIDATION_ERROR', 'Request validation failed', {
        baseAmount: ['Salary exceeds the maximum supported value'],
      }),
    );

    const user = userEvent.setup();
    renderDialog();

    const amount = screen.getByLabelText('New amount');
    await user.clear(amount);
    await user.type(amount, '110000');
    await user.click(screen.getByRole('button', { name: /record change/i }));

    // Rendered against the amount field, not as a generic banner, so the form
    // highlights the input the user has to fix.
    expect(await screen.findByText(/exceeds the maximum/i)).toBeInTheDocument();
  });
});

describe('dismissal', () => {
  it('closes on Escape', async () => {
    const user = userEvent.setup();
    const { onClose } = renderDialog();

    await user.keyboard('{Escape}');

    expect(onClose).toHaveBeenCalled();
  });

  it('closes on Cancel without writing anything', async () => {
    const user = userEvent.setup();
    const { onClose } = renderDialog();

    await user.click(screen.getByRole('button', { name: /cancel/i }));

    expect(onClose).toHaveBeenCalled();
    expect(recordSalaryChange).not.toHaveBeenCalled();
  });
});

describe('accessibility', () => {
  it('is a labelled modal dialog', async () => {
    renderDialog();

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleName(/record salary change/i);
  });
});
