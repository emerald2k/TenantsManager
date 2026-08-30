import { beforeEach, describe, expect, it } from 'vitest'
import { getFirestore } from 'firebase-admin/firestore'
import {
  recomputeCurrentBalance,
  computeBalanceFromSignedReports,
} from '../src/reports.js'
import { endTenancyCore } from '../src/endTenancy.js'

// Proves FR-CON-04 end-to-end: endTenancy.js's `closingBalance` freeze (M8,
// reversed at stage 5 — termination is no longer blocked by arrears) reacts
// to a currentBalance the SYSTEM computed via recomputeCurrentBalance, not a
// hand-seeded fixture. No source file changes in this test — if any case
// below fails, the bug is in recomputeCurrentBalance (reports.js) or in
// endTenancy.js's closingBalance write, not in this test.

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

describe('FR-CON-04, live: arrears no longer block termination — closingBalance freezes the SYSTEM-computed balance', () => {
  it('permits endTenancy after a signed report with a partial payment, freezing the real currentBalance into closingBalance', async () => {
    await db
      .collection('monthlyReports')
      .doc('report-1')
      .set(report({ finalTotal: 1500, amountPaid: 1000 }))
    await recomputeCurrentBalance('tenancy-1')

    const result = await endTenancyCore('tenancy-1', 'admin-uid')
    expect(result.tenancyId).toBe('tenancy-1')

    const tenancySnap = await db.collection('tenancies').doc('tenancy-1').get()
    expect(tenancySnap.data().status).toBe('ended')
    expect(tenancySnap.data().currentBalance).toBe(500)
    expect(tenancySnap.data().closingBalance).toBe(500)
  })
})

describe('FR-CON-04, live: fully paid / credit / never-signed also permit termination', () => {
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

describe('FR-REP-04a/04f, live: a roundingSurplus cancels across two consecutive months', () => {
  // The seed's ENDED_MONTHS chain (functions/scripts/seed.js) and this test
  // encode the same fact from two angles — M8 stage 15, debt 1. December
  // rounds `finalTotal` up from 1977 to 1980 (`roundingSurplus` 3) and is
  // paid in full; January picks the 3 lei up as `previousMonthCredit`, bills
  // 1977, is paid in full; the running balance closes at exactly 0. Before
  // this stage the seed had no rounding surplus that ever got to cancel —
  // HANDOVER_OUT_REPORT's is frozen at termination.
  const december = report({
    year: 2025,
    month: 12,
    previousMonthArrears: 0,
    previousMonthCredit: 0,
    calculatedTotal: 1977,
    finalTotal: 1980,
    roundingSurplus: 3,
    amountPaid: 1980,
    paymentStatus: 'paid',
  })
  const january = report({
    year: 2026,
    month: 1,
    previousMonthArrears: 0,
    previousMonthCredit: 3,
    calculatedTotal: 1977,
    finalTotal: 1977,
    roundingSurplus: 0,
    amountPaid: 1977,
    paymentStatus: 'paid',
  })

  it('after December ALONE the balance is -3 — the surplus is a credit the tenant is owed', async () => {
    await db.collection('monthlyReports').doc('report-dec').set(december)

    expect(await computeBalanceFromSignedReports('tenancy-1')).toBe(-3)
  })

  it('after January consumes that credit the chain closes at exactly 0', async () => {
    await db.collection('monthlyReports').doc('report-dec').set(december)
    await db.collection('monthlyReports').doc('report-jan').set(january)

    // Most-recent-signed is January; its finalTotal already carries the
    // consumed credit, so 1977 - 1977 - 0 === 0. Drop the `- roundingSurplus`
    // term from computeBalanceFromSignedReports and the December-alone case
    // above reads 0 instead of -3; leave January's finalTotal at 1980
    // (credit never consumed) and this case reads 3. Neither is vacuous.
    expect(await computeBalanceFromSignedReports('tenancy-1')).toBe(0)
    await recomputeCurrentBalance('tenancy-1')
    const snap = await db.collection('tenancies').doc('tenancy-1').get()
    expect(snap.data().currentBalance).toBe(0)
  })
})
