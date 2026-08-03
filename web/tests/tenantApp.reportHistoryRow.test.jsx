import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from './renderWithProviders'
import { ReportHistoryRow } from '@/features/tenantApp/components/ReportHistoryRow'

// M5 sub-stage 5 plan (docs/superpowers/plans/2026-08-03-m5-substage5-tenant-history.md,
// Task 3). `PaymentStatusBadge` is rendered for REAL (not mocked) — same
// reasoning as sub-stage 3's D-series: proving the real pipeline agrees with
// itself. Wrapped in <table><tbody> since the row is a <tr>.
//
// H5/H6 (M5 sub-stage 6 plan, Task 1): PARTIAL `react-router-dom` mock, same
// pattern as `properties.createPage.test.jsx` — `renderWithProviders` already
// mounts a real `MemoryRouter`, so only `useNavigate` is swapped out.

const navigate = vi.fn()
vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal()),
  useNavigate: () => navigate,
}))

beforeEach(() => {
  vi.clearAllMocks()
})

function renderRow(report) {
  return renderWithProviders(
    <table>
      <tbody>
        <ReportHistoryRow report={report} />
      </tbody>
    </table>,
  )
}

describe('ReportHistoryRow', () => {
  it('H1 — amountPaid explicitly null renders "0,00 lei" and the explicit unpaid badge', async () => {
    await renderRow({
      id: 'feb',
      month: 2,
      year: 2026,
      finalTotal: 2730,
      amountPaid: null,
      paymentMethod: null,
      paymentDate: null,
      paymentStatus: 'unpaid',
    })

    expect(screen.getByText('0,00 lei')).toBeVisible()
    expect(screen.getByText('Neachitat')).toBeVisible()
  })

  it('H2 — amountPaid AND paymentStatus keys absent entirely render "0,00 lei" and the NEUTRAL badge, NOT "Neachitat"', async () => {
    await renderRow({
      id: 'jul',
      month: 7,
      year: 2026,
      finalTotal: 2730,
      // amountPaid / paymentStatus intentionally absent — never-touched,
      // just-signed report, exactly the seed's July 2026 shape.
    })

    expect(screen.getByText('0,00 lei')).toBeVisible()
    expect(screen.getByText('Fără plată înregistrată')).toBeVisible()
    expect(screen.queryByText('Neachitat')).not.toBeInTheDocument()
  })

  it('H3 — a genuine partial payment renders the total and the paid amount UNDER THE RIGHT COLUMN, not just present somewhere', async () => {
    await renderRow({
      id: 'dec',
      month: 12,
      year: 2025,
      finalTotal: 2730,
      amountPaid: 2000,
      paymentStatus: 'partial',
    })

    const row = screen.getByRole('row')
    const cells = within(row).getAllByRole('cell')

    expect(cells[1]).toHaveTextContent('2.730,00 lei')
    expect(cells[2]).toHaveTextContent('2.000,00 lei')
  })

  it('H4 — no breakdown line items (e.g. a service name) appear, even when the fixture carries them', async () => {
    await renderRow({
      id: 'may',
      month: 5,
      year: 2026,
      finalTotal: 5460,
      amountPaid: 5460,
      paymentStatus: 'paid',
      rent: { amount: 2500, notes: '', attachments: [] },
      maintenance: { amount: 0, notes: '', attachments: [] },
      serviceCosts: [
        { serviceId: 'electricity', name: 'Electricitate', amount: 150 },
        { serviceId: 'gas', name: 'Gaz', amount: 80 },
      ],
      otherExpenses: [],
    })

    expect(screen.queryByText('Electricitate')).not.toBeInTheDocument()
    expect(screen.queryByText('Gaz')).not.toBeInTheDocument()
  })

  it('H5 — clicking the row navigates to /app/reports/{report.id}', async () => {
    const user = userEvent.setup()
    await renderRow({ id: 'dec', month: 12, year: 2025, finalTotal: 2730 })

    await user.click(screen.getByRole('row'))

    expect(navigate).toHaveBeenCalledWith('/app/reports/dec')
  })

  it('H6 — pressing Enter while the row is focused ALSO navigates (keyboard parity with TenantsListPage)', async () => {
    const user = userEvent.setup()
    await renderRow({ id: 'dec', month: 12, year: 2025, finalTotal: 2730 })

    screen.getByRole('row').focus()
    await user.keyboard('{Enter}')

    expect(navigate).toHaveBeenCalledWith('/app/reports/dec')
  })
})
