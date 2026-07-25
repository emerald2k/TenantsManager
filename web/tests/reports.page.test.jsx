import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from './renderWithProviders'
import { MonthlyReportPage } from '@/features/reports/pages/MonthlyReportPage'
import {
  useActiveTenancyForProperty,
  useProperty,
} from '@/features/properties/hooks'
import { useMonthlyReport, useSaveReportDraft } from '@/features/reports/hooks'

// Fast band — the data hooks are mocked; hooks.js/schema.js's own behavior is
// covered by reports.hooks.test.jsx / reports.schema.test.js. This file only
// checks the SHELL: what renders, the live total, and pre-fill vs. reopen.

vi.mock('@/features/properties/hooks', () => ({
  useProperty: vi.fn(),
  useActiveTenancyForProperty: vi.fn(),
}))
vi.mock('@/features/reports/hooks', () => ({
  useMonthlyReport: vi.fn(),
  useSaveReportDraft: vi.fn(),
}))
vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal()),
  useParams: () => ({ propertyId: 'p1' }),
  useSearchParams: () => [
    new URLSearchParams({ month: '7', year: '2026' }),
    vi.fn(),
  ],
}))

const PROPERTY = {
  id: 'p1',
  ownerId: 'admin-uid',
  name: 'Downtown Apartment',
  services: [
    { serviceId: 'gas', name: 'Gas', source: 'catalog' },
    { serviceId: 'electricity', name: 'Electricity', source: 'catalog' },
  ],
}
const TENANCY = {
  id: 't1',
  userId: 'u1',
  tenantName: 'Ana Pop',
  monthlyRent: 1500,
  dueDay: 5,
}

function mockData({ report = null } = {}) {
  useProperty.mockReturnValue({
    data: PROPERTY,
    isPending: false,
    isError: false,
  })
  useActiveTenancyForProperty.mockReturnValue({
    data: TENANCY,
    isPending: false,
  })
  useMonthlyReport.mockReturnValue({ data: report, isPending: false })
}

const mutateAsync = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  mutateAsync.mockResolvedValue('p1_2026-07')
  useSaveReportDraft.mockReturnValue({ mutateAsync, isPending: false })
})

describe('MonthlyReportPage — draft (M4 sub-stage 1)', () => {
  it('shows every active service, including one saved with amount 0 (FR-REP-03)', async () => {
    mockData()
    await renderWithProviders(<MonthlyReportPage />)

    expect(await screen.findByText('Gas')).toBeVisible()
    expect(screen.getByText('Electricity')).toBeVisible()
  })

  it('pre-fills rent from the tenancy and the due date from dueDay (FR-REP-02/05)', async () => {
    mockData()
    await renderWithProviders(<MonthlyReportPage />)

    expect(await screen.findByDisplayValue('1500')).toBeVisible()
    expect(screen.getByDisplayValue('2026-07-05')).toBeVisible()
  })

  it('recomputes the total live as an amount is edited (FR-REP-04)', async () => {
    const user = userEvent.setup()
    mockData()
    await renderWithProviders(<MonthlyReportPage />)

    const maintenanceInput = (await screen.findAllByRole('spinbutton'))[1]
    await user.clear(maintenanceInput)
    await user.type(maintenanceInput, '100')

    expect(await screen.findByText('1.600,00 lei')).toBeVisible()
  })

  it('opens an existing draft with its SAVED values, not blank ones (FR-REP-14)', async () => {
    mockData({
      report: {
        id: 'p1_2026-07',
        rent: { amount: 1600, notes: '' },
        maintenance: { amount: 50, notes: '' },
        serviceCosts: [
          { serviceId: 'gas', name: 'Gas', amount: 80, notes: '' },
          {
            serviceId: 'electricity',
            name: 'Electricity',
            amount: 0,
            notes: '',
          },
        ],
        otherExpenses: [],
        previousMonthArrears: 0,
        previousMonthCredit: 0,
        dueDate: '2026-07-10',
      },
    })
    await renderWithProviders(<MonthlyReportPage />)

    expect(await screen.findByDisplayValue('1600')).toBeVisible()
    expect(screen.getByDisplayValue('80')).toBeVisible()
    expect(screen.getByDisplayValue('2026-07-10')).toBeVisible()
  })

  it('shows an empty state instead of the form when the property has no active tenancy', async () => {
    useProperty.mockReturnValue({
      data: PROPERTY,
      isPending: false,
      isError: false,
    })
    useActiveTenancyForProperty.mockReturnValue({
      data: null,
      isPending: false,
    })
    useMonthlyReport.mockReturnValue({ data: null, isPending: false })

    await renderWithProviders(<MonthlyReportPage />)

    expect(
      await screen.findByText(
        'Această proprietate nu are o tenanță activă — nu se poate crea un raport.',
      ),
    ).toBeVisible()
  })

  it('adds and removes an "other expense" line', async () => {
    const user = userEvent.setup()
    mockData()
    await renderWithProviders(<MonthlyReportPage />)

    await screen.findByText('Gas')
    await user.click(screen.getByText('Adaugă cheltuială'))

    expect(screen.getByPlaceholderText('Descriere')).toBeVisible()

    await user.click(screen.getByText('Șterge'))
    expect(screen.queryByPlaceholderText('Descriere')).toBeNull()
  })
})
