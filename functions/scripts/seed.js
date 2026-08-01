/**
 * seed — demo data for the emulator, run manually. STRICT tooling, never cloud.
 *
 * Populates the Emulator Suite with a deterministic demo dataset so the app has
 * something to show without hand-entering it. It GROWS each milestone; do not seed
 * shapes the code does not have yet.
 *  - M1: the admin account + properties.
 *  - M2: one KYC-complete tenant (users) + an active tenancy on an occupied property,
 *    written DIRECTLY (not through finalizeKyc), with the denormalizations reproduced
 *    by hand — exactly what finalizeKyc would have written. The M1 `seed-prop-free`
 *    stays free and serves the "finalization allowed" case.
 *
 * Idempotent: every run DELETES the demo data and rewrites it identically, so the
 * emulator lands in the same state no matter how many times it runs — no
 * accumulation. The demo docs use FIXED ids (SEED_PROPERTY_IDS) so deletion targets
 * exactly them and never the properties the admin created by hand.
 *
 * Run (from the functions/ folder, with the emulators already started):
 *   npm run seed
 *
 * Like setAdminClaim, the Admin SDK needs no credentials against the emulator: it is
 * enough that FIRESTORE_EMULATOR_HOST / FIREBASE_AUTH_EMULATOR_HOST exist, which we
 * set below. The Admin SDK bypasses Security Rules entirely — so this touches neither
 * firestore.rules nor the rules test band.
 */
const fs = require('fs')
const path = require('path')
const { initializeApp } = require('firebase-admin/app')
const { getAuth } = require('firebase-admin/auth')
const { getFirestore, FieldValue } = require('firebase-admin/firestore')
const { getStorage } = require('firebase-admin/storage')
const { buildDownloadUrl } = require('../src/photoMigration')

const AUTH_EMULATOR_HOST = '127.0.0.1:9099' // must match firebase.json
const FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080' // must match firebase.json
const STORAGE_EMULATOR_HOST = '127.0.0.1:9199' // must match firebase.json

// The demo admin. A fixed uid makes `ownerId` on the seeded properties
// deterministic across runs.
const ADMIN = {
  uid: 'seed-admin',
  email: 'admin@test.ro',
  password: 'admin123',
}

// Fixed document ids for the demo properties — the deterministic marker. Deletion
// targets this exact list, so a manually created property (with an addDoc-random id)
// is never touched.
const SEED_PROPERTY_IDS = [
  'seed-prop-free',
  'seed-prop-services',
  'seed-prop-archived',
]

// A pinned UUID for the custom service. The real app generates it with
// crypto.randomUUID() at add time (SRS §6); the seed hardcodes one valid UUID so the
// state stays identical between runs — a fresh random id each run would break
// idempotency.
const CUSTOM_SERVICE_ID = '11111111-1111-4111-8111-111111111111'

// M2 fixtures — the occupied scenario. Fixed ids/uid keep the seed idempotent and
// the tenant's `users` doc id equal to their Auth uid (the finalizeKyc convention;
// the tenant app reads `tenancies` where userId == auth.uid, SRS §6).
const SEED_TENANT = {
  uid: 'seed-tenant',
  email: 'chirias@test.ro',
  password: 'chirias123',
}
const SEED_OCCUPIED_PROPERTY_ID = 'seed-prop-occupied'
const SEED_TENANCY_ID = 'seed-tenancy-occupied'

// M4 sub-stage 8 (Phase 2 validation fixture) — a SIGNED report on the
// occupied scenario above, id built the same way buildReportId
// (web/src/features/reports/hooks.js) would: `${propertyId}_${year}-${month
// padded}`. Fixed, not "current month": every other date in this file is a
// fixed literal too (activeTenancy's startDate/endDate below), for the same
// determinism reason — a re-run must produce identical state.
const SIGNED_REPORT_ID = `${SEED_OCCUPIED_PROPERTY_ID}_2026-07`
const REPORT_INVOICES_PREFIX = `reports/${SIGNED_REPORT_ID}/invoices/`
// Fixed for dev/seed reproducibility — the real app generates this with
// crypto.getRandomValues (web/src/features/reports/hooks.js's
// generateShareToken, M4 sub-stage 8 Phase 2), never a fixed literal.
const SIGNED_REPORT_SHARE_TOKEN = 'seed-fixed-share-token-for-dev-testing-only'

