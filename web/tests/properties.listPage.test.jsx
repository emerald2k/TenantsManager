import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from './renderWithProviders'
import { PropertiesListPage } from '@/features/properties/pages/PropertiesListPage'
import { useProperties } from '@/features/properties/hooks'
import { useActiveTenancies } from '@/features/tenants/hooks'

// Fast band — the boundary (the hooks) is mocked, no emulator. B already covers what
// `useProperties` does with Firestore; here we check only what the page does with
// the list: composes it, sorts it, joins the balance column, and drives the
// toggle/navigation. `useActiveTenancies` is the same join TenantsListPage
// already does by `userId` (M8 stage 10), here by `propertyId`.
vi.mock('@/features/properties/hooks', () => ({
  useProperties: vi.fn(),
}))
vi.mock('@/features/tenants/hooks', () => ({
  useActiveTenancies: vi.fn(),
}))

// PARTIAL mock: renderWithProviders mounts a real MemoryRouter, so replacing the
// whole module would take the router down. We swap out `useNavigate` alone.
const navigate = vi.fn()
vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal()),
  useNavigate: () => navigate,
}))

function property(overrides) {
  return {
    id: 'p1',
    name: 'Apartament Centru',
    address: { street: 'Str. Lalelelor', number: '12', city: 'Cluj-Napoca' },
    status: 'free',
    archived: false,
    ...overrides,
  }
}

function mockList(data, extra = {}) {
  useProperties.mockReturnValue({
    data,
    isPending: false,
    isError: false,
    ...extra,
  })
}

