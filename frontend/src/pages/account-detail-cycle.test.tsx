/**
 * The cycle window a credit card's date fields produce, and what it makes the
 * page ask the API for.
 *
 * `lib/credit-card-cycle.test.ts` covers the arithmetic. This covers the wiring,
 * which is where the bug actually lived: the page decided it was on the open
 * cycle whenever the window matched no bill, so touching a date field made it
 * request unbilled transactions only over a period that had already closed,
 * and the charges those bills carry disappeared from a window that had just
 * been made wider.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'

import AccountDetailPage from '@/pages/account-detail'
import { renderWithProviders } from '@/test/utils'

const api = vi.hoisted(() => ({
  accounts: {
    get: vi.fn(),
    bills: vi.fn(),
    summary: vi.fn(),
    list: vi.fn(),
    update: vi.fn(),
  },
  transactions: { list: vi.fn(), update: vi.fn(), delete: vi.fn(), create: vi.fn() },
  dashboard: { projectedTransactions: vi.fn() },
  categories: { list: vi.fn() },
  categoryGroups: { list: vi.fn() },
}))

vi.mock('@/lib/api', () => ({
  accounts: api.accounts,
  transactions: api.transactions,
  dashboard: api.dashboard,
  categories: api.categories,
  categoryGroups: api.categoryGroups,
}))

vi.mock('@/hooks/use-display-locale', () => ({
  useDisplayLocale: () => 'en-US',
  useDateLocale: () => 'en-US',
}))

vi.mock('@/hooks/use-privacy-mode', () => ({
  usePrivacyMode: () => ({ mask: (value: string) => value, privacyMode: false, MASK: '***' }),
}))

vi.mock('@/contexts/auth-context', () => ({
  useAuth: () => ({ user: { preferences: { currency_display: 'BRL' } } }),
}))

vi.mock('@/contexts/workspace-context', () => ({
  useWorkspace: () => ({ canWrite: true }),
}))

// Closes on the 30th, bills due on the 10th. The newest bill is due
// 2026-05-10, so the cycle that is still open starts on 2026-04-30.
const account = {
  id: 'acc-1',
  name: 'Card',
  type: 'credit_card',
  currency: 'BRL',
  balance: -280,
  is_active: true,
  credit_limit: 5000,
  statement_close_day: 30,
  payment_due_day: 10,
}

const bills = [
  { id: 'bill-apr', account_id: 'acc-1', external_id: 'a', due_date: '2026-04-10', total_amount: 125, currency: 'BRL', minimum_payment: null },
  { id: 'bill-may', account_id: 'acc-1', external_id: 'b', due_date: '2026-05-10', total_amount: 280, currency: 'BRL', minimum_payment: null },
]

/** The cycle header. Matching on the month alone is ambiguous: the timeline
 *  bar for the same cycle carries the same text. */
function cycleHeader() {
  return screen
    .getAllByRole('button')
    .find((b) => b.getAttribute('aria-haspopup') === 'dialog' && /\d{4}|-/.test(b.textContent ?? ''))!
}

/** Every `transactions.list` call the page has made, oldest first. */
function txCalls() {
  return api.transactions.list.mock.calls.map(([args]) => args as Record<string, unknown>)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.setSystemTime(new Date('2026-05-11T12:00:00'))
  api.accounts.get.mockResolvedValue(account)
  api.accounts.bills.mockResolvedValue(bills)
  api.accounts.list.mockResolvedValue([account])
  api.accounts.summary.mockResolvedValue({
    monthly_income: 0, monthly_expenses: 0, projected_income: 0, projected_expenses: 0,
  })
  api.transactions.list.mockResolvedValue({ items: [], total: 0 })
  api.dashboard.projectedTransactions.mockResolvedValue([])
  api.categories.list.mockResolvedValue([])
  api.categoryGroups.list.mockResolvedValue([])
})

async function renderPage() {
  const rendered = renderWithProviders(<AccountDetailPage />, {
    route: '/accounts/acc-1',
    path: '/accounts/:id',
  })
  await waitFor(() => expect(api.transactions.list).toHaveBeenCalled())
  return rendered
}

