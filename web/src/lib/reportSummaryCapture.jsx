import { useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { jsPDF } from 'jspdf'
import html2canvas from 'html2canvas-pro'
import { ReportSummaryView } from '@/components/shared/ReportSummaryView'

/**
 * Shared rasterization mechanics behind every "Download PDF"/"Download PNG"
 * button in the app (M5 sub-stage 8 plan). Mounts an off-screen
 * `<ReportSummaryView {...reportSummaryProps} />`, rasterizes it with
 * `html2canvas-pro` (the `html2canvas` fork with `oklch()` support — the
 * original could not parse this app's Tailwind v4/shadcn theme at all),
 * and optionally turns the resulting canvas into a saved PDF.
 *
 * The hook itself never catches anything — a rejected `captureCanvas`/
 * `downloadPdf` propagates to the caller. Each caller owns its own
 * pending/error UI state, since callers differ (admin also needs the raw
 * canvas for PNG; the tenant button only ever calls `downloadPdf`).
 */
export function useReportSummaryCapture(reportSummaryProps) {
  const captureRef = useRef(null)
  const [captureMounted, setCaptureMounted] = useState(false)

  /** `flushSync` — a plain `setState` only commits on the NEXT render,
   * which would leave `captureRef.current` null right when html2canvas-pro
   * needs it. */
  async function captureCanvas() {
    flushSync(() => setCaptureMounted(true))
    try {
      return await html2canvas(captureRef.current)
    } finally {
      setCaptureMounted(false)
    }
  }

  async function downloadPdf(fileNameBase) {
    const canvas = await captureCanvas()
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'pt' })
    const pageWidth = pdf.internal.pageSize.getWidth()
    const imgHeight = (canvas.height * pageWidth) / canvas.width
    pdf.addImage(
      canvas.toDataURL('image/png'),
      'PNG',
      0,
      0,
      pageWidth,
      imgHeight,
    )
    pdf.save(`${fileNameBase}.pdf`)
  }

  // Off-screen (NOT display:none, which html2canvas-pro cannot rasterize:
  // zero layout size, nothing to capture) — mounted ONLY during an actual
  // capture, see captureCanvas above.
  const captureNode = captureMounted ? (
    <div ref={captureRef} className="absolute -left-[9999px] top-0">
      <ReportSummaryView {...reportSummaryProps} />
    </div>
  ) : null

  return { captureCanvas, downloadPdf, captureNode }
}
