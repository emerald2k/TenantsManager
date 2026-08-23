import { beforeEach, describe, expect, it } from 'vitest'
import { getFirestore } from 'firebase-admin/firestore'
import {
  signReportCore,
  signReportHandler,
  unlockReportCore,
  unlockReportHandler,
  recomputeCurrentBalance,
  onReportWriteHandler,
  sendReportNotificationCore,
  sendReportNotificationHandler,
} from '../src/reports.js'

// Functions tests — the REAL boundary (Firestore emulator), no mocks of the
// data layer. Started via `npm run test:emulator` (firebase emulators:exec).
// Mirrors endTenancy.test.js's structure/conventions.

const PROJECT_ID = 'tenants-manager-2026'
const db = getFirestore()

function report(overrides = {}) {
  return {
    ownerId: 'admin-uid',
    propertyId: 'prop-1',
    tenancyId: 'tenancy-1',
    userId: 'user-1',
    month: 7,
    year: 2026,
    rent: { amount: 1500, notes: '', attachments: [] },
    maintenance: { amount: 0, notes: '', attachments: [] },
    serviceCosts: [],
    otherExpenses: [],
    previousMonthArrears: 0,
    previousMonthCredit: 0,
    calculatedTotal: 1500,
    finalTotal: 1500,
    dueDate: '2026-07-05',
    status: 'draft',
    ...overrides,
  }
}

async function clearEmulators() {
  const fsHost = process.env.FIRESTORE_EMULATOR_HOST
  await fetch(
    `http://${fsHost}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`,
    { method: 'DELETE' },
  )
}

async function seedReport(id, overrides = {}) {
  await db.collection('monthlyReports').doc(id).set(report(overrides))
}

async function seedUser(id, overrides = {}) {
  await db
    .collection('users')
    .doc(id)
    .set({
      name: 'Ion Popescu',
      email: 'ion@example.com',
      preferredLanguage: 'ro',
      status: 'active',
      ...overrides,
    })
}

async function seedTenancy(id, overrides = {}) {
  await db
    .collection('tenancies')
    .doc(id)
    .set({
      userId: 'user-1',
      ownerId: 'admin-uid',
      propertyId: 'prop-1',
      tenantName: 'Ion Popescu',
      status: 'active',
      currentBalance: 0,
      ...overrides,
    })
}

beforeEach(async () => {
  await clearEmulators()
})

describe('signReport — happy path (FR-REP-07)', () => {
  it('sets status to signed and stamps signedAt', async () => {
    await seedReport('report-1')

    const result = await signReportCore('report-1')
    expect(result.reportId).toBe('report-1')

    const snap = await db.collection('monthlyReports').doc('report-1').get()
    expect(snap.data().status).toBe('signed')
    expect(snap.data().signedAt).toBeTruthy()
  })
})

