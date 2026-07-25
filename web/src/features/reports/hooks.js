import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { stripUndefinedDeep } from '@/features/onboarding/hooks'

/**
 * The data access layer for monthly report drafts (FR-REP-01…05/11/14, SRS §6).
 * Sub-stage 1 of M4 — DRAFT only. Same conventions as `properties/hooks.js`:
 * single reads (`getDoc`, not `onSnapshot`), freshness via invalidation,
 * components never touch `firebase/firestore` directly.
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
 * caller (the page): the hook only adds the two system fields that are
 * invariant regardless of who's saving.
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
    mutationFn: async ({ id, values }) => {
      await setDoc(
        reportRef(id),
        stripUndefinedDeep({
          ...values,
          status: 'draft',
          updatedAt: serverTimestamp(),
        }),
      )
      return id
    },
    onSuccess: (id) => {
      queryClient.invalidateQueries({ queryKey: reportKeys.detail(id) })
    },
  })
}
