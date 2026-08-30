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
 * Five tenant scenarios, one Firestore write graph each:
 *  - `seed-tenant` (active tenancy, `seed-prop-occupied`): a 2-year, 7-report
 *    history (6 signed + 1 draft) hitting all four payment-badge states.
 *  - `seed-tenant-empty` (active tenancy, `seed-prop-empty`): zero reports —
 *    FR-TAPP-01's empty state.
 *  - `seed-tenant-ended` (ended tenancy, `seed-prop-ended`): 2 fully-settled
 *    signed reports — FR-TAPP-06's ended-label/banner.
 *  - `seed-tenant-free`: unchanged from before this rewrite — a KYC-complete
 *    tenant with NO tenancy at all (the no-tenancy dashboard state).
 *  - `seed-tenant-handover-out` / `seed-tenant-handover-in`
 *    (`seed-prop-handover`, M8): a property that changed hands mid-July
 *    2026 — the outgoing tenancy ends 2026-07-14, the incoming one starts
 *    2026-07-15, each with its own SIGNED July report keyed under its own
 *    `tenancyId` (FR-REP-14). Added at M8 stage 4 because the production
 *    probe (`probeProdShape.js`) found ZERO properties that have ever held
 *    more than one tenancy — this fixture is the ONLY place anywhere that
 *    `useTenanciesCoveringPropertyMonth` ever resolves to two rows,
 *    `PropertyReportRedirectPage`'s tenancy-picker branch ever renders, two
 *    reports ever share a property+month under different `tenancyId`s, and
 *    FR-PROP-09's cost history ever sums sibling reports — code that exists
 *    for a case the real data has never once contained.
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

// ─────────────────────────── Scenario 5: mid-month hand-over (M8, FR-REP-14) ───
//
// `seed-prop-handover` changes hands on 2026-07-15: `seed-tenancy-handover-out`
// ends 2026-07-14, `seed-tenancy-handover-in` starts 2026-07-15. Both cover
// July 2026, so both need a July report, keyed by their own tenancyId — the
// exact case FR-REP-14's re-keying exists for, and (per the production probe)
// the only place it is ever exercised outside a unit test's mocked data.
const SEED_TENANT_HANDOVER_OUT = {
  uid: 'seed-tenant-handover-out',
  email: 'mihai.iesit@test.ro',
  password: 'chirias123',
}
const SEED_TENANT_HANDOVER_IN = {
  uid: 'seed-tenant-handover-in',
  email: 'diana.intrat@test.ro',
  password: 'chirias123',
}
const SEED_HANDOVER_PROPERTY_ID = 'seed-prop-handover'
const SEED_TENANCY_HANDOVER_OUT_ID = 'seed-tenancy-handover-out'
const SEED_TENANCY_HANDOVER_IN_ID = 'seed-tenancy-handover-in'
const SEED_HANDOVER_DATE = '2026-07-15'

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
 * hand: normally it is computed from active tenancies, but no trigger computes
 * `status` (onPropertyUpdate only syncs name/address, M6, FR-PROP-10) — it is
 * still written inline by finalizeKyc — so the seed reproduces the end state
 * directly. */
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

/** `seed-prop-handover`'s property — occupied (by the INCOMING tenancy, as of
 * the hand-over date). Status computed the same "written by hand" way as
 * every other seeded property (see `occupiedProperty`'s comment). */
