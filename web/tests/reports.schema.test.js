import { describe, expect, it } from 'vitest'
import {
  buildDueDate,
  buildInitialValues,
  calculateTotal,
  computeRoundedTotal,
  derivePaymentStatus,
  isFinalTotalDiverged,
  isMaterialFinalTotalOverride,
  reportSchema,
} from '@/features/reports/schema'

describe('calculateTotal (FR-REP-04)', () => {
  it('sums rent + maintenance + services + other expenses', () => {
    expect(
      calculateTotal({
        rent: { amount: 1500 },
        maintenance: { amount: 100 },
        serviceCosts: [{ amount: 50 }, { amount: 30 }],
        otherExpenses: [{ amount: 20 }],
        previousMonthArrears: 0,
        previousMonthCredit: 0,
      }),
    ).toBe(1700)
  })

  it('includes a 0-amount service in the sum without breaking it (FR-REP-03)', () => {
    expect(
      calculateTotal({
        rent: { amount: 1000 },
        maintenance: { amount: 0 },
        serviceCosts: [{ amount: 0 }, { amount: 40 }],
        otherExpenses: [],
        previousMonthArrears: 0,
        previousMonthCredit: 0,
      }),
    ).toBe(1040)
  })

  it('subtracts a negative service adjustment (FR-REP-03)', () => {
    expect(
      calculateTotal({
        rent: { amount: 1000 },
        maintenance: { amount: 0 },
        serviceCosts: [{ amount: -50 }],
        otherExpenses: [],
        previousMonthArrears: 0,
        previousMonthCredit: 0,
      }),
    ).toBe(950)
  })

  it('adds previous arrears and subtracts previous credit', () => {
    expect(
      calculateTotal({
        rent: { amount: 1000 },
        maintenance: { amount: 0 },
        serviceCosts: [],
        otherExpenses: [],
        previousMonthArrears: 200,
        previousMonthCredit: 50,
      }),
    ).toBe(1150)
  })

  it('treats blank/NaN amounts as 0 — the LIVE total while still mid-edit', () => {
    expect(
      calculateTotal({
        rent: { amount: NaN },
        maintenance: { amount: '' },
        serviceCosts: [],
        otherExpenses: [],
        previousMonthArrears: 0,
        previousMonthCredit: 0,
      }),
    ).toBe(0)
  })
})

describe('reportSchema — amount coercion (decision: blank -> 0, not required)', () => {
  const BASE = {
    rent: { amount: 1000 },
    maintenance: { amount: 0 },
    serviceCosts: [],
    otherExpenses: [],
    previousMonthArrears: 0,
    previousMonthCredit: 0,
    finalTotal: 1000,
    roundingSurplus: 0,
    dueDate: '2026-07-05',
  }

  it('accepts a blank amount and coerces it to 0', () => {
    const result = reportSchema.safeParse({ ...BASE, rent: { amount: '' } })
    expect(result.success).toBe(true)
    expect(result.data.rent.amount).toBe(0)
  })

  it('accepts a blank finalTotal and coerces it to 0, same as any other amount (FR-REP-04b)', () => {
    const result = reportSchema.safeParse({ ...BASE, finalTotal: '' })
    expect(result.success).toBe(true)
    expect(result.data.finalTotal).toBe(0)
  })

  it('accepts a negative service amount (FR-REP-03 adjustments)', () => {
    const result = reportSchema.safeParse({
      ...BASE,
      serviceCosts: [{ serviceId: 'gas', name: 'Gas', amount: -20 }],
    })
    expect(result.success).toBe(true)
    expect(result.data.serviceCosts[0].amount).toBe(-20)
  })

  it('requires a non-empty description on an other-expense line', () => {
    const result = reportSchema.safeParse({
      ...BASE,
      otherExpenses: [{ description: '', amount: 50 }],
    })
    expect(result.success).toBe(false)
  })

  it('requires a due date', () => {
    const result = reportSchema.safeParse({ ...BASE, dueDate: '' })
    expect(result.success).toBe(false)
  })
})

