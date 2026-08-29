import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'
import {
  resetTenantPasswordCore,
  resetTenantPasswordHandler,
} from '../src/resetTenantPassword.js'

// Functions tests — the REAL boundary (Auth + Firestore emulators), no
// mocks of the data layer, same convention as kyc.test.js. Started via
// `npm run test:emulator`.

const PROJECT_ID = 'tenants-manager-2026'
const auth = getAuth()
const db = getFirestore()

function user(overrides = {}) {
  return {
    name: 'Ion Popescu',
    email: 'ion@example.com',
    preferredLanguage: 'ro',
    ...overrides,
  }
}

function tenancy(overrides = {}) {
  return {
    userId: 'user-1',
    ownerId: 'admin-uid',
    propertyId: 'prop-1',
    tenantName: 'Ion Popescu',
    property: { name: 'Apartament Centru', address: {} },
    startDate: '2026-01-01',
    endDate: '2027-01-01',
    dueDay: 5,
    status: 'active',
    currentBalance: 0,
    ...overrides,
  }
}

async function clearEmulators() {
  const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST
  await fetch(
    `http://${authHost}/emulator/v1/projects/${PROJECT_ID}/accounts`,
    { method: 'DELETE' },
  )
  const fsHost = process.env.FIRESTORE_EMULATOR_HOST
  await fetch(
    `http://${fsHost}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`,
    { method: 'DELETE' },
  )
}

beforeEach(async () => {
  vi.restoreAllMocks()
  await clearEmulators()
})

describe('resetTenantPassword — happy path (SRS §7.2)', () => {
  it('generates a 12+ char password and sets it on the Auth account via updateUser', async () => {
    const userRecord = await auth.createUser({
      email: 'ion@example.com',
      password: 'old-password-123',
    })
    const updateSpy = vi.spyOn(auth, 'updateUser')

    const result = await resetTenantPasswordCore(userRecord.uid, 'admin-uid')

    // FR-AUTH-06 / NFR-SEC-03: same 12+ minimum as finalizeKyc's generatePassword.
    expect(result.password).toBeTruthy()
    expect(result.password.length).toBeGreaterThanOrEqual(12)
    // The EXACT password returned to the admin is the one actually sent to
    // Auth — not a different, unrelated random string.
    expect(updateSpy).toHaveBeenCalledWith(userRecord.uid, {
      password: result.password,
    })
  })

  it('skips the A9 email when the account has no Firestore users/ doc (defensive, never throws)', async () => {
    const userRecord = await auth.createUser({
      email: 'ion@example.com',
      password: 'old-password-123',
    })
    // No `users/{uid}` doc seeded — Auth account only.

    const result = await resetTenantPasswordCore(userRecord.uid, 'admin-uid')

    expect(result.password).toBeTruthy()
    const mailSnap = await db.collection('mail').get()
    expect(mailSnap.size).toBe(0)
  })

  it('skips the A9 email when the tenant has no active tenancy (defensive, never throws)', async () => {
    const userRecord = await auth.createUser({
      email: 'ion@example.com',
      password: 'old-password-123',
    })
    await db.collection('users').doc(userRecord.uid).set(user())
    // No active tenancy seeded — e.g. a former tenant, between tenancies.

    const result = await resetTenantPasswordCore(userRecord.uid, 'admin-uid')

    expect(result.password).toBeTruthy()
    const mailSnap = await db.collection('mail').get()
    expect(mailSnap.size).toBe(0)
  })
})

describe('resetTenantPassword — A9 credentials-resent email (FR-AUTH-04, M8 stage 14)', () => {
  it('sends the A9 email with the SAME password returned to the admin', async () => {
    const userRecord = await auth.createUser({
      email: 'ion@example.com',
      password: 'old-password-123',
    })
    await db.collection('users').doc(userRecord.uid).set(user())
    await db
      .collection('tenancies')
      .doc('tenancy-1')
      .set(tenancy({ userId: userRecord.uid }))

    const result = await resetTenantPasswordCore(userRecord.uid, 'admin-uid')

    const mailSnap = await db.collection('mail').get()
    expect(mailSnap.size).toBe(1)
    const mail = mailSnap.docs[0].data()
    expect(mail.type).toBe('credentials-resent')
    expect(mail.audience).toBe('tenant')
    expect(mail.relatedId).toBe('tenancy-1')
    expect(mail.ownerId).toBe('admin-uid')
    expect(mail.to).toEqual(['ion@example.com'])
    expect(mail.message.text).toContain(result.password)
  })

  // Mutation check (CLAUDE.md §7): temporarily hardcoding a DIFFERENT
  // literal password string into the A9 email builder call (instead of the
  // one just generated and sent to Auth) made this test fail, confirmed,
  // then reverted.
  it('the ordering: a failure sending A9 never undoes or masks a successful password reset', async () => {
    const userRecord = await auth.createUser({
      email: 'ion@example.com',
      password: 'old-password-123',
    })
    await db.collection('users').doc(userRecord.uid).set(user())
    // Tenancy exists but is malformed (no `property` field at all — never
    // an `undefined` VALUE, which Firestore's SDK would reject synchronously
    // on write, per CLAUDE.md's own documented gotcha) — the email step
    // will throw reading `tenancy.property.name`. The Auth update above has
    // ALREADY committed by the time that happens.
    const malformedTenancy = tenancy({ userId: userRecord.uid })
    delete malformedTenancy.property
    await db.collection('tenancies').doc('tenancy-1').set(malformedTenancy)

    const result = await resetTenantPasswordCore(userRecord.uid, 'admin-uid')

    expect(result.password).toBeTruthy()
    expect(result.password.length).toBeGreaterThanOrEqual(12)
  })
})

describe('resetTenantPassword — invalid states', () => {
  it('rejects a user that does not exist', async () => {
    await expect(
      resetTenantPasswordCore('does-not-exist', 'admin-uid'),
    ).rejects.toMatchObject({ code: 'not-found' })
  })
})

describe('resetTenantPassword — callable guard', () => {
  it('rejects a non-admin caller (callable guard)', async () => {
    const userRecord = await auth.createUser({
      email: 'ion@example.com',
      password: 'old-password-123',
    })

    await expect(
      resetTenantPasswordHandler({
        auth: { token: {}, uid: 'x' },
        data: { userId: userRecord.uid },
      }),
    ).rejects.toMatchObject({ code: 'permission-denied' })
  })

  it('rejects a missing userId argument', async () => {
    await expect(
      resetTenantPasswordHandler({
        auth: { token: { admin: true }, uid: 'admin-uid' },
        data: {},
      }),
    ).rejects.toMatchObject({ code: 'invalid-argument' })
  })
})
