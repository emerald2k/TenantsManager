const { getApps, initializeApp } = require('firebase-admin/app')
const { getFirestore } = require('firebase-admin/firestore')
const { onCall, HttpsError } = require('firebase-functions/v2/https')

/**
 * exportTenantData (SRS §7.2, FR-TEN-26): produces ONE reviewable bundle of a
 * single tenant's data, for a subject-access request. Admin-only; the
 * administrator reviews it before it leaves (the Account tab, SRS §5.3).
 * Necessary because FR-TEN-09 deliberately denies the tenant read access to
 * their own `users` document, so "log in and look" is not an available
 * answer, and NFR-PERF-03 removes the generic export.
 *
 * This is a NARROW, per-subject export and does not reverse NFR-PERF-03: it
 * takes one `userId`, returns JSON for review, and produces no CSV/Excel and
 * no bulk artefact. The generic export stays gone.
 *
 * The bundle carries, sourced deliberately:
 *  - `profile`  — the `users/{userId}` document, WITHOUT its `guarantor`,
 *    `emergencyContact` and `previousReference` sub-objects. Those describe
 *    people other than the subject and are moved, whole, into `thirdParties`
 *    (below) so a reviewer sees at a glance what concerns a third party.
 *  - `tenancies` — every tenancy on this account. `property { name, address }`
 *    on each is the OWNER's property, denormalized — not another person's
 *    personal data.
 *  - `signedReports` — only `status == 'signed'` reports (drafts are excluded
 *    by FR-TEN-26's own wording). Filtered in JS, not with a second `where`,
 *    so no composite index is needed (SRS §6, CLAUDE.md §7).
 *  - `paymentHistory` — derived from those signed reports; there is no
 *    separate payments collection in the model.
 *  - `documentManifest` — `{ path, name, type, source }` for every stored file
 *    the SUBJECT's record points at. A MANIFEST, never the bytes and never a
 *    download URL (debt #5).
 *  - `thirdParties` — the guarantor, the emergency contact and the previous
 *    reference, plus a manifest of the guarantor's ID photos. A LABEL
 *    (`description`) states what the group is; it encodes NO policy and
 *    answers NO legal question. Whether any of it is redacted before a given
 *    bundle leaves is the administrator's decision per request, and stays
 *    that way until SRS §4.1 item 3 (the guarantor's lawful basis) is
 *    answered. There is deliberately no redaction flag, default, or copy
 *    here suggesting what should be removed.
 *
 * It never reads `mail`: §4.1 accepted-risk (a) notes generated passwords sit
 * there in clear text, and FR-TEN-26's list does not include it.
 */

if (!getApps().length) {
  initializeApp()
}

const THIRD_PARTY_DESCRIPTION =
  'Personal data about people other than the subject of this export — a ' +
  'guarantor, an emergency contact and a previous reference — recorded as ' +
  'part of the subject’s KYC answers (FR-TEN-04). Grouped here so a ' +
  'reviewer can see what concerns a third party rather than the requester.'

function pushRefs(manifest, refs, source) {
  for (const ref of refs || []) {
    if (ref && ref.path) {
      manifest.push({
        path: ref.path,
        name: ref.name ?? null,
        type: ref.type ?? null,
        source,
      })
    }
  }
}

/** The SUBJECT's own stored documents — never the guarantor's (those go in
 * `thirdParties.documentManifest`). */
function collectSubjectManifest(profile, tenancies, signedReports) {
  const manifest = []
  pushRefs(manifest, profile.idDocumentPhotos, 'tenant-id')

  for (const tenancy of tenancies) {
    pushRefs(manifest, tenancy.attachedDocuments, 'contract')
    for (const item of tenancy.depositSettlement?.items || []) {
      pushRefs(manifest, item.attachments, 'deposit-settlement')
    }
  }

  for (const report of signedReports) {
    pushRefs(manifest, report.rent?.attachments, 'report-cost-line')
    pushRefs(manifest, report.maintenance?.attachments, 'report-cost-line')
    for (const line of report.serviceCosts || []) {
      pushRefs(manifest, line.attachments, 'report-cost-line')
    }
    for (const line of report.otherExpenses || []) {
      pushRefs(manifest, line.attachments, 'report-cost-line')
    }
  }

  return manifest
}

