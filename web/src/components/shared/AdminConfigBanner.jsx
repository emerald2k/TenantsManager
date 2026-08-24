import { useTranslation } from 'react-i18next'
import { useAdminEmailConfigured } from '@/features/system/hooks'

/**
 * The persistent `/admin` configuration warning (FR-SYS-07). Renders
 * NOTHING while the check is pending or has never returned `false` — no
 * dismiss button, deliberately: the SRS calls this "persistent" because the
 * failure it describes (contract-expiry and report-preparation reminders,
 * and the heartbeat itself, all vanish silently) is not something a click
 * should be able to hide until it's actually fixed.
 *
 * A failed CHECK itself (network error, `checkAdminEmailConfigured` down)
 * stays silent rather than showing a second, different warning — the one
 * thing worth being loud about here is the confirmed "unset" state; an
 * inconclusive check is not evidence of that.
 */
export function AdminConfigBanner() {
  const { t } = useTranslation()
  const { data: configured } = useAdminEmailConfigured()

  if (configured !== false) return null

  return (
    <div
      role="alert"
      className="border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-center text-sm text-destructive"
    >
      {t('system.adminEmailMissing')}
    </div>
  )
}