// Sub-stage F fixture — a second KYC-complete tenant with NO active tenancy.
// `SEED_TENANT` above always has one (the occupied scenario), so starting a NEW
// tenancy on THAT account is always correctly blocked by FR-CON-02 — there was no
// way to reach the "existing tenant, new tenancy" SUCCESS path (FR-TEN-07,
// accountCreated:false) live, only its rejection. This account has none, so it can.
const SEED_TENANT_NO_TENANCY = {
  uid: 'seed-tenant-free',
  email: 'cristina@test.ro',
  password: 'chirias123',
}

/**
 * The demo properties, in the EXACT shape a real document has — the fields written
 * by `useCreateProperty` (web/src/features/properties/hooks.js) over the form values
 * from `propertyFormDefaults` (schema.js): name, nested address, area, roomCount,
 * ownerId, services, status, archived. Optional fields that a user left blank are ''
 * (not missing), exactly as the form submits them.
 *
 * Catalog service `name` is the Romanian snapshot (ro.json), which is what the app
 * would store when the service is added from the RO interface.
 */
function demoProperties(ownerId) {
  return {
    // (a) free, no services
    'seed-prop-free': {
      name: 'Garsonieră Centru',
      address: {
        street: 'Str. Memorandumului',
        number: '4',
        city: 'Cluj-Napoca',
        county: 'Cluj',
        postalCode: '400114',
      },
      area: '38',
      roomCount: '1',
      ownerId,
      services: [],
      status: 'free',
      archived: false,
    },
    // (b) with services: 3 from the catalog + 1 custom
    'seed-prop-services': {
      name: 'Apartament Mărăști',
      address: {
        street: 'Str. Fabricii',
        number: '17B',
        city: 'Cluj-Napoca',
        county: 'Cluj',
        postalCode: '400620',
      },
      area: '58',
      roomCount: '2',
      ownerId,
      services: [
        { serviceId: 'electricity', name: 'Electricitate', source: 'catalog' },
        { serviceId: 'gas', name: 'Gaz', source: 'catalog' },
        { serviceId: 'water', name: 'Apă', source: 'catalog' },
        {
          serviceId: CUSTOM_SERVICE_ID,
          name: 'Curățenie scară',
          source: 'custom',
        },
      ],
      status: 'free',
      archived: false,
    },
    // (c) archived (soft-deleted) — status stays 'free' (separate axes, SRS §6)
    'seed-prop-archived': {
      name: 'Apartament vechi Gheorgheni',
      address: {
        street: 'Str. Alverna',
        number: '2',
        city: 'Cluj-Napoca',
        county: 'Cluj',
        postalCode: '400658',
      },
      area: '',
      roomCount: '',
      ownerId,
      services: [],
      status: 'free',
      archived: true,
    },
  }
}

/** The occupied property (SRS §6 properties shape). `status: 'occupied'` is set by
 * hand: normally it is computed from active tenancies, but there is no trigger yet,
 * so the seed reproduces the end state directly. */
function occupiedProperty(ownerId) {
  return {
    name: 'Apartament Zorilor',
    address: {
      street: 'Str. Observatorului',
      number: '34',
      city: 'Cluj-Napoca',
      county: 'Cluj',
      postalCode: '400363',
    },
    area: '72',
    roomCount: '3',
    ownerId,
    services: [
      { serviceId: 'electricity', name: 'Electricitate', source: 'catalog' },
      { serviceId: 'gas', name: 'Gaz', source: 'catalog' },
    ],
    status: 'occupied',
    archived: false,
  }
}

/** The KYC-complete tenant (SRS §6 users shape). Realistic profile with a well-formed
 * CNP, useful for exercising the duplicate-CNP path in later sub-stages. `status:
 * 'active'` — the account is active immediately (FR-TEN-24). */
function tenantUser() {
  return {
    name: 'Andrei Ionescu',
    dateOfBirth: '1988-05-12',
    email: SEED_TENANT.email,
    phone: '0745123456',
    preferredLanguage: 'ro',
    cnp: '1880512123456',
    idDocumentPhotos: [
      {
        url: 'gs://demo/seed-tenant/ci-front.jpg',
        name: 'ci-front.jpg',
        type: 'image',
      },
    ],
    previousAddress: 'Str. Dorobanților 5, Cluj-Napoca',
    emergencyContact: { name: 'Elena Ionescu', phone: '0745999888' },
    occupantCount: 2,
    smoker: false,
    pets: { has: true, type: 'pisică' },
    vehicle: { has: true, make: 'Volkswagen', plateNumber: 'CJ22XYZ' },
    employer: 'Endava',
    occupation: 'Software Developer',
    employmentDuration: 5,
    monthlyIncome: { source: 'salariu', amount: 9000 },
    guarantor: {
      name: 'Mihai Ionescu',
      cnp: '1550310123456',
      phone: '0740111222',
    },
    previousReference: { name: 'Ana Pop', phone: '0730444555' },
    status: 'active',
  }
}

