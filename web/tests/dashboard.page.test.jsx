import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from './renderWithProviders'
import { DashboardPage } from '@/features/dashboard/pages/DashboardPage'
import { useProperties } from '@/features/properties/hooks'
import { useUsers, useAllTenancies } from '@/features/tenants/hooks'
import { useReportsForMonth, useReportsForYear } from '@/features/reports/hooks'
import { useCreateDraft } from '@/features/onboarding/hooks'
import { useNotificationLog } from '@/features/notifications/hooks'

/**
 * WHOLESALE REWRITE — M8 stage 15. Every source hook is mocked (fast band,
 * no emulator); the pure formulas are covered directly in
 * `dashboard.calculations.test`. Here we check what the PAGE does: the
 * NFR-UX-08 hierarchy (one primary money card, the rest subordinate), the
 * selector scoping (moves Expected / Overdue / the section, NOT Properties),
 * the strip's absence-vs-zero behaviour, the empty states, and navigation.
 *
 * `FR-DASH-10`'s empty state is additionally opened in a browser — jsdom does
 * not lay out the Recharts chart, so this file does not assert chart pixels.
 */

vi.mock('@/features/properties/hooks', () => ({ useProperties: vi.fn() }))
vi.mock('@/features/tenants/hooks', () => ({
  useUsers: vi.fn(),
  useAllTenancies: vi.fn(),
}))
vi.mock('@/features/reports/hooks', () => ({
  useReportsForMonth: vi.fn(),
  useReportsForYear: vi.fn(),
}))
vi.mock('@/features/onboarding/hooks', () => ({ useCreateDraft: vi.fn() }))
vi.mock('@/features/notifications/hooks', () => ({
  useNotificationLog: vi.fn(),
}))

const navigate = vi.fn()
vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal()),
  useNavigate: () => navigate,
}))