describe('buildDueDate', () => {
  it('combines year+month+dueDay into an ISO date string', () => {
    expect(buildDueDate(2026, 7, 5)).toBe('2026-07-05')
  })

  it('zero-pads the month and day', () => {
    expect(buildDueDate(2026, 3, 1)).toBe('2026-03-01')
  })

  it('clamps a dueDay beyond the month length (31 in February)', () => {
    expect(buildDueDate(2026, 2, 31)).toBe('2026-02-28')
  })
})

describe('buildInitialValues (FR-REP-02/03/05/14)', () => {
  const property = {
    services: [
      { serviceId: 'gas', name: 'Gas', source: 'catalog' },
      { serviceId: 'electricity', name: 'Electricity', source: 'catalog' },
    ],
  }
  const tenancy = { monthlyRent: 1500, dueDay: 5 }

  it('creating fresh: pre-fills rent from the tenancy, dueDate from dueDay, every active service at 0', () => {
    const values = buildInitialValues({
      tenancy,
      property,
      month: 7,
      year: 2026,
      existingReport: null,
    })

    expect(values.rent.amount).toBe(1500)
    expect(values.dueDate).toBe('2026-07-05')
    expect(values.serviceCosts).toEqual([
      { serviceId: 'gas', name: 'Gas', amount: 0, notes: '', attachments: [] },
      {
        serviceId: 'electricity',
        name: 'Electricity',
        amount: 0,
        notes: '',
        attachments: [],
      },
    ])
    expect(values.previousMonthArrears).toBe(0)
    expect(values.previousMonthCredit).toBe(0)
    // 1500 rent + 0 maintenance + 0 + 0 services + 0 arrears - 0 credit.
    expect(values.finalTotal).toBe(calculateTotal(values))
  })

  it('editing an existing draft: uses the SAVED values, not blank ones', () => {
    const existingReport = {
      rent: { amount: 1600, notes: 'raised' },
      maintenance: { amount: 50, notes: '' },
      serviceCosts: [{ serviceId: 'gas', name: 'Gas', amount: 80, notes: '' }],
      otherExpenses: [{ description: 'Repair', amount: 200, notes: '' }],
      previousMonthArrears: 0,
      previousMonthCredit: 0,
      dueDate: '2026-07-10',
    }

    const values = buildInitialValues({
      tenancy,
      property,
      month: 7,
      year: 2026,
      existingReport,
    })

    expect(values.rent).toEqual({
      amount: 1600,
      notes: 'raised',
      attachments: [],
    })
    expect(values.maintenance).toEqual({
      amount: 50,
      notes: '',
      attachments: [],
    })
    expect(values.otherExpenses).toEqual([
      { description: 'Repair', amount: 200, notes: '', attachments: [] },
    ])
    expect(values.dueDate).toBe('2026-07-10')
  })

  it('editing an existing draft: carries over saved attachment refs untouched', () => {
    const savedAttachment = {
      url: 'https://storage.example/reports/r1/invoices/lease.pdf',
      name: 'lease.pdf',
      type: 'pdf',
    }
    const existingReport = {
      rent: { amount: 1600, notes: '', attachments: [savedAttachment] },
      maintenance: { amount: 0, notes: '' },
      serviceCosts: [],
      otherExpenses: [],
      previousMonthArrears: 0,
      previousMonthCredit: 0,
      dueDate: '2026-07-10',
    }

    const values = buildInitialValues({
      tenancy,
      property: { services: [] },
      month: 7,
      year: 2026,
      existingReport,
    })

    expect(values.rent.attachments).toEqual([savedAttachment])
  })

  it('reopening a report: finalTotal is the SAVED value, even when different from the recomputed total', () => {
    const existingReport = {
      rent: { amount: 1600, notes: '' },
      maintenance: { amount: 0, notes: '' },
      serviceCosts: [],
      otherExpenses: [],
      previousMonthArrears: 0,
      previousMonthCredit: 0,
      finalTotal: 1550, // manually rounded down at some earlier save
      dueDate: '2026-07-10',
    }

    const values = buildInitialValues({
      tenancy,
      property: { services: [] },
      month: 7,
      year: 2026,
      existingReport,
    })

    expect(values.finalTotal).toBe(1550)
    expect(calculateTotal(values)).toBe(1600) // the recomputed total differs on purpose
  })

  it('reopening an M4 sub-stage 1 draft with no finalTotal saved: falls back to the recomputed total', () => {
    const existingReport = {
      rent: { amount: 1600, notes: '' },
      maintenance: { amount: 0, notes: '' },
      serviceCosts: [],
      otherExpenses: [],
      previousMonthArrears: 0,
      previousMonthCredit: 0,
      // no finalTotal key at all — pre-dates sub-stage 2
      dueDate: '2026-07-10',
    }

    const values = buildInitialValues({
      tenancy,
      property: { services: [] },
      month: 7,
      year: 2026,
      existingReport,
    })

    expect(values.finalTotal).toBe(1600)
  })

  it('resyncs serviceCosts with the CURRENT active services on a draft (not a frozen snapshot)', () => {
    const existingReport = {
      rent: { amount: 1500, notes: '' },
      // Saved back when only "gas" was active — "electricity" was added since.
      serviceCosts: [{ serviceId: 'gas', name: 'Gas', amount: 80, notes: '' }],
      otherExpenses: [],
      previousMonthArrears: 0,
      previousMonthCredit: 0,
      dueDate: '2026-07-05',
    }

    const values = buildInitialValues({
      tenancy,
      property,
      month: 7,
      year: 2026,
      existingReport,
    })

    expect(values.serviceCosts).toEqual([
      { serviceId: 'gas', name: 'Gas', amount: 80, notes: '', attachments: [] },
      {
        serviceId: 'electricity',
        name: 'Electricity',
        amount: 0,
        notes: '',
        attachments: [],
      },
    ])
  })

  it("resyncs serviceCosts and carries over each service line's saved attachments", () => {
    const savedAttachment = {
      url: 'https://storage.example/reports/r1/invoices/gas-bill.jpg',
      name: 'gas-bill.jpg',
      type: 'image',
    }
    const existingReport = {
      rent: { amount: 1500, notes: '' },
      serviceCosts: [
        {
          serviceId: 'gas',
          name: 'Gas',
          amount: 80,
          notes: '',
          attachments: [savedAttachment],
        },
      ],
      otherExpenses: [],
      previousMonthArrears: 0,
      previousMonthCredit: 0,
      dueDate: '2026-07-05',
    }

    const values = buildInitialValues({
      tenancy,
      property,
      month: 7,
      year: 2026,
      existingReport,
    })

    expect(values.serviceCosts[0].attachments).toEqual([savedAttachment])
    // The newly-active "electricity" line has no saved attachments to carry.
    expect(values.serviceCosts[1].attachments).toEqual([])
  })

  it('drops a service no longer active from the resynced list', () => {
    const singleServiceProperty = {
      services: [{ serviceId: 'gas', name: 'Gas', source: 'catalog' }],
    }
    const existingReport = {
      rent: { amount: 1500, notes: '' },
      serviceCosts: [
        { serviceId: 'gas', name: 'Gas', amount: 80, notes: '' },
        {
          serviceId: 'electricity',
          name: 'Electricity',
          amount: 40,
          notes: '',
        },
      ],
      otherExpenses: [],
      previousMonthArrears: 0,
      previousMonthCredit: 0,
      dueDate: '2026-07-05',
    }

    const values = buildInitialValues({
      tenancy,
      property: singleServiceProperty,
      month: 7,
      year: 2026,
      existingReport,
    })

    expect(values.serviceCosts).toEqual([
      { serviceId: 'gas', name: 'Gas', amount: 80, notes: '', attachments: [] },
    ])
  })

  it('FREEZE (FR-PROP-08): does NOT resync serviceCosts against the property’s current services once signed', () => {
    const existingReport = {
      status: 'signed',
      rent: { amount: 1500, notes: '' },
      // Signed with "gas" only — the property now ALSO has "electricity" and
      // no longer even lists "gas" among its (hypothetically renamed) services.
      serviceCosts: [
        {
          serviceId: 'gas',
          name: 'Gas',
          amount: 80,
          notes: '',
          attachments: [],
        },
      ],
      otherExpenses: [],
      previousMonthArrears: 0,
      previousMonthCredit: 0,
      dueDate: '2026-07-05',
    }
    const changedProperty = {
      services: [{ serviceId: 'water', name: 'Water', source: 'catalog' }],
    }

    const values = buildInitialValues({
      tenancy,
      property: changedProperty,
      month: 7,
      year: 2026,
      existingReport,
    })

    // The signed snapshot's "Gas" line survives untouched...
    expect(values.serviceCosts).toEqual([
      { serviceId: 'gas', name: 'Gas', amount: 80, notes: '', attachments: [] },
    ])
    // ...even though "Water" is now the property's only active service —
    // proof this is the FROZEN snapshot, not a live resync.
  })

  it('still resyncs serviceCosts against current services while DRAFT (unchanged behavior)', () => {
    const existingReport = {
      status: 'draft',
      rent: { amount: 1500, notes: '' },
      serviceCosts: [
        {
          serviceId: 'gas',
          name: 'Gas',
          amount: 80,
          notes: '',
          attachments: [],
        },
      ],
      otherExpenses: [],
      previousMonthArrears: 0,
      previousMonthCredit: 0,
      dueDate: '2026-07-05',
    }
    const changedProperty = {
      services: [{ serviceId: 'water', name: 'Water', source: 'catalog' }],
    }

    const values = buildInitialValues({
      tenancy,
      property: changedProperty,
      month: 7,
      year: 2026,
      existingReport,
    })

    // Draft still resyncs: "Gas" drops out (no longer an active service),
    // "Water" shows up fresh at amount 0 — the pre-existing sub-stage-1 behavior.
    expect(values.serviceCosts).toEqual([
      {
        serviceId: 'water',
        name: 'Water',
        amount: 0,
        notes: '',
        attachments: [],
      },
    ])
  })
})

