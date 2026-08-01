import { beforeEach, describe, expect, it } from 'vitest'
import { getFirestore } from 'firebase-admin/firestore'
import { recomputeCurrentBalance } from '../src/reports.js'
import { endTenancyCore } from '../src/endTenancy.js'

// Proves FR-CON-04 end-to-end for the first time: endTenancy.js's arrears
// guard (currentBalance > 0, unchanged since M3) now reacts to a
// currentBalance the SYSTEM computed via recomputeCurrentBalance, not a
// hand-seeded fixture. No source file changes in this test — if any case
// below fails, the bug is in recomputeCurrentBalance (reports.js) or in the
// pre-existing endTenancy.js:74 guard, not in this test.

const PROJECT_ID = 'tenants-manager-2026'
const db = getFirestore()

const PROPERTY = {
  name: 'Apartament Centru',
  address: {
    street: 'Str. Memorandumului',
    number: '4',
    city: 'Cluj-Napoca',
    county: 'Cluj',
    postalCode: '400114',
  },
  ownerId: 'admin-uid',
  status: 'occupied',
  archived: false,
  services: [],
}
const USER = {
  name: 'Ion Popescu',
  email: 'ion@example.com',
  cnp: '1900101123456',
  preferredLanguage: 'ro',
  status: 'active',
}

function tenancy(overrides = {}) {
  return {
    userId: 'user-1',
    ownerId: 'admin-uid',
    propertyId: 'prop-1',
    tenantName: 'Ion Popescu',
    property: { name: PROPERTY.name, address: PROPERTY.address },
    startDate: '2026-01-01',
    endDate: '2027-01-01',
    monthlyRent: 2000,
    dueDay: 5,
    reportReminderDaysBefore: 3,
    currentBalance: 0,
    status: 'active',
    attachedDocuments: [],
    ...overrides,
  }
}

function report(overrides = {}) {
  return {
    ownerId: 'admin-uid',
    propertyId: 'prop-1',
    tenancyId: 'tenancy-1',
    userId: 'user-1',
    month: 7,
    year: 2026,
    status: 'signed',
    ...overrides,
  }
}

async function clearEmulators() {
  const fsHost = process.env.FIRESTORE_EMULATOR_HOST
  await fetch(
    `http://${fsHost}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`,
    { method: 'DELETE' },
  )
}

beforeEach(async () => {
  await clearEmulators()
  await db.collection('properties').doc('prop-1').set(PROPERTY)
  await db.collection('users').doc('user-1').set(USER)
  await db.collection('tenancies').doc('tenancy-1').set(tenancy())
})

describe('FR-CON-04, live: a signed report with arrears blocks termination', () => {
  it('blocks endTenancy after a signed report with a partial payment', async () => {
    await db
      .collection('monthlyReports')
      .doc('report-1')
      .set(report({ finalTotal: 1500, amountPaid: 1000 }))
    await recomputeCurrentBalance('tenancy-1')

    await expect(
      endTenancyCore('tenancy-1', 'admin-uid'),
    ).rejects.toMatchObject({
      code: 'failed-precondition',
      details: { reason: 'arrears', currentBalance: 500 },
    })

    const tenancySnap = await db.collection('tenancies').doc('tenancy-1').get()
    expect(tenancySnap.data().status).toBe('active') // unchanged — termination did not go through
  })
})

describe('FR-CON-04, live: fully paid / credit / never-signed do NOT block termination', () => {
  it('permits endTenancy once fully paid (currentBalance == 0)', async () => {
    await db
      .collection('monthlyReports')
      .doc('report-1')
      .set(report({ finalTotal: 1500, amountPaid: 1500 }))
    await recomputeCurrentBalance('tenancy-1')

    const result = await endTenancyCore('tenancy-1', 'admin-uid')
    expect(result.tenancyId).toBe('tenancy-1')
  })

  it('permits endTenancy on an overpayment (currentBalance negative — a credit)', async () => {
    await db
      .collection('monthlyReports')
      .doc('report-1')
      .set(report({ finalTotal: 1500, amountPaid: 1800 }))
    await recomputeCurrentBalance('tenancy-1')

    const result = await endTenancyCore('tenancy-1', 'admin-uid')
    expect(result.tenancyId).toBe('tenancy-1')
  })

  it('permits endTenancy when no report has EVER been signed (currentBalance stays 0)', async () => {
    // No monthlyReports document at all — currentBalance is whatever the
    // tenancy was seeded with (0), never touched by recomputeCurrentBalance.
    const result = await endTenancyCore('tenancy-1', 'admin-uid')
    expect(result.tenancyId).toBe('tenancy-1')
  })
})
