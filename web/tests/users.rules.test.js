import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, describe, it } from 'vitest'
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing'
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  setDoc,
} from 'firebase/firestore'

// The `users` rule = admin-only access (SRS §7.3, NFR-SEC-02). We load the REAL
// firestore.rules, so the test checks exactly the rule that reaches production.
//
// Needed for Sub-stage C's Step 1 live email/CNP checks (FR-TEN-07, FR-TEN-22),
// which read `users` from the browser as the admin — previously only the Cloud
// Function (Admin SDK, bypasses rules) had ever touched this collection.

let testEnv

const USER = {
  name: 'Ion Popescu',
  email: 'ion@example.com',
  cnp: '1900101123456',
  role: 'tenant',
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

describe('firestore.rules — users: admin only', () => {
  it('denies a read by an unauthenticated visitor', async () => {
    const db = testEnv.unauthenticatedContext().firestore()

    await assertFails(getDoc(doc(db, 'users/user-1')))
  })

  it('denies a write by an unauthenticated visitor', async () => {
    const db = testEnv.unauthenticatedContext().firestore()

    await assertFails(setDoc(doc(db, 'users/user-1'), USER))
  })

  it('denies a read by an authenticated user without the admin claim', async () => {
    const db = testEnv.authenticatedContext('tenant-1').firestore()

    await assertFails(getDoc(doc(db, 'users/user-1')))
  })

  it('denies a write by an authenticated user without the admin claim', async () => {
    const db = testEnv.authenticatedContext('tenant-1').firestore()

    await assertFails(setDoc(doc(db, 'users/user-1'), USER))
  })

  it('denies a read by the tenant reading their OWN user document', async () => {
    // Strictly admin-only (NFR-SEC-02): even a tenant's own record is out of reach
    // through this collection — they only see denormalized data in `tenancies` and
    // their own published `monthlyReports` (CLAUDE.md §7).
    const db = testEnv.authenticatedContext('user-1').firestore()

    await assertFails(getDoc(doc(db, 'users/user-1')))
  })

  it('denies a read by a user with a false admin claim', async () => {
    const db = testEnv
      .authenticatedContext('impostor-1', { admin: false })
      .firestore()

    await assertFails(getDoc(doc(db, 'users/user-1')))
  })

  it('denies querying (where email/cnp ==) to a non-admin', async () => {
    const db = testEnv.authenticatedContext('tenant-1').firestore()

    await assertFails(getDocs(collection(db, 'users')))
  })

  it('allows the full CRUD to the admin (claim admin:true)', async () => {
    const db = testEnv
      .authenticatedContext('admin-1', { admin: true })
      .firestore()

    // create
    await assertSucceeds(setDoc(doc(db, 'users/user-1'), USER))
    // read
    await assertSucceeds(getDoc(doc(db, 'users/user-1')))
    // list/query — the live email/CNP checks (Sub-stage C)
    await assertSucceeds(getDocs(collection(db, 'users')))
    // update
    await assertSucceeds(setDoc(doc(db, 'users/user-1'), { name: 'Ion P.' }))
    // delete
    await assertSucceeds(deleteDoc(doc(db, 'users/user-1')))
  })
})
