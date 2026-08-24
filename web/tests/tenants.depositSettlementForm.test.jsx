import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from './renderWithProviders'
import { DepositSettlementForm } from '@/features/tenants/components/DepositSettlementForm'
import { useSettleDeposit } from '@/features/tenants/hooks'

// Fast band — the mutation hook is mocked, no emulator. `LineAttachments`
// (reports/components/) runs FOR REAL — it is generic (control+prefix+t) and
// already covered by its own tests; using it for real here proves the item
// rows actually wire attachments into the right field-array path.

vi.mock('@/features/tenants/hooks', () => ({ useSettleDeposit: vi.fn() }))
vi.mock('@/lib/useAttachmentUrl', () => ({ useAttachmentUrl: vi.fn() }))

import { useAttachmentUrl } from '@/lib/useAttachmentUrl'

const mutateAsync = vi.fn()

function tenancyFixture(overrides) {
  return {
    id: 't1',
    securityDeposit: 1800,
    currentBalance: 0,
    status: 'ended',
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  useSettleDeposit.mockReturnValue({ mutateAsync, isPending: false })
  useAttachmentUrl.mockReturnValue({
    url: undefined,
    isLoading: false,
    isError: false,
  })
  mutateAsync.mockResolvedValue(undefined)
})

describe('DepositSettlementForm — empty state (FR-CON-10)', () => {
  it('shows the deposit held and an empty-list message when there are no items yet', async () => {
    await renderWithProviders(
      <DepositSettlementForm tenancy={tenancyFixture()} userId="u1" />,
    )

    expect(screen.getByText('Garanție reținută: 1.800,00 lei')).toBeVisible()
    expect(screen.getByText('Nicio linie de restaurare încă.')).toBeVisible()
  })
})

describe('DepositSettlementForm — adding lines and live totals', () => {
  it('adds a restoration line and updates deducted/toReturn as the amount is typed', async () => {
    const user = userEvent.setup()
    await renderWithProviders(
      <DepositSettlementForm tenancy={tenancyFixture()} userId="u1" />,
    )

    await user.click(screen.getByText('Adaugă linie de restaurare'))
    await user.type(screen.getByPlaceholderText('Descriere'), 'Curățenie')
    await user.clear(screen.getByLabelText('Sumă'))
    await user.type(screen.getByLabelText('Sumă'), '200')

    expect(screen.getByText('200,00 lei')).toBeVisible() // Deducted
    expect(screen.getByText('1.600,00 lei')).toBeVisible() // toReturn
  })

  it('shows ownerBears instead of toReturn once deductions exceed the deposit', async () => {
    const user = userEvent.setup()
    await renderWithProviders(
      <DepositSettlementForm tenancy={tenancyFixture()} userId="u1" />,
    )

    await user.click(screen.getByText('Adaugă linie de restaurare'))
    await user.type(
      screen.getByPlaceholderText('Descriere'),
      'Reparații majore',
    )
    await user.clear(screen.getByLabelText('Sumă'))
    await user.type(screen.getByLabelText('Sumă'), '2500')

    expect(screen.getByText('700,00 lei')).toBeVisible()
    expect(screen.getByText(/cost al proprietarului/)).toBeVisible()
  })
})

describe('DepositSettlementForm — pre-fill on edit', () => {
  it('pre-fills existing items from tenancy.depositSettlement', async () => {
    await renderWithProviders(
      <DepositSettlementForm
        tenancy={tenancyFixture({
          depositSettlement: {
            items: [{ description: 'Curățenie', amount: 200, attachments: [] }],
            deducted: 200,
            toReturn: 1600,
            ownerBears: 0,
            settledAt: { __fixed: true },
          },
        })}
        userId="u1"
      />,
    )

    expect(screen.getByDisplayValue('Curățenie')).toBeVisible()
    expect(screen.getByLabelText('Sumă')).toHaveValue(200)
  })
})

