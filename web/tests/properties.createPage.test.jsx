import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from './renderWithProviders'
import { CreatePropertyPage } from '@/features/properties/pages/CreatePropertyPage'
import { useCreateProperty } from '@/features/properties/hooks'

// Fast band — the BOUNDARY IS MOCKED, no emulator. We mock the hook, not
// `firebase/firestore`: the hook IS the boundary the page talks to, and B already
// covers what it does with Firestore. Here we check only what the page does — which
// payload it sends, and where it navigates afterwards.
vi.mock('@/features/properties/hooks', () => ({
  useCreateProperty: vi.fn(),
}))

// PARTIAL mock: `renderWithProviders` mounts a real MemoryRouter, so replacing the
// whole module would take the router down with it. We swap out `useNavigate` alone.
const navigate = vi.fn()
vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal()),
  useNavigate: () => navigate,
}))

const mutateAsync = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  mutateAsync.mockResolvedValue('new-id')
  useCreateProperty.mockReturnValue({ mutateAsync, isPending: false })
})

/** The mandatory fields, filled in with the least that passes presence-only. */
async function fillRequired(user) {
  await user.type(screen.getByLabelText('Nume'), 'Apartament Unirii')
  await user.type(screen.getByLabelText('Stradă'), 'Bd. Unirii')
  await user.type(screen.getByLabelText('Număr'), '12')
  await user.type(screen.getByLabelText('Oraș'), 'București')
  await user.type(screen.getByLabelText('Județ'), 'Ilfov')
}

function submitButton() {
  return screen.getByRole('button', { name: 'Creează proprietatea' })
}

describe('CreatePropertyPage', () => {
  it('shows presence errors and does not call the mutation when required fields are empty', async () => {
    const user = userEvent.setup()
    await renderWithProviders(<CreatePropertyPage />)

    await user.click(submitButton())

    // One error per mandatory field: name + the four address ones.
    await waitFor(() => {
      expect(screen.getAllByText('Câmp obligatoriu')).toHaveLength(5)
    })
    expect(mutateAsync).not.toHaveBeenCalled()
    expect(navigate).not.toHaveBeenCalled()
  })

  it('renders the validation errors in the active language', async () => {
    const user = userEvent.setup()
    await renderWithProviders(<CreatePropertyPage />, { language: 'en' })

    await user.click(screen.getByRole('button', { name: 'Create property' }))

    // The schema hands back i18n keys; if the page forgot to translate them, the
    // raw key 'properties.errors.required' would show up instead of this text.
    await waitFor(() => {
      expect(screen.getAllByText('Required field')).toHaveLength(5)
    })
    expect(screen.queryByText('properties.errors.required')).toBeNull()
  })

  it('sends the property payload and redirects to the new property on success', async () => {
    const user = userEvent.setup()
    await renderWithProviders(<CreatePropertyPage />)

    await fillRequired(user)
    await user.type(screen.getByLabelText(/Cod poștal/), '030833')
    await user.type(screen.getByLabelText(/Suprafață/), '65')
    await user.type(screen.getByLabelText(/Număr camere/), '3')
    await user.click(submitButton())

    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledWith({
        name: 'Apartament Unirii',
        address: {
          street: 'Bd. Unirii',
          number: '12',
          city: 'București',
          county: 'Ilfov',
          postalCode: '030833',
        },
        area: '65',
        roomCount: '3',
      })
    })

    // NO `services` in the payload: they are added at D, on an existing property.
    expect(mutateAsync.mock.calls[0][0]).not.toHaveProperty('services')

    // The id comes back from the mutation and decides the destination.
    await waitFor(() => {
      expect(navigate).toHaveBeenCalledWith('/admin/properties/new-id')
    })
  })

  it('submits with the optional fields left empty', async () => {
    const user = userEvent.setup()
    await renderWithProviders(<CreatePropertyPage />)

    await fillRequired(user)
    await user.click(submitButton())

    // The optionals travel as empty strings — the schema does not turn '' into
    // undefined, and the page must not strip them on its own.
    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Apartament Unirii',
          area: '',
          roomCount: '',
          address: expect.objectContaining({ postalCode: '' }),
        }),
      )
    })
    expect(screen.queryByText('Câmp obligatoriu')).toBeNull()
    await waitFor(() => {
      expect(navigate).toHaveBeenCalledWith('/admin/properties/new-id')
    })
  })

  it('keeps the user on the form and reports the failure when the write fails', async () => {
    const user = userEvent.setup()
    mutateAsync.mockRejectedValue(new Error('permission-denied'))
    await renderWithProviders(<CreatePropertyPage />)

    await fillRequired(user)
    await user.click(submitButton())

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Proprietatea nu a putut fi salvată. Încearcă din nou.',
      )
    })
    expect(navigate).not.toHaveBeenCalled()
  })

  it('disables the submit button while the write is in flight', async () => {
    useCreateProperty.mockReturnValue({ mutateAsync, isPending: true })
    await renderWithProviders(<CreatePropertyPage />)

    expect(screen.getByRole('button', { name: 'Se încarcă...' })).toBeDisabled()
  })
})
