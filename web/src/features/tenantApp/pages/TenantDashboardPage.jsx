import { useTranslation } from 'react-i18next'
import { AttachmentLink } from '@/components/shared/AttachmentLink'
import { RetryButton } from '@/components/shared/RetryButton'
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
 *
 * Attachments section (M5 audit finding, round 2): SRS §5.4 requires
 * "(view/download)" for `/app` specifically — `ReportSummaryView`'s own
 * badges are view-only. Mirrors `TenantReportDetailPage`'s own separate,
 * clickable attachments section EXACTLY (own private `collectAttachments`,
 * same tolerated duplication against `ReportSummaryView`'s inert badges,
 * same precedent `SharedReportPage` already established) — private per
 * page, not imported, same discipline as every other page-local helper in
 * this feature (`formatAddress`, etc.).
 */

function collectAttachments(data) {
  return [
    ...data.rent.attachments,
    ...data.maintenance.attachments,
    ...data.serviceCosts.flatMap((line) => line.attachments),
    ...data.otherExpenses.flatMap((line) => line.attachments),
  ]
}

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
      <div className="flex flex-col items-start gap-2 p-6">
        <p className="text-sm text-muted-foreground">
          {t('tenantApp.dashboard.error')}
        </p>
        <RetryButton
          onRetry={() => {
            tenancyQuery.refetch()
            reportsQuery.refetch()
          }}
          disabled={tenancyQuery.isFetching || reportsQuery.isFetching}
        />
      </div>
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

  const data = adaptTenantReportSummary(report, t)
  const attachments = collectAttachments(data)

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-3 rounded-lg border border-border bg-card p-6">
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
        data={data}
        showHeader={false}
        showPaymentStatus={false}
      />

      <DownloadReportPdfButton
        data={data}
        propertyName={tenancy.property?.name}
        fileNameBase={`raport-${tenancy.property?.name ?? 'proprietate'}-${report.month}-${report.year}`}
      />

      {attachments.length > 0 && (
        <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4">
          <h3 className="text-sm font-semibold text-foreground">
            {t('tenantApp.dashboard.attachments.title')}
          </h3>
          {attachments.map((attachment, index) => (
            <AttachmentLink
              key={index}
              attachment={attachment}
              downloadLabel={t('tenantApp.dashboard.attachments.download')}
            />
          ))}
        </div>
      )}
    </div>
  )
}
