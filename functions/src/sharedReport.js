const { getApps, initializeApp } = require('firebase-admin/app')
const { getFirestore } = require('firebase-admin/firestore')
const { getStorage } = require('firebase-admin/storage')
const { onCall, HttpsError } = require('firebase-functions/v2/https')

/**
 * getSharedReport / getSharedReportAttachment (SRS §7.2/§7.3, FR-REP-07b/07c,
 * pinned at 5a92763). The ONLY two PUBLIC (no-auth) Cloud Functions in this
 * codebase — every other callable requires the admin custom claim.
 *
 * Firestore/Storage rules stay closed to anonymous requests (firestore.rules
 * has a comment written for exactly this sub-stage: "Public (no-auth) access
 * via shareToken does NOT go through this rule"). These two functions ARE
 * the access boundary for anonymous visitors — Admin SDK bypasses rules
 * entirely, so every check a rule would normally enforce is written here in
 * code instead.
 */

if (!getApps().length) {
  initializeApp()
}

// Same duplication discipline as kyc.js/reports.js's STORAGE_BUCKET/APP_URL
// local constants (CLAUDE.md §7, the M3 lesson) — kept hand-identical to
// web/.env's VITE_FIREBASE_STORAGE_BUCKET by hand, never extracted into a
// shared module (functions/ deploys without web/), never inferred from
// getStorage().bucket() with no argument (context-dependent ambient default).
const STORAGE_BUCKET =
  process.env.STORAGE_BUCKET || 'tenants-manager-2026.firebasestorage.app'

// Every rejection reason (unknown token, revoked, not yet signed) collapses
// to this SAME message — an anonymous caller must never be able to tell
// "this link never existed" apart from "it was revoked" or "not published
// yet". Deliberate: do not add a more specific message per branch.
const LINK_UNAVAILABLE = 'Link unavailable.'

/**
 * Attaches an opaque, structural `reference` to each attachment instead of
 * its real Storage path/URL — "rent.0" / "maintenance.0" /
 * "serviceCosts.{lineIndex}.{attIndex}" / "otherExpenses.{lineIndex}.{attIndex}".
 * The client never sees a real path; it only ever echoes this reference back
 * to getSharedReportAttachment, which resolves it against ITS OWN fresh read
 * of the report — see resolveAttachment below. That is the ownership
 * guarantee, structurally, not by validating a client-supplied path.
 */
function attachmentsMeta(attachments, prefix) {
  return (attachments ?? []).map((att, index) => ({
    name: att.name,
    type: att.type,
    reference: `${prefix}.${index}`,
  }))
}

/**
 * ALLOWLIST (not a blocklist) — the exact, complete shape returned to an
 * anonymous visitor. Deliberately excludes: ownerId, propertyId, tenancyId,
 * userId, status, signedAt, updatedAt, shareToken, shareTokenRevoked,
 * paymentMethod, paymentDate, serviceId (internal catalog key — only the
 * snapshotted `name` is ever displayed). `report.rent`/`report.maintenance`
 * are always-present cost lines (SRS §6); serviceCosts/otherExpenses default
 * to `[]` for a report saved before either existed.
 *
 * This function never reads the `users` collection — the strongest property
 * here: personal data (name, cnp, email, preferredLanguage) cannot leak
 * because it is never in memory, not because a field was stripped after
 * the fact.
 */
function toPublicReport(report, propertyName) {
  return {
    propertyName: propertyName ?? null,
    month: report.month,
    year: report.year,
    rent: {
      amount: report.rent.amount,
      notes: report.rent.notes ?? null,
      attachments: attachmentsMeta(report.rent.attachments, 'rent'),
    },
    maintenance: {
      amount: report.maintenance.amount,
      notes: report.maintenance.notes ?? null,
      attachments: attachmentsMeta(
        report.maintenance.attachments,
        'maintenance',
      ),
    },
    serviceCosts: (report.serviceCosts ?? []).map((line, i) => ({
      name: line.name,
      amount: line.amount,
      notes: line.notes ?? null,
      attachments: attachmentsMeta(line.attachments, `serviceCosts.${i}`),
    })),
    otherExpenses: (report.otherExpenses ?? []).map((line, i) => ({
      description: line.description,
      amount: line.amount,
      notes: line.notes ?? null,
      attachments: attachmentsMeta(line.attachments, `otherExpenses.${i}`),
    })),
    previousMonthArrears: report.previousMonthArrears ?? 0,
    previousMonthCredit: report.previousMonthCredit ?? 0,
    calculatedTotal: report.calculatedTotal,
    finalTotal: report.finalTotal,
    dueDate: report.dueDate,
    paymentStatus: report.paymentStatus ?? null,
    amountPaid: report.amountPaid ?? null,
  }
}

