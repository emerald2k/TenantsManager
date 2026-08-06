/**
 * seed — demo data for the emulator, run manually. STRICT tooling, never cloud.
 *
 * Populates the Emulator Suite with a deterministic demo dataset so the app has
 * something to show without hand-entering it. Grows ahead of a milestone's own
 * sub-stages once their SRS requirements are pinned, so later sub-stages have
 * real data to build against — not strictly lockstep with already-shipped code
 * (M5 sub-stage 4 rewrite: the fixtures below serve `/app/history`'s two-year
 * accordion, `/app/contract`, and the FR-TAPP-06 persistent banner, none of
 * which have landed yet, alongside the dashboard states sub-stage 3 already
 * ships).
 *
 * Four tenant scenarios, one Firestore write graph each:
 *  - `seed-tenant` (active tenancy, `seed-prop-occupied`): a 2-year, 7-report
 *    history (6 signed + 1 draft) hitting all four payment-badge states.
 *  - `seed-tenant-empty` (active tenancy, `seed-prop-empty`): zero reports —
 *    FR-TAPP-01's empty state.
 *  - `seed-tenant-ended` (ended tenancy, `seed-prop-ended`): 2 fully-settled
 *    signed reports — FR-TAPP-06's ended-label/banner.
 *  - `seed-tenant-free`: unchanged from before this rewrite — a KYC-complete
 *    tenant with NO tenancy at all (the no-tenancy dashboard state).
 *
 * Idempotent: every run DELETES the demo data and rewrites it identically, so the
 * emulator lands in the same state no matter how many times it runs — no
 * accumulation. The demo docs use FIXED ids so deletion targets exactly them and
 * never data created manually through the app UI.
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
const {
  getFirestore,
  FieldValue,
  Timestamp,
} = require('firebase-admin/firestore')
const { getStorage } = require('firebase-admin/storage')

const AUTH_EMULATOR_HOST = '127.0.0.1:9099' // must match firebase.json
const FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080' // must match firebase.json
const STORAGE_EMULATOR_HOST = '127.0.0.1:9199' // must match firebase.json

// The demo admin. A fixed uid makes `ownerId` on every seeded doc
// deterministic across runs.
const ADMIN = {
  uid: 'seed-admin',
  email: 'admin@test.ro',
  password: 'admin123',
}

// Fixed document ids for the 3 pure admin-demo properties — no tenant
// attached to any of them. Deletion targets this exact list, so a manually
// created property (with an addDoc-random id) is never touched.
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

// ─────────────────────────── Scenario 1: seed-tenant (occupied, rich history) ──

const SEED_TENANT = {
  uid: 'seed-tenant',
  email: 'chirias@test.ro',
  password: 'chirias123',
}
const SEED_OCCUPIED_PROPERTY_ID = 'seed-prop-occupied'
const SEED_TENANCY_ID = 'seed-tenancy-occupied'
// Fixed for dev/seed reproducibility — the real app generates this with
// crypto.getRandomValues (web/src/features/reports/hooks.js's
// generateShareToken), never a fixed literal. Kept on the SAME report
// (2026-07) this token has always pointed at, so the already-documented
// `/r/{token}` demo link keeps working unchanged across this rewrite.
const SIGNED_REPORT_SHARE_TOKEN = 'seed-fixed-share-token-for-dev-testing-only'

// ─────────────────────────── Scenario 2: seed-tenant-empty (active, no reports) ─

const SEED_TENANT_EMPTY = {
  uid: 'seed-tenant-empty',
  email: 'ioana@test.ro',
  password: 'chirias123',
}
const SEED_EMPTY_PROPERTY_ID = 'seed-prop-empty'
const SEED_TENANCY_EMPTY_ID = 'seed-tenancy-empty'

// ─────────────────────────── Scenario 3: seed-tenant-ended (ended tenancy) ──────

const SEED_TENANT_ENDED = {
  uid: 'seed-tenant-ended',
  email: 'radu@test.ro',
  password: 'chirias123',
}
const SEED_ENDED_PROPERTY_ID = 'seed-prop-ended'
const SEED_TENANCY_ENDED_ID = 'seed-tenancy-ended'
const SEED_TENANCY_ENDED_DATE = '2026-02-28'

// ─────────────────────────── Scenario 4: seed-tenant-free (no tenancy at all) ───
//
// Kept as-is, id and email UNCHANGED across this rewrite (M5 sub-stage 4 plan,
// §1 "Decision, flagged... Approved"): renaming to `seed-tenant-no-tenancy`
// would read more consistently next to the three scenario names above, but
// would orphan this fixed id's Auth account/`users` doc from any seed run
// before this rewrite shipped, since a renamed script would never again
// reference the old id to delete it. Kept as-is to avoid that orphan risk for
// a purely cosmetic gain.
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

/** `seed-tenant-empty`'s property — occupied, no report has ever been created
 * on it yet (matches a brand-new tenancy). */
function emptyProperty(ownerId) {
  return {
    name: 'Apartament Mănăștur',
    address: {
      street: 'Str. Arieșului',
      number: '12',
      city: 'Cluj-Napoca',
      county: 'Cluj',
      postalCode: '400650',
    },
    area: '45',
    roomCount: '1',
    ownerId,
    services: [
      { serviceId: 'electricity', name: 'Electricitate', source: 'catalog' },
      { serviceId: 'gas', name: 'Gaz', source: 'catalog' },
    ],
    status: 'occupied',
    archived: false,
  }
}

/** `seed-tenant-ended`'s (former) property. `status: 'free'` — freed on end,
 * matching `endTenancy`'s real transaction (`functions/src/endTenancy.js`):
 * an occupied property whose only tenancy has ended is free again. */
