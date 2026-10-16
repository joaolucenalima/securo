import { afterEach, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'

import { TransactionSplitsSection } from '@/components/transaction-splits-section'
import { groups } from '@/lib/api'
import { renderWithProviders } from '@/test/utils'
import type { Group, TransactionSplitsInput } from '@/types'

vi.mock('@/hooks/use-display-locale', () => ({
  useDisplayLocale: () => 'en-US',
}))

afterEach(() => vi.restoreAllMocks())

it('hydrates saved amounts from an archived group without clearing them while loading', async () => {
  const archivedGroup = {
    id: 'group-1', name: 'Archived group', is_archived: true,
    members: [
      { id: 'self', name: 'Me', is_self: true },
      { id: 'friend', name: 'Friend', is_self: false },
    ],
  } as Group
  let finishList!: (value: Group[]) => void
  vi.spyOn(groups, 'list').mockImplementation(() => new Promise((resolve) => {
    finishList = resolve
  }))
  vi.spyOn(groups, 'get').mockResolvedValue(archivedGroup)
  const onChange = vi.fn()
  const saved: TransactionSplitsInput = {
    share_type: 'exact',
    splits: [
      { group_member_id: 'self', share_amount: 30 },
      { group_member_id: 'friend', share_amount: 70 },
    ],
  }

  renderWithProviders(
    <TransactionSplitsSection
      amount={100} currency="USD" value={saved}
      onChange={onChange} onValidityChange={vi.fn()}
    />,
  )
  expect(onChange).not.toHaveBeenCalled()
  finishList([archivedGroup])
  await screen.findByText('Archived group')
  await waitFor(() => expect(screen.getAllByRole('spinbutton')).toHaveLength(2))
  expect(screen.getAllByRole('spinbutton')[0]).toHaveValue(30)
  expect(screen.getAllByRole('spinbutton')[1]).toHaveValue(70)
  expect(onChange).not.toHaveBeenCalledWith(null)
  await waitFor(() => expect(onChange).toHaveBeenCalledWith(saved))
  expect(groups.list).toHaveBeenCalledWith(true)
})
