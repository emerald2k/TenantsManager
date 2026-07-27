const { getApps, initializeApp } = require('firebase-admin/app')
const { getFirestore, FieldValue } = require('firebase-admin/firestore')
const { onCall, HttpsError } = require('firebase-functions/v2/https')
const { onDocumentWritten } = require('firebase-functions/v2/firestore')

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

async function signReportCore(reportId) {
  const db = getFirestore()
  const reportRef = db.collection('monthlyReports').doc(reportId)

  await db.runTransaction(async (tx) => {
    const reportSnap = await tx.get(reportRef)
    if (!reportSnap.exists) {
      throw new HttpsError('not-found', `Report ${reportId} does not exist.`)
    }
    if (reportSnap.data().status !== 'draft') {
      throw new HttpsError(
        'failed-precondition',
        'Only a draft report can be signed.',
        { reason: 'not-draft' },
      )
    }
    tx.update(reportRef, {
      status: 'signed',
      signedAt: FieldValue.serverTimestamp(),
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
  return signReportCore(reportId)
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
 * Always a full re-derivation, never an increment/decrement — naturally
 * idempotent under onDocumentWritten's at-least-once delivery.
 */
async function recomputeCurrentBalance(tenancyId) {
  const db = getFirestore()
  const snap = await db
    .collection('monthlyReports')
    .where('tenancyId', '==', tenancyId)
    .where('status', '==', 'signed')
    .get()

  if (snap.empty) {
    await db
      .collection('tenancies')
      .doc(tenancyId)
      .update({ currentBalance: 0 })
    return
  }

  const mostRecent = snap.docs
    .map((doc) => doc.data())
    .sort((a, b) => b.year - a.year || b.month - a.month)[0]

  const currentBalance =
    (mostRecent.finalTotal ?? 0) - (mostRecent.amountPaid ?? 0)
  await db.collection('tenancies').doc(tenancyId).update({ currentBalance })
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
}
