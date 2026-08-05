const crypto = require('node:crypto')

/**
 * Moves an onboarding tenant's ID photos from Storage's flat, admin-only
 * /drafts/{draftId}/ folder to /users/{userId}/documents|guarantor/ at KYC
 * finalization (M3, closing the SRS §6 gap: the spec always said
 * /users/{userId}/... — finalizeKyc only ever copied the Firestore
 * REFERENCE, never moved the underlying Storage object).
 *
 * COPY-then-delete, never a direct move: `copyPhotosToUser` only adds objects
 * at the new location — it never touches the source. The caller
 * (functions/src/kyc.js) is responsible for deleting the sources with
 * `deleteObjects`, and ONLY after the Firestore transaction that persists the
 * new references has committed. That ordering is what keeps a mid-finalize
 * failure non-destructive: the draft's original photos are still exactly
 * where they were, so the draft stays resumable and nothing is orphaned.
 */

/**
 * Builds a download URL for a given bucket/path/token — still used by
 * `functions/scripts/seed.js` (poarta C3) to synthesize fixture attachment
 * references, so it stays exported here even though `copyPhotosToUser` below
 * no longer calls it itself (debt #5: migrated references now persist `path`,
 * not a download URL). `token` is NOT extracted from the source: each copy gets
 * a freshly generated one (see `copyPhotosToUser`), so this never depends on
 * whether Storage's `copy()` happens to preserve custom metadata.
 *
 * EMULATOR-AWARE: `firebase emulators:exec` sets `FIREBASE_STORAGE_EMULATOR_HOST`
 * (bare `host:port`, e.g. `127.0.0.1:9199` — same env var the Admin SDK itself
 * reads to redirect its Storage client, see `firebase-admin/lib/storage/
 * storage.js`). Without this, a migrated photo would carry a production
 * `firebasestorage.googleapis.com` URL while the bytes only exist in the
 * local emulator — every OTHER photo URL in the app (drafts uploaded through
 * the client SDK, which auto-detects the emulator) already points at the
 * emulator host, so a migrated one must match or it renders as a broken image
 * in exactly the scenario Bogdan validates (finalize → check the gallery).
 */
function buildDownloadUrl(bucketName, path, token) {
  const emulatorHost = process.env.FIREBASE_STORAGE_EMULATOR_HOST
  const [protocol, host] = emulatorHost
    ? ['http', emulatorHost]
    : ['https', 'firebasestorage.googleapis.com']
  return `${protocol}://${host}/v0/b/${bucketName}/o/${encodeURIComponent(path)}?alt=media&token=${token}`
}

/** Best-effort delete of every path given — a missing/already-deleted object
 * is not an error. Used both for post-commit cleanup of the /drafts/
 * originals and for rolling back partial copies on failure. */
async function deleteObjects(bucket, paths) {
  await Promise.all(
    paths.map((path) =>
      bucket
        .file(path)
        .delete()
        .catch(() => {}),
    ),
  )
}

/**
 * Copies each photo reference's underlying object to
 * `users/{userId}/{destFolder}/{same basename}`, and issues it a FRESH
 * download token (rather than trusting the copy to preserve the source's
 * metadata) — the token is what actually gates `alt=media` GETs from a plain
 * `<img src>` request (no Authorization header on those), so a stale or
 * missing token would silently break every photo in the gallery.
 *
 * ALL-OR-NOTHING: if any single copy fails, every destination object already
 * copied in THIS call is deleted before rethrowing — the caller never has to
 * reason about a half-migrated batch. The sources are untouched either way.
 *
 * @returns { references, sourcePaths, destPaths } — `references` is the new
 *   `{path, name, type}` array ready to write into the `users` document;
 *   `sourcePaths`/`destPaths` let the caller do post-commit cleanup or,
 *   on failure elsewhere (e.g. a sibling batch), roll this batch back too.
 */
async function copyPhotosToUser(bucket, photos, userId, destFolder) {
  const references = []
  const sourcePaths = []
  const destPaths = []

  try {
    for (const photo of photos) {
      const sourcePath = photo.path
      const basename = sourcePath.split('/').pop()
      const destPath = `users/${userId}/${destFolder}/${basename}`
      const token = crypto.randomUUID()

      await bucket.file(sourcePath).copy(bucket.file(destPath))
      await bucket
        .file(destPath)
        .setMetadata({ metadata: { firebaseStorageDownloadTokens: token } })

      sourcePaths.push(sourcePath)
      destPaths.push(destPath)
      references.push({
        path: destPath,
        name: photo.name,
        type: photo.type,
      })
    }
  } catch (error) {
    await deleteObjects(bucket, destPaths)
    throw error
  }

  return { references, sourcePaths, destPaths }
}

module.exports = {
  buildDownloadUrl,
  copyPhotosToUser,
  deleteObjects,
}
