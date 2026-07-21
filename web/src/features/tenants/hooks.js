import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  collection,
  doc,
  getDocs,
  query,
  updateDoc,
  where,
} from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { stripUndefinedDeep } from '@/features/onboarding/hooks'

/**
 * The data access layer for the tenant list (FR-TEN-13, SRS §6) and the tenant
 * detail Profile tab (FR-TEN-11, M3-B).
 *
 * Same conventions as the properties/onboarding hooks: single reads with
 * `getDocs` (NOT `onSnapshot`); components never touch `firebase/firestore`
 * directly — that boundary lives here and is exactly what the tests mock.
 *
 * `users` and `tenancies` are both admin-only reads/writes already granted by
 * firestore.rules (added in M2 sub-stages C and E) — no rules change is needed
 * for anything here.
 */

const USERS = 'users'
const TENANCIES = 'tenancies'

function userRef(id) {
  return doc(db, USERS, id)
}

export const userKeys = {
  all: ['users'],
  lists: () => [...userKeys.all, 'list'],
  list: () => [...userKeys.lists()],
}

// ───────────────────────────── useUsers ──────────────────────────
/**
 * Every tenant (FR-TEN-13). A `users` document IS a tenant: the admin account
 * carries only the custom claim, never a `users` doc (see functions/scripts/
 * setAdminClaim.js), so the whole collection is the tenant list — no need to
 * filter the admin out.
 *
 * NO `where('status','==',...)`: unlike properties (where `archived` is a
 * boolean axis filtered in the query), a tenant's archived state is one value
 * of the `status` ENUM. Filtering archived rows is a display preference done
 * client-side on the "Show archived" toggle — so we fetch all and let the page
 * decide. At this scale (NFR-PERF-01) that is cheaper than a status index.
 */
export function useUsers() {
  return useQuery({
    queryKey: userKeys.list(),
    queryFn: async () => {
      const snap = await getDocs(collection(db, USERS))
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
    },
  })
}

// ─────────────────────────── useUpdateUser ───────────────────────
/**
 * Writes to `users/{id}` from the Profile tab's per-section edit (FR-TEN-11).
 * A DUMB pass-through, deliberately: `values` reaches `updateDoc` exactly as
 * given, after `stripUndefinedDeep` (CLAUDE.md §7 — mandatory for any Firestore
 * form write; same hazard as the onboarding autosave, same fix, reused rather
 * than re-implemented).
 *
 * The hook does NOT flatten nested objects. Firestore's own `updateDoc`
 * already treats a top-level key containing a literal dot (e.g.
 * `'guarantor.name'`) as a field path, touching only that leaf. That matters
 * because `guarantor` is ONE Firestore map holding both the text fields
 * (name/cnp/phone, this hook's concern) AND `idDocumentPhotos[]` (the photo
 * gallery's concern) — a section-edit form only has the text fields in scope,
 * so it MUST save them as `{'guarantor.name': ..., 'guarantor.cnp': ..., ...}`,
 * not `{guarantor: {name, cnp, phone}}`, or it would silently wipe the photos
 * the gallery already saved. The Profile tab's guarantor section is the one
 * caller that needs this; every other section owns every field of whatever
 * nested object it edits, so a plain nested write is safe there.
 *
 * Invalidates BOTH the tenant list (`useUsers`, so an edited name/status shows
 * up back on /admin/tenants) and this user's detail read (`useUserById`,
 * onboarding/hooks.js — same `['users','detail',id]` key, reused there for the
 * existing-tenant onboarding banner and here for the Profile tab).
 */
export function useUpdateUser() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, values }) =>
      updateDoc(userRef(id), stripUndefinedDeep(values)),
    onSuccess: (_result, { id }) => {
      queryClient.invalidateQueries({ queryKey: userKeys.lists() })
      queryClient.invalidateQueries({ queryKey: ['users', 'detail', id] })
    },
  })
}

// ─────────────────────────── useActiveTenancies ──────────────────
/**
 * All active tenancies (FR-CON-02). The tenant list joins these to `users` by
 * `userId` to fill the "current property" (denormalized `property.name`) and
 * "outstanding balance" (`currentBalance`) columns. Constrained to
 * status == 'active' so an ended tenancy never decides a row's current property.
 *
 * FR-CON-02 guarantees at most one active tenancy per account, so keying the
 * result by `userId` in the page is unambiguous.
 */
export function useActiveTenancies() {
  return useQuery({
    queryKey: ['tenancies', 'active', 'list'],
    queryFn: async () => {
      const snap = await getDocs(
        query(collection(db, TENANCIES), where('status', '==', 'active')),
      )
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
    },
  })
}