/** The second KYC-complete tenant (Sub-stage F, SRS §6 users shape) — same shape as
 * `tenantUser()`, different identity (name/email/cnp), no pets/vehicle, and
 * deliberately NO tenancy written for them anywhere in this file. */
function tenantNoTenancyUser() {
  return {
    name: 'Cristina Marin',
    dateOfBirth: '1995-03-20',
    email: SEED_TENANT_NO_TENANCY.email,
    phone: '0755123456',
    preferredLanguage: 'ro',
    cnp: '2950320123456',
    idDocumentPhotos: [
      {
        url: 'gs://demo/seed-tenant-free/ci-front.jpg',
        name: 'ci-front.jpg',
        type: 'image',
      },
    ],
    previousAddress: 'Str. Republicii 10, Cluj-Napoca',
    emergencyContact: { name: 'Radu Marin', phone: '0755999888' },
    occupantCount: 1,
    smoker: false,
    pets: { has: false, type: '' },
    vehicle: { has: false, make: '', plateNumber: '' },
    employer: 'Bosch',
    occupation: 'QA Engineer',
    employmentDuration: 3,
    monthlyIncome: { source: 'salariu', amount: 7000 },
    guarantor: {
      name: 'Ioana Marin',
      cnp: '1650715123456',
      phone: '0740222333',
    },
    previousReference: { name: 'Bogdan Ilie', phone: '0730555666' },
    status: 'active',
  }
}

/**
 * The active tenancy (SRS §6 tenancies shape), with the denormalizations reproduced
 * BY HAND because the seed bypasses finalizeKyc: `tenantName` copied from the user,
 * `property { name, address }` copied from the occupied property. Without them the
 * tenant's security model breaks — the tenant app reads only this denormalized data,
 * never `users`/`properties` directly (SRS §6).
 */
function activeTenancy(ownerId, property) {
  return {
    userId: SEED_TENANT.uid,
    ownerId,
    propertyId: SEED_OCCUPIED_PROPERTY_ID,
    tenantName: tenantUser().name,
    property: { name: property.name, address: property.address },
    startDate: '2026-01-01',
    endDate: '2026-12-31',
    monthlyRent: 2500,
    securityDeposit: 2500,
    dueDay: 10,
    currentBalance: 0,
    status: 'active',
    attachedDocuments: [],
  }
}

/**
 * The signed monthlyReports fixture (SRS §6 shape) for M4 sub-stage 8 Phase 2
 * validation — deliberately UNPAID (no amountPaid/paymentMethod/paymentDate/
 * paymentStatus at all), so /r/:shareToken shows the "published, not yet
 * paid" state. `attachments: []` placeholders below are filled in by
 * `reseedSignedReport` AFTER the real Storage objects are uploaded (the
 * download URL only exists once the object does).
 */
function signedReport(ownerId) {
  const rent = 2500 // mirrors activeTenancy()'s monthlyRent — same demo tenancy
  const maintenance = 0
  const electricity = 150
  const gas = 80
  const total = rent + maintenance + electricity + gas
  return {
    ownerId,
    propertyId: SEED_OCCUPIED_PROPERTY_ID,
    tenancyId: SEED_TENANCY_ID,
    userId: SEED_TENANT.uid,
    month: 7,
    year: 2026,
    rent: { amount: rent, notes: '', attachments: [] },
    maintenance: { amount: maintenance, notes: '', attachments: [] },
    serviceCosts: [
      {
        serviceId: 'electricity',
        name: 'Electricitate',
        amount: electricity,
        notes: '',
        attachments: [],
      },
      {
        serviceId: 'gas',
        name: 'Gaz',
        amount: gas,
        notes: '',
        attachments: [],
      },
    ],
    otherExpenses: [],
    previousMonthArrears: 0,
    previousMonthCredit: 0,
    calculatedTotal: total,
    finalTotal: total,
    dueDate: '2026-07-10',
    status: 'signed',
    shareToken: SIGNED_REPORT_SHARE_TOKEN,
    shareTokenRevoked: false,
  }
}

