import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest'
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing'
import { doc, setDoc, updateDoc } from 'firebase/firestore'

// firestore.rules — tenancies: currentBalance/closingBalance are PINNED on
// update (NFR-SEC-12, M8 stage 7). Both are server-derived
// (`recomputeCurrentBalance`, `endTenancyCore`) and have no legitimate
// client write path; every real admin write to this collection (Extend,
// the deposit settlement) already omits both fields, so the pin costs
// those flows nothing.
//
// Anti-vacuity (CLAUDE.md §7): the pin was temporarily relaxed to
// `allow update: if isAdmin();` and re-run — exactly the 3 deny tests below
// failed (direct currentBalance write, direct closingBalance write,
// introducing closingBalance where absent); the 3 allow tests stayed green,
// untouched by the change. Restored afterward.

let testEnv

const TENANCY_ID = 'tenancy-1'
const ACTIVE_TENANCY = {
  userId: 'tenant-1',
  ownerId: 'admin-uid',
  propertyId: 'prop-1',
  tenantName: 'Ion Popescu',
  status: 'active',
  currentBalance: 500,
  endDate: '2027-01-01',
}
const ENDED_TENANCY = {
  ...ACTIVE_TENANCY,
  status: 'ended',
  currentBalance: 0,
  closingBalance: 0,
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

beforeEach(async () => {
  await testEnv.clearFirestore()
})

async function seed(data) {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'tenancies', TENANCY_ID), data)
  })
}

function adminDb() {
  return testEnv.authenticatedContext('admin-1', { admin: true }).firestore()
}

describe('firestore.rules — tenancies.currentBalance/closingBalance pinned on update (NFR-SEC-12)', () => {
  it('denies a direct client update of currentBalance', async () => {
    await seed(ACTIVE_TENANCY)

    await assertFails(
      updateDoc(doc(adminDb(), 'tenancies', TENANCY_ID), {
        currentBalance: 999,
      }),
    )
  })

  it('denies a direct client update of an EXISTING closingBalance', async () => {
    await seed(ENDED_TENANCY)

    await assertFails(
      updateDoc(doc(adminDb(), 'tenancies', TENANCY_ID), {
        closingBalance: 999,
      }),
    )
  })

  it('denies introducing closingBalance on an ACTIVE tenancy that never had one — absence is not a loophole', async () => {
    await seed(ACTIVE_TENANCY) // no closingBalance field at all

    await assertFails(
      updateDoc(doc(adminDb(), 'tenancies', TENANCY_ID), {
        closingBalance: 500,
      }),
    )
  })

  it('allows an ordinary admin write (Extend) that never touches either balance field', async () => {
    await seed(ACTIVE_TENANCY)

    await assertSucceeds(
      updateDoc(doc(adminDb(), 'tenancies', TENANCY_ID), {
        endDate: '2028-01-01',
      }),
    )
  })

  it('allows the stage-16b lead-time edit (endDate + both reminder fields, no balance)', async () => {
    await seed(ACTIVE_TENANCY)

    await assertSucceeds(
      updateDoc(doc(adminDb(), 'tenancies', TENANCY_ID), {
        endDate: '2028-01-01',
        reportReminderDaysBefore: 6,
        paymentReminderDaysBefore: 9,
      }),
    )
  })

  it('denies a lead-time edit that ALSO carries currentBalance — permission-denied, over a seeded doc', async () => {
    await seed(ACTIVE_TENANCY) // seeded, so a failure is the PIN, not not-found

    let code
    try {
      await updateDoc(doc(adminDb(), 'tenancies', TENANCY_ID), {
        reportReminderDaysBefore: 6,
        currentBalance: 999,
      })
    } catch (err) {
      code = err.code
    }
    expect(code).toBe('permission-denied')
  })

  it('allows the deposit settlement write on an ended tenancy, leaving its existing closingBalance untouched', async () => {
    await seed(ENDED_TENANCY)

    await assertSucceeds(
      updateDoc(doc(adminDb(), 'tenancies', TENANCY_ID), {
        depositSettlement: {
          items: [{ description: 'Curățenie', amount: 200, attachments: [] }],
          deducted: 200,
          toReturn: 0,
          ownerBears: 0,
          settledAt: new Date(),
        },
      }),
    )
  })

  it('allows a write that re-sends the SAME currentBalance value it already had — the pin compares values, not key presence in the payload', async () => {
    await seed(ACTIVE_TENANCY)

    await assertSucceeds(
      updateDoc(doc(adminDb(), 'tenancies', TENANCY_ID), {
        currentBalance: 500, // identical to the seeded value
        endDate: '2028-01-01',
      }),
    )
  })

  it('still denies any write at all from a non-admin, pin or no pin', async () => {
    await seed(ACTIVE_TENANCY)
    const tenantDb = testEnv.authenticatedContext('tenant-1').firestore()

    await assertFails(
      updateDoc(doc(tenantDb, 'tenancies', TENANCY_ID), {
        endDate: '2028-01-01',
      }),
    )
  })
})
