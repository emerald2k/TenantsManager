const { getApps, initializeApp } = require('firebase-admin/app')
const { getFirestore, FieldValue } = require('firebase-admin/firestore')
const { onCall, HttpsError } = require('firebase-functions/v2/https')
const { computeBalanceFromSignedReports } = require('./reports')

/**
 * recalculateTenancyBalance (SRS §7.2, FR-SYS-05a, owner decision
 * 2026-08-24). The administrator's answer to a `reconcileBalances` mismatch
 * email — "a button, not a database edit". `NFR-SEC-12` pins
 * `tenancies.currentBalance` against every browser write, so this MUST be a
 * Cloud Function: there is no client write path left for this field, by
 * design, and this is the one deliberate exception.
 *
 * Deliberately NOT automatic and NOT triggered by `reconcileBalances`
 * itself — FR-SYS-05's whole point survives here: "nothing recalculates on
 * its own; a human looks at two numbers and decides." The UI shows the
 * stored value, the recomputed value, and the report chain BEFORE the admin
 * ever calls this — this function only runs once that human has already
 * decided, and it recomputes independently, server-side, rather than
 * trusting whatever the client displayed (closing any staleness window
 * between the preview read and this call — a report signed in between is
 * picked up here, not missed).
 *
 * Records who/when/from/to directly on the tenancy document — same
 * "audit trail as a field on the document" convention `overrideReason`/
 * `overrideReasonAt` already established on `monthlyReports` (FR-REP-04e,
 * M8 stage 5) — so a correction is never anonymous.
 */

if (!getApps().length) {
  initializeApp()
}

/**
 * The core, callable directly by the tests. `adminUid` identifies WHO
 * recalculated, for the audit trail — unlike every other `*Core` function's
 * unused `adminUid` (kept only for symmetry), this one actually uses it.
 */
async function recalculateTenancyBalanceCore(tenancyId, adminUid) {
  const db = getFirestore()
  const tenancyRef = db.collection('tenancies').doc(tenancyId)

  const tenancySnap = await tenancyRef.get()
  if (!tenancySnap.exists) {
    throw new HttpsError('not-found', `Tenancy ${tenancyId} does not exist.`)
  }
  const from = tenancySnap.data().currentBalance ?? 0
  const to = await computeBalanceFromSignedReports(tenancyId)

  await tenancyRef.update({
    currentBalance: to,
    lastRecalculatedBy: adminUid,
    lastRecalculatedAt: FieldValue.serverTimestamp(),
    lastRecalculatedFrom: from,
    lastRecalculatedTo: to,
  })

  return { from, to }
}

/**
 * The callable handler (admin only). Thin on purpose — same shape as every
 * other callable in this codebase.
 */
async function recalculateTenancyBalanceHandler(request) {
  if (request.auth?.token?.admin !== true) {
    throw new HttpsError('permission-denied', 'Admin access required.')
  }
  const tenancyId = request.data?.tenancyId
  if (!tenancyId) {
    throw new HttpsError('invalid-argument', 'tenancyId is required.')
  }
  return recalculateTenancyBalanceCore(tenancyId, request.auth.uid)
}

const recalculateTenancyBalance = onCall(recalculateTenancyBalanceHandler)

module.exports = {
  recalculateTenancyBalance,
  recalculateTenancyBalanceHandler,
  recalculateTenancyBalanceCore,
}