function handoverProperty(ownerId) {
  return {
    name: 'Apartament Buna Ziua',
    address: {
      street: 'Str. Petre Ispirescu',
      number: '21',
      city: 'Cluj-Napoca',
      county: 'Cluj',
      postalCode: '400487',
    },
    area: '52',
    roomCount: '2',
    ownerId,
    services: [
      { serviceId: 'electricity', name: 'Electricitate', source: 'catalog' },
      { serviceId: 'water', name: 'Apă', source: 'catalog' },
    ],
    status: 'occupied',
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

/** The OUTGOING half of the hand-over (M8) — moved out 2026-07-14. */
function tenantHandoverOutUser() {
  return {
    name: 'Mihai Popescu',
    dateOfBirth: '1990-11-02',
    email: SEED_TENANT_HANDOVER_OUT.email,
    phone: '0745456789',
    preferredLanguage: 'ro',
    cnp: '1901102234567',
    previousAddress: 'Str. Bucegi 3, Cluj-Napoca',
    emergencyContact: { name: 'Alina Popescu', phone: '0745111000' },
    occupantCount: 1,
    smoker: false,
    pets: { has: false, type: '' },
    vehicle: { has: false, make: '', plateNumber: '' },
    employer: 'Betfair Romania',
    occupation: 'Backend Developer',
    employmentDuration: 4,
    monthlyIncome: { source: 'salariu', amount: 8200 },
    guarantor: {
      name: 'Ion Popescu',
      cnp: '1600512234567',
      phone: '0740222111',
    },
    previousReference: { name: 'Cristian Rus', phone: '0730333222' },
    status: 'active',
  }
}

/** The INCOMING half of the hand-over (M8) — moved in 2026-07-15, the day
 * `tenantHandoverOutUser()`'s tenancy ended. */
function tenantHandoverInUser() {
  return {
    name: 'Diana Georgescu',
    dateOfBirth: '1993-04-18',
    email: SEED_TENANT_HANDOVER_IN.email,
    phone: '0745567890',
    preferredLanguage: 'en',
    cnp: '2930418234567',
    previousAddress: 'Str. Fantanele 9, Cluj-Napoca',
    emergencyContact: { name: 'Paul Georgescu', phone: '0745222111' },
    occupantCount: 1,
    smoker: false,
    pets: { has: true, type: 'câine' },
    vehicle: { has: false, make: '', plateNumber: '' },
    employer: 'Endava',
    occupation: 'Product Manager',
    employmentDuration: 6,
    monthlyIncome: { source: 'salariu', amount: 9500 },
    guarantor: {
      name: 'Elena Georgescu',
      cnp: '1650812234567',
      phone: '0740444333',
    },
    previousReference: { name: 'Ana Munteanu', phone: '0730555444' },
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
 *
 * `reportReminderDaysBefore`/`paymentReminderDaysBefore` (M8, FR-CON-01/
 * NFR-VAL-02): both fields were never seeded before this rewrite, so neither
 * M6's report-preparation reminder nor M8's pre-due reminder was ever
 * exercisable against local data. `paymentReminderDaysBefore: 5` here is
 * deliberately NOT the default (3) — a fixture that only ever uses the
 * default cannot tell "the field is read" from "the field is absent and the
 * app silently fell back".
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
    reportReminderDaysBefore: 3,
    paymentReminderDaysBefore: 5,
    currentBalance: 0,
    status: 'active',
    attachedDocuments: [],
  }
}

/** `seed-tenant-empty`'s tenancy — active, started recently, ZERO reports
 * (the whole point of this fixture — FR-TAPP-01's empty state). Both
 * reminder lead times at their spec default (3) — `activeTenancy` above
 * already covers the non-default case. */
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
    reportReminderDaysBefore: 3,
    paymentReminderDaysBefore: 3,
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
 *
 * `closingBalance`/`depositSettlement` (M8, FR-CON-10/11/12, FR-DASH-13/14):
 * `closingBalance` freezes `currentBalance` at termination — `0` here,
 * matching the invariant above. `depositSettlement` is a real restoration
 * line against the `securityDeposit`, deducted, with the remainder
 * `toReturn`. **`ownerBears` is `0` here, never a debt on the tenant
 * (FR-CON-10) — a deposit settlement is deliberately never a source of
 * arrears.** The `ownerBears > 0` case (deductions exceeding the deposit)
 * is seeded separately, on `handoverOutTenancy()` below — deliberately a
 * DIFFERENT fixture, so both shapes of the same requirement are reachable
 * rather than one silently standing in for the other.
 *

 * The comment this replaces said termination is IMPOSSIBLE with an unpaid
 * balance — true before M8, reversed at M8: `FR-CON-04` no longer blocks
 * `endTenancy` on arrears, specifically so a departed non-payer does not
 * freeze the property. This fixture stays fully settled anyway (a deposit
 * settlement is about restoration, never arrears — FR-CON-11 — so the two
 * are independent choices), but the invariant this comment used to assert
 * ("an ended tenancy with debt cannot exist") is no longer true of the
 * product and must not be re-asserted elsewhere.
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
    reportReminderDaysBefore: 3,
    paymentReminderDaysBefore: 3,
    currentBalance: 0,
    status: 'ended',
    endedAt: Timestamp.fromDate(new Date(SEED_TENANCY_ENDED_DATE)),
    closingBalance: 0,
    depositSettlement: {
      items: [
        {
          description: 'Curățenie generală la predare',
          amount: 200,
          attachments: [],
        },
      ],
      deducted: 200,
      toReturn: 1600,
      ownerBears: 0,
      settledAt: Timestamp.fromDate(new Date(SEED_TENANCY_ENDED_DATE)),
    },
    attachedDocuments: [],
  }
}

