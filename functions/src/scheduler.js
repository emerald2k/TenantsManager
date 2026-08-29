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
  shouldSendPreDueReminder,
  shouldSendContractExpiredBackstop,
} = require('./schedulerLogic')
const {
  buildArrearsReminderEmail,
} = require('./mail-templates/arrearsReminder')
const { buildExpiryReminderEmail } = require('./mail-templates/expiryReminder')
const {
  buildReportPrepReminderEmail,
} = require('./mail-templates/reportPrepReminder')
const { buildPreDueReminderEmail } = require('./mail-templates/preDueReminder')
const {
  buildContractExpiredBackstopEmail,
} = require('./mail-templates/contractExpiredBackstop')
const { buildDailyHeartbeatEmail } = require('./mail-templates/dailyHeartbeat')

/**
 * dailyScheduler (SRS §7.2, FR-SYS-04). Fires every active tenancy's five
 * reminder families through the pure predicates in `schedulerLogic.js`
 * (sub-stage 2, pinned at ab88cb6; family 4 added M8 stage 13, FR-PAY-10;
 * family 5 added M8 stage 14, FR-CON-08) and writes the matching template
 * (sub-stage 3a, pinned at 914ad90) into `mail`.
 *
 * `{ schedule: '0 9 * * *', timeZone: 'Europe/Bucharest' }` — the platform
 * (Cloud Scheduler) handles DST for WHEN this fires; `schedulerLogic.js`'s
 * UTC-based date arithmetic handles it for WHAT fires. Two separate
 * concerns — this file does not compensate for DST in either direction,
 * that would double-correct (or miscorrect) what the other layer already
 * owns.
 *
 * Ends every completed run by emailing `ADMIN_EMAIL` a heartbeat (M8 stage
 * 7, FR-SYS-06, template A12) — tenancies evaluated, emails queued, errors
 * caught. Its content is almost never interesting; its ABSENCE is: a
 * scheduler that has died sends nothing, and a quiet month looks identical
 * to one where everyone paid on time. This is the only mechanism that would
 * ever surface a dead scheduler.
 */

if (!getApps().length) {
  initializeApp()
}

// Same env-configurable pattern as kyc.js/reports.js's APP_URL.
const APP_URL = process.env.APP_URL || 'http://localhost:5173'

/**
 * Whether the tenancy's tenancyId has ANY signed report at all — FR-PAY-04's
 * precondition (M8): a reminder about a balance with no signed report to
 * point at has nothing to name. Same query shape as
 * `recomputeCurrentBalance`/`hasSignedReportThisMonth` below (two equality
 * filters, no `orderBy`).
 */
async function hasAnySignedReport(db, tenancyId) {
  const snap = await db
    .collection('monthlyReports')
    .where('tenancyId', '==', tenancyId)
    .where('status', '==', 'signed')
    .limit(1)
    .get()
  return !snap.empty
}

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
 * The tenancy's most recent SIGNED report, or `null` if none exists —
 * FR-PAY-10a's anchor. Same two-equality-filter, no-`orderBy` query shape
 * as `hasSignedReportThisMonth`/`hasAnySignedReport`; "most recent" is
 * resolved in memory by (year, month), the same no-composite-index
 * discipline as the rest of this codebase (SRS §6). A single Firestore read
 * of every signed report on the tenancy — cheap at NFR-PERF-01's scale, and
 * the same set `hasAnySignedReport` would otherwise fetch redundantly for
 * FAMILY 1, so FAMILY 4 does its own fetch rather than trying to share it:
 * FAMILY 1 only needs EXISTENCE, FAMILY 4 needs the actual latest document.
 */
async function mostRecentSignedReport(db, tenancyId) {
  const snap = await db
    .collection('monthlyReports')
    .where('tenancyId', '==', tenancyId)
    .where('status', '==', 'signed')
    .get()
  if (snap.empty) return null
  return snap.docs
    .map((doc) => ({ id: doc.id, ...doc.data() }))
    .reduce((latest, report) => {
      if (!latest) return report
      if (report.year !== latest.year) {
        return report.year > latest.year ? report : latest
      }
      return report.month > latest.month ? report : latest
    }, null)
}

