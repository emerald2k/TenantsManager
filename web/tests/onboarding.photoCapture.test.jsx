import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FormProvider, useForm } from 'react-hook-form'
import { renderWithProviders } from './renderWithProviders'
import { PhotoCapture } from '@/features/onboarding/components/PhotoCapture'

// Fast band — the boundary (Storage + compression) is mocked, no emulator. This
// file tests PhotoCapture in isolation, wrapped in its own tiny form host — the
// wizard-level wiring (Step 2 blocking Continue, Step 3 optional) is tested in
// onboarding.wizardPage.test.jsx instead.

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

vi.mock('@/features/onboarding/hooks', () => ({
  useUpdateDraft: vi.fn(),
}))

import {
  ref,
  uploadBytes,
  getDownloadURL,
  deleteObject,
} from 'firebase/storage'
import imageCompression from 'browser-image-compression'
import { useUpdateDraft } from '@/features/onboarding/hooks'

const updateMutate = vi.fn()

function Host({ defaultValues, ...props }) {
  const methods = useForm({ defaultValues })
  return (
    <FormProvider {...methods}>
      <PhotoCapture {...props} />
    </FormProvider>
  )
}

function renderPhotoCapture({
  defaultValues = { idDocumentPhotos: [] },
  fieldPath = 'idDocumentPhotos',
  required = true,
  draftId = 'draft-1',
} = {}) {
  return renderWithProviders(
    <Host
      defaultValues={defaultValues}
      fieldPath={fieldPath}
      required={required}
      draftId={draftId}
    />,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  useUpdateDraft.mockReturnValue({ mutate: updateMutate, isPending: false })
  imageCompression.mockResolvedValue(
    new File(['compressed'], 'front.jpg', { type: 'image/jpeg' }),
  )
  uploadBytes.mockResolvedValue({})
  // Echoes the resolved path back — lets each test predict the img src from
  // the fixture's own `path`, instead of a single fixed URL for everything.
  getDownloadURL.mockImplementation((objectRef) =>
    Promise.resolve(`https://storage.example/resolved/${objectRef.__ref}`),
  )
  deleteObject.mockResolvedValue(undefined)
})

function makeFile({
  name = 'front.jpg',
  size = 1024,
  type = 'image/jpeg',
} = {}) {
  const file = new File(['x'.repeat(size)], name, { type })
  return file
}

describe('PhotoCapture', () => {
  it('renders the capture button and a hidden file input with the capture attribute', async () => {
    await renderPhotoCapture()

    expect(
      screen.getByRole('button', { name: 'Fotografiază documentul' }),
    ).toBeInTheDocument()
    const input = document.querySelector('input[type="file"]')
    expect(input).toHaveAttribute('accept', 'image/*')
    expect(input).toHaveAttribute('capture')
    expect(input).toHaveClass('hidden')
  })

  it('compresses and uploads a selected file, then adds the reference to the array', async () => {
    const user = userEvent.setup()
    await renderPhotoCapture()

    const input = document.querySelector('input[type="file"]')
    await user.upload(input, makeFile())

    await waitFor(() => expect(updateMutate).toHaveBeenCalled())

    expect(imageCompression).toHaveBeenCalledTimes(1)
    expect(uploadBytes).toHaveBeenCalledTimes(1)
    expect(updateMutate).toHaveBeenCalledWith({
      id: 'draft-1',
      values: {
        idDocumentPhotos: [
          {
            path: expect.stringMatching(/^drafts\/draft-1\/.*-front\.jpg$/),
            name: 'front.jpg',
            type: 'image',
          },
        ],
      },
    })
    // The thumbnail resolves the persisted path -> url via useAttachmentUrl —
    // async (TanStack Query), so it appears only after that resolves.
    expect(
      await screen.findByRole('img', { name: 'front.jpg' }),
    ).toBeInTheDocument()
  })

  it('deletes a photo: best-effort Storage cleanup, reference removed even if cleanup fails', async () => {
    const user = userEvent.setup()
    deleteObject.mockRejectedValue(new Error('storage/unauthorized'))
    await renderPhotoCapture({
      defaultValues: {
        idDocumentPhotos: [
          {
            path: 'drafts/draft-1/a.jpg',
            name: 'a.jpg',
            type: 'image',
          },
        ],
      },
    })
    await screen.findByRole('img', { name: 'a.jpg' })

    await user.click(screen.getByRole('button', { name: 'Șterge' }))

    await waitFor(() => expect(deleteObject).toHaveBeenCalledTimes(1))
    expect(ref).toHaveBeenCalledWith(
      { __fake: 'storage' },
      'drafts/draft-1/a.jpg',
    )
    await waitFor(() =>
      expect(updateMutate).toHaveBeenCalledWith({
        id: 'draft-1',
        values: { idDocumentPhotos: [] },
      }),
    )
    expect(screen.queryByRole('img', { name: 'a.jpg' })).toBeNull()
  })

  it('a photo whose URL fails to resolve (Storage rule denial) renders inert "unavailable" text, never a broken/dead <img>', async () => {
    getDownloadURL.mockRejectedValue(new Error('storage/unauthorized'))
    await renderPhotoCapture({
      defaultValues: {
        idDocumentPhotos: [
          {
            path: 'drafts/draft-1/a.jpg',
            name: 'a.jpg',
            type: 'image',
          },
        ],
      },
    })

    expect(await screen.findByText('Indisponibil')).toBeInTheDocument()
    expect(screen.queryByRole('img', { name: 'a.jpg' })).toBeNull()
  })

  it('rejects a file over 10MB with a clear message, before compressing', async () => {
    const user = userEvent.setup()
    await renderPhotoCapture()

    const input = document.querySelector('input[type="file"]')
    await user.upload(input, makeFile({ size: 11 * 1024 * 1024 }))

    await waitFor(() =>
      expect(screen.getByText('Fișierul depășește 10 MB.')).toBeInTheDocument(),
    )
    expect(imageCompression).not.toHaveBeenCalled()
    expect(uploadBytes).not.toHaveBeenCalled()
    expect(updateMutate).not.toHaveBeenCalled()
  })

  it('defaults an undefined array (field absent from defaultValues) to empty, without crashing', async () => {
    await renderPhotoCapture({
      defaultValues: {},
      fieldPath: 'guarantor.idDocumentPhotos',
      required: false,
    })

    expect(
      screen.getByRole('button', { name: 'Fotografiază documentul' }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('img')).toBeNull()
  })
})