/**
 * The OUTGOING half of the hand-over (M8, FR-REP-14) — ends the day before
 * the incoming tenancy starts, never the same day: FR-CON-02 allows at most
 * one ACTIVE tenancy per account, not per property on a single date, but a
 * shared boundary day would make "which tenancy does 2026-07-15 belong to"
 * ambiguous in exactly the fixture meant to prove the resolver disambiguates
 * correctly.
 */
function handoverOutTenancy(ownerId, property) {
  return {
    userId: SEED_TENANT_HANDOVER_OUT.uid,
    ownerId,
    propertyId: SEED_HANDOVER_PROPERTY_ID,
    tenantName: tenantHandoverOutUser().name,
    property: { name: property.name, address: property.address },
    startDate: '2025-11-01',
    endDate: '2026-07-14',
    monthlyRent: 2100,
    securityDeposit: 2100,
    dueDay: 1,
    reportReminderDaysBefore: 3,
    paymentReminderDaysBefore: 3,
    status: 'ended',
    endedAt: Timestamp.fromDate(new Date('2026-07-14')),
    // Placeholder — both fields are overwritten by `reseedHandoverScenario`
    // right after the report write, once the real balance (which depends on
    // HANDOVER_OUT_REPORT's roundingSurplus) is known.
    currentBalance: 0,
    closingBalance: 0,
    // `depositSettlement` (M8 stage 6, FR-CON-10/11/12): the seed's ONE
    // `ownerBears > 0` case — Bogdan's own call, folded into this existing
    // fixture rather than a sixth seed graph. Restoration work (2800 lei)
    // exceeds the 2100-lei deposit: `toReturn` is 0, `ownerBears` is 700 —
    // a cost the owner bears, never a debt written back onto this tenant
    // (FR-CON-10). `settledAt` postdates `endedAt` by six days, matching
    // the "separate action, filled in after inspection" flow decided for
    // stage 6 — never the same moment as termination.
    depositSettlement: {
      items: [
        {
          description: 'Refacere pardoseală și zugrăveli după degradări',
          amount: 2800,
          attachments: [],
        },
      ],
      deducted: 2800,
      toReturn: 0,
      ownerBears: 700,
      settledAt: Timestamp.fromDate(new Date('2026-07-20')),
    },
    attachedDocuments: [],
  }
}

/** The INCOMING half of the hand-over (M8, FR-REP-14) — starts the day the
 * outgoing tenancy ended. `currentBalance` matches this tenancy's own single
 * July report (see `reseedHandoverScenario`), never the outgoing tenancy's —
 * the two balance chains are completely independent, which is the point. */
function handoverInTenancy(ownerId, property) {
  return {
    userId: SEED_TENANT_HANDOVER_IN.uid,
    ownerId,
    propertyId: SEED_HANDOVER_PROPERTY_ID,
    tenantName: tenantHandoverInUser().name,
    property: { name: property.name, address: property.address },
    startDate: SEED_HANDOVER_DATE,
    endDate: '2027-07-14',
    monthlyRent: 2100,
    securityDeposit: 2100,
    dueDay: 15,
    reportReminderDaysBefore: 3,
    paymentReminderDaysBefore: 3,
    currentBalance: 0,
    status: 'active',
    attachedDocuments: [],
  }
}

