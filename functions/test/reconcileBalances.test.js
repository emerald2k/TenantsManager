import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getFirestore } from 'firebase-admin/firestore'
import { reconcileBalancesCore } from '../src/reconcileBalances.js'

// Functions tests — the REAL boundary (Firestore emulator), no mocks of the
// data layer. Started via `npm run test:emulator`. Mirrors dailyScheduler.
// test.js's fixture shape.

const PROJECT_ID = 'tenants-manager-2026'
const db = getFirestore()

async function clearEmulators() {
  const fsHost = process.env.FIRESTORE_EMULATOR_HOST
  await fetch(
    `http://${fsHost}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`,
    { method: 'DELETE' },
  )
}

function tenancy(overrides = {}) {
  return {
    userId: 'user-1',
    ownerId: 'admin-uid',
    propertyId: 'prop-1',
    tenantName: 'Ion Popescu',
    property: { name: 'Apartament Centru' },
    startDate: '2026-01-01',
    endDate: '2030-01-01',
    monthlyRent: 2000,
    dueDay: 5,
    currentBalance: 0,
    status: 'active',
    attachedDocuments: [],
    ...overrides,
  }
}

async function seedTenancy(id, overrides = {}) {
  await db.collection('tenancies').doc(id).set(tenancy(overrides))
}

async function seedSignedReport(id, overrides = {}) {
  await db
    .collection('monthlyReports')
    .doc(id)
    .set({
      tenancyId: 'tenancy-1',
      status: 'signed',
      year: 2026,
      month: 8,
      finalTotal: 2000,
      ...overrides,
    })
}

let ambientAdminEmail
beforeEach(async () => {
  await clearEmulators()
  ambientAdminEmail = process.env.ADMIN_EMAIL
  process.env.ADMIN_EMAIL = 'admin@example.com'
})

afterEach(() => {
  if (ambientAdminEmail === undefined) {
    delete process.env.ADMIN_EMAIL
  } else {
    process.env.ADMIN_EMAIL = ambientAdminEmail
  }
})

describe('reconcileBalancesCore (FR-SYS-05)', () => {
  it('sends nothing when the stored balance matches the recomputed one', async () => {
    await seedTenancy('tenancy-1', { currentBalance: 2000 })
    await seedSignedReport('report-1', {
      tenancyId: 'tenancy-1',
      finalTotal: 2000,
    })

    await reconcileBalancesCore()

    const mailSnap = await db.collection('mail').get()
    expect(mailSnap.size).toBe(0)
  })

  it('sends nothing when the divergence is within FINAL_TOTAL_EPSILON (NFR-VAL-03: money is never compared exactly)', async () => {
    await seedTenancy('tenancy-1', { currentBalance: 2000.001 })
    await seedSignedReport('report-1', {
      tenancyId: 'tenancy-1',
      finalTotal: 2000,
    })

    await reconcileBalancesCore()

    const mailSnap = await db.collection('mail').get()
    expect(mailSnap.size).toBe(0)
  })

  it('names the tenancy, the stored value, and the recomputed one when a corrupted balance is found — and repairs nothing', async () => {
    // Corrupt the stored balance directly, as if a lost trigger write or a
    // deploy-window gap had left it stale: the real value (from the signed
    // report) is 2000, but `currentBalance` claims 350.
    await seedTenancy('tenancy-1', {
      tenantName: 'Ion Popescu',
      property: { name: 'Apartament Centru' },
      currentBalance: 350,
    })
    await seedSignedReport('report-1', {
      tenancyId: 'tenancy-1',
      finalTotal: 2000,
    })

    await reconcileBalancesCore()

    const mailSnap = await db.collection('mail').get()
    expect(mailSnap.size).toBe(1)
    const mail = mailSnap.docs[0].data()
    expect(mail.to).toEqual(['admin@example.com'])
    expect(mail.message.subject).toContain('Ion Popescu')
    expect(mail.message.text).toContain('Ion Popescu')
    expect(mail.message.text).toContain('Apartament Centru')
    expect(mail.message.text).toContain('350,00 lei') // the STORED value
    expect(mail.message.text).toContain('2.000,00 lei') // the RECOMPUTED value

    // Read-only, proven directly: the stored value must be UNCHANGED after
    // the run — an automatic correction would overwrite a real balance on
    // the strength of a calculation nobody had reviewed (FR-SYS-05).
    const tenancySnap = await db.collection('tenancies').doc('tenancy-1').get()
    expect(tenancySnap.data().currentBalance).toBe(350)
  })

  it('finds a mismatch in EITHER direction — stored too low, not just too high', async () => {
    await seedTenancy('tenancy-1', { currentBalance: 5000 })
    await seedSignedReport('report-1', {
      tenancyId: 'tenancy-1',
      finalTotal: 2000,
    })

    await reconcileBalancesCore()

    const mailSnap = await db.collection('mail').get()
    expect(mailSnap.size).toBe(1)
  })

  it('ignores an ENDED tenancy, even one with a real mismatch', async () => {
    await seedTenancy('tenancy-1', { status: 'ended', currentBalance: 350 })
    await seedSignedReport('report-1', {
      tenancyId: 'tenancy-1',
      finalTotal: 2000,
    })

    await reconcileBalancesCore()

    const mailSnap = await db.collection('mail').get()
    expect(mailSnap.size).toBe(0)
  })

  it('processes the remaining tenancies when one throws (a malformed property)', async () => {
    await seedTenancy('tenancy-broken', { property: null, currentBalance: 350 })
    await db.collection('monthlyReports').doc('report-broken').set({
      tenancyId: 'tenancy-broken',
      status: 'signed',
      year: 2026,
      month: 8,
      finalTotal: 2000,
    })
    await seedTenancy('tenancy-ok', { currentBalance: 500 })
    await db.collection('monthlyReports').doc('report-ok').set({
      tenancyId: 'tenancy-ok',
      status: 'signed',
      year: 2026,
      month: 8,
      finalTotal: 2000,
    })
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(reconcileBalancesCore()).resolves.toBeUndefined()

    const mailSnap = await db.collection('mail').get()
    // tenancy-broken's `property.name` read throws before a mail doc is
    // built; tenancy-ok still gets its own mismatch report.
    expect(mailSnap.size).toBe(1)
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('tenancy-broken'),
      expect.any(Error),
    )

    errorSpy.mockRestore()
  })

  it('skips the entire run and logs once when ADMIN_EMAIL is unset — nowhere to report a mismatch', async () => {
    delete process.env.ADMIN_EMAIL
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await seedTenancy('tenancy-1', { currentBalance: 350 })
    await seedSignedReport('report-1', {
      tenancyId: 'tenancy-1',
      finalTotal: 2000,
    })

    await reconcileBalancesCore()

    const mailSnap = await db.collection('mail').get()
    expect(mailSnap.size).toBe(0)
    expect(errorSpy).toHaveBeenCalledTimes(1)

    errorSpy.mockRestore()
  })
})
