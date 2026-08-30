import { beforeEach, describe, expect, it } from 'vitest'
import { getFirestore } from 'firebase-admin/firestore'
import {
  exportTenantDataCore,
  exportTenantDataHandler,
} from '../src/tenantExport.js'
// Piggybacks on kyc.js's initializeApp() at module load, same as kyc.test.js.
import '../src/kyc.js'

// Functions test — the REAL boundary (Firestore emulator), no mocks. Started
// via `npm run test:emulator`.

const PROJECT_ID = 'tenants-manager-2026'
const db = getFirestore()

async function clearFirestore() {
  const fsHost = process.env.FIRESTORE_EMULATOR_HOST
  await fetch(
    `http://${fsHost}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`,
    { method: 'DELETE' },
  )
}

const SUBJECT = {
  name: 'Maria Ionescu',
  email: 'maria@example.com',
  cnp: '2900101111111',
  preferredLanguage: 'ro',
  status: 'inactive-readonly',
  idDocumentPhotos: [
    {
      path: 'users/subject/documents/ci-front.jpg',
      name: 'ci-front.jpg',
      type: 'image',
    },
  ],
  guarantor: {
    name: 'Vasile Garant',
    cnp: '1650102334455',
    phone: '0744555666',
    idDocumentPhotos: [
      {
        path: 'users/subject/guarantor/g-ci.jpg',
        name: 'g-ci.jpg',
        type: 'image',
      },
    ],
  },
  previousReference: { name: 'Georgeta Fostă', phone: '0755666777' },
}

const OTHER_USER = {
  name: 'Ion Celalalt',
  email: 'ion@example.com',
  cnp: '1900202222222',
  status: 'active',
}

async function seedGraph() {
  await db.collection('users').doc('subject').set(SUBJECT)
  await db.collection('users').doc('other').set(OTHER_USER)

  await db
    .collection('tenancies')
    .doc('t-active')
    .set({
      userId: 'subject',
      ownerId: 'admin',
      propertyId: 'prop-1',
      tenantName: 'Maria Ionescu',
      property: { name: 'Apartament Centru', address: { city: 'Cluj' } },
      startDate: '2026-01-01',
      endDate: '2027-01-01',
      monthlyRent: 2000,
      dueDay: 5,
      status: 'active',
      currentBalance: 0,
      attachedDocuments: [
        {
          path: 'tenancies/t-active/contract/c.pdf',
          name: 'c.pdf',
          type: 'pdf',
        },
      ],
    })
  await db
    .collection('tenancies')
    .doc('t-ended')
    .set({
      userId: 'subject',
      ownerId: 'admin',
      propertyId: 'prop-0',
      tenantName: 'Maria Ionescu',
      property: { name: 'Garsonieră Veche', address: {} },
      startDate: '2024-01-01',
      endDate: '2025-12-31',
      status: 'ended',
      closingBalance: 0,
      depositSettlement: {
        items: [
          {
            description: 'Zugrăvit',
            amount: 300,
            attachments: [
              {
                path: 'tenancies/t-ended/settlement/inv.pdf',
                name: 'inv.pdf',
                type: 'pdf',
              },
            ],
          },
        ],
        deducted: 300,
        toReturn: 700,
        ownerBears: 0,
        settledAt: new Date('2026-01-15T00:00:00Z'),
      },
    })
  // Another tenant's tenancy — must NOT surface in the bundle.
  await db
    .collection('tenancies')
    .doc('t-other')
    .set({
      userId: 'other',
      ownerId: 'admin',
      propertyId: 'prop-9',
      tenantName: 'Ion Celalalt',
      property: { name: 'Vila Nordului', address: {} },
      status: 'active',
    })

  // Two signed reports + one draft for the subject.
  await db
    .collection('monthlyReports')
    .doc('r-2026-01')
    .set({
      ownerId: 'admin',
      propertyId: 'prop-1',
      tenancyId: 't-active',
      userId: 'subject',
      month: 1,
      year: 2026,
      status: 'signed',
      dueDate: '2026-01-05',
      finalTotal: 2100,
      paymentStatus: 'paid',
      amountPaid: 2100,
      paymentMethod: 'bank_transfer',
      paymentDate: '2026-01-03',
      rent: { amount: 2000, attachments: [] },
      serviceCosts: [
        {
          serviceId: 'electricity',
          name: 'Electricitate',
          amount: 100,
          attachments: [
            {
              path: 'reports/r-2026-01/invoices/e.jpg',
              name: 'e.jpg',
              type: 'image',
            },
          ],
        },
      ],
    })
  await db.collection('monthlyReports').doc('r-2026-02').set({
    ownerId: 'admin',
    propertyId: 'prop-1',
    tenancyId: 't-active',
    userId: 'subject',
    month: 2,
    year: 2026,
    status: 'signed',
    dueDate: '2026-02-05',
    finalTotal: 2000,
    paymentStatus: 'unpaid',
  })
  await db.collection('monthlyReports').doc('r-2026-03-draft').set({
    ownerId: 'admin',
    propertyId: 'prop-1',
    tenancyId: 't-active',
    userId: 'subject',
    month: 3,
    year: 2026,
    status: 'draft',
    finalTotal: 2000,
  })
  // Another tenant's signed report — must NOT surface.
  await db.collection('monthlyReports').doc('r-other').set({
    ownerId: 'admin',
    propertyId: 'prop-9',
    tenancyId: 't-other',
    userId: 'other',
    month: 1,
    year: 2026,
    status: 'signed',
    finalTotal: 5000,
  })
}

