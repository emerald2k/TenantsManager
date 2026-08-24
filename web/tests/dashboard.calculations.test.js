import { describe, expect, it } from 'vitest'
import {
  calculateOutstandingThisMonth,
  calculateTotalArrears,
  deriveReportStatusBadge,
  isFirstLaunch,
  formatMonthYearLabel,
} from '@/features/dashboard/calculations'

describe('calculateOutstandingThisMonth', () => {
  it('sums finalTotal - amountPaid over SIGNED reports only, on occupied properties — a draft does NOT count', () => {
    const reports = [
      { propertyId: 'p1', status: 'signed', finalTotal: 1000, amountPaid: 400 },
      { propertyId: 'p2', status: 'draft', finalTotal: 500, amountPaid: 0 },
    ]
    expect(calculateOutstandingThisMonth(reports, ['p1', 'p2'])).toBe(600)
  })

  it('a partially paid report contributes its remaining outstanding amount', () => {
    const reports = [
      {
        propertyId: 'p1',
        status: 'signed',
        finalTotal: 2000,
        amountPaid: 1200,
      },
    ]
    expect(calculateOutstandingThisMonth(reports, ['p1'])).toBe(800)
  })

  it('treats missing amountPaid as 0 (guards NaN) — the full finalTotal is outstanding', () => {
    const reports = [{ propertyId: 'p1', status: 'signed', finalTotal: 1000 }]
    expect(calculateOutstandingThisMonth(reports, ['p1'])).toBe(1000)
  })

  it('excludes a signed report whose property is not in the occupied set', () => {
    const reports = [
      { propertyId: 'p9', status: 'signed', finalTotal: 1000, amountPaid: 0 },
    ]
    expect(calculateOutstandingThisMonth(reports, ['p1'])).toBe(0)
  })

  it('returns 0 for an empty month', () => {
    expect(calculateOutstandingThisMonth([], [])).toBe(0)
  })
})

describe('calculateTotalArrears', () => {
  it('sums currentBalance over active tenancies where currentBalance > 0', () => {
    const tenancies = [
      { status: 'active', currentBalance: 300 },
      { status: 'active', currentBalance: 200 },
    ]
    expect(calculateTotalArrears(tenancies)).toBe(500)
  })

  it('excludes negative currentBalance (credit)', () => {
    expect(
      calculateTotalArrears([{ status: 'active', currentBalance: -100 }]),
    ).toBe(0)
  })

  it('excludes a zero currentBalance', () => {
    expect(
      calculateTotalArrears([{ status: 'active', currentBalance: 0 }]),
    ).toBe(0)
  })

  it('treats missing currentBalance as 0 (excluded)', () => {
    expect(calculateTotalArrears([{ status: 'active' }])).toBe(0)
  })
})

describe('deriveReportStatusBadge', () => {
  const TODAY = new Date(2026, 6, 20) // 20 iulie 2026

  it('no report at all -> not-entered', () => {
    expect(deriveReportStatusBadge(null, TODAY)).toBe('not-entered')
  })

  it('draft report (never signed) -> not-entered', () => {
    expect(deriveReportStatusBadge({ status: 'draft' }, TODAY)).toBe(
      'not-entered',
    )
  })

  it('signed + paid -> paid', () => {
    expect(
      deriveReportStatusBadge(
        { status: 'signed', paymentStatus: 'paid', dueDate: '2026-07-05' },
        TODAY,
      ),
    ).toBe('paid')
  })

  it('signed + partial, PAST due date -> partial (never overdue — partial always wins)', () => {
    expect(
      deriveReportStatusBadge(
        { status: 'signed', paymentStatus: 'partial', dueDate: '2026-07-05' },
        TODAY,
      ),
    ).toBe('partial')
  })

  it('signed + unpaid, past due date -> overdue', () => {
    expect(
      deriveReportStatusBadge(
        { status: 'signed', paymentStatus: 'unpaid', dueDate: '2026-07-05' },
        TODAY,
      ),
    ).toBe('overdue')
  })

  it('signed + unpaid, within due date -> signed', () => {
    expect(
      deriveReportStatusBadge(
        { status: 'signed', paymentStatus: 'unpaid', dueDate: '2026-07-25' },
        TODAY,
      ),
    ).toBe('signed')
  })

  it('signed + paymentStatus ABSENT entirely (never marked), past due -> overdue, never crashes', () => {
    expect(
      deriveReportStatusBadge(
        { status: 'signed', dueDate: '2026-07-05' },
        TODAY,
      ),
    ).toBe('overdue')
  })

  it('signed + paymentStatus ABSENT entirely, within due date -> signed', () => {
    expect(
      deriveReportStatusBadge(
        { status: 'signed', dueDate: '2026-07-25' },
        TODAY,
      ),
    ).toBe('signed')
  })

  it('due date is exactly today -> not yet overdue (signed)', () => {
    expect(
      deriveReportStatusBadge(
        { status: 'signed', dueDate: '2026-07-20' },
        TODAY,
      ),
    ).toBe('signed')
  })
})

describe('isFirstLaunch', () => {
  it('true only when both properties and users are empty', () => {
    expect(isFirstLaunch([], [])).toBe(true)
    expect(isFirstLaunch([{ id: 'p1' }], [])).toBe(false)
    expect(isFirstLaunch([], [{ id: 'u1' }])).toBe(false)
    expect(isFirstLaunch([{ id: 'p1' }], [{ id: 'u1' }])).toBe(false)
  })
})

describe('formatMonthYearLabel', () => {
  it('formats in Romanian', () => {
    expect(formatMonthYearLabel(7, 2026, 'ro')).toBe('iulie 2026')
  })

  it('formats in English', () => {
    expect(formatMonthYearLabel(7, 2026, 'en')).toBe('July 2026')
  })
})