describe('signReport — chronological order guard (FR-REP-11/11a)', () => {
  it('rejects signing a month earlier than an already-signed later month, naming the blocking month', async () => {
    await seedReport('report-aug', {
      tenancyId: 'tenancy-1',
      month: 8,
      year: 2026,
      status: 'signed',
    })
    await seedReport('report-jul', {
      tenancyId: 'tenancy-1',
      month: 7,
      year: 2026,
      status: 'draft',
    })

    await expect(signReportCore('report-jul')).rejects.toMatchObject({
      code: 'failed-precondition',
      details: {
        reason: 'chronological-order',
        blockingMonth: 8,
        blockingYear: 2026,
      },
    })

    const snap = await db.collection('monthlyReports').doc('report-jul').get()
    expect(snap.data().status).toBe('draft')
  })

  it('rejects signing an earlier YEAR the same way (not just an earlier month within the same year)', async () => {
    await seedReport('report-2027-jan', {
      tenancyId: 'tenancy-1',
      month: 1,
      year: 2027,
      status: 'signed',
    })
    await seedReport('report-2026-dec', {
      tenancyId: 'tenancy-1',
      month: 12,
      year: 2026,
      status: 'draft',
    })

    await expect(signReportCore('report-2026-dec')).rejects.toMatchObject({
      code: 'failed-precondition',
      details: { reason: 'chronological-order' },
    })
  })

  it('permits signing a LATER month than the most recently signed one', async () => {
    await seedReport('report-jun', {
      tenancyId: 'tenancy-1',
      month: 6,
      year: 2026,
      status: 'signed',
    })
    await seedReport('report-jul', {
      tenancyId: 'tenancy-1',
      month: 7,
      year: 2026,
      status: 'draft',
    })

    const result = await signReportCore('report-jul')
    expect(result.reportId).toBe('report-jul')
  })

  it('permits re-signing the SAME month after an unlock — the report being signed does not block itself', async () => {
    // The report under signature is itself still `draft` at read time, so it
    // never appears in its own "already signed" query — anti-vacuity for the
    // `<` (not `<=`) comparison: a `<=` bug would reject this every time.
    await seedReport('report-jul', {
      tenancyId: 'tenancy-1',
      month: 7,
      year: 2026,
      status: 'draft', // was unlocked from signed
    })

    const result = await signReportCore('report-jul')
    expect(result.reportId).toBe('report-jul')
  })

  it('ignores a signed report on a DIFFERENT tenancy entirely', async () => {
    await seedReport('report-other-tenancy', {
      tenancyId: 'tenancy-2',
      month: 12,
      year: 2026,
      status: 'signed',
    })
    await seedReport('report-jul', {
      tenancyId: 'tenancy-1',
      month: 7,
      year: 2026,
      status: 'draft',
    })

    const result = await signReportCore('report-jul')
    expect(result.reportId).toBe('report-jul')
  })

  it('stores overrideReason + a timestamp when provided (FR-REP-04e)', async () => {
    await seedReport('report-1', { status: 'draft' })

    await signReportCore('report-1', 'Reducere negociată cu chiriașul')

    const snap = await db.collection('monthlyReports').doc('report-1').get()
    expect(snap.data().finalTotalOverrideReason).toBe(
      'Reducere negociată cu chiriașul',
    )
    expect(snap.data().finalTotalOverrideReasonAt).toBeTruthy()
  })

  it('does NOT write an override reason field at all when none is provided', async () => {
    await seedReport('report-1', { status: 'draft' })

    await signReportCore('report-1')

    const snap = await db.collection('monthlyReports').doc('report-1').get()
    expect(snap.data().finalTotalOverrideReason).toBeUndefined()
  })
})

describe('signReport — invalid states', () => {
  it('rejects a report that does not exist', async () => {
    await expect(signReportCore('does-not-exist')).rejects.toMatchObject({
      code: 'not-found',
    })
  })

  it('rejects a report that is already signed — nothing changes', async () => {
    await seedReport('report-1', { status: 'signed', signedAt: 'existing' })

    await expect(signReportCore('report-1')).rejects.toMatchObject({
      code: 'failed-precondition',
      details: { reason: 'not-draft' },
    })

    const snap = await db.collection('monthlyReports').doc('report-1').get()
    expect(snap.data().status).toBe('signed')
    expect(snap.data().signedAt).toBe('existing')
  })
})

describe('signReport — callable guard', () => {
  it('rejects a non-admin caller — nothing changes', async () => {
    await seedReport('report-1')

    await expect(
      signReportHandler({
        auth: { token: {}, uid: 'x' },
        data: { reportId: 'report-1' },
      }),
    ).rejects.toMatchObject({ code: 'permission-denied' })

    const snap = await db.collection('monthlyReports').doc('report-1').get()
    expect(snap.data().status).toBe('draft')
  })

  it('rejects a missing reportId argument', async () => {
    await expect(
      signReportHandler({
        auth: { token: { admin: true }, uid: 'admin-uid' },
        data: {},
      }),
    ).rejects.toMatchObject({ code: 'invalid-argument' })
  })
})

