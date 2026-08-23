import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
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
  updateDoc,
} from 'firebase/firestore'

// monthlyReports — admin full access; the tenant reads ONLY their own SIGNED
// report (SRS §6: "admin full; the tenant reads where userId == auth.uid and
// status == 'signed'"; §7.3). Closes the deferral left at M4 sub-stage 1.
//
// Anti-vacuity (CLAUDE.md §7), actually run (not assumed): the `read` clause
// was temporarily made permissive (`allow read: if isAdmin() || request.auth
// != null;`) and the band re-run. Exactly 3 of the 9 tests failed — the 2
// deny-read tests tied to the ownership/status checks ("denies the tenant's
// read of their OWN report while it is still a draft", "denies a DIFFERENT
// tenant's read of a signed report that isn't theirs") PLUS "denies listing
// the collection to a non-admin" (listing is evaluated per-document too, so
// it depends on the same clause — this was not anticipated before running,
// which is exactly what the anti-vacuity pass is for). The other 6 (both
// unauthenticated denies, the write deny, both allow tests) stayed green.
// Rule restored to the SRS §6/§7.3 clause below afterward.

let testEnv

const SIGNED_ID = 'report-signed'
const DRAFT_ID = 'report-draft'
const OTHER_TENANT_SIGNED_ID = 'report-other-tenant-signed'

function report(overrides = {}) {
  return {
    ownerId: 'admin-uid',
    propertyId: 'prop-1',
    tenancyId: 'tenancy-1',
    userId: 'tenant-1',
    month: 7,
    year: 2026,
    status: 'draft',
    ...overrides,
  }
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

async function seed() {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore()
    await setDoc(
      doc(db, 'monthlyReports', SIGNED_ID),
      report({ status: 'signed' }),
    )
    await setDoc(
      doc(db, 'monthlyReports', DRAFT_ID),
      report({ status: 'draft' }),
    )
    await setDoc(
      doc(db, 'monthlyReports', OTHER_TENANT_SIGNED_ID),
      report({ userId: 'tenant-2', status: 'signed' }),
    )
  })
}

describe('firestore.rules — monthlyReports: admin full, tenant reads own SIGNED only', () => {
  it('denies a read by an unauthenticated visitor', async () => {
    await seed()
    const db = testEnv.unauthenticatedContext().firestore()

    await assertFails(getDoc(doc(db, 'monthlyReports', SIGNED_ID)))
  })

  it('denies a write by an unauthenticated visitor', async () => {
    const db = testEnv.unauthenticatedContext().firestore()

    await assertFails(setDoc(doc(db, 'monthlyReports', SIGNED_ID), report()))
  })

  // M4 sub-stage 8 reinforcement: proves the rule does not special-case a
  // document that carries a live shareToken — anonymous access to a shared
  // report is served EXCLUSIVELY by the getSharedReport Cloud Function
  // (Admin SDK, bypasses rules), never by a direct client read, no matter
  // what the document's own shareToken/shareTokenRevoked fields say.
  it('denies a DIRECT anonymous read even when the report carries a valid, non-revoked shareToken', async () => {
    const SHARED_ID = 'report-with-live-share-token'
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(
        doc(context.firestore(), 'monthlyReports', SHARED_ID),
        report({
          status: 'signed',
          shareToken: 'a-very-long-random-token-1234567890',
          shareTokenRevoked: false,
        }),
      )
    })
    const db = testEnv.unauthenticatedContext().firestore()

    await assertFails(getDoc(doc(db, 'monthlyReports', SHARED_ID)))
  })

  it("denies the tenant's read of their OWN report while it is still a draft", async () => {
    await seed()
    const db = testEnv.authenticatedContext('tenant-1').firestore()

    await assertFails(getDoc(doc(db, 'monthlyReports', DRAFT_ID)))
  })

  it("denies a DIFFERENT tenant's read of a signed report that isn't theirs", async () => {
    await seed()
    const db = testEnv.authenticatedContext('tenant-1').firestore()

    await assertFails(getDoc(doc(db, 'monthlyReports', OTHER_TENANT_SIGNED_ID)))
  })

  it('denies a write by the tenant themselves (read-only for tenants)', async () => {
    await seed()
    const db = testEnv.authenticatedContext('tenant-1').firestore()

    await assertFails(
      setDoc(doc(db, 'monthlyReports', SIGNED_ID), {
        ...report({ status: 'signed' }),
        finalTotal: 1,
      }),
    )
  })

  it('denies listing the collection to a non-admin', async () => {
    const db = testEnv.authenticatedContext('tenant-1').firestore()

    await assertFails(getDocs(collection(db, 'monthlyReports')))
  })

  it('allows the tenant to read their OWN signed report', async () => {
    await seed()
    const db = testEnv.authenticatedContext('tenant-1').firestore()

    await assertSucceeds(getDoc(doc(db, 'monthlyReports', SIGNED_ID)))
  })

  // NFR-SEC-11 (M8): status is pinned on update. A direct client write is
  // never how a report signs or unlocks — that happens exclusively through
  // signReport/unlockReport (Admin SDK, bypasses rules). Asserting
  // permission-denied SPECIFICALLY, not just assertFails, matters here:
  // not-found also satisfies assertFails(), so a test against a missing
  // document would pass vacuously even with the pin absent. Anti-vacuity was
  // run by hand: with the update clause relaxed back to `if isAdmin();`, this
  // test failed (the update succeeded); restored, it passes again.
  it("denies an admin's direct write flipping status from draft to signed", async () => {
    await seed()
    const db = testEnv
      .authenticatedContext('admin-1', { admin: true })
      .firestore()

    try {
      await updateDoc(doc(db, 'monthlyReports', DRAFT_ID), {
        status: 'signed',
      })
      expect.fail('expected the update to be denied')
    } catch (err) {
      expect(err.code).toBe('permission-denied')
    }
  })

  it("denies an admin's direct write flipping status from signed back to draft", async () => {
    await seed()
    const db = testEnv
      .authenticatedContext('admin-1', { admin: true })
      .firestore()

    try {
      await updateDoc(doc(db, 'monthlyReports', SIGNED_ID), {
        status: 'draft',
      })
      expect.fail('expected the update to be denied')
    } catch (err) {
      expect(err.code).toBe('permission-denied')
    }
  })

  it('allows an admin write that edits an ordinary field while leaving status unchanged', async () => {
    await seed()
    const db = testEnv
      .authenticatedContext('admin-1', { admin: true })
      .firestore()

    await assertSucceeds(
      updateDoc(doc(db, 'monthlyReports', DRAFT_ID), { finalTotal: 1234 }),
    )
  })

  it('allows the full CRUD to the admin (claim admin:true)', async () => {
    const db = testEnv
      .authenticatedContext('admin-1', { admin: true })
      .firestore()

    await assertSucceeds(
      setDoc(
        doc(db, 'monthlyReports', SIGNED_ID),
        report({ status: 'signed' }),
      ),
    )
    await assertSucceeds(getDoc(doc(db, 'monthlyReports', SIGNED_ID)))
    await assertSucceeds(getDocs(collection(db, 'monthlyReports')))
    await assertSucceeds(deleteDoc(doc(db, 'monthlyReports', SIGNED_ID)))
  })
})
