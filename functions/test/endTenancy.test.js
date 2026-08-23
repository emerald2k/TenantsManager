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
    await seedTenancy('tenancy-1', { currentBalance: 0 })

    const result = await endTenancyCore('tenancy-1', 'admin-uid')
    expect(result.tenancyId).toBe('tenancy-1')

    const tenancySnap = await db.collection('tenancies').doc('tenancy-1').get()
    expect(tenancySnap.data().status).toBe('ended')
    expect(tenancySnap.data().endedAt).toBeTruthy()
    expect(tenancySnap.data().closingBalance).toBe(0)

    const propertySnap = await db.collection('properties').doc('prop-1').get()
    expect(propertySnap.data().status).toBe('free')

    const userSnap = await db.collection('users').doc('user-1').get()
    expect(userSnap.data().status).toBe('inactive-readonly')
  })
})

describe('endTenancy — arrears no longer block termination (FR-CON-04, reversed at M8)', () => {
  // Anti-vacuity for the OLD guard's removal: this is exactly the input the
  // pre-M8 guard rejected. Re-introducing the guard makes this fail.
  it('permits termination when currentBalance > 0 (arrears) and freezes it into closingBalance', async () => {
    await seedTenancy('tenancy-1', { currentBalance: 150 })

    const result = await endTenancyCore('tenancy-1', 'admin-uid')
    expect(result.tenancyId).toBe('tenancy-1')

    const tenancySnap = await db.collection('tenancies').doc('tenancy-1').get()
    expect(tenancySnap.data().status).toBe('ended')
    expect(tenancySnap.data().closingBalance).toBe(150)
    // The debt itself survives termination (FR-DASH-13) — currentBalance is
    // NOT cleared, only frozen alongside into closingBalance.
    expect(tenancySnap.data().currentBalance).toBe(150)

    const propertySnap = await db.collection('properties').doc('prop-1').get()
    expect(propertySnap.data().status).toBe('free')
    const userSnap = await db.collection('users').doc('user-1').get()
    expect(userSnap.data().status).toBe('inactive-readonly')
  })

  it('freezes a negative currentBalance (credit in the tenant’s favor) into closingBalance (FR-DASH-14)', async () => {
    await seedTenancy('tenancy-1', { currentBalance: -50 })

    await endTenancyCore('tenancy-1', 'admin-uid')

    const tenancySnap = await db.collection('tenancies').doc('tenancy-1').get()
    expect(tenancySnap.data().status).toBe('ended')
    expect(tenancySnap.data().closingBalance).toBe(-50)
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
