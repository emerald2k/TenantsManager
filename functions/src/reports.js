const { getApps, initializeApp } = require('firebase-admin/app')
const { getFirestore, FieldValue } = require('firebase-admin/firestore')
const { onCall, HttpsError } = require('firebase-functions/v2/https')
const { onDocumentWritten } = require('firebase-functions/v2/firestore')
const {
  buildReportNotificationEmail,
} = require('./mail-templates/reportNotification')
const {
  buildPaymentRecordedEmail,
} = require('./mail-templates/paymentRecorded')

/**
 * signReport / unlockReport (SRS §7.2, FR-REP-07/07a).
 *
 * Same shape as endTenancy.js: a thin admin-only callable handler delegates to
 * a testable `*Core` function that runs a single Firestore transaction
 * (read-then-validate-then-write, HttpsError-per-failure-path).
 *
 * The `status` field is the ONLY thing either function touches. Locking a
 * signed report's fields against further edits is enforced by the UI (the
 * admin's own Security Rules access is untouched — SRS §7.3, single-trusted-
 * admin model) and by these two preconditions themselves: draft->signed only
 * from 'draft', signed->draft only from 'signed'.
 */

if (!getApps().length) {
  initializeApp()
}

// The tenant-portal URL that goes into the A2/A3 report notification email —
// same env-configurable local constant as kyc.js's APP_URL: no per-report
// deep link exists (SRS §5.4 defines only /app and /app/history), so this is
// the same generic portal URL A1/A7 already use.
const APP_URL = process.env.APP_URL || 'http://localhost:5173'

/**
 * signReportCore (FR-REP-07, FR-REP-11/11a, FR-REP-04e).
 *
 * CHRONOLOGICAL GUARD (FR-REP-11): rejects signing a report whose (year,
 * month) is earlier than that of any ALREADY-signed report on the same
 * tenancy. `currentBalance` is derived from the single most recent signed
 * report (`recomputeCurrentBalance`, above) — signing an earlier month after
 * a later one has no effect on any balance whatsoever (FR-REP-11a). The
 * report being signed here is still `status: 'draft'` at read time, so it
 * never appears in its own sibling query — no `<=` needed, `<` alone is
 * correct and a same-month re-sign after unlock is never blocked by itself.
 * Query, not a fetch-all: same two-equality-filter, sort-in-memory shape as
 * `recomputeCurrentBalance` (no composite index, SRS §6). Read BEFORE any
 * write — the Admin SDK forbids a read after a write in a transaction.
 *
 * `overrideReason` (FR-REP-04e, optional): when the admin's confirmation
 * dialog collected a reason for a finalTotal that materially diverges from
 * calculatedTotal, it is stored verbatim with a timestamp. Not enforced
 * here — the divergence check and the second-confirmation gate are UI
 * (MonthlyReportPage/SignReportControl), consistent with this codebase's
 * single-trusted-admin model (SRS §7.3): the field is an audit trail, not an
 * access boundary a Cloud Function needs to police.
 */
async function signReportCore(reportId, overrideReason) {
  const db = getFirestore()
  const reportRef = db.collection('monthlyReports').doc(reportId)

  await db.runTransaction(async (tx) => {
    const reportSnap = await tx.get(reportRef)
    if (!reportSnap.exists) {
      throw new HttpsError('not-found', `Report ${reportId} does not exist.`)
    }
    const report = reportSnap.data()
    if (report.status !== 'draft') {
      throw new HttpsError(
        'failed-precondition',
        'Only a draft report can be signed.',
        { reason: 'not-draft' },
      )
    }

    const priorSignedSnap = await tx.get(
      db
        .collection('monthlyReports')
        .where('tenancyId', '==', report.tenancyId)
        .where('status', '==', 'signed'),
    )
    const blocking = priorSignedSnap.docs
      .map((doc) => doc.data())
      // A LATER already-signed month blocks this one — the earliest such
      // later month is the one the unlock procedure (FR-REP-11a) names.
      .filter(
        (signed) =>
          signed.year > report.year ||
          (signed.year === report.year && signed.month > report.month),
      )
      .sort((a, b) => a.year - b.year || a.month - b.month)[0]
    if (blocking) {
      throw new HttpsError(
        'failed-precondition',
        `A later month (${blocking.month}/${blocking.year}) is already signed on this tenancy. ` +
          'Signing an earlier month now would never be reflected in any balance (FR-REP-11a): ' +
          'unlock every signed report later than this one, sign this month, then re-sign the ' +
          'unlocked months in ascending order.',
        {
          reason: 'chronological-order',
          blockingMonth: blocking.month,
          blockingYear: blocking.year,
        },
      )
    }

    tx.update(reportRef, {
      status: 'signed',
      signedAt: FieldValue.serverTimestamp(),
      ...(overrideReason
        ? {
            finalTotalOverrideReason: overrideReason,
            finalTotalOverrideReasonAt: FieldValue.serverTimestamp(),
          }
        : {}),
    })
  })

  return { reportId }
}

