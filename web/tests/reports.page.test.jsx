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

    // Scoped by aria-label, not display value: finalTotal ALSO mirrors 1500
    // (sub-stage 2), so a bare display-value query would now match both.
    expect(await screen.findByLabelText('Chirie')).toHaveValue(1500)
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

describe('MonthlyReportPage — finalTotal (M4 sub-stage 2, FR-REP-04a/04b)', () => {
  it('initializes finalTotal to the exact calculated total on a fresh report', async () => {
    mockData()
    await renderWithProviders(<MonthlyReportPage />)

    await screen.findByText('Gas')
    // rent 1500 + maintenance 0 + gas 0 + electricity 0.
    expect(screen.getByLabelText('Total final')).toHaveValue(1500)
  })

  it('mirrors the total live while untouched — editing a line moves finalTotal too', async () => {
    const user = userEvent.setup()
    mockData()
    await renderWithProviders(<MonthlyReportPage />)

    const maintenanceInput = (await screen.findAllByRole('spinbutton'))[1]
    await user.clear(maintenanceInput)
    await user.type(maintenanceInput, '100')

    expect(await screen.findByText('1.600,00 lei')).toBeVisible()
    expect(screen.getByLabelText('Total final')).toHaveValue(1600)
  })

  it('freezes once the admin edits finalTotal manually — further line edits do not move it', async () => {
    const user = userEvent.setup()
    mockData()
    await renderWithProviders(<MonthlyReportPage />)

    await screen.findByText('Gas')
    const finalTotalInput = screen.getByLabelText('Total final')
    await user.clear(finalTotalInput)
    await user.type(finalTotalInput, '1450')
    expect(finalTotalInput).toHaveValue(1450)

    const maintenanceInput = (await screen.findAllByRole('spinbutton'))[1]
    await user.clear(maintenanceInput)
    await user.type(maintenanceInput, '100')

    // The reference total keeps moving...
    expect(await screen.findByText('1.600,00 lei')).toBeVisible()
    // ...but finalTotal, once hand-edited, no longer follows it.
    expect(finalTotalInput).toHaveValue(1450)
  })

  it('reopen with finalTotal == calculatedTotal (it was mirroring): editing a line still updates it', async () => {
    const user = userEvent.setup()
    mockData({
      report: {
        id: 'p1_2026-07',
        rent: { amount: 1500, notes: '' },
        maintenance: { amount: 0, notes: '' },
        serviceCosts: [
          { serviceId: 'gas', name: 'Gas', amount: 0, notes: '' },
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
        calculatedTotal: 1500,
        finalTotal: 1500, // mirroring when it was last saved
        dueDate: '2026-07-05',
      },
    })
    await renderWithProviders(<MonthlyReportPage />)

    expect(await screen.findByLabelText('Total final')).toHaveValue(1500)

    const maintenanceInput = (await screen.findAllByRole('spinbutton'))[1]
    await user.clear(maintenanceInput)
    await user.type(maintenanceInput, '75')

    expect(await screen.findByLabelText('Total final')).toHaveValue(1575)
  })

  it('reopen with finalTotal != calculatedTotal (manually diverged): frozen, editing a line does NOT move it', async () => {
    const user = userEvent.setup()
    mockData({
      report: {
        id: 'p1_2026-07',
        rent: { amount: 1500, notes: '' },
        maintenance: { amount: 0, notes: '' },
        serviceCosts: [
          { serviceId: 'gas', name: 'Gas', amount: 0, notes: '' },
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
        calculatedTotal: 1500,
        finalTotal: 1450, // manually rounded down at an earlier save
        dueDate: '2026-07-05',
      },
    })
    await renderWithProviders(<MonthlyReportPage />)

    expect(await screen.findByLabelText('Total final')).toHaveValue(1450)

    const maintenanceInput = (await screen.findAllByRole('spinbutton'))[1]
    await user.clear(maintenanceInput)
    await user.type(maintenanceInput, '75')

    expect(await screen.findByText('1.575,00 lei')).toBeVisible()
    expect(screen.getByLabelText('Total final')).toHaveValue(1450)
  })

  it('reopen an M4 sub-stage 1 draft with no finalTotal saved: mirrors (not frozen)', async () => {
    const user = userEvent.setup()
    mockData({
      report: {
        id: 'p1_2026-07',
        rent: { amount: 1500, notes: '' },
        maintenance: { amount: 0, notes: '' },
        serviceCosts: [
          { serviceId: 'gas', name: 'Gas', amount: 0, notes: '' },
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
        calculatedTotal: 1500,
        // no finalTotal key — pre-dates sub-stage 2
        dueDate: '2026-07-05',
      },
    })
    await renderWithProviders(<MonthlyReportPage />)

    expect(await screen.findByLabelText('Total final')).toHaveValue(1500)

    const maintenanceInput = (await screen.findAllByRole('spinbutton'))[1]
    await user.clear(maintenanceInput)
    await user.type(maintenanceInput, '75')

    expect(await screen.findByLabelText('Total final')).toHaveValue(1575)
  })

  it('submits finalTotal == calculatedTotal while still mirroring', async () => {
    const user = userEvent.setup()
    mockData()
    await renderWithProviders(<MonthlyReportPage />)

    await screen.findByText('Gas')
    await user.click(screen.getByText('Salvează draftul'))

    expect(mutateAsync).toHaveBeenCalledTimes(1)
    const saved = mutateAsync.mock.calls[0][0].values
    expect(saved.finalTotal).toBe(1500)
    expect(saved.calculatedTotal).toBe(1500)
  })

  it('submits the hand-typed finalTotal once frozen, distinct from calculatedTotal', async () => {
    const user = userEvent.setup()
    mockData()
    await renderWithProviders(<MonthlyReportPage />)

    await screen.findByText('Gas')
    const finalTotalInput = screen.getByLabelText('Total final')
    await user.clear(finalTotalInput)
    await user.type(finalTotalInput, '1450')

    await user.click(screen.getByText('Salvează draftul'))

    expect(mutateAsync).toHaveBeenCalledTimes(1)
    const saved = mutateAsync.mock.calls[0][0].values
    expect(saved.finalTotal).toBe(1450)
    expect(saved.calculatedTotal).toBe(1500)
  })
})
