import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getFirestore } from 'firebase-admin/firestore'
import { getAuth } from 'firebase-admin/auth'
import { finalizeKycCore, finalizeKycHandler } from '../src/kyc.js'

// Functions tests — the REAL boundary (Auth + Firestore emulators), no mocks of the
// data layer. Started via `npm run test:emulator` (firebase emulators:exec), which
// sets the emulator hosts + project id, so the Admin SDK (initialized on requiring
// kyc.js) talks to the emulators.

const PROJECT_ID = 'tenants-manager-2026'
const db = getFirestore()
const auth = getAuth()

// A complete, valid draft (mirrors the web full schema). `propertyId` points at the
// property seeded in beforeEach.
function completeDraft(overrides = {}) {
  return {
    name: 'Ion Popescu',
    dateOfBirth: '1990-01-01',
    cnp: '1900101123456',
    phone: '0712345678',
    email: 'ion@example.com',
    preferredLanguage: 'ro',
    previousAddress: 'Str. Veche 1',
    emergencyContact: { name: 'Maria', phone: '0700000000' },
    occupantCount: '2',
    smoker: false,
    pets: { has: false },
    vehicle: { has: false },
    idDocumentPhotos: [
      { url: 'gs://bucket/1.jpg', name: 'front.jpg', type: 'image' },
    ],
    employer: 'ACME SRL',
    occupation: 'Engineer',
    employmentDuration: '3 years',
    monthlyIncome: { source: 'salary', amount: '5000' },
    guarantor: { name: 'Gigi', cnp: '1800101123456', phone: '0722222222' },
    previousReference: { name: 'Vlad', phone: '0733333333' },
    propertyId: 'prop-seed',
    startDate: '2026-08-01',
    endDate: '2027-08-01',
    monthlyRent: '2000',
    securityDeposit: '2000',
    dueDay: '5',
    status: 'in_progress',
    currentStep: 4,
    ...overrides,
  }
}

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
  status: 'free',
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

async function seedDraft(id, data) {
  await db.collection('onboardingDrafts').doc(id).set(data)
}

beforeEach(async () => {
  vi.restoreAllMocks()
  await clearEmulators()
  await db.collection('properties').doc('prop-seed').set(PROPERTY)
})

describe('finalizeKyc — happy path (FR-TEN-16/18)', () => {
  it('creates the account, writes users + tenancies + mail, deletes the draft', async () => {
    await seedDraft('draft-1', completeDraft())

    const result = await finalizeKycCore('draft-1', 'admin-uid')

    // Response carries the credentials + success ids.
    expect(result.uid).toBeTruthy()
    expect(result.tenancyId).toBeTruthy()
    expect(result.email).toBe('ion@example.com')

    // Auth account exists.
    const authUser = await auth.getUser(result.uid)
    expect(authUser.email).toBe('ion@example.com')

    // users doc — profile written, contract fields NOT leaked in.
    const userSnap = await db.collection('users').doc(result.uid).get()
    expect(userSnap.exists).toBe(true)
    expect(userSnap.data()).toMatchObject({
      name: 'Ion Popescu',
      cnp: '1900101123456',
      status: 'active',
    })
    expect(userSnap.data()).not.toHaveProperty('propertyId')
    expect(userSnap.data()).not.toHaveProperty('currentStep')

    // tenancies doc — denormalizations landed (FR the report checks explicitly).
    const tenancySnap = await db
      .collection('tenancies')
      .doc(result.tenancyId)
      .get()
    expect(tenancySnap.data()).toMatchObject({
      userId: result.uid,
      ownerId: 'admin-uid',
      propertyId: 'prop-seed',
      tenantName: 'Ion Popescu',
      property: { name: 'Apartament Centru' },
      status: 'active',
      currentBalance: 0,
    })
    expect(tenancySnap.data().property.address.city).toBe('Cluj-Napoca')

    // mail doc written.
    const mailSnap = await db.collection('mail').get()
    expect(mailSnap.size).toBe(1)
    expect(mailSnap.docs[0].data().to).toEqual(['ion@example.com'])

    // draft deleted (FR-TEN-18).
    const draftSnap = await db
      .collection('onboardingDrafts')
      .doc('draft-1')
      .get()
    expect(draftSnap.exists).toBe(false)
  })

  it('returns the email and a 12-char password to the admin', async () => {
    await seedDraft('draft-1', completeDraft())

    const result = await finalizeKycCore('draft-1', 'admin-uid')

    expect(result.email).toBe('ion@example.com')
    expect(result.password).toEqual(expect.any(String))
    // Exactly 12 (the FR-AUTH-06 minimum). `=== 12`, not `>= 12`, so a change to the
    // generator's length is caught rather than silently passing.
    expect(result.password.length).toBe(12)
  })

  it('writes the credentials email in the tenant preferred language (NFR-LOC-04)', async () => {
    await seedDraft('draft-ro', completeDraft({ preferredLanguage: 'ro' }))
    await finalizeKycCore('draft-ro', 'admin-uid')
    let mail = (await db.collection('mail').get()).docs[0].data()
    expect(mail.message.subject).toBe('Contul tău de chiriaș a fost creat')

    await clearEmulators()
    await db.collection('properties').doc('prop-seed').set(PROPERTY)
    await seedDraft(
      'draft-en',
      completeDraft({ preferredLanguage: 'en', email: 'jane@example.com' }),
    )
    await finalizeKycCore('draft-en', 'admin-uid')
    mail = (await db.collection('mail').get()).docs[0].data()
    expect(mail.message.subject).toBe('Your tenant account has been created')
  })
})

