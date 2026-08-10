import { useQuery } from '@tanstack/react-query'
import { getDownloadURL, ref } from 'firebase/storage'
import { storage } from '@/lib/firebase'

const STALE_TIME_MS = 5 * 60 * 1000

/**
 * Resolves a bucket-relative Storage `path` (SRS §6, debt #5 — the client
 * never persists a download URL, only a `path`) to a download URL AT DISPLAY
 * TIME. Every call this hook makes is a real `getDownloadURL()` request, so
 * Security Rules are checked on every resolution — the whole point of the
 * migration away from persisted, unrevocable URLs (CLAUDE.md §7).
 *
 * `staleTime` is 5 minutes, not Infinity: a deleted-and-recreated Storage
 * object gets a fresh download token, so an eternal cache would go on serving
 * a dead URL.
 *
 * `retry` is deliberately NOT set here — `@/lib/queryClient`'s app-wide
 * default is already `retry: 1` (a permission-denied response from Storage's
 * rules will not resolve on a retry, so 1 is already the right number), and
 * leaving it unset lets `createTestQueryClient()` (web/tests/
 * renderWithProviders.jsx) override it to `false` in tests exactly the way
 * every other hook in this codebase already relies on. Hardcoding `retry: 1`
 * here would silently defeat that test convention.
 *
 * `enabled: Boolean(path)` — a missing/blank path (e.g. a not-yet-uploaded
 * pending attachment) never fetches; `url` simply stays `undefined`.
 */
export function useAttachmentUrl(path) {
  const query = useQuery({
    queryKey: ['attachmentUrl', path],
    queryFn: () => getDownloadURL(ref(storage, path)),
    enabled: Boolean(path),
    staleTime: STALE_TIME_MS,
  })

  return {
    url: query.data,
    isLoading: query.isLoading,
    isError: query.isError,
  }
}
