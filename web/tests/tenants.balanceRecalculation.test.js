import { describe, expect, it } from 'vitest'
import {
  computeBalanceFromReports,
  sortReportsChronologically,
} from '@/features/tenants/balanceRecalculation'

// Pure functions, tested in isolation (CLAUDE.md §7) — the CLIENT-side half
// of the same formula functions/src/reports.js's
// computeBalanceFromSignedReports computes server-side (FR-SYS-05a).

describe('computeBalanceFromReports (FR-SYS-05a)', () => {
  it('uses the MOST RECENT report only — never a sum across reports', () => {
    const balance = computeBalanceFromReports([
      { year: 2026, month: 6, finalTotal: 1000 },
      { year: 2026, month: 7, finalTotal: 3000 },
    ])

    expect(balance).toBe(3000)
  })

  it('subtracts amountPaid and roundingSurplus from the most recent report', () => {
    const balance = computeBalanceFromReports([
      {
        year: 2026,
        month: 7,
        finalTotal: 2000,
        amountPaid: 500,
        roundingSurplus: 10,
      },
    ])

    expect(balance).toBe(1490)
  })

  it('picks the most recent by year first, then month', () => {
    const balance = computeBalanceFromReports([
      { year: 2025, month: 12, finalTotal: 9999 },
      { year: 2026, month: 1, finalTotal: 500 },
    ])

    expect(balance).toBe(500)
  })

  it('returns 0 for an empty or missing report list', () => {
    expect(computeBalanceFromReports([])).toBe(0)
    expect(computeBalanceFromReports(undefined)).toBe(0)
  })

  it('reproduces the same result regardless of input order', () => {
    const chronological = [
      { year: 2026, month: 6, finalTotal: 1000 },
      { year: 2026, month: 7, finalTotal: 3000 },
    ]
    const reversed = [...chronological].reverse()

    expect(computeBalanceFromReports(chronological)).toBe(
      computeBalanceFromReports(reversed),
    )
  })
})

describe('sortReportsChronologically', () => {
  it('sorts oldest first', () => {
    const sorted = sortReportsChronologically([
      { year: 2026, month: 7, id: 'jul' },
      { year: 2026, month: 1, id: 'jan' },
      { year: 2025, month: 12, id: 'dec-2025' },
    ])

    expect(sorted.map((r) => r.id)).toEqual(['dec-2025', 'jan', 'jul'])
  })

  it('returns [] for an absent list, without mutating the original', () => {
    const original = [{ year: 2026, month: 7, id: 'a' }]

    expect(sortReportsChronologically(undefined)).toEqual([])
    const sorted = sortReportsChronologically(original)
    sorted.push({ year: 2020, month: 1, id: 'injected' })
    expect(original).toHaveLength(1) // the original array is untouched
  })
})
