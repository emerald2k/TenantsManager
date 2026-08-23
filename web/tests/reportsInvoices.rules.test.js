import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, describe, it } from 'vitest'
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing'
import { doc, setDoc } from 'firebase/firestore'
import { deleteObject, getBytes, ref, uploadBytes } from 'firebase/storage'

// /reports/{reportId}/invoices/** (FR-DOC-01…05): admin write; read is admin
// OR the tenant that report belongs to, ONLY once it is signed (mirrors
// tenancyContract.rules.test.js's firestore.get() pattern, but additionally
// gated on status=='signed' — an unsigned report's attachments must stay
// invisible to the tenant, same as the report document itself).
//
// Anti-vacuity (CLAUDE.md §7): the `read` clause was temporarily made
// permissive (`allow read: if isAdmin() || request.auth != null;`) and
// re-run — exactly the 2 deny-read tests tied to the ownership/status checks
// ("denies a read by a DIFFERENT tenant" and "denies the owning tenant's
// read while the report is still a draft") failed, all other tests
// (unauthenticated-read deny, both write/delete-deny tests, all three admin
// allow tests) stayed green, then the rule was restored to the clause below.

let testEnv

const REPORT_ID = 'report-1'
const OTHER_REPORT_ID = 'report-2'
const DRAFT_REPORT_ID = 'report-3'

function report(overrides = {}) {
  return {
    ownerId: 'admin-uid',
    propertyId: 'prop-1',
    tenancyId: 'tenancy-1',
    userId: 'tenant-1',
    month: 7,
    year: 2026,
    status: 'signed',
    ...overrides,
  }
}

const PATH = `reports/${REPORT_ID}/invoices/invoice.pdf`
const DRAFT_PATH = `reports/${DRAFT_REPORT_ID}/invoices/invoice.pdf`
const BYTES = new Uint8Array([1, 2, 3])

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'tenants-manager-2026',
    firestore: {
      rules: readFileSync(
        path.resolve(process.cwd(), '../firestore.rules'),
        'utf8',
      ),
    },
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

async function seed() {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(
      doc(context.firestore(), 'monthlyReports', REPORT_ID),
      report(),
    )
    await setDoc(
      doc(context.firestore(), 'monthlyReports', OTHER_REPORT_ID),
      report({ userId: 'tenant-2' }),
    )
    await setDoc(
      doc(context.firestore(), 'monthlyReports', DRAFT_REPORT_ID),
      report({ status: 'draft' }),
    )
    await uploadBytes(ref(context.storage(), PATH), BYTES)
    await uploadBytes(ref(context.storage(), DRAFT_PATH), BYTES)
  })
}

describe('storage.rules — /reports/{reportId}/invoices/**: admin write; owning tenant reads once SIGNED', () => {
  it('denies an upload by an unauthenticated visitor', async () => {
    await seed()
    const storage = testEnv.unauthenticatedContext().storage()

    await assertFails(uploadBytes(ref(storage, PATH), BYTES))
  })

  it('denies a read by an unauthenticated visitor', async () => {
    await seed()
    const storage = testEnv.unauthenticatedContext().storage()

    await assertFails(getBytes(ref(storage, PATH)))
  })

  // M4 sub-stage 8 reinforcement: proves the rule does not special-case a
  // report that carries a live shareToken — anonymous byte access to a
  // shared report's attachments is served EXCLUSIVELY by the
  // getSharedReportAttachment Cloud Function (Admin SDK, bypasses rules),
  // never by a direct Storage read, no matter what the Firestore document's
  // shareToken/shareTokenRevoked fields say.
  it('denies a DIRECT anonymous read even when the owning report carries a valid, non-revoked shareToken', async () => {
    const SHARED_REPORT_ID = 'report-with-live-share-token'
    const SHARED_PATH = `reports/${SHARED_REPORT_ID}/invoices/invoice.pdf`
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(
        doc(context.firestore(), 'monthlyReports', SHARED_REPORT_ID),
        report({
          shareToken: 'a-very-long-random-token-1234567890',
          shareTokenRevoked: false,
        }),
      )
      await uploadBytes(ref(context.storage(), SHARED_PATH), BYTES)
    })
    const storage = testEnv.unauthenticatedContext().storage()

    await assertFails(getBytes(ref(storage, SHARED_PATH)))
  })

  it('denies a write by the tenant that owns the report (read-only for tenants)', async () => {
    await seed()
    const storage = testEnv.authenticatedContext('tenant-1').storage()

    await assertFails(uploadBytes(ref(storage, PATH), BYTES))
  })

  it('denies a delete by the tenant that owns the report', async () => {
    await seed()
    const storage = testEnv.authenticatedContext('tenant-1').storage()

    await assertFails(deleteObject(ref(storage, PATH)))
  })

  it('denies a read by a DIFFERENT tenant (not this report’s owner)', async () => {
    await seed()
    const storage = testEnv.authenticatedContext('tenant-2').storage()

    await assertFails(getBytes(ref(storage, PATH)))
  })

  it("denies the owning tenant's read while the report is still a draft", async () => {
    await seed()
    const storage = testEnv.authenticatedContext('tenant-1').storage()

    await assertFails(getBytes(ref(storage, DRAFT_PATH)))
  })

  it('allows a read by the tenant that owns the SIGNED report', async () => {
    await seed()
    const storage = testEnv.authenticatedContext('tenant-1').storage()

    await assertSucceeds(getBytes(ref(storage, PATH)))
  })

  it('allows the admin to upload', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(
        doc(context.firestore(), 'monthlyReports', REPORT_ID),
        report(),
      )
    })
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

  // M8, FR-REP-14: the rule resolves access by `firestore.get(monthlyReports/
  // $(reportId))`, taking `reportId` VERBATIM from the Storage path segment —
  // it has never cared whether that string looks like `propertyId_YYYY-MM`
  // or `tenancyId_YYYY-MM`. The tests above already prove that structurally
  // (REPORT_ID is an arbitrary literal), but stage 4's whole risk is a
  // migration that moves the Firestore document to a NEW id without moving
  // the Storage object to match — silently orphaning the tenant's access.
  // This test names the actual post-migration SHAPE explicitly, so it reads
  // as "the migrated case", not just "any string works".
  it('resolves a report id in the POST-MIGRATION shape (tenancyId_YYYY-MM), Storage object moved to match', async () => {
    const MIGRATED_REPORT_ID = 'seed-tenancy-occupied_2026-07'
    const MIGRATED_PATH = `reports/${MIGRATED_REPORT_ID}/invoices/invoice.pdf`
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(
        doc(context.firestore(), 'monthlyReports', MIGRATED_REPORT_ID),
        report({ tenancyId: 'seed-tenancy-occupied' }),
      )
      await uploadBytes(ref(context.storage(), MIGRATED_PATH), BYTES)
    })

    const tenantStorage = testEnv.authenticatedContext('tenant-1').storage()
    await assertSucceeds(getBytes(ref(tenantStorage, MIGRATED_PATH)))

    const otherTenantStorage = testEnv
      .authenticatedContext('tenant-2')
      .storage()
    await assertFails(getBytes(ref(otherTenantStorage, MIGRATED_PATH)))
  })
})