describe('finalizeKyc — guards', () => {
  it('rejects an incomplete draft before touching Auth (FR-TEN-16)', async () => {
    const { cnp, ...incomplete } = completeDraft()
    void cnp
    await seedDraft('draft-bad', incomplete)

    await expect(
      finalizeKycCore('draft-bad', 'admin-uid'),
    ).rejects.toMatchObject({
      code: 'failed-precondition',
    })
    // No account created.
    const users = await auth.listUsers()
    expect(users.users.length).toBe(0)
  })

  it('blocks a duplicate CNP and leaves Auth untouched (FR-TEN-22)', async () => {
    // An existing tenant with the same CNP (a users doc — the pre-check queries it).
    await db
      .collection('users')
      .doc('existing')
      .set({ name: 'Existing Tenant', cnp: '1900101123456', status: 'active' })
    await seedDraft('draft-dup', completeDraft())

    await expect(
      finalizeKycCore('draft-dup', 'admin-uid'),
    ).rejects.toMatchObject({ code: 'already-exists' })

    // The pre-check caught it BEFORE Auth — no account was created.
    const users = await auth.listUsers()
    expect(users.users.length).toBe(0)
  })

  it('blocks an occupied property inside the transaction (FR-TEN-23)', async () => {
    // An active tenancy on the property = occupied.
    await db.collection('tenancies').add({
      propertyId: 'prop-seed',
      status: 'active',
      userId: 'someone',
    })
    await seedDraft('draft-occ', completeDraft())

    await expect(
      finalizeKycCore('draft-occ', 'admin-uid'),
    ).rejects.toMatchObject({ code: 'failed-precondition' })
  })

  it('rejects a non-admin caller (callable guard)', async () => {
    await seedDraft('draft-1', completeDraft())

    await expect(
      finalizeKycHandler({
        auth: { token: {}, uid: 'x' },
        data: { draftId: 'draft-1' },
      }),
    ).rejects.toMatchObject({ code: 'permission-denied' })
    // The core never ran — no account.
    const users = await auth.listUsers()
    expect(users.users.length).toBe(0)
  })
})

describe('finalizeKyc — compensation (no orphan Auth account)', () => {
  it('deletes the created account when the Firestore transaction fails', async () => {
    await seedDraft('draft-1', completeDraft())

    // Force the transaction to fail AFTER the account is created.
    vi.spyOn(db, 'runTransaction').mockRejectedValueOnce(
      new Error('simulated Firestore failure'),
    )

    await expect(finalizeKycCore('draft-1', 'admin-uid')).rejects.toThrow(
      'simulated Firestore failure',
    )

    // THE BITE: no orphan account survives. Without the compensation deleteUser, the
    // account created before the transaction would remain here.
    const users = await auth.listUsers()
    expect(users.users.length).toBe(0)
    // And the draft is still there (nothing was committed).
    const draftSnap = await db
      .collection('onboardingDrafts')
      .doc('draft-1')
      .get()
    expect(draftSnap.exists).toBe(true)
  })
})
