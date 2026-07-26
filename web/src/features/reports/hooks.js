import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { stripUndefinedDeep } from '@/features/onboarding/hooks'
import { deleteAttachmentBestEffort } from '@/lib/fileUpload'
import { collectAttachmentUrls, uploadPendingAttachments } from './attachments'

/**
 * The data access layer for monthly report drafts (FR-REP-01…05/11/14,
 * FR-DOC-01…05, SRS §6). Sub-stage 1+2+3 of M4 — DRAFT only. Same conventions
 * as `properties/hooks.js`: single reads (`getDoc`, not `onSnapshot`),
 * freshness via invalidation, components never touch `firebase/firestore`
 * directly.
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
 * Full setDoc overwrite is safe HERE because the report doc holds only draft form fields.
 * Once signing fields (status:'signed', signedAt — sub-stage 4) and payment fields
 * (amountPaid, paymentStatus, paymentMethod, paymentDate — sub-stage 5) live on this doc,
 * a full-overwrite re-save from the form WOULD CLOBBER them. Editing after unlock must then
 * load-and-preserve those fields (or switch to updateDoc/merge). Do not carry this full setDoc
 * into the edit path of a signed/paid report without that fix.
 */
export function useSaveReportDraft() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ id, values, previousAttachmentUrls = [] }) => {
      const { values: uploadedValues, newUrls } =
        await uploadPendingAttachments(values, `reports/${id}/invoices`)

      try {
        await setDoc(
          reportRef(id),
          stripUndefinedDeep({
            ...uploadedValues,
            status: 'draft',
            updatedAt: serverTimestamp(),
          }),
        )
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
    },
  })
}
