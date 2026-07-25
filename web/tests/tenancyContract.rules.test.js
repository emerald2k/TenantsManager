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

// /tenancies/{tenancyId}/contract/** (FR-CON-07): admin write; read is admin OR
// the tenant that tenancy belongs to (Storage Rules v2 cross-service
// `firestore.get()`, mirroring firestore.rules' `resource.data.userId ==
// request.auth.uid` for the same collection). Needs BOTH firestore.rules and
// storage.rules loaded in the same test environment: the tenancy doc is real
// Firestore data the Storage rule reads via `firestore.get()`.
//
// Anti-vacuity (CLAUDE.md §7), re-confirmed at the M3 post-audit gate: the
// `read` clause was temporarily made permissive (`allow read: if true`) and
// re-run — exactly the 2 deny-read tests (unauthenticated visitor, a
// DIFFERENT tenant) failed, the other 7 (including both write-deny tests,
// untouched by the change) stayed green, then the rule was restored.

let testEnv

const TENANCY_ID = 'tenancy-1'
const TENANCY = {
  userId: 'tenant-1',
  ownerId: 'admin-uid',
  propertyId: 'prop-1',
  tenantName: 'Ion Popescu',
  status: 'active',
}
const PATH = `tenancies/${TENANCY_ID}/contract/lease.pdf`
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

async function seedTenancyAndFile() {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'tenancies', TENANCY_ID), TENANCY)
    await uploadBytes(ref(context.storage(), PATH), BYTES)
  })
}

describe('storage.rules — /tenancies/{tenancyId}/contract/**: admin write; owning tenant reads', () => {
  it('denies an upload by an unauthenticated visitor', async () => {
    await seedTenancyAndFile()
    const storage = testEnv.unauthenticatedContext().storage()

    await assertFails(uploadBytes(ref(storage, PATH), BYTES))
  })

  it('denies a read by an unauthenticated visitor', async () => {
    await seedTenancyAndFile()
    const storage = testEnv.unauthenticatedContext().storage()

    await assertFails(getBytes(ref(storage, PATH)))
  })

  it('denies a write by the tenant that owns the tenancy (read-only for tenants)', async () => {
    await seedTenancyAndFile()
    const storage = testEnv.authenticatedContext('tenant-1').storage()

    await assertFails(uploadBytes(ref(storage, PATH), BYTES))
  })

  it('denies a delete by the tenant that owns the tenancy', async () => {
    await seedTenancyAndFile()
    const storage = testEnv.authenticatedContext('tenant-1').storage()

    await assertFails(deleteObject(ref(storage, PATH)))
  })

  it('denies a read by a DIFFERENT tenant (not this tenancy’s owner)', async () => {
    await seedTenancyAndFile()
    const storage = testEnv.authenticatedContext('tenant-2').storage()

    await assertFails(getBytes(ref(storage, PATH)))
  })

  it('allows a read by the tenant that owns the tenancy', async () => {
    await seedTenancyAndFile()
    const storage = testEnv.authenticatedContext('tenant-1').storage()

    await assertSucceeds(getBytes(ref(storage, PATH)))
  })

  it('allows the admin to upload', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'tenancies', TENANCY_ID), TENANCY)
    })
    const storage = testEnv
      .authenticatedContext('admin-1', { admin: true })
      .storage()

    await assertSucceeds(uploadBytes(ref(storage, PATH), BYTES))
  })

  it('allows the admin to read', async () => {
    await seedTenancyAndFile()
    const storage = testEnv
      .authenticatedContext('admin-1', { admin: true })
      .storage()

    await assertSucceeds(getBytes(ref(storage, PATH)))
  })

  it('allows the admin to delete', async () => {
    await seedTenancyAndFile()
    const storage = testEnv
      .authenticatedContext('admin-1', { admin: true })
      .storage()

    await assertSucceeds(deleteObject(ref(storage, PATH)))
  })
})
