import { describe, expect, it } from 'vitest'
import { buildCostHistory } from '@/features/properties/costHistory'

// FR-PROP-09: pivots a property's signed reports into month-rows ×
// service-columns. Pure function, tested in isolation like
// dueDayCountdown.js — no React, no Firestore.

function report({
  id,
  month,
  year,
  rent = 1000,
  maintenance = 100,
  serviceCosts = [],
  otherExpenses = [],
  finalTotal = 1100,
}) {
  return {
    id,
    month,
    year,
    rent: { amount: rent },
    maintenance: { amount: maintenance },
    serviceCosts,
    otherExpenses,
    finalTotal,
  }
}

describe('buildCostHistory (FR-PROP-09)', () => {
  it('pivots rent/maintenance/services/other/total correctly', () => {
    const reports = [
      report({
        id: 'r1',
        month: 1,
        year: 2026,
        rent: 1000,
        maintenance: 100,
        serviceCosts: [
          { serviceId: 'electricity', name: 'Electricitate', amount: 150 },
        ],
        otherExpenses: [
          { description: 'Repair', amount: 50 },
          { description: 'Cleaning', amount: 30 },
        ],
        finalTotal: 1330,
      }),
    ]

    const { rows, services } = buildCostHistory(reports)

    expect(services).toEqual([
      { serviceId: 'electricity', name: 'Electricitate' },
    ])
    expect(rows).toEqual([
      {
        reportIds: ['r1'],
        month: 1,
        year: 2026,
        rent: 1000,
        maintenance: 100,
        services: { electricity: 150 },
        other: 80, // 50 + 30 summed into ONE column
        total: 1330, // finalTotal, not calculatedTotal
      },
    ])
  })

  it('uses finalTotal, never calculatedTotal, for the total column (FR-REP-04c)', () => {
    const reports = [
      {
        ...report({ id: 'r1', month: 1, year: 2026, finalTotal: 1200 }),
        calculatedTotal: 1234.56,
      },
    ]

    const { rows } = buildCostHistory(reports)

    expect(rows[0].total).toBe(1200)
  })

  it('leaves earlier months null for a service that appeared mid-history', () => {
    const reports = [
      report({ id: 'r1', month: 1, year: 2026, serviceCosts: [] }),
      report({
        id: 'r2',
        month: 2,
        year: 2026,
        serviceCosts: [{ serviceId: 'internet', name: 'Internet', amount: 60 }],
      }),
    ]

    const { rows } = buildCostHistory(reports)

    expect(rows[0].services.internet).toBeNull() // January: not yet added
    expect(rows[1].services.internet).toBe(60) // February: added
  })

  it('leaves later months null for a service that was removed', () => {
    const reports = [
      report({
        id: 'r1',
        month: 1,
        year: 2026,
        serviceCosts: [{ serviceId: 'gas', name: 'Gaz', amount: 80 }],
      }),
      report({ id: 'r2', month: 2, year: 2026, serviceCosts: [] }),
    ]

    const { rows } = buildCostHistory(reports)

    expect(rows[0].services.gas).toBe(80) // January: still present
    expect(rows[1].services.gas).toBeNull() // February: removed
  })

  it('records a zero-cost service as 0, NOT as an empty cell (FR-REP-03)', () => {
    const reports = [
      report({
        id: 'r1',
        month: 1,
        year: 2026,
        serviceCosts: [{ serviceId: 'water', name: 'Apă', amount: 0 }],
      }),
    ]

    const { rows } = buildCostHistory(reports)

    expect(rows[0].services.water).toBe(0)
    expect(rows[0].services.water).not.toBeNull()
  })

  it('keeps only the most recent `windowSize` reports out of a longer history', () => {
    // 15 months, Jan 2025 .. Mar 2026 — default window is 12.
    const reports = []
    let month = 1
    let year = 2025
    for (let i = 0; i < 15; i++) {
      reports.push(report({ id: `r${i}`, month, year }))
      month += 1
      if (month > 12) {
        month = 1
        year += 1
      }
    }

    const { rows } = buildCostHistory(reports)

    expect(rows).toHaveLength(12)
    // The 3 oldest (Jan/Feb/Mar 2025) are dropped — the window keeps the
    // most RECENT 12, i.e. Apr 2025 .. Mar 2026.
    expect(rows[0]).toMatchObject({ month: 4, year: 2025 })
    expect(rows[11]).toMatchObject({ month: 3, year: 2026 })
  })

  it('returns rows in ascending chronological order, oldest on top', () => {
    const reports = [
      report({ id: 'r-mar', month: 3, year: 2026 }),
      report({ id: 'r-jan', month: 1, year: 2026 }),
      report({ id: 'r-feb', month: 2, year: 2026 }),
    ]

    const { rows } = buildCostHistory(reports)

    expect(rows.map((r) => r.reportIds)).toEqual([
      ['r-jan'],
      ['r-feb'],
      ['r-mar'],
    ])
  })

  it('returns empty rows and services for an empty report list', () => {
    expect(buildCostHistory([])).toEqual({ rows: [], services: [] })
  })

  describe('sibling reports of the same month (M8, FR-REP-14 hand-over)', () => {
    it('sums rent/maintenance/other/total across two reports sharing one month, into ONE row', () => {
      const reports = [
        report({
          id: 'r-out',
          month: 7,
          year: 2026,
          rent: 950,
          maintenance: 0,
          otherExpenses: [{ description: 'Curățenie', amount: 40 }],
          finalTotal: 990,
        }),
        report({
          id: 'r-in',
          month: 7,
          year: 2026,
          rent: 1150,
          maintenance: 10,
          otherExpenses: [],
          finalTotal: 1160,
        }),
      ]

      const { rows } = buildCostHistory(reports)

      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({
        month: 7,
        year: 2026,
        rent: 2100, // 950 + 1150
        maintenance: 10, // 0 + 10
        other: 40, // 40 + 0
        total: 2150, // 990 + 1160
      })
      expect(rows[0].reportIds.sort()).toEqual(['r-in', 'r-out'])
    })

    it('sums a service present in BOTH sibling reports', () => {
      const reports = [
        report({
          id: 'r-out',
          month: 7,
          year: 2026,
          serviceCosts: [
            { serviceId: 'electricity', name: 'Electricitate', amount: 40 },
          ],
        }),
        report({
          id: 'r-in',
          month: 7,
          year: 2026,
          serviceCosts: [
            { serviceId: 'electricity', name: 'Electricitate', amount: 40 },
          ],
        }),
      ]

      const { rows } = buildCostHistory(reports)

      expect(rows[0].services.electricity).toBe(80)
    })

    it('a service on only ONE sibling still sums (not null) — present in the group, not absent', () => {
      const reports = [
        report({
          id: 'r-out',
          month: 7,
          year: 2026,
          serviceCosts: [{ serviceId: 'water', name: 'Apă', amount: 20 }],
        }),
        report({ id: 'r-in', month: 7, year: 2026, serviceCosts: [] }),
      ]

      const { rows } = buildCostHistory(reports)

      // Present on the outgoing report, absent from the incoming one — the
      // GROUP still has it, so the cell is the sum of what exists (20), not
      // null. null means "no report in this month's group has it at all".
      expect(rows[0].services.water).toBe(20)
    })

    it('a hand-over month still occupies exactly ONE slot in the windowSize window', () => {
      const reports = [
        report({ id: 'r-jun', month: 6, year: 2026 }),
        report({ id: 'r-jul-out', month: 7, year: 2026 }),
        report({ id: 'r-jul-in', month: 7, year: 2026 }),
        report({ id: 'r-aug', month: 8, year: 2026 }),
      ]

      const { rows } = buildCostHistory(reports, { windowSize: 3 })

      // Keeps the 3 most recent PERIODS (Jun/Jul/Aug), not the 3 most
      // recent REPORTS (which would have dropped June entirely).
      expect(rows.map((r) => `${r.year}-${r.month}`)).toEqual([
        '2026-6',
        '2026-7',
        '2026-8',
      ])
      expect(rows[1].reportIds.sort()).toEqual(['r-jul-in', 'r-jul-out'])
    })
  })
})
