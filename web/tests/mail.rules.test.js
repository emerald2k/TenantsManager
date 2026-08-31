import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, describe, it } from 'vitest'
import {
  assertFails,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing'
import { doc, getDoc, setDoc } from 'firebase/firestore'

// mail — Cloud Functions only, NO client access, admin included (SRS §6,
// NFR-SEC-02). `message.text` holds the fully rendered body, and Appendix A1
// interpolates the generated password IN CLEAR TEXT — granting even admin
// reads would make every password ever sent permanently readable from a
// browser session. Before M8 this collection had no rule of its own: it was
// closed only by the catch-all (`match /{document=**}`), which CLAUDE.md §7
// notes cannot be pointed at, grepped for, or relaxed in isolation for an
// anti-vacuity check without relaxing every unimplemented collection at once.
// This file exists because the collection now has its own explicit match block.
//
// Anti-vacuity (CLAUDE.md §7), run by hand: with the block temporarily
// relaxed to `allow read, write: if isAdmin();`, both admin tests below
// (which currently assert denial) succeeded instead of failing — proving the
// rule is actually doing something. Restored to `if false` afterward.

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

async function seed() {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'mail', 'mail-1'), {
      to: ['tenant@example.com'],
      message: {
        subject: 'Contul tău de chiriaș a fost creat',
        text: 'Parolă: hunter2',
      },
      type: 'credentials',
      audience: 'tenant',
    })
  })
}

describe('firestore.rules — mail: closed to every client, admin included', () => {
  it('denies an admin read', async () => {
    await seed()
    const db = testEnv
      .authenticatedContext('admin-1', { admin: true })
      .firestore()

    await assertFails(getDoc(doc(db, 'mail', 'mail-1')))
  })

  it('denies an admin write', async () => {
    const db = testEnv
      .authenticatedContext('admin-1', { admin: true })
      .firestore()

    await assertFails(
      setDoc(doc(db, 'mail', 'mail-1'), {
        to: ['x@example.com'],
        message: { subject: 's', text: 't' },
      }),
    )
  })

  it('denies a read by an authenticated non-admin', async () => {
    await seed()
    const db = testEnv.authenticatedContext('tenant-1').firestore()

    await assertFails(getDoc(doc(db, 'mail', 'mail-1')))
  })

  it('denies a write by an authenticated non-admin', async () => {
    const db = testEnv.authenticatedContext('tenant-1').firestore()

    await assertFails(
      setDoc(doc(db, 'mail', 'mail-1'), {
        to: ['x@example.com'],
        message: { subject: 's', text: 't' },
      }),
    )
  })

  it('denies a read by an unauthenticated visitor', async () => {
    await seed()
    const db = testEnv.unauthenticatedContext().firestore()

    await assertFails(getDoc(doc(db, 'mail', 'mail-1')))
  })

  it('denies a write by an unauthenticated visitor', async () => {
    const db = testEnv.unauthenticatedContext().firestore()

    await assertFails(
      setDoc(doc(db, 'mail', 'mail-1'), {
        to: ['x@example.com'],
        message: { subject: 's', text: 't' },
      }),
    )
  })
})
