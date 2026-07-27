import { beforeEach, describe, expect, it } from 'vitest'
import { getFirestore } from 'firebase-admin/firestore'
import {
  signReportCore,
  signReportHandler,
  unlockReportCore,
  unlockReportHandler,
  recomputeCurrentBalance,
  onReportWriteHandler,
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
