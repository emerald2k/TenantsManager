import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { renderWithProviders } from './renderWithProviders'
import { PropertyDetailPage } from '@/features/properties/pages/PropertyDetailPage'
import {
  useAddService,
  useArchiveProperty,
  useProperty,
  useRemoveService,
  useUpdateProperty,
} from '@/features/properties/hooks'

// Fast band — the boundary (the hooks) is mocked, no emulator.
//
// The factory must list EVERY hook the page calls: `vi.mock` replaces the whole
// module, so a hook left out comes back undefined and the page crashes at render.
vi.mock('@/features/properties/hooks', () => ({
  useProperty: vi.fn(),
  useUpdateProperty: vi.fn(),
  useAddService: vi.fn(),
  useRemoveService: vi.fn(),
  useArchiveProperty: vi.fn(),
}))

/** The shape a real `useMutation` returns, reduced to what the page touches. */
function mockMutation() {
  return {
    mutate: vi.fn(),
    mutateAsync: vi.fn().mockResolvedValue(undefined),
    isPending: false,
  }
}

const ELECTRICITY = {
  serviceId: 'electricity',
  name: 'Electricitate',
  source: 'catalog',
}

const PROPERTY = {
  id: 'p1',
  name: 'Apartament Centru',
  address: {
    street: 'Str. Lalelelor',
    number: '12',
    city: 'Cluj-Napoca',
    county: 'Cluj',
    postalCode: '400001',
  },
  area: '65',
  roomCount: '3',
  services: [],
  status: 'free',
  archived: false,
}

let updateMutation
let addMutation
let removeMutation
let archiveMutation

beforeEach(() => {
  vi.clearAllMocks()
  updateMutation = mockMutation()
  addMutation = mockMutation()
  removeMutation = mockMutation()
  archiveMutation = mockMutation()
  useUpdateProperty.mockReturnValue(updateMutation)
  useAddService.mockReturnValue(addMutation)
  useRemoveService.mockReturnValue(removeMutation)
  useArchiveProperty.mockReturnValue(archiveMutation)
})

async function renderPage(property = PROPERTY) {
  useProperty.mockReturnValue({
    data: property,
    isPending: false,
    isError: false,
  })

  return renderWithProviders(
    <Routes>
      <Route path="/admin/properties/:id" element={<PropertyDetailPage />} />
    </Routes>,
    { route: `/admin/properties/${property.id}` },
  )
}

