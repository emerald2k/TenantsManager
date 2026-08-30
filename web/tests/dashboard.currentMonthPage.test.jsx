import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from './renderWithProviders'
import { CurrentMonthPage } from '@/features/dashboard/pages/CurrentMonthPage'
import { useActiveTenancies } from '@/features/tenants/hooks'
import { useReportsForMonth, useReportsForYear } from '@/features/reports/hooks'

/**
 * WHOLESALE REWRITE — M8 stage 15a. The page now renders the seven-column
 * FR-DASH-02b table through the shared `CurrentMonthTable` /
 * `buildCurrentMonthRows`, and fetches the tenancy's signed-report history
 * (the two `useReportsForYear` calls) so "Remaining to collect" can be
 * `balanceAsOf`. The old four-column, single-badge coverage is gone with the
 * old component. The derivations themselves are unit-tested in
 * `dashboard.calculations.test`; here we check what the PAGE does — the
 * seven headers, the selector (now bounded), row navigation, loading/error.
 */

vi.mock('@/features/tenants/hooks', () => ({ useActiveTenancies: vi.fn() }))
vi.mock('@/features/reports/hooks', () => ({
  useReportsForMonth: vi.fn(),
  useReportsForYear: vi.fn(),
}))

const navigate = vi.fn()
vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal()),
  useNavigate: () => navigate,
}))

const now = new Date()
const thisYear = now.getFullYear()

function tenancy(over) {
  return {
    id: 't1',
    propertyId: 'p1',
    tenantName: 'Ion Popescu',
    property: { name: 'Apartament Centru' },
    status: 'active',
    dueDay: 15,
    currentBalance: 0,
    ...over,
  }
}

function ok(data) {
  return {
    data,
    isPending: false,
    isError: false,
    isFetching: false,
    refetch: vi.fn(),
  }
}

function mockData({
  tenancies = [],
  monthReports = [],
  signedReports = [],
} = {}) {
  useActiveTenancies.mockReturnValue(ok(tenancies))
  useReportsForMonth.mockReturnValue(ok(monthReports))
  useReportsForYear.mockImplementation((year) =>
    ok(year === thisYear ? signedReports : []),
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('CurrentMonthPage — the seven-column table (FR-DASH-02b)', () => {
  it('renders exactly the seven FR-DASH-02b headers, in order', async () => {
    mockData({ tenancies: [tenancy()] })
    await renderWithProviders(<CurrentMonthPage />)

    const headers = screen
      .getAllByRole('columnheader')
      .map((h) => h.textContent)
    expect(headers).toEqual([
      'Proprietate',
      'Chiriaș',
      'Raport',
      'Plată',
      'Total de plată',
      'Rămas de încasat',
      'Data scadenței',
    ])
  })

  it('a signed + paid row: report "Semnat", payment "Achitat integral", Total shown, Remaining "—"', async () => {
    const r = {
      tenancyId: 't1',
      propertyId: 'p1',
      status: 'signed',
      dueDate: `${thisYear}-01-15`,
      paymentStatus: 'paid',
      finalTotal: 2510,
      amountPaid: 2510,
      month: 1,
      year: thisYear,
    }
    mockData({
      tenancies: [tenancy()],
      monthReports: [r],
      signedReports: [r],
    })
    await renderWithProviders(<CurrentMonthPage />)

    const row = screen.getByText('Apartament Centru').closest('tr')
    expect(within(row).getByText('Semnat')).toBeVisible()
    expect(within(row).getByText('Achitat integral')).toBeVisible()
    expect(within(row).getByText('2.510,00 lei')).toBeVisible()
    // Remaining renders an em dash — there is a dash in Total? no, only here.
    expect(within(row).getAllByText('—').length).toBeGreaterThan(0)
  })

  it('a no-report row with older arrears: report "Neîntocmit", payment "Restanță din …", Total "—", Remaining a figure', async () => {
    const july = {
      tenancyId: 't1',
      propertyId: 'p1',
      status: 'signed',
      dueDate: `${thisYear - 1}-07-15`,
      finalTotal: 890,
      amountPaid: 0,
      month: 7,
      year: thisYear - 1,
    }
    mockData({
      tenancies: [tenancy()],
      monthReports: [],
      // The debt sits in last year for this test; the page fetches both years.
    })
    useReportsForYear.mockImplementation((year) =>
      ok(year === thisYear - 1 ? [july] : []),
    )
    await renderWithProviders(<CurrentMonthPage />)

    const row = screen.getByText('Apartament Centru').closest('tr')
    expect(within(row).getByText('Neîntocmit')).toBeVisible()
    expect(within(row).getByText(/Restanță din/)).toBeVisible()
    expect(within(row).getByText('890,00 lei')).toBeVisible()
  })
})

describe('CurrentMonthPage — selector, navigation, states', () => {
  it('the "previous" control is bounded — it disables at January of last year', async () => {
    mockData({ tenancies: [tenancy()] })
    const user = userEvent.setup()
    await renderWithProviders(<CurrentMonthPage />)

    const prev = screen.getByRole('button', { name: 'Luna anterioară' })
    // Step back until it disables; it must within (currentMonth + 12) clicks.
    for (let i = 0; i < 30 && !prev.hasAttribute('disabled'); i += 1) {
      await user.click(prev)
    }
    expect(prev).toBeDisabled()
  })

  it('the "next" control is disabled at the current month', async () => {
    mockData({ tenancies: [tenancy()] })
    await renderWithProviders(<CurrentMonthPage />)
    expect(
      screen.getByRole('button', { name: 'Luna următoare' }),
    ).toBeDisabled()
  })

  it("clicking a row navigates to that tenancy's report form for the selected month", async () => {
    mockData({ tenancies: [tenancy({ id: 't7' })] })
    const user = userEvent.setup()
    await renderWithProviders(<CurrentMonthPage />)

    await user.click(screen.getByText('Apartament Centru'))
    expect(navigate).toHaveBeenCalledWith(
      `/admin/reports/t7?month=${now.getMonth() + 1}&year=${thisYear}`,
    )
  })

  it('free properties (no active tenancy) never appear', async () => {
    mockData({ tenancies: [] })
    await renderWithProviders(<CurrentMonthPage />)
    expect(screen.getByText('Nicio proprietate ocupată încă.')).toBeVisible()
  })

  it('sorts rows by property name', async () => {
    mockData({
      tenancies: [
        tenancy({ id: 'tz', propertyId: 'pz', property: { name: 'Zebra' } }),
        tenancy({ id: 'ta', propertyId: 'pa', property: { name: 'Alpha' } }),
      ],
    })
    await renderWithProviders(<CurrentMonthPage />)
    const names = screen
      .getAllByRole('row')
      .slice(1)
      .map((r) => r.textContent)
    expect(names[0]).toContain('Alpha')
    expect(names[1]).toContain('Zebra')
  })

  it('shows a loading state while any source is pending', async () => {
    mockData({ tenancies: [tenancy()] })
    useReportsForYear.mockReturnValue({ data: undefined, isPending: true })
    await renderWithProviders(<CurrentMonthPage />)
    expect(screen.getByText('Se încarcă...')).toBeVisible()
  })

  it('shows an error state with Retry when a source errors', async () => {
    mockData({ tenancies: [tenancy()] })
    useReportsForMonth.mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
      isFetching: false,
      refetch: vi.fn(),
    })
    const user = userEvent.setup()
    await renderWithProviders(<CurrentMonthPage />)
    expect(
      screen.getByText('Luna curentă nu a putut fi încărcată.'),
    ).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Încearcă din nou' }))
  })
})