/**
 * Evaluates and sends all five reminder families for ONE active tenancy.
 * Called from a per-tenancy try/catch (see `dailySchedulerHandler`) — but
 * EACH family below ALSO has its own try/catch, isolating it from the
 * others: a failure specific to one reminder (e.g. family 1's dangling
 * `userId`) must not cost the OTHER families their reminder for this SAME
 * tenancy. Same "a channel degrades, not two" principle SRS §7.5 already
 * states for ADMIN_EMAIL (cf3b238), applied here in the other direction —
 * missed at first: an orphaned `userId` used to take down family 2's A5
 * (FR-CON-09's 90/60/30-day safety net) for a tenant-data problem that has
 * nothing to do with the admin's contract-expiry warning.
 *
 * Returns `{ emailsQueued, errors }` (M8 stage 7, FR-SYS-06) — the run-level
 * counts the heartbeat reports. Counting here, at the source of each
 * `mail.set()`/`catch`, is what keeps the heartbeat's numbers honest without
 * a second pass over `mail` after the fact (which would also double-count
 * anything a previous, unrelated run had already written).
 */
async function processTenancy(db, tenancyId, tenancy, today, adminEmail) {
  const [year, month] = today.split('-').map(Number)
  let emailsQueued = 0
  let errors = 0

  // FAMILY 1 — arrears reminder (A4, to the TENANT). `dueDate` is derived
  // from `dueDay` for the CURRENT month of `today` — deliberately NOT from
  // any signed report — because arrears accrue against a due date that has
  // already passed, and daysBetween(dueDate, today) needs that past date,
  // not the next upcoming occurrence (which nextOccurrenceOfDueDay computes
  // for family 3, below, and which could point at a FUTURE month instead).
  try {
    const arrearsDueDate = dueDateInMonth(year, month, tenancy.dueDay)
    const signedReportExists = await hasAnySignedReport(db, tenancyId)
    if (
      shouldSendArrearsReminder({
        today,
        dueDate: arrearsDueDate,
        currentBalance: tenancy.currentBalance,
        hasSignedReport: signedReportExists,
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
          relatedId: tenancyId,
          ownerId: tenancy.ownerId,
        }),
      )
      emailsQueued += 1
    }
  } catch (error) {
    console.error(
      `dailyScheduler: tenancy ${tenancyId}, family 1 (arrears) failed — continuing with the other families.`,
      error,
    )
    errors += 1
  }

  // FAMILY 4 — pre-due payment reminder (A8, to the TENANT). Anchored on
  // the tenancy's most recent SIGNED report's own `dueDate` (FR-PAY-10a),
  // never `dueDay` — a fresh fetch per tenancy, not shared with family 1's
  // `hasAnySignedReport`, which only needs existence, not the document
  // itself. `mailRef` uses a DETERMINISTIC id (FR-PAY-10e:
  // `{reportId}_predue_{today}`) rather than `.doc()`'s auto id — the one
  // reminder family in this file where a doubled run must overwrite
  // instead of duplicating, because it is the only DAILY-repeating,
  // tenant-facing job (every other family here fires at most once per
  // cycle for a given date).
  try {
    const report = await mostRecentSignedReport(db, tenancyId)
    if (
      report &&
      shouldSendPreDueReminder({
        today,
        dueDate: report.dueDate,
        finalTotal: report.finalTotal,
        amountPaid: report.amountPaid,
        paymentReminderDaysBefore: tenancy.paymentReminderDaysBefore ?? 3,
      })
    ) {
      const userSnap = await db.collection('users').doc(tenancy.userId).get()
      if (!userSnap.exists) {
        throw new Error(
          `tenancy ${tenancyId} references users/${tenancy.userId}, which does not exist.`,
        )
      }
      const user = userSnap.data()
      const mailRef = db.collection('mail').doc(`${report.id}_predue_${today}`)
      await mailRef.set(
        buildPreDueReminderEmail(user.preferredLanguage, {
          name: tenancy.tenantName,
          email: user.email,
          property: tenancy.property.name,
          month: report.month,
          year: report.year,
          dueDate: report.dueDate,
          finalTotal: report.finalTotal,
          url: APP_URL,
          relatedId: report.id,
          ownerId: tenancy.ownerId,
        }),
      )
      emailsQueued += 1
    }
  } catch (error) {
    console.error(
      `dailyScheduler: tenancy ${tenancyId}, family 4 (pre-due) failed — continuing with the other families.`,
      error,
    )
    errors += 1
  }

  // Families 2 and 3 both go to ADMIN_EMAIL — nothing to evaluate or send
  // for either once it's missing (the run-level console.error already fired
  // once in dailySchedulerHandler; families 1 and 4 above never read
  // adminEmail, so neither is affected by this return either way).
  if (!adminEmail) return { emailsQueued, errors }

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
          relatedId: tenancyId,
          ownerId: tenancy.ownerId,
        }),
      )
      emailsQueued += 1
    }
  } catch (error) {
    console.error(
      `dailyScheduler: tenancy ${tenancyId}, family 2 (expiry) failed — continuing with the other families.`,
      error,
    )
    errors += 1
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
          relatedId: tenancyId,
          ownerId: tenancy.ownerId,
        }),
      )
      emailsQueued += 1
    }
  } catch (error) {
    console.error(
      `dailyScheduler: tenancy ${tenancyId}, family 3 (report prep) failed — continuing with the other families.`,
      error,
    )
    errors += 1
  }

  // FAMILY 5 — expired-contract backstop (A11, to the admin, FR-CON-08).
  // Weekly, for as long as the tenancy stays active past its own `endDate`.
  // Never terminates anything — FR-CON-08's manual-only rule stands.
  try {
    if (
      shouldSendContractExpiredBackstop({ today, endDate: tenancy.endDate })
    ) {
      const mailRef = db.collection('mail').doc()
      await mailRef.set(
        buildContractExpiredBackstopEmail({
          name: tenancy.tenantName,
          email: adminEmail,
          property: tenancy.property.name,
          endDate: tenancy.endDate,
          url: APP_URL,
          relatedId: tenancyId,
          ownerId: tenancy.ownerId,
        }),
      )
      emailsQueued += 1
    }
  } catch (error) {
    console.error(
      `dailyScheduler: tenancy ${tenancyId}, family 5 (contract-expired backstop) failed — continuing with the other families.`,
      error,
    )
    errors += 1
  }

  return { emailsQueued, errors }
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

  // FR-SYS-06: the heartbeat's three counts, aggregated across the whole
  // run. `tenanciesEvaluated` is `snap.docs.length` regardless of how any
  // individual tenancy fares below — a tenancy that throws before even
  // reaching a family's own try/catch was still EVALUATED, its outcome was
  // just an error, which the outer catch below already counts.
  const tenanciesEvaluated = snap.docs.length
  let totalEmailsQueued = 0
  let totalErrors = 0

  for (const doc of snap.docs) {
    try {
      const result = await processTenancy(
        db,
        doc.id,
        doc.data(),
        today,
        adminEmail,
      )
      totalEmailsQueued += result.emailsQueued
      totalErrors += result.errors
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
      totalErrors += 1
    }
  }

  // The heartbeat itself (A12) — sent on every COMPLETED run, unconditionally
  // of whether any reminder fired. Guarded on `adminEmail` for the same
  // reason families 2/3 are: nothing to send it to otherwise, and
  // FR-SYS-07's in-app banner is the substitute alarm for exactly this case.
  if (adminEmail) {
    const mailRef = db.collection('mail').doc()
    await mailRef.set(
      buildDailyHeartbeatEmail({
        email: adminEmail,
        today,
        tenanciesEvaluated,
        emailsQueued: totalEmailsQueued,
        errors: totalErrors,
      }),
    )
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
