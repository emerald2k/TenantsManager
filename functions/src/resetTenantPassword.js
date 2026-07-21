const { getApps, initializeApp } = require('firebase-admin/app')
const { getAuth } = require('firebase-admin/auth')
const { onCall, HttpsError } = require('firebase-functions/v2/https')
const { generatePassword } = require('./kyc')

/**
 * resetTenantPassword (SRS §7.2, FR-AUTH-06/07): generates a new password and
 * sets it directly on the tenant's Auth account, returning it to the admin.
 *
 * Face-to-face handoff, exactly like finalizeKyc's initial credentials
 * (SRS §7.2's note on finalizeKyc) — NO `mail` write here. Unlike finalizeKyc,
 * there is no Firestore write at all: a password reset touches ONLY the Auth
 * account, so no transaction/compensation is needed (contrast
 * setTenantAccountStatus, which DOES need Auth+Firestore consistency).
 */

if (!getApps().length) {
  initializeApp()
}

/**
 * The core, callable directly by the tests against the emulators. `adminUid` is
 * the calling admin's uid (unused today — kept for symmetry with
 * finalizeKycCore/endTenancyCore). Throws `HttpsError` with a clear code on
 * every failure path.
 */
// eslint-disable-next-line no-unused-vars
async function resetTenantPasswordCore(userId, adminUid) {
  const auth = getAuth()
  const password = generatePassword()

  try {
    await auth.updateUser(userId, { password })
  } catch (error) {
    if (error.code === 'auth/user-not-found') {
      throw new HttpsError(
        'not-found',
        `Tenant account ${userId} does not exist.`,
      )
    }
    throw error
  }

  return { password }
}

/**
 * The callable handler (admin only). Thin on purpose — same shape as
 * finalizeKycHandler/endTenancyHandler.
 */
async function resetTenantPasswordHandler(request) {
  if (request.auth?.token?.admin !== true) {
    throw new HttpsError('permission-denied', 'Admin access required.')
  }
  const userId = request.data?.userId
  if (!userId) {
    throw new HttpsError('invalid-argument', 'userId is required.')
  }
  return resetTenantPasswordCore(userId, request.auth.uid)
}

const resetTenantPassword = onCall(resetTenantPasswordHandler)

module.exports = {
  resetTenantPassword,
  resetTenantPasswordHandler,
  resetTenantPasswordCore,
}
