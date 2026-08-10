import { describe, expect, it } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from './renderWithProviders'
import { CostHistoryTable } from '@/features/properties/components/CostHistoryTable'

// FR-PROP-09: rendering of the pivoted cost-history table. The pivot logic
// itself is covered in properties.costHistory.test.js — these tests only
// check that CostHistoryTable wires it up correctly (empty/loading states,
// column headers, cell formatting, the "Show all" expansion).

function report({ id, month, year, serviceCosts = [], finalTotal = 1100 }) {
  return {
    id,
    month,
    year,
    rent: { amount: 1000 },
    maintenance: { amount: 100 },
    serviceCosts,
    otherExpenses: [],
    finalTotal,
  }
}

describe('CostHistoryTable (FR-PROP-09)', () => {
  it('shows the empty-history message when there are no signed reports', async () => {
    await renderWithProviders(
      <CostHistoryTable reports={[]} isPending={false} />,
    )

    expect(
      screen.getByText(
        'Istoricul costurilor va fi disponibil după ce există rapoarte lunare.',
      ),
    ).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('shows a loading state while the reports are still pending', async () => {
    await renderWithProviders(
      <CostHistoryTable reports={undefined} isPending={true} />,
    )

    expect(screen.getByText('Se încarcă...')).toBeInTheDocument()
  })

  it('renders one row per report, with service columns and finalTotal (never calculatedTotal)', async () => {
    const reports = [
      {
        ...report({
          id: 'r1',
          month: 1,
          year: 2026,
          serviceCosts: [
            { serviceId: 'electricity', name: 'Electricitate', amount: 150 },
          ],
          finalTotal: 1250,
        }),
        calculatedTotal: 9999.99,
      },
    ]

    await renderWithProviders(
      <CostHistoryTable reports={reports} isPending={false} />,
    )

    const table = screen.getByRole('table')
    expect(within(table).getByText('Electricitate')).toBeInTheDocument()
    expect(within(table).getByText('150,00 lei')).toBeInTheDocument()
    expect(within(table).getByText('1.250,00 lei')).toBeInTheDocument()
    expect(within(table).queryByText('9.999,99 lei')).not.toBeInTheDocument()
  })

  it('renders an empty-cell dash for a month where the service did not exist', async () => {
    const reports = [
      report({ id: 'r1', month: 1, year: 2026, serviceCosts: [] }),
      report({
        id: 'r2',
        month: 2,
        year: 2026,
        serviceCosts: [{ serviceId: 'internet', name: 'Internet', amount: 60 }],
      }),
    ]

    await renderWithProviders(
      <CostHistoryTable reports={reports} isPending={false} />,
    )

    const rows = screen.getAllByRole('row')
    // rows[0] is the header row; rows[1] is January (no internet column value yet).
    expect(within(rows[1]).getByText('—')).toBeInTheDocument()
  })

  it('renders a zero-cost service as a real amount, not a dash', async () => {
    const reports = [
      report({
        id: 'r1',
        month: 1,
        year: 2026,
        serviceCosts: [{ serviceId: 'water', name: 'Apă', amount: 0 }],
      }),
    ]

    await renderWithProviders(
      <CostHistoryTable reports={reports} isPending={false} />,
    )

    const rows = screen.getAllByRole('row')
    // Both the water column AND the (empty) "other" column legitimately show
    // "0,00 lei" here — the point of this test is that NEITHER renders as a
    // dash, not which specific cell holds which zero.
    expect(within(rows[1]).getAllByText('0,00 lei').length).toBeGreaterThan(0)
    expect(within(rows[1]).queryByText('—')).not.toBeInTheDocument()
  })

  it('hides "Show all" when there are 12 or fewer reports', async () => {
    const reports = Array.from({ length: 12 }, (_, i) =>
      report({ id: `r${i}`, month: (i % 12) + 1, year: 2026 }),
    )

    await renderWithProviders(
      <CostHistoryTable reports={reports} isPending={false} />,
    )

    expect(
      screen.queryByRole('button', { name: 'Arată tot' }),
    ).not.toBeInTheDocument()
  })

  it('shows "Show all" beyond 12 reports, and expands the table on click', async () => {
    const user = userEvent.setup()
    // 13 months, Jan 2025 .. Jan 2026 — the windowed view (most recent 12)
    // excludes Jan 2025.
    const reports = []
    let month = 1
    let year = 2025
    for (let i = 0; i < 13; i++) {
      reports.push(report({ id: `r${i}`, month, year }))
      month += 1
      if (month > 12) {
        month = 1
        year += 1
      }
    }

    await renderWithProviders(
      <CostHistoryTable reports={reports} isPending={false} />,
    )

    expect(screen.getAllByRole('row')).toHaveLength(13) // header + 12 windowed rows

    const showAllButton = screen.getByRole('button', { name: 'Arată tot' })
    await user.click(showAllButton)

    expect(screen.getAllByRole('row')).toHaveLength(14) // header + all 13 rows
    expect(
      screen.queryByRole('button', { name: 'Arată tot' }),
    ).not.toBeInTheDocument()
  })
})