function readProjectId() {
  const rcPath = path.join(__dirname, '..', '..', '.firebaserc')
  const rc = JSON.parse(fs.readFileSync(rcPath, 'utf8'))
  return rc.projects.default
}

/** Creates the demo admin if missing, then (re)asserts the admin claim. Both steps
 * are idempotent: a second run finds the account and just refreshes the claim. */
async function ensureAdmin() {
  const auth = getAuth()
  let user
  try {
    user = await auth.getUserByEmail(ADMIN.email)
    console.log(`Admin already exists: ${ADMIN.email} (uid: ${user.uid})`)
  } catch (error) {
    if (error.code !== 'auth/user-not-found') throw error
    user = await auth.createUser({
      uid: ADMIN.uid,
      email: ADMIN.email,
      password: ADMIN.password,
      emailVerified: true,
    })
    console.log(`Admin created: ${ADMIN.email} (uid: ${user.uid})`)
  }
  // The claim-setting is the same one-line SDK call setAdminClaim makes; it is the
  // primitive, not shared logic worth importing (setAdminClaim runs its own main()
  // on require, so it cannot be imported cleanly).
  await auth.setCustomUserClaims(user.uid, { admin: true })
  console.log('Admin claim { admin: true } asserted.')
  return user.uid
}

/** Deletes the fixed demo properties, then writes them fresh — the deterministic
 * rewrite. Deleting a non-existent doc is a no-op, so the first run is safe. */
async function reseedProperties(ownerId) {
  const db = getFirestore()
  const col = db.collection('properties')

  const batch = db.batch()
  for (const id of SEED_PROPERTY_IDS) batch.delete(col.doc(id))
  await batch.commit()
  console.log(`Deleted ${SEED_PROPERTY_IDS.length} existing demo properties.`)

  const props = demoProperties(ownerId)
  const writeBatch = db.batch()
  for (const [id, data] of Object.entries(props)) {
    writeBatch.set(col.doc(id), data)
  }
  await writeBatch.commit()
  console.log(`Wrote ${Object.keys(props).length} demo properties:`)
  for (const [id, data] of Object.entries(props)) {
    const tag = data.archived
      ? 'archived'
      : data.services.length
        ? `${data.services.length} services`
        : 'free, no services'
    console.log(`  - ${id}: "${data.name}" (${tag})`)
  }
}

/**
 * Creates the demo tenant Auth account if missing (idempotent, like `ensureAdmin`).
 *
 * DECISION — the Auth account IS created: it costs one call that mirrors
 * `ensureAdmin` exactly, and it lets the tenant sign in (`chirias@test.ro`) to
 * exercise the tenant app from M5 without hand-creating an account. It gets NO admin
 * claim. The fixed uid is reused as the `users` doc id, keeping the seed consistent
 * with finalizeKyc's `users/{authUid}`.
 */
async function ensureTenant() {
  const auth = getAuth()
  try {
    const user = await auth.getUserByEmail(SEED_TENANT.email)
    console.log(
      `Tenant already exists: ${SEED_TENANT.email} (uid: ${user.uid})`,
    )
    return user.uid
  } catch (error) {
    if (error.code !== 'auth/user-not-found') throw error
    const user = await auth.createUser({
      uid: SEED_TENANT.uid,
      email: SEED_TENANT.email,
      password: SEED_TENANT.password,
      displayName: tenantUser().name,
      emailVerified: true,
    })
    console.log(`Tenant created: ${SEED_TENANT.email} (uid: ${user.uid})`)
    return user.uid
  }
}

/**
 * Creates the second demo tenant's Auth account if missing — identical pattern to
 * `ensureTenant()`. No admin claim. `SEED_TENANT_NO_TENANCY.uid` is reused as the
 * `users` doc id, same finalizeKyc convention.
 */
async function ensureTenantNoTenancy() {
  const auth = getAuth()
  try {
    const user = await auth.getUserByEmail(SEED_TENANT_NO_TENANCY.email)
    console.log(
      `Tenant (no tenancy) already exists: ${SEED_TENANT_NO_TENANCY.email} (uid: ${user.uid})`,
    )
    return user.uid
  } catch (error) {
    if (error.code !== 'auth/user-not-found') throw error
    const user = await auth.createUser({
      uid: SEED_TENANT_NO_TENANCY.uid,
      email: SEED_TENANT_NO_TENANCY.email,
      password: SEED_TENANT_NO_TENANCY.password,
      displayName: tenantNoTenancyUser().name,
      emailVerified: true,
    })
    console.log(
      `Tenant (no tenancy) created: ${SEED_TENANT_NO_TENANCY.email} (uid: ${user.uid})`,
    )
    return user.uid
  }
}

