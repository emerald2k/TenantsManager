import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, describe, it } from 'vitest'
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing'
import { deleteDoc, doc, getDoc, getDocs, setDoc } from 'firebase/firestore'
import { collection } from 'firebase/firestore'

// The `onboardingDrafts` rule = admin-only access (SRS §6, NFR-SEC-02). We load the
// REAL firestore.rules, so the test checks exactly the rule that reaches production.
//
// The admin is identified through a custom claim: the second argument of
// `authenticatedContext` is the token payload, so `{ admin: true }` is what
// `request.auth.token.admin` reads in the rule (NFR-SEC-09).

let testEnv

const DRAFT = {
  status: 'in_progress',
  currentStep: 1,
  name: 'Ion Popescu',
}

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'tenants-manager-2026',
    firestore: {
      rules: readFileSync(
        path.resolve(process.cwd(), '../firestore.rules'),
        'utf8',
      ),
    },
  })
})

afterAll(async () => {
  await testEnv?.cleanup()
})

describe('firestore.rules — onboardingDrafts: admin only', () => {
  it('denies a read by an unauthenticated visitor', async () => {
    const db = testEnv.unauthenticatedContext().firestore()

    await assertFails(getDoc(doc(db, 'onboardingDrafts/draft-1')))
  })

  it('denies a write by an unauthenticated visitor', async () => {
    const db = testEnv.unauthenticatedContext().firestore()

    await assertFails(setDoc(doc(db, 'onboardingDrafts/draft-1'), DRAFT))
  })

  it('denies a read by an authenticated user without the admin claim', async () => {
    const db = testEnv.authenticatedContext('tenant-1').firestore()

    await assertFails(getDoc(doc(db, 'onboardingDrafts/draft-1')))
  })

  it('denies a write by an authenticated user without the admin claim', async () => {
    const db = testEnv.authenticatedContext('tenant-1').firestore()

    await assertFails(setDoc(doc(db, 'onboardingDrafts/draft-1'), DRAFT))
  })

  it('denies a read by a user with a false admin claim', async () => {
    const db = testEnv
      .authenticatedContext('impostor-1', { admin: false })
      .firestore()

    await assertFails(getDoc(doc(db, 'onboardingDrafts/draft-1')))
  })

  it('denies listing the drafts to a non-admin', async () => {
    const db = testEnv.authenticatedContext('tenant-1').firestore()

    await assertFails(getDocs(collection(db, 'onboardingDrafts')))
  })

  it('allows the full CRUD to the admin (claim admin:true)', async () => {
    const db = testEnv
      .authenticatedContext('admin-1', { admin: true })
      .firestore()

    // create
    await assertSucceeds(setDoc(doc(db, 'onboardingDrafts/draft-1'), DRAFT))
    // read
    await assertSucceeds(getDoc(doc(db, 'onboardingDrafts/draft-1')))
    // list
    await assertSucceeds(getDocs(collection(db, 'onboardingDrafts')))
    // update
    await assertSucceeds(
      setDoc(doc(db, 'onboardingDrafts/draft-1'), { currentStep: 2 }),
    )
    // delete
    await assertSucceeds(deleteDoc(doc(db, 'onboardingDrafts/draft-1')))
  })
})