function endedProperty(ownerId) {
  return {
    name: 'Apartament Grigorescu',
    address: {
      street: 'Str. Donath',
      number: '8',
      city: 'Cluj-Napoca',
      county: 'Cluj',
      postalCode: '400293',
    },
    area: '65',
    roomCount: '2',
    ownerId,
    services: [
      { serviceId: 'electricity', name: 'Electricitate', source: 'catalog' },
      { serviceId: 'gas', name: 'Gaz', source: 'catalog' },
    ],
    status: 'free',
    archived: false,
  }
}

/** The KYC-complete tenant (SRS §6 users shape). Realistic profile with a well-formed
 * CNP, useful for exercising the duplicate-CNP path in later sub-stages. `status:
 * 'active'` — the account is active immediately (FR-TEN-24).
 *
 * `idDocumentPhotos` is DELIBERATELY absent here — it is a real Storage
 * upload (`uploadSeedIdPhoto`), merged in by the caller at write time, same
 * pattern as `attachedDocuments` on the tenancy. Debt #5's investigation
 * found this profile hand-writing a fake `gs://demo/...` literal instead,
 * never actually uploaded — every seeded tenant's ID photo rendered as a
 * broken image in the Profile tab's lightbox. Fixed by routing through the
 * exact same `uploadSeedAttachment` mechanism the contract/invoice
 * attachments already used correctly. */
