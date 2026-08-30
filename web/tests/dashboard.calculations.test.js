import { describe, expect, it } from 'vitest'
import {
  balanceAsOf,
  billedHistory,
  buildCurrentMonthRows,
  collectedForMonth,
  creditInAdvance,
  deriveReportStatusBadge,
  earliestSelectableMonth,
  expectedForMonth,
  formatMonthYearLabel,
  formerRenterBalances,
  isFirstLaunch,
  isPastDueDate,
  overdueForMonth,
  overdueReferenceDate,
  propertyCounts,
  shiftMonth,
  unsignedReportStats,
} from '@/features/dashboard/calculations'

/**
 * WHOLESALE REWRITE — M8 stage 15. Every formula on the dashboard changed:
 * the M4 originals summed `finalTotal − amountPaid` across reports (double-
 * counting every carried-forward balance); the M8 model reads
 * `currentBalance` / the single most-recent signed report per tenancy, and
 * the Billed figure goes through the shared `billedForReport`.
 *
 * The anti-vacuity discipline for a money formula (CLAUDE.md §7) is a
 * MUTATION: reintroduce the specific wrong arithmetic and confirm a guard
 * fires. Done during development on `expectedForMonth` and `overdueForMonth`
 * — the tests below that pin an exact figure name, in a comment, the wrong
 * value the double count would produce, so the mutation has something to
 * trip.
 */

function report(overrides = {}) {
  return {
    tenancyId: 't1',
    propertyId: 'p1',
    status: 'signed',
    month: 1,
    year: 2026,
    dueDate: '2026-01-15',
    finalTotal: 2000,
    amountPaid: 0,
    previousMonthArrears: 0,
    previousMonthCredit: 0,
    roundingSurplus: 0,
    ...overrides,
  }
}

describe('balanceAsOf (FR-DASH-04)', () => {
  it('takes the single most recent signed report on or before M — never a sum across reports', () => {
    const reports = [
      report({ month: 1, year: 2026, finalTotal: 2000, amountPaid: 0 }),
      report({
        month: 2,
        year: 2026,
        finalTotal: 4000, // 2000 this month + 2000 carried in
        amountPaid: 0,
        previousMonthArrears: 2000,
      }),
      report({
        month: 3,
        year: 2026,
        finalTotal: 6000, // 2000 + 4000 carried
        amountPaid: 0,
        previousMonthArrears: 4000,
      }),
    ]
    // Three unpaid months at 2000 each — the real debt is 6000, NOT 12000.
    // `Σ(finalTotal − amountPaid)` would give 2000 + 4000 + 6000 = 12000.
    expect(balanceAsOf(reports, { month: 3, year: 2026 })).toBe(6000)
  })

  it('ignores reports after M — stepping the selector back reads that month, not today', () => {
    const reports = [
      report({ month: 1, year: 2026, finalTotal: 2000, amountPaid: 0 }),
      report({
        month: 2,
        year: 2026,
        finalTotal: 4000,
        amountPaid: 0,
        previousMonthArrears: 2000,
      }),
    ]
    expect(balanceAsOf(reports, { month: 1, year: 2026 })).toBe(2000)
  })

  it('reads the CURRENT amountPaid, not an as-of-M reconstruction: a past month since paid reads as paid', () => {
    // Viewing January; the January report has since been paid in full.
    // Decided behaviour (FR-DASH-04): the tile answers "what is still owed
    // for that month given everything known now", so this is 0, not 2000.
    const reports = [
      report({ month: 1, year: 2026, finalTotal: 2000, amountPaid: 2000 }),
    ]
    expect(balanceAsOf(reports, { month: 1, year: 2026 })).toBe(0)
  })

  it('subtracts roundingSurplus (FR-REP-04a): a paid-in-full rounded report leaves a credit', () => {
    const reports = [
      report({ finalTotal: 1980, amountPaid: 1980, roundingSurplus: 3 }),
    ]
    expect(balanceAsOf(reports, { month: 1, year: 2026 })).toBe(-3)
  })

  it('no signed report on or before M -> 0', () => {
    expect(balanceAsOf([], { month: 5, year: 2026 })).toBe(0)
    expect(
      balanceAsOf([report({ month: 6, year: 2026 })], { month: 5, year: 2026 }),
    ).toBe(0)
  })

  it('crosses the year boundary — Dec 2025 is on or before Jan 2026', () => {
    const reports = [
      report({ month: 12, year: 2025, finalTotal: 1500, amountPaid: 500 }),
    ]
    expect(balanceAsOf(reports, { month: 1, year: 2026 })).toBe(1000)
  })
})

