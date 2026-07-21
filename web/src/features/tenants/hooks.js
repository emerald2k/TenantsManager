import { useQuery } from '@tanstack/react-query'
import { collection, getDocs, query, where } from 'firebase/firestore'
import { db } from '@/lib/firebase'

/**
 * The data access layer for the tenant list (FR-TEN-13, SRS §6).
 *
 * Same conventions as the properties/onboarding hooks: single reads with
 * `getDocs` (NOT `onSnapshot`); components never touch `firebase/firestore`
 * directly — that boundary lives here and is exactly what the tests mock.
 *
 * `users` and `tenancies` are both admin-only reads already granted by
 * firestore.rules (added in M2 sub-stages C and E) — no rules change is needed
 * for this list.
 */

const USERS = 'users'
const TENANCIES = 'tenancies'

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
