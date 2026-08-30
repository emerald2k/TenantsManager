const { getApps, initializeApp } = require('firebase-admin/app')
const { getFirestore } = require('firebase-admin/firestore')
const { onCall, HttpsError } = require('firebase-functions/v2/https')

/**
 * exportTenantData (SRS §7.2, FR-TEN-26): produces ONE reviewable bundle of a
 * single tenant's data, for a subject-access request. Admin-only; the
 * administrator reviews it before it leaves. Necessary because FR-TEN-09
 * deliberately denies the tenant read access to their own `users` document,
 * so "log in and look" is not an available answer, and NFR-PERF-03 removes
 * the generic export.
 *
 * This is a NARROW, per-subject export and does not reverse NFR-PERF-03: it
 * takes one `userId`, returns JSON for review, and produces no CSV/Excel and
 * no bulk artefact. The generic export stays gone.
 *
 * The bundle carries, sourced deliberately:
 *  - `profile`  — the whole `users/{userId}` document. This INCLUDES the
 *    guarantor sub-object (name, cnp, phone, id-photo references) and the
 *    previous-reference (name, phone): both are third parties, both are part
 *    of the tenant's KYC answers (FR-TEN-04), and stripping them would be a
 *    decision this function is not the place to make — §4.1 item 3 records
 *    the guarantor's lawful basis as an OPEN obligation for the administrator.
 *  - `tenancies` — every tenancy on this account. `property { name, address }`
 *    on each is the OWNER's property, denormalized — not another tenant's data.
 *  - `signedReports` — only `status == 'signed'` reports (drafts are excluded
 *    by FR-TEN-26's own wording). Filtered in JS, not with a second `where`,
 *    so no composite index is needed (SRS §6, CLAUDE.md §7).
 *  - `paymentHistory` — derived from those signed reports; there is no
 *    separate payments collection in the model.
 *  - `documentManifest` — `{ path, name, type, source }` for every stored
 *    file the tenant's record points at. A MANIFEST, never the bytes and
 *    never a download URL (debt #5).
 *
 * It never reads `mail`: §4.1 accepted-risk (a) notes generated passwords sit
 * there in clear text, and FR-TEN-26's list does not include it.
 */

if (!getApps().length) {
  initializeApp()
}

function collectManifest(profile, tenancies, signedReports) {
  const manifest = []
  const push = (refs, source) => {
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

  push(profile.idDocumentPhotos, 'tenant-id')
  push(profile.guarantor?.idDocumentPhotos, 'guarantor-id')

  for (const tenancy of tenancies) {
    push(tenancy.attachedDocuments, 'contract')
    for (const item of tenancy.depositSettlement?.items || []) {
      push(item.attachments, 'deposit-settlement')
    }
  }

  for (const report of signedReports) {
    push(report.rent?.attachments, 'report-cost-line')
    push(report.maintenance?.attachments, 'report-cost-line')
    for (const line of report.serviceCosts || []) {
      push(line.attachments, 'report-cost-line')
    }
    for (const line of report.otherExpenses || []) {
      push(line.attachments, 'report-cost-line')
    }
  }

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
  const profile = { id: userSnap.id, ...userSnap.data() }

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

  const documentManifest = collectManifest(profile, tenancies, signedReports)

  return {
    generatedAt: new Date().toISOString(),
    subjectUserId: userId,
    profile,
    tenancies,
    signedReports,
    paymentHistory,
    documentManifest,
    counts: {
      tenancies: tenancies.length,
      reportsTotal: allReports.length,
      signedReports: signedReports.length,
      documents: documentManifest.length,
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
