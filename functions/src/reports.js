const { getApps, initializeApp } = require('firebase-admin/app')
const { getFirestore, FieldValue } = require('firebase-admin/firestore')
const { onCall, HttpsError } = require('firebase-functions/v2/https')

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

module.exports = {
  signReport,
  unlockReport,
  signReportHandler,
  unlockReportHandler,
  signReportCore,
  unlockReportCore,
}
