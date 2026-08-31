import { useParams, Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { AttachmentLink } from '@/components/shared/AttachmentLink'
import { RetryButton } from '@/components/shared/RetryButton'
import { ReportSummaryView } from '@/components/shared/ReportSummaryView'
import { useAuth } from '@/features/auth/useAuth'
import { useMyTenancy, useTenantReport } from '@/features/tenantApp/hooks'
import { adaptTenantReportSummary } from '@/features/tenantApp/reportAdapter'
import { DownloadReportPdfButton } from '@/features/tenantApp/components/DownloadReportPdfButton'

/**
 * `/app/reports/:reportId` — the full breakdown of a single signed report
 * (FR-TAPP-02, SRS §5.4, M5 sub-stage 6 plan). `ReportSummaryView` is used
 * UNMODIFIED, with `showCalculatedTotal` (SRS requires both `calculatedTotal`
 * AND `finalTotal` here, unlike the dashboard) and `propertyName` from
 * `tenancies.property.name` (the adapter's output has no `propertyName`
 * key). `useMyTenancy` is read for ONE reason only: that property name — no
 * other tenancy field is displayed (third consumer of the dashboard/
 * history pages' same "one relevant tenancy" assumption).
 *
 * "Download PDF" (FR-TAPP-04, M5 sub-stage 8) — `DownloadReportPdfButton` is
 * fed the SAME `data`/`propertyName`/`showCalculatedTotal` this page already
 * passes to the live `ReportSummaryView` above, so its off-screen capture
 * is IDENTICAL to what's rendered inline here — unlike `/app`'s dashboard,
 * this page suppresses nothing (header and payment status are both already
 * shown), so there is no asymmetry to account for (sub-stage 8 plan, §5).
 * The separate attachments-with-real-links section below does NOT enter
 * the capture — same boundary as the admin export, see §6: a rasterized
 * link is a dead link, and the tenant already has the real, clickable
 * version right here on the page.
 */

function collectAttachments(data) {
  return [
    ...data.rent.attachments,
    ...data.maintenance.attachments,
    ...data.serviceCosts.flatMap((line) => line.attachments),
    ...data.otherExpenses.flatMap((line) => line.attachments),
  ]
}

export function TenantReportDetailPage() {
  const { reportId } = useParams()
  const { t } = useTranslation()
  const { user } = useAuth()
  const tenancyQuery = useMyTenancy(user.uid)
  const reportQuery = useTenantReport(reportId)

  if (tenancyQuery.isPending || reportQuery.isPending) {
    return (
      <p className="p-6 text-sm text-muted-foreground">{t('common.loading')}</p>
    )
  }

  if (tenancyQuery.isError || reportQuery.isError) {
    return (
      <div className="flex flex-col items-start gap-2 p-6">
        <p className="text-sm text-muted-foreground">
          {t('tenantApp.reportDetail.error')}
        </p>
        <RetryButton
          onRetry={() => {
            tenancyQuery.refetch()
            reportQuery.refetch()
          }}
          disabled={tenancyQuery.isFetching || reportQuery.isFetching}
        />
      </div>
    )
  }

  if (!reportQuery.data) {
    return (
      <div className="flex flex-col gap-3 p-6">
        <p className="text-sm text-muted-foreground">
          {t('tenantApp.reportDetail.notFound')}
        </p>
        <Link to="/app/history" className="text-sm text-primary underline">
          {t('tenantApp.reportDetail.backToHistory')}
        </Link>
      </div>
    )
  }

  const data = adaptTenantReportSummary(reportQuery.data, t)
  const attachments = collectAttachments(data)

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4 p-6">
      <Link to="/app/history" className="text-sm text-primary underline">
        {t('tenantApp.reportDetail.backToHistory')}
      </Link>

      <ReportSummaryView
        data={data}
        propertyName={tenancyQuery.data?.property?.name ?? null}
        showCalculatedTotal
      />

      <DownloadReportPdfButton
        data={data}
        propertyName={tenancyQuery.data?.property?.name ?? null}
        showCalculatedTotal
        fileNameBase={`raport-${tenancyQuery.data?.property?.name ?? 'proprietate'}-${data.month}-${data.year}`}
      />

      {attachments.length > 0 && (
        <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4">
          <h3 className="text-sm font-semibold text-foreground">
            {t('tenantApp.reportDetail.attachments.title')}
          </h3>
          {attachments.map((attachment, index) => (
            <AttachmentLink
              key={index}
              attachment={attachment}
              downloadLabel={t('tenantApp.reportDetail.attachments.download')}
            />
          ))}
        </div>
      )}
    </div>
  )
}
