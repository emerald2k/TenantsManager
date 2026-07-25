import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'
import {
  setTenantAccountStatusCore,
  setTenantAccountStatusHandler,
} from '../src/setTenantAccountStatus.js'

// Functions tests — the REAL boundary (Auth + Firestore emulators), no mocks
// of the data layer, same convention as kyc.test.js/endTenancy.test.js.

const PROJECT_ID = 'tenants-manager-2026'
const auth = getAuth()
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

async function clearEmulators() {
  const fsHost = process.env.FIRESTORE_EMULATOR_HOST
  const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST
  await fetch(
    `http://${fsHost}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`,
    { method: 'DELETE' },
  )
  await fetch(
    `http://${authHost}/emulator/v1/projects/${PROJECT_ID}/accounts`,
    { method: 'DELETE' },
  )
}

/** Creates a matching Auth account + `users` doc — `setTenantAccountStatusCore`
 * checks the Firestore doc exists, then operates on the SAME id in Auth,
 * mirroring how finalizeKyc creates both together. */
async function seedTenant(status = 'active') {
  const userRecord = await auth.createUser({
    email: 'ion@example.com',
    password: 'irrelevant-123',
  })
  await db.collection('users').doc(userRecord.uid).set({
    name: 'Ion Popescu',
    email: 'ion@example.com',
    status,
  })
  return userRecord.uid
}

async function seedActiveTenancy(userId) {
  await db.collection('properties').doc('prop-1').set(PROPERTY)
  await db
    .collection('tenancies')
    .doc('tenancy-1')
    .set({
      userId,
      ownerId: 'admin-uid',
      propertyId: 'prop-1',
      tenantName: 'Ion Popescu',
      property: { name: PROPERTY.name, address: PROPERTY.address },
      startDate: '2026-01-01',
      endDate: '2027-01-01',
      monthlyRent: 2000,
      dueDay: 5,
      currentBalance: 0,
      status: 'active',
      attachedDocuments: [],
    })
}

beforeEach(async () => {
  vi.restoreAllMocks()
  await clearEmulators()
})

describe('setTenantAccountStatus — disable (FR-TEN-24)', () => {
  it('disables the Auth account, revokes tokens, and sets users.status to disabled', async () => {
    const userId = await seedTenant('active')
    const revokeSpy = vi.spyOn(auth, 'revokeRefreshTokens')

    const result = await setTenantAccountStatusCore(
      userId,
      'disable',
      'admin-uid',
    )

    expect(result.status).toBe('disabled')
    const authUser = await auth.getUser(userId)
    expect(authUser.disabled).toBe(true)
    expect(revokeSpy).toHaveBeenCalledWith(userId)
    const userSnap = await db.collection('users').doc(userId).get()
    expect(userSnap.data().status).toBe('disabled')
  })
})

describe('setTenantAccountStatus — re-enable RECALCULATES status (Bogdan’s state machine, M3-D)', () => {
  it('re-enabling a user WITH an active tenancy sets status to active', async () => {
    const userId = await seedTenant('disabled')
    await auth.updateUser(userId, { disabled: true })
    await seedActiveTenancy(userId)

    const result = await setTenantAccountStatusCore(
      userId,
      'enable',
      'admin-uid',
    )

    expect(result.status).toBe('active')
    const authUser = await auth.getUser(userId)
    expect(authUser.disabled).toBe(false)
    const userSnap = await db.collection('users').doc(userId).get()
    expect(userSnap.data().status).toBe('active')
  })

  // THE TRAP TEST — a naive re-enable that just flips back to 'active'
  // unconditionally would wrongly pass this too; only a real re-query for an
  // active tenancy gets this specific case right.
  it('re-enabling a user WITHOUT an active tenancy sets status to inactive-readonly, NOT active', async () => {
    const userId = await seedTenant('disabled')
    await auth.updateUser(userId, { disabled: true })
    // Deliberately NO active tenancy seeded.

    const result = await setTenantAccountStatusCore(
      userId,
      'enable',
      'admin-uid',
    )

    expect(result.status).toBe('inactive-readonly')
    const userSnap = await db.collection('users').doc(userId).get()
    expect(userSnap.data().status).toBe('inactive-readonly')
  })
})

describe('setTenantAccountStatus — compensation (Auth/Firestore consistency)', () => {
  // Anti-vacuity: remove the compensation `catch` block in disable() and this
  // fails — Auth would stay disabled while the Firestore write never landed.
  it('reverts Auth (disabled:false) when the Firestore write fails during disable', async () => {
    const userId = await seedTenant('active')
    vi.spyOn(db, 'runTransaction').mockRejectedValueOnce(
      new Error('simulated Firestore failure'),
    )

    await expect(
      setTenantAccountStatusCore(userId, 'disable', 'admin-uid'),
    ).rejects.toThrow('simulated Firestore failure')

    const authUser = await auth.getUser(userId)
    expect(authUser.disabled).toBe(false)
    const userSnap = await db.collection('users').doc(userId).get()
    expect(userSnap.data().status).toBe('active')
  })

  it('reverts Auth (disabled:true) when the Firestore write fails during enable', async () => {
    const userId = await seedTenant('disabled')
    await auth.updateUser(userId, { disabled: true })
    vi.spyOn(db, 'runTransaction').mockRejectedValueOnce(
      new Error('simulated Firestore failure'),
    )

    await expect(
      setTenantAccountStatusCore(userId, 'enable', 'admin-uid'),
    ).rejects.toThrow('simulated Firestore failure')

    const authUser = await auth.getUser(userId)
    expect(authUser.disabled).toBe(true)
    const userSnap = await db.collection('users').doc(userId).get()
    expect(userSnap.data().status).toBe('disabled')
  })
})

