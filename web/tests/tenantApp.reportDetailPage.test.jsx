import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
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

// PARTIAL mock: same convention `sharedReport.page.test.jsx` already uses
// for `shareToken` — `renderWithProviders` mounts a real MemoryRouter, so
// only `useParams` is swapped out.
vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal()),
  useParams: () => ({ reportId: 'report-1' }),
}))

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
                url: 'https://storage.example/rent-invoice.pdf',
                name: 'rent-invoice.pdf',
                type: 'pdf',
              },
            ],
          }),
          maintenance: costLine({
            amount: 50,
            attachments: [
              {
                url: 'https://storage.example/maintenance-invoice.pdf',
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

  it("RD8 — a given attachment's name appears TWICE: ReportSummaryView's own inert badge, and THIS page's own downloadable link (href = att.url)", async () => {
    useMyTenancy.mockReturnValue(query({ data: tenancyFixture() }))
    useTenantReport.mockReturnValue(
      query({
        data: reportFixture({
          rent: costLine({
            amount: 2500,
            attachments: [
              {
                url: 'https://storage.example/rent-invoice.pdf',
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
      'https://storage.example/rent-invoice.pdf',
    )
  })

  it('RD9 — the back-to-history link is present on the VALID render too, not only on the not-found state', async () => {
    useMyTenancy.mockReturnValue(query({ data: tenancyFixture() }))
    useTenantReport.mockReturnValue(query({ data: reportFixture() }))

    await renderWithProviders(<TenantReportDetailPage />)

    expect(
      screen.getByRole('link', { name: 'Înapoi la istoric' }),
    ).toHaveAttribute('href', '/app/history')
  })
})
