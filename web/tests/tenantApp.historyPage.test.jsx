import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from './renderWithProviders'
import { useAuth } from '@/features/auth/useAuth'
import { useMyTenancy, useMySignedReports } from '@/features/tenantApp/hooks'
import { TenantHistoryPage } from '@/features/tenantApp/pages/TenantHistoryPage'

// Fast band — `useAuth` and the sub-stage 2 hooks are mocked at the module
// boundary, same convention as `tenantApp.dashboardPage.test.jsx`.
// `groupReportsByYear`, `ReportHistoryRow`, `PaymentStatusBadge`, and the
// real `Accordion` primitive are rendered/run for REAL — proving the real
// pipeline agrees with itself (sub-stage 2's A5 / sub-stage 3's D-series).

vi.mock('@/features/auth/useAuth', () => ({ useAuth: vi.fn() }))
vi.mock('@/features/tenantApp/hooks', () => ({
  useMyTenancy: vi.fn(),
  useMySignedReports: vi.fn(),
}))

// PARTIAL mock: `renderWithProviders` mounts a real MemoryRouter, so
// replacing the whole module would take the router down with it (same
// pattern as `properties.createPage.test.jsx`). HP7 asserts this spy is
// NEVER called — rows are deliberately non-interactive this sub-stage
// (M5 sub-stage 5 plan, Decision 3).
const navigate = vi.fn()
vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal()),
  useNavigate: () => navigate,
}))

function tenancyFixture(overrides = {}) {
  return { id: 'tenancy-1', status: 'active', ...overrides }
}

function report(overrides = {}) {
  return {
    id: 'r',
    month: 1,
    year: 2026,
    finalTotal: 0,
    amountPaid: null,
    paymentStatus: null,
    ...overrides,
  }
}

function query(overrides = {}) {
  return { isPending: false, isError: false, data: undefined, ...overrides }
}

// Seed-realistic fixture (M5 sub-stage 4 plan's chirias@test.ro chain),
// already in the hook's own sorted order (newest year, newest month first).
const SEED_REPORTS = [
  report({ id: 'jul', month: 7, year: 2026, finalTotal: 2730 }), // amountPaid/paymentStatus absent — never-touched shape
  report({
    id: 'may',
    month: 5,
    year: 2026,
    finalTotal: 5460,
    amountPaid: 5460,
    paymentStatus: 'paid',
  }),
  report({
    id: 'feb',
    month: 2,
    year: 2026,
    finalTotal: 2730,
    amountPaid: null,
    paymentStatus: 'unpaid',
  }),
  report({
    id: 'jan',
    month: 1,
    year: 2026,
    finalTotal: 3460,
    amountPaid: 3460,
    paymentStatus: 'paid',
  }),
  report({
    id: 'dec',
    month: 12,
    year: 2025,
    finalTotal: 2730,
    amountPaid: 2000,
    paymentStatus: 'partial',
  }),
  report({
    id: 'nov',
    month: 11,
    year: 2025,
    finalTotal: 2730,
    amountPaid: 2730,
    paymentStatus: 'paid',
  }),
]

beforeEach(() => {
  vi.clearAllMocks()
  useAuth.mockReturnValue({ user: { uid: 'tenant-1' } })
})

describe('TenantHistoryPage', () => {
  it('HP1 — both queries pending shows loading, nothing else', async () => {
    useMyTenancy.mockReturnValue(query({ isPending: true }))
    useMySignedReports.mockReturnValue(query({ isPending: true }))

    await renderWithProviders(<TenantHistoryPage />)

    expect(screen.getByText('Se încarcă...')).toBeVisible()
    expect(screen.queryByText('2026')).not.toBeInTheDocument()
  })

  it('HP2 — either query in error shows the error message', async () => {
    useMyTenancy.mockReturnValue(query({ isError: true }))
    useMySignedReports.mockReturnValue(query({ data: [] }))

    await renderWithProviders(<TenantHistoryPage />)

    expect(
      screen.getByText(
        'Nu am putut încărca istoricul rapoartelor tale. Încearcă din nou.',
      ),
    ).toBeVisible()
  })

  it('HP3 — no tenancy at all shows the noTenancy message, no accordion', async () => {
    useMyTenancy.mockReturnValue(query({ data: null }))
    useMySignedReports.mockReturnValue(query({ data: [] }))

    await renderWithProviders(<TenantHistoryPage />)

    expect(
      screen.getByText('Nu ai nicio locuință atribuită momentan.'),
    ).toBeVisible()
    expect(screen.queryByText('2026')).not.toBeInTheDocument()
  })

  it('HP4 — tenancy resolved, zero reports shows the empty message, no accordion', async () => {
    useMyTenancy.mockReturnValue(query({ data: tenancyFixture() }))
    useMySignedReports.mockReturnValue(query({ data: [] }))

    await renderWithProviders(<TenantHistoryPage />)

    expect(
      screen.getByText('Nu ai încă niciun istoric de rapoarte.'),
    ).toBeVisible()
    expect(screen.queryByText('2026')).not.toBeInTheDocument()
  })

  it('HP5 — normal render: both year triggers present, all years collapsed by default', async () => {
    useMyTenancy.mockReturnValue(query({ data: tenancyFixture() }))
    useMySignedReports.mockReturnValue(query({ data: SEED_REPORTS }))

    await renderWithProviders(<TenantHistoryPage />)

    expect(screen.getByText('2026')).toBeVisible()
    expect(screen.getByText('2025')).toBeVisible()
    // Collapsed: no row content (a specific amount) visible yet. "5.460,00
    // lei" legitimately appears TWICE once expanded (May's finalTotal AND
    // amountPaid are both 5460, a paid-in-full row — same non-bug precedent
    // `tenantApp.dashboardPage.test.jsx`'s D5/D8 already document), so this
    // asserts the count is exactly zero while collapsed, not just "not one".
    expect(screen.queryAllByText('5.460,00 lei')).toHaveLength(0)
    expect(screen.queryByText('2.000,00 lei')).not.toBeInTheDocument()
  })

  it('HP6 — clicking the "2026" trigger expands it; "2025" stays hidden', async () => {
    useMyTenancy.mockReturnValue(query({ data: tenancyFixture() }))
    useMySignedReports.mockReturnValue(query({ data: SEED_REPORTS }))
    const user = userEvent.setup()

    await renderWithProviders(<TenantHistoryPage />)
    await user.click(screen.getByText('2026'))

    // May 2026's finalTotal AND amountPaid are both 5460 (paid in full) —
    // both cells legitimately render this text once expanded.
    expect(screen.queryAllByText('5.460,00 lei')).toHaveLength(2)
    expect(screen.queryByText('2.000,00 lei')).not.toBeInTheDocument() // Dec 2025, still collapsed
  })

  it('HP7 — rows are non-interactive: no link/button wraps a row, clicking one fires no navigation', async () => {
    useMyTenancy.mockReturnValue(query({ data: tenancyFixture() }))
    useMySignedReports.mockReturnValue(query({ data: SEED_REPORTS }))
    const user = userEvent.setup()

    await renderWithProviders(<TenantHistoryPage />)
    await user.click(screen.getByText('2026'))

    expect(screen.queryAllByRole('link')).toHaveLength(0)

    await user.click(screen.getAllByText('5.460,00 lei')[0])

    expect(navigate).not.toHaveBeenCalled()
  })
})
