import { useMutation, useQuery } from '@tanstack/react-query'
import { httpsCallable } from 'firebase/functions'
import { functions } from '@/lib/firebase'

/**
 * The data access layer for the PUBLIC shared-report surface (/r/:shareToken,
 * FR-REP-07c, M4 sub-stage 8). Both callables are PUBLIC (no auth) —
 * `httpsCallable` works unauthenticated exactly like this, the same
 * `functions` client instance every other feature already uses.
 */

/**
 * The report itself, by shareToken (functions/src/sharedReport.js's
 * `getSharedReportCore` — the allowlist shape, see that file for the exact
 * fields). `retry: false`: a `not-found` here (unknown/revoked/draft token)
 * is a REAL terminal state, not a transient failure worth retrying.
 */
export function useSharedReport(shareToken) {
  return useQuery({
    queryKey: ['sharedReport', shareToken],
    enabled: Boolean(shareToken),
    retry: false,
    queryFn: async () => {
      const getSharedReport = httpsCallable(functions, 'getSharedReport')
      const result = await getSharedReport({ shareToken })
      return result.data
    },
  })
}

/**
 * One attachment's bytes, fetched ON DEMAND (a mutation, not a query — the
 * visitor triggers this per attachment by clicking "Download", it is not
 * something to auto-fetch/cache for every attachment on page load).
 * Returns `{ base64, contentType, name }` (functions/src/sharedReport.js's
 * `getSharedReportAttachmentCore`).
 */
export function useSharedReportAttachment() {
  return useMutation({
    mutationFn: async ({ shareToken, reference }) => {
      const getSharedReportAttachment = httpsCallable(
        functions,
        'getSharedReportAttachment',
      )
      const result = await getSharedReportAttachment({ shareToken, reference })
      return result.data
    },
  })
}
