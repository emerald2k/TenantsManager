import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getFirestore } from 'firebase-admin/firestore'
import { getStorage } from 'firebase-admin/storage'
import {
  getSharedReportCore,
  getSharedReportAttachmentCore,
  toPublicReport,
  resolveAttachment,
  STORAGE_BUCKET,
} from '../src/sharedReport.js'

// Functions tests — the REAL boundary (Firestore + Storage emulator), no
// mocks of the data layer. Started via `npm run test:emulator`. Mirrors
// reports.test.js's structure/conventions (report() fixture, clearEmulators
// via the Firestore REST DELETE-all endpoint).
//
// SECURITY IS THE PRIORITY HERE: this file backs the only two PUBLIC
// (no-auth) Cloud Functions in the codebase. Every test either proves a
// rejection (unknown/revoked/draft/wrong-reference) or proves the ALLOWLIST
// holds (no personal data ever reaches the response).

const PROJECT_ID = 'tenants-manager-2026'
const db = getFirestore()
// Explicit bucket, same as the production code under test (sharedReport.js's
// STORAGE_BUCKET) — NOT getStorage().bucket() with no argument, which would
// only coincidentally match under this test harness and could silently hide
// the exact M3 bucket-mismatch class of bug (CLAUDE.md §7).
const bucket = getStorage().bucket(STORAGE_BUCKET)

function report(overrides = {}) {
  return {
    ownerId: 'admin-uid',
    propertyId: 'prop-1',
    tenancyId: 'tenancy-1',
    userId: 'tenant-1',
    month: 7,
    year: 2026,
    rent: { amount: 1500, notes: '', attachments: [] },
    maintenance: { amount: 0, notes: '', attachments: [] },
    serviceCosts: [],
    otherExpenses: [],
    previousMonthArrears: 0,
    previousMonthCredit: 0,
    calculatedTotal: 1500,
    finalTotal: 1500,
    dueDate: '2026-07-05',
    status: 'signed',
    shareToken: null,
    shareTokenRevoked: false,
    ...overrides,
  }
}

async function clearEmulators() {
  const fsHost = process.env.FIRESTORE_EMULATOR_HOST
  await fetch(
    `http://${fsHost}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`,
    { method: 'DELETE' },
  )
  const [files] = await bucket.getFiles({ prefix: 'reports/' })
  await Promise.all(files.map((f) => f.delete().catch(() => {})))
}

async function seedReport(id, overrides = {}) {
  await db.collection('monthlyReports').doc(id).set(report(overrides))
}

async function seedUser(id, overrides = {}) {
  await db
    .collection('users')
    .doc(id)
    .set({
      name: 'Ion Testescu',
      cnp: '1234567890123',
      email: 'ion@example.com',
      preferredLanguage: 'ro',
      status: 'active',
      ...overrides,
    })
}

async function seedProperty(id, overrides = {}) {
  await db
    .collection('properties')
    .doc(id)
    .set({
      ownerId: 'admin-uid',
      name: 'Apartament Centru',
      address: { street: 'Str. X', number: '1', city: 'Cluj-Napoca' },
      status: 'occupied',
      archived: false,
      services: [],
      ...overrides,
    })
}

/** Seeds a real Storage object and returns a realistic attachment ref
 * ({ name, type, path }) — the exact shape a real upload produces (debt #5:
 * the persisted reference is the Storage path, never a download URL), so
 * getSharedReportAttachmentCore exercises the real code path, not a
 * shortcut. */
async function seedAttachment(path, content, overrides = {}) {
  await bucket.file(path).save(Buffer.from(content), {
    contentType: 'application/pdf',
    metadata: { firebaseStorageDownloadTokens: 'tok-storage' },
  })
  return {
    name: 'invoice.pdf',
    type: 'pdf',
    path,
    ...overrides,
  }
}

beforeEach(async () => {
  await clearEmulators()
})

