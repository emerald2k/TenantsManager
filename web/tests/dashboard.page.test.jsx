import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from './renderWithProviders'
import { DashboardPage } from '@/features/dashboard/pages/DashboardPage'
import { useProperties } from '@/features/properties/hooks'
import { useUsers, useActiveTenancies } from '@/features/tenants/hooks'
import { useReportsForMonth } from '@/features/reports/hooks'
import { useCreateDraft } from '@/features/onboarding/hooks'

// Fast band — every source hook is mocked, no emulator. B/reports.hooks
// already cover what these hooks do with Firestore; here we check only what
// the page does with the data: aggregates the totals, picks the empty
// state, and drives navigation.
vi.mock('@/features/properties/hooks', () => ({ useProperties: vi.fn() }))
vi.mock('@/features/tenants/hooks', () => ({
  useUsers: vi.fn(),
  useActiveTenancies: vi.fn(),
}))
vi.mock('@/features/reports/hooks', () => ({ useReportsForMonth: vi.fn() }))
vi.mock('@/features/onboarding/hooks', () => ({ useCreateDraft: vi.fn() }))

const navigate = vi.fn()
vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal()),
  useNavigate: () => navigate,
}))

function mockData({
  properties = [],
  users = [],
  tenancies = [],
  reports = [],
} = {}) {
  useProperties.mockReturnValue({
    data: properties,
    isPending: false,
    isError: false,
    isFetching: false,
    refetch: vi.fn(),
  })
  useUsers.mockReturnValue({
    data: users,
    isPending: false,
    isError: false,
    isFetching: false,
    refetch: vi.fn(),
  })
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
  useCreateDraft.mockReturnValue({ mutateAsync: vi.fn(), isPending: false })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('DashboardPage', () => {
  it('empty state: zero properties AND zero users -> only the two actions, no totals', async () => {
    mockData({ properties: [], users: [] })
    await renderWithProviders(<DashboardPage />)

    expect(screen.getByText('Adaugă proprietate')).toBeVisible()
    expect(screen.getByText('Înrolează chiriaș')).toBeVisible()
    expect(
      screen.queryByText('Total de încasat luna asta'),
    ).not.toBeInTheDocument()
  })

  it('does NOT show the empty state when properties exist but users are still zero', async () => {
    mockData({ properties: [{ id: 'p1' }], users: [] })
    await renderWithProviders(<DashboardPage />)

    expect(screen.getByText('Total de încasat luna asta')).toBeVisible()
    expect(screen.queryByText('Adaugă proprietate')).not.toBeInTheDocument()
  })

  it('does NOT show the empty state when users exist but properties are still zero', async () => {
    mockData({ properties: [], users: [{ id: 'u1' }] })
    await renderWithProviders(<DashboardPage />)

    expect(screen.getByText('Total de încasat luna asta')).toBeVisible()
  })

  it('with data: shows both totals, computed via the pinned formulas', async () => {
    mockData({
      properties: [{ id: 'p1' }],
      users: [{ id: 'u1' }],
      tenancies: [{ propertyId: 'p1', status: 'active', currentBalance: 300 }],
      reports: [
        {
          propertyId: 'p1',
          status: 'signed',
          finalTotal: 1000,
          amountPaid: 400,
        },
      ],
    })
    await renderWithProviders(<DashboardPage />)

    expect(screen.getByText('600,00 lei')).toBeVisible()
    expect(screen.getByText('300,00 lei')).toBeVisible()
  })

  it('total arrears renders in the destructive tone when > 0', async () => {
    mockData({
      properties: [{ id: 'p1' }],
      users: [{ id: 'u1' }],
      tenancies: [{ propertyId: 'p1', status: 'active', currentBalance: 300 }],
    })
    await renderWithProviders(<DashboardPage />)

    expect(screen.getByText('300,00 lei')).toHaveClass('text-destructive')
  })

  it('shows 0, not hidden, when totals are genuinely zero but data exists', async () => {
    mockData({ properties: [{ id: 'p1' }], users: [{ id: 'u1' }] })
    await renderWithProviders(<DashboardPage />)

    expect(screen.getAllByText('0,00 lei')).toHaveLength(2)
  })

  it('clicking a total card navigates to /admin/current-month', async () => {
    mockData({ properties: [{ id: 'p1' }], users: [{ id: 'u1' }] })
    await renderWithProviders(<DashboardPage />)

    screen.getByText('Total de încasat luna asta').closest('button').click()
    expect(navigate).toHaveBeenCalledWith('/admin/current-month')
  })

  it('clicking the OTHER total card also navigates to /admin/current-month', async () => {
    mockData({ properties: [{ id: 'p1' }], users: [{ id: 'u1' }] })
    await renderWithProviders(<DashboardPage />)

    screen.getByText('Total arierate').closest('button').click()
    expect(navigate).toHaveBeenCalledWith('/admin/current-month')
  })

  it('shows a loading state while any source query is pending', async () => {
    mockData()
    useProperties.mockReturnValue({
      data: undefined,
      isPending: true,
      isError: false,
    })
    await renderWithProviders(<DashboardPage />)

    expect(screen.getByText('Se încarcă...')).toBeVisible()
  })

  it('shows an error state if any source query errors', async () => {
    mockData()
    useReportsForMonth.mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
    })
    await renderWithProviders(<DashboardPage />)

    expect(
      screen.getByText('Dashboard-ul nu a putut fi încărcat.'),
    ).toBeVisible()
  })

  it('clicking Retry re-runs every source query that fed the error', async () => {
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
    await renderWithProviders(<DashboardPage />)

    await user.click(screen.getByRole('button', { name: 'Încearcă din nou' }))

    expect(reportsRefetch).toHaveBeenCalledTimes(1)
  })

  it('"Enroll tenant" creates a draft and navigates to the onboarding wizard', async () => {
    mockData({ properties: [], users: [] })
    const mutateAsync = vi.fn().mockResolvedValue('draft-123')
    useCreateDraft.mockReturnValue({ mutateAsync, isPending: false })
    await renderWithProviders(<DashboardPage />)

    screen.getByText('Înrolează chiriaș').click()
    await vi.waitFor(() => {
      expect(navigate).toHaveBeenCalledWith('/admin/onboarding/draft-123')
    })
  })
})
