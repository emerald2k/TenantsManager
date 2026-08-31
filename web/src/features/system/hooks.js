import { useQuery } from '@tanstack/react-query'
import { httpsCallable } from 'firebase/functions'
import { functions } from '@/lib/firebase'

/**
 * The data-access layer for cross-cutting, non-domain admin concerns — today
 * just the FR-SYS-07 configuration check. Its own small `features/` folder
 * rather than folding into `dashboard/` or `tenants/`: this is not tied to
 * any one domain, and `AdminLayout` (which mounts the banner) sits above all
 * of them.
 */

// ─────────────────────── useAdminEmailConfigured ─────────────────────────
/**
 * Whether `ADMIN_EMAIL` is set server-side (FR-SYS-07), backing the
 * persistent `/admin` warning banner. A LIVE check via the
 * `checkAdminEmailConfigured` callable, never a stored record — the SRS is
 * explicit about this: a configuration failure has no `mail` document to
 * project into `notifications`, so the only honest source is asking the
 * server right now.
 *
 * `enabled` defaults to `true` (mounted once, in `AdminLayout`, for the
 * whole admin session) — not gated on anything else being loaded first,
 * unlike most hooks in this codebase, because this check depends on
 * nothing but the admin being authenticated.
 */
export function useAdminEmailConfigured() {
  return useQuery({
    queryKey: ['system', 'adminEmailConfigured'],
    queryFn: async () => {
      const checkAdminEmailConfigured = httpsCallable(
        functions,
        'checkAdminEmailConfigured',
      )
      const result = await checkAdminEmailConfigured()
      return result.data.configured
    },
  })
}
