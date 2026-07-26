import { beforeEach, describe, expect, it } from 'vitest'
import { getFirestore } from 'firebase-admin/firestore'
import {
  signReportCore,
  signReportHandler,
  unlockReportCore,
  unlockReportHandler,
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