/** Same format `web/src/features/reports/hooks.js`'s `buildReportId` uses
 * (`${tenancyId}_${year}-${paddedMonth}`) — replicated locally rather than
 * imported cross-package (`functions/` deploys without `web/`), same
 * duplication discipline CLAUDE.md §7 already documents for the KYC schema.
 * Re-keyed at M8 (FR-REP-14) from `propertyId` to `tenancyId` — argument
 * order (`id, year, month`) is unchanged, so every call site below only
 * needed its FIRST argument changed from a property id to a tenancy id. */
function buildReportId(tenancyId, year, month) {
  return `${tenancyId}_${year}-${String(month).padStart(2, '0')}`
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
 *      balance after a report = finalTotal - (amountPaid ?? 0) - (roundingSurplus ?? 0)
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
  const reports = months.map(
    ({ year, month, payment, otherExpenses = [], roundingSurplus = 0 }) => {
      const previousMonthArrears = Math.max(balance, 0)
      const previousMonthCredit = Math.max(-balance, 0)
      const otherExpensesTotal = otherExpenses.reduce(
        (sum, line) => sum + line.amount,
        0,
      )
      // `calculatedTotal` is what the cost lines + carry-forward actually
      // add up to; `finalTotal` is that value FROZEN one rounding step
      // higher on a month that applied FR-REP-04a's Round action
      // (`roundingSurplus` > 0). With no rounding — every month except the
      // one on ENDED_MONTHS — the two are equal, exactly as before.
      const calculatedTotal =
        base + otherExpensesTotal + previousMonthArrears - previousMonthCredit
      const finalTotal = calculatedTotal + roundingSurplus

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

      // Mirrors `recomputeCurrentBalance`'s corrected M8 formula exactly:
      // balance after a report = finalTotal - amountPaid - roundingSurplus.
      // On a paid-in-full month with a surplus this leaves -roundingSurplus
      // (a credit) that the NEXT month picks up as previousMonthCredit —
      // the "cancels across two consecutive months" chain FR-REP-04a/04f
      // describes, exercised on ENDED_MONTHS (Dec 2025 -> Jan 2026).
      balance = finalTotal - amountPaidForBalance - roundingSurplus

      return {
        year,
        month,
        rent: { ...costLines.rent, attachments: [] },
        maintenance: { ...costLines.maintenance, attachments: [] },
        serviceCosts: costLines.serviceCosts.map((line) => ({
          ...line,
          attachments: [],
        })),
        otherExpenses: otherExpenses.map((line) => ({
          notes: '',
          ...line,
          attachments: [],
        })),
        previousMonthArrears,
        previousMonthCredit,
        calculatedTotal,
        finalTotal,
        // M8, FR-REP-04a: the fold's chains use round cost lines, so the
        // rounding ACTION has nothing to round on all but the ONE month
        // that passes a non-round `otherExpenses` line plus an explicit
        // `roundingSurplus` (ENDED_MONTHS' December). Everywhere else this
        // stays 0, correct rather than a stand-in. The hand-over pair's
        // HANDOVER_OUT_REPORT carries the other reachable non-zero surplus
        // (a literal, frozen at termination — it never gets to cancel).
        roundingSurplus,
        ...paymentFields,
      }
    },
  )

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
//
// M8 stage 15 (debt 1): this chain now also carries the seed's ONLY
// rounding surplus that CANCELS in a running-balance chain (as opposed to
// HANDOVER_OUT_REPORT's, frozen at termination). December applies
// FR-REP-04a's Round action — a -3 lei "final-consumption adjustment" line
// drops `calculatedTotal` to 1977, the admin rounds `finalTotal` back up to
// 1980, `roundingSurplus` is 3. December is paid in full (1980), so the
// balance after it is 1980 - 1980 - 3 = -3, a credit. January picks that up
// as `previousMonthCredit`, bills `1980 - 3 = 1977`, is paid in full, and
// the chain closes at exactly 0 — `seed-tenancy-ended.currentBalance` and
// `closingBalance` are unchanged (still 0). Only January's seeded
// `finalTotal` moves, 1980 -> 1977.
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
    otherExpenses: [
      {
        description: 'Ajustare consum final',
        amount: -3,
        notes: '',
      },
    ],
    roundingSurplus: 3, // 1980 (frozen) - 1977 (calculatedTotal), FR-REP-04a
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
      .doc(buildReportId(SEED_TENANCY_ID, report.year, report.month)),
  )
  const draftRef = db
    .collection('monthlyReports')
    .doc(
      buildReportId(
        SEED_TENANCY_ID,
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

  const invoicesPrefix = `reports/${buildReportId(SEED_TENANCY_ID, 2026, 7)}/invoices/`
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
  const julyReportId = buildReportId(SEED_TENANCY_ID, 2026, 7)

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
 * reports, PLUS a deposit settlement (M8, FR-CON-10/11/12 — see
 * `endedTenancy`'s own doc-comment). Both `currentBalance` writes below (the
 * tenancy doc's own `currentBalance: 0` field AND the `.update()` after the
 * reports) encode the same choice from two angles: this fixture stays fully
 * settled. That is no longer because the product REQUIRES it — `FR-CON-04`
 * was reversed at M8 precisely so an ended tenancy CAN carry debt — it is
 * because a deposit settlement is about restoration, never arrears
 * (FR-CON-11), so "settled" and "has a deposit settlement" are independent
 * facts and this fixture demonstrates both without conflating them.
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
      .doc(buildReportId(SEED_TENANCY_ENDED_ID, report.year, report.month)),
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
  // by construction: both months paid in full, and December's rounding
  // surplus (3 lei) is cancelled by January consuming it as credit — the
  // whole point of this chain (M8 stage 15, debt 1). Asserted via the
  // console log below rather than silently trusted.
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

// The hand-over property's shared costs, split into two partial-month rents
// (FR-REP-13: pro-rata is entered manually, never computed automatically —
// these are the admin's own hand-entered numbers, not a formula's output).
// Both tenants share the same property's electricity/water services, each
// billed the FULL month on each side deliberately — a real admin would
// split a utility bill between two occupants of the same month by
// negotiation, not by a rule this product implements; the fixture is not
// claiming a policy here, only demonstrating that two reports exist.
const HANDOVER_OUT_REPORT = {
  year: 2026,
  month: 7,
  rent: {
    amount: 950,
    notes: 'Chirie proporțională 1-14 iulie (predare la mijlocul lunii)',
    attachments: [],
  },
  maintenance: { amount: 0, notes: '', attachments: [] },
  serviceCosts: [
    {
      serviceId: 'electricity',
      name: 'Electricitate',
      amount: 40,
      notes: '',
      attachments: [],
    },
    { serviceId: 'water', name: 'Apă', amount: 20, notes: '', attachments: [] },
  ],
  // M8, FR-REP-04a: one of the seed's two reachable rounding-action
  // examples (CLAUDE.md §7's seed-completeness rule — "every state a
  // requirement describes should be reachable in seeded data"). This one is
  // frozen at termination and never cancels; ENDED_MONTHS' December carries
  // the other, which DOES cancel in the chain (debt 1, stage 15). A small
  // negative adjustment line is what makes calculatedTotal land off a
  // multiple of 10 in the first place — rent/services alone are already
  // round numbers throughout this seed.
  otherExpenses: [
    {
      description: 'Ajustare cont final predare',
      amount: -3,
      notes: '',
      attachments: [],
    },
  ],
  previousMonthArrears: 0,
  previousMonthCredit: 0,
  calculatedTotal: 1007,
  finalTotal: 1010, // ceil(1007 / 10) * 10 — the rounding action applied
  roundingSurplus: 3, // 1010 - 1007, carried nowhere further: this tenancy ended
  amountPaid: 1010,
  paymentMethod: 'bank_transfer',
  paymentDate: '2026-07-14',
  paymentStatus: 'paid',
}
const HANDOVER_IN_REPORT = {
  year: 2026,
  month: 7,
  rent: {
    amount: 1150,
    notes: 'Chirie proporțională 15-31 iulie (mutare la mijlocul lunii)',
    attachments: [],
  },
  maintenance: { amount: 0, notes: '', attachments: [] },
  serviceCosts: [
    {
      serviceId: 'electricity',
      name: 'Electricitate',
      amount: 40,
      notes: '',
      attachments: [],
    },
    { serviceId: 'water', name: 'Apă', amount: 20, notes: '', attachments: [] },
  ],
  otherExpenses: [],
  previousMonthArrears: 0,
  previousMonthCredit: 0,
  calculatedTotal: 1210,
  finalTotal: 1210,
  roundingSurplus: 0,
  // Explicit "unpaid" (NFR-VAL-04), not omitted: this tenancy is ACTIVE, so
  // its arrears are meant to show up in FR-DASH-04/06 — an omitted payment
  // ("just signed, never touched") would read the same in the balance
  // arithmetic but is a different fact (never marked at all) than "marked
  // unpaid". `OCCUPIED_MONTHS` already covers the omitted case; this covers
  // the explicit one.
  amountPaid: null,
  paymentMethod: null,
  paymentDate: null,
  paymentStatus: 'unpaid',
}

/**
 * Scenario 5 (M8, FR-REP-14): `seed-prop-handover` changes hands mid-July
 * 2026 — two SIGNED reports for the SAME property and month, one per
 * tenancy, each under its own re-keyed `tenancyId_YYYY-MM` id. This is the
 * only place (per the production probe — see the file-header comment) any
 * of the following code ever runs against real-shaped data rather than a
 * unit test's mocked one: `useTenanciesCoveringPropertyMonth` returning two
 * rows, `PropertyReportRedirectPage`'s tenancy-picker branch, and
 * FR-PROP-09's cost-history sibling-summing for this property+month.
 *
 * Deliberately lighter than scenarios 1 and 3: no contract or ID-photo
 * Storage uploads for either tenant. The three richer scenarios already
 * exercise every Storage path (`uploadSeedContract`/`uploadSeedIdPhoto`);
 * this one exists to exercise the Firestore/routing hand-over shape, not to
 * duplicate that coverage a fourth and fifth time.
 */
async function reseedHandoverScenario(ownerId) {
  const db = getFirestore()
  const propertyRef = db.collection('properties').doc(SEED_HANDOVER_PROPERTY_ID)
  const userOutRef = db.collection('users').doc(SEED_TENANT_HANDOVER_OUT.uid)
  const userInRef = db.collection('users').doc(SEED_TENANT_HANDOVER_IN.uid)
  const tenancyOutRef = db
    .collection('tenancies')
    .doc(SEED_TENANCY_HANDOVER_OUT_ID)
  const tenancyInRef = db
    .collection('tenancies')
    .doc(SEED_TENANCY_HANDOVER_IN_ID)
  const reportOutRef = db
    .collection('monthlyReports')
    .doc(buildReportId(SEED_TENANCY_HANDOVER_OUT_ID, 2026, 7))
  const reportInRef = db
    .collection('monthlyReports')
    .doc(buildReportId(SEED_TENANCY_HANDOVER_IN_ID, 2026, 7))

  const delBatch = db.batch()
  delBatch.delete(propertyRef)
  delBatch.delete(userOutRef)
  delBatch.delete(userInRef)
  delBatch.delete(tenancyOutRef)
  delBatch.delete(tenancyInRef)
  delBatch.delete(reportOutRef)
  delBatch.delete(reportInRef)
  await delBatch.commit()

  const property = handoverProperty(ownerId)
  const tenancyOut = handoverOutTenancy(ownerId, property)
  const tenancyIn = handoverInTenancy(ownerId, property)

  const writeBatch = db.batch()
  writeBatch.set(propertyRef, property)
  writeBatch.set(userOutRef, tenantHandoverOutUser())
  writeBatch.set(userInRef, tenantHandoverInUser())
  writeBatch.set(tenancyOutRef, tenancyOut)
  writeBatch.set(tenancyInRef, tenancyIn)
  writeBatch.set(reportOutRef, {
    ...HANDOVER_OUT_REPORT,
    ownerId,
    propertyId: SEED_HANDOVER_PROPERTY_ID,
    tenancyId: SEED_TENANCY_HANDOVER_OUT_ID,
    userId: SEED_TENANT_HANDOVER_OUT.uid,
    dueDate: buildDueDate(2026, 7, tenancyOut.dueDay),
    status: 'signed',
    signedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  })
  writeBatch.set(reportInRef, {
    ...HANDOVER_IN_REPORT,
    ownerId,
    propertyId: SEED_HANDOVER_PROPERTY_ID,
    tenancyId: SEED_TENANCY_HANDOVER_IN_ID,
    userId: SEED_TENANT_HANDOVER_IN.uid,
    dueDate: buildDueDate(2026, 7, tenancyIn.dueDay),
    status: 'signed',
    signedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  })
  await writeBatch.commit()

  // Hand-set after both report writes, same reasoning as every other
  // scenario above — mirroring `recomputeCurrentBalance`'s corrected M8
  // formula (finalTotal - amountPaid - roundingSurplus), not a literal.
  // The outgoing tenancy paid its ROUNDED finalTotal (1010) in full, but
  // roundingSurplus(3) means only 1007 was actually owed — the 3 lei
  // difference is a credit the tenant never got to consume (FR-REP-04a's
  // "carried forward as credit" has nowhere to carry to: this tenancy ended
  // the same month). `closingBalance` freezes it at termination — the same
  // pair `endTenancyCore` would have written, hand-mirrored here because
  // this scenario is seeded already-ended, never via the real transaction.
  // The incoming tenancy is unpaid and has no rounding, so its balance
  // equals its own report's finalTotal outright — the two chains never
  // touch each other.
  const outClosingBalance =
    HANDOVER_OUT_REPORT.finalTotal -
    HANDOVER_OUT_REPORT.amountPaid -
    HANDOVER_OUT_REPORT.roundingSurplus
  await tenancyOutRef.update({
    currentBalance: outClosingBalance,
    closingBalance: outClosingBalance,
  })
  await tenancyInRef.update({ currentBalance: HANDOVER_IN_REPORT.finalTotal })

  console.log(
    'Wrote the hand-over scenario (seed-prop-handover, M8/FR-REP-14):',
  )
  console.log(`  - property ${SEED_HANDOVER_PROPERTY_ID}: "${property.name}"`)
  console.log(
    `  - outgoing tenancy ${SEED_TENANCY_HANDOVER_OUT_ID}: ended 2026-07-14, 1 signed report, currentBalance -> 0`,
  )
  console.log(
    `  - incoming tenancy ${SEED_TENANCY_HANDOVER_IN_ID}: active from 2026-07-15, 1 signed report, currentBalance -> ${HANDOVER_IN_REPORT.finalTotal}`,
  )
  console.log(
    `  - both reports keyed to July 2026 under DIFFERENT tenancyIds — FR-REP-14's own reason for existing`,
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

  await ensureTenantAccount(
    SEED_TENANT_HANDOVER_OUT,
    tenantHandoverOutUser().name,
  )
  await ensureTenantAccount(
    SEED_TENANT_HANDOVER_IN,
    tenantHandoverInUser().name,
  )
  await reseedHandoverScenario(ownerId)

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
    `   Tenant sign-in (hand-over, OUTGOING, ended 2026-07-14):         ${SEED_TENANT_HANDOVER_OUT.email} / ${SEED_TENANT_HANDOVER_OUT.password}`,
  )
  console.log(
    `   Tenant sign-in (hand-over, INCOMING, active from 2026-07-15):   ${SEED_TENANT_HANDOVER_IN.email} / ${SEED_TENANT_HANDOVER_IN.password}`,
  )
  console.log(
    `   Shared report link (unauthenticated, M4 sub-stage 8): http://localhost:5173/r/${SIGNED_REPORT_SHARE_TOKEN}`,
  )
}

main().catch((error) => {
  console.error('Error:', error)
  process.exit(1)
})
