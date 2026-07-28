import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from '@/lib/firebase'
import { stripUndefinedDeep } from '@/features/onboarding/hooks'
import { deleteAttachmentBestEffort } from '@/lib/fileUpload'
import { collectAttachmentUrls, uploadPendingAttachments } from './attachments'
import { derivePaymentStatus } from './schema'

/**
 * The data access layer for monthly reports (FR-REP-01…05/11/14/07/07a,
 * FR-DOC-01…05, SRS §6). Same conventions as `properties/hooks.js`: single
 * reads (`getDoc`, not `onSnapshot`), freshness via invalidation, components
 * never touch `firebase/firestore` directly. Signing/unlocking (M4 sub-stage
 * 4) goes through Cloud Functions (`useSignReport`/`useUnlockReport`), never
 * a direct Firestore write of `status`.
 */

const COLLECTION = 'monthlyReports'

/**
 * Deterministic id on (propertyId + month + year) — FR-REP-14's uniqueness
 * guarantee lives here, structurally: there is no separate "create" path that
 * could produce a duplicate, because the id for a given property+month+year
 * is always the same document.
 */
export function buildReportId(propertyId, month, year) {
  return `${propertyId}_${year}-${String(month).padStart(2, '0')}`
}

export const reportKeys = {
  all: ['monthlyReports'],
  details: () => [...reportKeys.all, 'detail'],
  detail: (id) => [...reportKeys.details(), id],
  lists: () => [...reportKeys.all, 'list'],
  forMonth: (month, year) => [...reportKeys.lists(), 'month', month, year],
}

function reportRef(id) {
  return doc(db, COLLECTION, id)
}

/**
 * A single month's report, by property+month+year. `null` (not an error) when
 * none exists yet — a fresh month with no report is a normal, expected state
 * (same reasoning as `useActiveTenancyForProperty`), not a failure.
 */
export function useMonthlyReport({ propertyId, month, year }) {
  const id = propertyId ? buildReportId(propertyId, month, year) : null

  return useQuery({
    queryKey: reportKeys.detail(id),
    enabled: Boolean(id),
    queryFn: async () => {
      const snap = await getDoc(reportRef(id))
      if (!snap.exists()) return null
      return { id: snap.id, ...snap.data() }
    },
  })
}

/**
 * Every report (any status) for one calendar month, across ALL properties —
 * the shared read behind both the admin dashboard cards and the Current
 * month list (M4 sub-stage 7). A single two-equality query (month, year),
 * no `orderBy` — same no-composite-index convention as `useActiveTenancies`/
 * `useActiveTenancyForProperty` (properties/hooks.js) and
 * `recomputeCurrentBalance` (functions/src/reports.js). Callers filter
 * further in memory (by status, by occupied propertyId) because the
 * dashboard total and the Current month list need different subsets of the
 * same fetch — see the sub-stage 7 plan's "Query-strategy decision."
 */
export function useReportsForMonth(month, year) {
  return useQuery({
    queryKey: reportKeys.forMonth(month, year),
    queryFn: async () => {
      const snap = await getDocs(
        query(
          collection(db, COLLECTION),
          where('month', '==', month),
          where('year', '==', year),
        ),
      )
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
    },
  })
}

