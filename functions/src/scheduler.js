const { getApps, initializeApp } = require('firebase-admin/app')
const { getFirestore } = require('firebase-admin/firestore')
const { onSchedule } = require('firebase-functions/v2/scheduler')
const {
  todayInBucharest,
  dueDateInMonth,
  nextOccurrenceOfDueDay,
  shouldSendArrearsReminder,
  shouldSendExpiryReminder,
  shouldSendReportReminder,
} = require('./schedulerLogic')
const {
  buildArrearsReminderEmail,
} = require('./mail-templates/arrearsReminder')
const { buildExpiryReminderEmail } = require('./mail-templates/expiryReminder')
const {
  buildReportPrepReminderEmail,
} = require('./mail-templates/reportPrepReminder')

/**
 * dailyScheduler (SRS §7.2, FR-SYS-04). Fires every active tenancy's three
 * reminder families through the pure predicates in `schedulerLogic.js`
 * (sub-stage 2, pinned at ab88cb6) and writes the matching template
 * (sub-stage 3a, pinned at 914ad90) into `mail`.
 *
 * `{ schedule: '0 9 * * *', timeZone: 'Europe/Bucharest' }` — the platform
 * (Cloud Scheduler) handles DST for WHEN this fires; `schedulerLogic.js`'s
 * UTC-based date arithmetic handles it for WHAT fires. Two separate
 * concerns — this file does not compensate for DST in either direction,
 * that would double-correct (or miscorrect) what the other layer already
 * owns.
 */

if (!getApps().length) {
  initializeApp()
}

// Same env-configurable pattern as kyc.js/reports.js's APP_URL.
const APP_URL = process.env.APP_URL || 'http://localhost:5173'

/**
 * Whether the tenancy's tenancyId already has a SIGNED report for the given
 * `year`/`month`. Same query shape as `recomputeCurrentBalance`
 * (reports.js): two equality filters (`tenancyId`, `status`), no `orderBy`
 * — month/year are filtered in memory instead of a third composite-index
 * field.
 */
async function hasSignedReportThisMonth(db, tenancyId, year, month) {
  const snap = await db
    .collection('monthlyReports')
    .where('tenancyId', '==', tenancyId)
    .where('status', '==', 'signed')
    .get()
  return snap.docs.some((doc) => {
    const report = doc.data()
    return report.year === year && report.month === month
  })
}

/**
 * Evaluates and sends all three reminder families for ONE active tenancy.
 * Called from a per-tenancy try/catch (see `dailySchedulerHandler`) — but
 * EACH family below ALSO has its own try/catch, isolating it from the
 * other two: a failure specific to one reminder (e.g. family 1's dangling
 * `userId`) must not cost the OTHER families their reminder for this SAME
 * tenancy. Same "a channel degrades, not two" principle SRS §7.5 already
 * states for ADMIN_EMAIL (cf3b238), applied here in the other direction —
 * missed at first: an orphaned `userId` used to take down family 2's A5
 * (FR-CON-09's 90/60/30-day safety net) for a tenant-data problem that has
 * nothing to do with the admin's contract-expiry warning.
 */
