import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from 'firebase/firestore'
import { deleteObject, listAll, ref } from 'firebase/storage'
import { db, storage } from '@/lib/firebase'

/**
 * The data access layer for onboarding drafts (FR-TEN-17…21, SRS §6).
 *
 * Same conventions as the properties hooks (sub-stage M1/B): single reads with
 * `getDocs`/`getDoc` (NOT `onSnapshot`); freshness comes from every mutation
 * invalidating the queries it touches; components never touch `firebase/firestore`
 * directly — that boundary lives here, and it is exactly what the tests mock.
 *
 * A draft is admin-only (NFR-SEC-02, enforced by firestore.rules) and never becomes
 * an account by itself: completion happens later, through finalizeKyc (FR-TEN-16/18).
 *
 * The five hooks below share the collection name, the cache keys, and the document
 * ref, defined once here and separated by section dividers.
 */

const COLLECTION = 'onboardingDrafts'

/** Cache keys, hierarchical — invalidating `lists()` refreshes the draft list in
 * one call. */
export const draftKeys = {
  all: ['onboardingDrafts'],
  lists: () => [...draftKeys.all, 'list'],
  list: () => [...draftKeys.lists()],
  details: () => [...draftKeys.all, 'detail'],
  detail: (id) => [...draftKeys.details(), id],
}

function draftRef(id) {
  return doc(db, COLLECTION, id)
}

// ───────────────────────── useDraftsList ─────────────────────────
/**
 * The list of in-progress drafts (FR-TEN-19). They surface in the tenant list with
 * "Continue"/"Delete draft". A single `getDocs`; there is no archived axis here — a
 * draft is either in progress or deleted (FR-TEN-20).
 */
export function useDraftsList() {
  return useQuery({
    queryKey: draftKeys.list(),
    queryFn: async () => {
      const snap = await getDocs(collection(db, COLLECTION))
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
    },
  })
}

// ───────────────────────────── useDraft ──────────────────────────
/** A single draft (FR-TEN-17, for resuming). `enabled` holds the read until there
 * is an id. */
export function useDraft(id) {
  return useQuery({
    queryKey: draftKeys.detail(id),
    enabled: Boolean(id),
    queryFn: async () => {
      const snap = await getDoc(draftRef(id))
      if (!snap.exists()) {
        throw new Error(`Draft ${id} does not exist`)
      }
      return { id: snap.id, ...snap.data() }
    },
  })
}

// ─────────────────────────── useCreateDraft ──────────────────────
/**
 * Creates a fresh draft (FR-TEN-17). The system fields are set here:
 * - `status: 'in_progress'` — the only status a draft has (SRS §6)
 * - `currentStep: 1` — the wizard opens on step 1
 * - `createdAt` / `updatedAt` — server timestamps (SRS §6)
 *
 * Optional `values` seed the draft (e.g. an email pre-filled from the list); a bare
 * call creates an empty draft.
 */
export function useCreateDraft() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (values = {}) => {
      const ref = await addDoc(collection(db, COLLECTION), {
        ...values,
        status: 'in_progress',
        currentStep: 1,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
      return ref.id
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: draftKeys.lists() })
    },
  })
}

// ─────────────────────────── useUpdateDraft ──────────────────────
/**
 * Autosave (FR-TEN-17). Called on navigation between steps — no debounce, it fires
 * on the step change. It writes the entered values plus `currentStep` (where the
 * user is now) and refreshes `updatedAt`. The caller passes the partial values it
 * has; the draft accumulates them.
 */
export function useUpdateDraft() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, values, currentStep }) =>
      updateDoc(draftRef(id), {
        ...values,
        ...(currentStep !== undefined ? { currentStep } : {}),
        updatedAt: serverTimestamp(),
      }),
    onSuccess: (_result, { id }) => {
      queryClient.invalidateQueries({ queryKey: draftKeys.lists() })
      queryClient.invalidateQueries({ queryKey: draftKeys.detail(id) })
    },
  })
}

// ─────────────────────────── useDeleteDraft ──────────────────────
/**
 * Best-effort cleanup of the draft's Storage folder (/drafts/{draftId}/). The
 * photos live there (uploaded in Sub-stage D); when the draft is discarded they are
 * orphaned otherwise. There is no onDelete Cloud Function — cleanup is client-side
 * only, by decision, so this runs here.
 */
async function deleteDraftStorage(id) {
  const folder = ref(storage, `drafts/${id}`)
  const listing = await listAll(folder)
  await Promise.all(listing.items.map((item) => deleteObject(item)))
}

/**
 * Deletes a draft manually (FR-TEN-20). It removes the Firestore document AND the
 * Storage folder. The Storage cleanup is BEST-EFFORT: if it fails (rules, network,
 * nothing there yet), the document deletion still goes through — a failed cleanup
 * must never leave an undeletable draft. The Storage rule for /drafts/ is added at
 * Sub-stage D, so until then this cleanup is expected to no-op or fail quietly.
 */
export function useDeleteDraft() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (id) => {
      try {
        await deleteDraftStorage(id)
      } catch {
        // Swallowed on purpose: the document must be deletable regardless.
      }
      await deleteDoc(draftRef(id))
    },
    onSuccess: (_result, id) => {
      queryClient.invalidateQueries({ queryKey: draftKeys.lists() })
      queryClient.invalidateQueries({ queryKey: draftKeys.detail(id) })
    },
  })
}

// ────────────────────── useCheckExistingEmail ─────────────────────
/**
 * Live check on the Step 1 email field (FR-TEN-07): looks up `users` for an account
 * already registered with this email. A mutation, not a query — it fires once,
 * imperatively, from the field's onBlur handler, not automatically on render.
 * Returns `{ id, name }` of the matching account, or `null` if none.
 *
 * KNOWN GAP (flagged, not fixed here): `firestore.rules` has no client-read rule for
 * `users` yet — only the Cloud Function (Admin SDK) has touched it so far. Until that
 * rule lands, this will resolve to `permission-denied` in the real browser. See the
 * Sub-stage C report for the drafted rule pending Bogdan's approval.
 */
export function useCheckExistingEmail() {
  return useMutation({
    mutationFn: async (email) => {
      const snap = await getDocs(
        query(collection(db, 'users'), where('email', '==', email), limit(1)),
      )
      if (snap.empty) return null
      const match = snap.docs[0]
      return { id: match.id, name: match.data().name }
    },
  })
}

// ────────────────────── useCheckDuplicateCnp ──────────────────────
/**
 * Live check on the Step 1 cnp field (FR-TEN-22): early-warning UX only — the
 * authoritative check is server-side, in finalizeKyc (Sub-stage B), which re-verifies
 * at completion time regardless of what this returned. Same `users` rule gap as
 * `useCheckExistingEmail` above.
 */
export function useCheckDuplicateCnp() {
  return useMutation({
    mutationFn: async (cnp) => {
      const snap = await getDocs(
        query(collection(db, 'users'), where('cnp', '==', cnp), limit(1)),
      )
      if (snap.empty) return null
      const match = snap.docs[0]
      return { id: match.id, name: match.data().name }
    },
  })
}
