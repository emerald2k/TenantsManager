import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getFirestore } from 'firebase-admin/firestore'
import { dailySchedulerHandler } from '../src/scheduler.js'
import { todayInBucharest } from '../src/schedulerLogic.js'

// Functions tests — the REAL boundary (Firestore emulator), no mocks of the
// data layer. Started via `npm run test:emulator` (firebase emulators:exec).
// Mirrors onPropertyUpdate.test.js / kyc.test.js's structure/conventions.

const PROJECT_ID = 'tenants-manager-2026'
const db = getFirestore()

// A fixed `scheduleTime` (v2 ScheduledEvent shape — same `fakeEvent` idiom
// as onReportWriteHandler/onPropertyUpdateHandler) — deterministic across
// this whole file, so tests never depend on whatever real calendar date
// happens to be current when the suite runs (which would make date-relative
// fixtures flaky right at a month boundary).
const FAKE_EVENT = { scheduleTime: '2026-08-15T06:00:00.000Z' } // 09:00 Bucharest (EEST, UTC+3)
const TODAY = todayInBucharest(new Date(FAKE_EVENT.scheduleTime))

function addDays(iso, n) {
  const [y, m, d] = iso.split('-').map(Number)
  const ms = Date.UTC(y, m - 1, d) + n * 86400000
  const dt = new Date(ms)
  const pad = (v) => String(v).padStart(2, '0')
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`
}

async function clearEmulators() {
  const fsHost = process.env.FIRESTORE_EMULATOR_HOST
  await fetch(
    `http://${fsHost}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`,
    { method: 'DELETE' },
  )
}

// Mirrors `toTenancyDocument` (kyc.js) — the real shape a tenancy has in
// production.
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
      },
    },
    startDate: '2026-01-01',
    endDate: '2030-01-01',
    monthlyRent: 2000,
    dueDay: 12,
    reportReminderDaysBefore: 3,
    currentBalance: 0,
    status: 'active',
    attachedDocuments: [],
    ...overrides,
  }
}

async function seedTenancy(id, overrides = {}) {
  await db.collection('tenancies').doc(id).set(tenancy(overrides))
}