const now = new Date()
const thisMonth = now.getMonth() + 1
const thisYear = now.getFullYear()

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
  properties = [{ id: 'p1', status: 'occupied' }],
  users = [{ id: 'u1' }],
  tenancies = [],
  monthReports = [],
  yearReports = [],
  priorYearReports = [],
  notifications = { rows: [], anyExist: false },
} = {}) {
  useProperties.mockReturnValue(ok(properties))
  useUsers.mockReturnValue(ok(users))
  useAllTenancies.mockReturnValue(ok(tenancies))
  useReportsForMonth.mockReturnValue(ok(monthReports))
  // The page calls useReportsForYear twice — this year and last year. Keep
  // the two sets distinct so a report is never counted in both.
  useReportsForYear.mockImplementation((year) =>
    ok(year === thisYear ? yearReports : priorYearReports),
  )
  useNotificationLog.mockReturnValue(ok(notifications))
  useCreateDraft.mockReturnValue({ mutateAsync: vi.fn(), isPending: false })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('DashboardPage — empty states (FR-DASH-03 / FR-DASH-10)', () => {
  it('zero properties AND zero users -> the two-action empty state, no money card', async () => {
    mockData({ properties: [], users: [] })
    await renderWithProviders(<DashboardPage />)

    expect(screen.getByText('Adaugă proprietate')).toBeVisible()
    expect(screen.getByText('Înrolează chiriaș')).toBeVisible()
    expect(screen.queryByText('Total de încasat')).not.toBeInTheDocument()
  })

  it('a property exists but no user yet -> NOT the empty state; the money card shows a real 0', async () => {
    mockData({ properties: [{ id: 'p1', status: 'free' }], users: [] })
    await renderWithProviders(<DashboardPage />)

    expect(screen.queryByText('Adaugă proprietate')).not.toBeInTheDocument()
    expect(screen.getByText('Total de încasat')).toBeVisible()
    expect(screen.getAllByText('0,00 lei').length).toBeGreaterThan(0)
  })
})

describe('DashboardPage — the primary money card (NFR-UX-08)', () => {
  it('Expected is the largest figure and carries the Overdue containment line inside it', async () => {
    mockData({
      tenancies: [
        { id: 't1', propertyId: 'p1', status: 'active', currentBalance: 1500 },
        { id: 't2', propertyId: 'p2', status: 'active', currentBalance: -200 },
      ],
    })
    await renderWithProviders(<DashboardPage />)

    // Expected = max(0,1500) + max(0,-200) = 1500 (credit never subtracts).
    const label = screen.getByText('Total de încasat')
    const card = label.closest('button')
    expect(within(card).getByText('1.500,00 lei')).toBeVisible()
    expect(within(card).getByText(/Din care restant/)).toBeVisible()
  })

  it('the Overdue line turns destructive only when Overdue > 0', async () => {
    mockData({
      tenancies: [
        { id: 't1', propertyId: 'p1', status: 'active', currentBalance: 2000 },
      ],
      monthReports: [],
      yearReports: [
        {
          tenancyId: 't1',
          propertyId: 'p1',
          status: 'signed',
          month: thisMonth,
          year: thisYear,
          dueDate: `${thisYear}-01-15`,
          finalTotal: 2000,
          amountPaid: 0,
          previousMonthArrears: 0,
        },
      ],
    })
    await renderWithProviders(<DashboardPage />)

    // dueDate is 15 Jan of this year — past for any run after mid-January.
    const line = screen.getByText(/Din care restant/)
    expect(line.className).toContain('text-destructive')
  })

  it('clicking the money card navigates to the payments ledger (one click to the main action)', async () => {
    mockData({
      tenancies: [
        { id: 't1', propertyId: 'p1', status: 'active', currentBalance: 500 },
      ],
    })
    const user = userEvent.setup()
    await renderWithProviders(<DashboardPage />)

    await user.click(screen.getByText('Total de încasat').closest('button'))
    expect(navigate).toHaveBeenCalledWith('/admin/payments')
  })
})

describe('DashboardPage — the selector scopes Expected/Overdue/section, not Properties', () => {
  it('stepping back a month changes the section title and re-reads Expected, but Properties is unchanged', async () => {
    // Current month: currentBalance path -> Expected 900. Prior month has a
    // signed report leaving 400 -> Expected 400 after stepping back.
    const prior = new Date(thisYear, thisMonth - 2, 1) // one month before this
    mockData({
      properties: [
        { id: 'p1', status: 'occupied' },
        { id: 'p2', status: 'occupied' },
        { id: 'p3', status: 'free' },
      ],
      tenancies: [
        {
          id: 't1',
          propertyId: 'p1',
          status: 'active',
          currentBalance: 900,
          tenantName: 'Ana',
          property: { name: 'Aviatorilor 1' },
        },
      ],
      yearReports: [
        {
          tenancyId: 't1',
          propertyId: 'p1',
          status: 'signed',
          month: prior.getMonth() + 1,
          year: prior.getFullYear(),
          dueDate: `${prior.getFullYear()}-${String(prior.getMonth() + 1).padStart(2, '0')}-15`,
          finalTotal: 1200,
          amountPaid: 800,
          previousMonthArrears: 0,
        },
      ],
      priorYearReports: [],
    })
    const user = userEvent.setup()
    await renderWithProviders(<DashboardPage />)

    const propertiesCard = screen
      .getByText('Total proprietăți')
      .closest('button')
    expect(within(propertiesCard).getByText('3')).toBeVisible()
    const moneyCard = screen.getByText('Total de încasat').closest('button')
    expect(within(moneyCard).getByText('900,00 lei')).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Luna anterioară' }))

    // Expected now comes from balanceAsOf(prior) = 1200 - 800 = 400.
    expect(within(moneyCard).getByText('400,00 lei')).toBeVisible()
    // Properties tile is untouched by the selector.
    expect(within(propertiesCard).getByText('3')).toBeVisible()
  })
})

describe('DashboardPage — the strip (absence is not zero, NFR-UX-08 rule 1)', () => {
  it('a strip line appears only when its figure is non-zero', async () => {
    mockData({
      tenancies: [
        { id: 't1', propertyId: 'p1', status: 'active', currentBalance: -300 },
        { id: 't2', propertyId: 'p2', status: 'ended', currentBalance: 890 },
      ],
    })
    await renderWithProviders(<DashboardPage />)

    expect(screen.getByText(/Avans plătit de chiriași/)).toBeVisible()
    expect(screen.getByText(/De recuperat de la foști chiriași/)).toBeVisible()
    // No ended tenancy is in credit -> that line is absent entirely.
    expect(
      screen.queryByText(/De returnat foștilor chiriași/),
    ).not.toBeInTheDocument()
  })

  it('with nothing to report and no occupied properties, the whole strip is absent', async () => {
    mockData({ tenancies: [], properties: [{ id: 'p1', status: 'free' }] })
    await renderWithProviders(<DashboardPage />)

    expect(
      screen.queryByText(/Avans plătit de chiriași/),
    ).not.toBeInTheDocument()
    expect(screen.queryByText(/Rapoarte nesemnate/)).not.toBeInTheDocument()
  })
})

describe('DashboardPage — the current-month section (FR-DASH-02 / 02b)', () => {
  it('renders the seven-column table (shared with /admin/current-month) and links a row to its report form', async () => {
    const signed = {
      tenancyId: 't1',
      propertyId: 'p1',
      status: 'signed',
      dueDate: `${thisYear}-01-15`,
      paymentStatus: 'paid',
      finalTotal: 2500,
      amountPaid: 2500,
      month: 1,
      year: thisYear,
    }
    mockData({
      tenancies: [
        {
          id: 't1',
          propertyId: 'p1',
          status: 'active',
          currentBalance: 0,
          dueDay: 15,
          tenantName: 'Ana Pop',
          property: { name: 'Aviatorilor 1' },
        },
      ],
      monthReports: [signed],
      yearReports: [signed],
    })
    const user = userEvent.setup()
    await renderWithProviders(<DashboardPage />)

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
    expect(screen.getByText('Aviatorilor 1')).toBeVisible()
    expect(screen.getByText('Achitat integral')).toBeVisible()

    await user.click(screen.getByText('Aviatorilor 1'))
    expect(navigate).toHaveBeenCalledWith(
      expect.stringContaining(
        `/admin/reports/t1?month=${thisMonth}&year=${thisYear}`,
      ),
    )
  })

  it('"Open Current month" navigates to the standalone page', async () => {
    mockData()
    const user = userEvent.setup()
    await renderWithProviders(<DashboardPage />)

    await user.click(
      screen.getByRole('button', { name: 'Deschide Luna curentă' }),
    )
    expect(navigate).toHaveBeenCalledWith('/admin/current-month')
  })
})

describe('DashboardPage — the notification list', () => {
  it('renders the latest sends and links through to the full log', async () => {
    mockData({
      notifications: {
        anyExist: true,
        rows: [
          {
            id: 'n1',
            subject: 'Raport august publicat',
            to: 'ana@example.com',
            type: 'report-new',
            audience: 'tenant',
            deliveryState: 'SUCCESS',
            sentAt: new Date('2026-08-20T09:02:00'),
          },
        ],
      },
    })
    const user = userEvent.setup()
    await renderWithProviders(<DashboardPage />)

    expect(screen.getByText('Raport august publicat')).toBeVisible()
    expect(screen.getByText('Livrat')).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Toate notificările' }))
    expect(navigate).toHaveBeenCalledWith('/admin/notifications')
  })

  it('distinguishes an empty window from a log that has never had an entry', async () => {
    mockData({ notifications: { rows: [], anyExist: true } })
    const { unmount } = await renderWithProviders(<DashboardPage />)
    expect(
      screen.getByText('Niciun email trimis în ultimele 12 luni.'),
    ).toBeVisible()
    unmount()

    mockData({ notifications: { rows: [], anyExist: false } })
    await renderWithProviders(<DashboardPage />)
    expect(screen.getByText(/Jurnalul este gol/)).toBeVisible()
  })
})

describe('DashboardPage — loading and error', () => {
  it('shows a loading state while any source is pending', async () => {
    mockData()
    useReportsForYear.mockReturnValue({ data: undefined, isPending: true })
    await renderWithProviders(<DashboardPage />)
    expect(screen.getByText('Se încarcă...')).toBeVisible()
  })

  it('shows an error state with Retry when a source errors', async () => {
    mockData()
    useNotificationLog.mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
      isFetching: false,
      refetch: vi.fn(),
    })
    const user = userEvent.setup()
    await renderWithProviders(<DashboardPage />)

    expect(screen.getByText('Panoul nu a putut fi încărcat.')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Încearcă din nou' }))
  })

  it('"Enroll renter" from the empty state creates a draft and routes to onboarding', async () => {
    mockData({ properties: [], users: [] })
    const mutateAsync = vi.fn().mockResolvedValue('draft-9')
    useCreateDraft.mockReturnValue({ mutateAsync, isPending: false })
    const user = userEvent.setup()
    await renderWithProviders(<DashboardPage />)

    await user.click(screen.getByText('Înrolează chiriaș'))
    await vi.waitFor(() =>
      expect(navigate).toHaveBeenCalledWith('/admin/onboarding/draft-9'),
    )
  })
})
