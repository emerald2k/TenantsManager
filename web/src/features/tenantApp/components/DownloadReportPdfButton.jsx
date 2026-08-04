import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { useReportSummaryCapture } from '@/lib/reportSummaryCapture'

/**
 * "Download PDF" (FR-TAPP-04) — shared by `/app` and `/app/reports/:reportId`
 * (M5 sub-stage 8 plan). PDF only — no PNG, no share link, those are
 * FR-REP-07b/07c, admin-only. Own `tenantApp.export.*` i18n keys, not a
 * reuse of the admin's `reports.export.*` — the namespace follows the
 * AUDIENCE the text is shown to, not whether the underlying component is
 * shared (plan §2/§9).
 */
export function DownloadReportPdfButton({
  data,
  propertyName,
  showCalculatedTotal,
  fileNameBase,
}) {
  const { t } = useTranslation()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState(false)
  const { downloadPdf, captureNode } = useReportSummaryCapture({
    data,
    propertyName,
    showCalculatedTotal,
  })

  async function handleClick() {
    setError(false)
    setPending(true)
    try {
      await downloadPdf(fileNameBase)
    } catch (err) {
      console.error(err)
      setError(true)
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <Button
        type="button"
        variant="outline"
        onClick={handleClick}
        disabled={pending}
      >
        {t('tenantApp.export.downloadPdf')}
      </Button>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {t('tenantApp.export.pdfError')}
        </p>
      )}
      {captureNode}
    </div>
  )
}
