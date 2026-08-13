import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from './renderWithProviders'
import { useAuth } from '@/features/auth/useAuth'
import { useMyTenancy, useTenantReport } from '@/features/tenantApp/hooks'
import { TenantReportDetailPage } from '@/features/tenantApp/pages/TenantReportDetailPage'

// M5 sub-stage 6 plan (docs/superpowers/plans/2026-08-03-m5-substage6-report-detail.md,
// Task 3). Fast band — `useAuth`, `useMyTenancy`, `useTenantReport` mocked at
// the module boundary, same convention as sub-stage 5's page tests.
// `adaptTenantReportSummary` and `ReportSummaryView` are run/rendered for
// REAL — proving the real pipeline agrees with itself.

vi.mock('@/features/auth/useAuth', () => ({ useAuth: vi.fn() }))
vi.mock('@/features/tenantApp/hooks', () => ({
  useMyTenancy: vi.fn(),
  useTenantReport: vi.fn(),
}))
// `AttachmentLink` (debt #5) resolves `path` -> url via `useAttachmentUrl` —
// mocked at this boundary, same convention as tenantApp.dashboardPage.test.jsx.
vi.mock('@/lib/useAttachmentUrl', () => ({ useAttachmentUrl: vi.fn() }))

import { useAttachmentUrl } from '@/lib/useAttachmentUrl'

// PARTIAL mock: same convention `sharedReport.page.test.jsx` already uses
// for `shareToken` — `renderWithProviders` mounts a real MemoryRouter, so
// only `useParams` is swapped out.
vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal()),
  useParams: () => ({ reportId: 'report-1' }),
}))
// M5 sub-stage 8 plan — the page now mounts the REAL DownloadReportPdfButton
// + REAL useReportSummaryCapture hook (this file's own convention: render
// the real pipeline, not a mock of it), so the underlying rasterization
// libraries are mocked here, same precedent as reports.page.test.jsx.
vi.mock('jspdf', () => ({ jsPDF: vi.fn(function jsPDFMock() {}) }))
vi.mock('html2canvas-pro', () => ({ default: vi.fn() }))

function tenancyFixture(overrides = {}) {
  return {
    id: 'tenancy-1',
    property: { name: 'Apartament Zorilor' },
    ...overrides,
  }
}

function costLine(overrides = {}) {
  return { amount: 0, notes: '', attachments: [], ...overrides }
}