function tenantUser() {
  return {
    name: 'Andrei Ionescu',
    dateOfBirth: '1988-05-12',
    email: SEED_TENANT.email,
    phone: '0745123456',
    preferredLanguage: 'ro',
    cnp: '1880512123456',
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

/** `seed-tenant-empty`'s KYC-complete profile — same shape as `tenantUser()`,
 * a distinct identity, freshly moved in (no reports yet). */
function tenantEmptyUser() {
  return {
    name: 'Ioana Dumitrescu',
    dateOfBirth: '1996-08-15',
    email: SEED_TENANT_EMPTY.email,
    phone: '0745234567',
    preferredLanguage: 'ro',
    cnp: '2960815234567',
    previousAddress: 'Str. Traian 22, Cluj-Napoca',
    emergencyContact: { name: 'Cosmin Dumitrescu', phone: '0745888777' },
    occupantCount: 1,
    smoker: false,
    pets: { has: false, type: '' },
    vehicle: { has: false, make: '', plateNumber: '' },
    employer: 'Betfair Romania',
    occupation: 'UX Designer',
    employmentDuration: 2,
    monthlyIncome: { source: 'salariu', amount: 6500 },
    guarantor: {
      name: 'Vasile Dumitrescu',
      cnp: '1600210234567',
      phone: '0740333444',
    },
    previousReference: { name: 'Diana Rus', phone: '0730666777' },
    status: 'active',
  }
}

/** `seed-tenant-ended`'s KYC-complete profile — same shape as `tenantUser()`,
 * a distinct identity. `status` stays `'active'` on `tenantEndedUser()` itself
 * — `endTenancy` is what flips it to `'inactive-readonly'`, applied by hand
 * in `endedTenancy()`'s companion write, not here (see `reseedEndedScenario`). */
function tenantEndedUser() {
  return {
    name: 'Radu Constantin',
    dateOfBirth: '1975-06-04',
    email: SEED_TENANT_ENDED.email,
    phone: '0745345678',
    preferredLanguage: 'ro',
    cnp: '1750604234567',
    previousAddress: 'Str. Horea 15, Cluj-Napoca',
    emergencyContact: { name: 'Elena Constantin', phone: '0745777666' },
    occupantCount: 1,
    smoker: true,
    pets: { has: false, type: '' },
    vehicle: { has: true, make: 'Dacia', plateNumber: 'CJ11ABC' },
    employer: 'Emerson',
    occupation: 'Mechanical Engineer',
    employmentDuration: 8,
    monthlyIncome: { source: 'salariu', amount: 7200 },
    guarantor: {
      name: 'Maria Constantin',
      cnp: '2680920234567',
      phone: '0740555666',
    },
    previousReference: { name: 'Bogdan Petre', phone: '0730888999' },
    status: 'active',
  }
}

/** The second KYC-complete tenant (Sub-stage F, SRS §6 users shape) — same shape as
 * `tenantUser()`, different identity (name/email/cnp), no pets/vehicle, and
 * deliberately NO tenancy written for them anywhere in this file. UNCHANGED
 * across the M5 sub-stage 4 rewrite. */
function tenantNoTenancyUser() {
  return {
    name: 'Cristina Marin',
    dateOfBirth: '1995-03-20',
    email: SEED_TENANT_NO_TENANCY.email,
    phone: '0755123456',
    preferredLanguage: 'ro',
    cnp: '2950320123456',
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
 * `property { name, address }` copied from the property. Without them the tenant's
 * security model breaks — the tenant app reads only this denormalized data, never
 * `users`/`properties` directly (SRS §6).
 *
 * `startDate` moved from `2026-01-01` (pre-sub-stage-4) to `2025-10-01` — the
 * one change needed to make room for the 2025 history months below.
 * `currentBalance` starts at `0`; the real value is hand-set AFTER all of this
 * tenancy's reports are written (`reseedOccupiedScenario`), not here.
 */
function activeTenancy(ownerId, property) {
  return {
    userId: SEED_TENANT.uid,
    ownerId,
    propertyId: SEED_OCCUPIED_PROPERTY_ID,
    tenantName: tenantUser().name,
    property: { name: property.name, address: property.address },
    startDate: '2025-10-01',
    endDate: '2026-12-31',
    monthlyRent: 2500,
    securityDeposit: 2500,
    dueDay: 10,
    currentBalance: 0,
    status: 'active',
    attachedDocuments: [],
  }
}

/** `seed-tenant-empty`'s tenancy — active, started recently, ZERO reports
 * (the whole point of this fixture — FR-TAPP-01's empty state). */
function emptyTenancy(ownerId, property) {
  return {
    userId: SEED_TENANT_EMPTY.uid,
    ownerId,
    propertyId: SEED_EMPTY_PROPERTY_ID,
    tenantName: tenantEmptyUser().name,
    property: { name: property.name, address: property.address },
    startDate: '2026-07-20',
    endDate: '2027-07-19',
    monthlyRent: 2200,
    securityDeposit: 2200,
    dueDay: 20,
    currentBalance: 0,
    status: 'active',
    attachedDocuments: [],
  }
}

/**
 * `seed-tenant-ended`'s tenancy — `status: 'ended'`, `endedAt` a REAL
 * Firestore `Timestamp` (`Timestamp.fromDate`, NOT a string — sub-stage 2's
 * `useMyTenancy` calls `.toMillis()` on it directly; a string would throw
 * the first time any page touches this tenancy). Fixed, not
 * `FieldValue.serverTimestamp()`, for the same determinism reason every
 * other date literal in this file is fixed: a re-run must produce
 * byte-identical state. `currentBalance` starts at `0`; hand-set again
 * (still `0`) after this tenancy's two reports are written, for symmetry
 * with the occupied scenario and to make the "always settled" invariant
 * explicit at the write site, not just implied by never touching it.
 */
function endedTenancy(ownerId, property) {
  return {
    userId: SEED_TENANT_ENDED.uid,
    ownerId,
    propertyId: SEED_ENDED_PROPERTY_ID,
    tenantName: tenantEndedUser().name,
    property: { name: property.name, address: property.address },
    startDate: '2025-09-01',
    endDate: SEED_TENANCY_ENDED_DATE,
    monthlyRent: 1800,
    securityDeposit: 1800,
    dueDay: 5,
    currentBalance: 0,
    status: 'ended',
    endedAt: Timestamp.fromDate(new Date(SEED_TENANCY_ENDED_DATE)),
    attachedDocuments: [],
  }
}

/** Same format `web/src/features/reports/hooks.js`'s `buildReportId` uses
 * (`${propertyId}_${year}-${paddedMonth}`) — replicated locally rather than
 * imported cross-package (`functions/` deploys without `web/`), same
 * duplication discipline CLAUDE.md §7 already documents for the KYC schema. */
function buildReportId(propertyId, year, month) {
  return `${propertyId}_${year}-${String(month).padStart(2, '0')}`
}

/** Same format `web/src/features/reports/schema.js`'s `buildDueDate` uses —
 * replicated locally for the same cross-package reason as `buildReportId`. */
function buildDueDate(year, month, dueDay) {
  const lastDayOfMonth = new Date(year, month, 0).getDate()
  const day = Math.min(dueDay, lastDayOfMonth)
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/**
 * Builds one tenancy's chronological chain of SIGNED reports, computing
 * `previousMonthArrears`/`previousMonthCredit`/`finalTotal` as OUTPUTS of a
 * running-balance fold — never hardcoded per row (M5 sub-stage 4 plan §4/§5
 * risk #5: hand-maintained literal numbers are exactly how the retired
 * "5530 (base 2800 + previousMonthArrears 2730 auto-referenced)" report
 * happened). Mirrors the two real formulas exactly:
 *  - `buildInitialValues` (web/src/features/reports/schema.js):
 *      previousMonthArrears = Math.max(balance, 0)
 *      previousMonthCredit  = Math.max(-balance, 0)
 *  - `recomputeCurrentBalance` (functions/src/reports.js):
 *      balance after a report = finalTotal - (amountPaid ?? 0)
 *
 * Each month's payment `intent` uses the EXACT field-set the real mutations
 * write for that state — not an invented shape (plan §5 risk #2):
 *  - `{ kind: 'paidInFull', method, date }` — mirrors `useMarkPayment`'s
 *    payload; `amountPaid` is never a literal here, it IS `finalTotal`
 *    (computed, so a paid-in-full month can never accidentally under/over
 *    pay itself).
 *  - `{ kind: 'partial', amountPaid, method, date }` — mirrors
 *    `useMarkPayment`'s payload; `amountPaid` here IS a genuine input (how
 *    much the tenant actually paid), not a derived value — the one place a
 *    literal belongs in this fold.
 *  - `{ kind: 'unpaid' }` — mirrors `useCancelPayment`'s exact payload:
 *    `amountPaid`/`paymentMethod`/`paymentDate` explicitly `null`, not
 *    merely absent.
 *  - `undefined` (or omitted) — a never-touched, just-signed report: NO
 *    payment keys at all, not even `paymentStatus`.
 *
 * @param costLines   { rent: {amount,notes}, maintenance: {amount,notes},
 *   serviceCosts: [{serviceId,name,amount,notes}] } — reused identically
 *   every month (this tenancy's recurring costs never change in the seed).
 * @param months      ordered array of { year, month, payment? }.
 * @returns { reports: [...] (still missing id/ownerId/propertyId/tenancyId/
 *   userId/status/dueDate/attachments — added by the caller), finalBalance }
 *   `finalBalance` is exactly what `tenancy.currentBalance` must be
 *   hand-set to once every report below has actually been written.
 */
function foldReportChain(costLines, months) {
  const base =
    costLines.rent.amount +
    costLines.maintenance.amount +
    costLines.serviceCosts.reduce((sum, line) => sum + line.amount, 0)

  let balance = 0
  const reports = months.map(({ year, month, payment }) => {
    const previousMonthArrears = Math.max(balance, 0)
    const previousMonthCredit = Math.max(-balance, 0)
    const finalTotal = base + previousMonthArrears - previousMonthCredit

    let paymentFields = {}
    let amountPaidForBalance = 0

    if (payment?.kind === 'paidInFull') {
      paymentFields = {
        amountPaid: finalTotal,
        paymentMethod: payment.method,
        paymentDate: payment.date,
        paymentStatus: 'paid',
      }
      amountPaidForBalance = finalTotal
    } else if (payment?.kind === 'partial') {
      paymentFields = {
        amountPaid: payment.amountPaid,
        paymentMethod: payment.method,
        paymentDate: payment.date,
        paymentStatus: 'partial',
      }
      amountPaidForBalance = payment.amountPaid
    } else if (payment?.kind === 'unpaid') {
      paymentFields = {
        amountPaid: null,
        paymentMethod: null,
        paymentDate: null,
        paymentStatus: 'unpaid',
      }
      amountPaidForBalance = 0
    }
    // else: payment omitted -> "absent" state, paymentFields stays {},
    // amountPaidForBalance stays 0 (never touched, just signed).

    balance = finalTotal - amountPaidForBalance

    return {
      year,
      month,
      rent: { ...costLines.rent, attachments: [] },
      maintenance: { ...costLines.maintenance, attachments: [] },
      serviceCosts: costLines.serviceCosts.map((line) => ({
        ...line,
        attachments: [],
      })),
      otherExpenses: [],
      previousMonthArrears,
      previousMonthCredit,
      calculatedTotal: finalTotal,
      finalTotal,
      ...paymentFields,
    }
  })

  return { reports, finalBalance: balance }
}

// `seed-tenant`'s recurring costs (base 2730/month) and the 6-month chain —
// the exact numbers in the M5 sub-stage 4 plan's worked table, produced BY
// the fold above, not typed in here.
const OCCUPIED_COST_LINES = {
  rent: { amount: 2500, notes: '' },
  maintenance: { amount: 0, notes: '' },
  serviceCosts: [
    { serviceId: 'electricity', name: 'Electricitate', amount: 150, notes: '' },
    { serviceId: 'gas', name: 'Gaz', amount: 80, notes: '' },
  ],
}
const OCCUPIED_MONTHS = [
  {
    year: 2025,
    month: 11,
    payment: {
      kind: 'paidInFull',
      method: 'bank_transfer',
      date: '2025-11-10',
    },
  },
  {
    year: 2025,
    month: 12,
    payment: {
      kind: 'partial',
      amountPaid: 2000,
      method: 'cash',
      date: '2025-12-12',
    },
  },
  {
    year: 2026,
    month: 1,
    payment: {
      kind: 'paidInFull',
      method: 'bank_transfer',
      date: '2026-01-10',
    },
  },
  { year: 2026, month: 2, payment: { kind: 'unpaid' } },
  {
    year: 2026,
    month: 5,
    payment: { kind: 'paidInFull', method: 'cash', date: '2026-05-11' },
  },
  { year: 2026, month: 7 /* payment omitted -> absent state */ },
]
const OCCUPIED_DRAFT_MONTH = { year: 2026, month: 8 }

// `seed-tenant-ended`'s recurring costs (base 1980/month) and the 2-month
// chain — BOTH paid in full, deliberately (plan §5 risk #1): FR-CON-04
// blocks `endTenancy` while arrears are outstanding, so an ended tenancy
// with a non-zero balance is a state the real app can never produce.
const ENDED_COST_LINES = {
  rent: { amount: 1800, notes: '' },
  maintenance: { amount: 0, notes: '' },
  serviceCosts: [
    { serviceId: 'electricity', name: 'Electricitate', amount: 120, notes: '' },
    { serviceId: 'gas', name: 'Gaz', amount: 60, notes: '' },
  ],
}
const ENDED_MONTHS = [
  {
    year: 2025,
    month: 12,
    payment: {
      kind: 'paidInFull',
      method: 'bank_transfer',
      date: '2025-12-05',
    },
  },
  {
    year: 2026,
    month: 1,
    payment: {
      kind: 'paidInFull',
      method: 'bank_transfer',
      date: '2026-01-05',
    },
  },
]

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

/** Deletes the 3 fixed demo properties, then writes them fresh — the deterministic
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

/** Idempotent get-or-create for a demo tenant's Auth account — same pattern
 * for all 3 tenant scenarios below. No admin claim. The fixed uid is reused
 * as the `users` doc id, matching finalizeKyc's `users/{authUid}` convention. */
async function ensureTenantAccount({ uid, email, password }, displayName) {
  const auth = getAuth()
  try {
    const user = await auth.getUserByEmail(email)
    console.log(`Tenant already exists: ${email} (uid: ${user.uid})`)
    return user.uid
  } catch (error) {
    if (error.code !== 'auth/user-not-found') throw error
    const user = await auth.createUser({
      uid,
      email,
      password,
      displayName,
      emailVerified: true,
    })
    console.log(`Tenant created: ${email} (uid: ${user.uid})`)
    return user.uid
  }
}

/** Sub-stage F: (re)writes `seed-tenant-free`'s `users` doc — delete then rewrite,
 * same deterministic pattern as the rest of this file. Deliberately touches NO
 * `tenancies` document: that absence is the whole point of this fixture. */
async function reseedTenantNoTenancy(bucket) {
  const db = getFirestore()
  const userRef = db.collection('users').doc(SEED_TENANT_NO_TENANCY.uid)

  await userRef.delete()
  const idDocumentPhotos = await uploadSeedIdPhoto(
    bucket,
    SEED_TENANT_NO_TENANCY.uid,
    'seed-idphoto-free-token',
  )
  const user = { ...tenantNoTenancyUser(), idDocumentPhotos }
  await userRef.set(user)

  console.log(
    `  - user ${SEED_TENANT_NO_TENANCY.uid}: "${user.name}" (cnp ${user.cnp}), NO active tenancy`,
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

/** Uploads one synthetic attachment and returns the persisted reference
 * shape a real client upload produces (fileUpload.js's `uploadAttachment`:
 * `{ path, name, type }`, debt #5 — a bucket-relative Storage path, NEVER a
 * download URL). `filePath` IS the path — no construction needed, same as
 * `objectRef.fullPath` on a real client-side `ref(storage, path)`. No real
 * file content — a synthetic Buffer with the right `contentType` is enough
 * to exercise the real Storage read path end to end.
 *
 * The download token is still written (`firebaseStorageDownloadTokens`) even
 * though nothing here embeds it into a URL anymore — an authenticated
 * client's own `getDownloadURL()` call at display time (`useAttachmentUrl`)
 * may still depend on it existing; removing it would be a decision about
 * that still-open question (C1/C2), not this migration's job.
 *
 * `firebaseStorageDownloadTokens` MUST be nested two levels deep —
 * `metadata: { metadata: { firebaseStorageDownloadTokens: token } }` — not
 * `metadata: { firebaseStorageDownloadTokens: token }`. The outer `metadata`
 * option is the GCS object-resource payload (`contentType`,
 * `cacheControl`, ...); `firebaseStorageDownloadTokens` is not one of that
 * resource's recognized top-level fields, so the SDK silently drops it
 * there — the object ends up with NO custom metadata at all. Custom
 * key/value pairs live in the resource's own NESTED `metadata` map, which is
 * what the inner `metadata` key here targets — the exact shape
 * `photoMigration.js:104`'s `.setMetadata({ metadata: {
 * firebaseStorageDownloadTokens: token } })` already uses correctly
 * elsewhere in this codebase. Confirmed empirically: before this fix, a
 * freshly-seeded object's `getMetadata()` had no `metadata` field
 * whatsoever. */
async function uploadSeedAttachment(
  bucket,
  filePath,
  content,
  contentType,
  downloadToken,
) {
  await bucket.file(filePath).save(Buffer.from(content), {
    contentType,
    metadata: { metadata: { firebaseStorageDownloadTokens: downloadToken } },
  })
  return filePath
}

/** Uploads the tenancy's signed-contract fixture (FR-CON-07, `/app/contract`)
 * at the EXACT path `ContractUpload.jsx:56` writes to
 * (`tenancies/{tenancyId}/contract/{filename}`), and returns the
 * `attachedDocuments[]` entry shape `useUpdateTenancy` persists
 * (`{path, name, type}`, debt #5). A fixed filename (not a
 * `crypto.randomUUID()` prefix like the real uploader uses) — the seed only
 * ever has ONE contract per tenancy, so a random prefix would only break
 * idempotency for no benefit. */
async function uploadSeedContract(bucket, tenancyId, downloadToken) {
  const prefix = `tenancies/${tenancyId}/contract/`
  await clearSeedAttachments(bucket, prefix)
  const filePath = await uploadSeedAttachment(
    bucket,
    `${prefix}contract.pdf`,
    'seed contract — synthetic bytes, not a real PDF',
    'application/pdf',
    downloadToken,
  )
  return [{ path: filePath, name: 'contract.pdf', type: 'pdf' }]
}

/** Uploads one tenant's ID-photo fixture (FR-TEN-03) at the real path a
 * finalized tenant's photo lives at (`users/{userId}/documents/{filename}`,
 * `copyPhotosToUser`'s own destination shape), and returns the
 * `idDocumentPhotos[]` entry shape `finalizeKyc` persists (`{path, name,
 * type}`, debt #5). Same synthetic-bytes discipline as `uploadSeedContract`
 * — this is what closes the investigation's finding: these photos used to be
 * hand-written `gs://demo/...` literals, never actually uploaded, rendering
 * as broken images in the Profile tab's lightbox. */
async function uploadSeedIdPhoto(bucket, userId, downloadToken) {
  const prefix = `users/${userId}/documents/`
  await clearSeedAttachments(bucket, prefix)
  const filePath = await uploadSeedAttachment(
    bucket,
    `${prefix}ci-front.jpg`,
    'seed ID photo — synthetic bytes, not a real JPEG',
    'image/jpeg',
    downloadToken,
  )
  return [{ path: filePath, name: 'ci-front.jpg', type: 'image' }]
}

/**
 * Scenario 1: `seed-tenant`, active tenancy, the 2-year/7-report history.
 *
 * `currentBalance` recompute — investigated empirically for this rewrite
 * (M5 sub-stage 4 plan §5 risk #8): `onReportWrite`
 * (functions/src/reports.js) DOES fire on these Admin-SDK writes, whenever
 * the Functions emulator is running alongside Firestore (the default —
 * `firebase.json` declares `functions` as a standard emulator, and
 * `README.md`'s documented workflow starts the full set before `npm run
 * seed`). Firestore triggers are source-agnostic: the Admin SDK bypasses
 * Security Rules, not triggers. `currentBalance` is still hand-set below —
 * NOT to dodge the trigger (there is nothing to dodge: `recomputeCurrentBalance`
 * is a full, idempotent re-derivation, so a straggling trigger invocation
 * that completes after this write simply re-writes the SAME correct value),
 * but because this script is short-lived and has no way to observe whether
 * the LAST report's trigger invocation has actually finished before the
 * process exits. Setting it here, synchronously, AFTER every report for
 * this tenancy has been written, guarantees a deterministic final state
 * that does not depend on that unobservable async timing.
 */
async function reseedOccupiedScenario(ownerId, bucket) {
  const db = getFirestore()
  const propertyRef = db.collection('properties').doc(SEED_OCCUPIED_PROPERTY_ID)
  const userRef = db.collection('users').doc(SEED_TENANT.uid)
  const tenancyRef = db.collection('tenancies').doc(SEED_TENANCY_ID)

  const { reports, finalBalance } = foldReportChain(
    OCCUPIED_COST_LINES,
    OCCUPIED_MONTHS,
  )
  const reportRefs = reports.map((report) =>
    db
      .collection('monthlyReports')
      .doc(buildReportId(SEED_OCCUPIED_PROPERTY_ID, report.year, report.month)),
  )
  const draftRef = db
    .collection('monthlyReports')
    .doc(
      buildReportId(
        SEED_OCCUPIED_PROPERTY_ID,
        OCCUPIED_DRAFT_MONTH.year,
        OCCUPIED_DRAFT_MONTH.month,
      ),
    )

  const delBatch = db.batch()
  delBatch.delete(propertyRef)
  delBatch.delete(userRef)
  delBatch.delete(tenancyRef)
  for (const ref of reportRefs) delBatch.delete(ref)
  delBatch.delete(draftRef)
  await delBatch.commit()

  const invoicesPrefix = `reports/${buildReportId(SEED_OCCUPIED_PROPERTY_ID, 2026, 7)}/invoices/`
  await clearSeedAttachments(bucket, invoicesPrefix)

  const property = occupiedProperty(ownerId)
  const tenancy = activeTenancy(ownerId, property)
  const contractDocuments = await uploadSeedContract(
    bucket,
    SEED_TENANCY_ID,
    'seed-contract-occupied-token',
  )
  const idDocumentPhotos = await uploadSeedIdPhoto(
    bucket,
    SEED_TENANT.uid,
    'seed-idphoto-occupied-token',
  )

  // The July report's 2 real Storage attachments, uploaded BEFORE the
  // report doc is built below — their paths must exist so they can be
  // embedded directly into the report object and written ONCE via `.set()`
  // (see the July-only merge inside the `reports.forEach` loop), never
  // patched on afterward via a follow-up `.update()`.
  const rentPath = await uploadSeedAttachment(
    bucket,
    `${invoicesPrefix}rent-invoice.pdf`,
    'seed rent invoice — synthetic bytes, not a real PDF',
    'application/pdf',
    'seed-rent-token',
  )
  const electricityPath = await uploadSeedAttachment(
    bucket,
    `${invoicesPrefix}electricity-invoice.jpg`,
    'seed electricity invoice — synthetic bytes, not a real JPEG',
    'image/jpeg',
    'seed-electricity-token',
  )
  const julyReportId = buildReportId(SEED_OCCUPIED_PROPERTY_ID, 2026, 7)

  const writeBatch = db.batch()
  writeBatch.set(propertyRef, property)
  writeBatch.set(userRef, { ...tenantUser(), idDocumentPhotos })
  writeBatch.set(tenancyRef, {
    ...tenancy,
    attachedDocuments: contractDocuments,
  })

  reports.forEach((report, index) => {
    const id = reportRefs[index].id
    const common = {
      ownerId,
      propertyId: SEED_OCCUPIED_PROPERTY_ID,
      tenancyId: SEED_TENANCY_ID,
      userId: SEED_TENANT.uid,
      dueDate: buildDueDate(report.year, report.month, tenancy.dueDay),
      status: 'signed',
      signedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }
    // Only the July 2026 report (id-matched, not index-matched — the chain's
    // order must never silently decide which report the demo share link
    // points at) carries the fixed share token, same slot it has always
    // been in.
    const shareFields =
      id === julyReportId
        ? { shareToken: SIGNED_REPORT_SHARE_TOKEN, shareTokenRevoked: false }
        : {}
    // The July report's 2 attachments are merged into its cost lines HERE,
    // before the single `.set()` below — NEVER via a follow-up `.update()`
    // with a dotted field path. `rent` is a MAP field, so a dotted path
    // into it (`'rent.attachments'`) would technically work, but
    // `serviceCosts` is an ARRAY, and Firestore's `update()` cannot merge a
    // dotted path into an array element at all: `update({
    // 'serviceCosts.0.attachments': [...] })` silently REPLACES the entire
    // `serviceCosts` field with a brand-new map `{ "0": { attachments:
    // [...] } }`, discarding serviceId/name/amount/notes and every other
    // index (the gas line) — this is exactly the bug that produced
    // `(report.serviceCosts ?? []).map is not a function` downstream in
    // `reportAdapter.js`, confirmed empirically against the emulator. If a
    // future change needs to attach a file to an existing array cost line,
    // build the full object (as below) and `.set()` it once — do not reach
    // for a dotted path on an array, here or anywhere else in this file.
    const attachmentFields =
      id === julyReportId
        ? {
            rent: {
              ...report.rent,
              attachments: [
                { path: rentPath, name: 'rent-invoice.pdf', type: 'pdf' },
              ],
            },
            serviceCosts: report.serviceCosts.map((line, lineIndex) =>
              lineIndex === 0
                ? {
                    ...line,
                    attachments: [
                      {
                        path: electricityPath,
                        name: 'electricity-invoice.jpg',
                        type: 'image',
                      },
                    ],
                  }
                : line,
            ),
          }
        : {}
    writeBatch.set(reportRefs[index], {
      ...report,
      ...common,
      ...shareFields,
      ...attachmentFields,
    })
  })

  // The draft's own previousMonthArrears/Credit mirror `buildInitialValues`
  // LIVE from the tenancy's real currentBalance (`finalBalance`, the fold's
  // own output for report #6) — not frozen, matching a real draft.
  const draftPrevArrears = Math.max(finalBalance, 0)
  const draftPrevCredit = Math.max(-finalBalance, 0)
  const draftBase =
    OCCUPIED_COST_LINES.rent.amount +
    OCCUPIED_COST_LINES.maintenance.amount +
    OCCUPIED_COST_LINES.serviceCosts.reduce((sum, l) => sum + l.amount, 0)
  const draftFinalTotal = draftBase + draftPrevArrears - draftPrevCredit
  writeBatch.set(draftRef, {
    ownerId,
    propertyId: SEED_OCCUPIED_PROPERTY_ID,
    tenancyId: SEED_TENANCY_ID,
    userId: SEED_TENANT.uid,
    year: OCCUPIED_DRAFT_MONTH.year,
    month: OCCUPIED_DRAFT_MONTH.month,
    rent: { ...OCCUPIED_COST_LINES.rent, attachments: [] },
    maintenance: { ...OCCUPIED_COST_LINES.maintenance, attachments: [] },
    serviceCosts: OCCUPIED_COST_LINES.serviceCosts.map((line) => ({
      ...line,
      attachments: [],
    })),
    otherExpenses: [],
    previousMonthArrears: draftPrevArrears,
    previousMonthCredit: draftPrevCredit,
    calculatedTotal: draftFinalTotal,
    finalTotal: draftFinalTotal,
    dueDate: buildDueDate(
      OCCUPIED_DRAFT_MONTH.year,
      OCCUPIED_DRAFT_MONTH.month,
      tenancy.dueDay,
    ),
    status: 'draft',
    updatedAt: FieldValue.serverTimestamp(),
  })

  await writeBatch.commit()

  // Hand-set AFTER every report write above has been acknowledged — see
  // this function's doc-comment for why this is still correct and still
  // needed even though onReportWrite also fires.
  await tenancyRef.update({ currentBalance: finalBalance })

  console.log('Wrote the occupied scenario (seed-tenant):')
  console.log(`  - property ${SEED_OCCUPIED_PROPERTY_ID}: "${property.name}"`)
  console.log(
    `  - user ${SEED_TENANT.uid}: "${tenantUser().name}" (cnp ${tenantUser().cnp})`,
  )
  console.log(
    `  - tenancy ${SEED_TENANCY_ID}: active, 6 signed reports + 1 draft, currentBalance -> ${finalBalance}`,
  )
  console.log(
    `  - payment states covered: paid, partial, unpaid (explicit), absent`,
  )
  console.log(
    `  - 2 invoice attachments + 1 contract attachment + 1 ID photo uploaded`,
  )
}

/** Scenario 2: `seed-tenant-empty`, active tenancy, ZERO `monthlyReports`
 * docs — the starkest demonstration of FR-TAPP-01's empty state. */
async function reseedEmptyScenario(ownerId, bucket) {
  const db = getFirestore()
  const propertyRef = db.collection('properties').doc(SEED_EMPTY_PROPERTY_ID)
  const userRef = db.collection('users').doc(SEED_TENANT_EMPTY.uid)
  const tenancyRef = db.collection('tenancies').doc(SEED_TENANCY_EMPTY_ID)

  const delBatch = db.batch()
  delBatch.delete(propertyRef)
  delBatch.delete(userRef)
  delBatch.delete(tenancyRef)
  await delBatch.commit()

  const idDocumentPhotos = await uploadSeedIdPhoto(
    bucket,
    SEED_TENANT_EMPTY.uid,
    'seed-idphoto-empty-token',
  )

  const property = emptyProperty(ownerId)
  const writeBatch = db.batch()
  writeBatch.set(propertyRef, property)
  writeBatch.set(userRef, { ...tenantEmptyUser(), idDocumentPhotos })
  writeBatch.set(tenancyRef, emptyTenancy(ownerId, property))
  await writeBatch.commit()

  console.log('Wrote the empty scenario (seed-tenant-empty):')
  console.log(`  - property ${SEED_EMPTY_PROPERTY_ID}: "${property.name}"`)
  console.log(`  - user ${SEED_TENANT_EMPTY.uid}: "${tenantEmptyUser().name}"`)
  console.log(
    `  - tenancy ${SEED_TENANCY_EMPTY_ID}: active, ZERO monthlyReports docs (empty state)`,
  )
  console.log(`  - 1 ID photo uploaded`)
}

/**
 * Scenario 3: `seed-tenant-ended`, ended tenancy, 2 fully-settled signed
 * reports. Both `currentBalance` writes below (the tenancy doc's own
 * `currentBalance: 0` field AND the `.update()` after the reports) encode
 * the SAME real invariant from two angles: FR-CON-04 blocks `endTenancy`
 * while arrears exist, so an ended tenancy the real app produced is
 * ALWAYS settled — this fixture must not claim otherwise (plan §5 risk #1).
 */
async function reseedEndedScenario(ownerId, bucket) {
  const db = getFirestore()
  const propertyRef = db.collection('properties').doc(SEED_ENDED_PROPERTY_ID)
  const userRef = db.collection('users').doc(SEED_TENANT_ENDED.uid)
  const tenancyRef = db.collection('tenancies').doc(SEED_TENANCY_ENDED_ID)

  const { reports, finalBalance } = foldReportChain(
    ENDED_COST_LINES,
    ENDED_MONTHS,
  )
  const reportRefs = reports.map((report) =>
    db
      .collection('monthlyReports')
      .doc(buildReportId(SEED_ENDED_PROPERTY_ID, report.year, report.month)),
  )

  const delBatch = db.batch()
  delBatch.delete(propertyRef)
  delBatch.delete(userRef)
  delBatch.delete(tenancyRef)
  for (const ref of reportRefs) delBatch.delete(ref)
  await delBatch.commit()

  const property = endedProperty(ownerId)
  const tenancy = endedTenancy(ownerId, property)
  const contractDocuments = await uploadSeedContract(
    bucket,
    SEED_TENANCY_ENDED_ID,
    'seed-contract-ended-token',
  )
  const idDocumentPhotos = await uploadSeedIdPhoto(
    bucket,
    SEED_TENANT_ENDED.uid,
    'seed-idphoto-ended-token',
  )

  const writeBatch = db.batch()
  writeBatch.set(propertyRef, property)
  // `endTenancy`'s real postcondition (functions/src/endTenancy.js:89):
  // the account moves to 'inactive-readonly', not just the tenancy to
  // 'ended'. Reproduced by hand for the same "don't seed an impossible
  // state" reason as the settled-arrears invariant above.
  writeBatch.set(userRef, {
    ...tenantEndedUser(),
    idDocumentPhotos,
    status: 'inactive-readonly',
  })
  writeBatch.set(tenancyRef, {
    ...tenancy,
    attachedDocuments: contractDocuments,
  })
  reports.forEach((report, index) => {
    writeBatch.set(reportRefs[index], {
      ...report,
      ownerId,
      propertyId: SEED_ENDED_PROPERTY_ID,
      tenancyId: SEED_TENANCY_ENDED_ID,
      userId: SEED_TENANT_ENDED.uid,
      dueDate: buildDueDate(report.year, report.month, tenancy.dueDay),
      status: 'signed',
      signedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    })
  })
  await writeBatch.commit()

  // Hand-set AFTER both report writes above — same reasoning as the
  // occupied scenario's own currentBalance set. finalBalance is `0` here
  // by construction (both months paidInFull), asserted via the console log
  // below rather than silently trusted.
  await tenancyRef.update({ currentBalance: finalBalance })

  console.log('Wrote the ended scenario (seed-tenant-ended):')
  console.log(
    `  - property ${SEED_ENDED_PROPERTY_ID}: "${property.name}" (free again)`,
  )
  console.log(
    `  - user ${SEED_TENANT_ENDED.uid}: "${tenantEndedUser().name}" (status: inactive-readonly)`,
  )
  console.log(
    `  - tenancy ${SEED_TENANCY_ENDED_ID}: ended ${SEED_TENANCY_ENDED_DATE}, 2 signed reports, currentBalance -> ${finalBalance} (must be 0)`,
  )
  console.log(`  - 1 contract attachment + 1 ID photo uploaded`)
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

  // `STORAGE_BUCKET` required HERE (lazily), not at module top — requiring
  // functions/src/sharedReport.js runs its own `if (!getApps().length)
  // initializeApp()` guard at require-time. If that ran before this
  // `initializeApp({ projectId })` above, the app would already exist by
  // the time it got here and `initializeApp` would throw ("default app
  // already exists"). By this point the app is already initialized, so
  // that guard correctly no-ops and this just reads the exported constant —
  // computed ONCE here and passed down, rather than re-required per
  // scenario function, per CLAUDE.md §7 (explicit bucket, never ambient).
  const { STORAGE_BUCKET } = require('../src/sharedReport')
  const bucket = getStorage().bucket(STORAGE_BUCKET)

  const ownerId = await ensureAdmin()
  await reseedProperties(ownerId)

  await ensureTenantAccount(SEED_TENANT, tenantUser().name)
  await reseedOccupiedScenario(ownerId, bucket)

  await ensureTenantAccount(SEED_TENANT_EMPTY, tenantEmptyUser().name)
  await reseedEmptyScenario(ownerId, bucket)

  await ensureTenantAccount(SEED_TENANT_ENDED, tenantEndedUser().name)
  await reseedEndedScenario(ownerId, bucket)

  await ensureTenantAccount(SEED_TENANT_NO_TENANCY, tenantNoTenancyUser().name)
  await reseedTenantNoTenancy(bucket)

  console.log('\n✅ Seed complete.')
  console.log(`   Admin sign-in: ${ADMIN.email} / ${ADMIN.password}`)
  console.log(
    `   Tenant sign-in (active, 2-year history, all 4 payment states): ${SEED_TENANT.email} / ${SEED_TENANT.password}`,
  )
  console.log(
    `   Tenant sign-in (active, empty state — no reports at all):      ${SEED_TENANT_EMPTY.email} / ${SEED_TENANT_EMPTY.password}`,
  )
  console.log(
    `   Tenant sign-in (ended tenancy, settled, contract attached):     ${SEED_TENANT_ENDED.email} / ${SEED_TENANT_ENDED.password}`,
  )
  console.log(
    `   Tenant sign-in (no tenancy at all):                             ${SEED_TENANT_NO_TENANCY.email} / ${SEED_TENANT_NO_TENANCY.password}`,
  )
  console.log(
    `   Shared report link (unauthenticated, M4 sub-stage 8): http://localhost:5173/r/${SIGNED_REPORT_SHARE_TOKEN}`,
  )
}

main().catch((error) => {
  console.error('Error:', error)
  process.exit(1)
})
