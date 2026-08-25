import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getFirestore } from 'firebase-admin/firestore'
import { getAuth } from 'firebase-admin/auth'
import { getStorage } from 'firebase-admin/storage'
import {
  finalizeKycCore,
  finalizeKycHandler,
  STORAGE_BUCKET,
} from '../src/kyc.js'
import { buildDownloadUrl } from '../src/photoMigration.js'

// Functions tests — the REAL boundary (Auth + Firestore + Storage emulators), no
// mocks of the data layer. Started via `npm run test:emulator` (firebase
// emulators:exec), which sets the emulator hosts + project id, so the Admin SDK
// (initialized on requiring kyc.js) talks to the emulators.

const PROJECT_ID = 'tenants-manager-2026'
const db = getFirestore()
const auth = getAuth()
// EXPLICITLY the same bucket kyc.js itself uses (STORAGE_BUCKET,
// `{project}.firebasestorage.app` — the project's real bucket, the one the
// client actually uploads to; see kyc.js:54-76). A bare `getStorage().bucket()`
// here would resolve whatever the Admin SDK's ambient default happens to be
// under `emulators:exec` (`{project}.appspot.com`, a DIFFERENT, never-
// provisioned bucket) — a mismatch that would surface exactly like the live
// "No such object" bug did before the fix, just against the other bucket
// name. Pinning to STORAGE_BUCKET here is what makes these tests actually
// exercise the bucket kyc.js operates on in reality.
const bucket = getStorage().bucket(STORAGE_BUCKET)

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
      {
        path: 'drafts/placeholder-draft/1.jpg',
        name: 'front.jpg',
        type: 'image',
      },
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
    paymentReminderDaysBefore: 3,
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
    paymentReminderDaysBefore: 3,
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
  // Storage has no bulk-clear REST endpoint like Firestore/Auth — clear it by
  // deleting every object under the two prefixes finalizeKyc touches.
  const [draftFiles] = await bucket.getFiles({ prefix: 'drafts/' })
  const [userFiles] = await bucket.getFiles({ prefix: 'users/' })
  await Promise.all(
    [...draftFiles, ...userFiles].map((f) => f.delete().catch(() => {})),
  )
}

async function seedDraft(id, data) {
  await db.collection('onboardingDrafts').doc(id).set(data)
}

async function seedExistingUser(id, data) {
  await db.collection('users').doc(id).set(data)
}

/**
 * Seeds a REAL Storage object for a draft's ID photo (M3): `completeDraft()`'s
 * default fixture used to carry a fake `gs://bucket/1.jpg` URL, harmless back
 * when finalizeKyc never touched Storage. Now that it copies the underlying
 * object (photoMigration.js), any test that reaches that step needs a source
 * that actually exists in the Storage emulator.
 */
async function seedDraftPhoto(draftId, filename = 'front.jpg') {
  const path = `drafts/${draftId}/${filename}`
  await bucket.file(path).save(Buffer.from('fake-photo-bytes'), {
    metadata: { firebaseStorageDownloadTokens: 'test-token' },
  })
  return { path, name: filename, type: 'image' }
}

// finalizeNewTenant does not return the fresh token copyPhotosToUser issues
// at the destination (debt #5: never persisted — only derived at display
// time via getDownloadURL()). Reading it back from the migrated object's own
// metadata lets a test still prove the copy is actually web-servable.
async function readDownloadToken(path) {
  const [metadata] = await bucket.file(path).getMetadata()
  return metadata.metadata.firebaseStorageDownloadTokens
}

/** `completeDraft()` + a real seeded photo, seeded as a draft under `draftId`.
 * Returns the photo reference so a test can assert against its filename. */
async function seedCompleteDraft(draftId, overrides = {}) {
  const photo = await seedDraftPhoto(draftId)
  await seedDraft(
    draftId,
    completeDraft({ idDocumentPhotos: [photo], ...overrides }),
  )
  return photo
}

