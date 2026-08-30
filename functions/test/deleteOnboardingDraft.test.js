import { beforeEach, describe, expect, it } from 'vitest'
import { getFirestore } from 'firebase-admin/firestore'
import { getStorage } from 'firebase-admin/storage'
import {
  deleteOnboardingDraftCore,
  deleteOnboardingDraftHandler,
} from '../src/deleteOnboardingDraft.js'
// kyc.js calls initializeApp() at module load — importing it here piggybacks
// on that, same as kyc.test.js. STORAGE_BUCKET is the real client bucket
// (CLAUDE.md §7), the one the function itself operates on.
import { STORAGE_BUCKET } from '../src/kyc.js'

// Functions test — the REAL boundary (Firestore + Storage emulators), no mocks
// of the data layer. Started via `npm run test:emulator`
// (--only auth,firestore,storage).

const PROJECT_ID = 'tenants-manager-2026'
const db = getFirestore()
const bucket = getStorage().bucket(STORAGE_BUCKET)

async function clearEmulators() {
  const fsHost = process.env.FIRESTORE_EMULATOR_HOST
  await fetch(
    `http://${fsHost}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`,
    { method: 'DELETE' },
  )
  const [files] = await bucket.getFiles({ prefix: 'drafts/' })
  await Promise.all(files.map((f) => f.delete().catch(() => {})))
}

async function seedDraftDoc(id) {
  await db
    .collection('onboardingDrafts')
    .doc(id)
    .set({ status: 'in_progress', currentStep: 3, name: 'Andrei Draftescu' })
}

async function seedDraftPhoto(draftId, filename) {
  const path = `drafts/${draftId}/${filename}`
  await bucket
    .file(path)
    .save(Buffer.from(`bytes-${filename}`), { contentType: 'image/jpeg' })
  return path
}

async function prefixIsEmpty(prefix) {
  const [files] = await bucket.getFiles({ prefix })
  return files.length === 0
}

beforeEach(async () => {
  await clearEmulators()
})

describe('deleteOnboardingDraft — FR-TEN-25 (document AND Storage prefix)', () => {
  it('removes the document AND every object under drafts/{draftId}/ — multi-file (tenant + guarantor photos)', async () => {
    await seedDraftDoc('draft-multi')
    await seedDraftPhoto('draft-multi', 'tenant-ci-front.jpg')
    await seedDraftPhoto('draft-multi', 'tenant-ci-back.jpg')
    await seedDraftPhoto('draft-multi', 'guarantor-ci.jpg')

    // Precondition: the three objects really are there, so the assertion below
    // is not vacuous on an already-empty prefix.
    expect(await prefixIsEmpty('drafts/draft-multi/')).toBe(false)

    const result = await deleteOnboardingDraftCore('draft-multi')
    expect(result).toEqual({ deleted: true })

    // The document is gone.
    const snap = await db
      .collection('onboardingDrafts')
      .doc('draft-multi')
      .get()
    expect(snap.exists).toBe(false)

    // The PREFIX is gone — not just "the call returned". A cleanup that
    // deleted only the first match would leave two objects here.
    expect(await prefixIsEmpty('drafts/draft-multi/')).toBe(true)
  })

  it('touches only its own prefix — a sibling draft is untouched', async () => {
    await seedDraftDoc('draft-a')
    await seedDraftPhoto('draft-a', 'front.jpg')
    await seedDraftDoc('draft-b')
    const bPhoto = await seedDraftPhoto('draft-b', 'front.jpg')

    await deleteOnboardingDraftCore('draft-a')

    const [bExists] = await bucket.file(bPhoto).exists()
    expect(bExists).toBe(true)
    const bDoc = await db.collection('onboardingDrafts').doc('draft-b').get()
    expect(bDoc.exists).toBe(true)
  })

  it('succeeds on a draft that has no photos yet (idempotent empty-prefix delete)', async () => {
    await seedDraftDoc('draft-nophotos')

    const result = await deleteOnboardingDraftCore('draft-nophotos')
    expect(result).toEqual({ deleted: true })
    const snap = await db
      .collection('onboardingDrafts')
      .doc('draft-nophotos')
      .get()
    expect(snap.exists).toBe(false)
  })

  it('rejects with not-found when the draft does not exist', async () => {
    await expect(
      deleteOnboardingDraftCore('no-such-draft'),
    ).rejects.toMatchObject({ code: 'not-found' })
  })
})

describe('deleteOnboardingDraft — handler auth', () => {
  it('rejects a non-admin caller with permission-denied', async () => {
    await expect(
      deleteOnboardingDraftHandler({
        auth: { uid: 'u1', token: {} },
        data: { draftId: 'draft-multi' },
      }),
    ).rejects.toMatchObject({ code: 'permission-denied' })
  })

  it('rejects a missing draftId with invalid-argument', async () => {
    await expect(
      deleteOnboardingDraftHandler({
        auth: { uid: 'admin', token: { admin: true } },
        data: {},
      }),
    ).rejects.toMatchObject({ code: 'invalid-argument' })
  })

  it('admin caller deletes through the handler', async () => {
    await seedDraftDoc('draft-h')
    await seedDraftPhoto('draft-h', 'front.jpg')

    await deleteOnboardingDraftHandler({
      auth: { uid: 'admin', token: { admin: true } },
      data: { draftId: 'draft-h' },
    })

    const snap = await db.collection('onboardingDrafts').doc('draft-h').get()
    expect(snap.exists).toBe(false)
    expect(await prefixIsEmpty('drafts/draft-h/')).toBe(true)
  })
})
