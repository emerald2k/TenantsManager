import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from './renderWithProviders'
import { ProfileTab } from '@/features/tenants/components/ProfileTab'
import { useUpdateUser } from '@/features/tenants/hooks'

// Fast band — `useUpdateUser` and `PhotoGallery` are mocked. `PhotoGallery`'s own
// behavior (lightbox, upload, delete, the min-photo invariant) is already fully
// covered by tenants.photoGallery.test.jsx; here we only check that ProfileTab
// WIRES it with the right props per section — re-testing its internals through
// two more instances would be redundant, not more thorough.
vi.mock('@/features/tenants/hooks', () => ({
  useUpdateUser: vi.fn(),
}))
vi.mock('@/features/tenants/components/PhotoGallery', () => ({
  PhotoGallery: (props) => (
    <div
      data-testid={`gallery-${props.fieldPath}`}
      data-min-count={props.minCount}
      data-storage-folder={props.storageFolder}
      data-photo-count={props.photos.length}
    />
  ),
}))

const mutateAsync = vi.fn()

function baseUser(overrides) {
  return {
    id: 'u1',
    name: 'Ana Pop',
    dateOfBirth: '1990-01-01',
    cnp: '1234567890123',
    phone: '0712000111',
    email: 'ana@example.com',
    preferredLanguage: 'ro',
    mailingAddress: '',
    previousAddress: 'Str. Veche 1',
    emergencyContact: { name: 'Ion Pop', phone: '0722000111' },
    occupantCount: 2,
    smoker: false,
    pets: { has: false, type: '' },
    vehicle: { has: false, make: '', plateNumber: '' },
    idDocumentPhotos: [
      { url: 'https://x/a.jpg', name: 'a.jpg', type: 'image' },
    ],
    employer: 'SC Exemplu SRL',
    occupation: 'Contabil',
    employmentDuration: 3,
    monthlyIncome: { source: 'Salariu', amount: 3000 },
    guarantor: {
      name: 'Maria Ionescu',
      cnp: '9876543210123',
      phone: '0733000111',
      idDocumentPhotos: [],
    },
    previousReference: { name: 'Vasile Pop', phone: '0744000111' },
    status: 'active',
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mutateAsync.mockResolvedValue(undefined)
  useUpdateUser.mockReturnValue({ mutateAsync, isPending: false })
})

describe('ProfileTab — view mode', () => {
  it('renders the personal, financial, guarantor and previous-reference data', async () => {
    await renderWithProviders(<ProfileTab user={baseUser()} userId="u1" />)

    expect(screen.getByText('Ana Pop')).toBeVisible()
    expect(screen.getByText('1234567890123')).toBeVisible()
    expect(screen.getByText('SC Exemplu SRL')).toBeVisible()
    expect(screen.getByText('Maria Ionescu')).toBeVisible()
    expect(screen.getByText('Vasile Pop')).toBeVisible()
    expect(screen.getByText('Română')).toBeVisible()
  })

  it('wires the tenant photo gallery with min 1 and the guarantor gallery with min 0', async () => {
    await renderWithProviders(<ProfileTab user={baseUser()} userId="u1" />)

    const tenantGallery = screen.getByTestId('gallery-idDocumentPhotos')
    expect(tenantGallery.dataset.minCount).toBe('1')
    expect(tenantGallery.dataset.storageFolder).toBe('documents')
    expect(tenantGallery.dataset.photoCount).toBe('1')

    const guarantorGallery = screen.getByTestId(
      'gallery-guarantor.idDocumentPhotos',
    )
    expect(guarantorGallery.dataset.minCount).toBe('0')
    expect(guarantorGallery.dataset.storageFolder).toBe('guarantor')
  })
})