describe('DepositSettlementForm — confirmation + submit (FR-CON-11, §5.5 Confirmations)', () => {
  // "Finalizează decontarea" labels BOTH the form's submit button and the
  // confirm dialog's own confirm button (identical text, two separate
  // elements once the dialog is open) — same shape as End Contract's confirm
  // dialog (tenants.tenancyTab.test.jsx). Always pick the LAST match, the
  // same convention that file already uses.
  function confirmDialogButton() {
    const buttons = screen.getAllByRole('button', {
      name: 'Finalizează decontarea',
    })
    return buttons[buttons.length - 1]
  }

  async function fillAndSubmit(user) {
    await user.click(screen.getByText('Adaugă linie de restaurare'))
    await user.type(screen.getByPlaceholderText('Descriere'), 'Curățenie')
    await user.clear(screen.getByLabelText('Sumă'))
    await user.type(screen.getByLabelText('Sumă'), '200')
    await user.click(
      screen.getByRole('button', { name: 'Finalizează decontarea' }),
    )
  }

  it('opens a confirm dialog WITHOUT the arrears warning when currentBalance is 0', async () => {
    const user = userEvent.setup()
    await renderWithProviders(
      <DepositSettlementForm
        tenancy={tenancyFixture({ currentBalance: 0 })}
        userId="u1"
      />,
    )

    await fillAndSubmit(user)

    expect(screen.getByText('Finalizezi decontarea garanției?')).toBeVisible()
    expect(screen.queryByText(/mai are de plătit/)).not.toBeInTheDocument()
  })

  it('shows the arrears warning, naming it will NOT clear the balance, when currentBalance is nonzero (FR-CON-11)', async () => {
    const user = userEvent.setup()
    await renderWithProviders(
      <DepositSettlementForm
        tenancy={tenancyFixture({ currentBalance: 350 })}
        userId="u1"
      />,
    )

    await fillAndSubmit(user)

    expect(screen.getByText(/mai are de plătit 350,00 lei/)).toBeVisible()
    expect(screen.getByText(/NU achită acel sold/)).toBeVisible()
  })

  it('confirming calls useSettleDeposit with the tenancy/user ids, items, and securityDeposit', async () => {
    const user = userEvent.setup()
    await renderWithProviders(
      <DepositSettlementForm tenancy={tenancyFixture()} userId="u1" />,
    )

    await fillAndSubmit(user)
    await user.click(confirmDialogButton())

    expect(mutateAsync).toHaveBeenCalledWith({
      tenancyId: 't1',
      userId: 'u1',
      items: [{ description: 'Curățenie', amount: 200, attachments: [] }],
      securityDeposit: 1800,
      previousAttachmentPaths: [],
      existingSettledAt: null,
    })
  })

  it('a correction (existing settlement) passes the ORIGINAL settledAt through unchanged', async () => {
    const user = userEvent.setup()
    const settledAt = { __fixed: true }
    await renderWithProviders(
      <DepositSettlementForm
        tenancy={tenancyFixture({
          depositSettlement: {
            items: [{ description: 'Curățenie', amount: 200, attachments: [] }],
            deducted: 200,
            toReturn: 1600,
            ownerBears: 0,
            settledAt,
          },
        })}
        userId="u1"
      />,
    )

    await user.click(
      screen.getByRole('button', { name: 'Finalizează decontarea' }),
    )
    await user.click(confirmDialogButton())

    expect(mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ existingSettledAt: settledAt }),
    )
  })

  it('shows a generic error and keeps the dialog reachable again if the save fails', async () => {
    mutateAsync.mockRejectedValue(new Error('boom'))
    const user = userEvent.setup()
    await renderWithProviders(
      <DepositSettlementForm tenancy={tenancyFixture()} userId="u1" />,
    )

    await fillAndSubmit(user)
    await user.click(confirmDialogButton())

    expect(
      await screen.findByText(
        'Decontarea nu a putut fi salvată. Încearcă din nou.',
      ),
    ).toBeVisible()
  })
})

describe('DepositSettlementForm — Cancel (edit mode only)', () => {
  it('calls onCancel when provided', async () => {
    const onCancel = vi.fn()
    const user = userEvent.setup()
    await renderWithProviders(
      <DepositSettlementForm
        tenancy={tenancyFixture()}
        userId="u1"
        onCancel={onCancel}
      />,
    )

    await user.click(screen.getByText('Anulează'))

    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('renders no Cancel button when onCancel is not provided (first-time completion)', async () => {
    await renderWithProviders(
      <DepositSettlementForm tenancy={tenancyFixture()} userId="u1" />,
    )

    expect(screen.queryByText('Anulează')).not.toBeInTheDocument()
  })
})