/**
 * Saves the draft (create or re-save — the deterministic id makes both the
 * same call). `values` is the FULL set of report fields, composed by the
 * caller (the page); `previousAttachmentUrls` is the snapshot of attachment
 * URLs the page loaded the report WITH (via `collectAttachmentUrls`),
 * `[]` for a brand new report. The hook owns the Storage choreography
 * (sub-stage 3) on top of the two system fields that are invariant regardless
 * of who's saving:
 *
 *  1. Upload every PENDING (`file`-bearing) attachment across the whole report
 *     (`uploadPendingAttachments` — compresses images, uploads PDF/doc as-is),
 *     producing clean `{url,name,type}` refs — no `File` object survives.
 *  2. `setDoc` the clean document.
 *  3. If step 2 THROWS: best-effort delete ONLY the objects step 1 just
 *     uploaded (orphan cleanup) and re-throw. Nothing the admin removed is
 *     touched — those objects are still referenced by the PREVIOUSLY saved
 *     document, which this failed write never replaced.
 *  4. On success: diff `previousAttachmentUrls` against the URLs surviving in
 *     the just-saved document — whatever disappeared is what the admin
 *     removed — and best-effort delete those, AFTER the commit. Never
 *     delete-before-commit (CLAUDE.md §7's copy-first/delete-after-commit,
 *     adapted here to a plain `setDoc` instead of a transaction).
 *
 * `isNew` decides setDoc-with-status (creation) vs. updateDoc-without-status
 * (re-save) — NO default, every call site must decide explicitly. This is the
 * fix for the hazard the original sub-stage-1/2/3 version of this doc-comment
 * flagged: once signing fields (status:'signed', signedAt — sub-stage 4) live
 * on this doc, a full-overwrite `setDoc` re-save from the form would CLOBBER
 * them — worse, it would do so even off a STALE client cache (right after
 * `signReport` resolves elsewhere, or a second tab open on the same report),
 * since the form has no way to know the server-side status changed underneath
 * it. A re-save NEVER writes `status`/`signedAt` at all — `updateDoc` only
 * touches the keys present in its payload, so whatever the server currently
 * holds for those two fields survives untouched, no matter how stale the
 * client's own idea of the report was when Save was clicked. The
 * draft<->signed transition happens EXCLUSIVELY through the
 * signReport/unlockReport callables (SRS §6) — never through this save path.
 */
export function useSaveReportDraft() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ id, values, previousAttachmentUrls = [], isNew }) => {
      const { values: uploadedValues, newUrls } =
        await uploadPendingAttachments(values, `reports/${id}/invoices`)

      const payload = stripUndefinedDeep({
        ...uploadedValues,
        updatedAt: serverTimestamp(),
        ...(isNew ? { status: 'draft' } : {}),
      })

      try {
        if (isNew) {
          await setDoc(reportRef(id), payload)
        } else {
          await updateDoc(reportRef(id), payload)
        }
      } catch (error) {
        // `.map((url) => ...)`, NOT `.map(deleteAttachmentBestEffort)` directly:
        // Array#map also passes (index, array) to its callback, and
        // deleteAttachmentBestEffort would silently receive them as extra args.
        await Promise.allSettled(
          newUrls.map((url) => deleteAttachmentBestEffort(url)),
        )
        throw error
      }

      const survivingUrls = collectAttachmentUrls(uploadedValues)
      const removedUrls = previousAttachmentUrls.filter(
        (url) => !survivingUrls.includes(url),
      )
      await Promise.allSettled(
        removedUrls.map((url) => deleteAttachmentBestEffort(url)),
      )

      return id
    },
    onSuccess: (id) => {
      queryClient.invalidateQueries({ queryKey: reportKeys.detail(id) })
      // Additive (M4 sub-stage 7): a saved draft can change the running
      // total the Current month list shows for this property/month.
      queryClient.invalidateQueries({ queryKey: reportKeys.lists() })
    },
  })
}

// ─────────────────────────── useSignReport ───────────────────────
/**
 * Signs the report (FR-REP-07) via the `signReport` callable
 * (functions/src/reports.js) — NOT a direct Firestore write: the transition
 * is validated server-side (status must be 'draft') and stamps `signedAt`
 * with a server timestamp, neither of which the client can do trustworthily.
 * Invalidates the report detail so the page re-fetches with `status:'signed'`
 * and switches into its read-only view.
 */
export function useSignReport() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id }) => {
      const signReport = httpsCallable(functions, 'signReport')
      return signReport({ reportId: id })
    },
    onSuccess: (_result, { id }) => {
      queryClient.invalidateQueries({ queryKey: reportKeys.detail(id) })
      // Additive (M4 sub-stage 7): signing flips the badge/total shown for
      // this property/month on the dashboard and Current month list.
      queryClient.invalidateQueries({ queryKey: reportKeys.lists() })
    },
  })
}

// ─────────────────────────── useUnlockReport ─────────────────────
/**
 * Unlocks a signed report back to draft (FR-REP-07a) via the `unlockReport`
 * callable — same reasoning as `useSignReport`: the precondition (status must
 * be 'signed') is enforced server-side, not just hidden behind a disabled UI
 * button.
 */
