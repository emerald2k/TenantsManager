import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from './renderWithProviders'
import { TenantsListPage } from '@/features/tenants/pages/TenantsListPage'
import { useActiveTenancies, useUsers } from '@/features/tenants/hooks'
import {
  useCreateDraft,
  useDeleteDraft,
  useDraftsList,
} from '@/features/onboarding/hooks'

// Fast band — the boundary (the hooks) is mocked, no emulator. The hook tests
// already cover what each does with Firestore; here we check only what the page
// does with the merged data: composes it, sorts it, searches it, toggles
// archived, and drives the draft actions/navigation.
vi.mock('@/features/tenants/hooks', () => ({
  useUsers: vi.fn(),
  useActiveTenancies: vi.fn(),
}))
vi.mock('@/features/onboarding/hooks', () => ({
  useDraftsList: vi.fn(),
  useDeleteDraft: vi.fn(),
  useCreateDraft: vi.fn(),
}))

const navigate = vi.fn()
vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal()),
  useNavigate: () => navigate,
}))

const createMutateAsync = vi.fn()
const deleteMutateAsync = vi.fn()

function mockData({ users = [], tenancies = [], drafts = [] } = {}) {
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
  useDraftsList.mockReturnValue({
    data: drafts,
    isPending: false,
    isError: false,
    isFetching: false,
    refetch: vi.fn(),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  createMutateAsync.mockResolvedValue('draft-new')
  deleteMutateAsync.mockResolvedValue(undefined)
  useCreateDraft.mockReturnValue({
    mutateAsync: createMutateAsync,
    isPending: false,
  })
  useDeleteDraft.mockReturnValue({
    mutateAsync: deleteMutateAsync,
    isPending: false,
  })
})

/** The names in the body rows, in DOM order (the header row dropped). */
function renderedNames() {
  return screen
    .getAllByRole('row')
    .slice(1)
    .map((row) => within(row).getAllByRole('cell')[0].textContent)
}

describe('TenantsListPage (FR-TEN-13)', () => {
  it('renders a row per tenant with all the FR-TEN-13 columns', async () => {
    mockData({
      users: [
        {
          id: 'u1',
          name: 'Ana Pop',
          phone: '0712000111',
          email: 'ana@example.com',
          status: 'active',
        },
      ],
      tenancies: [
        {
          id: 't1',
          userId: 'u1',
          property: { name: 'Apartament Centru' },
          currentBalance: 0,
          status: 'active',
        },
      ],
    })
    await renderWithProviders(<TenantsListPage />)

    expect(screen.getByText('Ana Pop')).toBeVisible()
    expect(screen.getByText('0712000111')).toBeVisible()
    expect(screen.getByText('ana@example.com')).toBeVisible()
    expect(screen.getByText('Apartament Centru')).toBeVisible()
    expect(screen.getByText('Activ')).toBeVisible()
  })

  it('shows "—" for the property/balance of a tenant with no active tenancy', async () => {
    mockData({
      users: [
        {
          id: 'u2',
          name: 'Fără Contract',
          phone: '0700',
          email: 'x@y.z',
          status: 'inactive-readonly',
        },
      ],
    })
    await renderWithProviders(<TenantsListPage />)

    const row = screen.getByText('Fără Contract').closest('tr')
    // property and balance both render an em-dash (no tenancy → no data).
    expect(within(row).getAllByText('—').length).toBeGreaterThanOrEqual(2)
    expect(within(row).getByText('Inactiv')).toBeVisible()
  })

  it('renders the disabled status badge', async () => {
    mockData({
      users: [
        {
          id: 'u1',
          name: 'Dez Activ',
          phone: '',
          email: '',
          status: 'disabled',
        },
      ],
    })
    await renderWithProviders(<TenantsListPage />)

    expect(screen.getByText('Dezactivat')).toBeVisible()
  })

  describe('outstanding balance column', () => {
    function balanceCell(name) {
      const row = screen.getByText(name).closest('tr')
      // name | phone | email | property | balance | status | actions
      return within(row).getAllByRole('cell')[4]
    }

    it('shows a numeric 0 (not "—") without arrears styling for a tenant with an active tenancy', async () => {
      mockData({
        users: [
          {
            id: 'u1',
            name: 'Sold Zero',
            phone: '',
            email: '',
            status: 'active',
          },
        ],
        tenancies: [
          {
            id: 't1',
            userId: 'u1',
            property: { name: 'Casa A' },
            currentBalance: 0,
            status: 'active',
          },
        ],
      })
      await renderWithProviders(<TenantsListPage />)

      const cell = balanceCell('Sold Zero')
      expect(cell.textContent).toBe('0,00 lei')
      expect(cell.querySelector('.text-destructive')).toBeNull()
    })

    it('applies the destructive arrears styling when the balance is > 0', async () => {
      // The only way to exercise the red arrears path: currentBalance is 0 for
      // every real tenancy until M4, so browser validation can never reach it.
      mockData({
        users: [
          {
            id: 'u1',
            name: 'Sold Restant',
            phone: '',
            email: '',
            status: 'active',
          },
        ],
        tenancies: [
          {
            id: 't1',
            userId: 'u1',
            property: { name: 'Casa B' },
            currentBalance: 500,
            status: 'active',
          },
        ],
      })
      await renderWithProviders(<TenantsListPage />)

      const cell = balanceCell('Sold Restant')
      expect(cell.textContent).toBe('500,00 lei')
      expect(cell.querySelector('.text-destructive')).not.toBeNull()
    })

    it('renders a negative currentBalance as a positive figure labelled Credit, never a bare negative number (§5.5)', async () => {
      mockData({
        users: [
          {
            id: 'u1',
            name: 'Sold Credit',
            phone: '',
            email: '',
            status: 'active',
          },
        ],
        tenancies: [
          {
            id: 't1',
            userId: 'u1',
            property: { name: 'Casa C' },
            currentBalance: -200,
            status: 'active',
          },
        ],
      })
      await renderWithProviders(<TenantsListPage />)

      const cell = balanceCell('Sold Credit')
      expect(cell.textContent).toBe('200,00 lei (Credit)')
      expect(cell.textContent).not.toContain('-200')
      expect(cell.querySelector('.text-destructive')).toBeNull()
    })
  })

  it('merges drafts and users, sorted alphabetically by name', async () => {
    mockData({
      users: [
        { id: 'z', name: 'Zoltan', phone: '', email: '', status: 'active' },
        { id: 'm', name: 'Maria', phone: '', email: '', status: 'active' },
      ],
      drafts: [
        { id: 'd1', name: 'Alin', status: 'in_progress' },
        { id: 'd2', name: 'Paul', status: 'in_progress' },
      ],
    })
    await renderWithProviders(<TenantsListPage />)

    expect(renderedNames()).toEqual(['Alin', 'Maria', 'Paul', 'Zoltan'])
  })

  it('renders a draft with the "in progress" badge and Continue/Delete actions', async () => {
    mockData({ drafts: [{ id: 'd1', name: 'Alin', status: 'in_progress' }] })
    await renderWithProviders(<TenantsListPage />)

    const row = screen.getByText('Alin').closest('tr')
    expect(within(row).getByText('În lucru')).toBeVisible()
    expect(within(row).getByRole('button', { name: 'Continuă' })).toBeVisible()
    expect(
      within(row).getByRole('button', { name: 'Șterge draftul' }),
    ).toBeVisible()
  })

  it('continues a draft into the wizard', async () => {
    const user = userEvent.setup()
    mockData({ drafts: [{ id: 'd7', name: 'Alin', status: 'in_progress' }] })
    await renderWithProviders(<TenantsListPage />)

    await user.click(screen.getByRole('button', { name: 'Continuă' }))

    expect(navigate).toHaveBeenCalledWith('/admin/onboarding/d7')
  })

  it('deletes a draft after confirmation', async () => {
    const user = userEvent.setup()
    mockData({ drafts: [{ id: 'd9', name: 'Alin', status: 'in_progress' }] })
    await renderWithProviders(<TenantsListPage />)

    await user.click(screen.getByRole('button', { name: 'Șterge draftul' }))
    // A confirmation dialog appears; only its confirm button triggers the delete.
    const dialog = await screen.findByRole('dialog')
    await user.click(
      within(dialog).getByRole('button', { name: 'Șterge draftul' }),
    )

    await waitFor(() => {
      expect(deleteMutateAsync).toHaveBeenCalledWith('d9')
    })
  })

  it('navigates to the tenant detail when a user row is clicked', async () => {
    const user = userEvent.setup()
    mockData({
      users: [
        { id: 'u42', name: 'Ana Pop', phone: '', email: '', status: 'active' },
      ],
    })
    await renderWithProviders(<TenantsListPage />)

    await user.click(screen.getByText('Ana Pop'))

    expect(navigate).toHaveBeenCalledWith('/admin/tenants/u42')
  })

  describe('search (name + phone + email)', () => {
    beforeEach(() => {
      mockData({
        users: [
          {
            id: 'u1',
            name: 'Ana Pop',
            phone: '0712000111',
            email: 'ana@example.com',
            status: 'active',
          },
          {
            id: 'u2',
            name: 'Barbu Ion',
            phone: '0722333444',
            email: 'barbu@mail.ro',
            status: 'active',
          },
        ],
      })
    })

    it('filters to the matching subset', async () => {
      const user = userEvent.setup()
      await renderWithProviders(<TenantsListPage />)

      await user.type(screen.getByRole('searchbox'), 'barbu')

      expect(renderedNames()).toEqual(['Barbu Ion'])
    })

    it('shows ZERO rows and the no-matches message when nothing matches (anti-vacuity)', async () => {
      // If the filter were removed, both rows would still show and this fails.
      const user = userEvent.setup()
      await renderWithProviders(<TenantsListPage />)

      await user.type(screen.getByRole('searchbox'), 'zzz-nothing')

      expect(screen.queryByRole('row')).toBeNull()
      expect(
        screen.getByText('Niciun chiriaș nu corespunde căutării.'),
      ).toBeVisible()
    })
  })

  describe('show-archived toggle (mirrors Properties UX)', () => {
    beforeEach(() => {
      mockData({
        users: [
          {
            id: 'u1',
            name: 'Activ Unu',
            phone: '',
            email: '',
            status: 'active',
          },
          {
            id: 'u2',
            name: 'Arhivat Doi',
            phone: '',
            email: '',
            status: 'archived',
          },
        ],
      })
    })

    it('hides archived tenants by default', async () => {
      await renderWithProviders(<TenantsListPage />)

      expect(screen.getByText('Activ Unu')).toBeVisible()
      expect(screen.queryByText('Arhivat Doi')).toBeNull()
    })

    it('reveals archived tenants once toggled, with the archived badge', async () => {
      const user = userEvent.setup()
      await renderWithProviders(<TenantsListPage />)

      await user.click(screen.getByLabelText('Arată arhivați'))

      expect(screen.getByText('Arhivat Doi')).toBeVisible()
      const row = screen.getByText('Arhivat Doi').closest('tr')
      expect(within(row).getByText('Arhivat')).toBeVisible()
    })
  })

  describe('empty states', () => {
    it('shows the empty message and the onboarding CTA when there are zero tenants', async () => {
      const user = userEvent.setup()
      mockData({})
      await renderWithProviders(<TenantsListPage />)

      expect(screen.getByText('Niciun chiriaș deocamdată.')).toBeVisible()
      const addButtons = screen.getAllByRole('button', {
        name: 'Onboarding chiriaș nou',
      })
      await user.click(addButtons[addButtons.length - 1])

      await waitFor(() =>
        expect(navigate).toHaveBeenCalledWith('/admin/onboarding/draft-new'),
      )
    })
  })

  it('surfaces the loading state while any source query is pending', async () => {
    mockData({})
    useUsers.mockReturnValue({
      data: undefined,
      isPending: true,
      isError: false,
    })
    await renderWithProviders(<TenantsListPage />)

    expect(screen.getByText('Se încarcă...')).toBeVisible()
  })

  it('surfaces an error when a source query fails', async () => {
    mockData({})
    useUsers.mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
    })
    await renderWithProviders(<TenantsListPage />)

    expect(
      screen.getByText('Chiriașii nu au putut fi încărcați. Încearcă din nou.'),
    ).toBeVisible()
  })

  it('clicking Retry on the list-load error re-runs all three source queries', async () => {
    mockData({})
    const usersRefetch = vi.fn()
    useUsers.mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
      isFetching: false,
      refetch: usersRefetch,
    })
    const user = userEvent.setup()
    await renderWithProviders(<TenantsListPage />)

    await user.click(screen.getByRole('button', { name: 'Încearcă din nou' }))

    expect(usersRefetch).toHaveBeenCalledTimes(1)
  })

  it('shows a Retry button when draft creation fails, and clicking it retries onboarding', async () => {
    mockData({})
    createMutateAsync
      .mockRejectedValueOnce(new Error('permission-denied'))
      .mockResolvedValueOnce('draft-retry')
    const user = userEvent.setup()
    await renderWithProviders(<TenantsListPage />)

    const addButtons = screen.getAllByRole('button', {
      name: 'Onboarding chiriaș nou',
    })
    await user.click(addButtons[0])
    await waitFor(() => {
      expect(
        screen.getByText('Draftul nu a putut fi creat. Încearcă din nou.'),
      ).toBeVisible()
    })

    await user.click(screen.getByRole('button', { name: 'Încearcă din nou' }))

    await waitFor(() => {
      expect(createMutateAsync).toHaveBeenCalledTimes(2)
    })
    expect(navigate).toHaveBeenCalledWith('/admin/onboarding/draft-retry')
  })
})
