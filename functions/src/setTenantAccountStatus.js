const { getApps, initializeApp } = require('firebase-admin/app')
const { getAuth } = require('firebase-admin/auth')
const { getFirestore } = require('firebase-admin/firestore')
const { onCall, HttpsError } = require('firebase-functions/v2/https')

/**
 * setTenantAccountStatus (SRS §7.2, FR-TEN-24): disables / re-enables a
 * tenant's account. Argument shape is `{ userId, action: 'disable'|'enable' }`
 * — an explicit verb, not a raw `{ disabled: boolean }` flag, because RE-
 * ENABLE is not a simple flip: it RECALCULATES `users.status` (Bogdan's state-
 * machine decision, M3-D) rather than restoring a remembered prior value —
 * an `action` reads as "do this transition" where a boolean would misleadingly
 * suggest "set this field".
 *
 * Auth-FIRST ordering with compensation on the Firestore side (mirrors
 * finalizeKyc's Auth-then-Firestore-with-compensation shape, kyc.js):
 *  - DISABLE: `auth.updateUser({disabled:true})` + `revokeRefreshTokens` (so
 *    an open session dies immediately, not at next token refresh) BEFORE the
 *    Firestore write. If the Firestore write fails, Auth is reverted
 *    (`disabled:false`) and the error rethrown — no state where Auth says
 *    disabled but Firestore still says active.
 *  - ENABLE: `auth.updateUser({disabled:false})` first, THEN a query for an
 *    active tenancy on this account decides `users.status`: `'active'` if one
 *    exists, otherwise `'inactive-readonly'`. Same Firestore-failure
 *    compensation, reverting Auth back to `disabled:true`.
 *
 * The status write itself goes through `db.runTransaction` (a single
 * document, no real contention risk) purely for consistency with
 * finalizeKyc/endTenancy's "all reads first, then writes" shape — ENABLE's
 * tenancy query is a read that must happen before the write, exactly the
 * shape a transaction already enforces elsewhere in this codebase.
 */

if (!getApps().length) {
  initializeApp()
}

async function disable(auth, db, userId) {
  await auth.updateUser(userId, { disabled: true })
  await auth.revokeRefreshTokens(userId)

  try {
    await db.runTransaction(async (tx) => {
      tx.update(db.collection('users').doc(userId), { status: 'disabled' })
    })
  } catch (error) {
    await auth.updateUser(userId, { disabled: false })
    throw error
  }

  return { status: 'disabled' }
}

async function enable(auth, db, userId) {
  await auth.updateUser(userId, { disabled: false })

  let newStatus
  try {
    await db.runTransaction(async (tx) => {
      // ALL READS FIRST — the Admin SDK forbids a read after a write in a transaction.
      const activeSnap = await tx.get(
        db
          .collection('tenancies')
          .where('userId', '==', userId)
          .where('status', '==', 'active')
          .limit(1),
      )
      newStatus = activeSnap.empty ? 'inactive-readonly' : 'active'
      tx.update(db.collection('users').doc(userId), { status: newStatus })
    })
  } catch (error) {
    await auth.updateUser(userId, { disabled: true })
    throw error
  }

  return { status: newStatus }
}

/**
 * The core, callable directly by the tests against the emulators. `adminUid` is
 * the calling admin's uid (unused today — kept for symmetry with
 * finalizeKycCore/endTenancyCore). Throws `HttpsError` with a clear code on
 * every failure path.
 */
// eslint-disable-next-line no-unused-vars
async function setTenantAccountStatusCore(userId, action, adminUid) {
  const auth = getAuth()
  const db = getFirestore()

  const userSnap = await db.collection('users').doc(userId).get()
  if (!userSnap.exists) {
    throw new HttpsError(
      'not-found',
      `Tenant account ${userId} does not exist.`,
    )
  }

  if (action === 'disable') return disable(auth, db, userId)
  return enable(auth, db, userId)
}

/**
 * The callable handler (admin only). Thin on purpose — same shape as
 * finalizeKycHandler/endTenancyHandler/resetTenantPasswordHandler.
 */
async function setTenantAccountStatusHandler(request) {
  if (request.auth?.token?.admin !== true) {
    throw new HttpsError('permission-denied', 'Admin access required.')
  }
  const userId = request.data?.userId
  if (!userId) {
    throw new HttpsError('invalid-argument', 'userId is required.')
  }
  const action = request.data?.action
  if (action !== 'disable' && action !== 'enable') {
    throw new HttpsError(
      'invalid-argument',
      "action must be 'disable' or 'enable'.",
    )
  }
  return setTenantAccountStatusCore(userId, action, request.auth.uid)
}

const setTenantAccountStatus = onCall(setTenantAccountStatusHandler)

module.exports = {
  setTenantAccountStatus,
  setTenantAccountStatusHandler,
  setTenantAccountStatusCore,
}