/**
 * The inverse of attachmentsMeta: walks the SAME structure using a
 * client-supplied reference to locate the real attachment (with its real
 * Storage path). Returns null for anything that doesn't resolve — a
 * malformed, out-of-range, or wrong-section reference simply fails to find
 * anything (`array[NaN]` -> undefined -> null), which the caller turns into
 * a `not-found`. No extra input validation beyond this: since resolution is
 * always scoped to the token's OWN report, there is no path-traversal
 * surface to defend against here.
 */
function resolveAttachment(report, reference) {
  if (typeof reference !== 'string') return null
  const parts = reference.split('.')
  const [section] = parts
  if (section === 'rent' || section === 'maintenance') {
    return report[section]?.attachments?.[Number(parts[1])] ?? null
  }
  if (section === 'serviceCosts' || section === 'otherExpenses') {
    return (
      report[section]?.[Number(parts[1])]?.attachments?.[Number(parts[2])] ??
      null
    )
  }
  return null
}

/**
 * Looks up a report by shareToken and re-validates every precondition a
 * shared link depends on. Shared by both callables below so the two never
 * drift apart on what counts as "still shareable". Returns null (never
 * throws) — callers decide the HttpsError, keeping this a pure lookup.
 */
async function findReportByToken(db, shareToken) {
  const snap = await db
    .collection('monthlyReports')
    .where('shareToken', '==', shareToken)
    .limit(1)
    .get()
  if (snap.empty) return null
  const report = snap.docs[0].data()
  if (report.shareTokenRevoked === true) return null
  if (report.status !== 'signed') return null
  return report
}

async function getSharedReportCore(shareToken) {
  const db = getFirestore()
  const report = await findReportByToken(db, shareToken)
  if (!report) {
    throw new HttpsError('not-found', LINK_UNAVAILABLE)
  }

  const propertySnap = await db
    .collection('properties')
    .doc(report.propertyId)
    .get()
  const propertyName = propertySnap.exists ? propertySnap.data().name : null

  return toPublicReport(report, propertyName)
}

async function getSharedReportHandler(request) {
  const shareToken = request.data?.shareToken
  if (!shareToken) {
    throw new HttpsError('invalid-argument', 'shareToken is required.')
  }
  return getSharedReportCore(shareToken)
}

const getSharedReport = onCall(getSharedReportHandler)

async function getSharedReportAttachmentCore(shareToken, reference) {
  const db = getFirestore()
  const report = await findReportByToken(db, shareToken)
  if (!report) {
    throw new HttpsError('not-found', LINK_UNAVAILABLE)
  }

  const attachment = resolveAttachment(report, reference)
  if (!attachment) {
    throw new HttpsError('not-found', 'Attachment not found.')
  }

  const bucket = getStorage().bucket(STORAGE_BUCKET)
  const path = attachment.path
  const file = bucket.file(path)
  const [bytes] = await file.download()
  const [metadata] = await file.getMetadata()

  return {
    base64: bytes.toString('base64'),
    contentType: metadata.contentType ?? null,
    name: attachment.name,
  }
}

async function getSharedReportAttachmentHandler(request) {
  const shareToken = request.data?.shareToken
  const reference = request.data?.reference
  if (!shareToken || !reference) {
    throw new HttpsError(
      'invalid-argument',
      'shareToken and reference are required.',
    )
  }
  return getSharedReportAttachmentCore(shareToken, reference)
}

const getSharedReportAttachment = onCall(getSharedReportAttachmentHandler)

module.exports = {
  getSharedReport,
  getSharedReportHandler,
  getSharedReportCore,
  getSharedReportAttachment,
  getSharedReportAttachmentHandler,
  getSharedReportAttachmentCore,
  toPublicReport,
  resolveAttachment,
  attachmentsMeta,
  STORAGE_BUCKET,
}
