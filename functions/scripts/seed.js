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
const { getFirestore } = require('firebase-admin/firestore')

const AUTH_EMULATOR_HOST = '127.0.0.1:9099' // must match firebase.json
const FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080' // must match firebase.json

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
    occupantCount: '2',
    smoker: false,
    pets: { has: true, type: 'pisică' },
    vehicle: { has: true, make: 'Volkswagen', plateNumber: 'CJ22XYZ' },
    employer: 'Endava',
    occupation: 'Software Developer',
    employmentDuration: '5 ani',
    monthlyIncome: { source: 'salariu', amount: '9000' },
    guarantor: {
      name: 'Mihai Ionescu',
      cnp: '1550310123456',
      phone: '0740111222',
    },
    previousReference: { name: 'Ana Pop', phone: '0730444555' },
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
    monthlyRent: '2500',
    securityDeposit: '2500',
    dueDay: '10',
    currentBalance: 0,
    status: 'active',
    attachedDocuments: [],
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

async function main() {
  // Emulator only. A production seed is out of scope — this data is for local dev.
  process.env.FIREBASE_AUTH_EMULATOR_HOST = AUTH_EMULATOR_HOST
  process.env.FIRESTORE_EMULATOR_HOST = FIRESTORE_EMULATOR_HOST

  const projectId = readProjectId()
  initializeApp({ projectId })
  console.log(
    `Project: ${projectId} — target: emulator ` +
      `(auth ${AUTH_EMULATOR_HOST}, firestore ${FIRESTORE_EMULATOR_HOST})\n`,
  )

  const ownerId = await ensureAdmin()
  await reseedProperties(ownerId)
  await ensureTenant()
  await reseedOccupied(ownerId)

  console.log('\n✅ Seed complete.')
  console.log(`   Admin sign-in:  ${ADMIN.email} / ${ADMIN.password}`)
  console.log(
    `   Tenant sign-in: ${SEED_TENANT.email} / ${SEED_TENANT.password}`,
  )
}

main().catch((error) => {
  console.error('Error:', error)
  process.exit(1)
})