describe('PropertyDetailPage', () => {
  it('shows the not-found message when the property does not exist', async () => {
    // The shape `useProperty` really produces for a missing id: B's hook throws
    // when the snapshot does not exist, so react-query lands on isError with no
    // data — it does not resolve to undefined.
    useProperty.mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
    })

    await renderWithProviders(
      <Routes>
        <Route path="/admin/properties/:id" element={<PropertyDetailPage />} />
      </Routes>,
      { route: '/admin/properties/does-not-exist' },
    )

    expect(screen.getByText('Această proprietate nu există.')).toBeVisible()
    // No crash, and no property rendered: the name would come through as the
    // page's only heading.
    expect(screen.queryByRole('heading')).toBeNull()
  })

  describe('data section (FR-PROP-04)', () => {
    it('shows the data read-only until Edit is clicked', async () => {
      const user = userEvent.setup()
      await renderPage()

      // Read-only view: the values are text, not inputs.
      expect(screen.getByText('Str. Lalelelor')).toBeVisible()
      expect(screen.queryByLabelText('Nume')).toBeNull()

      await user.click(screen.getByRole('button', { name: 'Editează' }))

      expect(screen.getByLabelText('Nume')).toHaveValue('Apartament Centru')
      expect(screen.getByLabelText('Stradă')).toHaveValue('Str. Lalelelor')
    })

    it('saves the edited data and returns to the read-only view', async () => {
      const user = userEvent.setup()
      await renderPage()

      await user.click(screen.getByRole('button', { name: 'Editează' }))
      const name = screen.getByLabelText('Nume')
      await user.clear(name)
      await user.type(name, 'Apartament Nord')
      await user.click(
        screen.getByRole('button', { name: 'Salvează modificările' }),
      )

      await waitFor(() => {
        expect(updateMutation.mutateAsync).toHaveBeenCalledWith({
          id: 'p1',
          values: expect.objectContaining({
            name: 'Apartament Nord',
            address: expect.objectContaining({ city: 'Cluj-Napoca' }),
          }),
        })
      })

      // Back to the view: the form is gone, Edit is offered again.
      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Editează' })).toBeVisible()
      })
      expect(screen.queryByLabelText('Nume')).toBeNull()
    })

    it('blocks the save and shows presence errors when a required field is empty', async () => {
      const user = userEvent.setup()
      await renderPage()

      await user.click(screen.getByRole('button', { name: 'Editează' }))
      await user.clear(screen.getByLabelText('Nume'))
      await user.click(
        screen.getByRole('button', { name: 'Salvează modificările' }),
      )

      expect(await screen.findByText('Câmp obligatoriu')).toBeVisible()
      expect(updateMutation.mutateAsync).not.toHaveBeenCalled()
      // Still in edit mode — the typed data is not thrown away.
      expect(screen.getByLabelText('Nume')).toBeVisible()
    })
  })

  describe('services section (FR-PROP-02)', () => {
    it('adds a catalog service with its snapshot name', async () => {
      const user = userEvent.setup()
      await renderPage()

      expect(screen.getByText('Niciun serviciu deocamdată.')).toBeVisible()

      await user.click(screen.getByRole('button', { name: 'Adaugă serviciu' }))
      const dialog = await screen.findByRole('dialog')
      await user.click(
        within(dialog).getByRole('button', { name: 'Electricitate' }),
      )

      expect(addMutation.mutate).toHaveBeenCalledWith({
        propertyId: 'p1',
        service: ELECTRICITY,
      })
    })

    it('adds a custom service with source custom', async () => {
      const user = userEvent.setup()
      await renderPage()

      await user.click(screen.getByRole('button', { name: 'Adaugă serviciu' }))
      const dialog = await screen.findByRole('dialog')
      await user.type(
        within(dialog).getByLabelText('Serviciu personalizat'),
        'Curățenie scară',
      )
      await user.click(within(dialog).getByRole('button', { name: 'Adaugă' }))

      // The serviceId is a generated uuid — assert its presence, not its value.
      expect(addMutation.mutate).toHaveBeenCalledWith({
        propertyId: 'p1',
        service: expect.objectContaining({
          name: 'Curățenie scară',
          source: 'custom',
          serviceId: expect.any(String),
        }),
      })
    })

    it('removes a service only after the confirmation is accepted', async () => {
      const user = userEvent.setup()
      await renderPage({ ...PROPERTY, services: [ELECTRICITY] })

      await user.click(screen.getByRole('button', { name: 'Elimină' }))
      const dialog = await screen.findByRole('dialog')
      await user.click(within(dialog).getByRole('button', { name: 'Elimină' }))

      // The STORED element, passed through untouched — arrayRemove matches by value.
      expect(removeMutation.mutate).toHaveBeenCalledWith({
        propertyId: 'p1',
        service: ELECTRICITY,
      })
    })

    it('does not remove the service when the confirmation is cancelled', async () => {
      const user = userEvent.setup()
      await renderPage({ ...PROPERTY, services: [ELECTRICITY] })

      await user.click(screen.getByRole('button', { name: 'Elimină' }))
      const dialog = await screen.findByRole('dialog')
      await user.click(within(dialog).getByRole('button', { name: 'Anulează' }))

      expect(removeMutation.mutate).not.toHaveBeenCalled()
    })
  })

  describe('archiving section (FR-PROP-06)', () => {
    it('archives the property after the confirmation is accepted', async () => {
      const user = userEvent.setup()
      await renderPage()

      await user.click(screen.getByRole('button', { name: 'Arhivează' }))
      const dialog = await screen.findByRole('dialog')
      await user.click(
        within(dialog).getByRole('button', { name: 'Arhivează' }),
      )

      // Soft-delete: the hook sets archived:true, it does NOT delete (FR-PROP-06).
      expect(archiveMutation.mutate).toHaveBeenCalledWith('p1')
    })

    it('blocks archiving while the property is occupied', async () => {
      // At sub-stage D every property is 'free'; this guard activates at M2, when
      // tenancies compute `status`. The mock is what lets us test it now.
      await renderPage({ ...PROPERTY, status: 'occupied' })

      expect(screen.getByRole('button', { name: 'Arhivează' })).toBeDisabled()
      expect(
        screen.getByText(
          'O proprietate ocupată nu poate fi arhivată. Încheie mai întâi închirierea.',
        ),
      ).toBeVisible()
      // A disabled button cannot open the dialog, so the mutation stays untouched.
      expect(screen.queryByRole('dialog')).toBeNull()
      expect(archiveMutation.mutate).not.toHaveBeenCalled()
    })
  })

  describe('cost history placeholder', () => {
    it('shows the empty state (the real table lands at M6)', async () => {
      await renderPage()

      expect(
        screen.getByText(
          'Istoricul costurilor va fi disponibil după ce există rapoarte lunare.',
        ),
      ).toBeVisible()
    })
  })
})
