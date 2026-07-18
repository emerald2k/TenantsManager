import { QueryClient } from '@tanstack/react-query'

/**
 * The application's TanStack Query instance.
 *
 * Architecture decision (established with the admin): we read from Firestore with
 * `getDocs` — a single read — NOT with `onSnapshot`. Data freshness does NOT come
 * from a realtime listener, but from invalidating the cache after every mutation.
 * There is a single admin editing their own data (NFR-SEC-04), so there is no
 * concurrent writer that would make realtime necessary; listeners, on the other
 * hand, would hold connections open and consume reads continuously.
 *
 * `refetchOnWindowFocus: false` follows from the same decision: without it, every
 * return to the tab would redo the reads for no real reason.
 *
 * A `staleTime` of 30s: at 5–20 properties (NFR-PERF-01) there is nothing to
 * optimize aggressively, and the explicit invalidation after mutations gives us
 * freshness where it matters anyway.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
    mutations: {
      // A failed mutation is reported to the admin, not retried silently:
      // a retry on a write is a second write, not a simple re-read.
      retry: 0,
    },
  },
})