describe('unlockReport — happy path (FR-REP-07a)', () => {
  it('sets status back to draft', async () => {
    await seedReport('report-1', { status: 'signed', signedAt: 'existing' })

    const result = await unlockReportCore('report-1')
    expect(result.reportId).toBe('report-1')

    const snap = await db.collection('monthlyReports').doc('report-1').get()
    expect(snap.data().status).toBe('draft')
    // signedAt is left untouched (plan Decision 1) — re-signing overwrites it.
    expect(snap.data().signedAt).toBe('existing')
  })
})

describe('unlockReport — invalid states', () => {
  it('rejects a report that does not exist', async () => {
    await expect(unlockReportCore('does-not-exist')).rejects.toMatchObject({
      code: 'not-found',
    })
  })

  it('rejects a report that is still a draft — nothing changes', async () => {
    await seedReport('report-1', { status: 'draft' })

    await expect(unlockReportCore('report-1')).rejects.toMatchObject({
      code: 'failed-precondition',
      details: { reason: 'not-signed' },
    })

    const snap = await db.collection('monthlyReports').doc('report-1').get()
    expect(snap.data().status).toBe('draft')
  })
})

describe('unlockReport — callable guard', () => {
  it('rejects a non-admin caller — nothing changes', async () => {
    await seedReport('report-1', { status: 'signed' })

    await expect(
      unlockReportHandler({
        auth: { token: {}, uid: 'x' },
        data: { reportId: 'report-1' },
      }),
    ).rejects.toMatchObject({ code: 'permission-denied' })

    const snap = await db.collection('monthlyReports').doc('report-1').get()
    expect(snap.data().status).toBe('signed')
  })

  it('rejects a missing reportId argument', async () => {
    await expect(
      unlockReportHandler({
        auth: { token: { admin: true }, uid: 'admin-uid' },
        data: {},
      }),
    ).rejects.toMatchObject({ code: 'invalid-argument' })
  })
})

