const { getApps, initializeApp } = require('firebase-admin/app')
const { getFirestore, FieldValue } = require('firebase-admin/firestore')
const { onDocumentWritten } = require('firebase-functions/v2/firestore')

/**
 * onMailWrite (SRS §7.2, FR-NLOG-01…09). New at M8. Projects every write to
 * `mail/{mailId}` into `notifications/{mailId}` — SAME id as the source
 * document, written with `merge: true`, so the Trigger Email extension's
 * several `delivery` updates on one email (PENDING → PROCESSING →
 * SUCCESS/ERROR) converge on ONE row instead of creating three or four.
 * `sentAt` is stamped on the FIRST projection only; every later fire
 * updates `deliveryState`/`deliveryError` and nothing else about the
 * timestamp.
 *
 * A trigger rather than a same-batch write inside each sending function,
 * for one reason that justifies the extra function: `delivery.state` is
 * written by the extension ASYNCHRONOUSLY, after the send, so a same-batch
 * write could only ever record the intent to send — not what FR-NLOG-05
 * actually needs.
 *
 * **Does write to `mail`** — the redaction below, immediately after the
 * projection. This contradicts this file's own inventory-table entry in
 * SRS §7.2 line ~888 ("Never writes to `mail`"), which predates FR-NLOG-09's
 * rewrite (2026-08-25) and was not updated with it — flagged as an SRS
 * residual divergence (CLAUDE.md §9 zone D) for the planning session to
 * reconcile, rather than resolved here either way. FR-NLOG-09 is the newer,
 * far more specific text, and it explicitly names the self-write as one of
 * the two traps this function has to survive, so it is the version
 * implemented here.
 */

if (!getApps().length) {
  initializeApp()
}

// FR-NLOG-09: the body has no further purpose once delivered — the log
// keeps type/audience/recipient/delivery state, which is everything it
// displays (subject and body are never shown for ANY template, FR-NLOG-02).
// A fixed constant, not derived from anything in the document, so the
// anti-vacuity test can assert on it directly rather than re-deriving it.
const REDACTED_PLACEHOLDER =
  '[Parola a fost eliminată automat după livrare — FR-NLOG-09.]'

/**
 * Empties a delivered secret-bearing email's body (FR-NLOG-09). The trigger
 * does NOT decide this by `type` — a type list drifts the moment a template
 * is added, and the person adding it is not looking here. Instead the
 * template that interpolates a secret marks its own `mail` document with
 * `redactAfterDelivery: true` (A1 `credentials.js` and A9
 * `credentialsResent.js` both do); this function acts on that flag alone,
 * without knowing or caring what type the email was.
 *
 * Two traps, both guarded here: (1) this function writes to the very
 * document that triggers it, so it MUST skip a document already marked
 * `redacted` or it loops forever — guarded by a real sentinel field, not a
 * text comparison (a placeholder-string compare breaks the moment someone
 * edits the placeholder). (2) `onMailWrite` fires 3-4 times per email (the
 * extension's PENDING → PROCESSING → SUCCESS/ERROR sequence), so redaction
 * must be idempotent by construction — the sentinel makes every fire after
 * the first a no-op here, same discipline as the projection's own `merge`.
 */
async function redactAfterDelivery(db, mailId, mail) {
  if (mail.redactAfterDelivery !== true) return
  if (mail.delivery?.state !== 'SUCCESS') return
  if (mail.redacted === true) return

  await db.collection('mail').doc(mailId).update({
    'message.text': REDACTED_PLACEHOLDER,
    redacted: true,
  })
}

/**
 * Projects one `mail` document onto its `notifications` row (FR-NLOG-01/03/
 * 04/05). `subject` only — never `message.text` (FR-NLOG-02, bodies are
 * metadata-free by design). `sentAt` is set with `set({ merge: true })`
 * ONLY when the row does not exist yet, so a later fire (delivery state
 * changing) can never move it.
 */
async function projectNotification(db, mailId, mail) {
  const notificationRef = db.collection('notifications').doc(mailId)
  const existing = await notificationRef.get()

  const projection = {
    mailId,
    type: mail.type ?? null,
    audience: mail.audience ?? null,
    subject: mail.message?.subject ?? null,
    to: mail.to ?? null,
    deliveryState: mail.delivery?.state ?? 'PENDING',
    deliveryError: mail.delivery?.error ?? null,
    relatedId: mail.relatedId ?? null,
    ownerId: mail.ownerId ?? null,
  }
  if (!existing.exists) {
    projection.sentAt = FieldValue.serverTimestamp()
  }

  await notificationRef.set(projection, { merge: true })
}

/**
 * The handler, callable directly by the tests against the emulators (same
 * `fakeEvent` idiom as `onReportWriteHandler`/`onPropertyUpdateHandler`) —
 * `test:emulator` starts Auth/Firestore only, not the Functions emulator, so
 * no test exercises the REAL deployed trigger chain. The redaction runs
 * first, then the projection — but the projection does NOT re-read `mail`:
 * it uses the SAME `mail` object from the event payload that the redaction
 * just decided on, so `subject` is projected from pre-redaction data (the
 * subject is never redacted) and the possibly-not-yet-visible post-redaction
 * body is irrelevant to it. `mail` documents are never deleted (SRS §6), so
 * a delete event (no `after`) is defensive-only and never expected in
 * production.
 */
async function onMailWriteHandler(event) {
  const mailId = event.params.mailId
  const after = event.data?.after?.exists ? event.data.after.data() : null
  if (!after) return

  const db = getFirestore()

  await redactAfterDelivery(db, mailId, after)
  await projectNotification(db, mailId, after)
}

const onMailWrite = onDocumentWritten('mail/{mailId}', onMailWriteHandler)

module.exports = {
  onMailWrite,
  onMailWriteHandler,
  REDACTED_PLACEHOLDER,
}
