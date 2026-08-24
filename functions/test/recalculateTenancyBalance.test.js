import { beforeEach, describe, expect, it } from 'vitest'
import { getFirestore } from 'firebase-admin/firestore'
import {
  recalculateTenancyBalanceCore,
  recalculateTenancyBalanceHandler,
} from '../src/recalculateTenancyBalance.js'

// Functions tests — the REAL boundary (Firestore emulator). Mirrors
// endTenancy.test.js's fixture shape.

const PROJECT_ID = 'tenants-manager-2026'
const db = getFirestore()

async function clearEmulators() {
  const fsHost = process.env.FIRESTORE_EMULATOR_HOST
  await fetch(
    `http://${fsHost}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`,
    { method: 'DELETE' },
  )
}

function tenancy(overrides = {}) {
  return {
    userId: 'user-1',
    ownerId: 'admin-uid',
    propertyId: 'prop-1',
    tenantName: 'Ion Popescu',
    property: { name: 'Apartament Centru' },
    status: 'active',
    currentBalance: 0,
    ...overrides,
  }
}

async function seedTenancy(id, overrides = {}) {
  await db.collection('tenancies').doc(id).set(tenancy(overrides))
}

async function seedSignedReport(id, overrides = {}) {
  await db
    .collection('monthlyReports')
    .doc(id)
    .set({
      tenancyId: 'tenancy-1',
      status: 'signed',
      year: 2026,
      month: 8,
      finalTotal: 2000,
      ...overrides,
    })
}

beforeEach(async () => {
  await clearEmulators()
})

describe('recalculateTenancyBalanceCore (FR-SYS-05a)', () => {
  it('writes the recomputed value and returns { from, to }', async () => {
    await seedTenancy('tenancy-1', { currentBalance: 350 })
    await seedSignedReport('report-1', {
      tenancyId: 'tenancy-1',
      finalTotal: 2000,
    })

    const result = await recalculateTenancyBalanceCore('tenancy-1', 'admin-uid')

    expect(result).toEqual({ from: 350, to: 2000 })
    const snap = await db.collection('tenancies').doc('tenancy-1').get()
    expect(snap.data().currentBalance).toBe(2000)
  })

  it('honors amountPaid and roundingSurplus, exactly like recomputeCurrentBalance', async () => {
    await seedTenancy('tenancy-1', { currentBalance: 0 })
    await seedSignedReport('report-1', {
      tenancyId: 'tenancy-1',
      finalTotal: 2000,
      amountPaid: 500,
      roundingSurplus: 10,
    })

    const result = await recalculateTenancyBalanceCore('tenancy-1', 'admin-uid')

    expect(result).toEqual({ from: 0, to: 1490 }) // 2000 - 500 - 10
  })

  it('records who/when/from/to on the tenancy document — a correction is never anonymous', async () => {
    await seedTenancy('tenancy-1', { currentBalance: 350 })
    await seedSignedReport('report-1', {
      tenancyId: 'tenancy-1',
      finalTotal: 2000,
    })

    await recalculateTenancyBalanceCore('tenancy-1', 'admin-uid-42')

    const snap = await db.collection('tenancies').doc('tenancy-1').get()
    const data = snap.data()
    expect(data.lastRecalculatedBy).toBe('admin-uid-42')
    expect(data.lastRecalculatedFrom).toBe(350)
    expect(data.lastRecalculatedTo).toBe(2000)
    expect(data.lastRecalculatedAt).toBeDefined()
  })

  it('resolves to 0 when the tenancy has no signed reports at all', async () => {
    await seedTenancy('tenancy-1', { currentBalance: 500 })

    const result = await recalculateTenancyBalanceCore('tenancy-1', 'admin-uid')

    expect(result).toEqual({ from: 500, to: 0 })
  })

  it('throws not-found for a tenancy that does not exist', async () => {
    await expect(
      recalculateTenancyBalanceCore('missing-tenancy', 'admin-uid'),
    ).rejects.toMatchObject({ code: 'not-found' })
  })

  it('still recalculates (a no-op write) when the stored value already matches — nothing about it is guarded on divergence', async () => {
    await seedTenancy('tenancy-1', { currentBalance: 2000 })
    await seedSignedReport('report-1', {
      tenancyId: 'tenancy-1',
      finalTotal: 2000,
    })

    const result = await recalculateTenancyBalanceCore('tenancy-1', 'admin-uid')

    expect(result).toEqual({ from: 2000, to: 2000 })
  })
})

describe('recalculateTenancyBalanceHandler — admin guard', () => {
  it('rejects a non-admin caller', async () => {
    await expect(
      recalculateTenancyBalanceHandler({
        auth: { token: { admin: false }, uid: 'someone' },
        data: { tenancyId: 'tenancy-1' },
      }),
    ).rejects.toMatchObject({ code: 'permission-denied' })
  })

  it('rejects a missing tenancyId', async () => {
    await expect(
      recalculateTenancyBalanceHandler({
        auth: { token: { admin: true }, uid: 'admin-uid' },
        data: {},
      }),
    ).rejects.toMatchObject({ code: 'invalid-argument' })
  })

  it('succeeds for an admin caller with a valid tenancyId', async () => {
    await seedTenancy('tenancy-1', { currentBalance: 350 })
    await seedSignedReport('report-1', {
      tenancyId: 'tenancy-1',
      finalTotal: 2000,
    })

    await expect(
      recalculateTenancyBalanceHandler({
        auth: { token: { admin: true }, uid: 'admin-uid' },
        data: { tenancyId: 'tenancy-1' },
      }),
    ).resolves.toEqual({ from: 350, to: 2000 })
  })
})