describe('toPublicReport / resolveAttachment — round-trip (guards attachmentsMeta/resolveAttachment staying in sync)', () => {
  function fullReport() {
    return report({
      rent: {
        amount: 1000,
        attachments: [
          { name: 'rent.pdf', type: 'pdf', path: 'reports/x/rent.pdf' },
        ],
      },
      maintenance: { amount: 50, attachments: [] },
      serviceCosts: [
        {
          serviceId: 'electricity',
          name: 'Electricity',
          amount: 120,
          attachments: [
            { name: 'e1.jpg', type: 'image', path: 'reports/x/e1.jpg' },
          ],
        },
        {
          serviceId: 'water',
          name: 'Water',
          amount: 80,
          attachments: [
            { name: 'w1.jpg', type: 'image', path: 'reports/x/w1.jpg' },
            { name: 'w2.pdf', type: 'pdf', path: 'reports/x/w2.pdf' },
          ],
        },
      ],
      otherExpenses: [
        {
          description: 'Repair',
          amount: 200,
          attachments: [
            { name: 'r.jpg', type: 'image', path: 'reports/x/r.jpg' },
          ],
        },
      ],
    })
  }

  it('every reference emitted resolves back to the SAME stored attachment', () => {
    const rawReport = fullReport()
    const pub = toPublicReport(rawReport, 'Apartament Centru')

    const emitted = [
      ...pub.rent.attachments,
      ...pub.maintenance.attachments,
      ...pub.serviceCosts.flatMap((l) => l.attachments),
      ...pub.otherExpenses.flatMap((l) => l.attachments),
    ]
    expect(emitted).toHaveLength(5) // rent(1) + maintenance(0) + service(1+2) + other(1)

    for (const att of emitted) {
      const resolved = resolveAttachment(rawReport, att.reference)
      expect(resolved).not.toBeNull()
      expect(resolved.name).toBe(att.name)
      expect(resolved.path).toBeDefined()
    }
  })

  it('never emits a url anywhere in the public shape', () => {
    const pub = toPublicReport(fullReport(), 'X')
    expect(JSON.stringify(pub)).not.toMatch(/https:\/\//)
  })

  it('drops serviceId — only the snapshotted name is exposed', () => {
    const pub = toPublicReport(fullReport(), 'X')
    expect(JSON.stringify(pub)).not.toContain('electricity')
    expect(pub.serviceCosts[0].name).toBe('Electricity')
  })

  it('resolveAttachment rejects an out-of-range or wrong-section reference', () => {
    const rawReport = fullReport()
    expect(resolveAttachment(rawReport, 'serviceCosts.9.0')).toBeNull()
    expect(resolveAttachment(rawReport, 'notASection.0')).toBeNull()
    expect(resolveAttachment(rawReport, 'rent.9')).toBeNull()
    expect(resolveAttachment(rawReport, null)).toBeNull()
  })
})

describe('getSharedReportCore — security', () => {
  it('a valid, non-revoked, SIGNED token returns the public report shape', async () => {
    await seedProperty('prop-1')
    await seedReport('r1', { shareToken: 'tok-valid' })

    const result = await getSharedReportCore('tok-valid')

    expect(result.finalTotal).toBe(1500)
    expect(result.dueDate).toBe('2026-07-05')
    expect(result.propertyName).toBe('Apartament Centru')
  })

  it('an unknown token is rejected with not-found', async () => {
    await expect(getSharedReportCore('does-not-exist')).rejects.toMatchObject({
      code: 'not-found',
    })
  })

  it('a REVOKED token is rejected with the SAME not-found (indistinguishable from unknown)', async () => {
    await seedReport('r2', {
      shareToken: 'tok-revoked',
      shareTokenRevoked: true,
    })

    await expect(getSharedReportCore('tok-revoked')).rejects.toMatchObject({
      code: 'not-found',
    })
  })

  it('a DRAFT report (even with a valid, non-revoked token) is rejected with the SAME not-found', async () => {
    await seedReport('r3', { shareToken: 'tok-draft', status: 'draft' })

    await expect(getSharedReportCore('tok-draft')).rejects.toMatchObject({
      code: 'not-found',
    })
  })

  it('the three rejection reasons are LITERALLY indistinguishable (same code AND message)', async () => {
    await seedReport('r4', {
      shareToken: 'tok-revoked-2',
      shareTokenRevoked: true,
    })
    await seedReport('r5', { shareToken: 'tok-draft-2', status: 'draft' })

    const [unknown, revoked, draft] = await Promise.allSettled([
      getSharedReportCore('never-existed'),
      getSharedReportCore('tok-revoked-2'),
      getSharedReportCore('tok-draft-2'),
    ])
    expect(unknown.reason.code).toBe(revoked.reason.code)
    expect(revoked.reason.code).toBe(draft.reason.code)
    expect(unknown.reason.message).toBe(revoked.reason.message)
    expect(revoked.reason.message).toBe(draft.reason.message)
  })

  it('ANTI-VACUITY: ZERO personal data anywhere in the output — no userId, ownerId, tenancyId keys, no name/cnp substring', async () => {
    await seedUser('tenant-1', { name: 'Ion Testescu', cnp: '1234567890123' })
    await seedReport('r6', { shareToken: 'tok-personal', userId: 'tenant-1' })

    const result = await getSharedReportCore('tok-personal')
    const serialized = JSON.stringify(result)

    expect(result).not.toHaveProperty('userId')
    expect(result).not.toHaveProperty('ownerId')
    expect(result).not.toHaveProperty('tenancyId')
    expect(result).not.toHaveProperty('status')
    expect(result).not.toHaveProperty('shareToken')
    expect(result).not.toHaveProperty('shareTokenRevoked')
    expect(serialized).not.toContain('Ion Testescu')
    expect(serialized).not.toContain('1234567890123')
    expect(serialized).not.toContain('tenant-1')
  })

  it('ANTI-VACUITY: never queries the users collection at all — structural, not filtered after the fact', async () => {
    const collectionSpy = vi.spyOn(db, 'collection')
    await seedReport('r7', { shareToken: 'tok-structural' })

    await getSharedReportCore('tok-structural')

    expect(collectionSpy.mock.calls.map((c) => c[0])).not.toContain('users')
    collectionSpy.mockRestore()
  })

  it('does not return paymentMethod/paymentDate/serviceId — trimmed allowlist', async () => {
    await seedReport('r8', {
      shareToken: 'tok-trim',
      paymentMethod: 'cash',
      paymentDate: '2026-07-10',
      serviceCosts: [
        {
          serviceId: 'electricity',
          name: 'Electricity',
          amount: 10,
          attachments: [],
        },
      ],
    })

    const result = await getSharedReportCore('tok-trim')

    expect(result).not.toHaveProperty('paymentMethod')
    expect(result).not.toHaveProperty('paymentDate')
    expect(JSON.stringify(result)).not.toContain('electricity')
  })
})

describe('getSharedReportAttachmentCore — security', () => {
  it('a valid token + a reference that belongs to the report returns the real bytes', async () => {
    const attachment = await seedAttachment(
      'reports/r9_2026-07/invoices/invoice.pdf',
      'hello invoice bytes',
    )
    await seedReport('r9', {
      shareToken: 'tok-att-valid',
      rent: { amount: 100, attachments: [attachment] },
    })

    const result = await getSharedReportAttachmentCore(
      'tok-att-valid',
      'rent.0',
    )

    expect(Buffer.from(result.base64, 'base64').toString()).toBe(
      'hello invoice bytes',
    )
    expect(result.contentType).toBe('application/pdf')
    expect(result.name).toBe('invoice.pdf')
  })

  it('a REVOKED token is rejected, even for a reference that would otherwise resolve', async () => {
    const attachment = await seedAttachment(
      'reports/r10_2026-07/invoices/invoice.pdf',
      'bytes',
    )
    await seedReport('r10', {
      shareToken: 'tok-att-revoked',
      shareTokenRevoked: true,
      rent: { amount: 100, attachments: [attachment] },
    })

    await expect(
      getSharedReportAttachmentCore('tok-att-revoked', 'rent.0'),
    ).rejects.toMatchObject({ code: 'not-found' })
  })

  it('a DRAFT report is rejected, even for a reference that would otherwise resolve', async () => {
    const attachment = await seedAttachment(
      'reports/r11_2026-07/invoices/invoice.pdf',
      'bytes',
    )
    await seedReport('r11', {
      shareToken: 'tok-att-draft',
      status: 'draft',
      rent: { amount: 100, attachments: [attachment] },
    })

    await expect(
      getSharedReportAttachmentCore('tok-att-draft', 'rent.0'),
    ).rejects.toMatchObject({ code: 'not-found' })
  })

  it('an unknown token is rejected', async () => {
    await expect(
      getSharedReportAttachmentCore('never-existed', 'rent.0'),
    ).rejects.toMatchObject({ code: 'not-found' })
  })

  it('OWNERSHIP CHECK: a reference that does NOT belong to the report is rejected (out of range)', async () => {
    await seedReport('r12', { shareToken: 'tok-att-wrong' })

    await expect(
      getSharedReportAttachmentCore('tok-att-wrong', 'serviceCosts.5.0'),
    ).rejects.toMatchObject({ code: 'not-found' })
  })

  it('OWNERSHIP CHECK: a reference belonging to a DIFFERENT report (different token) is rejected against the wrong one', async () => {
    const attachmentA = await seedAttachment(
      'reports/r13_2026-07/invoices/a.pdf',
      'report A bytes',
    )
    await seedReport('r13', {
      shareToken: 'tok-report-a',
      rent: { amount: 100, attachments: [attachmentA] },
    })
    // report B has its own rent line with ZERO attachments — 'rent.0' is
    // valid syntax but does not exist on THIS report.
    await seedReport('r14', {
      shareToken: 'tok-report-b',
      rent: { amount: 100, attachments: [] },
    })

    await expect(
      getSharedReportAttachmentCore('tok-report-b', 'rent.0'),
    ).rejects.toMatchObject({ code: 'not-found' })
  })

  it('reads the bucket EXPLICITLY (STORAGE_BUCKET), never the Admin SDK ambient default', () => {
    expect(STORAGE_BUCKET).toBe('tenants-manager-2026.firebasestorage.app')
  })
})