/** Sub-stage F: (re)writes the second tenant's `users` doc — delete then rewrite,
 * same deterministic pattern as the rest of this file. Deliberately touches NO
 * `tenancies` document: that absence is the whole point of this fixture. */
async function reseedTenantNoTenancy() {
  const db = getFirestore()
  const userRef = db.collection('users').doc(SEED_TENANT_NO_TENANCY.uid)

  await userRef.delete()
  const user = tenantNoTenancyUser()
  await userRef.set(user)

  console.log(
    `  - user ${SEED_TENANT_NO_TENANCY.uid}: "${user.name}" (cnp ${user.cnp}), NO active tenancy`,
  )
}

/** The M2 occupied scenario: an occupied property + the tenant's `users` doc + the
 * active tenancy that links them, deleted then rewritten (deterministic, no dupes). */
async function reseedOccupied(ownerId) {
  const db = getFirestore()
  const propertyRef = db.collection('properties').doc(SEED_OCCUPIED_PROPERTY_ID)
  const userRef = db.collection('users').doc(SEED_TENANT.uid)
  const tenancyRef = db.collection('tenancies').doc(SEED_TENANCY_ID)

  const delBatch = db.batch()
  delBatch.delete(propertyRef)
  delBatch.delete(userRef)
  delBatch.delete(tenancyRef)
  await delBatch.commit()

  const property = occupiedProperty(ownerId)
  const writeBatch = db.batch()
  writeBatch.set(propertyRef, property)
  writeBatch.set(userRef, tenantUser())
  writeBatch.set(tenancyRef, activeTenancy(ownerId, property))
  await writeBatch.commit()

  console.log('Wrote the occupied scenario:')
  console.log(
    `  - property ${SEED_OCCUPIED_PROPERTY_ID}: "${property.name}" (occupied)`,
  )
  console.log(
    `  - user ${SEED_TENANT.uid}: "${tenantUser().name}" (cnp ${tenantUser().cnp})`,
  )
  console.log(
    `  - tenancy ${SEED_TENANCY_ID}: active, denormalized tenantName + property`,
  )
}

/** Deletes every object under `prefix` — idempotent Storage cleanup, same
 * discipline as the Firestore delete-then-write pattern used everywhere
 * else in this file. A missing object is not an error (`.catch(() => {})`),
 * same convention as `deleteObjects` (functions/src/photoMigration.js). */
async function clearSeedAttachments(bucket, prefix) {
  const [files] = await bucket.getFiles({ prefix })
  await Promise.all(files.map((file) => file.delete().catch(() => {})))
}

/** Uploads one synthetic attachment and returns its download URL in the
 * EXACT shape a real client upload produces (fileUpload.js's
 * `uploadAttachment`: `{url, name, type}`, url from `getDownloadURL`) —
 * built here via `buildDownloadUrl` (photoMigration.js), which is
 * emulator-aware (FIREBASE_STORAGE_EMULATOR_HOST) and round-trips with
 * `parseStoragePath`, the exact function getSharedReportAttachmentCore uses
 * to resolve it back to a Storage path (functions/src/sharedReport.js). No
 * real file content — a synthetic Buffer with the right `contentType` is
 * enough to exercise the real Storage read path end to end. */
async function uploadSeedAttachment(
  bucket,
  filePath,
  content,
  contentType,
  downloadToken,
) {
  await bucket.file(filePath).save(Buffer.from(content), {
    contentType,
    metadata: { firebaseStorageDownloadTokens: downloadToken },
  })
  return buildDownloadUrl(bucket.name, filePath, downloadToken)
}

