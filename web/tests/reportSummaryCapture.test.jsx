import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from './renderWithProviders'
import { useReportSummaryCapture } from '@/lib/reportSummaryCapture'

// M5 sub-stage 8 plan
// (docs/superpowers/plans/2026-08-04-m5-substage8-report-export-repair.md,
// §7.1). Mocks `html2canvas-pro` and `jspdf` entirely — this suite proves
// the HOOK'S OWN plumbing (mount timing, prop composition, error
// propagation), and proves NOTHING about whether `html2canvas-pro` actually
// parses `oklch()` correctly. jsdom's mocked module never touches real CSS
// color parsing, so no automated test in this repository can demonstrate
// the oklch repair — the only proof is a real browser render (plan §8).

const jsPDFInstance = {
  internal: { pageSize: { getWidth: () => 595 } },
  addImage: vi.fn(),
  save: vi.fn(),
}
vi.mock('jspdf', () => ({
  jsPDF: vi.fn(function jsPDFMock() {
    return jsPDFInstance
  }),
}))

const fakeCanvas = {
  width: 800,
  height: 600,
  toDataURL: vi.fn(() => 'data:image/png;base64,fake'),
}
const html2canvasMock = vi.fn(async () => fakeCanvas)
vi.mock('html2canvas-pro', () => ({
  default: (...args) => html2canvasMock(...args),
}))

const REPORT_SUMMARY_PROPS = {
  data: {
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
  },
}

function Harness({ onResult }) {
  const { captureCanvas, downloadPdf, captureNode } =
    useReportSummaryCapture(REPORT_SUMMARY_PROPS)

  return (
    <div>
      <button
        type="button"
        onClick={async () => {
          try {
            const canvas = await captureCanvas()
            onResult({ ok: true, canvas })
          } catch (error) {
            onResult({ ok: false, error })
          }
        }}
      >
        capture
      </button>
      <button
        type="button"
        onClick={async (event) => {
          const fileNameBase = event.currentTarget.dataset.fileNameBase
          try {
            await downloadPdf(fileNameBase)
            onResult({ ok: true })
          } catch (error) {
            onResult({ ok: false, error })
          }
        }}
        data-file-name-base="report-a"
      >
        pdf-a
      </button>
      <button
        type="button"
        onClick={async (event) => {
          const fileNameBase = event.currentTarget.dataset.fileNameBase
          try {
            await downloadPdf(fileNameBase)
            onResult({ ok: true })
          } catch (error) {
            onResult({ ok: false, error })
          }
        }}
        data-file-name-base="report-b"
      >
        pdf-b
      </button>
      {captureNode}
    </div>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  html2canvasMock.mockImplementation(async () => fakeCanvas)
})

describe('useReportSummaryCapture', () => {
  it('HC1 — mounts the capture ref BEFORE calling html2canvas-pro (never null)', async () => {
    const user = userEvent.setup()
    const onResult = vi.fn()
    await renderWithProviders(<Harness onResult={onResult} />)

    await user.click(screen.getByRole('button', { name: 'capture' }))

    expect(html2canvasMock).toHaveBeenCalledTimes(1)
    expect(html2canvasMock.mock.calls[0][0]).not.toBeNull()
    expect(onResult).toHaveBeenCalledWith({ ok: true, canvas: fakeCanvas })
  })

  it('HC2 — downloadPdf(base) saves under the EXACT interpolated name, per call', async () => {
    const user = userEvent.setup()
    const onResult = vi.fn()
    await renderWithProviders(<Harness onResult={onResult} />)

    await user.click(screen.getByRole('button', { name: 'pdf-a' }))
    await user.click(screen.getByRole('button', { name: 'pdf-b' }))

    expect(jsPDFInstance.save).toHaveBeenNthCalledWith(1, 'report-a.pdf')
    expect(jsPDFInstance.save).toHaveBeenNthCalledWith(2, 'report-b.pdf')
  })

  it('HC3 — a capture failure propagates OUT of captureCanvas and downloadPdf, never swallowed', async () => {
    const user = userEvent.setup()
    const boom = new Error('rasterization failed')
    html2canvasMock.mockRejectedValueOnce(boom)
    const onResult = vi.fn()
    await renderWithProviders(<Harness onResult={onResult} />)

    await user.click(screen.getByRole('button', { name: 'capture' }))

    expect(onResult).toHaveBeenCalledWith({ ok: false, error: boom })

    html2canvasMock.mockRejectedValueOnce(boom)
    await user.click(screen.getByRole('button', { name: 'pdf-a' }))
    expect(onResult).toHaveBeenCalledWith({ ok: false, error: boom })
  })
})