describe('recomputeCurrentBalance (SRS §6, pinned at e8ca367)', () => {
  it('sets currentBalance to 0 when the tenancy has no signed report yet', async () => {
    await seedTenancy('tenancy-1')
    await seedReport('report-1', {
      tenancyId: 'tenancy-1',
      status: 'draft',
      finalTotal: 1500,
    })

    await recomputeCurrentBalance('tenancy-1')

    const snap = await db.collection('tenancies').doc('tenancy-1').get()
    expect(snap.data().currentBalance).toBe(0)
  })

  it('computes finalTotal - amountPaid from the single signed report (partial payment -> arrears)', async () => {
    await seedTenancy('tenancy-1')
    await seedReport('report-1', {
      tenancyId: 'tenancy-1',
      status: 'signed',
      finalTotal: 1500,
      amountPaid: 1000,
    })

    await recomputeCurrentBalance('tenancy-1')

    const snap = await db.collection('tenancies').doc('tenancy-1').get()
    expect(snap.data().currentBalance).toBe(500)
  })

  it('is negative (credit) on overpayment', async () => {
    await seedTenancy('tenancy-1')
    await seedReport('report-1', {
      tenancyId: 'tenancy-1',
      status: 'signed',
      finalTotal: 1500,
      amountPaid: 1800,
    })

    await recomputeCurrentBalance('tenancy-1')

    const snap = await db.collection('tenancies').doc('tenancy-1').get()
    expect(snap.data().currentBalance).toBe(-300)
  })

  it('is the full finalTotal when nothing has been paid (amountPaid absent, not NaN)', async () => {
    await seedTenancy('tenancy-1')
    await seedReport('report-1', {
      tenancyId: 'tenancy-1',
      status: 'signed',
      finalTotal: 1500,
    })

    await recomputeCurrentBalance('tenancy-1')

    const snap = await db.collection('tenancies').doc('tenancy-1').get()
    expect(snap.data().currentBalance).toBe(1500)
    expect(Number.isNaN(snap.data().currentBalance)).toBe(false)
  })

  it('is 0 when the single signed report is paid in full', async () => {
    await seedTenancy('tenancy-1')
    await seedReport('report-1', {
      tenancyId: 'tenancy-1',
      status: 'signed',
      finalTotal: 1500,
      amountPaid: 1500,
    })

    await recomputeCurrentBalance('tenancy-1')

    const snap = await db.collection('tenancies').doc('tenancy-1').get()
    expect(snap.data().currentBalance).toBe(0)
  })

  it('anti-vacuity: uses ONLY the most recent signed report, NOT a sum across all of them', async () => {
    await seedTenancy('tenancy-1')
    // An OLDER signed report with a large arrears...
    await seedReport('report-old', {
      tenancyId: 'tenancy-1',
      status: 'signed',
      month: 6,
      year: 2026,
      finalTotal: 1500,
      amountPaid: 0, // 1500 arrears, if it were (wrongly) summed
    })
    // ...and a NEWER signed report, fully paid.
    await seedReport('report-new', {
      tenancyId: 'tenancy-1',
      status: 'signed',
      month: 7,
      year: 2026,
      finalTotal: 1600,
      amountPaid: 1600,
    })

    await recomputeCurrentBalance('tenancy-1')

    const snap = await db.collection('tenancies').doc('tenancy-1').get()
    // If this summed, it would be 1500 (old arrears) + 0 (new, fully paid) = 1500.
    // The correct, pinned semantics: only report-new (the most recent signed) counts.
    expect(snap.data().currentBalance).toBe(0)
  })

  it('a tenant unpaid across THREE consecutive signed months lands on the single carried balance, never 3x it (FR-DASH-04 data invariant — where the old per-report-summing arithmetic broke)', async () => {
    await seedTenancy('tenancy-1')
    // Each month's own finalTotal already carries the PRIOR month's arrears
    // forward (FR-REP-04) — a wrong "sum every signed report" arithmetic
    // would read 1500+3000+4500=9000; the correct one reads only the most
    // recent report's own finalTotal.
    await seedReport('report-jun', {
      tenancyId: 'tenancy-1',
      month: 6,
      year: 2026,
      status: 'signed',
      finalTotal: 1500, // nothing carried in yet
    })
    await seedReport('report-jul', {
      tenancyId: 'tenancy-1',
      month: 7,
      year: 2026,
      status: 'signed',
      finalTotal: 3000, // 1500 rent/services + 1500 carried from June
    })
    await seedReport('report-aug', {
      tenancyId: 'tenancy-1',
      month: 8,
      year: 2026,
      status: 'signed',
      finalTotal: 4500, // 1500 + 3000 carried from July
      amountPaid: 500, // a partial payment — discriminates against a buggy
      // implementation that returns mostRecent.finalTotal outright and
      // ignores amountPaid/roundingSurplus (both are absent on report-jun/
      // report-jul, so that bug would pass undetected without this).
    })

    await recomputeCurrentBalance('tenancy-1')

    const snap = await db.collection('tenancies').doc('tenancy-1').get()
    expect(snap.data().currentBalance).toBe(4000)
  })

  it('picks the most recent by (year, month), not by document write order', async () => {
    await seedTenancy('tenancy-1')
    // Written in reverse chronological order on purpose — proves the sort is by
    // (year, month), not by Firestore insertion/query order.
    await seedReport('report-jan', {
      tenancyId: 'tenancy-1',
      status: 'signed',
      month: 1,
      year: 2026,
      finalTotal: 100,
      amountPaid: 100,
    })
    await seedReport('report-dec-prev-year', {
      tenancyId: 'tenancy-1',
      status: 'signed',
      month: 12,
      year: 2025,
      finalTotal: 9999,
      amountPaid: 0,
    })

    await recomputeCurrentBalance('tenancy-1')

    const snap = await db.collection('tenancies').doc('tenancy-1').get()
    // January 2026 is more recent than December 2025, even though the December
    // document has the larger (wrong-if-picked) arrears.
    expect(snap.data().currentBalance).toBe(0)
  })

  it('subtracts roundingSurplus from the balance (FR-REP-04a/04c, M8)', async () => {
    await seedTenancy('tenancy-1')
    await seedReport('report-1', {
      tenancyId: 'tenancy-1',
      status: 'signed',
      calculatedTotal: 2382.17,
      finalTotal: 2390,
      roundingSurplus: 7.83,
      amountPaid: 2390, // paid the rounded figure in full
    })

    await recomputeCurrentBalance('tenancy-1')

    const snap = await db.collection('tenancies').doc('tenancy-1').get()
    // 2390 - 2390 - 7.83 = -7.83: the surplus becomes the tenant's credit,
    // even though the tenant paid every lei of what was asked.
    expect(snap.data().currentBalance).toBeCloseTo(-7.83, 2)
  })

  it('treats an absent roundingSurplus as 0 (no rounding action ever applied)', async () => {
    await seedTenancy('tenancy-1')
    await seedReport('report-1', {
      tenancyId: 'tenancy-1',
      status: 'signed',
      finalTotal: 1500,
      amountPaid: 1500,
      // no roundingSurplus key at all
    })

    await recomputeCurrentBalance('tenancy-1')

    const snap = await db.collection('tenancies').doc('tenancy-1').get()
    expect(snap.data().currentBalance).toBe(0)
  })

  it("a roundingSurplus credit CANCELS across two consecutive signed months (FR-REP-04a's own example)", async () => {
    await seedTenancy('tenancy-1')

    // Month 1: rounded up from 2382.17 to 2390, paid the rounded figure in
    // full — the tenant now holds a 7.83 credit no one has consumed yet.
    await seedReport('report-1', {
      tenancyId: 'tenancy-1',
      month: 6,
      year: 2026,
      status: 'signed',
      calculatedTotal: 2382.17,
      finalTotal: 2390,
      roundingSurplus: 7.83,
      amountPaid: 2390,
    })
    await recomputeCurrentBalance('tenancy-1')
    let snap = await db.collection('tenancies').doc('tenancy-1').get()
    expect(snap.data().currentBalance).toBeCloseTo(-7.83, 2)

    // Month 2 opens with that 7.83 credit (mirroring buildInitialValues'
    // previousMonthCredit = Math.max(-currentBalance, 0)), consumes it in
    // full via finalTotal, and is itself paid in full — no rounding this
    // time. If the surplus were lost (never subtracted, or subtracted
    // twice), this would NOT land back on exactly 0.
    await seedReport('report-2', {
      tenancyId: 'tenancy-1',
      month: 7,
      year: 2026,
      status: 'signed',
      previousMonthCredit: 7.83,
      calculatedTotal: 1492.17, // e.g. 1500 rent - 7.83 credit
      finalTotal: 1492.17,
      roundingSurplus: 0,
      amountPaid: 1492.17,
    })
    await recomputeCurrentBalance('tenancy-1')
    snap = await db.collection('tenancies').doc('tenancy-1').get()
    expect(snap.data().currentBalance).toBeCloseTo(0, 2)
  })

  it('ignores a DRAFT report even if it is more recent than the last signed one', async () => {
    await seedTenancy('tenancy-1')
    await seedReport('report-signed', {
      tenancyId: 'tenancy-1',
      status: 'signed',
      month: 6,
      year: 2026,
      finalTotal: 1500,
      amountPaid: 1500,
    })
    await seedReport('report-draft', {
      tenancyId: 'tenancy-1',
      status: 'draft',
      month: 7,
      year: 2026,
      finalTotal: 9999,
      amountPaid: 0,
    })

    await recomputeCurrentBalance('tenancy-1')

    const snap = await db.collection('tenancies').doc('tenancy-1').get()
    expect(snap.data().currentBalance).toBe(0)
  })
})