async function unlockReportCore(reportId) {
  const db = getFirestore()
  const reportRef = db.collection('monthlyReports').doc(reportId)

  await db.runTransaction(async (tx) => {
    const reportSnap = await tx.get(reportRef)
    if (!reportSnap.exists) {
      throw new HttpsError('not-found', `Report ${reportId} does not exist.`)
    }
    if (reportSnap.data().status !== 'signed') {
      throw new HttpsError(
        'failed-precondition',
        'Only a signed report can be unlocked.',
        { reason: 'not-signed' },
      )
    }
    // signedAt is deliberately left untouched — signReport overwrites it with
    // a fresh timestamp on re-signing, so no stale value ever leaks into a
    // re-signed report (SRS FR-REP-07a: unlocking only specifies status).
    tx.update(reportRef, { status: 'draft' })
  })

  return { reportId }
}

async function signReportHandler(request) {
  if (request.auth?.token?.admin !== true) {
    throw new HttpsError('permission-denied', 'Admin access required.')
  }
  const reportId = request.data?.reportId
  if (!reportId) {
    throw new HttpsError('invalid-argument', 'reportId is required.')
  }
  return signReportCore(reportId, request.data?.overrideReason)
}

async function unlockReportHandler(request) {
  if (request.auth?.token?.admin !== true) {
    throw new HttpsError('permission-denied', 'Admin access required.')
  }
  const reportId = request.data?.reportId
  if (!reportId) {
    throw new HttpsError('invalid-argument', 'reportId is required.')
  }
  return unlockReportCore(reportId)
}

const signReport = onCall(signReportHandler)
const unlockReport = onCall(unlockReportHandler)

/**
 * recomputeCurrentBalance (SRS §6, pinned at e8ca367): re-derives
 * `tenancies/{tenancyId}.currentBalance` from scratch — the tenancy's most
 * recent SIGNED report's `finalTotal − (amountPaid ?? 0)`. NEVER a sum across
 * reports: a signed report's own `previousMonthArrears`/`previousMonthCredit`
 * already rolled the PRIOR balance forward into its `finalTotal`, so summing
 * every signed report would double-count that history.
 *
 * "Most recent" is found by querying `monthlyReports` with two equality
 * filters (`tenancyId == X AND status == 'signed'`, no `orderBy`, so no
 * composite index is needed at this project's scale — a tenancy has at most
 * a handful of signed reports) and sorting the results IN MEMORY by
 * `(year, month)`.
 *
 * `amountPaid ?? 0` matters on its own: a just-signed report that has not
 * been paid yet has no `amountPaid` field at all — without the fallback,
 * `finalTotal - undefined` is `NaN`, which would silently corrupt
 * `currentBalance` the moment a report is signed, before any payment exists.
 *
 * `roundingSurplus ?? 0` (SRS §6, FR-REP-04a/04c, M8): a report produced by
 * the rounding action asked the tenant for a round `finalTotal` but only
 * `finalTotal - roundingSurplus` was actually owed — the surplus is the
 * tenant's credit, already destined to reduce `previousMonthArrears` (or
 * grow `previousMonthCredit`) on the NEXT report via `buildInitialValues`.
 * Omitting this subtraction here would silently pocket that credit instead
 * of carrying it forward.
 *
 * Always a full re-derivation, never an increment/decrement — naturally
 * idempotent under onDocumentWritten's at-least-once delivery.
 */
async function recomputeCurrentBalance(tenancyId) {
  const db = getFirestore()
  const currentBalance = await computeBalanceFromSignedReports(tenancyId)
  await db.collection('tenancies').doc(tenancyId).update({ currentBalance })
}

/**
 * The READ-ONLY half of the identity above — everything `recomputeCurrentBalance`
 * does except the `tenancies` write. Extracted at M8 stage 7 (FR-SYS-05):
 * `reconcileBalances` needs the SAME formula to compare against the stored
 * value, but must never write — the whole point of reconciliation is that it
 * reports a divergence instead of silently overwriting a real balance on the
 * strength of a calculation nobody has reviewed. Sharing this function (both
 * callers live in `functions/`, so there is no cross-package deploy boundary
 * forcing a duplicate, unlike the KYC schema or the DST arithmetic) is what
 * keeps the two from drifting apart the way two independently-typed copies
 * eventually would.
 */