describe('expectedForMonth (FR-DASH-04)', () => {
  const M = { month: 3, year: 2026 }

  it('sums max(0, balanceAsOf) over active tenancies; a credit tenancy contributes 0, not a negative', () => {
    const byTenancy = new Map([
      [
        't1',
        [
          report({
            tenancyId: 't1',
            month: 3,
            finalTotal: 2000,
            amountPaid: 500,
          }),
        ],
      ],
      [
        't2',
        [
          report({
            tenancyId: 't2',
            month: 3,
            finalTotal: 1000,
            amountPaid: 1500,
          }),
        ],
      ],
    ])
    const active = [{ id: 't1' }, { id: 't2' }]
    // t1 owes 1500, t2 is 500 in credit -> Expected is 1500, never 1000.
    expect(expectedForMonth(active, byTenancy, M)).toBe(1500)
  })

  it('MUTATION: Expected never adds a carried balance a second time — a 3-month unpaid chain is one debt', () => {
    // t1 has three unpaid months at 2000; its real debt is 6000 (the latest
    // finalTotal), NOT 2000 + 4000 + 6000 = 12000. t2 owes a plain 1000.
    // Expected = 7000. If `balanceAsOf` summed across the chain it would read
    // 13000.
    const byTenancy = new Map([
      [
        't1',
        [
          report({
            tenancyId: 't1',
            month: 1,
            finalTotal: 2000,
            amountPaid: 0,
          }),
          report({
            tenancyId: 't1',
            month: 2,
            finalTotal: 4000,
            amountPaid: 0,
            previousMonthArrears: 2000,
          }),
          report({
            tenancyId: 't1',
            month: 3,
            finalTotal: 6000,
            amountPaid: 0,
            previousMonthArrears: 4000,
          }),
        ],
      ],
      [
        't2',
        [
          report({
            tenancyId: 't2',
            month: 3,
            finalTotal: 1000,
            amountPaid: 0,
          }),
        ],
      ],
    ])
    expect(expectedForMonth([{ id: 't1' }, { id: 't2' }], byTenancy, M)).toBe(
      7000,
    )
  })

  it('is identical to Σ max(0, currentBalance) when M is the current month (FR-DASH-04a)', () => {
    // The most-recent-signed-<=-now report IS the most-recent-signed report,
    // which is what `currentBalance` denormalizes. The page reads
    // `currentBalance` directly there; this proves the two never diverge.
    const now = new Date()
    const currentM = { month: now.getMonth() + 1, year: now.getFullYear() }
    const r = report({
      tenancyId: 't1',
      month: currentM.month,
      year: currentM.year,
      finalTotal: 3000,
      amountPaid: 1200,
      roundingSurplus: 0,
    })
    const active = [{ id: 't1', currentBalance: 3000 - 1200 }]
    const viaField = active.reduce(
      (s, t) => s + Math.max(0, t.currentBalance),
      0,
    )
    const viaFormula = expectedForMonth(
      active,
      new Map([['t1', [r]]]),
      currentM,
    )
    expect(viaFormula).toBe(viaField)
    expect(viaFormula).toBe(1800)
  })
})

describe('overdueReferenceDate (FR-DASH-06)', () => {
  it('for the current month it is today — a report due later this month is not overdue yet', () => {
    const today = new Date(2026, 1, 8) // 8 Feb 2026
    expect(
      overdueReferenceDate({ month: 2, year: 2026 }, today).getTime(),
    ).toBe(today.getTime())
  })

  it('for a past month it is that month end — today is already beyond it', () => {
    const today = new Date(2026, 1, 8)
    const ref = overdueReferenceDate({ month: 1, year: 2026 }, today)
    expect(ref.getFullYear()).toBe(2026)
    expect(ref.getMonth()).toBe(0)
    expect(ref.getDate()).toBe(31)
  })
})

