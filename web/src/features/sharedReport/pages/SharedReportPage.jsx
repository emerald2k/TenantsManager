import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { LanguageSwitcher } from '@/components/shared/LanguageSwitcher'
import { ReportSummaryView } from '@/components/shared/ReportSummaryView'
import {
  useSharedReport,
  useSharedReportAttachment,
} from '@/features/sharedReport/hooks'
import { base64ToBlob, downloadBlob } from '@/lib/blob'

/**
 * The public shared report (/r/:shareToken, FR-REP-07c, §5.1) — WITHOUT
 * authentication, OUTSIDE the admin layout (wired directly under the root
 * `<Routes>`, same as its placeholder was). Exposes EXCLUSIVELY the
 * allowlist getSharedReport returns — no portal, no history, no personal
 * data, structurally (ReportSummaryView is the same component the admin's
 * own PDF/PNG export renders off, so this page can never show LESS than the
 * export does either).
 *
 * An invalid/revoked/draft token renders the SAME generic "unavailable"
 * message as any other failure — getSharedReportCore already collapses all
 * three rejection reasons into one `not-found`, so there is nothing more
 * specific to leak here even if we wanted to.
 *
 * Attachment bytes are fetched ON DEMAND per click, through
 * getSharedReportAttachment — never a Storage URL reaches this page.
 */

function collectAttachments(data) {
  return [
    ...data.rent.attachments,
    ...data.maintenance.attachments,
    ...data.serviceCosts.flatMap((line) => line.attachments),
    ...data.otherExpenses.flatMap((line) => line.attachments),
  ]
}

export function SharedReportPage() {
  const { shareToken } = useParams()
  const { t } = useTranslation()
  const report = useSharedReport(shareToken)
  const getAttachment = useSharedReportAttachment()
  const [downloadError, setDownloadError] = useState(false)

  async function handleDownload(reference, name) {
    setDownloadError(false)
    try {
      const { base64, contentType } = await getAttachment.mutateAsync({
        shareToken,
        reference,
      })
      downloadBlob(base64ToBlob(base64, contentType), name)
    } catch {
      setDownloadError(true)
    }
  }

  if (report.isPending) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
      </div>
    )
  }

  if (report.isError) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-6">
        <p className="text-sm text-muted-foreground">
          {t('sharedReport.unavailable')}
        </p>
        <LanguageSwitcher />
      </div>
    )
  }

  const attachments = collectAttachments(report.data)

  return (
    <div className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 p-6">
      <div className="flex justify-end">
        <LanguageSwitcher />
      </div>

      <ReportSummaryView data={report.data} />

      {attachments.length > 0 && (
        <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4">
          <h3 className="text-sm font-semibold text-foreground">
            {t('sharedReport.attachments.title')}
          </h3>
          {attachments.map((attachment) => (
            <div
              key={attachment.reference}
              className="flex items-center justify-between gap-2"
            >
              <span className="text-sm text-muted-foreground">
                {attachment.name} ({attachment.type})
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  handleDownload(attachment.reference, attachment.name)
                }
                disabled={getAttachment.isPending}
              >
                {t('sharedReport.attachments.download')}
              </Button>
            </div>
          ))}
          {downloadError && (
            <p role="alert" className="text-xs text-destructive">
              {t('sharedReport.attachments.error')}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