beforeEach(async () => {
  await clearFirestore()
  await seedGraph()
})

describe('exportTenantData — FR-TEN-26 (per-subject bundle)', () => {
  it('bundles the whole users doc, every tenancy, and only SIGNED reports', async () => {
    const bundle = await exportTenantDataCore('subject')

    expect(bundle.subjectUserId).toBe('subject')
    expect(bundle.profile.id).toBe('subject')
    expect(bundle.profile.cnp).toBe('2900101111111')

    expect(bundle.tenancies.map((t) => t.id).sort()).toEqual([
      't-active',
      't-ended',
    ])

    // Drafts are excluded by FR-TEN-26's own wording.
    expect(bundle.signedReports.map((r) => r.id)).toEqual([
      'r-2026-01',
      'r-2026-02',
    ])
    expect(bundle.signedReports.some((r) => r.status !== 'signed')).toBe(false)
    expect(bundle.counts).toEqual({
      tenancies: 2,
      reportsTotal: 3,
      signedReports: 2,
      documents: expect.any(Number),
    })
  })

  it('derives payment history from the signed reports', async () => {
    const bundle = await exportTenantDataCore('subject')
    expect(bundle.paymentHistory).toEqual([
      {
        reportId: 'r-2026-01',
        month: 1,
        year: 2026,
        dueDate: '2026-01-05',
        finalTotal: 2100,
        paymentStatus: 'paid',
        amountPaid: 2100,
        paymentMethod: 'bank_transfer',
        paymentDate: '2026-01-03',
      },
      {
        reportId: 'r-2026-02',
        month: 2,
        year: 2026,
        dueDate: '2026-02-05',
        finalTotal: 2000,
        paymentStatus: 'unpaid',
        amountPaid: null,
        paymentMethod: null,
        paymentDate: null,
      },
    ])
  })

  it('lists stored documents as a manifest (path/name/type/source), never bytes — including guarantor ID photos', async () => {
    const bundle = await exportTenantDataCore('subject')
    const sources = bundle.documentManifest.map((d) => d.source)

    expect(sources).toContain('tenant-id')
    expect(sources).toContain('guarantor-id')
    expect(sources).toContain('contract')
    expect(sources).toContain('deposit-settlement')
    expect(sources).toContain('report-cost-line')

    for (const entry of bundle.documentManifest) {
      expect(Object.keys(entry).sort()).toEqual([
        'name',
        'path',
        'source',
        'type',
      ])
      expect(entry).not.toHaveProperty('bytes')
      expect(entry).not.toHaveProperty('url')
      expect(entry).not.toHaveProperty('downloadUrl')
    }

    const guarantor = bundle.documentManifest.find(
      (d) => d.source === 'guarantor-id',
    )
    expect(guarantor.path).toBe('users/subject/guarantor/g-ci.jpg')
  })

  it('contains NOTHING about any other subject', async () => {
    const bundle = await exportTenantDataCore('subject')
    const serialized = JSON.stringify(bundle)

    expect(serialized).not.toContain('Ion Celalalt')
    expect(serialized).not.toContain('1900202222222')
    expect(serialized).not.toContain('Vila Nordului')
    expect(serialized).not.toContain('r-other')
    expect(serialized).not.toContain('t-other')
    expect(serialized).not.toContain('"other"')
  })

  it('never reads the mail collection', async () => {
    // The subject has a credentials email sitting in `mail` in clear text
    // (§4.1 accepted-risk a). The bundle must not carry it.
    await db
      .collection('mail')
      .doc('m1')
      .set({
        to: ['maria@example.com'],
        message: { subject: 'Contul tău', text: 'parola: SECRET-PLAINTEXT-PW' },
        type: 'credentials',
      })
    const bundle = await exportTenantDataCore('subject')
    expect(JSON.stringify(bundle)).not.toContain('SECRET-PLAINTEXT-PW')
  })

  it('rejects an unknown user with not-found', async () => {
    await expect(exportTenantDataCore('ghost')).rejects.toMatchObject({
      code: 'not-found',
    })
  })
})

describe('exportTenantData — handler auth', () => {
  it('rejects a non-admin caller with permission-denied', async () => {
    await expect(
      exportTenantDataHandler({
        auth: { uid: 'u1', token: {} },
        data: { userId: 'subject' },
      }),
    ).rejects.toMatchObject({ code: 'permission-denied' })
  })

  it('rejects a missing userId with invalid-argument', async () => {
    await expect(
      exportTenantDataHandler({
        auth: { uid: 'admin', token: { admin: true } },
        data: {},
      }),
    ).rejects.toMatchObject({ code: 'invalid-argument' })
  })

  it('an admin caller gets the bundle', async () => {
    const bundle = await exportTenantDataHandler({
      auth: { uid: 'admin', token: { admin: true } },
      data: { userId: 'subject' },
    })
    expect(bundle.subjectUserId).toBe('subject')
  })
})