describe('overdueForMonth (FR-DASH-06)', () => {
  it('a month-old unpaid debt still shows overdue in the first half of the next month', () => {
    // The failure the cheap rule (gate on the newest report) has: in early
    // February a January debt shows overdue ZERO because February is freshly
    // signed and not due yet. Here it must be 2000.
    const today = new Date(2026, 1, 8)
    const byTenancy = new Map([
      [
        't1',
        [
          report({
            month: 1,
            year: 2026,
            dueDate: '2026-01-15',
            finalTotal: 2000,
            amountPaid: 0,
          }),
          report({
            month: 2,
            year: 2026,
            dueDate: '2026-02-15',
            finalTotal: 4000, // 2000 + 2000 carried
            amountPaid: 0,
            previousMonthArrears: 2000,
          }),
        ],
      ],
    ])
    const active = [{ id: 't1' }]
    expect(
      overdueForMonth(active, byTenancy, { month: 2, year: 2026 }, { today }),
    ).toBe(2000)
  })

  it('uses the report OWN billed unpaid part, not finalTotal − amountPaid (no double count)', () => {
    // MUTATION GUARD. February's finalTotal is 4000 but 2000 of that is the
    // January arrears carried in. The aged-unpaid part of February's OWN
    // bill is 2000. If overdueForMonth summed `finalTotal − amountPaid` it
    // would read 2000 (Jan) + 4000 (Feb) = 6000, then be capped by
    // balanceAsOf (4000) -> 4000. The correct figure is 4000 too here by the
    // cap, so this case alone is not enough — the next one separates them.
    const today = new Date(2026, 2, 20) // 20 Mar 2026, both due dates past
    const byTenancy = new Map([
      [
        't1',
        [
          report({
            month: 1,
            year: 2026,
            dueDate: '2026-01-15',
            finalTotal: 2000,
            amountPaid: 2000, // January fully paid
          }),
          report({
            month: 2,
            year: 2026,
            dueDate: '2026-02-15',
            finalTotal: 2500, // 2000 own + 500 credit? no: own bill 2500
            amountPaid: 1000,
            previousMonthArrears: 0,
          }),
        ],
      ],
    ])
    const active = [{ id: 't1' }]
    // Jan: billed 2000 − paid 2000 = 0. Feb: billed 2500 − paid 1000 = 1500.
    // Aged sum = 1500, cap balanceAsOf = 2500 − 1000 = 1500 -> Overdue 1500.
    // `finalTotal − amountPaid` path: Jan 0 + Feb 1500 = 1500 here too (Jan
    // has no carry), so this stays a clean 1500 either way; the carry case
    // is the one below.
    expect(
      overdueForMonth(active, byTenancy, { month: 3, year: 2026 }, { today }),
    ).toBe(1500)
  })

  it('MUTATION: a carried-forward balance is NOT counted twice in the aged sum', () => {
    // Viewing March, on March 8 — March's own report (due March 15) is NOT
    // overdue yet, so it is the balanceAsOf cap but NOT in the aged sum.
    // That is the shape that separates the correct formula from the double
    // count: with an earlier past-due month that ITSELF carries arrears, and
    // the cap sitting ABOVE the aged sum, the two no longer clamp to the
    // same number.
    //   Jan: due 15 Jan (past), own 2000, unpaid.
    //   Feb: due 15 Feb (past), own 2000 + 2000 carried = finalTotal 4000, unpaid.
    //   Mar: due 15 Mar (NOT past on the 8th), finalTotal 6000, unpaid.
    // Correct aged sum = billed_own(Jan) 2000 + billed_own(Feb) 2000 = 4000.
    // Cap = balanceAsOf(Mar) = 6000. Overdue = min(6000, 4000) = 4000.
    // The `finalTotal − amountPaid` double count sums 2000 + 4000 = 6000,
    // and min(6000, 6000) = 6000 — a wrong, larger, red figure. This test
    // fails against that mutation; the two all-past-due cases above do not,
    // because there the cap and the aged sum coincide.
    const today = new Date(2026, 2, 8)
    const byTenancy = new Map([
      [
        't1',
        [
          report({
            month: 1,
            year: 2026,
            dueDate: '2026-01-15',
            finalTotal: 2000,
            amountPaid: 0,
          }),
          report({
            month: 2,
            year: 2026,
            dueDate: '2026-02-15',
            finalTotal: 4000,
            amountPaid: 0,
            previousMonthArrears: 2000,
          }),
          report({
            month: 3,
            year: 2026,
            dueDate: '2026-03-15',
            finalTotal: 6000,
            amountPaid: 0,
            previousMonthArrears: 4000,
          }),
        ],
      ],
    ])
    const active = [{ id: 't1' }]
    expect(
      overdueForMonth(active, byTenancy, { month: 3, year: 2026 }, { today }),
    ).toBe(4000)
  })

  it('is capped at balanceAsOf — a since-paid month drops out of Overdue', () => {
    const today = new Date(2026, 2, 20)
    const byTenancy = new Map([
      [
        't1',
        [
          report({
            month: 1,
            year: 2026,
            dueDate: '2026-01-15',
            finalTotal: 2000,
            amountPaid: 2000,
          }),
        ],
      ],
    ])
    expect(
      overdueForMonth(
        [{ id: 't1' }],
        byTenancy,
        { month: 3, year: 2026 },
        { today },
      ),
    ).toBe(0)
  })

  it('floors at zero and never returns a negative', () => {
    const today = new Date(2026, 2, 20)
    const byTenancy = new Map([
      [
        't1',
        [
          report({
            month: 1,
            year: 2026,
            dueDate: '2026-01-15',
            finalTotal: 1000,
            amountPaid: 1500, // overpaid
          }),
        ],
      ],
    ])
    expect(
      overdueForMonth(
        [{ id: 't1' }],
        byTenancy,
        { month: 3, year: 2026 },
        { today },
      ),
    ).toBe(0)
  })

  it('with isCurrentMonth the cap is tenancies.currentBalance, not a recomputed balanceAsOf (FR-DASH-06 / NFR-PERF-05)', () => {
    // The tenancy owes 900 (currentBalance) but its only in-window signed
    // report is a past-due one billing 2000 own and unpaid. With the stored
    // cap Overdue is min(900, 2000) = 900 — the figure the rest of the
    // product agrees with. Recomputing the cap from just this window's
    // reports would read balanceAsOf = 2000 and overstate Overdue.
    const today = new Date(2026, 2, 8)
    const byTenancy = new Map([
      [
        't1',
        [
          report({
            month: 1,
            year: 2026,
            dueDate: '2026-01-15',
            finalTotal: 2000,
            amountPaid: 0,
          }),
        ],
      ],
    ])
    const active = [{ id: 't1', currentBalance: 900 }]
    expect(
      overdueForMonth(
        active,
        byTenancy,
        { month: 3, year: 2026 },
        {
          today,
          isCurrentMonth: true,
        },
      ),
    ).toBe(900)
    // Same inputs, stepped back -> the as-of cap (2000) applies instead.
    expect(
      overdueForMonth(active, byTenancy, { month: 3, year: 2026 }, { today }),
    ).toBe(2000)
  })
})

