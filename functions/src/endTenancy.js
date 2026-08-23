const { getApps, initializeApp } = require('firebase-admin/app')
const { getFirestore, FieldValue } = require('firebase-admin/firestore')
const { onCall, HttpsError } = require('firebase-functions/v2/https')

/**
 * endTenancy (SRS §7.2, FR-CON-03/04/05).
 *
 * Manually terminates an active tenancy, including early (FR-CON-03).
 * **Never blocked by unpaid arrears** (FR-CON-04, reversed at M8): the debt
 * survives termination, frozen into `closingBalance`, and stays visible under
 * FR-DASH-13/14 — the UI states it plainly and requires acknowledgement
 * before calling this (TenancyTab.jsx), but this function itself never
 * refuses on balance. Atomic — a single Firestore
 * transaction, the exact MIRROR of finalizeKyc's tenancy-creation transaction
 * (kyc.js): where finalizeKyc sets `properties.status = 'occupied'` alongside
 * creating `tenancies` (+ `users` on the new-tenant branch), endTenancy sets
 * `properties.status = 'free'` alongside ending `tenancies` (+ `users` back to
 * `'inactive-readonly'`, FR-CON-05). Same read-then-validate-then-write shape,
 * same transaction, same HttpsError-per-failure-path convention.
 *
 * Storage is untouched: unlike finalizeKyc's photo migration, ending a
 * tenancy does not relocate any Storage object — a previously uploaded signed
 * contract (FR-CON-07) simply stays where it is.
 */

if (!getApps().length) {
  initializeApp()
}

/**
 * The core, callable directly by the tests against the emulators. `adminUid` is
 * the calling admin's uid (unused today — kept for symmetry with finalizeKycCore
 * and in case a future audit trail needs it). Throws `HttpsError` with a clear
 * code on every failure path.
 */
// eslint-disable-next-line no-unused-vars
async function endTenancyCore(tenancyId, adminUid) {
  const db = getFirestore()
  const tenancyRef = db.collection('tenancies').doc(tenancyId)

  await db.runTransaction(async (tx) => {
    // ALL READS FIRST — the Admin SDK forbids a read after a write in a transaction.
    const tenancySnap = await tx.get(tenancyRef)

    if (!tenancySnap.exists) {
      throw new HttpsError('not-found', `Tenancy ${tenancyId} does not exist.`)
    }
    const tenancyData = tenancySnap.data()

    if (tenancyData.status !== 'active') {
      throw new HttpsError(
        'failed-precondition',
        'Only an active tenancy can be terminated.',
        { reason: 'not-active' },
      )
    }

    const propertyRef = db.collection('properties').doc(tenancyData.propertyId)
    const userRef = db.collection('users').doc(tenancyData.userId)
    const [propertySnap, userSnap] = await Promise.all([
      tx.get(propertyRef),
      tx.get(userRef),
    ])
    if (!propertySnap.exists) {
      throw new HttpsError(
        'not-found',
        'The tenancy’s property does not exist.',
      )
    }
    if (!userSnap.exists) {
      throw new HttpsError('not-found', 'The tenancy’s account does not exist.')
    }

    // WRITES — symmetric with finalizeKyc's `tx.update(propertyRef, { status:
    // 'occupied' })`: one transaction, three documents, no separate trigger.
    //
    // FR-CON-04 (reversed at M8): termination is NO LONGER blocked by unpaid
    // arrears — the block only hid an unlettable flat, it never collected the
    // debt. `closingBalance` freezes `currentBalance` at the exact moment of
    // termination: `currentBalance` keeps being recomputed off signed reports
    // for as long as the tenancy document exists (e.g. a correction via
    // FR-REP-07a/11a on an already-ended tenancy), but "owed by/to former
    // renters" (FR-DASH-13/14) must read the balance AS OF termination, not
    // whatever it happens to be later — `closingBalance` is that snapshot.
    tx.update(tenancyRef, {
      status: 'ended',
      endedAt: FieldValue.serverTimestamp(),
      closingBalance: tenancyData.currentBalance ?? 0,
    })
    tx.update(propertyRef, { status: 'free' })
    tx.update(userRef, { status: 'inactive-readonly' })
  })

  return { tenancyId }
}

/**
 * The callable handler (admin only). Thin on purpose: it guards the admin claim
 * and the argument, then delegates to the testable core — same shape as
 * finalizeKycHandler (kyc.js).
 */
async function endTenancyHandler(request) {
  if (request.auth?.token?.admin !== true) {
    throw new HttpsError('permission-denied', 'Admin access required.')
  }
  const tenancyId = request.data?.tenancyId
  if (!tenancyId) {
    throw new HttpsError('invalid-argument', 'tenancyId is required.')
  }
  return endTenancyCore(tenancyId, request.auth.uid)
}

const endTenancy = onCall(endTenancyHandler)

module.exports = {
  endTenancy,
  endTenancyHandler,
  endTenancyCore,
}
