import { useQuery } from '@tanstack/react-query'
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
} from 'firebase/firestore'
import { db } from '@/lib/firebase'

/**
 * The data-access layer for the tenant-facing portal (M5 sub-stage 2 plan,
 * docs/superpowers/plans/2026-08-02-m5-substage2-hooks-report-adapter.md).
 * Same conventions as properties/tenants/reports hooks: `getDocs`/`getDoc`
 * (never `onSnapshot`), `null` for "nothing to show" rather than throwing,
 * identity (`userId`) passed in explicitly by the caller rather than the
 * hook reaching into `useAuth()` itself.
 */

const TENANCIES = 'tenancies'
const REPORTS = 'monthlyReports'

function reportRef(id) {
  return doc(db, REPORTS, id)
}

/**
 * The active tenancy if there is one; otherwise the most-recently-ended one
 * (by `endedAt.toMillis()` — a real Firestore `Timestamp`, never compared as
 * a raw object or mangled through `new Date()`). An `ended` tenancy with no
 * `endedAt` at all (shouldn't happen per `endTenancy`'s contract, which
 * always sets it, but not trusted blindly here) is excluded from the
 * comparison entirely — never picked, never crashes the comparison.
 */
function pickCurrentTenancy(tenancies) {
  const active = tenancies.find((t) => t.status === 'active')
  if (active) return active

  const rankable = tenancies.filter((t) => t.status === 'ended' && t.endedAt)
  if (rankable.length === 0) return null

  return rankable.reduce((latest, t) =>
    t.endedAt.toMillis() > latest.endedAt.toMillis() ? t : latest,
  )
}

/**
 * The tenant's ONE relevant tenancy (FR-TAPP-06). `null` while there's
 * genuinely nothing to show (no tenancy at all, or only unrankable ended
 * ones) — a hook must resolve cleanly rather than throw.
 */
export function useMyTenancy(userId) {
  return useQuery({
    queryKey: ['tenancies', 'mine', userId],
    enabled: Boolean(userId),
    queryFn: async () => {
      const snap = await getDocs(
        query(collection(db, TENANCIES), where('userId', '==', userId)),
      )
      const tenancies = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      return pickCurrentTenancy(tenancies)
    },
  })
}

/**
 * The tenant's full signed-report history (FR-TAPP-02, `/app/history`). Both
 * `where` clauses mirror `firestore.rules`' own+signed condition exactly, so
 * the query can never return something the rule would reject anyway.
 *
 * Chronological ordering (newest month/year first) is done CLIENT-SIDE, in
 * JS, after the fetch — deliberately NOT via Firestore's `orderBy`. Adding
 * `orderBy` on a field beyond the two equality filters is exactly the query
 * shape that WOULD require a composite index; sorting in JS keeps this hook
 * on the automatic multi-equality index path.
 */
export function useMySignedReports(userId) {
  return useQuery({
    queryKey: ['monthlyReports', 'mine', userId],
    enabled: Boolean(userId),
    queryFn: async () => {
      const snap = await getDocs(
        query(
          collection(db, REPORTS),
          where('userId', '==', userId),
          where('status', '==', 'signed'),
        ),
      )
      const reports = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      return reports.sort((a, b) =>
        a.year !== b.year ? b.year - a.year : b.month - a.month,
      )
    },
  })
}

/**
 * One report by id (`/app/reports/:reportId`). Two DIFFERENT "nothing here"
 * cases collapse to the SAME `null`: the document plainly doesn't exist, or
 * the rule rejects the read (`permission-denied` — a foreign report, or the
 * tenant's own but still a draft). The SRS requires a foreign/draft id to
 * render as "not found", never a technical error — collapsing both cases
 * here is what makes that possible without the page needing to know
 * Firestore error codes at all.
 */
export function useTenantReport(reportId) {
  return useQuery({
    queryKey: ['monthlyReports', 'byId', reportId],
    enabled: Boolean(reportId),
    queryFn: async () => {
      try {
        const snap = await getDoc(reportRef(reportId))
        if (!snap.exists()) return null
        return { id: snap.id, ...snap.data() }
      } catch (err) {
        if (err.code === 'permission-denied') return null
        throw err
      }
    },
  })
}
