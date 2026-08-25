import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from './renderWithProviders'
import { PaymentsLedgerPage } from '@/features/payments/pages/PaymentsLedgerPage'
import { useProperties } from '@/features/properties/hooks'
import { useAllTenancies } from '@/features/tenants/hooks'
import { useReportsForMonth, useReportsForYear } from '@/features/reports/hooks'

// Fast band — the boundary hooks are mocked, no emulator. reports.hooks.test
// already covers what useReportsForMonth/useReportsForYear do with Firestore;
// here we check only what the page does with the joined data: rows, sort,
// badges, filters, footer totals and navigation.
vi.mock('@/features/properties/hooks', () => ({ useProperties: vi.fn() }))
vi.mock('@/features/tenants/hooks', () => ({ useAllTenancies: vi.fn() }))
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
const CURRENT_MONTH = now.getMonth() + 1
const CURRENT_YEAR = now.getFullYear()

function tenancy(overrides) {
  return {
    id: 't1',
    tenantName: 'Ion Popescu',
    property: { name: 'Apartament Centru' },
    currentBalance: 0,
    ...overrides,
  }
}

function property(overrides) {
  return { id: 'p1', name: 'Apartament Centru', ...overrides }
}

function report(overrides) {
  return {
    id: 'r1',
    tenancyId: 't1',
    propertyId: 'p1',
    status: 'signed',
    month: CURRENT_MONTH,
    year: CURRENT_YEAR,
    finalTotal: 2500,
    previousMonthArrears: 0,
    previousMonthCredit: 0,
    roundingSurplus: 0,
    rent: { amount: 2500 },
    dueDate: '2099-01-01',
    ...overrides,
  }
}