describe('credit card cycle window', () => {
  it('loads an early pending purchase from the next page of the bill', async () => {
    vi.setSystemTime(new Date('2026-10-03T12:00:00'))
    api.accounts.get.mockResolvedValue({ ...account, statement_close_day: 5, payment_due_day: 12 })
    api.accounts.bills.mockResolvedValue([
      { ...bills[0], due_date: '2026-09-12' },
      { ...bills[1], due_date: '2026-10-12' },
    ])
    const purchase = {
      id: 'early-purchase', account_id: account.id, description: 'VALEDRIVER',
      amount: 42, currency: 'BRL', date: '2026-09-04', type: 'debit',
      source: 'sync', status: 'pending', bill_id: null, category: null,
      splits: [], is_ignored: false,
    }
    api.transactions.list.mockImplementation(async ({ from, page }) => {
      if (from !== '2026-09-04') return { items: [], total: 0 }
      return {
        items: page === 2 ? [purchase] : [{ ...purchase, id: 'recent', date: '2026-10-03', description: 'Recent purchase' }],
        total: 2,
      }
    })

    await renderPage()

    expect(await screen.findByText('VALEDRIVER')).toBeInTheDocument()
    expect(txCalls()).toContainEqual(expect.objectContaining({
      page: 2, bill_id: 'bill-may', from: '2026-09-04', to: '2026-10-04',
      bill_cycle_view: true, include_summary: false,
    }))
  })

  it('uses the closing day for a bill while retaining its bill ID', async () => {
    vi.setSystemTime(new Date('2026-10-03T12:00:00'))
    api.accounts.get.mockResolvedValue({ ...account, statement_close_day: 5, payment_due_day: 12 })
    api.accounts.bills.mockResolvedValue([
      { ...bills[0], due_date: '2026-09-12' },
      { ...bills[1], due_date: '2026-10-12' },
    ])

    await renderPage()

    await waitFor(() => {
      const last = txCalls().at(-1)!
      expect(last.bill_id).toBe('bill-may')
      expect(last.from).toBe('2026-09-04')
      expect(last.to).toBe('2026-10-04')
      expect(last.bill_cycle_view).toBe(true)
    })
  })

  it('uses the nearest weekday when the configured close falls on Saturday', async () => {
    vi.setSystemTime(new Date('2026-09-03T12:00:00'))
    api.accounts.get.mockResolvedValue({ ...account, statement_close_day: 5, payment_due_day: 12 })
    api.accounts.bills.mockResolvedValue([
      { ...bills[0], due_date: '2026-08-12' },
      { ...bills[1], due_date: '2026-09-12' },
    ])

    await renderPage()

    await waitFor(() => {
      const last = txCalls().at(-1)!
      expect(last.bill_id).toBe('bill-may')
      expect(last.from).toBe('2026-08-05')
      expect(last.to).toBe('2026-09-03')
    })
  })

  it('keeps a missing bill cycle reachable after a Friday adjusted close', async () => {
    vi.setSystemTime(new Date('2026-10-15T12:00:00'))
    api.accounts.get.mockResolvedValue({ ...account, statement_close_day: 5, payment_due_day: 12 })
    api.accounts.bills.mockResolvedValue([
      { ...bills[0], due_date: '2026-08-12' },
      { ...bills[1], due_date: '2026-09-12' },
    ])

    const { user } = await renderPage()
    await user.click(await screen.findByTitle('Previous cycle'))

    await waitFor(() => {
      const last = txCalls().at(-1)!
      expect(last.from).toBe('2026-09-04')
      expect(last.to).toBe('2026-10-04')
      expect(last.bill_id).toBeUndefined()
      expect(last.unbilled_only).toBe(true)
    })
  })

  it('uses the same unlinked filter for a historical gap in the list and timeline', async () => {
    vi.setSystemTime(new Date('2026-11-15T12:00:00'))
    api.accounts.get.mockResolvedValue({ ...account, statement_close_day: 5, payment_due_day: 12 })
    api.accounts.bills.mockResolvedValue([
      { ...bills[0], due_date: '2026-09-12' },
      { ...bills[1], due_date: '2026-11-12' },
    ])
    const { user } = await renderPage()
    await user.click(await screen.findByTitle('Previous cycle'))
    await user.click(await screen.findByTitle('Previous cycle'))

    await waitFor(() => expect(txCalls().at(-1)).toEqual(expect.objectContaining({
      from: '2026-09-04', to: '2026-10-04', unbilled_only: true,
      bill_id: undefined, bill_cycle_view: true,
    })))
    expect(api.accounts.summary).toHaveBeenCalledWith(
      'acc-1', '2026-09-04', '2026-10-04', undefined, true, true,
    )
  })

  it('does not retain a bill filter when only the start of a custom range changes', async () => {
    const { user } = await renderPage()
    await user.click(await screen.findByTitle('Previous cycle'))
    await user.click(cycleHeader())
    await user.click(await screen.findByRole('button', { name: '3/30/2026' }))
    await user.click(await screen.findByRole('button', { name: '15' }))

    await waitFor(() => expect(txCalls().at(-1)).toEqual(expect.objectContaining({
      from: '2026-03-15', to: '2026-04-29',
      bill_id: undefined, unbilled_only: undefined,
    })))
  })

  it('asks for unbilled transactions only on the cycle that is still open', async () => {
    await renderPage()

    // No bill is due after today, so the page opens on the trailing cycle.
    // Excluding already-billed rows there is the whole point of the flag:
    // the window overlaps the newest closed bill's range.
    await waitFor(() => {
      const last = txCalls().at(-1)!
      expect(last.unbilled_only).toBe(true)
      expect(String(last.from) >= '2026-04-30').toBe(true)
    })
  })

  it('does not ask for unbilled transactions only on a bill cycle', async () => {
    const { user } = await renderPage()

    await user.click(await screen.findByTitle('Previous cycle'))

    await waitFor(() => {
      const last = txCalls().at(-1)!
      expect(last.bill_id).toBe('bill-may')
      expect(last.unbilled_only).toBeUndefined()
    })
  })

  it('does not ask for unbilled transactions only on a hand-picked range', async () => {
    const { user } = await renderPage()

    // Land on a real bill first, then move the end date off it. The window
    // still covers everything the bill cycle did, so nothing about the edit
    // may remove a transaction from the answer.
    await user.click(await screen.findByTitle('Previous cycle'))
    await waitFor(() => expect(txCalls().at(-1)!.bill_id).toBe('bill-may'))

    await user.click(cycleHeader())
    await user.click(await screen.findByRole('button', { name: '4/29/2026' }))
    await user.click(await screen.findByRole('button', { name: 'April 2026' }))
    await user.click(await screen.findByRole('button', { name: 'May' }))
    await user.click(await screen.findByRole('button', { name: '15' }))

    await waitFor(() => {
      const last = txCalls().at(-1)!
      expect(last.to).toBe('2026-05-15')
      expect(last.bill_id).toBeUndefined()
      // The regression: this used to be `true`, and the R$280 bill's charges
      // vanished from a window five days wider than the one that showed them.
      expect(last.unbilled_only).toBeUndefined()
    })
  })

  it('names a hand-picked range by its own dates instead of a statement month', async () => {
    const { user } = await renderPage()

    await user.click(await screen.findByTitle('Previous cycle'))
    await user.click(cycleHeader())
    await user.click(await screen.findByRole('button', { name: '4/29/2026' }))
    await user.click(await screen.findByRole('button', { name: 'April 2026' }))
    await user.click(await screen.findByRole('button', { name: 'May' }))
    await user.click(await screen.findByRole('button', { name: '15' }))

    // Before the fix this read "Jun 2026", naming the window after a bill it
    // has no claim to.
    await waitFor(() => expect(cycleHeader().textContent).toMatch(/30 Mar - 15 May/i))
  })
})