function reportFixture(overrides = {}) {
  return {
    id: 'report-1',
    month: 7,
    year: 2026,
    rent: costLine({ amount: 2500 }),
    maintenance: costLine(),
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

function query(overrides = {}) {
  return { isPending: false, isError: false, data: undefined, ...overrides }
}

beforeEach(() => {
  vi.clearAllMocks()
  useAuth.mockReturnValue({ user: { uid: 'tenant-1' } })
  useAttachmentUrl.mockImplementation((path) => ({
    url: path ? `https://storage.example/resolved/${path}` : undefined,
    isLoading: false,
    isError: false,
  }))
})

describe('TenantReportDetailPage', () => {
  it('RD1 — either query pending shows loading, nothing else', async () => {
    useMyTenancy.mockReturnValue(query({ isPending: true }))
    useTenantReport.mockReturnValue(query({ isPending: true }))

    await renderWithProviders(<TenantReportDetailPage />)

    expect(screen.getByText('Se încarcă...')).toBeVisible()
    expect(screen.queryByText('Total calculat')).not.toBeInTheDocument()
  })

  it('RD2 — either query in error shows the error message', async () => {
    useMyTenancy.mockReturnValue(query({ isError: true }))
    useTenantReport.mockReturnValue(query({ data: reportFixture() }))

    await renderWithProviders(<TenantReportDetailPage />)

    expect(
      screen.getByText('Nu am putut încărca acest raport. Încearcă din nou.'),
    ).toBeVisible()
  })

  it('clicking Retry re-runs both source queries', async () => {
    const tenancyRefetch = vi.fn()
    const reportRefetch = vi.fn()
    useMyTenancy.mockReturnValue(
      query({ isError: true, isFetching: false, refetch: tenancyRefetch }),
    )
    useTenantReport.mockReturnValue(
      query({
        data: reportFixture(),
        isFetching: false,
        refetch: reportRefetch,
      }),
    )
    const user = userEvent.setup()
    await renderWithProviders(<TenantReportDetailPage />)

    await user.click(screen.getByRole('button', { name: 'Încearcă din nou' }))

    expect(tenancyRefetch).toHaveBeenCalledTimes(1)
    expect(reportRefetch).toHaveBeenCalledTimes(1)
  })

  it("RD3 — report resolves to null shows notFound AND a link back to /app/history (does not re-prove the hook's own null-collapse, cited B6-B8)", async () => {
    useMyTenancy.mockReturnValue(query({ data: tenancyFixture() }))
    useTenantReport.mockReturnValue(query({ data: null }))

    await renderWithProviders(<TenantReportDetailPage />)

    expect(screen.getByText('Acest raport nu a putut fi găsit.')).toBeVisible()
    expect(
      screen.getByRole('link', { name: 'Înapoi la istoric' }),
    ).toHaveAttribute('href', '/app/history')
  })

  it('RD4 — valid report renders the calculatedTotal row (proves the PAGE wires showCalculatedTotal, cited reportSummaryView.test.jsx C3)', async () => {
    useMyTenancy.mockReturnValue(query({ data: tenancyFixture() }))
    useTenantReport.mockReturnValue(query({ data: reportFixture() }))

    await renderWithProviders(<TenantReportDetailPage />)

    expect(screen.getByText('Total calculat')).toBeVisible()
  })

  it("RD5 — propertyName reaching ReportSummaryView comes from the MOCKED tenancy's property.name", async () => {
    useMyTenancy.mockReturnValue(
      query({
        data: tenancyFixture({ property: { name: 'Vila Neobișnuită' } }),
      }),
    )
    useTenantReport.mockReturnValue(query({ data: reportFixture() }))

    await renderWithProviders(<TenantReportDetailPage />)

    expect(screen.getByText('Vila Neobișnuită')).toBeVisible()
  })

  it('RD6 — the attachments section lists every attachment across all four line types', async () => {
    useMyTenancy.mockReturnValue(query({ data: tenancyFixture() }))
    useTenantReport.mockReturnValue(
      query({
        data: reportFixture({
          rent: costLine({
            amount: 2500,
            attachments: [
              {
                path: 'reports/r1/invoices/rent-invoice.pdf',
                name: 'rent-invoice.pdf',
                type: 'pdf',
              },
            ],
          }),
          maintenance: costLine({
            amount: 50,
            attachments: [
              {
                path: 'reports/r1/invoices/maintenance-invoice.pdf',
                name: 'maintenance-invoice.pdf',
                type: 'pdf',
              },
            ],
          }),
          serviceCosts: [
            {
              serviceId: 'electricity',
              name: 'Electricitate',
              amount: 150,
              notes: '',
              attachments: [
                {
                  path: 'reports/r1/invoices/electricity-invoice.jpg',
                  name: 'electricity-invoice.jpg',
                  type: 'image',
                },
              ],
            },
          ],
          otherExpenses: [
            {
              description: 'Reparație',
              amount: 30,
              notes: '',
              attachments: [
                {
                  path: 'reports/r1/invoices/other-invoice.pdf',
                  name: 'other-invoice.pdf',
                  type: 'pdf',
                },
              ],
            },
          ],
        }),
      }),
    )

    await renderWithProviders(<TenantReportDetailPage />)

    // Scoped to LINKS specifically — `ReportSummaryView`'s own inline
    // badges (always rendered, regardless of this page's own section) are
    // plain, non-clickable `<span>`s, never `<a>`s. Asserting `getAllByText`
    // here would pass even if this page's OWN `collectAttachments` dropped
    // every one of these four lines, since the inert badges alone would
    // still satisfy it — exactly the vacuous shape to avoid.
    expect(
      screen.getByRole('link', { name: /rent-invoice\.pdf/ }),
    ).toBeVisible()
    expect(
      screen.getByRole('link', { name: /maintenance-invoice\.pdf/ }),
    ).toBeVisible()
    expect(
      screen.getByRole('link', { name: /electricity-invoice\.jpg/ }),
    ).toBeVisible()
    expect(
      screen.getByRole('link', { name: /other-invoice\.pdf/ }),
    ).toBeVisible()
  })

  it('RD7 — zero attachments anywhere means the attachments section (its heading) is NOT rendered', async () => {
    useMyTenancy.mockReturnValue(query({ data: tenancyFixture() }))
    useTenantReport.mockReturnValue(query({ data: reportFixture() }))

    await renderWithProviders(<TenantReportDetailPage />)

    expect(screen.queryByText('Atașamente')).not.toBeInTheDocument()
  })

  it("RD8 — a given attachment's name appears TWICE: ReportSummaryView's own inert badge, and THIS page's own downloadable link (href resolved from att.path)", async () => {
    useMyTenancy.mockReturnValue(query({ data: tenancyFixture() }))
    useTenantReport.mockReturnValue(
      query({
        data: reportFixture({
          rent: costLine({
            amount: 2500,
            attachments: [
              {
                path: 'reports/r1/invoices/rent-invoice.pdf',
                name: 'rent-invoice.pdf',
                type: 'pdf',
              },
            ],
          }),
        }),
      }),
    )

    await renderWithProviders(<TenantReportDetailPage />)

    const occurrences = screen.getAllByText(/rent-invoice\.pdf/)
    expect(occurrences).toHaveLength(2)

    const downloadLink = screen.getByRole('link', { name: /rent-invoice\.pdf/ })
    expect(downloadLink).toHaveAttribute(
      'href',
      'https://storage.example/resolved/reports/r1/invoices/rent-invoice.pdf',
    )
  })

  it('RD10 — an attachment whose URL fails to resolve (Storage rule denial) renders inert "unavailable" text, never a clickable dead link', async () => {
    useAttachmentUrl.mockReturnValue({
      url: undefined,
      isLoading: false,
      isError: true,
    })
    useMyTenancy.mockReturnValue(query({ data: tenancyFixture() }))
    useTenantReport.mockReturnValue(
      query({
        data: reportFixture({
          rent: costLine({
            amount: 2500,
            attachments: [
              {
                path: 'reports/r1/invoices/rent-invoice.pdf',
                name: 'rent-invoice.pdf',
                type: 'pdf',
              },
            ],
          }),
        }),
      }),
    )

    await renderWithProviders(<TenantReportDetailPage />)

    expect(screen.getByText(/Indisponibil/)).toBeInTheDocument()
    expect(
      screen.queryByRole('link', { name: /rent-invoice\.pdf/ }),
    ).not.toBeInTheDocument()
  })

  it('RD9 — the back-to-history link is present on the VALID render too, not only on the not-found state', async () => {
    useMyTenancy.mockReturnValue(query({ data: tenancyFixture() }))
    useTenantReport.mockReturnValue(query({ data: reportFixture() }))

    await renderWithProviders(<TenantReportDetailPage />)

    expect(
      screen.getByRole('link', { name: 'Înapoi la istoric' }),
    ).toHaveAttribute('href', '/app/history')
  })

  // M5 sub-stage 8 plan, §7.5 (RD-PDF-1/2).
  it('RD-PDF-1 — "Descarcă PDF" renders alongside the report breakdown', async () => {
    useMyTenancy.mockReturnValue(query({ data: tenancyFixture() }))
    useTenantReport.mockReturnValue(query({ data: reportFixture() }))

    await renderWithProviders(<TenantReportDetailPage />)

    expect(screen.getByRole('button', { name: 'Descarcă PDF' })).toBeVisible()
  })

  it('RD-PDF-2 — absent in loading/error/not-found states', async () => {
    useMyTenancy.mockReturnValue(query({ isPending: true }))
    useTenantReport.mockReturnValue(query({ isPending: true }))
    const { rerender } = await renderWithProviders(<TenantReportDetailPage />)
    expect(
      screen.queryByRole('button', { name: 'Descarcă PDF' }),
    ).not.toBeInTheDocument()

    useMyTenancy.mockReturnValue(query({ isError: true }))
    useTenantReport.mockReturnValue(query({ data: reportFixture() }))
    rerender(<TenantReportDetailPage />)
    expect(
      screen.queryByRole('button', { name: 'Descarcă PDF' }),
    ).not.toBeInTheDocument()

    useMyTenancy.mockReturnValue(query({ data: tenancyFixture() }))
    useTenantReport.mockReturnValue(query({ data: null }))
    rerender(<TenantReportDetailPage />)
    expect(
      screen.queryByRole('button', { name: 'Descarcă PDF' }),
    ).not.toBeInTheDocument()
  })
})
