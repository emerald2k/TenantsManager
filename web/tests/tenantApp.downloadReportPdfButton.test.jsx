import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from './renderWithProviders'
import { useReportSummaryCapture } from '@/lib/reportSummaryCapture'
import { DownloadReportPdfButton } from '@/features/tenantApp/components/DownloadReportPdfButton'

// M5 sub-stage 8 plan
// (docs/superpowers/plans/2026-08-04-m5-substage8-report-export-repair.md,
// §7.4). Mocks `@/lib/reportSummaryCapture` at the module boundary —
// isolates this component's OWN pending/error state and console.error
// wiring from the capture mechanics, which have their own dedicated test
// file (reportSummaryCapture.test.jsx).

vi.mock('@/lib/reportSummaryCapture', () => ({
  useReportSummaryCapture: vi.fn(),
}))

const DATA = {
  propertyName: 'Apartament Centru',
  month: 7,
  year: 2026,
  rent: { amount: 2500, notes: '', attachments: [] },
  maintenance: { amount: 0, notes: '', attachments: [] },
  serviceCosts: [],
  otherExpenses: [],
  previousMonthArrears: 0,
  previousMonthCredit: 0,
  calculatedTotal: 2500,
  finalTotal: 2500,
  dueDate: '2026-07-10',
  paymentStatus: null,
  amountPaid: null,
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('DownloadReportPdfButton', () => {
  it('DPB1 — clicking the button calls downloadPdf with the EXACT fileNameBase prop', async () => {
    const downloadPdf = vi.fn().mockResolvedValue(undefined)
    useReportSummaryCapture.mockReturnValue({ downloadPdf, captureNode: null })
    const user = userEvent.setup()

    const { rerender } = await renderWithProviders(
      <DownloadReportPdfButton data={DATA} fileNameBase="raport-a" />,
    )
    await user.click(screen.getByRole('button', { name: 'Descarcă PDF' }))
    expect(downloadPdf).toHaveBeenNthCalledWith(1, 'raport-a')

    rerender(<DownloadReportPdfButton data={DATA} fileNameBase="raport-b" />)
    await user.click(screen.getByRole('button', { name: 'Descarcă PDF' }))
    expect(downloadPdf).toHaveBeenNthCalledWith(2, 'raport-b')
  })

  it('DPB2 — the button is disabled only WHILE the download is pending', async () => {
    let resolveDownload
    const downloadPdf = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveDownload = resolve
        }),
    )
    useReportSummaryCapture.mockReturnValue({ downloadPdf, captureNode: null })
    const user = userEvent.setup()
    await renderWithProviders(
      <DownloadReportPdfButton data={DATA} fileNameBase="raport-a" />,
    )

    const button = screen.getByRole('button', { name: 'Descarcă PDF' })
    expect(button).not.toBeDisabled()

    await user.click(button)
    expect(button).toBeDisabled()

    resolveDownload()
    expect(
      await screen.findByRole('button', { name: 'Descarcă PDF' }),
    ).not.toBeDisabled()
  })

  it('DPB3 — a rejected downloadPdf logs the real error via console.error AND shows the i18n message', async () => {
    const boom = new Error('rasterization failed')
    const downloadPdf = vi.fn().mockRejectedValue(boom)
    useReportSummaryCapture.mockReturnValue({ downloadPdf, captureNode: null })
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {})
    const user = userEvent.setup()
    await renderWithProviders(
      <DownloadReportPdfButton data={DATA} fileNameBase="raport-a" />,
    )

    await user.click(screen.getByRole('button', { name: 'Descarcă PDF' }))

    expect(consoleErrorSpy).toHaveBeenCalledWith(boom)
    expect(
      await screen.findByText('Nu am putut genera PDF-ul. Încearcă din nou.'),
    ).toBeVisible()
    consoleErrorSpy.mockRestore()
  })
})
