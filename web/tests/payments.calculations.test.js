import { describe, expect, it } from 'vitest'
import {
  computeYearFooterTotals,
  derivePaymentBadge,
  sortLedgerRows,
} from '@/features/payments/calculations'

describe('sortLedgerRows', () => {
  it('sorts dated rows most-recent-first by paymentDate', () => {
    const rows = [
      { id: 'a', paymentDate: '2026-01-10' },
      { id: 'b', paymentDate: '2026-05-11' },
      { id: 'c', paymentDate: '2025-11-10' },
    ]
    expect(sortLedgerRows(rows).map((r) => r.id)).toEqual(['b', 'a', 'c'])
  })

  it('anti-vacuity: an UNPAID row (no paymentDate) is never dropped by the sort — it sorts last, not out', () => {
    const rows = [
      { id: 'paid', paymentDate: '2026-01-10', year: 2026, month: 1 },
      { id: 'unpaid', paymentDate: undefined, year: 2026, month: 2 },
    ]
    const sorted = sortLedgerRows(rows)
    expect(sorted).toHaveLength(2)
    expect(sorted.map((r) => r.id)).toEqual(['paid', 'unpaid'])
  })

  it('several undated rows sort last, most-recent PERIOD first among themselves', () => {
    const rows = [
      { id: 'jan', year: 2026, month: 1 },
      { id: 'may', year: 2026, month: 5 },
      { id: 'dec-prev', year: 2025, month: 12 },
      { id: 'dated', paymentDate: '2026-01-10', year: 2026, month: 1 },
    ]
    expect(sortLedgerRows(rows).map((r) => r.id)).toEqual([
      'dated',
      'may',
      'jan',
      'dec-prev',
    ])
  })

  it('does not mutate the input array', () => {
    const rows = [{ id: 'a', paymentDate: '2026-01-01' }]
    const sorted = sortLedgerRows(rows)
    expect(sorted).not.toBe(rows)
  })
})

describe('derivePaymentBadge', () => {
  const TODAY = new Date(2026, 6, 20) // 20 iulie 2026

  it('paid -> paid, even past due', () => {
    expect(
      derivePaymentBadge(
        { paymentStatus: 'paid', dueDate: '2026-07-05' },
        TODAY,
      ),
    ).toBe('paid')
  })

  it('partial -> partial, even past due (never overdue — mirrors the dashboard precedent)', () => {
    expect(
      derivePaymentBadge(
        { paymentStatus: 'partial', dueDate: '2026-07-05' },
        TODAY,
      ),
    ).toBe('partial')
  })

  it('unpaid + past due -> overdue', () => {
    expect(
      derivePaymentBadge(
        { paymentStatus: 'unpaid', dueDate: '2026-07-05' },
        TODAY,
      ),
    ).toBe('overdue')
  })

  it('unpaid + within due date -> unpaid', () => {
    expect(
      derivePaymentBadge(
        { paymentStatus: 'unpaid', dueDate: '2026-07-25' },
        TODAY,
      ),
    ).toBe('unpaid')
  })

  it('paymentStatus absent entirely (never touched), past due -> overdue', () => {
    expect(derivePaymentBadge({ dueDate: '2026-07-05' }, TODAY)).toBe('overdue')
  })

  it('paymentStatus absent entirely, within due date -> not-recorded', () => {
    expect(derivePaymentBadge({ dueDate: '2026-07-25' }, TODAY)).toBe(
      'not-recorded',
    )
  })

  it('paymentStatus absent AND dueDate absent -> not-recorded, never crashes', () => {
    expect(derivePaymentBadge({}, TODAY)).toBe('not-recorded')
  })
})