describe('derivePaymentStatus (FR-PAY-01/02/05)', () => {
  it('is "unpaid" when nothing has been paid', () => {
    expect(derivePaymentStatus(1500, 0)).toBe('unpaid')
  })

  it('is "partial" for a payment less than finalTotal', () => {
    expect(derivePaymentStatus(1500, 1000)).toBe('partial')
  })

  it('is "paid" when the payment exactly equals finalTotal', () => {
    expect(derivePaymentStatus(1500, 1500)).toBe('paid')
  })

  it('is "paid" (not a fourth state) on overpayment — the excess is a credit, not a status of its own', () => {
    expect(derivePaymentStatus(1500, 1800)).toBe('paid')
  })
})

describe('buildInitialValues — carry-forward arrears/credit (SRS §6, pinned at e8ca367)', () => {
  const property = { services: [] }
  const tenancy = { monthlyRent: 1500, dueDay: 5 }

  it('a DRAFT mirrors a POSITIVE tenancy.currentBalance as previousMonthArrears', () => {
    const values = buildInitialValues({
      tenancy: { ...tenancy, currentBalance: 500 },
      property,
      month: 7,
      year: 2026,
      existingReport: { status: 'draft', dueDate: '2026-07-05' },
    })

    expect(values.previousMonthArrears).toBe(500)
    expect(values.previousMonthCredit).toBe(0)
  })

  it('a DRAFT mirrors a NEGATIVE tenancy.currentBalance as previousMonthCredit', () => {
    const values = buildInitialValues({
      tenancy: { ...tenancy, currentBalance: -300 },
      property,
      month: 7,
      year: 2026,
      existingReport: { status: 'draft', dueDate: '2026-07-05' },
    })

    expect(values.previousMonthArrears).toBe(0)
    expect(values.previousMonthCredit).toBe(300)
  })

  it('a brand NEW draft (no existingReport) also mirrors tenancy.currentBalance', () => {
    const values = buildInitialValues({
      tenancy: { ...tenancy, currentBalance: 500 },
      property,
      month: 7,
      year: 2026,
      existingReport: null,
    })

    expect(values.previousMonthArrears).toBe(500)
  })

  it('zero balance mirrors as both fields at 0', () => {
    const values = buildInitialValues({
      tenancy: { ...tenancy, currentBalance: 0 },
      property,
      month: 7,
      year: 2026,
      existingReport: { status: 'draft', dueDate: '2026-07-05' },
    })

    expect(values.previousMonthArrears).toBe(0)
    expect(values.previousMonthCredit).toBe(0)
  })

  it('a fresh draft with a positive currentBalance includes it in finalTotal, not just previousMonthArrears', () => {
    // Discriminates against the bug where previousMonthArrears/Credit are
    // computed for display but never fed into calculateTotal(base).
    const values = buildInitialValues({
      tenancy: { ...tenancy, currentBalance: 500 },
      property,
      month: 7,
      year: 2026,
      existingReport: null,
    })

    expect(values.previousMonthArrears).toBe(500)
    expect(values.finalTotal).toBe(2000) // rent 1500 + arrears 500
  })

  it('FREEZE: a SIGNED report keeps its OWN saved previousMonthArrears/Credit, ignoring tenancy.currentBalance entirely', () => {
    const values = buildInitialValues({
      // The tenancy's balance has since moved on (e.g. a later report changed it) —
      // must NOT leak into this already-signed report's frozen carry-forward.
      tenancy: { ...tenancy, currentBalance: 9999 },
      property,
      month: 7,
      year: 2026,
      existingReport: {
        status: 'signed',
        previousMonthArrears: 500,
        previousMonthCredit: 0,
        dueDate: '2026-07-05',
      },
    })

    expect(values.previousMonthArrears).toBe(500)
    expect(values.previousMonthCredit).toBe(0)
  })
})