export function useUnlockReport() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id }) => {
      const unlockReport = httpsCallable(functions, 'unlockReport')
      return unlockReport({ reportId: id })
    },
    onSuccess: (_result, { id }) => {
      queryClient.invalidateQueries({ queryKey: reportKeys.detail(id) })
      // Additive (M4 sub-stage 7): unlocking flips the badge back to
      // "not entered" on the dashboard and Current month list.
      queryClient.invalidateQueries({ queryKey: reportKeys.lists() })
    },
  })
}

// ─────────────────────────── useSendReportNotification ───────────
/**
 * Sends the A2 ('new') or A3 ('updated') report notification email
 * on-demand (FR-REP-06/07a, pinned at f6d5c83) via the `sendReportNotification`
 * callable. No `invalidateQueries`: sending an email writes only to `mail`
 * (Functions-only, NFR-SEC-02), which the client never reads — nothing
 * cached needs to be refreshed.
 */
export function useSendReportNotification() {
  return useMutation({
    mutationFn: ({ id, template }) => {
      const sendReportNotification = httpsCallable(
        functions,
        'sendReportNotification',
      )
      return sendReportNotification({ reportId: id, template })
    },
  })
}

// ─────────────────────────── useMarkPayment ──────────────────────
/**
 * Records/corrects a payment on a SIGNED report (FR-PAY-01/02/05/06) via a
 * plain `updateDoc` — NOT a callable (M4 sub-stage 5, plan Decision 1): the
 * admin already has full write access to `monthlyReports`, and there is no
 * cross-document transaction or precondition here that only a trusted
 * server could enforce. The payload touches ONLY the four payment fields —
 * `status`/`signedAt` are never in it, so this can never de-sign a report
 * (same discipline as `useSaveReportDraft`'s re-save path, M4 sub-stage 4).
 * `onReportWrite` (functions/src/reports.js) reacts to this write and
 * recomputes `tenancies.currentBalance` — this hook does not touch the
 * tenancy document directly, it just invalidates the cached read of it.
 */
export function useMarkPayment() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, values, finalTotal }) =>
      updateDoc(
        reportRef(id),
        stripUndefinedDeep({
          amountPaid: values.amountPaid,
          paymentMethod: values.paymentMethod,
          paymentDate: values.paymentDate,
          paymentStatus: derivePaymentStatus(finalTotal, values.amountPaid),
          updatedAt: serverTimestamp(),
        }),
      ),
    onSuccess: (_result, { id }) => {
      queryClient.invalidateQueries({ queryKey: reportKeys.detail(id) })
      queryClient.invalidateQueries({ queryKey: ['tenancies'] })
      // Additive (M4 sub-stage 7): a marked payment flips the badge on the
      // dashboard and Current month list (paid/partial/overdue).
      queryClient.invalidateQueries({ queryKey: reportKeys.lists() })
    },
  })
}

// ─────────────────────────── useCancelPayment ────────────────────
/**
 * Clears a payment back to unpaid (FR-PAY-06). Uses `null`, NOT `undefined`,
 * for the three payment fields — `updateDoc` only touches keys present in
 * its payload, and `stripUndefinedDeep` (CLAUDE.md §7) REMOVES `undefined`
 * keys before the write, so an `undefined` "clear" value here would silently
 * leave the OLD payment data untouched in Firestore instead of clearing it.
 * `null` survives `stripUndefinedDeep` and is written as an explicit clear.
 */
export function useCancelPayment() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id }) =>
      updateDoc(reportRef(id), {
        amountPaid: null,
        paymentMethod: null,
        paymentDate: null,
        paymentStatus: 'unpaid',
        updatedAt: serverTimestamp(),
      }),
    onSuccess: (_result, { id }) => {
      queryClient.invalidateQueries({ queryKey: reportKeys.detail(id) })
      queryClient.invalidateQueries({ queryKey: ['tenancies'] })
      // Additive (M4 sub-stage 7): cancelling a payment flips the badge back
      // to published/overdue on the dashboard and Current month list.
      queryClient.invalidateQueries({ queryKey: reportKeys.lists() })
    },
  })
}
