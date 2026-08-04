import { useTranslation } from 'react-i18next'
import { ReportSummaryView } from '@/components/shared/ReportSummaryView'
import { formatMonthYearLabel } from '@/features/dashboard/calculations'
import { useAuth } from '@/features/auth/useAuth'
import { useMySignedReports, useMyTenancy } from '@/features/tenantApp/hooks'
import { adaptTenantReportSummary } from '@/features/tenantApp/reportAdapter'
import { PaymentStatusBadge } from '@/features/tenantApp/components/PaymentStatusBadge'
import { DownloadReportPdfButton } from '@/features/tenantApp/components/DownloadReportPdfButton'

/**
 * `/app` — the tenant dashboard (FR-TAPP-01, SRS §5.4, M5 sub-stage 3 plan).
 * The card shows `finalTotal`, never `tenancies.currentBalance` — that field
 * is never read here at all. Shows the most recent SIGNED report, whichever
 * month — `reports[0]` from `useMySignedReports`, already sorted
 * newest-first (sub-stage 2) — never re-derived here.
 *
 * The page owns its own header (property name + the prominent month) and
 * the four-state payment badge; `ReportSummaryView` is rendered with
 * `showHeader={false}` `showPaymentStatus={false}` (Task 0) so nothing is
 * shown twice — it contributes only the cost-line table and the footer's
 * totals/arrears/credit/due-date rows.
 *
 * `DownloadReportPdfButton` (FR-TAPP-04, M5 sub-stage 8) is fed `data` +
 * `propertyName` only — it never forwards `showHeader`/`showPaymentStatus`,
 * so its OWN off-screen capture always uses `ReportSummaryView`'s TRUE
 * defaults (header + payment status both shown), deliberately DIFFERENT
 * from what's rendered inline on this very page. A downloaded PDF is a
 * standalone document with no surrounding page chrome to supply the
 * property name, month, or payment status otherwise — so the capture
 * cannot reuse this page's own suppressed props. See the sub-stage 8 plan,
 * §5, for the full reasoning (this is the ONE surface where capture props
 * and live props deliberately diverge; `/app/reports/:reportId` does not
 * have this asymmetry).
 */
export function TenantDashboardPage() {
  const { t, i18n } = useTranslation()
  const { user } = useAuth()
  const tenancyQuery = useMyTenancy(user.uid)
  const reportsQuery = useMySignedReports(user.uid)

  if (tenancyQuery.isPending || reportsQuery.isPending) {
    return (
      <p className="p-6 text-sm text-muted-foreground">{t('common.loading')}</p>
    )
  }

  if (tenancyQuery.isError || reportsQuery.isError) {
    return (
      <p className="p-6 text-sm text-muted-foreground">
        {t('tenantApp.dashboard.error')}
      </p>
    )
  }

  const tenancy = tenancyQuery.data
  if (!tenancy) {
    return (
      <p className="p-6 text-sm text-muted-foreground">
        {t('tenantApp.dashboard.noTenancy')}
      </p>
    )
  }

  const report = reportsQuery.data[0]
  if (!report) {
    return (
      <p className="p-6 text-sm text-muted-foreground">
        {t('tenantApp.dashboard.empty')}
      </p>
    )
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-3 rounded-lg border border-border p-6">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold text-foreground">
            {tenancy.property?.name}
          </h1>
          <p className="text-2xl font-semibold text-foreground">
            {formatMonthYearLabel(report.month, report.year, i18n.language)}
          </p>
        </div>
        <PaymentStatusBadge paymentStatus={report.paymentStatus ?? null} />
      </div>

      {tenancy.status === 'ended' && (
        <p className="text-xs font-medium text-muted-foreground">
          {t('tenantApp.dashboard.endedLabel')}
        </p>
      )}

      <ReportSummaryView
        data={adaptTenantReportSummary(report)}
        showHeader={false}
        showPaymentStatus={false}
      />

      <DownloadReportPdfButton
        data={adaptTenantReportSummary(report)}
        propertyName={tenancy.property?.name}
        fileNameBase={`raport-${tenancy.property?.name ?? 'proprietate'}-${report.month}-${report.year}`}
      />
    </div>
  )
}
