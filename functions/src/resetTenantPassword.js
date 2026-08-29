const { getApps, initializeApp } = require('firebase-admin/app')
const { getAuth } = require('firebase-admin/auth')
const { getFirestore } = require('firebase-admin/firestore')
const { onCall, HttpsError } = require('firebase-functions/v2/https')
const { generatePassword } = require('./kyc')
const {
  buildCredentialsResentEmail,
} = require('./mail-templates/credentialsResent')

/**
 * resetTenantPassword (SRS §7.2, FR-AUTH-06/07): generates a new password and
 * sets it directly on the tenant's Auth account, returning it to the admin.
 *
 * Face-to-face handoff for the ON-SCREEN return value, exactly like
 * finalizeKyc's initial credentials (SRS §7.2's note on finalizeKyc) — the
 * admin sees the password immediately, without waiting for an email. As of
 * M8 stage 14 (FR-AUTH-04, Appendix A9) this ALSO sends the credentials by
 * email — the durable record channel that A1 already has, and the only
 * recovery path if the admin can't reach the tenant face-to-face. Auth is
 * still the ONLY thing this function has a correctness obligation to: the
 * password change is the primary, already-committed effect (and the value
 * already returned to the admin regardless), so the email is best-effort —
 * a failure is logged, never thrown, and never undoes or masks a successful
 * reset (contrast setTenantAccountStatus, which DOES need Auth+Firestore
 * transactional consistency because BOTH sides there are load-bearing).
 */

if (!getApps().length) {
  initializeApp()
}

// Same env-configurable pattern as kyc.js/reports.js's APP_URL.
const APP_URL = process.env.APP_URL || 'http://localhost:5173'

/**
 * The core, callable directly by the tests against the emulators. `adminUid`
 * becomes the A9 email's `ownerId` (single admin, NFR-SEC-04) — the same
 * role it plays in `sendReportNotificationCore`. Throws `HttpsError` with a
 * clear code on every Auth failure path; the A9 email has none of its own
 * (see file header).
 */
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

  try {
    const db = getFirestore()
    const userSnap = await db.collection('users').doc(userId).get()
    if (userSnap.exists) {
      const user = userSnap.data()
      // The template's {property} needs a tenancy to name — the callable
      // only receives `userId` (unchanged client contract), so the ACTIVE
      // tenancy is looked up here, same query shape as `endTenancy`'s own
      // active-tenancy lookups (FR-CON-02: at most one per user).
      const tenancySnap = await db
        .collection('tenancies')
        .where('userId', '==', userId)
        .where('status', '==', 'active')
        .limit(1)
        .get()
      if (!tenancySnap.empty) {
        const tenancyDoc = tenancySnap.docs[0]
        const tenancy = tenancyDoc.data()
        await db
          .collection('mail')
          .doc()
          .set(
            buildCredentialsResentEmail(user.preferredLanguage, {
              name: user.name,
              email: user.email,
              password,
              property: tenancy.property.name,
              url: APP_URL,
              relatedId: tenancyDoc.id,
              ownerId: adminUid,
            }),
          )
      } else {
        console.error(
          `resetTenantPassword: user ${userId} has no active tenancy — ` +
            'skipping the A9 email (nothing to name as {property}).',
        )
      }
    }
  } catch (error) {
    console.error(
      `resetTenantPassword: password was reset for ${userId}, but the A9 email failed to send.`,
      error,
    )
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