async function seedUser(id, overrides = {}) {
  await db
    .collection('users')
    .doc(id)
    .set({
      name: 'Ion Popescu',
      email: 'ion@example.com',
      preferredLanguage: 'ro',
      status: 'active',
      ...overrides,
    })
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

// FR-SYS-06 (M8 stage 7): a heartbeat now fires at the end of EVERY
// completed run where ADMIN_EMAIL is set — one extra `mail` doc on top of
// whatever family 1/2/3 wrote, in every test below that leaves ADMIN_EMAIL
// in place. Identified by its subject prefix (A12's SUBJECT, dailyHeartbeat.js)
// rather than by position — `mail` doc ordering is never guaranteed.
function isHeartbeat(mailDoc) {
  return mailDoc.data().message.subject.startsWith('Automatizări OK')
}

function excludeHeartbeat(mailSnap) {
  return mailSnap.docs.filter((doc) => !isHeartbeat(doc))
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

describe('dailySchedulerHandler (FR-SYS-04)', () => {
  it("sends exactly one A4 email, in the tenant's language, for a tenancy 3 days into arrears", async () => {
    await seedUser('user-1', {
      preferredLanguage: 'ro',
      email: 'ion@example.com',
    })
    await seedTenancy('tenancy-1', {
      userId: 'user-1',
      dueDay: 12, // TODAY(15) - 3 = 12, still this month -> elapsed = 3
      currentBalance: 500,
      endDate: '2030-01-01', // far away -> A5 does not fire
      reportReminderDaysBefore: 3, // next occurrence is ~28 days out -> A6 does not fire
    })
    // FR-PAY-04 precondition (M8): a signed report must exist.
    await seedSignedReport('report-1', { tenancyId: 'tenancy-1' })

    await dailySchedulerHandler(FAKE_EVENT)

    const mailSnap = await db.collection('mail').get()
    // A4 + the heartbeat (FR-SYS-06) — the heartbeat fires on every
    // completed run, not just this one.
    expect(mailSnap.size).toBe(2)
    const nonHeartbeat = excludeHeartbeat(mailSnap)
    expect(nonHeartbeat).toHaveLength(1)
    const mail = nonHeartbeat[0].data()
    expect(mail.to).toEqual(['ion@example.com'])
    expect(mail.message.subject).toContain('Reamintire')
  })

  it('does NOT send A4 when the tenancy has arrears but no signed report exists yet (FR-PAY-04 precondition, M8)', async () => {
    await seedUser('user-1', {
      preferredLanguage: 'ro',
      email: 'ion@example.com',
    })
    await seedTenancy('tenancy-1', {
      userId: 'user-1',
      dueDay: 12,
      currentBalance: 500,
      endDate: '2030-01-01',
      reportReminderDaysBefore: 999,
    })
    // Deliberately NO seedSignedReport — anti-vacuity for the M8 precondition:
    // this is exactly the input the pre-M8 implementation would have fired for.

    await dailySchedulerHandler(FAKE_EVENT)

    const mailSnap = await db.collection('mail').get()
    // No A4 — but the run still completed, so the heartbeat still fires.
    expect(excludeHeartbeat(mailSnap)).toHaveLength(0)
    expect(mailSnap.docs.filter(isHeartbeat)).toHaveLength(1)
  })

  it('skips A5, A6 and the heartbeat when ADMIN_EMAIL is unset, logs once, and still sends A4', async () => {
    delete process.env.ADMIN_EMAIL
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await seedUser('user-1', {
      preferredLanguage: 'ro',
      email: 'ion@example.com',
    })
    await seedTenancy('tenancy-1', {
      userId: 'user-1',
      dueDay: 12, // arrears at elapsed=3, AND would put A6's next occurrence
      // 28 days out (see the first test) — reportReminderDaysBefore=28
      // makes A6 ALSO fire if it weren't gated on ADMIN_EMAIL.
      currentBalance: 500,
      endDate: addDays(TODAY, 90), // exactly 90 days out -> A5 would fire too
      reportReminderDaysBefore: 28,
    })
    await seedSignedReport('report-1', { tenancyId: 'tenancy-1' })

    await dailySchedulerHandler(FAKE_EVENT)

    const mailSnap = await db.collection('mail').get()
    // Just A4 — no A5/A6 (gated on adminEmail), and no heartbeat either
    // (same gate, scheduler.js): there is nowhere to send any of the three.
    expect(mailSnap.size).toBe(1)
    expect(mailSnap.docs[0].data().to).toEqual(['ion@example.com'])
    expect(mailSnap.docs.some(isHeartbeat)).toBe(false)
    expect(errorSpy).toHaveBeenCalledTimes(1)

    errorSpy.mockRestore()
  })

  it('processes the remaining tenancies when one throws (e.g. a dangling userId)', async () => {
    await seedTenancy('tenancy-broken', {
      userId: 'missing-user', // no matching `users` doc -> throws mid-processing
      dueDay: 12,
      currentBalance: 500,
      endDate: '2030-01-01',
      reportReminderDaysBefore: 999,
    })
    await seedSignedReport('report-broken', { tenancyId: 'tenancy-broken' })
    await seedUser('user-2', {
      preferredLanguage: 'en',
      email: 'jane@example.com',
    })
    await seedTenancy('tenancy-ok', {
      userId: 'user-2',
      dueDay: 12,
      currentBalance: 500,
      endDate: '2030-01-01',
      reportReminderDaysBefore: 999,
    })
    await seedSignedReport('report-ok', { tenancyId: 'tenancy-ok' })

    await expect(dailySchedulerHandler(FAKE_EVENT)).resolves.toBeUndefined()

    const mailSnap = await db.collection('mail').get()
    const nonHeartbeat = excludeHeartbeat(mailSnap)
    expect(nonHeartbeat).toHaveLength(1)
    expect(nonHeartbeat[0].data().to).toEqual(['jane@example.com'])
    // The run still completed — the heartbeat fires, and its own error
    // count reflects the one tenancy that threw (proven by the dedicated
    // heartbeat-content test below, not re-asserted here).
    expect(mailSnap.docs.filter(isHeartbeat)).toHaveLength(1)
  })

  it('isolates family 1 from family 2: a missing `users` doc drops A4 but NOT A5 for the SAME tenancy, and logs the failing family', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await seedTenancy('tenancy-1', {
      userId: 'missing-user', // family 1 throws on the `users` lookup
      dueDay: 12,
      currentBalance: 500, // arrears would fire, IF `users` existed
      endDate: addDays(TODAY, 90), // exactly 90 days out -> A5 fires
      reportReminderDaysBefore: 999, // keep A6 out of this test
    })
    // FR-PAY-04 precondition (M8): without a signed report, family 1 would
    // never even attempt the `users` lookup this test depends on throwing.
    await seedSignedReport('report-1', { tenancyId: 'tenancy-1' })

    await dailySchedulerHandler(FAKE_EVENT)

    const mailSnap = await db.collection('mail').get()
    const nonHeartbeat = excludeHeartbeat(mailSnap)
    expect(nonHeartbeat).toHaveLength(1)
    const mail = nonHeartbeat[0].data()
    expect(mail.to).toEqual(['admin@example.com'])
    expect(mail.message.subject).toContain('Contract în expirare')

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('family 1 (arrears)'),
      expect.any(Error),
    )

    errorSpy.mockRestore()
  })

  it('does NOT send A6 when a signed report already exists for this tenancy this month', async () => {
    await seedTenancy('tenancy-1', {
      userId: 'user-1',
      dueDay: 18, // TODAY(15) + 3 = 18, this month -> would fire A6 at
      // reportReminderDaysBefore=3 if no signed report existed.
      currentBalance: 0, // no arrears
      endDate: '2030-01-01', // no expiry
      reportReminderDaysBefore: 3,
    })
    await seedSignedReport('report-1', {
      tenancyId: 'tenancy-1',
      year: 2026,
      month: 8, // matches TODAY's year/month
    })

    await dailySchedulerHandler(FAKE_EVENT)

    const mailSnap = await db.collection('mail').get()
    // No A6 — but the heartbeat still fires (the run still completed).
    expect(excludeHeartbeat(mailSnap)).toHaveLength(0)
    expect(mailSnap.docs.filter(isHeartbeat)).toHaveLength(1)
  })

  it('sends ONLY the heartbeat when no reminder predicate fires for any active tenancy, reporting zero emails/zero errors (FR-SYS-06)', async () => {
    await seedTenancy('tenancy-1', {
      userId: 'user-1',
      dueDay: 1,
      currentBalance: 0, // no arrears
      endDate: '2030-01-01', // no expiry
      reportReminderDaysBefore: 999, // no realistic gap matches this
    })

    await dailySchedulerHandler(FAKE_EVENT)

    const mailSnap = await db.collection('mail').get()
    expect(excludeHeartbeat(mailSnap)).toHaveLength(0)
    const heartbeats = mailSnap.docs.filter(isHeartbeat)
    expect(heartbeats).toHaveLength(1)
    const heartbeat = heartbeats[0].data()
    expect(heartbeat.to).toEqual(['admin@example.com'])
    expect(heartbeat.message.text).toBe(
      'Rulare încheiată: 1 contracte evaluate, 0 emailuri trimise, 0 erori.',
    )
  })

  it('reports the real counts on a run with a mix of sends and a failure (FR-SYS-06 anti-vacuity: the numbers are not always 0)', async () => {
    // tenancy-1: A4 fires (arrears). tenancy-2: throws (missing user), so it
    // contributes to `errors`, not `emailsQueued`. Two tenancies evaluated,
    // one email queued (A4 — A5/A6 don't fire for either), one error.
    await seedUser('user-1', {
      preferredLanguage: 'ro',
      email: 'ion@example.com',
    })
    await seedTenancy('tenancy-1', {
      userId: 'user-1',
      dueDay: 12, // elapsed = 3 -> A4 fires
      currentBalance: 500,
      endDate: '2030-01-01',
      reportReminderDaysBefore: 999,
    })
    await seedSignedReport('report-1', { tenancyId: 'tenancy-1' })
    await seedTenancy('tenancy-2', {
      userId: 'missing-user',
      dueDay: 12,
      currentBalance: 500,
      endDate: '2030-01-01',
      reportReminderDaysBefore: 999,
    })
    await seedSignedReport('report-2', { tenancyId: 'tenancy-2' })
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await dailySchedulerHandler(FAKE_EVENT)

    const mailSnap = await db.collection('mail').get()
    const heartbeat = mailSnap.docs.find(isHeartbeat).data()
    expect(heartbeat.message.text).toBe(
      'Rulare încheiată: 2 contracte evaluate, 1 emailuri trimise, 1 erori.',
    )

    errorSpy.mockRestore()
  })

  it('does NOT send the heartbeat when ADMIN_EMAIL is unset, even on an otherwise-quiet run', async () => {
    delete process.env.ADMIN_EMAIL
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await seedTenancy('tenancy-1', {
      userId: 'user-1',
      dueDay: 1,
      currentBalance: 0,
      endDate: '2030-01-01',
      reportReminderDaysBefore: 999,
    })

    await dailySchedulerHandler(FAKE_EVENT)

    const mailSnap = await db.collection('mail').get()
    expect(mailSnap.size).toBe(0)

    errorSpy.mockRestore()
  })
})
