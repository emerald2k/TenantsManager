import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from './renderWithProviders'
import { PropertiesListPage } from '@/features/properties/pages/PropertiesListPage'
import { useProperties } from '@/features/properties/hooks'

// Fast band — the boundary (the hook) is mocked, no emulator. B already covers what
// `useProperties` does with Firestore; here we check only what the page does with
// the list: composes it, sorts it, and drives the toggle/navigation.
vi.mock('@/features/properties/hooks', () => ({
  useProperties: vi.fn(),
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

beforeEach(() => {
  vi.clearAllMocks()
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
})
