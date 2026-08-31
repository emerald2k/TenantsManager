import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from './renderWithProviders'
import { useReportsForUser } from '@/features/reports/hooks'
import { FinancialTab } from '@/features/tenants/components/FinancialTab'

// Fast band — the reports-hooks boundary is mocked at the module level (same
// convention as tenantApp.historyPage.test.jsx). `useReportsForUser` itself
// (the userId filter, the no-orderBy JS sort, the "every status" rule, the
// "spans every tenancy of the account" property) is covered structurally in
// reports.hooks.test.jsx against the Firestore mock — that is where the
// userId→propertyId mutation is caught. This file proves the TAB renders what
// the hook returns and links each row to the right month.
//
// Until the 2026-08-31 UI/UX audit (finding #1) this file asserted a
// hardcoded "Niciun raport încă." string against a stub component with no
// hook at all — a test written to pass on a placeholder, the exact shape
// CLAUDE.md §7 calls vacuous.

vi.mock('@/features/reports/hooks', () => ({ useReportsForUser: vi.fn() }))

// PARTIAL mock: renderWithProviders mounts a real MemoryRouter, so replacing
// the whole module would take the router down with it.
const navigate = vi.fn()
vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal()),
  useNavigate: () => navigate,
}))

function query(overrides = {}) {
  return {
    data: undefined,
    isPending: false,
    isError: false,
    isFetching: false,
    refetch: vi.fn(),
    ...overrides,
  }
}

function report(overrides = {}) {
  return {
    id: 'seed-tenancy-occupied_2026-07',
    tenancyId: 'seed-tenancy-occupied',
    month: 7,
    year: 2026,
    finalTotal: 2730,
    status: 'signed',
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('FinancialTab', () => {
  it('shows the empty state when the account has no reports', async () => {
    useReportsForUser.mockReturnValue(query({ data: [] }))

    await renderWithProviders(<FinancialTab userId="seed-tenant" />)

    expect(screen.getByText('Niciun raport încă.')).toBeVisible()
  })

  it('passes the account userId straight through to the hook', async () => {
    useReportsForUser.mockReturnValue(query({ data: [] }))

    await renderWithProviders(<FinancialTab userId="seed-tenant" />)

    expect(useReportsForUser).toHaveBeenCalledWith('seed-tenant')
  })

  it('lists a signed report — month label, final total, status', async () => {
    useReportsForUser.mockReturnValue(query({ data: [report()] }))

    await renderWithProviders(<FinancialTab userId="seed-tenant" />)

    expect(screen.getByText('iulie 2026')).toBeVisible()
    expect(screen.getByText('2.730,00 lei')).toBeVisible()
    expect(screen.getByText('Semnat')).toBeVisible()
  })

  it('shows a draft report with the draft status label', async () => {
    useReportsForUser.mockReturnValue(
      query({ data: [report({ id: 'd', status: 'draft', month: 8 })] }),
    )

    await renderWithProviders(<FinancialTab userId="seed-tenant" />)

    expect(screen.getByText('Ciornă')).toBeVisible()
  })

  // The regression the audit found: reports exist for the account but this
  // tab does not show them. A stub renders zero rows here; so does a tab
  // wired to a hook that filters on the wrong field. Two reports on TWO
  // DIFFERENT tenancies of the SAME account (FR-TEN-15) must both appear —
  // the consolidated view is the whole point of the tab.
  it('lists reports from every tenancy of the account, newest first', async () => {
    useReportsForUser.mockReturnValue(
      query({
        data: [
          report({
            id: 'a_2026-07',
            tenancyId: 'tenancy-a',
            month: 7,
            year: 2026,
          }),
          report({
            id: 'b_2025-11',
            tenancyId: 'tenancy-b',
            month: 11,
            year: 2025,
          }),
        ],
      }),
    )

    await renderWithProviders(<FinancialTab userId="seed-tenant" />)

    const rows = screen.getAllByRole('row')
    expect(rows).toHaveLength(2)
    expect(rows[0]).toHaveTextContent('iulie 2026')
    expect(rows[1]).toHaveTextContent('noiembrie 2025')
  })

  it('links each row to that month of that tenancy', async () => {
    const user = userEvent.setup()
    useReportsForUser.mockReturnValue(
      query({
        data: [report({ tenancyId: 'tenancy-a', month: 7, year: 2026 })],
      }),
    )

    await renderWithProviders(<FinancialTab userId="seed-tenant" />)
    await user.click(screen.getByText('iulie 2026'))

    expect(navigate).toHaveBeenCalledWith(
      '/admin/reports/tenancy-a?month=7&year=2026',
    )
  })

  it('renders an error state with a retry, not a broken empty state', async () => {
    const refetch = vi.fn()
    useReportsForUser.mockReturnValue(query({ isError: true, refetch }))

    await renderWithProviders(<FinancialTab userId="seed-tenant" />)

    expect(
      screen.getByText(
        'Rapoartele nu au putut fi încărcate. Încearcă din nou.',
      ),
    ).toBeVisible()
    await userEvent.setup().click(screen.getByRole('button'))
    expect(refetch).toHaveBeenCalled()
  })
})