describe('computeRoundedTotal (FR-REP-04a)', () => {
  it('rounds up to the next multiple of 10', () => {
    expect(computeRoundedTotal(2382.17)).toBe(2390)
  })

  it('leaves an exact multiple of 10 unchanged', () => {
    expect(computeRoundedTotal(2500)).toBe(2500)
  })

  it('rounds 1 lei above a multiple of 10 up a full 9 lei', () => {
    expect(computeRoundedTotal(2501)).toBe(2510)
  })
})

describe('isMaterialFinalTotalOverride (FR-REP-04e)', () => {
  it('is false when finalTotal mirrors calculatedTotal', () => {
    expect(isMaterialFinalTotalOverride(1500, 1500, 0)).toBe(false)
  })

  it('is false for a small divergence under the 5-lei floor', () => {
    expect(isMaterialFinalTotalOverride(1503, 1500, 0)).toBe(false)
  })

  it('is true once the divergence exceeds max(5, 1%)', () => {
    // calculatedTotal 1500 -> threshold max(5, 15) = 15
    expect(isMaterialFinalTotalOverride(1480, 1500, 0)).toBe(true)
  })

  it('is true for a large divergence on a small calculatedTotal (the 5-lei floor governs)', () => {
    // calculatedTotal 100 -> threshold max(5, 1) = 5
    expect(isMaterialFinalTotalOverride(93, 100, 0)).toBe(true)
  })

  it('is EXEMPT when the divergence exactly equals the stored roundingSurplus', () => {
    expect(isMaterialFinalTotalOverride(2390, 2382.17, 7.83)).toBe(false)
  })

  it('re-activates once a cost-line edit after rounding makes the surplus stop explaining the gap (closes the loophole)', () => {
    // Rounded to 1520 from a calculatedTotal of 1513 (surplus 7) — then the
    // admin edited a cost line, moving calculatedTotal to 1550. finalTotal
    // stays frozen at 1520 (the mirror effect only runs while un-dirty), so
    // the real gap is now -30, NOT the 7 the stored surplus claims to cover.
    // A blanket "roundingSurplus > 0 -> exempt" would let this sail past
    // silently; the surplus must still explain the WHOLE current gap.
    expect(isMaterialFinalTotalOverride(1520, 1550, 7)).toBe(true)
  })

  it('stays exempt for a tiny residual gap under the epsilon (float rounding, not a real drift)', () => {
    expect(isMaterialFinalTotalOverride(1520, 1513.001, 7)).toBe(false)
  })

  it('uses the absolute value of a negative calculatedTotal for the 1% threshold', () => {
    // calculatedTotal -1000 -> threshold max(5, 10) = 10
    expect(isMaterialFinalTotalOverride(-985, -1000, 0)).toBe(true)
    expect(isMaterialFinalTotalOverride(-995, -1000, 0)).toBe(false)
  })
})

