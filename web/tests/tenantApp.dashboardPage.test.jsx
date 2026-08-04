import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithProviders } from './renderWithProviders'
import { useAuth } from '@/features/auth/useAuth'
import { useMySignedReports, useMyTenancy } from '@/features/tenantApp/hooks'
import { TenantDashboardPage } from '@/features/tenantApp/pages/TenantDashboardPage'

// Fast band — `useAuth` and the sub-stage 2 hooks are mocked at the module
// boundary (new convention for this file: no prior test mocks `useAuth`).
// `ReportSummaryView`, `PaymentStatusBadge`, and `adaptTenantReportSummary`
// are rendered/run for REAL — same reasoning as sub-stage 2's A5: proving
// the real pipeline agrees with itself, not just that each piece matches
// its own mock.

vi.mock('@/features/auth/useAuth', () => ({ useAuth: vi.fn() }))
vi.mock('@/features/tenantApp/hooks', () => ({
  useMyTenancy: vi.fn(),
  useMySignedReports: vi.fn(),
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
    status: 'active',
    property: { name: 'Apartament Test' },
    ...overrides,
  }
}

function reportFixture(overrides = {}) {
  return {
    id: 'report-1',
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
    ...overrides,
  }
}

function query(overrides = {}) {
  return { isPending: false, isError: false, data: undefined, ...overrides }
}

beforeEach(() => {
  vi.clearAllMocks()
  useAuth.mockReturnValue({ user: { uid: 'tenant-1' } })
})

describe('TenantDashboardPage', () => {
  it('D1 — both queries pending shows loading, nothing else', async () => {
    useMyTenancy.mockReturnValue(query({ isPending: true }))
    useMySignedReports.mockReturnValue(query({ isPending: true }))

    await renderWithProviders(<TenantDashboardPage />)

    expect(screen.getByText('Se încarcă...')).toBeVisible()
    expect(screen.queryByText('Chirie')).not.toBeInTheDocument()
  })

  it('D2 — either query in error shows the error message', async () => {
    useMyTenancy.mockReturnValue(query({ isError: true }))
    useMySignedReports.mockReturnValue(query({ data: [] }))

    await renderWithProviders(<TenantDashboardPage />)

    expect(
      screen.getByText('Nu am putut încărca panoul tău. Încearcă din nou.'),
    ).toBeVisible()
  })

  it('D3 — no tenancy at all shows the noTenancy message, ReportSummaryView is NOT rendered', async () => {
    useMyTenancy.mockReturnValue(query({ data: null }))
    useMySignedReports.mockReturnValue(query({ data: [] }))

    await renderWithProviders(<TenantDashboardPage />)

    expect(
      screen.getByText('Nu ai nicio locuință atribuită momentan.'),
    ).toBeVisible()
    expect(screen.queryByText('Chirie')).not.toBeInTheDocument()
  })

  it('D4 — tenancy resolved, no signed reports shows the empty message', async () => {
    useMyTenancy.mockReturnValue(query({ data: tenancyFixture() }))
    useMySignedReports.mockReturnValue(query({ data: [] }))

    await renderWithProviders(<TenantDashboardPage />)

    expect(
      screen.getByText('Niciun raport nu a fost publicat încă.'),
    ).toBeVisible()
  })

  it("D5 — normal render: prominent month, page's OWN header shows the property name, a cost-line amount reaches ReportSummaryView, no ended-label", async () => {
    useMyTenancy.mockReturnValue(query({ data: tenancyFixture() }))
    useMySignedReports.mockReturnValue(query({ data: [reportFixture()] }))

    await renderWithProviders(<TenantDashboardPage />)

    expect(screen.getByText('iulie 2026')).toBeVisible()
    expect(screen.getByText('Apartament Test')).toBeVisible()
    // rent (2500) AND finalTotal (2500, since maintenance is 0) both render
    // this text — legitimate, not a duplicate bug (same as
    // reportSummaryView.test.jsx's own note).
    expect(screen.getAllByText('2.500,00 lei').length).toBeGreaterThanOrEqual(1)
    expect(
      screen.queryByText('Ultima lună a contractului'),
    ).not.toBeInTheDocument()
  })

  it('D6 — ended tenancy shows the ended-label', async () => {
    useMyTenancy.mockReturnValue(
      query({ data: tenancyFixture({ status: 'ended' }) }),
    )
    useMySignedReports.mockReturnValue(query({ data: [reportFixture()] }))

    await renderWithProviders(<TenantDashboardPage />)

    expect(screen.getByText('Ultima lună a contractului')).toBeVisible()
  })

  it("D7 — PaymentStatusBadge receives the report's OWN paymentStatus, not a hardcoded value", async () => {
    useMyTenancy.mockReturnValue(query({ data: tenancyFixture() }))
    useMySignedReports.mockReturnValue(
      query({ data: [reportFixture({ paymentStatus: 'partial' })] }),
    )

    await renderWithProviders(<TenantDashboardPage />)

    expect(screen.getByText('Parțial achitat')).toBeVisible()
  })

  it('D8 — trusts reports[0] as "the most recent" WITHOUT re-deriving it', async () => {
    useMyTenancy.mockReturnValue(query({ data: tenancyFixture() }))
    useMySignedReports.mockReturnValue(
      query({
        data: [
          reportFixture({
            id: 'report-first',
            finalTotal: 1000,
            rent: { amount: 1000, notes: '', attachments: [] },
          }),
          reportFixture({
            id: 'report-second',
            finalTotal: 9000,
            rent: { amount: 9000, notes: '', attachments: [] },
          }),
        ],
      }),
    )

    await renderWithProviders(<TenantDashboardPage />)

    // rent (1000) AND finalTotal (1000) both render this text — legitimate,
    // same reasoning as D5 above.
    expect(screen.getAllByText('1.000,00 lei').length).toBeGreaterThanOrEqual(1)
    expect(screen.queryByText('9.000,00 lei')).not.toBeInTheDocument()
  })

  // M5 sub-stage 8 plan, §7.5 (DASH-PDF-1/2).
  it('DASH-PDF-1 — "Descarcă PDF" renders when a report exists', async () => {
    useMyTenancy.mockReturnValue(query({ data: tenancyFixture() }))
    useMySignedReports.mockReturnValue(query({ data: [reportFixture()] }))

    await renderWithProviders(<TenantDashboardPage />)

    expect(screen.getByRole('button', { name: 'Descarcă PDF' })).toBeVisible()
  })

  it('DASH-PDF-2 — absent in loading/error/no-tenancy/empty states', async () => {
    useMyTenancy.mockReturnValue(query({ isPending: true }))
    useMySignedReports.mockReturnValue(query({ isPending: true }))
    const { rerender } = await renderWithProviders(<TenantDashboardPage />)
    expect(
      screen.queryByRole('button', { name: 'Descarcă PDF' }),
    ).not.toBeInTheDocument()

    useMyTenancy.mockReturnValue(query({ isError: true }))
    useMySignedReports.mockReturnValue(query({ data: [] }))
    rerender(<TenantDashboardPage />)
    expect(
      screen.queryByRole('button', { name: 'Descarcă PDF' }),
    ).not.toBeInTheDocument()

    useMyTenancy.mockReturnValue(query({ data: null }))
    useMySignedReports.mockReturnValue(query({ data: [] }))
    rerender(<TenantDashboardPage />)
    expect(
      screen.queryByRole('button', { name: 'Descarcă PDF' }),
    ).not.toBeInTheDocument()

    useMyTenancy.mockReturnValue(query({ data: tenancyFixture() }))
    useMySignedReports.mockReturnValue(query({ data: [] }))
    rerender(<TenantDashboardPage />)
    expect(
      screen.queryByRole('button', { name: 'Descarcă PDF' }),
    ).not.toBeInTheDocument()
  })

  // Audit gate — §5.4 requires "(view/download)" for /app's own attachments;
  // ReportSummaryView's badges are view-only. Mirrors TenantReportDetailPage's
  // own attachments section (RD6's precedent) exactly, on this page instead.
  it('D-ATTACH-1 — attachments across all four cost-line types render as downloadable links', async () => {
    useMyTenancy.mockReturnValue(query({ data: tenancyFixture() }))
    useMySignedReports.mockReturnValue(
      query({
        data: [
          reportFixture({
            rent: {
              amount: 2500,
              notes: '',
              attachments: [
                {
                  url: 'https://storage.example/rent-invoice.pdf',
                  name: 'rent-invoice.pdf',
                  type: 'pdf',
                },
              ],
            },
            maintenance: {
              amount: 50,
              notes: '',
              attachments: [
                {
                  url: 'https://storage.example/maintenance-invoice.pdf',
                  name: 'maintenance-invoice.pdf',
                  type: 'pdf',
                },
              ],
            },
            serviceCosts: [
              {
                serviceId: 'electricity',
                name: 'Electricitate',
                amount: 150,
                notes: '',
                attachments: [
                  {
                    url: 'https://storage.example/electricity-invoice.jpg',
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
                    url: 'https://storage.example/other-invoice.pdf',
                    name: 'other-invoice.pdf',
                    type: 'pdf',
                  },
                ],
              },
            ],
          }),
        ],
      }),
    )

    await renderWithProviders(<TenantDashboardPage />)

    expect(
      screen.getByRole('link', { name: /rent-invoice\.pdf/ }),
    ).toHaveAttribute('href', 'https://storage.example/rent-invoice.pdf')
    expect(
      screen.getByRole('link', { name: /maintenance-invoice\.pdf/ }),
    ).toHaveAttribute('href', 'https://storage.example/maintenance-invoice.pdf')
    expect(
      screen.getByRole('link', { name: /electricity-invoice\.jpg/ }),
    ).toHaveAttribute('href', 'https://storage.example/electricity-invoice.jpg')
    expect(
      screen.getByRole('link', { name: /other-invoice\.pdf/ }),
    ).toHaveAttribute('href', 'https://storage.example/other-invoice.pdf')
  })

  it('D-ATTACH-2 — zero attachments anywhere means the attachments section is NOT rendered', async () => {
    useMyTenancy.mockReturnValue(query({ data: tenancyFixture() }))
    useMySignedReports.mockReturnValue(query({ data: [reportFixture()] }))

    await renderWithProviders(<TenantDashboardPage />)

    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })
})
