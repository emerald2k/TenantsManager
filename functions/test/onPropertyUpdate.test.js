import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getFirestore } from 'firebase-admin/firestore'
import { onPropertyUpdateHandler } from '../src/properties.js'

// Functions tests — the REAL boundary (Firestore emulator), no mocks of the
// data layer. Started via `npm run test:emulator` (firebase emulators:exec).
// Mirrors endTenancy.test.js / reports.test.js's structure/conventions.

const PROJECT_ID = 'tenants-manager-2026'
const db = getFirestore()

function property(overrides = {}) {
  return {
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
    ...overrides,
  }
}

// Mirrors `toTenancyDocument` (kyc.js) — the real shape a tenancy has in
// production, so this test exercises the same document onPropertyUpdate
// will actually operate on.
function tenancy(overrides = {}) {
  return {
    userId: 'user-1',
    ownerId: 'admin-uid',
    propertyId: 'prop-1',
    tenantName: 'Ion Popescu',
    property: {
      name: 'Apartament Centru',
      address: {
        street: 'Str. Memorandumului',
        number: '4',
        city: 'Cluj-Napoca',
        county: 'Cluj',
        postalCode: '400114',
      },
    },
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

async function clearEmulators() {
  const fsHost = process.env.FIRESTORE_EMULATOR_HOST
  await fetch(
    `http://${fsHost}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`,
    { method: 'DELETE' },
  )
}

async function seedProperty(id, overrides = {}) {
  await db.collection('properties').doc(id).set(property(overrides))
}

async function seedTenancy(id, overrides = {}) {
  await db.collection('tenancies').doc(id).set(tenancy(overrides))
}

// Calls the exported HANDLER directly with a hand-built event object — NOT
// the deployed onDocumentUpdated trigger (test:emulator only starts
// auth/firestore/storage, not the functions emulator). Same technique as
// reports.test.js's `fakeEvent` for onReportWriteHandler.
function fakeEvent({ propertyId, beforeData, afterData }) {
  return {
    params: { propertyId },
    data: {
      before: { exists: true, data: () => beforeData },
      after: { exists: true, data: () => afterData },
    },
  }
}

beforeEach(async () => {
  await clearEmulators()
})

describe('onPropertyUpdateHandler — name/address sync (FR-PROP-10)', () => {
  it('updates the active tenancy when the property name changes', async () => {
    await seedProperty('prop-1')
    await seedTenancy('tenancy-1')

    const before = property()
    const after = property({ name: 'Apartament Nou' })
    await onPropertyUpdateHandler(
      fakeEvent({ propertyId: 'prop-1', beforeData: before, afterData: after }),
    )

    const snap = await db.collection('tenancies').doc('tenancy-1').get()
    expect(snap.data().property).toEqual({
      name: 'Apartament Nou',
      address: before.address,
    })
  })

  it('updates the address, WITHOUT leaving a residue of a deleted key', async () => {
    await seedProperty('prop-1')
    await seedTenancy('tenancy-1')

    const before = property()
    // postalCode removed entirely, not just changed.
    const after = property({
      address: {
        street: 'Str. Memorandumului',
        number: '4',
        city: 'Cluj-Napoca',
        county: 'Cluj',
      },
    })
    await onPropertyUpdateHandler(
      fakeEvent({ propertyId: 'prop-1', beforeData: before, afterData: after }),
    )

    const snap = await db.collection('tenancies').doc('tenancy-1').get()
    expect(snap.data().property.address).toEqual(after.address)
    expect(snap.data().property.address.postalCode).toBeUndefined()
    expect(Object.keys(snap.data().property.address)).not.toContain(
      'postalCode',
    )
  })

  it('does NOT write when only `services` changes (guard) — updateTime is untouched', async () => {
    await seedProperty('prop-1')
    await seedTenancy('tenancy-1')

    const beforeSnap = await db.collection('tenancies').doc('tenancy-1').get()
    const beforeUpdateTime = beforeSnap.updateTime

    const before = property()
    const after = property({
      services: [
        { serviceId: 'electricity', name: 'Electricitate', source: 'catalog' },
      ],
    })
    await onPropertyUpdateHandler(
      fakeEvent({ propertyId: 'prop-1', beforeData: before, afterData: after }),
    )

    const afterSnap = await db.collection('tenancies').doc('tenancy-1').get()
    expect(afterSnap.updateTime.isEqual(beforeUpdateTime)).toBe(true)
  })

  it('is a no-op when the property has no active tenancy', async () => {
    await seedProperty('prop-1')

    const before = property()
    const after = property({ name: 'Apartament Nou' })
    await expect(
      onPropertyUpdateHandler(
        fakeEvent({
          propertyId: 'prop-1',
          beforeData: before,
          afterData: after,
        }),
      ),
    ).resolves.toBeUndefined()
  })

  it('does NOT touch an ENDED tenancy on the same property', async () => {
    await seedProperty('prop-1')
    await seedTenancy('tenancy-ended', { status: 'ended' })

    const beforeSnap = await db
      .collection('tenancies')
      .doc('tenancy-ended')
      .get()
    const beforeUpdateTime = beforeSnap.updateTime

    const before = property()
    const after = property({ name: 'Apartament Nou' })
    await onPropertyUpdateHandler(
      fakeEvent({ propertyId: 'prop-1', beforeData: before, afterData: after }),
    )

    const afterSnap = await db
      .collection('tenancies')
      .doc('tenancy-ended')
      .get()
    expect(afterSnap.updateTime.isEqual(beforeUpdateTime)).toBe(true)
    expect(afterSnap.data().property.name).toBe('Apartament Centru')
  })

  it('does NOT sync (and does not throw) when the property is missing `address` — corrupted data', async () => {
    await seedProperty('prop-1')
    await seedTenancy('tenancy-1')

    const beforeSnap = await db.collection('tenancies').doc('tenancy-1').get()
    const beforeUpdateTime = beforeSnap.updateTime

    const before = property()
    // `address` entirely absent, not just a changed value — simulates a
    // corrupted property document, not a legitimate edit.
    const after = { ...property({ name: 'Apartament Nou' }) }
    delete after.address

    await expect(
      onPropertyUpdateHandler(
        fakeEvent({
          propertyId: 'prop-1',
          beforeData: before,
          afterData: after,
        }),
      ),
    ).resolves.toBeUndefined()

    const afterSnap = await db.collection('tenancies').doc('tenancy-1').get()
    expect(afterSnap.updateTime.isEqual(beforeUpdateTime)).toBe(true)
    // Still the ORIGINAL seeded name — never the corrupted-update's 'Apartament Nou'.
    expect(afterSnap.data().property.name).toBe('Apartament Centru')
  })

  // Distinct from the test above: there, address is REMOVED by the update
  // (before valid, after corrupted). Here the property is ALREADY corrupted
  // on BOTH sides — `address` absent before and after — and only `name`
  // changes. This is what actually exercises the guard ORDER (Corectia 1):
  // the change-guard sees nameChanged === true and lets the event through,
  // and only then does the corrupted-data guard catch the missing address
  // and stop the write — proving the two guards compose correctly on an
  // already-corrupted document, not just at the moment of corruption.
  it('does NOT sync (and does not throw) when the property is missing `address` on BOTH sides, only `name` changing', async () => {
    await seedProperty('prop-1')
    await seedTenancy('tenancy-1')

    const beforeSnap = await db.collection('tenancies').doc('tenancy-1').get()
    const beforeUpdateTime = beforeSnap.updateTime

    const before = { ...property() }
    delete before.address
    const after = { ...property({ name: 'Apartament Nou' }) }
    delete after.address

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(
      onPropertyUpdateHandler(
        fakeEvent({
          propertyId: 'prop-1',
          beforeData: before,
          afterData: after,
        }),
      ),
    ).resolves.toBeUndefined()

    // Verified via updateTime only — the tenancy was never touched at all,
    // which is the stronger and more direct proof than re-reading content.
    const afterSnap = await db.collection('tenancies').doc('tenancy-1').get()
    expect(afterSnap.updateTime.isEqual(beforeUpdateTime)).toBe(true)
    expect(errorSpy).toHaveBeenCalled()

    errorSpy.mockRestore()
  })
})
