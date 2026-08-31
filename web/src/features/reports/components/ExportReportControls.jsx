import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { useRevokeShareLink, useShareReport } from '@/features/reports/hooks'
import { useReportSummaryCapture } from '@/lib/reportSummaryCapture'

/**
 * The export zone on a SIGNED report (SRS §5.3, FR-REP-07b/07c, M4 sub-stage
 * 8 Phase 2) — copy/revoke the shareable link, download PDF/PNG. Rendered
 * by MonthlyReportPage in the SAME action row as SignReportControl/
 * SendReportNotificationControl, gated on the SAME `isLocked`;
 * SignReportControl/the lock itself are not touched here at all.
 *
 * Maps the admin's own already-loaded `report`/`property` into the EXACT
 * same shape getSharedReportCore's allowlist returns, so ReportSummaryView
 * (the shared, purely-presentational component) renders identically here
 * and on the public /r/ page — the export can never structurally show more
 * than the shared link does.
 */

/** Strips each attachment down to `{ name, type }` — ReportSummaryView never
 * needs a `reference` (that's only meaningful for the public page's
 * interactive download, which the admin's own export doesn't need: the
 * admin already has the real attachment UI on the report form itself). */
function toSummaryAttachments(attachments) {
  return (attachments ?? []).map((att) => ({ name: att.name, type: att.type }))
}

export function toReportSummaryData(report, property) {
  return {
    propertyName: property?.name ?? null,
    month: report.month,
    year: report.year,
    rent: {
      amount: report.rent.amount,
      notes: report.rent.notes ?? null,
      attachments: toSummaryAttachments(report.rent.attachments),
    },
    maintenance: {
      amount: report.maintenance.amount,
      notes: report.maintenance.notes ?? null,
      attachments: toSummaryAttachments(report.maintenance.attachments),
    },
    serviceCosts: (report.serviceCosts ?? []).map((line) => ({
      name: line.name,
      amount: line.amount,
      notes: line.notes ?? null,
      attachments: toSummaryAttachments(line.attachments),
    })),
    otherExpenses: (report.otherExpenses ?? []).map((line) => ({
      description: line.description,
      amount: line.amount,
      notes: line.notes ?? null,
      attachments: toSummaryAttachments(line.attachments),
    })),
    previousMonthArrears: report.previousMonthArrears ?? 0,
    previousMonthCredit: report.previousMonthCredit ?? 0,
    roundingSurplus: report.roundingSurplus ?? 0,
    calculatedTotal: report.calculatedTotal,
    finalTotal: report.finalTotal,
    dueDate: report.dueDate,
    paymentStatus: report.paymentStatus ?? null,
    amountPaid: report.amountPaid ?? null,
  }
}

export function ExportReportControls({ report, property }) {
  const { t } = useTranslation()
  const shareReport = useShareReport()
  const revokeShareLink = useRevokeShareLink()
  const { captureCanvas, downloadPdf, captureNode } = useReportSummaryCapture({
    data: toReportSummaryData(report, property),
  })

  const [revokeConfirmOpen, setRevokeConfirmOpen] = useState(false)
  const [copyStatus, setCopyStatus] = useState(null) // 'success' | 'error' | null
  const [pdfPending, setPdfPending] = useState(false)
  const [pdfError, setPdfError] = useState(false)
  const [pngPending, setPngPending] = useState(false)
  const [pngError, setPngError] = useState(false)

  const hasLiveLink = Boolean(report.shareToken) && !report.shareTokenRevoked

  async function handleCopyLink() {
    setCopyStatus(null)
    try {
      const { token } = await shareReport.mutateAsync({
        id: report.id,
        shareToken: report.shareToken,
        shareTokenRevoked: report.shareTokenRevoked,
      })
      await navigator.clipboard.writeText(
        `${window.location.origin}/r/${token}`,
      )
      setCopyStatus('success')
    } catch (error) {
      console.error(error)
      setCopyStatus('error')
    }
  }

  async function handleRevoke() {
    await revokeShareLink.mutateAsync({ id: report.id })
    setRevokeConfirmOpen(false)
  }

  const exportFileBase = `raport-${property?.name ?? report.propertyId}-${report.month}-${report.year}`

  async function handleDownloadPdf() {
    setPdfError(false)
    setPdfPending(true)
    try {
      await downloadPdf(exportFileBase)
    } catch (error) {
      console.error(error)
      setPdfError(true)
    } finally {
      setPdfPending(false)
    }
  }

  async function handleDownloadPng() {
    setPngError(false)
    setPngPending(true)
    try {
      const canvas = await captureCanvas()
      const link = document.createElement('a')
      link.href = canvas.toDataURL('image/png')
      link.download = `${exportFileBase}.png`
      link.click()
    } catch (error) {
      console.error(error)
      setPngError(true)
    } finally {
      setPngPending(false)
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={handleCopyLink}
          disabled={shareReport.isPending}
        >
          {t('reports.export.copyLink')}
        </Button>
        {hasLiveLink && (
          <Button
            type="button"
            variant="outline"
            onClick={() => setRevokeConfirmOpen(true)}
          >
            {t('reports.export.revoke')}
          </Button>
        )}
        <Button
          type="button"
          variant="outline"
          onClick={handleDownloadPdf}
          disabled={pdfPending}
        >
          {t('reports.export.downloadPdf')}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={handleDownloadPng}
          disabled={pngPending}
        >
          {t('reports.export.downloadPng')}
        </Button>
      </div>

      {copyStatus === 'success' && (
        <p role="status" className="text-sm text-muted-foreground">
          {t('reports.export.copySuccess')}
        </p>
      )}
      {copyStatus === 'error' && (
        <p role="alert" className="text-sm text-destructive">
          {t('reports.export.copyError')}
        </p>
      )}
      {pdfError && (
        <p role="alert" className="text-sm text-destructive">
          {t('reports.export.pdfError')}
        </p>
      )}
      {pngError && (
        <p role="alert" className="text-sm text-destructive">
          {t('reports.export.pngError')}
        </p>
      )}

      <ConfirmDialog
        open={revokeConfirmOpen}
        onOpenChange={setRevokeConfirmOpen}
        titleKey="reports.export.revokeConfirmTitle"
        descriptionKey="reports.export.revokeConfirmBody"
        confirmKey="reports.export.revokeConfirmButton"
        onConfirm={handleRevoke}
        isPending={revokeShareLink.isPending}
      />

      {captureNode}
    </div>
  )
}
