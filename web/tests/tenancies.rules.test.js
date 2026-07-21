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

// tenancies — admin full access; the tenant reads ONLY their own tenancy
// (SRS §6: "tenancies/{tenancyId} [ACCESS: admin full; the tenant reads where
// userId == auth.uid]"). First client access to this collection — until Sub-stage
// E, only finalizeKyc (Admin SDK, bypasses rules) ever touched it.

let testEnv

const TENANCY_ID = 'tenancy-1'
const TENANCY = {
  userId: 'tenant-1',
  ownerId: 'admin-uid',
  propertyId: 'prop-1',
  tenantName: 'Ion Popescu',
  status: 'active',
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
    await setDoc(doc(context.firestore(), 'tenancies', TENANCY_ID), TENANCY)
  })
}

describe('firestore.rules — tenancies: admin full, tenant reads their own', () => {
  it('denies a read by an unauthenticated visitor', async () => {
    await seed()
    const db = testEnv.unauthenticatedContext().firestore()

    await assertFails(getDoc(doc(db, 'tenancies', TENANCY_ID)))
  })

  it('denies a write by an unauthenticated visitor', async () => {
    const db = testEnv.unauthenticatedContext().firestore()

    await assertFails(setDoc(doc(db, 'tenancies', TENANCY_ID), TENANCY))
  })

  it('denies a read by an authenticated user who is not the tenancy owner', async () => {
    await seed()
    const db = testEnv.authenticatedContext('someone-else').firestore()

    await assertFails(getDoc(doc(db, 'tenancies', TENANCY_ID)))
  })

  it('denies a write by the tenant themselves (read-only for tenants)', async () => {
    await seed()
    const db = testEnv.authenticatedContext('tenant-1').firestore()

    await assertFails(
      setDoc(doc(db, 'tenancies', TENANCY_ID), {
        ...TENANCY,
        monthlyRent: '999',
      }),
    )
  })

  it('denies a read by a user with a false admin claim (and not the owner)', async () => {
    await seed()
    const db = testEnv
      .authenticatedContext('impostor-1', { admin: false })
      .firestore()

    await assertFails(getDoc(doc(db, 'tenancies', TENANCY_ID)))
  })

  it('denies listing the collection to a non-admin', async () => {
    const db = testEnv.authenticatedContext('tenant-1').firestore()

    await assertFails(getDocs(collection(db, 'tenancies')))
  })

  it('allows the tenant to read their OWN tenancy (userId == auth.uid)', async () => {
    await seed()
    const db = testEnv.authenticatedContext('tenant-1').firestore()

    await assertSucceeds(getDoc(doc(db, 'tenancies', TENANCY_ID)))
  })

  it('allows the full CRUD to the admin (claim admin:true)', async () => {
    const db = testEnv
      .authenticatedContext('admin-1', { admin: true })
      .firestore()

    await assertSucceeds(setDoc(doc(db, 'tenancies', TENANCY_ID), TENANCY))
    await assertSucceeds(getDoc(doc(db, 'tenancies', TENANCY_ID)))
    await assertSucceeds(getDocs(collection(db, 'tenancies')))
    await assertSucceeds(
      setDoc(
        doc(db, 'tenancies', TENANCY_ID),
        { currentBalance: 100 },
        { merge: true },
      ),
    )
    await assertSucceeds(deleteDoc(doc(db, 'tenancies', TENANCY_ID)))
  })
})