beforeEach(async () => {
  vi.restoreAllMocks()
  await clearEmulators()
  await db.collection('properties').doc('prop-seed').set(PROPERTY)
})

describe('finalizeKyc — happy path (FR-TEN-16/18)', () => {
  it('creates the account, writes users + tenancies + mail, deletes the draft', async () => {
    await seedCompleteDraft('draft-1')

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
      paymentReminderDaysBefore: 3,
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

  it('migrates the ID photo physically to Storage /users/ and cleans up /drafts/ (M3, SRS §6)', async () => {
    await seedCompleteDraft('draft-1')

    const result = await finalizeKycCore('draft-1', 'admin-uid')

    const userSnap = await db.collection('users').doc(result.uid).get()
    const [photo] = userSnap.data().idDocumentPhotos
    const newPath = photo.path
    expect(newPath).toBe(`users/${result.uid}/documents/front.jpg`)

    // Physically present at the NEW path, with the original bytes.
    const [existsAtNewPath] = await bucket.file(newPath).exists()
    expect(existsAtNewPath).toBe(true)
    const [bytes] = await bucket.file(newPath).download()
    expect(bytes.toString()).toBe('fake-photo-bytes')

    // The /drafts/ original is gone (best-effort cleanup after commit).
    const [existsAtOldPath] = await bucket
      .file('drafts/draft-1/front.jpg')
      .exists()
    expect(existsAtOldPath).toBe(false)

    // The strongest proof, end-to-end: the path now stored on `users`, with
    // its freshly-issued token, resolves to a URL that is actually fetchable
    // and serves the migrated bytes — what the Profile tab's <img src>
    // (via getDownloadURL() at render time) and Bogdan's browser validation
    // both rely on. The URL itself is never persisted (debt #5), so it's
    // derived here the same way the client derives it.
    const token = await readDownloadToken(newPath)
    const url = buildDownloadUrl(bucket.name, newPath, token)
    const response = await fetch(url)
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('fake-photo-bytes')
  })

  // REGRESSION — the exact live bug caught in browser validation (M3).
  // `getStorage().bucket()` with NO argument resolves the Admin SDK's OWN
  // ambient default bucket, which is CONTEXT-DEPENDENT (see kyc.js:54-76) —
  // a DIFFERENT bucket than the one the client is actually configured to
  // upload to (VITE_FIREBASE_STORAGE_BUCKET = STORAGE_BUCKET in kyc.js =
  // `{project}.firebasestorage.app`, the project's real bucket). A copy
  // reading through the wrong default 404s ("No such object"), which
  // surfaced to the admin as an opaque "INTERNAL" error — the draft-photo's
  // SOURCE object genuinely does not exist in the bucket the code was
  // looking in. See kyc.bucketMismatch.test.js for the isolated test that
  // actually forces the ambient default to diverge and proves this fails
  // without the explicit reference.
  //
  // Also reproduces the real filename shape: `idDocumentPhotos[].name` is the
  // ORIGINAL upload filename ("11d21da1-....jpg"), while the Storage OBJECT
  // itself is "{uploadUUID}-{originalName}" (PhotoCapture.jsx's naming
  // convention, functions/../web/src/features/onboarding/components/
  // PhotoCapture.jsx:80) — migration must derive the destination basename
  // from `photo.path` (the object's actual location), never from `name`.
  //
  // Seeds EXPLICITLY into STORAGE_BUCKET (the real client bucket) regardless
  // of whatever the Admin SDK's ambient default happens to be — this is what
  // makes this test exercise the SAME bucket kyc.js actually operates on,
  // rather than whatever `emulators:exec`'s wrapper process happens to
  // default to.
  it('REGRESSION: migrates a photo from the real client Storage bucket, not the Admin SDK default', async () => {
    const draftId = 's0x7wMK0eYFcJYkAoiKQ'
    const originalName = '11d21da1-15f7-40df-ac4d-4be53b8eccfb.jpg'
    const storageObjectName = `ebba8fc2-4ffc-44a0-9763-6c5f090a7a88-${originalName}`
    const sourcePath = `drafts/${draftId}/${storageObjectName}`

    await bucket.file(sourcePath).save(Buffer.from('real-photo-bytes'), {
      metadata: { firebaseStorageDownloadTokens: 'seed-token' },
    })
    const photo = {
      path: sourcePath,
      name: originalName,
      type: 'image',
    }
    await seedDraft(draftId, completeDraft({ idDocumentPhotos: [photo] }))

    const result = await finalizeKycCore(draftId, 'admin-uid')

    const userSnap = await db.collection('users').doc(result.uid).get()
    const [migratedPhoto] = userSnap.data().idDocumentPhotos
    const newPath = migratedPhoto.path
    expect(newPath).toBe(`users/${result.uid}/documents/${storageObjectName}`)

    const [existsAtNewPath] = await bucket.file(newPath).exists()
    expect(existsAtNewPath).toBe(true)
    const token = await readDownloadToken(newPath)
    const url = buildDownloadUrl(STORAGE_BUCKET, newPath, token)
    const response = await fetch(url)
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('real-photo-bytes')
  })

  it('omits securityDeposit from the tenancy doc when absent from the draft (optional, FR-CON-01) — no crash on a numeric field', async () => {
    const photo = await seedDraftPhoto('draft-no-deposit')
    const { securityDeposit, ...draftWithoutDeposit } = completeDraft({
      idDocumentPhotos: [photo],
    })
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
    await seedCompleteDraft('draft-1')

    const result = await finalizeKycCore('draft-1', 'admin-uid')

    expect(result.email).toBe('ion@example.com')
    expect(result.password).toEqual(expect.any(String))
    // Exactly 12 (the FR-AUTH-06 minimum). `=== 12`, not `>= 12`, so a change to the
    // generator's length is caught rather than silently passing.
    expect(result.password.length).toBe(12)
  })

  it('writes the credentials email in the tenant preferred language (NFR-LOC-04)', async () => {
    await seedCompleteDraft('draft-ro', { preferredLanguage: 'ro' })
    await finalizeKycCore('draft-ro', 'admin-uid')
    let mail = (await db.collection('mail').get()).docs[0].data()
    expect(mail.message.subject).toBe('Contul tău de chiriaș a fost creat')

    await clearEmulators()
    await db.collection('properties').doc('prop-seed').set(PROPERTY)
    await seedCompleteDraft('draft-en', {
      preferredLanguage: 'en',
      email: 'jane@example.com',
    })
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
      paymentReminderDaysBefore: 3,
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
    await seedCompleteDraft('draft-occ')

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
    await seedCompleteDraft('draft-1')

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

  // M3: the transaction fails AFTER the photo was already copied to /users/.
  // Anti-vacuity — remove the Storage cleanup from kyc.js's catch block and
  // this test fails on the first assertion (the /users/ copy survives).
  it('cleans up the copied /users/ photo and leaves the /drafts/ original intact when the transaction fails', async () => {
    await seedCompleteDraft('draft-1')

    vi.spyOn(db, 'runTransaction').mockRejectedValueOnce(
      new Error('simulated Firestore failure'),
    )

    await expect(finalizeKycCore('draft-1', 'admin-uid')).rejects.toThrow(
      'simulated Firestore failure',
    )

    // No orphan Auth account (existing guarantee, re-confirmed here).
    const users = await auth.listUsers()
    expect(users.users.length).toBe(0)

    // The /drafts/ original SURVIVES — nothing was deleted before commit, so
    // the draft (still present, per the test above) stays fully resumable.
    const [originalExists] = await bucket
      .file('drafts/draft-1/front.jpg')
      .exists()
    expect(originalExists).toBe(true)

    // No /users/{anyUid}/documents/ leftover from the aborted attempt — the
    // uid is unknown here (the created account was deleted), so check the
    // whole users/ prefix is empty rather than a specific path.
    const [userFiles] = await bucket.getFiles({ prefix: 'users/' })
    expect(userFiles.length).toBe(0)
  })
})
