import { useQuery } from '@tanstack/react-query'
import {
  Timestamp,
  collection,
  getDocs,
  limit,
  query,
  where,
} from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { windowCutoff } from './calculations'

/**
 * The data access layer for the notification log (SRS §5.3
 * `/admin/notifications`, FR-NLOG-01…08, M8 stage 14 commit B).
 *
 * Reads the `notifications` projection only — never `mail` (closed to every
 * client, FR-NLOG-02). Same conventions as `properties/hooks.js`: a single
 * `getDocs` read, freshness by invalidation, and this file is the only place
 * a component's data comes from — it is exactly the boundary the fast band
 * mocks.
 */

const COLLECTION = 'notifications'

export const notificationKeys = {
  all: ['notifications'],
  log: () => [...notificationKeys.all, 'log'],
}

/**
 * The log's rows, already bounded to the rolling 12-month window
 * (FR-NLOG-07) by a **single-field range filter** on `sentAt` — the one
 * `where` shape SRS §6 allows without a composite index, and NOT an
 * `orderBy` (that would silently drop any row whose `serverTimestamp()` has
 * not resolved yet). Sorting stays in JS, in the page.
 *
 * NFR-PERF-05: the fetch is bounded, so it grows with the last 12 months of
 * traffic, not with all history.
 *
 * `anyExist` is a separate `limit(1)` probe over the WHOLE collection,
 * unfiltered — the one thing FR-NLOG-08 needs that the windowed query cannot
 * answer: an empty window on a populated collection ("nothing in the last
 * 12 months") must read differently from a genuinely empty log ("it starts
 * empty on the day M8 deploys"). `limit(1)` keeps it bounded.
 */
export function useNotificationLog() {
  return useQuery({
    queryKey: notificationKeys.log(),
    queryFn: async () => {
      const cutoff = Timestamp.fromDate(windowCutoff())
      const [windowSnap, probeSnap] = await Promise.all([
        getDocs(
          query(collection(db, COLLECTION), where('sentAt', '>=', cutoff)),
        ),
        getDocs(query(collection(db, COLLECTION), limit(1))),
      ])
      return {
        rows: windowSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
        anyExist: !probeSnap.empty,
      }
    },
  })
}