describe('buildInitialValues — roundingSurplus (FR-REP-04a/04c)', () => {
  const property = { services: [] }
  const tenancy = { monthlyRent: 1500, dueDay: 5 }

  it('a fresh draft starts at 0', () => {
    const values = buildInitialValues({
      tenancy,
      property,
      month: 7,
      year: 2026,
      existingReport: null,
    })
    expect(values.roundingSurplus).toBe(0)
  })

  it('a reopened draft carries over the saved roundingSurplus (not re-derived)', () => {
    const values = buildInitialValues({
      tenancy,
      property,
      month: 7,
      year: 2026,
      existingReport: {
        status: 'draft',
        rent: { amount: 1500 },
        previousMonthArrears: 0,
        previousMonthCredit: 0,
        roundingSurplus: 7.83,
        dueDate: '2026-07-05',
      },
    })
    expect(values.roundingSurplus).toBe(7.83)
  })

  it('a SIGNED report freezes its own saved roundingSurplus', () => {
    const values = buildInitialValues({
      tenancy,
      property,
      month: 7,
      year: 2026,
      existingReport: {
        status: 'signed',
        rent: { amount: 1500 },
        previousMonthArrears: 0,
        previousMonthCredit: 0,
        roundingSurplus: 7.83,
        dueDate: '2026-07-05',
      },
    })
    expect(values.roundingSurplus).toBe(7.83)
  })
})

