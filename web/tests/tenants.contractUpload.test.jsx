import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from './renderWithProviders'
import { ContractUpload } from '@/features/tenants/components/ContractUpload'

// Fast band — Storage + compression + the update hook are mocked, no emulator.
// Same conventions as tenants.photoGallery.test.jsx, EXCEPT: this component
// must NOT compress non-image files (would corrupt a PDF/doc) — the tests
// specifically pin that a PDF/doc upload never touches imageCompression, while
// an image upload still does (FR-DOC-05: images ARE compressed automatically).

vi.mock('@/lib/firebase', () => ({ storage: { __fake: 'storage' } }))

vi.mock('firebase/storage', () => ({
  ref: vi.fn((_storage, path) => ({ __ref: path })),
  uploadBytes: vi.fn(),
  getDownloadURL: vi.fn(),
  deleteObject: vi.fn(),
}))

vi.mock('browser-image-compression', () => ({
  default: vi.fn(),
}))

vi.mock('@/features/tenants/hooks', () => ({
  useUpdateTenancy: vi.fn(),
}))

import { deleteObject, getDownloadURL, uploadBytes } from 'firebase/storage'
import imageCompression from 'browser-image-compression'
import { useUpdateTenancy } from '@/features/tenants/hooks'

const mutate = vi.fn()

function documentRef(overrides) {
  return {
    url: 'https://storage.example/lease.pdf',
    name: 'lease.pdf',
    type: 'pdf',
    ...overrides,
  }
}

function makeFile({
  name = 'contract.pdf',
  size = 1024,
  type = 'application/pdf',
} = {}) {
  return new File(['x'.repeat(size)], name, { type })
}

const props = { tenancyId: 't1', userId: 'u1' }

beforeEach(() => {
  vi.clearAllMocks()
  useUpdateTenancy.mockReturnValue({ mutate, isPending: false })
  imageCompression.mockResolvedValue(
    new File(['compressed'], 'photo.jpg', { type: 'image/jpeg' }),
  )
  uploadBytes.mockResolvedValue({})
  getDownloadURL.mockResolvedValue(
    'https://storage.example/tenancies/t1/contract/new-contract.pdf',
  )
  deleteObject.mockResolvedValue(undefined)
})

describe('ContractUpload — rendering per document type (FR-CON-07, FR-DOC-01/03)', () => {
  it('renders an image document as a thumbnail', async () => {
    await renderWithProviders(
      <ContractUpload
        {...props}
        documents={[documentRef({ name: 'scan.jpg', type: 'image' })]}
      />,
    )

    expect(screen.getByRole('img', { name: 'scan.jpg' })).toBeVisible()
  })

  it('renders a PDF/doc document as an icon + name + link, not an <img>', async () => {
    await renderWithProviders(
      <ContractUpload {...props} documents={[documentRef()]} />,
    )

    expect(
      screen.queryByRole('img', { name: 'lease.pdf' }),
    ).not.toBeInTheDocument()
    const link = screen.getByRole('link', { name: /lease\.pdf/ })
    expect(link).toHaveAttribute('href', 'https://storage.example/lease.pdf')
  })
})

describe('ContractUpload — upload (FR-CON-07, FR-DOC-05)', () => {
  it('uploads a PDF WITHOUT compressing it, under /tenancies/{id}/contract/', async () => {
    const user = userEvent.setup()
    await renderWithProviders(<ContractUpload {...props} documents={[]} />)

    const input = document.querySelector('input[type="file"]')
    await user.upload(input, makeFile())

    await waitFor(() => expect(mutate).toHaveBeenCalled())
    expect(imageCompression).not.toHaveBeenCalled()
    expect(uploadBytes).toHaveBeenCalledTimes(1)
    const [objectRef] = uploadBytes.mock.calls[0]
    expect(objectRef.__ref).toMatch(/^tenancies\/t1\/contract\//)
    expect(mutate).toHaveBeenCalledWith({
      id: 't1',
      userId: 'u1',
      values: {
        attachedDocuments: [
          {
            url: 'https://storage.example/tenancies/t1/contract/new-contract.pdf',
            name: 'contract.pdf',
            type: 'pdf',
          },
        ],
      },
    })
  })

  it('uploads an image WITH compression (FR-DOC-05)', async () => {
    const user = userEvent.setup()
    await renderWithProviders(<ContractUpload {...props} documents={[]} />)

    const input = document.querySelector('input[type="file"]')
    await user.upload(input, makeFile({ name: 'scan.jpg', type: 'image/jpeg' }))

    await waitFor(() => expect(mutate).toHaveBeenCalled())
    expect(imageCompression).toHaveBeenCalledTimes(1)
    expect(mutate).toHaveBeenCalledWith({
      id: 't1',
      userId: 'u1',
      values: {
        attachedDocuments: [
          expect.objectContaining({ name: 'scan.jpg', type: 'image' }),
        ],
      },
    })
  })

  it('classifies a .docx upload as "doc" and does not compress it', async () => {
    const user = userEvent.setup()
    await renderWithProviders(<ContractUpload {...props} documents={[]} />)

    const input = document.querySelector('input[type="file"]')
    await user.upload(
      input,
      makeFile({
        name: 'contract.docx',
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      }),
    )

    await waitFor(() => expect(mutate).toHaveBeenCalled())
    expect(imageCompression).not.toHaveBeenCalled()
    expect(mutate).toHaveBeenCalledWith({
      id: 't1',
      userId: 'u1',
      values: {
        attachedDocuments: [
          expect.objectContaining({ name: 'contract.docx', type: 'doc' }),
        ],
      },
    })
  })

  it('rejects a file over 10MB without calling uploadBytes', async () => {
    const user = userEvent.setup()
    await renderWithProviders(<ContractUpload {...props} documents={[]} />)

    const input = document.querySelector('input[type="file"]')
    await user.upload(input, makeFile({ size: 11 * 1024 * 1024 }))

    expect(await screen.findByText(/10 MB/)).toBeVisible()
    expect(uploadBytes).not.toHaveBeenCalled()
    expect(mutate).not.toHaveBeenCalled()
  })
})

describe('ContractUpload — delete', () => {
  it('best-effort deletes the Storage object and removes the reference', async () => {
    const user = userEvent.setup()
    await renderWithProviders(
      <ContractUpload {...props} documents={[documentRef()]} />,
    )

    await user.click(screen.getByRole('button', { name: /șterge|delete/i }))

    expect(deleteObject).toHaveBeenCalled()
    expect(mutate).toHaveBeenCalledWith({
      id: 't1',
      userId: 'u1',
      values: { attachedDocuments: [] },
    })
  })

  it('removes the reference even when the Storage delete fails', async () => {
    deleteObject.mockRejectedValue(new Error('object not found'))
    const user = userEvent.setup()
    await renderWithProviders(
      <ContractUpload {...props} documents={[documentRef()]} />,
    )

    await user.click(screen.getByRole('button', { name: /șterge|delete/i }))

    await waitFor(() =>
      expect(mutate).toHaveBeenCalledWith({
        id: 't1',
        userId: 'u1',
        values: { attachedDocuments: [] },
      }),
    )
  })
})