describe('onReportWriteHandler — skip/recompute condition (NFR-PERF-04)', () => {
  // These call the exported HANDLER directly with a hand-built event object —
  // NOT the deployed onDocumentWritten trigger (test:emulator only starts
  // auth/firestore/storage, not the functions emulator; the real trigger
  // registration is proven separately via manual emulator validation, not by
  // an automated test in this band). This suite pins the skip/recompute
  // LOGIC, using the real Firestore emulator underneath (via
  // recomputeCurrentBalance) to observe whether a recompute actually ran.
  function fakeEvent({ beforeData, afterData }) {
    return {
      data: {
        before: beforeData
          ? { exists: true, data: () => beforeData }
          : { exists: false },
        after: afterData
          ? { exists: true, data: () => afterData }
          : { exists: false },
      },
    }
  }

  it('SKIPS on draft creation (before does not exist, after is draft)', async () => {
    await seedTenancy('tenancy-1', { currentBalance: 42 })

    await onReportWriteHandler(
      fakeEvent({
        beforeData: null,
        afterData: {
          tenancyId: 'tenancy-1',
          status: 'draft',
          finalTotal: 1500,
        },
      }),
    )

    const snap = await db.collection('tenancies').doc('tenancy-1').get()
    // Untouched — 42 is not a value a real recompute would ever produce from
    // these fixtures, so an unchanged value proves the skip, not a coincidence.
    expect(snap.data().currentBalance).toBe(42)
  })

  it('SKIPS on a draft-to-draft edit (status never signed on either side)', async () => {
    await seedTenancy('tenancy-1', { currentBalance: 42 })

    await onReportWriteHandler(
      fakeEvent({
        beforeData: {
          tenancyId: 'tenancy-1',
          status: 'draft',
          finalTotal: 100,
        },
        afterData: { tenancyId: 'tenancy-1', status: 'draft', finalTotal: 200 },
      }),
    )

    const snap = await db.collection('tenancies').doc('tenancy-1').get()
    expect(snap.data().currentBalance).toBe(42)
  })

  it('RECOMPUTES on draft-to-signed (signReport)', async () => {
    await seedTenancy('tenancy-1', { currentBalance: 0 })
    // recomputeCurrentBalance re-QUERIES live Firestore — it never reads the
    // event payload's data — so the doc must actually reflect the "after"
    // state for the assertion below to mean anything.
    await seedReport('report-1', {
      tenancyId: 'tenancy-1',
      status: 'signed',
      finalTotal: 1500,
    })

    await onReportWriteHandler(
      fakeEvent({
        beforeData: {
          tenancyId: 'tenancy-1',
          status: 'draft',
          finalTotal: 1500,
        },
        afterData: {
          tenancyId: 'tenancy-1',
          status: 'signed',
          finalTotal: 1500,
        },
      }),
    )

    const snap = await db.collection('tenancies').doc('tenancy-1').get()
    // No amountPaid on the seeded doc -> full finalTotal, and NOT NaN.
    expect(snap.data().currentBalance).toBe(1500)
  })

  it('RECOMPUTES on signed-to-draft (unlockReport — the unlocked report drops out)', async () => {
    await seedTenancy('tenancy-1', { currentBalance: 999 })
    // The report is now a draft in Firestore (the unlock already happened) —
    // no OTHER signed report exists, so a correct recompute lands on 0.
    await seedReport('report-1', {
      tenancyId: 'tenancy-1',
      status: 'draft',
      finalTotal: 1500,
      amountPaid: 0,
    })

    await onReportWriteHandler(
      fakeEvent({
        beforeData: {
          tenancyId: 'tenancy-1',
          status: 'signed',
          finalTotal: 1500,
          amountPaid: 0,
        },
        afterData: {
          tenancyId: 'tenancy-1',
          status: 'draft',
          finalTotal: 1500,
          amountPaid: 0,
        },
      }),
    )

    const snap = await db.collection('tenancies').doc('tenancy-1').get()
    expect(snap.data().currentBalance).toBe(0)
  })

  it('RECOMPUTES on signed-to-signed with a NEW partial payment marked (the main payment path)', async () => {
    await seedTenancy('tenancy-1', { currentBalance: 1500 })
    // The report is already signed on BOTH sides of the write — only
    // amountPaid/paymentStatus change. A status-TRANSITION check (before !==
    // after) would wrongly skip this; the handler must key on status
    // PRESENCE on either side, not on a change, to catch it.
    await seedReport('report-1', {
      tenancyId: 'tenancy-1',
      status: 'signed',
      finalTotal: 1500,
      amountPaid: 1000,
    })

    await onReportWriteHandler(
      fakeEvent({
        beforeData: {
          tenancyId: 'tenancy-1',
          status: 'signed',
          finalTotal: 1500,
        },
        afterData: {
          tenancyId: 'tenancy-1',
          status: 'signed',
          finalTotal: 1500,
          amountPaid: 1000,
        },
      }),
    )

    const snap = await db.collection('tenancies').doc('tenancy-1').get()
    expect(snap.data().currentBalance).toBe(500)
  })

  it('RECOMPUTES on signed-to-signed with an OVERPAYMENT marked (credit, negative balance)', async () => {
    await seedTenancy('tenancy-1', { currentBalance: 1500 })
    await seedReport('report-1', {
      tenancyId: 'tenancy-1',
      status: 'signed',
      finalTotal: 1500,
      amountPaid: 1800,
    })

    await onReportWriteHandler(
      fakeEvent({
        beforeData: {
          tenancyId: 'tenancy-1',
          status: 'signed',
          finalTotal: 1500,
        },
        afterData: {
          tenancyId: 'tenancy-1',
          status: 'signed',
          finalTotal: 1500,
          amountPaid: 1800,
        },
      }),
    )

    const snap = await db.collection('tenancies').doc('tenancy-1').get()
    expect(snap.data().currentBalance).toBe(-300)
  })

  it('RECOMPUTES on signed-to-signed with a payment CANCELLED (amountPaid back to absent)', async () => {
    await seedTenancy('tenancy-1', { currentBalance: 500 })
    await seedReport('report-1', {
      tenancyId: 'tenancy-1',
      status: 'signed',
      finalTotal: 1500,
    })

    await onReportWriteHandler(
      fakeEvent({
        beforeData: {
          tenancyId: 'tenancy-1',
          status: 'signed',
          finalTotal: 1500,
          amountPaid: 1000,
        },
        afterData: {
          tenancyId: 'tenancy-1',
          status: 'signed',
          finalTotal: 1500,
        },
      }),
    )

    const snap = await db.collection('tenancies').doc('tenancy-1').get()
    expect(snap.data().currentBalance).toBe(1500)
  })

  it('RECOMPUTES on a signed report being deleted (after does not exist)', async () => {
    await seedTenancy('tenancy-1', { currentBalance: 500 })
    // No OTHER signed report exists once this one is gone -> falls back to 0.

    await onReportWriteHandler(
      fakeEvent({
        beforeData: {
          tenancyId: 'tenancy-1',
          status: 'signed',
          finalTotal: 1500,
          amountPaid: 1000,
        },
        afterData: null,
      }),
    )

    const snap = await db.collection('tenancies').doc('tenancy-1').get()
    expect(snap.data().currentBalance).toBe(0)
  })
})