describe('isFinalTotalDiverged (sub-stage 2 dirty-flag derivation)', () => {
  it('is false for a brand new report (no existingReport yet)', () => {
    expect(isFinalTotalDiverged(null)).toBe(false)
    expect(isFinalTotalDiverged(undefined)).toBe(false)
  })

  it('is false when finalTotal was never saved (an M4 sub-stage 1 draft)', () => {
    expect(
      isFinalTotalDiverged({ calculatedTotal: 1500, finalTotal: undefined }),
    ).toBe(false)
    expect(isFinalTotalDiverged({ calculatedTotal: 1500 })).toBe(false)
  })

  it('is false when finalTotal exactly equals calculatedTotal (it was mirroring)', () => {
    expect(
      isFinalTotalDiverged({ calculatedTotal: 1500, finalTotal: 1500 }),
    ).toBe(false)
  })

  it('is false for a sub-cent difference — floating-point tolerance, not exact equality', () => {
    expect(
      isFinalTotalDiverged({ calculatedTotal: 1500, finalTotal: 1500.001 }),
    ).toBe(false)
  })

  it('is true once the difference reaches the epsilon (0.005)', () => {
    expect(
      isFinalTotalDiverged({ calculatedTotal: 1500, finalTotal: 1500.005 }),
    ).toBe(true)
  })

  it('is true for a real manual divergence (e.g. rounded down for cash)', () => {
    expect(
      isFinalTotalDiverged({ calculatedTotal: 2518.71, finalTotal: 2515 }),
    ).toBe(true)
  })
})