function mockTenancies(data = [], extra = {}) {
  useActiveTenancies.mockReturnValue({
    data,
    isPending: false,
    isError: false,
    isFetching: false,
    refetch: vi.fn(),
    ...extra,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockTenancies()
})

/** The names in the body rows, in DOM order (the header row is dropped). */
function renderedNames() {
  return screen
    .getAllByRole('row')
    .slice(1)
    .map((row) => within(row).getAllByRole('cell')[0].textContent)
}

describe('PropertiesListPage', () => {
  it('renders a row per property, with the address composed as one line', async () => {
    mockList([property()])
    await renderWithProviders(<PropertiesListPage />)

    expect(screen.getByText('Apartament Centru')).toBeVisible()
    expect(screen.getByText('Str. Lalelelor 12, Cluj-Napoca')).toBeVisible()
    expect(screen.getByText('Liber')).toBeVisible()
  })

  it('sorts the rows alphabetically by name, whatever order they arrive in', async () => {
    mockList([
      property({ id: 'z', name: 'Zebra' }),
      property({ id: 'a', name: 'Alpha' }),
      property({ id: 'm', name: 'Mango' }),
    ])
    await renderWithProviders(<PropertiesListPage />)

    expect(renderedNames()).toEqual(['Alpha', 'Mango', 'Zebra'])
  })

  describe('balance column (M8 stage 10 — joined from useActiveTenancies, was a hardcoded 0)', () => {
    function balanceCell(name) {
      const row = screen.getByText(name).closest('tr')
      // name | address | status | balance
      return within(row).getAllByRole('cell')[3]
    }

    it('shows the real, formatted currentBalance for an occupied property', async () => {
      mockList([property({ id: 'p1', name: 'Apartament Ocupat' })])
      mockTenancies([{ id: 't1', propertyId: 'p1', currentBalance: 500 }])
      await renderWithProviders(<PropertiesListPage />)

      const cell = balanceCell('Apartament Ocupat')
      expect(cell.textContent).toBe('500,00 lei')
      expect(cell.querySelector('.text-destructive')).not.toBeNull()
    })

    it('shows "—" for a free property (no active tenancy), never a stale 0', async () => {
      mockList([property({ id: 'p1', name: 'Apartament Liber' })])
      mockTenancies([])
      await renderWithProviders(<PropertiesListPage />)

      const cell = balanceCell('Apartament Liber')
      expect(cell.textContent).toBe('—')
    })

    it('renders a negative currentBalance as a positive figure labelled Credit, never a bare negative number (§5.5)', async () => {
      mockList([property({ id: 'p1', name: 'Apartament Credit' })])
      mockTenancies([{ id: 't1', propertyId: 'p1', currentBalance: -150 }])
      await renderWithProviders(<PropertiesListPage />)

      const cell = balanceCell('Apartament Credit')
      expect(cell.textContent).toBe('150,00 lei (Credit)')
    })
  })

  describe('show-archived toggle (FR-PROP-07)', () => {
    it('queries without archived by default, and with archived once toggled', async () => {
      const user = userEvent.setup()
      mockList([property()])
      await renderWithProviders(<PropertiesListPage />)

      // Default: archived hidden. `toHaveBeenLastCalledWith`, not plain
      // `toHaveBeenCalledWith` — the component re-renders and logs several calls;
      // only the LAST one reflects the current toggle state.
      expect(useProperties).toHaveBeenLastCalledWith({ includeArchived: false })

      await user.click(screen.getByLabelText('Arată arhivate'))

      expect(useProperties).toHaveBeenLastCalledWith({ includeArchived: true })
    })

    it('marks an archived row with the archived status label', async () => {
      // Archived keeps status:'free' (separate axes) — the label must still read
      // "Arhivat", not "Liber".
      mockList([property({ archived: true })])
      await renderWithProviders(<PropertiesListPage />)

      expect(screen.getByText('Arhivat')).toBeVisible()
      expect(screen.queryByText('Liber')).toBeNull()
    })
  })

  describe('search (FR-PROP-07 — name + address)', () => {
    beforeEach(() => {
      mockList([
        property({ id: 'a', name: 'Apartament Centru' }),
        property({
          id: 'b',
          name: 'Casa Zorilor',
          address: {
            street: 'Str. Zorilor',
            number: '5',
            city: 'Cluj-Napoca',
          },
        }),
      ])
    })

    it('filters to the matching subset', async () => {
      const user = userEvent.setup()
      await renderWithProviders(<PropertiesListPage />)

      await user.type(screen.getByRole('searchbox'), 'zorilor')

      expect(renderedNames()).toEqual(['Casa Zorilor'])
    })

    it('shows ZERO rows and a no-matches message when nothing matches (anti-vacuity)', async () => {
      // If the filter were removed, both rows would still show and this fails.
      const user = userEvent.setup()
      await renderWithProviders(<PropertiesListPage />)

      await user.type(screen.getByRole('searchbox'), 'zzz-nothing')

      expect(screen.queryByRole('row')).toBeNull()
      expect(
        screen.getByText('Nicio proprietate nu corespunde căutării.'),
      ).toBeVisible()
    })
  })

  describe('empty state', () => {
    it('shows the empty message and an add button that goes to the new form', async () => {
      const user = userEvent.setup()
      mockList([])
      await renderWithProviders(<PropertiesListPage />)

      expect(screen.getByText('Nicio proprietate deocamdată.')).toBeVisible()
      // Two "add" buttons in the empty state (header + empty CTA); either navigates.
      const addButtons = screen.getAllByRole('button', {
        name: 'Adaugă proprietate',
      })
      await user.click(addButtons[addButtons.length - 1])

      expect(navigate).toHaveBeenCalledWith('/admin/properties/new')
    })
  })

  it('navigates to the detail page when a row is clicked', async () => {
    const user = userEvent.setup()
    mockList([property({ id: 'p42', name: 'Apartament Centru' })])
    await renderWithProviders(<PropertiesListPage />)

    await user.click(screen.getByText('Apartament Centru'))

    expect(navigate).toHaveBeenCalledWith('/admin/properties/p42')
  })

  it('shows the loading state while the query is pending', async () => {
    mockList(undefined, { isPending: true })
    await renderWithProviders(<PropertiesListPage />)

    expect(screen.getByText('Se încarcă...')).toBeVisible()
  })

  describe('error state', () => {
    it('shows the error message and a working Retry button', async () => {
      const refetch = vi.fn()
      mockList(undefined, { isError: true, isFetching: false, refetch })
      const user = userEvent.setup()
      await renderWithProviders(<PropertiesListPage />)

      expect(
        screen.getByText(
          'Proprietățile nu au putut fi încărcate. Încearcă din nou.',
        ),
      ).toBeVisible()

      await user.click(screen.getByRole('button', { name: 'Încearcă din nou' }))

      expect(refetch).toHaveBeenCalledTimes(1)
    })

    it('disables Retry while a refetch is already in flight', async () => {
      mockList(undefined, {
        isError: true,
        isFetching: true,
        refetch: vi.fn(),
      })
      await renderWithProviders(<PropertiesListPage />)

      expect(
        screen.getByRole('button', { name: 'Încearcă din nou' }),
      ).toBeDisabled()
    })
  })
})