async function processTenancy(db, tenancyId, tenancy, today, adminEmail) {
  const [year, month] = today.split('-').map(Number)

  // FAMILY 1 — arrears reminder (A4, to the TENANT). `dueDate` is derived
  // from `dueDay` for the CURRENT month of `today` — deliberately NOT from
  // any signed report — because arrears accrue against a due date that has
  // already passed, and daysBetween(dueDate, today) needs that past date,
  // not the next upcoming occurrence (which nextOccurrenceOfDueDay computes
  // for family 3, below, and which could point at a FUTURE month instead).
  try {
    const arrearsDueDate = dueDateInMonth(year, month, tenancy.dueDay)
    if (
      shouldSendArrearsReminder({
        today,
        dueDate: arrearsDueDate,
        currentBalance: tenancy.currentBalance,
      })
    ) {
      const userSnap = await db.collection('users').doc(tenancy.userId).get()
      if (!userSnap.exists) {
        throw new Error(
          `tenancy ${tenancyId} references users/${tenancy.userId}, which does not exist.`,
        )
      }
      const user = userSnap.data()
      const mailRef = db.collection('mail').doc()
      await mailRef.set(
        buildArrearsReminderEmail(user.preferredLanguage, {
          name: tenancy.tenantName,
          email: user.email,
          arrearsAmount: tenancy.currentBalance,
          property: tenancy.property.name,
          dueDate: arrearsDueDate,
          url: APP_URL,
        }),
      )
    }
  } catch (error) {
    console.error(
      `dailyScheduler: tenancy ${tenancyId}, family 1 (arrears) failed — continuing with the other families.`,
      error,
    )
  }

  // Families 2 and 3 both go to ADMIN_EMAIL — nothing to evaluate or send
  // for either once it's missing (the run-level console.error already fired
  // once in dailySchedulerHandler; family 1 above never reads adminEmail,
  // so it is entirely unaffected by this return either way).
  if (!adminEmail) return

  // FAMILY 2 — contract expiry reminder (A5, to the admin).
  try {
    if (shouldSendExpiryReminder({ today, endDate: tenancy.endDate })) {
      const mailRef = db.collection('mail').doc()
      await mailRef.set(
        buildExpiryReminderEmail({
          name: tenancy.tenantName,
          email: adminEmail,
          property: tenancy.property.name,
          endDate: tenancy.endDate,
          url: APP_URL,
        }),
      )
    }
  } catch (error) {
    console.error(
      `dailyScheduler: tenancy ${tenancyId}, family 2 (expiry) failed — continuing with the other families.`,
      error,
    )
  }

  // FAMILY 3 — report preparation reminder (A6, to the admin).
  try {
    const signedThisMonth = await hasSignedReportThisMonth(
      db,
      tenancyId,
      year,
      month,
    )
    if (
      shouldSendReportReminder({
        today,
        dueDay: tenancy.dueDay,
        reportReminderDaysBefore: tenancy.reportReminderDaysBefore,
        hasSignedReportThisMonth: signedThisMonth,
      })
    ) {
      const mailRef = db.collection('mail').doc()
      await mailRef.set(
        buildReportPrepReminderEmail({
          email: adminEmail,
          property: tenancy.property.name,
          dueDate: nextOccurrenceOfDueDay(today, tenancy.dueDay),
        }),
      )
    }
  } catch (error) {
    console.error(
      `dailyScheduler: tenancy ${tenancyId}, family 3 (report prep) failed — continuing with the other families.`,
      error,
    )
  }
}

/**
 * `event.scheduleTime` (v2 `ScheduledEvent`, ISO 8601) is the clock source
 * when present, falling back to `new Date()` — the same optional-injection
 * convention `todayInBucharest` itself already uses. This is what lets
 * tests pass a fixed `{ scheduleTime }` (same `fakeEvent` idiom as
 * `onReportWriteHandler`/`onPropertyUpdateHandler`) instead of depending on
 * the wall clock at whatever moment the test suite happens to run — date
 * arithmetic near a month boundary would otherwise make tests flaky exactly
 * once a month, the same class of bug this whole file exists to avoid.
 */
async function dailySchedulerHandler(event) {
  const now = event?.scheduleTime ? new Date(event.scheduleTime) : new Date()
  const db = getFirestore()
  const today = todayInBucharest(now)

  // ADMIN_EMAIL degrades, never throws (SRS §7.5, cf3b238): a fallback would
  // make A5/A6 disappear silently in production, and a thrown error would
  // take A4 — completely unrelated, tenant-facing — down with it. Read and
  // logged ONCE per run, not per tenancy, so a whole fleet of active
  // tenancies doesn't flood Cloud Logging with the same missing-env-var line.
  const adminEmail = process.env.ADMIN_EMAIL
  if (!adminEmail) {
    console.error(
      'dailyScheduler: ADMIN_EMAIL is not set — skipping A5/A6 admin ' +
        'reminders for this run. Tenant-facing A4 reminders are unaffected.',
    )
  }

  const snap = await db
    .collection('tenancies')
    .where('status', '==', 'active')
    .get()

  for (const doc of snap.docs) {
    try {
      await processTenancy(db, doc.id, doc.data(), today, adminEmail)
    } catch (error) {
      // OUTER LAYER — a different role from the per-family try/catch INSIDE
      // processTenancy, not redundant with it: this one is what still
      // catches anything that runs before a family's own try/catch even
      // starts (the shared `year`/`month` prep at the top of
      // processTenancy today, potentially more later) plus anything else
      // genuinely unanticipated. One tenancy's total failure still must not
      // cost every OTHER tenancy its reminders — there is no automatic
      // retry for a missed daily run (Phase 2, FR-SYS-01), so swallowing
      // here is what keeps today's run from being an all-or-nothing gamble
      // on the worst tenancy in it.
      console.error(
        `dailyScheduler: failed to process tenancy ${doc.id} — continuing with the rest.`,
        error,
      )
    }
  }
}

const dailyScheduler = onSchedule(
  { schedule: '0 9 * * *', timeZone: 'Europe/Bucharest' },
  dailySchedulerHandler,
)

module.exports = {
  dailyScheduler,
  dailySchedulerHandler,
}
