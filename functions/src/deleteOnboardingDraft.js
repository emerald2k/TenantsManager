const { getApps, initializeApp } = require('firebase-admin/app')
const { getFirestore } = require('firebase-admin/firestore')
const { getStorage } = require('firebase-admin/storage')
const { onCall, HttpsError } = require('firebase-functions/v2/https')

/**
 * deleteOnboardingDraft (SRS §7.2, FR-TEN-25 / FR-TEN-20): the manual
 * "Delete draft" action. Removes the `onboardingDrafts/{draftId}` document
 * AND every object under the Storage prefix `drafts/{draftId}/` — the
 * photographed identity documents of a candidate who never became a tenant.
 *
 * Server-side, on the Admin SDK, for two reasons the previous client-side
 * cleanup (`web/src/features/onboarding/hooks.js` `deleteDraftStorage`) could
 * not meet:
 *  - it SWALLOWED every Storage failure, so a transient error left a full set
 *    of ID photos orphaned in the bucket with the draft document already
 *    gone — unreferenced, invisible in the app, unreachable from any screen
 *    (the exact state FR-TEN-25 exists to prevent);
 *  - `listAll()` only sees objects the client's Storage rules let it list.
 *    `bucket.deleteFiles({ prefix })` deletes every object under the prefix —
 *    nested, paginated — bypassing Storage rules entirely.
 *
 * ORDERING — Storage first, then the Firestore document. If the Storage
 * delete throws, the callable throws and the draft document stays: still
 * listed, still deletable, the operation is retryable, and no photo is ever
 * orphaned WITHOUT its draft. `deleteFiles` is idempotent, so a retry after a
 * partial success simply no-ops on what is already gone. This is a
 * deliberate change from the old "the document must be deletable regardless"
 * stance: FR-TEN-25 makes silent orphaning unacceptable, and moving the work
 * onto the Admin SDK removes the rules-denial failure mode that stance was
 * guarding against.
 *
 * The prefixes `drafts/{draftId}/` and `users/{userId}/` never overlap, so
 * this can never reach a photo `finalizeKyc` has already migrated out.
 */

if (!getApps().length) {
  initializeApp()
}

// Hand-identical to kyc.js / sharedReport.js's STORAGE_BUCKET and web/.env's
// VITE_FIREBASE_STORAGE_BUCKET — the same deliberate duplication (CLAUDE.md
// §7): `getStorage().bucket()` with no argument resolves the Admin SDK's
// context-dependent ambient default, which differs between the real runtime
// and an `emulators:exec`-spawned script. Never extracted into a shared
// import — an import would create a module load-order dependency of exactly
// the kind CLAUDE.md §7 records as a bug family.
const STORAGE_BUCKET =
  process.env.STORAGE_BUCKET || 'tenants-manager-2026.firebasestorage.app'

/**
 * The core, callable directly by the tests against the emulators. Throws
 * `HttpsError` with a clear code on every failure path — same shape as
 * finalizeKycCore / resetTenantPasswordCore.
 */
async function deleteOnboardingDraftCore(draftId) {
  const db = getFirestore()
  const bucket = getStorage().bucket(STORAGE_BUCKET)

  const draftRef = db.collection('onboardingDrafts').doc(draftId)
  const snap = await draftRef.get()
  if (!snap.exists) {
    throw new HttpsError('not-found', `Draft ${draftId} does not exist.`)
  }

  // Storage FIRST — see the file header. A failure here throws BEFORE the
  // document is deleted, so nothing is left orphaned without its draft.
  await bucket.deleteFiles({ prefix: `drafts/${draftId}/` })

  await draftRef.delete()

  return { deleted: true }
}

/**
 * The callable handler (admin only). Thin on purpose — same shape as
 * finalizeKycHandler / resetTenantPasswordHandler / setTenantAccountStatusHandler.
 */
async function deleteOnboardingDraftHandler(request) {
  if (request.auth?.token?.admin !== true) {
    throw new HttpsError('permission-denied', 'Admin access required.')
  }
  const draftId = request.data?.draftId
  if (!draftId) {
    throw new HttpsError('invalid-argument', 'draftId is required.')
  }
  return deleteOnboardingDraftCore(draftId)
}

const deleteOnboardingDraft = onCall(deleteOnboardingDraftHandler)

module.exports = {
  deleteOnboardingDraft,
  deleteOnboardingDraftHandler,
  deleteOnboardingDraftCore,
}
