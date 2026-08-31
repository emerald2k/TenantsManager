import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from './renderWithProviders'
import { PhotoGallery } from '@/features/tenants/components/PhotoGallery'

// Fast band — Storage + compression + the update hook are mocked, no emulator.
// Same conventions as onboarding.photoCapture.test.jsx, adapted for a FINALIZED
// user (no draftId, no RHF form context — PhotoGallery is a standalone,
// self-contained gallery, not tied to a wizard step).

vi.mock('@/lib/firebase', () => ({ storage: { __fake: 'storage' } }))

vi.mock('firebase/storage', () => ({
  ref: vi.fn((_storage, path) => ({ __ref: path, fullPath: path })),
  uploadBytes: vi.fn(),
  getDownloadURL: vi.fn(),
  deleteObject: vi.fn(),
}))

vi.mock('browser-image-compression', () => ({
  default: vi.fn(),
}))

vi.mock('@/features/tenants/hooks', () => ({
  useUpdateUser: vi.fn(),
}))

import {
  deleteObject,
  getDownloadURL,
  ref,
  uploadBytes,
} from 'firebase/storage'
import imageCompression from 'browser-image-compression'
import { useUpdateUser } from '@/features/tenants/hooks'

const mutate = vi.fn()

function photo(overrides) {
  return {
    path: 'users/u1/documents/a.jpg',
    name: 'a.jpg',
    type: 'image',
    ...overrides,
  }
}

function makeFile({ name = 'new.jpg', size = 1024, type = 'image/jpeg' } = {}) {
  return new File(['x'.repeat(size)], name, { type })
}

beforeEach(() => {
  vi.clearAllMocks()
  useUpdateUser.mockReturnValue({ mutate, isPending: false })
  imageCompression.mockResolvedValue(
    new File(['compressed'], 'new.jpg', { type: 'image/jpeg' }),
  )
  uploadBytes.mockResolvedValue({})
  // Echoes the resolved path back — lets each test predict the rendered
  // src/href from the fixture's own `path`, instead of one fixed URL.
  getDownloadURL.mockImplementation((objectRef) =>
    Promise.resolve(`https://storage.example/resolved/${objectRef.__ref}`),
  )
  deleteObject.mockResolvedValue(undefined)
})

