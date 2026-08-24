const { getApps, initializeApp } = require('firebase-admin/app')
const { onCall, HttpsError } = require('firebase-functions/v2/https')

/**
 * checkAdminEmailConfigured (SRS §7.2, FR-SYS-07). Backs the `/admin`
 * persistent warning banner. Deliberately a LIVE check, not a stored
 * record — the SRS is explicit that the failure is "driven by a
 * configuration check rather than by any stored record": a `notifications`
 * row would need `onMailWrite` to have projected it from a `mail` document,
 * and a configuration failure has no `mail` document to project (there is
 * nothing to send in the first place). Reading `process.env.ADMIN_EMAIL`
 * fresh on every call is the only way to answer "is it set RIGHT NOW"
 * without inventing a synthetic write path into a collection whose
 * single-writer invariant (NFR-SEC-10) exists precisely to keep every row
 * traceable to a real `mail` document.
 */

if (!getApps().length) {
  initializeApp()
}

/**
 * The core, callable directly by the tests. No Firestore, no Storage — a
 * pure read of the ambient environment, wrapped in a function so the tests
 * can call it without going through `onCall`'s request plumbing.
 */
function checkAdminEmailConfiguredCore() {
  return { configured: Boolean(process.env.ADMIN_EMAIL) }
}

/**
 * The callable handler (admin only) — same guard shape as every other
 * callable in this codebase (resetTenantPassword, endTenancy).
 */
async function checkAdminEmailConfiguredHandler(request) {
  if (request.auth?.token?.admin !== true) {
    throw new HttpsError('permission-denied', 'Admin access required.')
  }
  return checkAdminEmailConfiguredCore()
}

const checkAdminEmailConfigured = onCall(checkAdminEmailConfiguredHandler)

module.exports = {
  checkAdminEmailConfigured,
  checkAdminEmailConfiguredHandler,
  checkAdminEmailConfiguredCore,
}
