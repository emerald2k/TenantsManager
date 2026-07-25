const { getApps, initializeApp } = require('firebase-admin/app')
const { getFirestore, FieldValue } = require('firebase-admin/firestore')
const { onCall, HttpsError } = require('firebase-functions/v2/https')

/**
 * endTenancy (SRS §7.2, FR-CON-03/04/05).
 *
 * Manually terminates an active tenancy, including early (FR-CON-03), unless
 * blocked by unpaid arrears (FR-CON-04). Atomic — a single Firestore
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

    // GUARD — FR-CON-04: blocked ONLY while there are unpaid arrears
    // (currentBalance > 0). Zero or negative (a credit in the tenant's favor)
    // both permit termination — Bogdan's explicit call, faithful to FR-CON-04's
    // wording ("unpaid arrears"), not a stricter "must be exactly zero" rule.
    if (tenancyData.currentBalance > 0) {
      throw new HttpsError(
        'failed-precondition',
        'This tenancy has unpaid arrears; settle the balance before terminating.',
        { reason: 'arrears', currentBalance: tenancyData.currentBalance },
      )
    }

    // WRITES — symmetric with finalizeKyc's `tx.update(propertyRef, { status:
    // 'occupied' })`: one transaction, three documents, no separate trigger.
    tx.update(tenancyRef, {
      status: 'ended',
      endedAt: FieldValue.serverTimestamp(),
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
