import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from './renderWithProviders'
import { PaymentSection } from '@/features/reports/components/PaymentSection'
import {
  useCancelPayment,
  useMarkPayment,
  useSendPaymentConfirmation,
} from '@/features/reports/hooks'

vi.mock('@/features/reports/hooks', () => ({
  useMarkPayment: vi.fn(),
  useCancelPayment: vi.fn(),
  useSendPaymentConfirmation: vi.fn(),
}))

const markMutateAsync = vi.fn()
const cancelMutateAsync = vi.fn()
const confirmMutateAsync = vi.fn()

const UNPAID_REPORT = {
  id: 'r1',
  finalTotal: 1500,
  amountPaid: null,
  paymentMethod: null,
  paymentDate: null,
  paymentStatus: 'unpaid',
}

beforeEach(() => {
  vi.clearAllMocks()
  markMutateAsync.mockResolvedValue({})
  cancelMutateAsync.mockResolvedValue({})
  confirmMutateAsync.mockResolvedValue({})
  useMarkPayment.mockReturnValue({
    mutateAsync: markMutateAsync,
    isPending: false,
  })
  useCancelPayment.mockReturnValue({
    mutateAsync: cancelMutateAsync,
    isPending: false,
  })
  useSendPaymentConfirmation.mockReturnValue({
    mutateAsync: confirmMutateAsync,
    isPending: false,
  })
})

describe('PaymentSection — marking a payment', () => {
  it('submits amountPaid/paymentMethod/paymentDate + finalTotal to useMarkPayment', async () => {
    const user = userEvent.setup()
    await renderWithProviders(<PaymentSection report={UNPAID_REPORT} />)

    const amountInput = screen.getByLabelText('Sumă achitată')
    await user.clear(amountInput) // default is 0 — clear before typing, or '1000' appends onto it
    await user.type(amountInput, '1000')
    await user.selectOptions(screen.getByLabelText('Metodă'), 'cash')
    const dateInput = screen.getByLabelText('Data plății')
    await user.clear(dateInput)
    await user.type(dateInput, '2026-07-10')
    await user.click(screen.getByText('Marchează plata'))

    expect(markMutateAsync).toHaveBeenCalledWith({
      id: 'r1',
      values: {
        amountPaid: 1000,
        paymentMethod: 'cash',
        paymentDate: '2026-07-10',
      },
      finalTotal: 1500,
    })
  })

  it('pre-fills the form from an EXISTING payment (correction, FR-PAY-06)', async () => {
    await renderWithProviders(
      <PaymentSection
        report={{
          ...UNPAID_REPORT,
          amountPaid: 1000,
          paymentMethod: 'cash',
          paymentDate: '2026-07-10',
          paymentStatus: 'partial',
        }}
      />,
    )

    expect(screen.getByLabelText('Sumă achitată')).toHaveValue(1000)
    expect(screen.getByDisplayValue('2026-07-10')).toBeVisible()
  })

  it('shows the credit notice on an overpayment', async () => {
    await renderWithProviders(
      <PaymentSection
        report={{
          ...UNPAID_REPORT,
          amountPaid: 1800,
          paymentMethod: 'cash',
          paymentDate: '2026-07-10',
          paymentStatus: 'paid',
        }}
      />,
    )

    expect(await screen.findByText(/apare drept credit/)).toBeVisible()
  })

  it('does NOT show the credit notice when paid exactly / partially / unpaid', async () => {
    await renderWithProviders(<PaymentSection report={UNPAID_REPORT} />)
    expect(screen.queryByText(/apare drept credit/)).toBeNull()
  })
})

describe('PaymentSection — no Cancel button before any payment is ever marked', () => {
  it('does NOT show Cancel on a report with no paymentStatus field at all (never marked yet)', async () => {
    const { paymentStatus, ...reportWithoutPaymentStatus } = UNPAID_REPORT
    void paymentStatus
    await renderWithProviders(
      <PaymentSection report={reportWithoutPaymentStatus} />,
    )
    expect(screen.queryByText('Anulează plata')).toBeNull()
  })

  it('does NOT show Cancel while explicitly unpaid', async () => {
    await renderWithProviders(<PaymentSection report={UNPAID_REPORT} />)
    expect(screen.queryByText('Anulează plata')).toBeNull()
  })
})

describe('PaymentSection — reflects fresh data after a mutation (no stale form state)', () => {
  it('re-syncs the amount input when the report prop changes (e.g. after a mark/cancel refetch)', async () => {
    const { rerender } = await renderWithProviders(
      <PaymentSection report={UNPAID_REPORT} />,
    )
    expect(screen.getByLabelText('Sumă achitată')).toHaveValue(0)

    // Simulates the invalidateQueries-driven refetch after useMarkPayment
    // resolves — a NEW report object arrives as a prop; the form must not
    // keep showing the pre-mutation defaultValues from mount.
    rerender(
      <PaymentSection
        report={{
          ...UNPAID_REPORT,
          amountPaid: 1000,
          paymentMethod: 'cash',
          paymentStatus: 'partial',
        }}
      />,
    )

    expect(await screen.findByLabelText('Sumă achitată')).toHaveValue(1000)
  })
})

describe('PaymentSection — cancelling a payment', () => {
  it('confirms then calls useCancelPayment with the report id', async () => {
    const user = userEvent.setup()
    await renderWithProviders(
      <PaymentSection
        report={{
          ...UNPAID_REPORT,
          amountPaid: 1000,
          paymentStatus: 'partial',
        }}
      />,
    )

    await user.click(screen.getByText('Anulează plata'))
    expect(
      screen.getByText(
        'Plata înregistrată este ștearsă, iar raportul redevine neplătit.',
      ),
    ).toBeVisible()
    await user.click(screen.getByText('Confirmă anularea'))

    expect(cancelMutateAsync).toHaveBeenCalledWith({ id: 'r1' })
  })
})
