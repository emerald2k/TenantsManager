import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from './renderWithProviders'
import { RecalculateBalanceControl } from '@/features/tenants/components/RecalculateBalanceControl'
import { useSignedReportsForTenancy } from '@/features/reports/hooks'
import { useRecalculateTenancyBalance } from '@/features/tenants/hooks'

vi.mock('@/features/reports/hooks', () => ({
  useSignedReportsForTenancy: vi.fn(),
}))
vi.mock('@/features/tenants/hooks', () => ({
  useRecalculateTenancyBalance: vi.fn(),
}))

const mutateAsync = vi.fn()

function tenancyFixture(overrides) {
  return { id: 't1', currentBalance: 350, ...overrides }
}

function reportsQuery(overrides) {
  return { isPending: false, isError: false, data: [], ...overrides }
}

beforeEach(() => {
  vi.clearAllMocks()
  useRecalculateTenancyBalance.mockReturnValue({
    mutateAsync,
    isPending: false,
  })
  useSignedReportsForTenancy.mockReturnValue(reportsQuery())
  mutateAsync.mockResolvedValue({ from: 350, to: 2000 })
})

function confirmDialogButton() {
  const buttons = screen.getAllByRole('button', { name: 'Recalculează' })
  return buttons[buttons.length - 1]
}

describe('RecalculateBalanceControl (FR-SYS-05a)', () => {
  it('shows the stored balance plainly', async () => {
    await renderWithProviders(
      <RecalculateBalanceControl tenancy={tenancyFixture()} userId="u1" />,
    )

    expect(screen.getByText('Sold stocat')).toBeVisible()
    expect(screen.getByText('350,00 lei')).toBeVisible()
  })

  it('opens a confirm dialog showing the stored value, the recomputed value, and the report chain', async () => {
    useSignedReportsForTenancy.mockReturnValue(
      reportsQuery({
        data: [
          { id: 'r-jun', year: 2026, month: 6, finalTotal: 1500 },
          { id: 'r-jul', year: 2026, month: 7, finalTotal: 2000 },
        ],
      }),
    )
    const user = userEvent.setup()
    await renderWithProviders(
      <RecalculateBalanceControl tenancy={tenancyFixture()} userId="u1" />,
    )

    await user.click(screen.getByText('Recalculează soldul'))

    expect(screen.getByText('Recalculezi acest sold?')).toBeVisible()
    // "2.000,00 lei" appears once as the recomputed total AND once as the
    // most recent report's own line — assert the count, not a single match.
    expect(screen.getAllByText('2.000,00 lei')).toHaveLength(2)
    expect(screen.getByText('7/2026')).toBeVisible()
    expect(screen.getByText('6/2026')).toBeVisible()
    expect(screen.getByText('1.500,00 lei')).toBeVisible()
  })

  it('confirming calls useRecalculateTenancyBalance with the tenancy/user ids and shows the result', async () => {
    const user = userEvent.setup()
    await renderWithProviders(
      <RecalculateBalanceControl tenancy={tenancyFixture()} userId="u1" />,
    )

    await user.click(screen.getByText('Recalculează soldul'))
    await user.click(confirmDialogButton())

    expect(mutateAsync).toHaveBeenCalledWith({ tenancyId: 't1', userId: 'u1' })
    expect(
      await screen.findByText('Recalculat: 350,00 lei → 2.000,00 lei'),
    ).toBeVisible()
  })

  it('shows a generic error on failure', async () => {
    mutateAsync.mockRejectedValue(new Error('boom'))
    const user = userEvent.setup()
    await renderWithProviders(
      <RecalculateBalanceControl tenancy={tenancyFixture()} userId="u1" />,
    )

    await user.click(screen.getByText('Recalculează soldul'))
    await user.click(confirmDialogButton())

    expect(
      await screen.findByText(
        'Soldul nu a putut fi recalculat. Încearcă din nou.',
      ),
    ).toBeVisible()
  })
})
