import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithProviders } from './renderWithProviders'
import { DepositSettlementView } from '@/components/shared/DepositSettlementView'

// Shared, unmodified, by the admin Tenancy tab AND the tenant portal
// (FR-CON-10/11/12, FR-TAPP-07). `AttachmentLink` resolves `path` -> url via
// `useAttachmentUrl` — mocked at that boundary, same convention as
// tenantApp.contractPage.test.jsx.

vi.mock('@/lib/useAttachmentUrl', () => ({ useAttachmentUrl: vi.fn() }))

import { useAttachmentUrl } from '@/lib/useAttachmentUrl'

beforeEach(() => {
  vi.clearAllMocks()
  useAttachmentUrl.mockImplementation((path) => ({
    url: path ? `https://storage.example/resolved/${path}` : undefined,
    isLoading: false,
    isError: false,
  }))
})

function settlement(overrides) {
  return {
    items: [
      {
        description: 'Curățenie generală la predare',
        amount: 200,
        attachments: [],
      },
    ],
    deducted: 200,
    toReturn: 1600,
    ownerBears: 0,
    settledAt: { toDate: () => new Date('2026-07-15') },
    ...overrides,
  }
}

describe('DepositSettlementView (FR-CON-10/11/12)', () => {
  it('shows the deposit held, each item, deducted and the amount to return', async () => {
    await renderWithProviders(
      <DepositSettlementView
        securityDeposit={1800}
        depositSettlement={settlement()}
      />,
    )

    expect(screen.getByText('Garanție reținută: 1.800,00 lei')).toBeVisible()
    expect(screen.getByText('Curățenie generală la predare')).toBeVisible()
    // "200,00 lei" appears TWICE by construction here (the item's own
    // amount, and "Dedus" summing to the same figure since there is only
    // one item) — assert the count rather than a single ambiguous match.
    expect(screen.getAllByText('200,00 lei')).toHaveLength(2)
    expect(screen.getByText('1.600,00 lei')).toBeVisible()
    expect(screen.queryByText(/cost al proprietarului/)).not.toBeInTheDocument()
  })

  it('shows ownerBears instead of toReturn when deductions exceed the deposit, never both', async () => {
    await renderWithProviders(
      <DepositSettlementView
        securityDeposit={1800}
        depositSettlement={settlement({
          items: [
            { description: 'Reparații majore', amount: 2500, attachments: [] },
          ],
          deducted: 2500,
          toReturn: 0,
          ownerBears: 700,
        })}
      />,
    )

    expect(screen.getByText('700,00 lei')).toBeVisible()
    expect(screen.getByText(/cost al proprietarului/)).toBeVisible()
    expect(screen.queryByText('Sumă de returnat')).not.toBeInTheDocument()
  })

  it('renders each item’s attachments as downloadable links, resolved from their own path', async () => {
    await renderWithProviders(
      <DepositSettlementView
        securityDeposit={1800}
        depositSettlement={settlement({
          items: [
            {
              description: 'Curățenie',
              amount: 200,
              attachments: [
                {
                  path: 'tenancies/t1/settlement/invoice.pdf',
                  name: 'invoice.pdf',
                  type: 'pdf',
                },
              ],
            },
          ],
        })}
      />,
    )

    expect(screen.getByRole('link', { name: /invoice\.pdf/ })).toHaveAttribute(
      'href',
      'https://storage.example/resolved/tenancies/t1/settlement/invoice.pdf',
    )
  })

  it('shows the settled date', async () => {
    await renderWithProviders(
      <DepositSettlementView
        securityDeposit={1800}
        depositSettlement={settlement()}
      />,
    )

    expect(screen.getByText(/15 iulie 2026/)).toBeVisible()
  })
})
