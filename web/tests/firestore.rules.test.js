import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, describe, it } from 'vitest'
import {
  assertFails,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing'
import { doc, getDoc, setDoc } from 'firebase/firestore'

// Smoke test for the rules band (sub-stage A): it proves the harness works
// end-to-end — emulator started, firestore.rules loaded, allow/deny observable.
// It does not test a product collection.
//
// What we check: the global deny in firestore.rules ("no collection implemented
// yet"). The test is also a safety net — if someone accidentally opens the rules
// at the root, it fails here.

let testEnv

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

describe('firestore.rules — global deny', () => {
  it('denies a read by an authenticated user', async () => {
    const db = testEnv.authenticatedContext('some-user').firestore()

    await assertFails(getDoc(doc(db, 'anything/document')))
  })

  it('denies a write by an authenticated user', async () => {
    const db = testEnv.authenticatedContext('some-user').firestore()

    await assertFails(setDoc(doc(db, 'anything/document'), { field: 'value' }))
  })

  it('denies a read by an unauthenticated visitor', async () => {
    const db = testEnv.unauthenticatedContext().firestore()

    await assertFails(getDoc(doc(db, 'anything/document')))
  })
})
