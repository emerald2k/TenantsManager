import { describe, expect, it } from 'vitest'
import { groupReportsByYear } from '@/features/tenantApp/groupReportsByYear'

// M5 sub-stage 5 plan (docs/superpowers/plans/2026-08-03-m5-substage5-tenant-history.md,
// Task 2). A single left-to-right pass over the ALREADY-SORTED array
// `useMySignedReports` returns (newest year first, newest month first within
// a year, sub-stage 2's contract) — never re-sorted here.

function report(overrides = {}) {
  return { id: 'r', year: 2026, month: 1, finalTotal: 0, ...overrides }
}

describe('groupReportsByYear', () => {
  it('G1 — groups an already-sorted seed-shaped input into buckets by year, preserving order', () => {
    const input = [
      report({ id: '2026-07', year: 2026, month: 7 }),
      report({ id: '2026-05', year: 2026, month: 5 }),
      report({ id: '2026-02', year: 2026, month: 2 }),
      report({ id: '2026-01', year: 2026, month: 1 }),
      report({ id: '2025-12', year: 2025, month: 12 }),
      report({ id: '2025-11', year: 2025, month: 11 }),
    ]

    const groups = groupReportsByYear(input)

    expect(groups).toHaveLength(2)
    expect(groups[0].year).toBe(2026)
    expect(groups[0].reports.map((r) => r.id)).toEqual([
      '2026-07',
      '2026-05',
      '2026-02',
      '2026-01',
    ])
    expect(groups[1].year).toBe(2025)
    expect(groups[1].reports.map((r) => r.id)).toEqual(['2025-12', '2025-11'])
  })

  it('G2 — an empty array input returns an empty array, not a stray bucket', () => {
    expect(groupReportsByYear([])).toEqual([])
  })

  it('G3 — a single-report input returns exactly one bucket with exactly one report', () => {
    const input = [report({ id: 'only', year: 2026 })]

    const groups = groupReportsByYear(input)

    expect(groups).toHaveLength(1)
    expect(groups[0].year).toBe(2026)
    expect(groups[0].reports).toHaveLength(1)
    expect(groups[0].reports[0].id).toBe('only')
  })
})
