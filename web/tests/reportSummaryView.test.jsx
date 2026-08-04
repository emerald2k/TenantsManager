import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithProviders } from './renderWithProviders'
import { ReportSummaryView } from '@/components/shared/ReportSummaryView'

// Fast band — pure presentational component, no hooks/network. Fed by the
// SAME shape getSharedReportCore's allowlist returns (functions/src/
// sharedReport.js's toPublicReport) and by ExportReportControls'
// toReportSummaryData adapter — both are exercised via this one component.

function summaryData(overrides = {}) {
  return {
    propertyName: 'Apartament Centru',
    month: 7,
    year: 2026,
    rent: { amount: 2500, notes: '', attachments: [] },
    maintenance: { amount: 0, notes: '', attachments: [] },
    serviceCosts: [],
    otherExpenses: [],
    previousMonthArrears: 0,
    previousMonthCredit: 0,
    calculatedTotal: 2500,
    finalTotal: 2500,
    dueDate: '2026-07-10',
    paymentStatus: null,
    amountPaid: null,
    ...overrides,
  }
}

describe('ReportSummaryView', () => {
  it('renders the property name, month/year, and the rent/maintenance lines', async () => {
    await renderWithProviders(<ReportSummaryView data={summaryData()} />)

    expect(screen.getByText('Apartament Centru')).toBeVisible()
    expect(screen.getByText('7/2026')).toBeVisible()
    expect(screen.getByText('Chirie')).toBeVisible()
    expect(screen.getByText('Mentenanță')).toBeVisible()
    // rent (2500) AND finalTotal (2500, since maintenance is 0) both render
    // this text — legitimate, not a duplicate bug.
    expect(screen.getAllByText('2.500,00 lei').length).toBeGreaterThanOrEqual(1)
  })

  it('renders each service/other-expense line by its own label', async () => {
    await renderWithProviders(
      <ReportSummaryView
        data={summaryData({
          serviceCosts: [
            { name: 'Electricitate', amount: 150, notes: '', attachments: [] },
          ],
          otherExpenses: [
            {
              description: 'Reparație',
              amount: 200,
              notes: '',
              attachments: [],
            },
          ],
        })}
      />,
    )

    expect(screen.getByText('Electricitate')).toBeVisible()
    expect(screen.getByText('Reparație')).toBeVisible()
  })

  it('renders attachments as NAME+TYPE badges, never as images', async () => {
    const { container } = await renderWithProviders(
      <ReportSummaryView
        data={summaryData({
          rent: {
            amount: 2500,
            notes: '',
            attachments: [{ name: 'rent-invoice.pdf', type: 'pdf' }],
          },
        })}
      />,
    )

    expect(screen.getByText('rent-invoice.pdf (pdf)')).toBeVisible()
    expect(container.querySelectorAll('img')).toHaveLength(0)
  })

  it('renders the final total, due date, and previous arrears/credit', async () => {
    await renderWithProviders(
      <ReportSummaryView
        data={summaryData({
          finalTotal: 2730,
          previousMonthArrears: 100,
          previousMonthCredit: 50,
        })}
      />,
    )

    expect(screen.getByText('2.730,00 lei')).toBeVisible()
    expect(screen.getByText('100,00 lei')).toBeVisible()
    expect(screen.getByText('50,00 lei')).toBeVisible()
    expect(screen.getByText('2026-07-10')).toBeVisible()
  })

  it('shows "unpaid" when paymentStatus is absent (null) — the discriminating case, never crashes', async () => {
    await renderWithProviders(
      <ReportSummaryView data={summaryData({ paymentStatus: null })} />,
    )

    expect(screen.getByText('Neachitat')).toBeVisible()
  })

  it('shows the correct label for paid/partial', async () => {
    const { rerender } = await renderWithProviders(
      <ReportSummaryView data={summaryData({ paymentStatus: 'paid' })} />,
    )
    expect(screen.getByText('Achitat')).toBeVisible()

    rerender(
      <ReportSummaryView data={summaryData({ paymentStatus: 'partial' })} />,
    )
    expect(screen.getByText('Parțial achitat')).toBeVisible()
  })

  // M5 sub-stage 2 plan: two new props, both defaulting to reproduce
  // /r/:shareToken's current output exactly (no caller above needs to
  // change) — propertyName and showCalculatedTotal.

  it('C1 — propertyName prop is optional, falls back to data.propertyName when omitted', async () => {
    await renderWithProviders(
      <ReportSummaryView data={summaryData({ propertyName: 'Vila Nord' })} />,
    )
    expect(screen.getByText('Vila Nord')).toBeVisible()
  })

  it('C2 — calculatedTotal is hidden by default (showCalculatedTotal defaults to false)', async () => {
    await renderWithProviders(
      <ReportSummaryView
        data={summaryData({ calculatedTotal: 3000, finalTotal: 2500 })}
      />,
    )
    expect(screen.queryByText('3.000,00 lei')).not.toBeInTheDocument()
  })

  it('C3 — showCalculatedTotal=true and an explicit propertyName both work forward', async () => {
    await renderWithProviders(
      <ReportSummaryView
        data={summaryData({
          propertyName: undefined,
          calculatedTotal: 3000,
          finalTotal: 2500,
        })}
        propertyName="Explicit Name"
        showCalculatedTotal
      />,
    )
    expect(screen.getByText('Explicit Name')).toBeVisible()
    expect(screen.getByText('3.000,00 lei')).toBeVisible()
  })

  // M5 sub-stage 3 plan: two MORE default-preserving props, same mechanism —
  // showPaymentStatus and showHeader, both defaulting to true so /r/:shareToken
  // and the admin PDF/PNG export render byte-for-byte identically to today.

  it("R1 — with no new props, BOTH the header and the payment-status row still render (today's behavior, unchanged)", async () => {
    await renderWithProviders(<ReportSummaryView data={summaryData()} />)

    expect(screen.getByText('Apartament Centru')).toBeVisible()
    expect(screen.getByText('7/2026')).toBeVisible()
    expect(screen.getByText('Neachitat')).toBeVisible()
  })

  it('R2 — showPaymentStatus={false} hides the payment-status row; header and table remain', async () => {
    await renderWithProviders(
      <ReportSummaryView data={summaryData()} showPaymentStatus={false} />,
    )

    expect(screen.queryByText('Neachitat')).not.toBeInTheDocument()
    expect(screen.getByText('Apartament Centru')).toBeVisible()
    expect(screen.getByText('Chirie')).toBeVisible()
  })

  it('R3 — showHeader={false} hides the property name and month/year; the table remains', async () => {
    await renderWithProviders(
      <ReportSummaryView data={summaryData()} showHeader={false} />,
    )

    expect(screen.queryByText('Apartament Centru')).not.toBeInTheDocument()
    expect(screen.queryByText('7/2026')).not.toBeInTheDocument()
    expect(screen.getByText('Chirie')).toBeVisible()
  })
})