describe('computeYearFooterTotals', () => {
  // Mirrors the seeded 2026 figures (functions/scripts/seed.js) hand-computed
  // independently of the implementation — see the outbox report for the
  // full derivation.
  const signedReports = [
    {
      status: 'signed',
      tenancyId: 't-occupied',
      finalTotal: 2500,
      previousMonthArrears: 0,
      previousMonthCredit: 0,
      roundingSurplus: 0,
      amountPaid: 2500,
      rent: { amount: 2500 },
    },
    {
      status: 'signed',
      tenancyId: 't-occupied',
      finalTotal: 2500,
      previousMonthArrears: 0,
      previousMonthCredit: 0,
      roundingSurplus: 0,
      amountPaid: null,
      rent: { amount: 2500 },
    },
    {
      status: 'signed',
      tenancyId: 't-ended',
      finalTotal: 1800,
      previousMonthArrears: 0,
      previousMonthCredit: 0,
      roundingSurplus: 0,
      amountPaid: 1800,
      rent: { amount: 1800 },
    },
  ]
  const draftReport = {
    status: 'draft',
    tenancyId: 't-occupied',
    finalTotal: 2500,
    previousMonthArrears: 0,
    previousMonthCredit: 0,
    roundingSurplus: 0,
    amountPaid: null,
    rent: { amount: 2500 },
  }
  const tenanciesById = new Map([
    ['t-occupied', { currentBalance: 2500 }], // the unpaid Feb-equivalent report
    ['t-ended', { currentBalance: 0 }],
  ])

  it('billed sums billedForReport over SIGNED reports only', () => {
    const totals = computeYearFooterTotals(signedReports, tenanciesById)
    expect(totals.billed).toBe(2500 + 2500 + 1800)
  })

  it('collected sums amountPaid over signed reports, treating null as 0', () => {
    const totals = computeYearFooterTotals(signedReports, tenanciesById)
    expect(totals.collected).toBe(2500 + 0 + 1800)
  })

  it('rentTotal sums rent.amount over signed reports only', () => {
    const totals = computeYearFooterTotals(signedReports, tenanciesById)
    expect(totals.rentTotal).toBe(2500 + 2500 + 1800)
  })

  it('excludes a draft from every total and counts it separately, never silently', () => {
    const withDraft = [...signedReports, draftReport]
    const totals = computeYearFooterTotals(withDraft, tenanciesById)
    expect(totals.rentTotal).toBe(2500 + 2500 + 1800) // unchanged by the draft
    expect(totals.excludedCount).toBe(1)
  })

  it('stillOutstanding is deduplicated by tenancyId — never Σ(finalTotal − amountPaid), which would double-count', () => {
    // t-occupied has TWO signed reports above but ONE tenancy-level balance.
    // A naive per-report sum of (finalTotal - amountPaid) would compute
    // (2500-2500) + (2500-0) = 2500 for t-occupied alone by coincidence here,
    // masking the bug — the real anti-vacuity check is the assertion below,
    // which reads the dedup source (`currentBalance`) directly, not the
    // per-report arithmetic.
    const totals = computeYearFooterTotals(signedReports, tenanciesById)
    expect(totals.stillOutstanding).toBe(2500) // t-occupied's ONE balance, once
  })

  it('a tenancy appearing across N signed reports contributes its balance exactly once, not N times', () => {
    const manyReportsSameTenancy = [
      { ...signedReports[0] },
      { ...signedReports[0] },
      { ...signedReports[0] },
    ]
    const totals = computeYearFooterTotals(
      manyReportsSameTenancy,
      new Map([['t-occupied', { currentBalance: 400 }]]),
    )
    expect(totals.stillOutstanding).toBe(400)
  })

  it('creditOwed sums only the NEGATIVE balances, as a positive figure, never netted against stillOutstanding', () => {
    const totals = computeYearFooterTotals(
      signedReports,
      new Map([
        ['t-occupied', { currentBalance: -150 }],
        ['t-ended', { currentBalance: 300 }],
      ]),
    )
    expect(totals.creditOwed).toBe(150)
    expect(totals.stillOutstanding).toBe(300)
  })

  it('a tenancy missing from the map (data gap) contributes 0, not a crash', () => {
    const totals = computeYearFooterTotals(signedReports, new Map())
    expect(totals.stillOutstanding).toBe(0)
    expect(totals.creditOwed).toBe(0)
  })

  it('empty input -> every total is 0, no excluded count', () => {
    const totals = computeYearFooterTotals([], new Map())
    expect(totals).toEqual({
      billed: 0,
      collected: 0,
      stillOutstanding: 0,
      creditOwed: 0,
      rentTotal: 0,
      excludedCount: 0,
    })
  })
})
