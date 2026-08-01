import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from './renderWithProviders'
import { SharedReportPage } from '@/features/sharedReport/pages/SharedReportPage'
import {
  useSharedReport,
  useSharedReportAttachment,
} from '@/features/sharedReport/hooks'
import { base64ToBlob, downloadBlob } from '@/lib/blob'

// Fast band — the boundary hooks are mocked, no emulator. The functions
// security band (sharedReport.test.js) already covers what getSharedReport/
// getSharedReportAttachment do; here we check only what the PAGE does:
// loading/report/unavailable states, and the interactive attachment
// download flow.
vi.mock('@/features/sharedReport/hooks', () => ({
  useSharedReport: vi.fn(),
  useSharedReportAttachment: vi.fn(),
}))
vi.mock('@/lib/blob', () => ({
  base64ToBlob: vi.fn(() => 'fake-blob'),
  downloadBlob: vi.fn(),
}))

vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal()),
  useParams: () => ({
    shareToken: 'seed-fixed-share-token-for-dev-testing-only',
  }),
}))

function reportData(overrides = {}) {
  return {
    propertyName: 'Apartament Centru',
    month: 7,
    year: 2026,
    rent: {
      amount: 2500,
      notes: '',
      attachments: [
        { name: 'rent-invoice.pdf', type: 'pdf', reference: 'rent.0' },
      ],
    },
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
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('SharedReportPage', () => {
  it('shows a loading state while the report is pending', async () => {
    useSharedReport.mockReturnValue({
      data: undefined,
      isPending: true,
      isError: false,
    })
    useSharedReportAttachment.mockReturnValue({
      mutateAsync: vi.fn(),
      isPending: false,
    })

    await renderWithProviders(<SharedReportPage />)

    expect(screen.getByText('Se încarcă...')).toBeVisible()
  })

  it('renders the report via ReportSummaryView on success', async () => {
    useSharedReport.mockReturnValue({
      data: reportData(),
      isPending: false,
      isError: false,
    })
    useSharedReportAttachment.mockReturnValue({
      mutateAsync: vi.fn(),
      isPending: false,
    })

    await renderWithProviders(<SharedReportPage />)

    expect(screen.getByText('Apartament Centru')).toBeVisible()
    expect(screen.getAllByText('2.500,00 lei').length).toBeGreaterThanOrEqual(1)
  })

  it('shows the NEUTRAL "unavailable" message on error — never leaks WHY (invalid/revoked/draft all look identical)', async () => {
    useSharedReport.mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
    })
    useSharedReportAttachment.mockReturnValue({
      mutateAsync: vi.fn(),
      isPending: false,
    })

    await renderWithProviders(<SharedReportPage />)

    expect(screen.getByText('Link indisponibil.')).toBeVisible()
  })

  it('lists every attachment with a Download button', async () => {
    useSharedReport.mockReturnValue({
      data: reportData(),
      isPending: false,
      isError: false,
    })
    useSharedReportAttachment.mockReturnValue({
      mutateAsync: vi.fn(),
      isPending: false,
    })

    await renderWithProviders(<SharedReportPage />)

    // Appears twice by design: once inert inside ReportSummaryView's
    // attachment badge, once in the page's own interactive download list.
    expect(screen.getAllByText('rent-invoice.pdf (pdf)').length).toBe(2)
    expect(screen.getByRole('button', { name: 'Descarcă' })).toBeVisible()
  })

  it('clicking Download calls getSharedReportAttachment via the proxy hook, NEVER a Storage URL, then downloads the decoded blob', async () => {
    const mutateAsync = vi
      .fn()
      .mockResolvedValue({ base64: 'YmFzZTY0', contentType: 'application/pdf' })
    useSharedReport.mockReturnValue({
      data: reportData(),
      isPending: false,
      isError: false,
    })
    useSharedReportAttachment.mockReturnValue({ mutateAsync, isPending: false })
    const user = userEvent.setup()

    await renderWithProviders(<SharedReportPage />)
    await user.click(screen.getByRole('button', { name: 'Descarcă' }))

    expect(mutateAsync).toHaveBeenCalledWith({
      shareToken: 'seed-fixed-share-token-for-dev-testing-only',
      reference: 'rent.0',
    })
    expect(base64ToBlob).toHaveBeenCalledWith('YmFzZTY0', 'application/pdf')
    expect(downloadBlob).toHaveBeenCalledWith('fake-blob', 'rent-invoice.pdf')
  })

  it('shows an error message if the attachment download fails, without crashing the page', async () => {
    const mutateAsync = vi.fn().mockRejectedValue(new Error('not-found'))
    useSharedReport.mockReturnValue({
      data: reportData(),
      isPending: false,
      isError: false,
    })
    useSharedReportAttachment.mockReturnValue({ mutateAsync, isPending: false })
    const user = userEvent.setup()

    await renderWithProviders(<SharedReportPage />)
    await user.click(screen.getByRole('button', { name: 'Descarcă' }))

    expect(
      await screen.findByText(
        'Fișierul nu a putut fi descărcat. Încearcă din nou.',
      ),
    ).toBeVisible()
  })

  it('renders no Attachments section when the report has none', async () => {
    useSharedReport.mockReturnValue({
      data: reportData({ rent: { amount: 2500, notes: '', attachments: [] } }),
      isPending: false,
      isError: false,
    })
    useSharedReportAttachment.mockReturnValue({
      mutateAsync: vi.fn(),
      isPending: false,
    })

    await renderWithProviders(<SharedReportPage />)

    expect(screen.queryByText('Atașamente')).not.toBeInTheDocument()
  })
})
