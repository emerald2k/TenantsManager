import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, describe, it } from 'vitest'
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing'
import { doc, getDoc, setDoc } from 'firebase/firestore'

// The `properties` rule = admin-only access (SRS §7.3, NFR-SEC-02).
// We load the REAL firestore.rules (not an inline copy), so the test checks
// exactly the rule that reaches production.
//
// The admin is identified through a custom claim: the second argument of
// `authenticatedContext` is the token payload, so `{ admin: true }` is exactly
// what `request.auth.token.admin` reads in the rule (NFR-SEC-09).

let testEnv

const PROPERTY = {
  name: 'Downtown Apartment',
  address: {
    street: 'Mihai Viteazu',
    number: '10',
    city: 'Cluj',
    county: 'Cluj',
  },
  archived: false,
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

describe('firestore.rules — properties: admin only', () => {
  it('denies a read by an unauthenticated visitor', async () => {
    const db = testEnv.unauthenticatedContext().firestore()

    await assertFails(getDoc(doc(db, 'properties/prop-1')))
  })

  it('denies a write by an unauthenticated visitor', async () => {
    const db = testEnv.unauthenticatedContext().firestore()

    await assertFails(setDoc(doc(db, 'properties/prop-1'), PROPERTY))
  })

  it('denies a read by an authenticated user without the admin claim', async () => {
    const db = testEnv.authenticatedContext('tenant-1').firestore()

    await assertFails(getDoc(doc(db, 'properties/prop-1')))
  })

  it('denies a write by an authenticated user without the admin claim', async () => {
    const db = testEnv.authenticatedContext('tenant-1').firestore()

    await assertFails(setDoc(doc(db, 'properties/prop-1'), PROPERTY))
  })

  it('denies a read by a user with a false admin claim', async () => {
    const db = testEnv
      .authenticatedContext('impostor-1', { admin: false })
      .firestore()

    await assertFails(getDoc(doc(db, 'properties/prop-1')))
  })

  it('allows a read by the admin (claim admin:true)', async () => {
    const db = testEnv
      .authenticatedContext('admin-1', { admin: true })
      .firestore()

    await assertSucceeds(getDoc(doc(db, 'properties/prop-1')))
  })

  it('allows a write by the admin (claim admin:true)', async () => {
    const db = testEnv
      .authenticatedContext('admin-1', { admin: true })
      .firestore()

    await assertSucceeds(setDoc(doc(db, 'properties/prop-1'), PROPERTY))
  })
})
