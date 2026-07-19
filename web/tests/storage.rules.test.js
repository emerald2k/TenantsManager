import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, describe, it } from 'vitest'
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing'
import { deleteObject, getBytes, ref, uploadBytes } from 'firebase/storage'

// /drafts/{draftId}/** = admin-only access (SRS §6: "/drafts/{draftId}/* — admin
// only"). We load the REAL storage.rules, so the test checks exactly the rule that
// reaches production. Same admin-identification convention as firestore.rules: a
// custom claim (`{ admin: true }` on the token — NFR-SEC-09).

let testEnv

const PATH = 'drafts/draft-1/photo.jpg'
const BYTES = new Uint8Array([1, 2, 3])

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'tenants-manager-2026',
    storage: {
      rules: readFileSync(
        path.resolve(process.cwd(), '../storage.rules'),
        'utf8',
      ),
    },
  })
})

afterAll(async () => {
  await testEnv?.cleanup()
})

// Seeds the object, bypassing rules — needed before a read/delete assertion, since
// those need something to exist first.
async function seed() {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await uploadBytes(ref(context.storage(), PATH), BYTES)
  })
}

describe('storage.rules — /drafts/{draftId}/**: admin only', () => {
  it('denies an upload by an unauthenticated visitor', async () => {
    const storage = testEnv.unauthenticatedContext().storage()

    await assertFails(uploadBytes(ref(storage, PATH), BYTES))
  })

  it('denies a read by an unauthenticated visitor', async () => {
    await seed()
    const storage = testEnv.unauthenticatedContext().storage()

    await assertFails(getBytes(ref(storage, PATH)))
  })

  it('denies a delete by an unauthenticated visitor', async () => {
    await seed()
    const storage = testEnv.unauthenticatedContext().storage()

    await assertFails(deleteObject(ref(storage, PATH)))
  })

  it('denies an upload by an authenticated user without the admin claim', async () => {
    const storage = testEnv.authenticatedContext('tenant-1').storage()

    await assertFails(uploadBytes(ref(storage, PATH), BYTES))
  })

  it('denies a read by an authenticated user without the admin claim', async () => {
    await seed()
    const storage = testEnv.authenticatedContext('tenant-1').storage()

    await assertFails(getBytes(ref(storage, PATH)))
  })

  it('denies a delete by an authenticated user without the admin claim', async () => {
    await seed()
    const storage = testEnv.authenticatedContext('tenant-1').storage()

    await assertFails(deleteObject(ref(storage, PATH)))
  })

  it('denies an upload by a user with a false admin claim', async () => {
    const storage = testEnv
      .authenticatedContext('impostor-1', { admin: false })
      .storage()

    await assertFails(uploadBytes(ref(storage, PATH), BYTES))
  })

  it('allows the admin to upload', async () => {
    const storage = testEnv
      .authenticatedContext('admin-1', { admin: true })
      .storage()

    await assertSucceeds(uploadBytes(ref(storage, PATH), BYTES))
  })

  it('allows the admin to read', async () => {
    await seed()
    const storage = testEnv
      .authenticatedContext('admin-1', { admin: true })
      .storage()

    await assertSucceeds(getBytes(ref(storage, PATH)))
  })

  it('allows the admin to delete', async () => {
    await seed()
    const storage = testEnv
      .authenticatedContext('admin-1', { admin: true })
      .storage()

    await assertSucceeds(deleteObject(ref(storage, PATH)))
  })
})
