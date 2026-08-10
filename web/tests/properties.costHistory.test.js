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
        reportId: 'r1',
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

    expect(rows.map((r) => r.reportId)).toEqual(['r-jan', 'r-feb', 'r-mar'])
  })

  it('returns empty rows and services for an empty report list', () => {
    expect(buildCostHistory([])).toEqual({ rows: [], services: [] })
  })
})