describe('collectedForMonth (FR-DASH-05)', () => {
  it('buckets by paymentDate, not by the report month — a January report paid in February counts to February', () => {
    const reports = [
      report({
        month: 1,
        year: 2026,
        amountPaid: 1500,
        paymentDate: '2026-02-04',
      }),
      report({
        month: 2,
        year: 2026,
        amountPaid: 2000,
        paymentDate: '2026-02-20',
      }),
      report({
        month: 2,
        year: 2026,
        amountPaid: 999,
        paymentDate: '2026-01-30',
      }),
    ]
    expect(collectedForMonth(reports, { month: 2, year: 2026 })).toBe(3500)
    expect(collectedForMonth(reports, { month: 1, year: 2026 })).toBe(999)
  })

  it('ignores reports with no paymentDate', () => {
    const reports = [
      report({ amountPaid: null, paymentDate: null }),
      report({ amountPaid: 100 }),
    ]
    expect(collectedForMonth(reports, { month: 1, year: 2026 })).toBe(0)
  })
})

describe('propertyCounts (FR-DASH-07)', () => {
  it('splits occupied/free from properties.status, never a tenancy query', () => {
    const props = [
      { status: 'occupied' },
      { status: 'occupied' },
      { status: 'free' },
    ]
    expect(propertyCounts(props)).toEqual({ total: 3, occupied: 2, free: 1 })
  })

  it('empty portfolio -> all zeros', () => {
    expect(propertyCounts([])).toEqual({ total: 0, occupied: 0, free: 0 })
  })
})

describe('creditInAdvance (FR-DASH-12) and formerRenterBalances (FR-DASH-13/14)', () => {
  it('creditInAdvance sums max(0, −currentBalance) over active tenancies', () => {
    expect(
      creditInAdvance([
        { currentBalance: -300 },
        { currentBalance: 500 },
        { currentBalance: -50 },
      ]),
    ).toBe(350)
  })

  it('formerRenterBalances splits owed-by / owed-to over ended tenancies', () => {
    expect(
      formerRenterBalances([
        { currentBalance: 890 },
        { currentBalance: -120 },
        { currentBalance: 0 },
      ]),
    ).toEqual({ owedByFormer: 890, owedToFormer: 120 })
  })
})