function collectGuarantorManifest(guarantor) {
  const manifest = []
  pushRefs(manifest, guarantor?.idDocumentPhotos, 'guarantor-id')
  return manifest
}

/**
 * The core, callable directly by the tests against the emulators.
 */
async function exportTenantDataCore(userId) {
  const db = getFirestore()

  const userSnap = await db.collection('users').doc(userId).get()
  if (!userSnap.exists) {
    throw new HttpsError('not-found', `Tenant ${userId} does not exist.`)
  }

  // Split the users doc: everything else stays in `profile`; the three
  // third-party sub-objects are moved WHOLE into `thirdParties` so nothing
  // about a third party is left loose in `profile`.
  const {
    guarantor = null,
    emergencyContact = null,
    previousReference = null,
    ...profileRest
  } = userSnap.data()
  const profile = { id: userSnap.id, ...profileRest }

  const tenanciesSnap = await db
    .collection('tenancies')
    .where('userId', '==', userId)
    .get()
  const tenancies = tenanciesSnap.docs.map((d) => ({ id: d.id, ...d.data() }))

  // Single equality filter — signed/draft is separated in JS (no composite
  // index; SRS §6). `orderBy` is avoided for the same reason and because a
  // report missing the ordered field would silently drop out (CLAUDE.md §7);
  // the sort below is a plain JS comparison on year then month.
  const reportsSnap = await db
    .collection('monthlyReports')
    .where('userId', '==', userId)
    .get()
  const allReports = reportsSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
  const signedReports = allReports
    .filter((r) => r.status === 'signed')
    .sort((a, b) => a.year - b.year || a.month - b.month)

  const paymentHistory = signedReports.map((r) => ({
    reportId: r.id,
    month: r.month ?? null,
    year: r.year ?? null,
    dueDate: r.dueDate ?? null,
    finalTotal: r.finalTotal ?? null,
    paymentStatus: r.paymentStatus ?? null,
    amountPaid: r.amountPaid ?? null,
    paymentMethod: r.paymentMethod ?? null,
    paymentDate: r.paymentDate ?? null,
  }))

  const documentManifest = collectSubjectManifest(
    profile,
    tenancies,
    signedReports,
  )
  const thirdPartyManifest = collectGuarantorManifest(guarantor)

  return {
    generatedAt: new Date().toISOString(),
    subjectUserId: userId,
    profile,
    tenancies,
    signedReports,
    paymentHistory,
    documentManifest,
    thirdParties: {
      description: THIRD_PARTY_DESCRIPTION,
      guarantor,
      emergencyContact,
      previousReference,
      documentManifest: thirdPartyManifest,
    },
    counts: {
      tenancies: tenancies.length,
      reportsTotal: allReports.length,
      signedReports: signedReports.length,
      documents: documentManifest.length,
      thirdPartyDocuments: thirdPartyManifest.length,
    },
  }
}

/**
 * The callable handler (admin only). Thin on purpose — same shape as
 * finalizeKycHandler / resetTenantPasswordHandler.
 */
async function exportTenantDataHandler(request) {
  if (request.auth?.token?.admin !== true) {
    throw new HttpsError('permission-denied', 'Admin access required.')
  }
  const userId = request.data?.userId
  if (!userId) {
    throw new HttpsError('invalid-argument', 'userId is required.')
  }
  return exportTenantDataCore(userId)
}

const exportTenantData = onCall(exportTenantDataHandler)

module.exports = {
  exportTenantData,
  exportTenantDataHandler,
  exportTenantDataCore,
}