/**
 * M4 sub-stage 8 (Phase 2 validation fixture): a SIGNED report on the
 * occupied scenario, with 2 real Storage attachments and a fixed
 * shareToken, so /r/:shareToken has something real to open without hand-
 * creating a report through the admin UI first.
 *
 * `STORAGE_BUCKET` is required HERE (lazily), not at module top — requiring
 * functions/src/sharedReport.js runs its own `if (!getApps().length)
 * initializeApp()` guard at require-time. If that ran before `main()`'s own
 * `initializeApp({ projectId })` below, the app would already exist by the
 * time `main()` reaches it and `initializeApp` would throw ("default app
 * already exists"). By the time THIS function runs, `main()` has already
 * initialized the app, so `sharedReport.js`'s guard correctly no-ops and
 * this just reads its exported constant.
 *
 * currentBalance on the tenancy is updated BY HAND to reproduce what
 * `onReportWrite` (functions/src/reports.js) would have computed — Admin
 * SDK writes bypass Firestore triggers entirely, so that trigger never
 * actually fires here. Same formula, not a magic number:
 *   (mostRecent.finalTotal ?? 0) - (mostRecent.amountPaid ?? 0)
 * `amountPaid` is absent (this report is deliberately UNPAID), so it
 * collapses to `finalTotal - 0`.
 */
async function reseedSignedReport(ownerId) {
  const { STORAGE_BUCKET } = require('../src/sharedReport')

  const db = getFirestore()
  const bucket = getStorage().bucket(STORAGE_BUCKET)
  const reportRef = db.collection('monthlyReports').doc(SIGNED_REPORT_ID)
  const tenancyRef = db.collection('tenancies').doc(SEED_TENANCY_ID)

  await reportRef.delete()
  await clearSeedAttachments(bucket, REPORT_INVOICES_PREFIX)

  const rentUrl = await uploadSeedAttachment(
    bucket,
    `${REPORT_INVOICES_PREFIX}rent-invoice.pdf`,
    'seed rent invoice — synthetic bytes, not a real PDF',
    'application/pdf',
    'seed-rent-token',
  )
  const electricityUrl = await uploadSeedAttachment(
    bucket,
    `${REPORT_INVOICES_PREFIX}electricity-invoice.jpg`,
    'seed electricity invoice — synthetic bytes, not a real JPEG',
    'image/jpeg',
    'seed-electricity-token',
  )

  const report = signedReport(ownerId)
  report.rent.attachments = [
    { url: rentUrl, name: 'rent-invoice.pdf', type: 'pdf' },
  ]
  report.serviceCosts[0].attachments = [
    { url: electricityUrl, name: 'electricity-invoice.jpg', type: 'image' },
  ]

  await reportRef.set({
    ...report,
    signedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  })

  await tenancyRef.update({ currentBalance: report.finalTotal })

  console.log('Wrote the signed report fixture:')
  console.log(
    `  - report ${SIGNED_REPORT_ID}: signed, finalTotal ${report.finalTotal} lei, UNPAID`,
  )
  console.log(`  - 2 attachments uploaded under ${REPORT_INVOICES_PREFIX}`)
  console.log(
    `  - tenancy ${SEED_TENANCY_ID}.currentBalance -> ${report.finalTotal} (finalTotal - amountPaid??0)`,
  )
}

async function main() {
  // Emulator only. A production seed is out of scope — this data is for local dev.
  process.env.FIREBASE_AUTH_EMULATOR_HOST = AUTH_EMULATOR_HOST
  process.env.FIRESTORE_EMULATOR_HOST = FIRESTORE_EMULATOR_HOST
  process.env.FIREBASE_STORAGE_EMULATOR_HOST = STORAGE_EMULATOR_HOST

  const projectId = readProjectId()
  initializeApp({ projectId })
  console.log(
    `Project: ${projectId} — target: emulator ` +
      `(auth ${AUTH_EMULATOR_HOST}, firestore ${FIRESTORE_EMULATOR_HOST}, storage ${STORAGE_EMULATOR_HOST})\n`,
  )

  const ownerId = await ensureAdmin()
  await reseedProperties(ownerId)
  await ensureTenant()
  await reseedOccupied(ownerId)
  await reseedSignedReport(ownerId)
  await ensureTenantNoTenancy()
  await reseedTenantNoTenancy()

  console.log('\n✅ Seed complete.')
  console.log(`   Admin sign-in:  ${ADMIN.email} / ${ADMIN.password}`)
  console.log(
    `   Tenant sign-in (active tenancy): ${SEED_TENANT.email} / ${SEED_TENANT.password}`,
  )
  console.log(
    `   Tenant sign-in (no tenancy):     ${SEED_TENANT_NO_TENANCY.email} / ${SEED_TENANT_NO_TENANCY.password}`,
  )
  console.log(
    `   Shared report link (unauthenticated, M4 sub-stage 8): http://localhost:5173/r/${SIGNED_REPORT_SHARE_TOKEN}`,
  )
}

main().catch((error) => {
  console.error('Error:', error)
  process.exit(1)
})