describe('sendReportNotificationCore (SRS §7.2, FR-REP-06/07a, pinned at f6d5c83)', () => {
  it('rejects a report that does not exist', async () => {
    await expect(
      sendReportNotificationCore('does-not-exist', 'new'),
    ).rejects.toMatchObject({ code: 'not-found' })
  })

  it('REJECTS a DRAFT report — the tenant cannot see it yet, so it cannot be notified', async () => {
    await seedReport('report-1', { status: 'draft' })
    await seedUser('user-1')

    await expect(
      sendReportNotificationCore('report-1', 'new'),
    ).rejects.toMatchObject({
      code: 'failed-precondition',
      details: { reason: 'not-signed' },
    })

    const mailSnap = await db.collection('mail').get()
    expect(mailSnap.size).toBe(0)
  })

  it('writes an A2 email when template is "new"', async () => {
    await seedReport('report-1', {
      status: 'signed',
      userId: 'user-1',
      month: 7,
      year: 2026,
      finalTotal: 1500,
      dueDate: '2026-07-05',
    })
    await seedUser('user-1')

    const result = await sendReportNotificationCore('report-1', 'new')
    expect(result).toEqual({ reportId: 'report-1', template: 'new' })

    const mailSnap = await db.collection('mail').get()
    expect(mailSnap.size).toBe(1)
    const mail = mailSnap.docs[0].data()
    expect(mail.to).toEqual(['ion@example.com'])
    expect(mail.message.subject).toBe(
      'Raportul pentru iulie 2026 este disponibil — 1.500,00 lei',
    )
  })

  it('writes an A3 email when template is "updated" — different text from A2 for the same report', async () => {
    await seedReport('report-1', {
      status: 'signed',
      userId: 'user-1',
      month: 7,
      year: 2026,
      finalTotal: 1500,
      dueDate: '2026-07-05',
    })
    await seedUser('user-1')

    await sendReportNotificationCore('report-1', 'updated')

    const mail = (await db.collection('mail').get()).docs[0].data()
    expect(mail.message.subject).toBe(
      'Raportul pentru iulie 2026 a fost actualizat',
    )
  })

  it('sends in the tenant preferred language (NFR-LOC-04), not a hardcoded one', async () => {
    await seedReport('report-1', {
      status: 'signed',
      userId: 'user-1',
      finalTotal: 1500,
      dueDate: '2026-07-05',
    })
    await seedUser('user-1', { preferredLanguage: 'en' })

    await sendReportNotificationCore('report-1', 'new')

    const mail = (await db.collection('mail').get()).docs[0].data()
    expect(mail.message.subject).toContain('is available')
  })

  it('uses finalTotal, NEVER calculatedTotal, in the email amount (FR-REP-04c)', async () => {
    await seedReport('report-1', {
      status: 'signed',
      userId: 'user-1',
      calculatedTotal: 1550, // diverged — an admin rounding adjustment
      finalTotal: 1500,
      dueDate: '2026-07-05',
    })
    await seedUser('user-1')

    await sendReportNotificationCore('report-1', 'new')

    const mail = (await db.collection('mail').get()).docs[0].data()
    expect(mail.message.subject).toContain('1.500,00')
    expect(mail.message.subject).not.toContain('1.550,00')
  })

  it('rejects if the tenant account no longer exists', async () => {
    await seedReport('report-1', { status: 'signed', userId: 'ghost-user' })

    await expect(
      sendReportNotificationCore('report-1', 'new'),
    ).rejects.toMatchObject({ code: 'not-found' })
  })
})