function mockData({
  properties = [],
  tenancies = [],
  monthReports = [],
  yearReports = [],
} = {}) {
  useProperties.mockReturnValue({
    data: properties,
    isPending: false,
    isError: false,
    isFetching: false,
    refetch: vi.fn(),
  })
  useAllTenancies.mockReturnValue({
    data: tenancies,
    isPending: false,
    isError: false,
    isFetching: false,
    refetch: vi.fn(),
  })
  useReportsForMonth.mockReturnValue({
    data: monthReports,
    isPending: false,
    isError: false,
    isFetching: false,
    refetch: vi.fn(),
  })
  useReportsForYear.mockReturnValue({
    data: yearReports,
    isPending: false,
    isError: false,
    isFetching: false,
    refetch: vi.fn(),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

/** Scopes text lookups to the table body — property names and status labels
 * also appear as `<option>` text in the filter dropdowns, which would
 * otherwise make `screen.getByText` ambiguous. */
function table() {
  return within(screen.getByRole('table'))
}

describe('PaymentsLedgerPage', () => {
  it('lists a row with property, renter, period, amount due, amount paid, payment date and status', async () => {
    mockData({
      properties: [property()],
      tenancies: [tenancy()],
      monthReports: [
        report({
          finalTotal: 2500,
          amountPaid: 2000,
          paymentDate: '2026-07-10',
          paymentStatus: 'partial',
        }),
      ],
    })
    await renderWithProviders(<PaymentsLedgerPage />)

    expect(table().getByText('Apartament Centru')).toBeVisible()
    expect(table().getByText('Ion Popescu')).toBeVisible()
    expect(table().getByText('2.500,00 lei')).toBeVisible()
    expect(table().getByText('2.000,00 lei')).toBeVisible()
    expect(table().getByText('2026-07-10')).toBeVisible()
    expect(table().getByText('Parțial')).toBeVisible()
  })

  describe('anti-vacuity — an UNPAID row (no paymentDate, absent payment fields) must be VISIBLE (FR-PAY-07, SRS §6 line 816)', () => {
    it('an unpaid report renders its own row, not silently dropped, alongside a paid one', async () => {
      mockData({
        properties: [property(), property({ id: 'p2', name: 'Casa Zorilor' })],
        tenancies: [
          tenancy(),
          tenancy({
            id: 't2',
            property: { name: 'Casa Zorilor' },
            tenantName: 'Maria Ionescu',
          }),
        ],
        monthReports: [
          report({
            id: 'r-paid',
            amountPaid: 2500,
            paymentDate: '2026-07-10',
            paymentStatus: 'paid',
          }),
          report({
            id: 'r-unpaid',
            tenancyId: 't2',
            propertyId: 'p2',
            amountPaid: null,
            paymentDate: null,
            paymentStatus: undefined,
          }),
        ],
      })
      await renderWithProviders(<PaymentsLedgerPage />)

      // If an orderBy-style bug silently dropped the undated row, only ONE
      // data row would render here — this is the actual regression check.
      const rows = screen.getAllByRole('row').slice(1)
      expect(rows).toHaveLength(2)
      expect(table().getByText('Casa Zorilor')).toBeVisible()
      expect(table().getByText('Maria Ionescu')).toBeVisible()
      expect(table().getByText('Neînregistrat')).toBeVisible()
    })

    it('the unpaid row sorts LAST, after the dated row', async () => {
      mockData({
        properties: [property(), property({ id: 'p2', name: 'Casa Zorilor' })],
        tenancies: [
          tenancy(),
          tenancy({ id: 't2', property: { name: 'Casa Zorilor' } }),
        ],
        monthReports: [
          report({ id: 'r-unpaid', tenancyId: 't2', propertyId: 'p2' }),
          report({
            id: 'r-paid',
            amountPaid: 2500,
            paymentDate: '2026-07-10',
            paymentStatus: 'paid',
          }),
        ],
      })
      await renderWithProviders(<PaymentsLedgerPage />)

      const rows = screen.getAllByRole('row').slice(1)
      expect(within(rows[0]).getByText('Apartament Centru')).toBeVisible()
      expect(within(rows[1]).getByText('Casa Zorilor')).toBeVisible()
    })
  })

  it('badges an unpaid, past-due report as overdue', async () => {
    mockData({
      properties: [property()],
      tenancies: [tenancy()],
      monthReports: [
        report({ paymentStatus: 'unpaid', dueDate: '2000-01-01' }),
      ],
    })
    await renderWithProviders(<PaymentsLedgerPage />)

    expect(table().getByText('Restant')).toBeVisible()
  })

  it('badges a partial payment as partial even when past due, never overdue', async () => {
    mockData({
      properties: [property()],
      tenancies: [tenancy()],
      monthReports: [
        report({ paymentStatus: 'partial', dueDate: '2000-01-01' }),
      ],
    })
    await renderWithProviders(<PaymentsLedgerPage />)

    expect(table().getByText('Parțial')).toBeVisible()
    expect(table().queryByText('Restant')).not.toBeInTheDocument()
  })

  it('a row click navigates to the report form with tenancyId, month and year (FR-PAY-09)', async () => {
    mockData({
      properties: [property()],
      tenancies: [tenancy()],
      monthReports: [report({ month: 3, year: 2026 })],
    })
    await renderWithProviders(<PaymentsLedgerPage />)

    screen.getByRole('row', { name: /Apartament Centru/ }).click()

    expect(navigate).toHaveBeenCalledWith('/admin/reports/t1?month=3&year=2026')
  })

  it('the property filter narrows the rows shown', async () => {
    mockData({
      properties: [property(), property({ id: 'p2', name: 'Casa Zorilor' })],
      tenancies: [
        tenancy(),
        tenancy({ id: 't2', property: { name: 'Casa Zorilor' } }),
      ],
      monthReports: [
        report({ id: 'r1', tenancyId: 't1', propertyId: 'p1' }),
        report({ id: 'r2', tenancyId: 't2', propertyId: 'p2' }),
      ],
    })
    const user = userEvent.setup()
    await renderWithProviders(<PaymentsLedgerPage />)

    await user.selectOptions(screen.getByLabelText('Proprietate'), 'p2')

    expect(table().queryByText('Apartament Centru')).not.toBeInTheDocument()
    expect(table().getByText('Casa Zorilor')).toBeVisible()
  })

  it('the status filter narrows the rows shown', async () => {
    mockData({
      properties: [property()],
      tenancies: [tenancy()],
      monthReports: [
        report({
          id: 'r-paid',
          amountPaid: 2500,
          paymentDate: '2026-07-10',
          paymentStatus: 'paid',
        }),
        report({ id: 'r-unpaid' }),
      ],
    })
    const user = userEvent.setup()
    await renderWithProviders(<PaymentsLedgerPage />)

    expect(screen.getAllByRole('row')).toHaveLength(3) // header + 2 rows

    await user.selectOptions(screen.getByLabelText('Status'), 'paid')

    expect(screen.getAllByRole('row')).toHaveLength(2) // header + 1 row
  })

  describe('year mode footer totals (FR-PROP-12)', () => {
    async function renderInYearMode(reports) {
      mockData({
        properties: [property()],
        tenancies: [tenancy({ currentBalance: 2500 })],
        yearReports: reports,
      })
      const user = userEvent.setup()
      await renderWithProviders(<PaymentsLedgerPage />)
      await user.selectOptions(screen.getByLabelText('Tip perioadă'), 'year')
      return user
    }

    it('shows no footer in month mode (the default)', async () => {
      mockData({
        properties: [property()],
        tenancies: [tenancy()],
        monthReports: [report()],
      })
      await renderWithProviders(<PaymentsLedgerPage />)

      expect(screen.queryByText('Facturat')).not.toBeInTheDocument()
    })

    it('billed, collected and rent total appear once year mode is selected', async () => {
      await renderInYearMode([
        report({ amountPaid: 2500, paymentStatus: 'paid' }),
      ])

      expect(screen.getByText('Facturat')).toBeVisible()
      expect(screen.getByText('Încasat')).toBeVisible()
      expect(screen.getByText('Rest de încasat')).toBeVisible()
      expect(screen.getAllByText('2.500,00 lei').length).toBeGreaterThan(0)
    })

    it('still outstanding comes from tenancies.currentBalance, never Σ(finalTotal − amountPaid) — the double-counting trap (SRS §6 line 821)', async () => {
      // Two signed reports on the SAME tenancy. A naive per-report sum of
      // (finalTotal - amountPaid) would double the real, single balance.
      await renderInYearMode([
        report({ id: 'r-a', month: 1, amountPaid: 0, paymentStatus: 'unpaid' }),
        report({ id: 'r-b', month: 2, amountPaid: 0, paymentStatus: 'unpaid' }),
      ])

      const outstandingLabel = screen.getByText('Rest de încasat')
      const value = outstandingLabel.nextElementSibling.textContent
      expect(value).toBe('2.500,00 lei') // the tenancy's ONE currentBalance, not 5.000
    })

    it('a draft report is excluded from every total, and the exclusion is stated on screen', async () => {
      await renderInYearMode([
        report({ id: 'r-signed', status: 'signed', amountPaid: 2500 }),
        report({ id: 'r-draft', status: 'draft', month: 8 }),
      ])

      expect(
        screen.getByText(
          '1 rapoarte nesemnate din ' +
            CURRENT_YEAR +
            ' nu sunt incluse în totaluri.',
        ),
      ).toBeVisible()
    })
  })

  it('shows a loading state while any source query is pending', async () => {
    mockData()
    useProperties.mockReturnValue({
      data: undefined,
      isPending: true,
      isError: false,
    })
    await renderWithProviders(<PaymentsLedgerPage />)

    expect(screen.getByText('Se încarcă...')).toBeVisible()
  })

  it('shows an error state if any source query errors, with a working Retry', async () => {
    mockData()
    const refetch = vi.fn()
    useReportsForMonth.mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
      isFetching: false,
      refetch,
    })
    const user = userEvent.setup()
    await renderWithProviders(<PaymentsLedgerPage />)

    expect(
      screen.getByText('Registrul plăților nu a putut fi încărcat.'),
    ).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Încearcă din nou' }))
    expect(refetch).toHaveBeenCalledTimes(1)
  })

  it('shows the empty state when there are no reports for the selected period', async () => {
    mockData({ properties: [property()], tenancies: [tenancy()] })
    await renderWithProviders(<PaymentsLedgerPage />)

    expect(
      screen.getByText('Niciun raport pentru perioada selectată.'),
    ).toBeVisible()
  })
})