async function computeBalanceFromSignedReports(tenancyId) {
  const db = getFirestore()
  const snap = await db
    .collection('monthlyReports')
    .where('tenancyId', '==', tenancyId)
    .where('status', '==', 'signed')
    .get()

  if (snap.empty) return 0

  const mostRecent = snap.docs
    .map((doc) => doc.data())
    .sort((a, b) => b.year - a.year || b.month - a.month)[0]

  return (
    (mostRecent.finalTotal ?? 0) -
    (mostRecent.amountPaid ?? 0) -
    (mostRecent.roundingSurplus ?? 0)
  )
}

/**
 * onReportWrite (SRS §7.2, NFR-PERF-04). The FIRST Firestore trigger in this
 * codebase (every other Cloud Function so far is an onCall). Fires on every
 * write to monthlyReports/{reportId}.
 *
 * SKIP condition: only when NEITHER side of the write was ever 'signed' —
 * i.e. before.status !== 'signed' AND after.status !== 'signed'. With only
 * two statuses in play, that is exactly "before is draft-or-nonexistent AND
 * after is draft" — a plain draft create/edit that never touches a signed
 * report. Everything else RECOMPUTES, including:
 *  - draft -> signed (signReport)
 *  - signed -> draft (unlockReport — the just-unlocked report drops out of
 *    "most recent signed", balance may fall back to an older one or to 0)
 *  - signed -> signed (a payment marked/cancelled on an already-signed
 *    report via useMarkPayment/useCancelPayment — THE main payment path;
 *    status never changes here, only amountPaid/paymentStatus do, so this
 *    case would be wrongly skipped by a status-TRANSITION check — it is
 *    deliberately keyed on status PRESENCE on either side, not on a change)
 *  - a signed report being deleted (before.status === 'signed', after does
 *    not exist)
 *
 * Deliberately does NOT send email — report notifications are exclusively
 * on-demand via sendReportNotification (FR-REP-06/07a, sub-stage 6), a scope
 * this function was explicitly corrected to stay out of at b5bfff7.
 */
async function onReportWriteHandler(event) {
  const after = event.data?.after?.exists ? event.data.after.data() : null
  const before = event.data?.before?.exists ? event.data.before.data() : null

  const wasOrIsSigned =
    before?.status === 'signed' || after?.status === 'signed'
  if (!wasOrIsSigned) return

  const tenancyId = after?.tenancyId ?? before?.tenancyId
  if (!tenancyId) return

  await recomputeCurrentBalance(tenancyId)
}

const onReportWrite = onDocumentWritten(
  'monthlyReports/{reportId}',
  onReportWriteHandler,
)

/**
 * sendReportNotification (SRS §7.2, FR-REP-06/FR-REP-07a, pinned at f6d5c83).
 * ON-DEMAND ONLY — the admin picks `template` ('new' | 'updated' → A2 | A3)
 * fresh at every send; there is no auto-detection and no tracking field.
 *
 * REJECTS a report that isn't `status=='signed'` (failed-precondition,
 * reason 'not-signed') — a draft is invisible to the tenant (FR-REP-06), so
 * notifying about it would point at something the tenant can't even see.
 *
 * {total} in the email is ALWAYS `finalTotal`, never `calculatedTotal`
 * (FR-REP-04c) — finalTotal is the only amount owed.
 *
 * No transaction: this only WRITES to `mail`, a different collection from
 * the one it reads (`monthlyReports`) — there is no invariant to protect
 * between the status read and the mail write. A signed report that gets
 * unlocked in that narrow window may still get one stale email; that's
 * harmless and the admin just re-sends, the same tolerance the "no
 * tracking, manual every time" pin already assumes.
 */
async function sendReportNotificationCore(reportId, template, adminUid) {
  const db = getFirestore()
  const reportSnap = await db.collection('monthlyReports').doc(reportId).get()
  if (!reportSnap.exists) {
    throw new HttpsError('not-found', `Report ${reportId} does not exist.`)
  }
  const report = reportSnap.data()
  if (report.status !== 'signed') {
    throw new HttpsError(
      'failed-precondition',
      'Only a signed report can be notified by email.',
      { reason: 'not-signed' },
    )
  }

  const userSnap = await db.collection('users').doc(report.userId).get()
  if (!userSnap.exists) {
    throw new HttpsError('not-found', 'The tenant account does not exist.')
  }
  const user = userSnap.data()

  const mailRef = db.collection('mail').doc()
  await mailRef.set(
    buildReportNotificationEmail(template, user.preferredLanguage, {
      name: user.name,
      email: user.email,
      month: report.month,
      year: report.year,
      finalTotal: report.finalTotal,
      dueDate: report.dueDate,
      url: APP_URL,
      relatedId: reportId,
      ownerId: adminUid,
    }),
  )

  return { reportId, template }
}