describe('sendReportNotification — callable guard', () => {
  it('rejects a non-admin caller — nothing written to mail', async () => {
    await seedReport('report-1', { status: 'signed', userId: 'user-1' })
    await seedUser('user-1')

    await expect(
      sendReportNotificationHandler({
        auth: { token: {}, uid: 'x' },
        data: { reportId: 'report-1', template: 'new' },
      }),
    ).rejects.toMatchObject({ code: 'permission-denied' })

    expect((await db.collection('mail').get()).size).toBe(0)
  })

  it('rejects a missing reportId argument', async () => {
    await expect(
      sendReportNotificationHandler({
        auth: { token: { admin: true }, uid: 'admin-uid' },
        data: { template: 'new' },
      }),
    ).rejects.toMatchObject({ code: 'invalid-argument' })
  })

  it('REJECTS a missing template argument', async () => {
    await seedReport('report-1', { status: 'signed', userId: 'user-1' })
    await seedUser('user-1')

    await expect(
      sendReportNotificationHandler({
        auth: { token: { admin: true }, uid: 'admin-uid' },
        data: { reportId: 'report-1' },
      }),
    ).rejects.toMatchObject({ code: 'invalid-argument' })
  })

  it('REJECTS a template value other than "new"/"updated"', async () => {
    await seedReport('report-1', { status: 'signed', userId: 'user-1' })
    await seedUser('user-1')

    await expect(
      sendReportNotificationHandler({
        auth: { token: { admin: true }, uid: 'admin-uid' },
        data: { reportId: 'report-1', template: 'garbage' },
      }),
    ).rejects.toMatchObject({ code: 'invalid-argument' })

    expect((await db.collection('mail').get()).size).toBe(0)
  })
})
