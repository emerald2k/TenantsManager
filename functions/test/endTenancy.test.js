import { beforeEach, describe, expect, it } from 'vitest'
import { getFirestore } from 'firebase-admin/firestore'
import { endTenancyCore, endTenancyHandler } from '../src/endTenancy.js'

// Functions tests — the REAL boundary (Auth + Firestore emulators), no mocks of
// the data layer. Started via `npm run test:emulator` (firebase emulators:exec).

const PROJECT_ID = 'tenants-manager-2026'
const db = getFirestore()

const PROPERTY = {
  name: 'Apartament Centru',
  address: {
    street: 'Str. Memorandumului',
    number: '4',
    city: 'Cluj-Napoca',
    county: 'Cluj',
    postalCode: '400114',
  },
  ownerId: 'admin-uid',
  status: 'occupied',
  archived: false,
  services: [],
}

const USER = {
  name: 'Ion Popescu',
  email: 'ion@example.com',
  cnp: '1900101123456',
  preferredLanguage: 'ro',
  status: 'active',
}

// Mirrors `toTenancyDocument` (kyc.js) — the real shape of a tenancy created by
// finalizeKyc, so this test exercises the same document endTenancy will
// actually operate on in production.
function tenancy(overrides = {}) {
  return {
    userId: 'user-1',
    ownerId: 'admin-uid',
    propertyId: 'prop-1',
    tenantName: 'Ion Popescu',
    property: { name: PROPERTY.name, address: PROPERTY.address },
    startDate: '2026-01-01',
    endDate: '2027-01-01',
    monthlyRent: 2000,
    dueDay: 5,
    reportReminderDaysBefore: 3,
    currentBalance: 0,
    status: 'active',
    attachedDocuments: [],
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

async function seedTenancy(id, overrides = {}) {
  await db.collection('tenancies').doc(id).set(tenancy(overrides))
}

beforeEach(async () => {
  await clearEmulators()
  await db.collection('properties').doc('prop-1').set(PROPERTY)
  await db.collection('users').doc('user-1').set(USER)
})

describe('endTenancy — happy path (FR-CON-03/05), symmetric with finalizeKyc', () => {
  it('atomically ends the tenancy, frees the property, and sets the account inactive-readonly', async () => {
    await seedTenancy('tenancy-1')

    const result = await endTenancyCore('tenancy-1', 'admin-uid')
    expect(result.tenancyId).toBe('tenancy-1')

    const tenancySnap = await db.collection('tenancies').doc('tenancy-1').get()
    expect(tenancySnap.data().status).toBe('ended')
    expect(tenancySnap.data().endedAt).toBeTruthy()

    const propertySnap = await db.collection('properties').doc('prop-1').get()
    expect(propertySnap.data().status).toBe('free')

    const userSnap = await db.collection('users').doc('user-1').get()
    expect(userSnap.data().status).toBe('inactive-readonly')
  })
})

describe('endTenancy — arrears guard (FR-CON-04)', () => {
  // Anti-vacuity: removing the guard from endTenancy.js makes this fail (the
  // termination would silently succeed instead of being blocked).
  it('blocks termination when currentBalance > 0 (arrears) — nothing changes', async () => {
    await seedTenancy('tenancy-1', { currentBalance: 150 })

    await expect(
      endTenancyCore('tenancy-1', 'admin-uid'),
    ).rejects.toMatchObject({
      code: 'failed-precondition',
      details: { reason: 'arrears' },
    })

    const tenancySnap = await db.collection('tenancies').doc('tenancy-1').get()
    expect(tenancySnap.data().status).toBe('active')
    const propertySnap = await db.collection('properties').doc('prop-1').get()
    expect(propertySnap.data().status).toBe('occupied')
    const userSnap = await db.collection('users').doc('user-1').get()
    expect(userSnap.data().status).toBe('active')
  })

  it('permits termination when currentBalance is exactly 0', async () => {
    await seedTenancy('tenancy-1', { currentBalance: 0 })

    const result = await endTenancyCore('tenancy-1', 'admin-uid')
    expect(result.tenancyId).toBe('tenancy-1')
  })

  it('permits termination when currentBalance is negative (credit in the tenant’s favor)', async () => {
    await seedTenancy('tenancy-1', { currentBalance: -50 })

    await endTenancyCore('tenancy-1', 'admin-uid')

    const tenancySnap = await db.collection('tenancies').doc('tenancy-1').get()
    expect(tenancySnap.data().status).toBe('ended')
  })
})

describe('endTenancy — invalid states', () => {
  it('rejects a tenancy that does not exist', async () => {
    await expect(
      endTenancyCore('does-not-exist', 'admin-uid'),
    ).rejects.toMatchObject({ code: 'not-found' })
  })

  it('rejects a tenancy that is already ended', async () => {
    await seedTenancy('tenancy-1', { status: 'ended' })

    await expect(
      endTenancyCore('tenancy-1', 'admin-uid'),
    ).rejects.toMatchObject({ code: 'failed-precondition' })
  })
})

describe('endTenancy — callable guard', () => {
  it('rejects a non-admin caller (callable guard) — nothing changes', async () => {
    await seedTenancy('tenancy-1')

    await expect(
      endTenancyHandler({
        auth: { token: {}, uid: 'x' },
        data: { tenancyId: 'tenancy-1' },
      }),
    ).rejects.toMatchObject({ code: 'permission-denied' })

    const tenancySnap = await db.collection('tenancies').doc('tenancy-1').get()
    expect(tenancySnap.data().status).toBe('active')
  })

  it('rejects a missing tenancyId argument', async () => {
    await expect(
      endTenancyHandler({
        auth: { token: { admin: true }, uid: 'admin-uid' },
        data: {},
      }),
    ).rejects.toMatchObject({ code: 'invalid-argument' })
  })
})
