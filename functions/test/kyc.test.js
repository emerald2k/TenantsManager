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
    occupantCount: 2,
    smoker: false,
    pets: { has: false },
    vehicle: { has: false },
    idDocumentPhotos: [
      { url: 'gs://bucket/1.jpg', name: 'front.jpg', type: 'image' },
    ],
    employer: 'ACME SRL',
    occupation: 'Engineer',
    employmentDuration: 3,
    monthlyIncome: { source: 'salary', amount: 5000 },
    guarantor: { name: 'Gigi', cnp: '1800101123456', phone: '0722222222' },
    previousReference: { name: 'Vlad', phone: '0733333333' },
    propertyId: 'prop-seed',
    startDate: '2026-08-01',
    endDate: '2027-08-01',
    monthlyRent: 2000,
    securityDeposit: 2000,
    dueDay: 5,
    reportReminderDaysBefore: 3,
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

// The account a "new tenancy on an existing account" draft (FR-TEN-07) links to.
const EXISTING_USER = {
  name: 'Maria Ionescu',
  email: 'maria@example.com',
  cnp: '1900101999999',
  preferredLanguage: 'ro',
  status: 'active',
}

// A draft with existingUserId set: Steps 1-3 are IRRELEVANT — the whole point of
// the branch (SRS §6 onboardingDrafts.existingUserId) — only Step 4 +
// existingUserId matter for completion. Deliberately includes the SAME
// present-but-EMPTY Step 1-3 placeholders `draftFormDefaults` pre-fills on the
// web wizard (name:'', emergencyContact:{name:'',phone:''}, etc.) — exactly what
// autosave writes to Firestore the moment the admin confirms "existing tenant" on
// Step 1 (before ever touching Steps 2-3). A validator that only tolerates
// ABSENT Step 1-3 fields (not PRESENT-but-empty ones) would wrongly reject this.
function existingUserDraft(overrides = {}) {
  return {
    existingUserId: 'existing-uid',
    name: '',
    dateOfBirth: '',
    cnp: '',
    phone: '',
    email: '',
    mailingAddress: '',
    previousAddress: '',
    emergencyContact: { name: '', phone: '' },
    occupantCount: '',
    pets: { has: false, type: '' },
    vehicle: { has: false, make: '', plateNumber: '' },
    idDocumentPhotos: [],
    employer: '',
    occupation: '',
    employmentDuration: '',
    monthlyIncome: { source: '', amount: '' },
    guarantor: { name: '', cnp: '', phone: '', idDocumentPhotos: [] },
    previousReference: { name: '', phone: '' },
    propertyId: 'prop-seed',
    startDate: '2026-08-01',
    endDate: '2027-08-01',
    monthlyRent: 2000,
    dueDay: 5,
    reportReminderDaysBefore: 3,
    status: 'in_progress',
    currentStep: 4,
    ...overrides,
  }
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

async function seedExistingUser(id, data) {
  await db.collection('users').doc(id).set(data)
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
    expect(result.accountCreated).toBe(true)

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
      reportReminderDaysBefore: 3,
      // Sub-stage E: numeric fields land as REAL numbers in Firestore, not strings
      // (the M4 report-arithmetic bug this sub-stage fixes).
      monthlyRent: 2000,
      dueDay: 5,
      securityDeposit: 2000,
    })
    expect(typeof tenancySnap.data().monthlyRent).toBe('number')
    expect(typeof tenancySnap.data().dueDay).toBe('number')
    expect(typeof tenancySnap.data().securityDeposit).toBe('number')
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

    // property flips to occupied (FR-PROP-05) — computed from the new active
    // tenancy, in the same transaction that creates it.
    const propertySnap = await db
      .collection('properties')
      .doc('prop-seed')
      .get()
    expect(propertySnap.data().status).toBe('occupied')
  })

  it('omits securityDeposit from the tenancy doc when absent from the draft (optional, FR-CON-01) — no crash on a numeric field', async () => {
    const { securityDeposit, ...draftWithoutDeposit } = completeDraft()
    void securityDeposit
    await seedDraft('draft-no-deposit', draftWithoutDeposit)

    const result = await finalizeKycCore('draft-no-deposit', 'admin-uid')

    const tenancySnap = await db
      .collection('tenancies')
      .doc(result.tenancyId)
      .get()
    expect(tenancySnap.data()).not.toHaveProperty('securityDeposit')
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

describe('finalizeKyc — existing-user branch (FR-TEN-07)', () => {
  beforeEach(async () => {
    await seedExistingUser('existing-uid', EXISTING_USER)
  })

  it('creates ONLY the tenancy on the existing account: no Auth account, no credentials, A7 mail, draft deleted, property occupied', async () => {
    await seedDraft('draft-existing', existingUserDraft())

    const result = await finalizeKycCore('draft-existing', 'admin-uid')

    expect(result).toEqual({
      tenancyId: expect.any(String),
      userId: 'existing-uid',
      accountCreated: false,
    })
    expect(result).not.toHaveProperty('password')
    expect(result).not.toHaveProperty('email')
    expect(result).not.toHaveProperty('uid')

    // No Auth account created — the tenant already has one.
    const users = await auth.listUsers()
    expect(users.users.length).toBe(0)

    // tenancy — tenantName/denormalizations sourced from the EXISTING user doc,
    // NOT the draft (Steps 1-3 are absent on this branch — draft.name is undefined).
    const tenancySnap = await db
      .collection('tenancies')
      .doc(result.tenancyId)
      .get()
    expect(tenancySnap.data()).toMatchObject({
      userId: 'existing-uid',
      ownerId: 'admin-uid',
      propertyId: 'prop-seed',
      tenantName: 'Maria Ionescu',
      property: { name: 'Apartament Centru' },
      status: 'active',
      currentBalance: 0,
      reportReminderDaysBefore: 3,
    })

    // property flips to occupied (FR-PROP-05), same as the new-tenant branch.
    const propertySnap = await db
      .collection('properties')
      .doc('prop-seed')
      .get()
    expect(propertySnap.data().status).toBe('occupied')

    // mail — A7 (assignment), addressed to the EXISTING user, in THEIR preferred
    // language, not any language from the (KYC-less) draft.
    const mailSnap = await db.collection('mail').get()
    expect(mailSnap.size).toBe(1)
    const mail = mailSnap.docs[0].data()
    expect(mail.to).toEqual(['maria@example.com'])
    expect(mail.message.subject).toBe(
      'Ai o nouă locuință în platformă — Apartament Centru',
    )

    // draft deleted (FR-TEN-18 applies to both branches).
    const draftSnap = await db
      .collection('onboardingDrafts')
      .doc('draft-existing')
      .get()
    expect(draftSnap.exists).toBe(false)
  })

  it('sends A7 in English when the existing account prefers English', async () => {
    await seedExistingUser('existing-uid', {
      ...EXISTING_USER,
      preferredLanguage: 'en',
    })
    await seedDraft('draft-existing-en', existingUserDraft())

    await finalizeKycCore('draft-existing-en', 'admin-uid')

    const mail = (await db.collection('mail').get()).docs[0].data()
    expect(mail.message.subject).toBe(
      'You have a new tenancy — Apartament Centru',
    )
  })

  it('does NOT check CNP on this branch — draft.cnp is absent (Steps 1-3 skipped); a CNP query on it would crash, not just skip', async () => {
    await seedDraft('draft-existing-cnp', existingUserDraft())

    // If the CNP pre-check ran unconditionally (as on the new-tenant branch), a
    // Firestore `.where('cnp', '==', undefined)` throws immediately — this proves
    // the branch skips it entirely, not merely that no conflict was found.
    await expect(
      finalizeKycCore('draft-existing-cnp', 'admin-uid'),
    ).resolves.toMatchObject({ accountCreated: false })
  })

  it('blocks when the existing account already has another active tenancy (FR-CON-02)', async () => {
    await db.collection('tenancies').add({
      userId: 'existing-uid',
      status: 'active',
      propertyId: 'some-other-property',
    })
    await seedDraft('draft-con02', existingUserDraft())

    await expect(
      finalizeKycCore('draft-con02', 'admin-uid'),
    ).rejects.toMatchObject({
      code: 'failed-precondition',
      details: { reason: 'active-tenancy' },
    })

    // Nothing new created: only the pre-seeded tenancy exists.
    const tenancies = await db.collection('tenancies').get()
    expect(tenancies.size).toBe(1)
    const draftSnap = await db
      .collection('onboardingDrafts')
      .doc('draft-con02')
      .get()
    expect(draftSnap.exists).toBe(true)
    const propertySnap = await db
      .collection('properties')
      .doc('prop-seed')
      .get()
    expect(propertySnap.data().status).toBe('free')
  })

  it('blocks when the property is already occupied, on this branch too (FR-TEN-14/23)', async () => {
    await db.collection('tenancies').add({
      propertyId: 'prop-seed',
      status: 'active',
      userId: 'someone',
    })
    await seedDraft('draft-occ-existing', existingUserDraft())

    await expect(
      finalizeKycCore('draft-occ-existing', 'admin-uid'),
    ).rejects.toMatchObject({
      code: 'failed-precondition',
      details: { reason: 'property-occupied' },
    })
  })

  it('rejects with not-found if the linked account does not exist (defensive)', async () => {
    await seedDraft(
      'draft-ghost',
      existingUserDraft({ existingUserId: 'ghost-uid' }),
    )

    await expect(
      finalizeKycCore('draft-ghost', 'admin-uid'),
    ).rejects.toMatchObject({ code: 'not-found' })
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
    ).rejects.toMatchObject({
      code: 'failed-precondition',
      details: { reason: 'property-occupied' },
    })
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
