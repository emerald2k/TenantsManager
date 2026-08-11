import { beforeAll, describe, expect, it } from 'vitest'
import { getFirestore } from 'firebase-admin/firestore'
import { getStorage } from 'firebase-admin/storage'

const PROJECT_ID = 'tenants-manager-2026'

/**
 * Isolated GUARD for the must-match discipline documented at kyc.js:54-76:
 * `STORAGE_BUCKET` (= VITE_FIREBASE_STORAGE_BUCKET = `{project}.firebasestorage.app`,
 * the project's real bucket) must NEVER be inferred from `getStorage().bucket()`
 * with no argument, because that call's ambient default is CONTEXT-DEPENDENT — a
 * live diagBucket call against a real `firebase emulators:start` instance proved
 * it resolves `{project}.firebasestorage.app` there (which happens to match
 * STORAGE_BUCKET today), but `firebase emulators:exec`'s wrapper-script process
 * (what every other test file in this suite runs under) resolves the OTHER,
 * never-provisioned bucket, `{project}.appspot.com`. This file fakes THAT
 * divergent ambient — via FIREBASE_CONFIG, set BEFORE dynamically importing
 * kyc.js so `initializeApp()` (called at kyc.js module-load time) bakes it in —
 * and proves migration still finds the client's photo, because the reference is
 * explicit, never inferred. If the two values (client/Functions) were ever
 * allowed to diverge for real, this is the test that would catch it: it is the
 * regression guard for the exact "INTERNAL" bug Bogdan hit in browser
 * validation. Vitest isolates modules per test file by default, so this
 * override cannot leak into any other test file's app instance.
 */
describe('finalizeKyc — bucket resolution under the real Functions ambient default (M3 regression)', () => {
  let finalizeKycCore, STORAGE_BUCKET, bucket, db

  beforeAll(async () => {
    process.env.FIREBASE_CONFIG = JSON.stringify({
      projectId: PROJECT_ID,
      // The other, never-provisioned bucket — what emulators:exec's wrapper
      // process actually resolves ambiently (not the project's real bucket).
      storageBucket: `${PROJECT_ID}.appspot.com`,
    })

    const kyc = await import('../src/kyc.js')
    finalizeKycCore = kyc.finalizeKycCore
    STORAGE_BUCKET = kyc.STORAGE_BUCKET

    db = getFirestore()
    bucket = getStorage().bucket(STORAGE_BUCKET)

    // Sanity check: the ambient default really IS the wrong bucket here — if
    // this ever fails, the rest of the test proves nothing.
    expect(getStorage().bucket().name).not.toBe(STORAGE_BUCKET)
  })

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
    const [draftFiles] = await bucket.getFiles({ prefix: 'drafts/' })
    const [userFiles] = await bucket.getFiles({ prefix: 'users/' })
    await Promise.all(
      [...draftFiles, ...userFiles].map((f) => f.delete().catch(() => {})),
    )
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
      idDocumentPhotos: [],
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

  it('copies the photo from the bucket the client actually uploaded to, not the Admin SDK default', async () => {
    await clearEmulators()
    await db.collection('properties').doc('prop-seed').set(PROPERTY)

    // Seed the source photo into STORAGE_BUCKET explicitly — the real client
    // bucket — regardless of whatever the Admin SDK's ambient default (just
    // set to the WRONG bucket above) resolves to.
    const draftId = 'draft-bucket-mismatch'
    const path = `drafts/${draftId}/front.jpg`
    await bucket.file(path).save(Buffer.from('real-photo-bytes'), {
      metadata: { firebaseStorageDownloadTokens: 'test-token' },
    })
    const photo = { path, name: 'front.jpg', type: 'image' }
    await db
      .collection('onboardingDrafts')
      .doc(draftId)
      .set(completeDraft({ idDocumentPhotos: [photo] }))

    // On a hypothetical no-arg `getStorage().bucket()` call, this would look
    // for the source object in `{project}.appspot.com` (the faked ambient
    // above) — where it does NOT exist — and throw (the real "INTERNAL"
    // error Bogdan saw). The explicit `getStorage().bucket(STORAGE_BUCKET)`
    // in kyc.js finds it and succeeds regardless of the ambient default.
    const result = await finalizeKycCore(draftId, 'admin-uid')

    const userSnap = await db.collection('users').doc(result.uid).get()
    const [migratedPhoto] = userSnap.data().idDocumentPhotos
    const newPath = migratedPhoto.path
    expect(newPath).toBe(`users/${result.uid}/documents/front.jpg`)

    const [existsAtNewPath] = await bucket.file(newPath).exists()
    expect(existsAtNewPath).toBe(true)
  })
})
