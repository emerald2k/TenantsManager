import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from './renderWithProviders'
import {
  ExportReportControls,
  toReportSummaryData,
} from '@/features/reports/components/ExportReportControls'
import { useRevokeShareLink, useShareReport } from '@/features/reports/hooks'

// Fast band — the hooks (Firestore boundary) and the export libraries
// (canvas/PDF rendering) are mocked; reports.hooks.test.jsx already covers
// what useShareReport/useRevokeShareLink do with Firestore.
vi.mock('@/features/reports/hooks', () => ({
  useShareReport: vi.fn(),
  useRevokeShareLink: vi.fn(),
}))

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

function report(overrides = {}) {
  return {
    id: 'p1_2026-07',
    propertyId: 'p1',
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
    shareToken: null,
    shareTokenRevoked: false,
    ...overrides,
  }
}

const PROPERTY = { name: 'Apartament Centru' }

beforeEach(() => {
  vi.clearAllMocks()
  useShareReport.mockReturnValue({
    mutateAsync: vi
      .fn()
      .mockResolvedValue({ token: 'brand-new-token', wrote: true }),
    isPending: false,
  })
  useRevokeShareLink.mockReturnValue({
    mutateAsync: vi.fn().mockResolvedValue(undefined),
    isPending: false,
  })
})

describe('toReportSummaryData', () => {
  it('maps the admin report + property into the SAME shape ReportSummaryView/getSharedReport use', () => {
    const data = toReportSummaryData(
      report({
        rent: {
          amount: 2500,
          notes: 'x',
          attachments: [{ url: 'https://x', name: 'a.pdf', type: 'pdf' }],
        },
      }),
      PROPERTY,
    )

    expect(data.propertyName).toBe('Apartament Centru')
    expect(data.rent).toEqual({
      amount: 2500,
      notes: 'x',
      attachments: [{ name: 'a.pdf', type: 'pdf' }],
    })
    expect(data.rent.attachments[0]).not.toHaveProperty('url')
  })
})

