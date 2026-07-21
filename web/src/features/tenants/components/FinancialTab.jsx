import { useTranslation } from 'react-i18next'

/**
 * The Financial history tab (M3-D, SRS §5.3): a pure empty state.
 * `monthlyReports` is M4 — no collection, no hook, no fetch exist yet, so
 * there is nothing to read. Real content (all reports, status + link)
 * lands with M4.
 */
export function FinancialTab() {
  const { t } = useTranslation()

  return (
    <p className="text-sm text-muted-foreground">
      {t('tenants.detail.financial.empty')}
    </p>
  )
}
