import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithProviders } from './renderWithProviders'
import { PaymentStatusBadge } from '@/features/tenantApp/components/PaymentStatusBadge'

// Fast band — pure presentational component, one prop. Same RO-only testing
// convention as reportSummaryView.test.jsx (the i18n keys themselves are
// checked for RO/EN parity separately; these tests check the LOOKUP logic).

describe('PaymentStatusBadge', () => {
  it('P1 — paymentStatus="paid" renders "Achitat"', async () => {
    await renderWithProviders(<PaymentStatusBadge paymentStatus="paid" />)
    expect(screen.getByText('Achitat')).toBeVisible()
  })

  it('P2 — paymentStatus="partial" renders "Parțial achitat"', async () => {
    await renderWithProviders(<PaymentStatusBadge paymentStatus="partial" />)
    expect(screen.getByText('Parțial achitat')).toBeVisible()
  })

  it('P3 — paymentStatus="unpaid" renders "Neachitat"', async () => {
    await renderWithProviders(<PaymentStatusBadge paymentStatus="unpaid" />)
    expect(screen.getByText('Neachitat')).toBeVisible()
  })

  it('P4 — paymentStatus={null} (and, separately, the prop omitted) renders the NEW neutral label, never "Neachitat"', async () => {
    const { rerender } = await renderWithProviders(
      <PaymentStatusBadge paymentStatus={null} />,
    )
    expect(screen.getByText('Fără plată înregistrată')).toBeVisible()
    expect(screen.queryByText('Neachitat')).not.toBeInTheDocument()

    rerender(<PaymentStatusBadge />)
    expect(screen.getByText('Fără plată înregistrată')).toBeVisible()
    expect(screen.queryByText('Neachitat')).not.toBeInTheDocument()
  })
})
