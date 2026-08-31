import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, describe, it } from 'vitest'
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing'
import { doc, getDoc, setDoc } from 'firebase/firestore'

// notifications — admin-read, server-write (NFR-SEC-10, FR-NLOG-01…08).
// There is deliberately NO `allow write` clause in firestore.rules for this
// collection — not for the admin, not for anyone. "Cloud Functions write
// only" names a principal that does not exist: the Admin SDK (onMailWrite,
// §7.2) bypasses Security Rules entirely, so the ABSENCE of a write rule IS
// the server-write guarantee. The wrong version of this rule — the one that
// looks like every other block in the file — is `allow write: if isAdmin();`,
// which would hand the browser a write path the requirement explicitly
// forbids. That is exactly what "denies an admin write" below exists to catch.
//
// Anti-vacuity (CLAUDE.md §7), run by hand: with `allow write: if isAdmin();`
// temporarily added, "denies an admin write" (which asserts denial) instead
// succeeded — proving the missing clause is load-bearing. Removed afterward.

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
    await setDoc(doc(context.firestore(), 'notifications', 'mail-1'), {
      mailId: 'mail-1',
      type: 'credentials',
      audience: 'tenant',
      subject: 'Contul tău de chiriaș a fost creat',
      to: ['tenant@example.com'],
      sentAt: new Date(),
      deliveryState: 'SUCCESS',
      deliveryError: null,
      relatedId: 'tenancy-1',
      ownerId: 'admin-uid',
    })
  })
}

describe('firestore.rules — notifications: admin-read, server-write only', () => {
  it('allows an admin read', async () => {
    await seed()
    const db = testEnv
      .authenticatedContext('admin-1', { admin: true })
      .firestore()

    await assertSucceeds(getDoc(doc(db, 'notifications', 'mail-1')))
  })

  it('denies an admin write (no client write path exists at all — NFR-SEC-10)', async () => {
    const db = testEnv
      .authenticatedContext('admin-1', { admin: true })
      .firestore()

    await assertFails(
      setDoc(doc(db, 'notifications', 'mail-1'), {
        mailId: 'mail-1',
        type: 'credentials',
        audience: 'tenant',
        subject: 'forged',
        to: ['x@example.com'],
      }),
    )
  })

  it('denies a read by an authenticated non-admin', async () => {
    await seed()
    const db = testEnv.authenticatedContext('tenant-1').firestore()

    await assertFails(getDoc(doc(db, 'notifications', 'mail-1')))
  })

  it('denies a write by an authenticated non-admin', async () => {
    const db = testEnv.authenticatedContext('tenant-1').firestore()

    await assertFails(
      setDoc(doc(db, 'notifications', 'mail-1'), {
        mailId: 'mail-1',
        type: 'credentials',
        audience: 'tenant',
        subject: 'forged',
        to: ['x@example.com'],
      }),
    )
  })

  it('denies a read by an unauthenticated visitor', async () => {
    await seed()
    const db = testEnv.unauthenticatedContext().firestore()

    await assertFails(getDoc(doc(db, 'notifications', 'mail-1')))
  })

  it('denies a write by an unauthenticated visitor', async () => {
    const db = testEnv.unauthenticatedContext().firestore()

    await assertFails(
      setDoc(doc(db, 'notifications', 'mail-1'), {
        mailId: 'mail-1',
        type: 'credentials',
        audience: 'tenant',
        subject: 'forged',
        to: ['x@example.com'],
      }),
    )
  })
})