describe('ExportReportControls', () => {
  it('"Copiază link" generates a token (if needed) and copies /r/{token} to the clipboard', async () => {
    // userEvent.setup() installs ITS OWN navigator.clipboard mock — spy on
    // writeText AFTER that (never in beforeEach), same discipline as
    // onboarding.stepContract.test.jsx's password-copy test.
    const user = userEvent.setup()
    const writeTextSpy = vi.spyOn(navigator.clipboard, 'writeText')
    await renderWithProviders(
      <ExportReportControls report={report()} property={PROPERTY} />,
    )

    await user.click(
      screen.getByRole('button', { name: 'Copiază link partajabil' }),
    )

    expect(useShareReport().mutateAsync).toHaveBeenCalledWith({
      id: 'p1_2026-07',
      shareToken: null,
      shareTokenRevoked: false,
    })
    expect(writeTextSpy).toHaveBeenCalledWith(
      expect.stringContaining('/r/brand-new-token'),
    )
    expect(await screen.findByText('Linkul a fost copiat.')).toBeVisible()
  })

  it('shows "Revocă" only when a LIVE (non-revoked) shareToken exists', async () => {
    const { rerender } = await renderWithProviders(
      <ExportReportControls
        report={report({ shareToken: null })}
        property={PROPERTY}
      />,
    )
    expect(
      screen.queryByRole('button', { name: 'Revocă' }),
    ).not.toBeInTheDocument()

    rerender(
      <ExportReportControls
        report={report({ shareToken: 'live-token', shareTokenRevoked: false })}
        property={PROPERTY}
      />,
    )
    expect(screen.getByRole('button', { name: 'Revocă' })).toBeVisible()

    rerender(
      <ExportReportControls
        report={report({ shareToken: 'old-token', shareTokenRevoked: true })}
        property={PROPERTY}
      />,
    )
    expect(
      screen.queryByRole('button', { name: 'Revocă' }),
    ).not.toBeInTheDocument()
  })

  it('"Revocă" asks for confirmation before calling useRevokeShareLink', async () => {
    const user = userEvent.setup()
    await renderWithProviders(
      <ExportReportControls
        report={report({ shareToken: 'live-token', shareTokenRevoked: false })}
        property={PROPERTY}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Revocă' }))
    expect(useRevokeShareLink().mutateAsync).not.toHaveBeenCalled()

    const dialog = screen.getByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Revocă' }))
    expect(useRevokeShareLink().mutateAsync).toHaveBeenCalledWith({
      id: 'p1_2026-07',
    })
  })

  it('downloads a PDF via jsPDF, fed by an html2canvas capture', async () => {
    const user = userEvent.setup()
    await renderWithProviders(
      <ExportReportControls report={report()} property={PROPERTY} />,
    )

    await user.click(screen.getByRole('button', { name: 'Descarcă PDF' }))

    expect(html2canvasMock).toHaveBeenCalled()
    expect(jsPDFInstance.addImage).toHaveBeenCalled()
    expect(jsPDFInstance.save).toHaveBeenCalledWith(
      expect.stringContaining('.pdf'),
    )
  })

  it('downloads a PNG via an html2canvas capture (no jsPDF involved)', async () => {
    const user = userEvent.setup()
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => {})
    await renderWithProviders(
      <ExportReportControls report={report()} property={PROPERTY} />,
    )

    await user.click(screen.getByRole('button', { name: 'Descarcă PNG' }))

    expect(html2canvasMock).toHaveBeenCalled()
    expect(jsPDFInstance.save).not.toHaveBeenCalled()
    expect(clickSpy).toHaveBeenCalled()
    clickSpy.mockRestore()
  })

  // M5 sub-stage 8 plan, §7.2 (EC-console-1/2/3) — the three previously
  // SILENT catch blocks now log the real error via console.error, on top
  // of the existing i18n message (already covered above). Each of these
  // failure paths gets its OWN spy/assertion so an anti-vacuity injection
  // on one catch cannot accidentally be masked by another.
  it('EC-console-1 — PDF failure logs the real error via console.error, i18n message still shows', async () => {
    const boom = new Error('rasterization failed')
    html2canvasMock.mockRejectedValueOnce(boom)
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {})
    const user = userEvent.setup()
    await renderWithProviders(
      <ExportReportControls report={report()} property={PROPERTY} />,
    )

    await user.click(screen.getByRole('button', { name: 'Descarcă PDF' }))

    expect(consoleErrorSpy).toHaveBeenCalledWith(boom)
    expect(
      await screen.findByText(
        'PDF-ul nu a putut fi generat. Încearcă din nou.',
      ),
    ).toBeVisible()
    consoleErrorSpy.mockRestore()
  })

  it('EC-console-2 — PNG failure logs the real error via console.error, i18n message still shows', async () => {
    const boom = new Error('rasterization failed')
    html2canvasMock.mockRejectedValueOnce(boom)
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {})
    const user = userEvent.setup()
    await renderWithProviders(
      <ExportReportControls report={report()} property={PROPERTY} />,
    )

    await user.click(screen.getByRole('button', { name: 'Descarcă PNG' }))

    expect(consoleErrorSpy).toHaveBeenCalledWith(boom)
    expect(
      await screen.findByText(
        'Imaginea nu a putut fi generată. Încearcă din nou.',
      ),
    ).toBeVisible()
    consoleErrorSpy.mockRestore()
  })

  it('EC-console-3 — copy-link failure logs the real error via console.error, i18n message still shows', async () => {
    const boom = new Error('token write failed')
    useShareReport.mockReturnValue({
      mutateAsync: vi.fn().mockRejectedValue(boom),
      isPending: false,
    })
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {})
    const user = userEvent.setup()
    await renderWithProviders(
      <ExportReportControls report={report()} property={PROPERTY} />,
    )

    await user.click(
      screen.getByRole('button', { name: 'Copiază link partajabil' }),
    )

    expect(consoleErrorSpy).toHaveBeenCalledWith(boom)
    expect(
      await screen.findByText(
        'Linkul nu a putut fi generat. Încearcă din nou.',
      ),
    ).toBeVisible()
    consoleErrorSpy.mockRestore()
  })
})