describe('setTenantAccountStatus — archive (D#3 audit fix: archive must reach Auth, SRS §5.3)', () => {
  it('disables the Auth account, revokes tokens, and sets users.status to archived', async () => {
    const userId = await seedTenant('inactive-readonly')
    const revokeSpy = vi.spyOn(auth, 'revokeRefreshTokens')

    const result = await setTenantAccountStatusCore(
      userId,
      'archive',
      'admin-uid',
    )

    expect(result.status).toBe('archived')
    const authUser = await auth.getUser(userId)
    expect(authUser.disabled).toBe(true)
    expect(revokeSpy).toHaveBeenCalledWith(userId)
    const userSnap = await db.collection('users').doc(userId).get()
    expect(userSnap.data().status).toBe('archived')
  })

  // Anti-vacuity: remove the guard from archive() and this fails — the
  // account would be archived (and locked out) while still actively rented.
  it('blocks archiving when the account has an active tenancy — nothing changes', async () => {
    const userId = await seedTenant('active')
    await seedActiveTenancy(userId)

    await expect(
      setTenantAccountStatusCore(userId, 'archive', 'admin-uid'),
    ).rejects.toMatchObject({
      code: 'failed-precondition',
      details: { reason: 'active-tenancy' },
    })

    const authUser = await auth.getUser(userId)
    expect(authUser.disabled).toBe(false)
    const userSnap = await db.collection('users').doc(userId).get()
    expect(userSnap.data().status).toBe('active')
  })

  it('reverts Auth (disabled:false) when the Firestore write fails during archive', async () => {
    const userId = await seedTenant('inactive-readonly')
    vi.spyOn(db, 'runTransaction').mockRejectedValueOnce(
      new Error('simulated Firestore failure'),
    )

    await expect(
      setTenantAccountStatusCore(userId, 'archive', 'admin-uid'),
    ).rejects.toThrow('simulated Firestore failure')

    const authUser = await auth.getUser(userId)
    expect(authUser.disabled).toBe(false)
    const userSnap = await db.collection('users').doc(userId).get()
    expect(userSnap.data().status).toBe('inactive-readonly')
  })
})

describe('setTenantAccountStatus — archived is terminal (M3 remediation, PAS 5)', () => {
  // Anti-vacuity: remove the terminal guard from setTenantAccountStatusCore
  // and this fails — an archived account could be silently re-enabled by a
  // direct API call, bypassing the state machine (FR-TEN-24, SRS §5.3: "archived
  // is terminal — no further action from it").
  it('rejects enable on an archived account — nothing changes', async () => {
    const userId = await seedTenant('archived')

    await expect(
      setTenantAccountStatusCore(userId, 'enable', 'admin-uid'),
    ).rejects.toMatchObject({
      code: 'failed-precondition',
      details: { reason: 'archived' },
    })

    const authUser = await auth.getUser(userId)
    expect(authUser.disabled).toBe(false)
    const userSnap = await db.collection('users').doc(userId).get()
    expect(userSnap.data().status).toBe('archived')
  })

  it('rejects disable on an archived account', async () => {
    const userId = await seedTenant('archived')

    await expect(
      setTenantAccountStatusCore(userId, 'disable', 'admin-uid'),
    ).rejects.toMatchObject({
      code: 'failed-precondition',
      details: { reason: 'archived' },
    })
  })

  it('rejects archiving an account that is already archived', async () => {
    const userId = await seedTenant('archived')

    await expect(
      setTenantAccountStatusCore(userId, 'archive', 'admin-uid'),
    ).rejects.toMatchObject({
      code: 'failed-precondition',
      details: { reason: 'archived' },
    })
  })
})

describe('setTenantAccountStatus — invalid states', () => {
  it('rejects a user that does not exist', async () => {
    await expect(
      setTenantAccountStatusCore('does-not-exist', 'disable', 'admin-uid'),
    ).rejects.toMatchObject({ code: 'not-found' })
  })
})

describe('setTenantAccountStatus — callable guard', () => {
  it('rejects a non-admin caller (callable guard)', async () => {
    const userId = await seedTenant('active')

    await expect(
      setTenantAccountStatusHandler({
        auth: { token: {}, uid: 'x' },
        data: { userId, action: 'disable' },
      }),
    ).rejects.toMatchObject({ code: 'permission-denied' })

    const authUser = await auth.getUser(userId)
    expect(authUser.disabled).toBe(false)
  })

  it('rejects a missing userId argument', async () => {
    await expect(
      setTenantAccountStatusHandler({
        auth: { token: { admin: true }, uid: 'admin-uid' },
        data: { action: 'disable' },
      }),
    ).rejects.toMatchObject({ code: 'invalid-argument' })
  })

  it('rejects an invalid action', async () => {
    const userId = await seedTenant('active')

    await expect(
      setTenantAccountStatusHandler({
        auth: { token: { admin: true }, uid: 'admin-uid' },
        data: { userId, action: 'not-a-real-action' },
      }),
    ).rejects.toMatchObject({ code: 'invalid-argument' })
  })

  it('accepts action:archive as a valid argument (not rejected as invalid-argument)', async () => {
    const userId = await seedTenant('inactive-readonly')

    const result = await setTenantAccountStatusHandler({
      auth: { token: { admin: true }, uid: 'admin-uid' },
      data: { userId, action: 'archive' },
    })

    expect(result.status).toBe('archived')
  })
})
