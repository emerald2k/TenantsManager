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
    // The service name is a COLUMN HEADER — it appears once regardless of
    // row count, so it's checked against the whole table. A single-report
    // table has exactly one calendar year, so the year-total row repeats the
    // same amount figures — those are scoped to the MONTHLY row (rows[1];
    // rows[0] is the header, rows[2] is the year-total) to disambiguate.
    expect(within(table).getByText('Electricitate')).toBeInTheDocument()
    const rows = within(table).getAllByRole('row')
    expect(within(rows[1]).getByText('150,00 lei')).toBeInTheDocument()
    expect(within(rows[1]).getByText('1.250,00 lei')).toBeInTheDocument()
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

    // Windowed view keeps the most recent 12 periods: Feb 2025 .. Jan 2026 —
    // TWO calendar years (2025 and 2026), so TWO year-total rows close the
    // table on top of the 12 monthly ones.
    expect(screen.getAllByRole('row')).toHaveLength(15) // header + 12 rows + 2 year totals

    const showAllButton = screen.getByRole('button', { name: 'Arată tot' })
    await user.click(showAllButton)

    // All 13 months (Jan 2025 .. Jan 2026) — still the same two years.
    expect(screen.getAllByRole('row')).toHaveLength(16) // header + 13 rows + 2 year totals
    expect(
      screen.queryByRole('button', { name: 'Arată tot' }),
    ).not.toBeInTheDocument()
  })
})

describe('CostHistoryTable — year total row (FR-PROP-09/12)', () => {
  it('closes each calendar year with its own "Total {year}" row', async () => {
    const reports = [
      report({ id: 'r-nov', month: 11, year: 2025, finalTotal: 1100 }),
      report({ id: 'r-dec', month: 12, year: 2025, finalTotal: 1100 }),
      report({ id: 'r-jan', month: 1, year: 2026, finalTotal: 1100 }),
    ]

    await renderWithProviders(
      <CostHistoryTable reports={reports} isPending={false} />,
    )

    expect(screen.getByText('Total 2025')).toBeVisible()
    expect(screen.getByText('Total 2026')).toBeVisible()

    const rows = screen.getAllByRole('row')
    // header, Nov, Dec, Total 2025, Jan, Total 2026 — the 2025 total sits
    // right after December, not at the very end of the table.
    expect(within(rows[3]).getByText('Total 2025')).toBeInTheDocument()
    expect(within(rows[3]).getByText('2.200,00 lei')).toBeInTheDocument() // 1100 + 1100
    expect(within(rows[5]).getByText('Total 2026')).toBeInTheDocument()
    expect(within(rows[5]).getByText('1.100,00 lei')).toBeInTheDocument()
  })

  it('shows a rounding column only when at least one row actually has a rounding surplus', async () => {
    const plainReports = [report({ id: 'r1', month: 1, year: 2026 })]
    const { unmount } = await renderWithProviders(
      <CostHistoryTable reports={plainReports} isPending={false} />,
    )
    expect(screen.queryByText('Rotunjire')).not.toBeInTheDocument()
    unmount()

    const roundedReports = [
      {
        ...report({ id: 'r1', month: 1, year: 2026 }),
        roundingSurplus: 3,
      },
    ]
    await renderWithProviders(
      <CostHistoryTable reports={roundedReports} isPending={false} />,
    )
    expect(screen.getByText('Rotunjire')).toBeVisible()
  })
})