async function sendReportNotificationHandler(request) {
  if (request.auth?.token?.admin !== true) {
    throw new HttpsError('permission-denied', 'Admin access required.')
  }
  const reportId = request.data?.reportId
  if (!reportId) {
    throw new HttpsError('invalid-argument', 'reportId is required.')
  }
  const template = request.data?.template
  if (template !== 'new' && template !== 'updated') {
    throw new HttpsError(
      'invalid-argument',
      "template must be 'new' or 'updated'.",
    )
  }
  return sendReportNotificationCore(reportId, template, request.auth.uid)
}

const sendReportNotification = onCall(sendReportNotificationHandler)

/**
 * sendPaymentConfirmation (SRS §7.2, FR-PAY-01, Appendix A10) — "the payment
 * action" in the twelve-write-sites table. On the administrator's explicit
 * request ONLY, from the payment section — the same discipline as A2/A3
 * (FR-REP-06): the product never emails the tenant behind the
 * administrator's back. NOT wired into `useMarkPayment` (a plain client
 * `updateDoc`, per M4 sub-stage 5 Decision 1) because `mail` is closed to
 * every client, admin included (SRS §7.3) — a client write can never reach
 * it, so this has to be its own callable, mirroring
 * `sendReportNotification`'s exact "separate, on-demand action, not
 * automatic" shape.
 *
 * REJECTS a report with no payment recorded yet (failed-precondition,
 * reason 'no-payment') — `paymentStatus` is written for the first time by
 * `useMarkPayment`, so its absence (or `'unpaid'`, never actually written
 * by that hook but checked defensively) means there is nothing to confirm.
 *
 * `{total}`/`{dueDate}` in the A10 template are the amount actually PAID
 * and the payment DATE — never `finalTotal`/the report's own `dueDate`,
 * which A2/A3/A4/A8 give those same placeholder names.
 */
async function sendPaymentConfirmationCore(reportId, adminUid) {
  const db = getFirestore()
  const reportSnap = await db.collection('monthlyReports').doc(reportId).get()
  if (!reportSnap.exists) {
    throw new HttpsError('not-found', `Report ${reportId} does not exist.`)
  }
  const report = reportSnap.data()
  if (report.paymentStatus !== 'partial' && report.paymentStatus !== 'paid') {
    throw new HttpsError(
      'failed-precondition',
      'This report has no payment recorded yet.',
      { reason: 'no-payment' },
    )
  }

  const userSnap = await db.collection('users').doc(report.userId).get()
  if (!userSnap.exists) {
    throw new HttpsError('not-found', 'The tenant account does not exist.')
  }
  const user = userSnap.data()

  const tenancySnap = await db
    .collection('tenancies')
    .doc(report.tenancyId)
    .get()
  if (!tenancySnap.exists) {
    throw new HttpsError('not-found', 'The tenancy does not exist.')
  }
  const tenancy = tenancySnap.data()

  const mailRef = db.collection('mail').doc()
  await mailRef.set(
    buildPaymentRecordedEmail(user.preferredLanguage, {
      name: user.name,
      email: user.email,
      property: tenancy.property.name,
      month: report.month,
      year: report.year,
      amountPaid: report.amountPaid,
      paymentDate: report.paymentDate,
      url: APP_URL,
      relatedId: reportId,
      ownerId: adminUid,
    }),
  )

  return { reportId }
}

async function sendPaymentConfirmationHandler(request) {
  if (request.auth?.token?.admin !== true) {
    throw new HttpsError('permission-denied', 'Admin access required.')
  }
  const reportId = request.data?.reportId
  if (!reportId) {
    throw new HttpsError('invalid-argument', 'reportId is required.')
  }
  return sendPaymentConfirmationCore(reportId, request.auth.uid)
}

const sendPaymentConfirmation = onCall(sendPaymentConfirmationHandler)

module.exports = {
  signReport,
  unlockReport,
  signReportHandler,
  unlockReportHandler,
  signReportCore,
  unlockReportCore,
  onReportWrite,
  onReportWriteHandler,
  recomputeCurrentBalance,
  computeBalanceFromSignedReports,
  sendReportNotification,
  sendReportNotificationHandler,
  sendReportNotificationCore,
  sendPaymentConfirmation,
  sendPaymentConfirmationHandler,
  sendPaymentConfirmationCore,
}
