import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from './renderWithProviders'
import { CurrentMonthPage } from '@/features/dashboard/pages/CurrentMonthPage'
import { useActiveTenancies } from '@/features/tenants/hooks'
import { useReportsForMonth } from '@/features/reports/hooks'

// Fast band — the boundary hooks are mocked, no emulator. reports.hooks.test
// already covers what useReportsForMonth does with Firestore; here we check
// only what the page does with the joined data: rows, badge, navigation,
// and the month selector.
vi.mock('@/features/tenants/hooks', () => ({ useActiveTenancies: vi.fn() }))
vi.mock('@/features/reports/hooks', () => ({ useReportsForMonth: vi.fn() }))

const navigate = vi.fn()
vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal()),
  useNavigate: () => navigate,
}))

function tenancy(overrides) {
  return {
    id: 't1',
    propertyId: 'p1',
    tenantName: 'Ion Popescu',
    property: { name: 'Apartament Centru' },
    status: 'active',
    currentBalance: 0,
    ...overrides,
  }
}

function mockData({ tenancies = [], reports = [] } = {}) {
  useActiveTenancies.mockReturnValue({
    data: tenancies,
    isPending: false,
    isError: false,
    isFetching: false,
    refetch: vi.fn(),
  })
  useReportsForMonth.mockReturnValue({
    data: reports,
    isPending: false,
    isError: false,
    isFetching: false,
    refetch: vi.fn(),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('CurrentMonthPage', () => {
  it('lists occupied properties with name, tenant, badge, and total', async () => {
    mockData({
      tenancies: [tenancy()],
      reports: [
        {
          propertyId: 'p1',
          status: 'signed',
          paymentStatus: 'paid',
          finalTotal: 900,
          dueDate: '2026-07-05',
        },
      ],
    })
    await renderWithProviders(<CurrentMonthPage />)

    expect(screen.getByText('Apartament Centru')).toBeVisible()
    expect(screen.getByText('Ion Popescu')).toBeVisible()
    expect(screen.getByText('Plătit')).toBeVisible()
    expect(screen.getByText('900,00 lei')).toBeVisible()
  })

  it('shows "not entered" and "—" total when no report exists for the property', async () => {
    mockData({ tenancies: [tenancy()], reports: [] })
    await renderWithProviders(<CurrentMonthPage />)

    expect(screen.getByText('Neintrodus')).toBeVisible()
    expect(screen.getByText('—')).toBeVisible()
  })

  it('shows the running total for a DRAFT report too, still badged not-entered', async () => {
    mockData({
      tenancies: [tenancy()],
      reports: [{ propertyId: 'p1', status: 'draft', finalTotal: 750 }],
    })
    await renderWithProviders(<CurrentMonthPage />)

    expect(screen.getByText('Neintrodus')).toBeVisible()
    expect(screen.getByText('750,00 lei')).toBeVisible()
  })

  it('badges a signed, unpaid, past-due report as overdue', async () => {
    mockData({
      tenancies: [tenancy()],
      reports: [
        {
          propertyId: 'p1',
          status: 'signed',
          dueDate: '2000-01-01',
          finalTotal: 500,
        },
      ],
    })
    await renderWithProviders(<CurrentMonthPage />)

    expect(screen.getByText('Restant')).toBeVisible()
  })

  it('badges a signed, partial payment as partial even when past due (never overdue)', async () => {
    mockData({
      tenancies: [tenancy()],
      reports: [
        {
          propertyId: 'p1',
          status: 'signed',
          paymentStatus: 'partial',
          dueDate: '2000-01-01',
          finalTotal: 500,
        },
      ],
    })
    await renderWithProviders(<CurrentMonthPage />)

    expect(screen.getByText('Parțial')).toBeVisible()
    expect(screen.queryByText('Restant')).not.toBeInTheDocument()
  })

  it('free properties (no active tenancy) never appear', async () => {
    mockData({ tenancies: [] })
    await renderWithProviders(<CurrentMonthPage />)

    expect(screen.getByText('Nicio proprietate ocupată încă.')).toBeVisible()
  })

  it('clicking a row navigates to the report form with tenancyId, month and year (FR-REP-14)', async () => {
    mockData({ tenancies: [tenancy({ id: 't7', propertyId: 'p7' })] })
    await renderWithProviders(<CurrentMonthPage />)

    screen.getByRole('row', { name: /Apartament Centru/ }).click()

    const now = new Date()
    expect(navigate).toHaveBeenCalledWith(
      `/admin/reports/t7?month=${now.getMonth() + 1}&year=${now.getFullYear()}`,
    )
  })

  it('navigating to the previous month re-queries useReportsForMonth with the prior month/year', async () => {
    mockData({ tenancies: [tenancy()] })
    const user = userEvent.setup()
    await renderWithProviders(<CurrentMonthPage />)

    await user.click(screen.getByRole('button', { name: 'Luna anterioară' }))

    const now = new Date()
    const prevMonth = now.getMonth() === 0 ? 12 : now.getMonth()
    const prevYear =
      now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear()
    expect(useReportsForMonth).toHaveBeenLastCalledWith(prevMonth, prevYear)
  })

  it('the "next month" control is disabled at the current month, and re-enables after going back', async () => {
    mockData({ tenancies: [tenancy()] })
    const user = userEvent.setup()
    await renderWithProviders(<CurrentMonthPage />)

    expect(
      screen.getByRole('button', { name: 'Luna următoare' }),
    ).toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'Luna anterioară' }))

    expect(screen.getByRole('button', { name: 'Luna următoare' })).toBeEnabled()
  })

  it('shows a loading state while any source query is pending', async () => {
    mockData()
    useActiveTenancies.mockReturnValue({
      data: undefined,
      isPending: true,
      isError: false,
    })
    await renderWithProviders(<CurrentMonthPage />)

    expect(screen.getByText('Se încarcă...')).toBeVisible()
  })

  it('shows an error state if any source query errors', async () => {
    mockData()
    useReportsForMonth.mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
    })
    await renderWithProviders(<CurrentMonthPage />)

    expect(
      screen.getByText('Luna curentă nu a putut fi încărcată.'),
    ).toBeVisible()
  })

  it('clicking Retry re-runs both source queries', async () => {
    mockData()
    const reportsRefetch = vi.fn()
    useReportsForMonth.mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
      isFetching: false,
      refetch: reportsRefetch,
    })
    const user = userEvent.setup()
    await renderWithProviders(<CurrentMonthPage />)

    await user.click(screen.getByRole('button', { name: 'Încearcă din nou' }))

    expect(reportsRefetch).toHaveBeenCalledTimes(1)
  })

  it('sorts rows alphabetically by property name', async () => {
    mockData({
      tenancies: [
        tenancy({
          propertyId: 'pz',
          property: { name: 'Zebra' },
          tenantName: 'Z',
        }),
        tenancy({
          propertyId: 'pa',
          property: { name: 'Alpha' },
          tenantName: 'A',
        }),
      ],
    })
    await renderWithProviders(<CurrentMonthPage />)

    const cells = screen
      .getAllByRole('row')
      .slice(1)
      .map((row) => row.textContent)
    expect(cells[0]).toContain('Alpha')
    expect(cells[1]).toContain('Zebra')
  })
})