describe('billedHistory (FR-DASH-09)', () => {
  it('returns 12 entries, oldest first, ending at the given month', () => {
    const rows = billedHistory([], 3, 2026, 'ro')
    expect(rows).toHaveLength(12)
    expect(rows[0]).toMatchObject({ month: 4, year: 2025 })
    expect(rows[11]).toMatchObject({ month: 3, year: 2026, isCurrent: true })
  })

  it('per month is Σ billedForReport (finalTotal − arrears + credit − surplus), never raw finalTotal', () => {
    // One month, two signed reports (a hand-over). Each finalTotal carries a
    // 500 arrears. Billed for the month = (1500−500) + (2000−500) = 2500,
    // NOT 1500 + 2000 = 3500.
    const signed = [
      report({
        month: 3,
        year: 2026,
        finalTotal: 1500,
        previousMonthArrears: 500,
      }),
      report({
        month: 3,
        year: 2026,
        finalTotal: 2000,
        previousMonthArrears: 500,
      }),
    ]
    const rows = billedHistory(signed, 3, 2026, 'ro')
    expect(rows[11].billed).toBe(2500)
  })

  it('a month with no signed report is a real 0, keeping the axis continuous', () => {
    const signed = [report({ month: 3, year: 2026, finalTotal: 1000 })]
    const rows = billedHistory(signed, 3, 2026, 'ro')
    expect(rows[10].billed).toBe(0)
    expect(rows[11].billed).toBe(1000)
  })
})

describe('buildCurrentMonthRows (FR-DASH-02) and unsignedReportStats', () => {
  const ref = new Date(2026, 0, 20)

  it('one row per active tenancy, joined to the month report by propertyId, sorted by property name', () => {
    const tenancies = [
      {
        id: 't2',
        propertyId: 'pB',
        tenantName: 'Zoe',
        property: { name: 'Zorilor 2' },
      },
      {
        id: 't1',
        propertyId: 'pA',
        tenantName: 'Ana',
        property: { name: 'Aviatorilor 1' },
      },
    ]
    const reports = [
      {
        propertyId: 'pA',
        status: 'signed',
        dueDate: '2026-01-15',
        paymentStatus: 'paid',
        finalTotal: 2500,
      },
    ]
    const rows = buildCurrentMonthRows(tenancies, reports, ref)
    expect(rows.map((r) => r.propertyName)).toEqual([
      'Aviatorilor 1',
      'Zorilor 2',
    ])
    expect(rows[0]).toMatchObject({
      tenancyId: 't1',
      badge: 'paid',
      total: 2500,
    })
    expect(rows[1]).toMatchObject({
      tenancyId: 't2',
      badge: 'not-entered',
      total: null,
    })
  })

  it('unsignedReportStats counts rows with no signed report; total is the row count', () => {
    const rows = [
      { badge: 'paid' },
      { badge: 'not-entered' },
      { badge: 'not-entered' },
    ]
    expect(unsignedReportStats(rows)).toEqual({ unsigned: 2, total: 3 })
  })
})

describe('selector helpers', () => {
  it('shiftMonth rolls the year at both edges', () => {
    expect(shiftMonth({ month: 1, year: 2026 }, -1)).toEqual({
      month: 12,
      year: 2025,
    })
    expect(shiftMonth({ month: 12, year: 2026 }, 1)).toEqual({
      month: 1,
      year: 2027,
    })
    expect(shiftMonth({ month: 6, year: 2026 }, -18)).toEqual({
      month: 12,
      year: 2024,
    })
  })

  it('earliestSelectableMonth is January of the prior calendar year (the fetch window bound)', () => {
    expect(earliestSelectableMonth(2026)).toEqual({ month: 1, year: 2025 })
  })
})

describe('carried-over helpers still covered', () => {
  it('isFirstLaunch is zero properties AND zero users', () => {
    expect(isFirstLaunch([], [])).toBe(true)
    expect(isFirstLaunch([{ id: 'p' }], [])).toBe(false)
    expect(isFirstLaunch([], [{ id: 'u' }])).toBe(false)
  })

  it('deriveReportStatusBadge precedence: partial beats overdue even past due', () => {
    const r = {
      status: 'signed',
      paymentStatus: 'partial',
      dueDate: '2020-01-01',
    }
    expect(deriveReportStatusBadge(r, new Date(2026, 0, 1))).toBe('partial')
  })

  it('deriveReportStatusBadge: no signed report -> not-entered', () => {
    expect(deriveReportStatusBadge(null)).toBe('not-entered')
    expect(deriveReportStatusBadge({ status: 'draft' })).toBe('not-entered')
  })

  it('isPastDueDate compares local midnight; the due date itself is not yet overdue', () => {
    expect(isPastDueDate('2026-01-15', new Date(2026, 0, 15))).toBe(false)
    expect(isPastDueDate('2026-01-15', new Date(2026, 0, 16))).toBe(true)
    expect(isPastDueDate(undefined, new Date())).toBe(false)
  })

  it('formatMonthYearLabel is localized', () => {
    expect(formatMonthYearLabel(7, 2026, 'ro')).toMatch(/iulie 2026/i)
    expect(formatMonthYearLabel(7, 2026, 'en')).toMatch(/July 2026/i)
  })
})