describe('PhotoGallery — tenant ID photos (min 1, FR-TEN-03/06)', () => {
  const props = {
    userId: 'u1',
    fieldPath: 'idDocumentPhotos',
    storageFolder: 'documents',
    minCount: 1,
  }

  it('renders a thumbnail per photo', async () => {
    await renderWithProviders(
      <PhotoGallery
        {...props}
        photos={[
          photo({ name: 'a.jpg' }),
          photo({ name: 'b.jpg', path: 'users/u1/documents/b.jpg' }),
        ]}
      />,
    )

    expect(await screen.findByRole('img', { name: 'a.jpg' })).toBeVisible()
    expect(await screen.findByRole('img', { name: 'b.jpg' })).toBeVisible()
  })

  it('a photo whose URL fails to resolve (Storage rule denial) renders inert "unavailable" text, never a broken <img>', async () => {
    getDownloadURL.mockRejectedValue(new Error('storage/unauthorized'))

    await renderWithProviders(<PhotoGallery {...props} photos={[photo()]} />)

    expect(await screen.findByText('Indisponibil')).toBeInTheDocument()
    expect(screen.queryByRole('img', { name: 'a.jpg' })).toBeNull()
  })

  it('a photo whose URL resolves but whose bytes are not an image shows an explicit error + retry, not a broken <img> (audit #2)', async () => {
    await renderWithProviders(<PhotoGallery {...props} photos={[photo()]} />)

    const thumbnail = await screen.findByRole('img', { name: 'a.jpg' })
    fireEvent.error(thumbnail)

    expect(
      await screen.findByText('Imaginea nu a putut fi încărcată'),
    ).toBeVisible()
    expect(screen.queryByRole('img', { name: 'a.jpg' })).toBeNull()
    expect(
      screen.getByRole('button', { name: /Încearcă din nou/ }),
    ).toBeVisible()
  })

  it('opens a lightbox with the full image when a thumbnail is clicked', async () => {
    const user = userEvent.setup()
    await renderWithProviders(<PhotoGallery {...props} photos={[photo()]} />)

    await user.click(await screen.findByRole('img', { name: 'a.jpg' }))

    const dialog = await screen.findByRole('dialog')
    expect(
      await within(dialog).findByRole('img', { name: 'a.jpg' }),
    ).toBeVisible()
  })

  it('uploads a new photo: compresses, uploads under /users/{userId}/{folder}/, and appends the reference', async () => {
    const user = userEvent.setup()
    await renderWithProviders(<PhotoGallery {...props} photos={[photo()]} />)
    await screen.findByRole('img', { name: 'a.jpg' })

    const input = document.querySelector('input[type="file"]')
    await user.upload(input, makeFile())

    await waitFor(() => expect(mutate).toHaveBeenCalled())
    expect(imageCompression).toHaveBeenCalledTimes(1)
    expect(uploadBytes).toHaveBeenCalledTimes(1)
    // The Storage path is under /users/{userId}/{storageFolder}/ — NOT /drafts/.
    const [objectRef] = uploadBytes.mock.calls[0]
    expect(objectRef.__ref).toMatch(/^users\/u1\/documents\//)
    expect(mutate).toHaveBeenCalledWith({
      id: 'u1',
      values: {
        idDocumentPhotos: [
          photo(),
          {
            path: expect.stringMatching(/^users\/u1\/documents\/.*-new\.jpg$/),
            name: 'new.jpg',
            type: 'image',
          },
        ],
      },
    })
  })

  it('deletes a photo above the minimum: best-effort Storage cleanup, reference removed', async () => {
    const user = userEvent.setup()
    await renderWithProviders(
      <PhotoGallery
        {...props}
        photos={[
          photo({ name: 'a.jpg' }),
          photo({ name: 'b.jpg', path: 'users/u1/documents/b.jpg' }),
        ]}
      />,
    )
    const thumbnail = await screen.findByRole('img', { name: 'a.jpg' })

    await user.click(
      within(thumbnail.closest('div')).getByRole('button', {
        name: 'Șterge',
      }),
    )

    await waitFor(() => expect(deleteObject).toHaveBeenCalledTimes(1))
    expect(ref).toHaveBeenCalledWith(
      { __fake: 'storage' },
      'users/u1/documents/a.jpg',
    )
    expect(mutate).toHaveBeenCalledWith({
      id: 'u1',
      values: {
        idDocumentPhotos: [
          photo({ name: 'b.jpg', path: 'users/u1/documents/b.jpg' }),
        ],
      },
    })
  })

  // The invariant (FR-TEN-03/06): a tenant must keep at least one ID photo.
  // Anti-vacuity: if the guard were removed, the delete button would be enabled
  // and clicking it would call mutate — this test fails in that case.
  it('blocks deleting the LAST tenant photo: no delete button, mutate never called', async () => {
    await renderWithProviders(<PhotoGallery {...props} photos={[photo()]} />)
    await screen.findByRole('img', { name: 'a.jpg' })

    const deleteButton = screen.queryByRole('button', { name: 'Șterge' })
    expect(deleteButton == null || deleteButton.disabled).toBe(true)
    expect(mutate).not.toHaveBeenCalled()
  })
})

describe('PhotoGallery — guarantor photos (min 0, FR-TEN-04/06)', () => {
  const props = {
    userId: 'u1',
    fieldPath: 'guarantor.idDocumentPhotos',
    storageFolder: 'guarantor',
    minCount: 0,
  }

  it('allows deleting the LAST guarantor photo, down to zero', async () => {
    const user = userEvent.setup()
    await renderWithProviders(<PhotoGallery {...props} photos={[photo()]} />)

    await user.click(screen.getByRole('button', { name: 'Șterge' }))

    await waitFor(() =>
      expect(mutate).toHaveBeenCalledWith({
        id: 'u1',
        values: { 'guarantor.idDocumentPhotos': [] },
      }),
    )
  })

  it('uploads under /users/{userId}/guarantor/', async () => {
    const user = userEvent.setup()
    await renderWithProviders(<PhotoGallery {...props} photos={[]} />)

    const input = document.querySelector('input[type="file"]')
    await user.upload(input, makeFile())

    await waitFor(() => expect(mutate).toHaveBeenCalled())
    const [objectRef] = uploadBytes.mock.calls[0]
    expect(objectRef.__ref).toMatch(/^users\/u1\/guarantor\//)
    expect(mutate).toHaveBeenCalledWith({
      id: 'u1',
      values: {
        'guarantor.idDocumentPhotos': [
          {
            path: expect.stringMatching(/^users\/u1\/guarantor\/.*-new\.jpg$/),
            name: 'new.jpg',
            type: 'image',
          },
        ],
      },
    })
  })

  it('renders an empty gallery without crashing (no photos yet)', async () => {
    await renderWithProviders(<PhotoGallery {...props} photos={[]} />)

    expect(screen.queryByRole('img')).toBeNull()
    expect(screen.getByRole('button', { name: 'Adaugă poză' })).toBeVisible()
  })
})