describe('ProfileTab — personal section edit', () => {
  it('saves the personal section and calls the update hook with the new values', async () => {
    const user = userEvent.setup()
    await renderWithProviders(<ProfileTab user={baseUser()} userId="u1" />)

    await user.click(screen.getAllByRole('button', { name: 'Editează' })[0])
    const phoneInput = screen.getByLabelText('Telefon')
    await user.clear(phoneInput)
    await user.type(phoneInput, '0799999999')
    await user.click(screen.getByRole('button', { name: 'Salvează' }))

    await waitFor(() => expect(mutateAsync).toHaveBeenCalled())
    const [{ id, values }] = mutateAsync.mock.calls[0]
    expect(id).toBe('u1')
    expect(values.phone).toBe('0799999999')
    expect(values.name).toBe('Ana Pop')
  })

  it('blocks saving when a mandatory field is emptied (anti-vacuity)', async () => {
    const user = userEvent.setup()
    await renderWithProviders(<ProfileTab user={baseUser()} userId="u1" />)

    await user.click(screen.getAllByRole('button', { name: 'Editează' })[0])
    const nameInput = screen.getByLabelText('Nume complet')
    await user.clear(nameInput)
    await user.click(screen.getByRole('button', { name: 'Salvează' }))

    expect(screen.getByText('Câmp obligatoriu')).toBeVisible()
    expect(mutateAsync).not.toHaveBeenCalled()
  })

  it('discards changes on cancel', async () => {
    const user = userEvent.setup()
    await renderWithProviders(<ProfileTab user={baseUser()} userId="u1" />)

    await user.click(screen.getAllByRole('button', { name: 'Editează' })[0])
    await user.click(screen.getByRole('button', { name: 'Anulează' }))

    expect(mutateAsync).not.toHaveBeenCalled()
    expect(screen.getByText('Ana Pop')).toBeVisible()
  })
})

describe('ProfileTab — preferred language edit', () => {
  it('saves the new language', async () => {
    const user = userEvent.setup()
    await renderWithProviders(<ProfileTab user={baseUser()} userId="u1" />)

    // Language is its own section — its heading and its field label both read
    // "Limba preferată" (same i18n string), so disambiguate via the heading role.
    const languageSection = screen
      .getByRole('heading', { name: 'Limba preferată' })
      .closest('section')
    await user.click(
      within(languageSection).getByRole('button', { name: 'Editează' }),
    )
    await user.selectOptions(
      within(languageSection).getByRole('combobox'),
      'en',
    )
    await user.click(
      within(languageSection).getByRole('button', { name: 'Salvează' }),
    )

    await waitFor(() => expect(mutateAsync).toHaveBeenCalled())
    expect(mutateAsync).toHaveBeenCalledWith({
      id: 'u1',
      values: { preferredLanguage: 'en' },
    })
  })
})

describe('ProfileTab — guarantor section edit (regression: must not wipe photos)', () => {
  it('saves the guarantor TEXT fields as dot-path keys, never a whole-object write', async () => {
    const user = userEvent.setup()
    await renderWithProviders(<ProfileTab user={baseUser()} userId="u1" />)

    const guarantorSection = screen
      .getByText('Maria Ionescu')
      .closest('section')
    await user.click(
      within(guarantorSection).getByRole('button', { name: 'Editează' }),
    )
    const phoneInput = within(guarantorSection).getByLabelText('Telefon garant')
    await user.clear(phoneInput)
    await user.type(phoneInput, '0755000111')
    await user.click(
      within(guarantorSection).getByRole('button', { name: 'Salvează' }),
    )

    await waitFor(() => expect(mutateAsync).toHaveBeenCalled())
    const [{ values }] = mutateAsync.mock.calls[0]
    // Dot-path keys only — no top-level `guarantor` object that would replace
    // (and silently drop) `guarantor.idDocumentPhotos`.
    expect(values).not.toHaveProperty('guarantor')
    expect(values['guarantor.name']).toBe('Maria Ionescu')
    expect(values['guarantor.cnp']).toBe('9876543210123')
    expect(values['guarantor.phone']).toBe('0755000111')
  })
})
