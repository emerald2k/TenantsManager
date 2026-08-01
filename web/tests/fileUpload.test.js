import { beforeEach, describe, expect, it, vi } from 'vitest'

// Fast band — Storage + compression mocked, no emulator (same convention as
// tenants.contractUpload.test.jsx, which this module was extracted from).

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

import {
  deleteObject,
  getDownloadURL,
  ref,
  uploadBytes,
} from 'firebase/storage'
import imageCompression from 'browser-image-compression'
import {
  MAX_UPLOAD_SIZE_BYTES,
  classifyFileType,
  deleteAttachmentBestEffort,
  uploadAttachment,
} from '@/lib/fileUpload'

function makeFile({ name = 'file.bin', size = 1024, type = '' } = {}) {
  return new File(['x'.repeat(size)], name, { type })
}

beforeEach(() => {
  vi.clearAllMocks()
  imageCompression.mockResolvedValue(
    new File(['compressed'], 'photo.jpg', { type: 'image/jpeg' }),
  )
  uploadBytes.mockResolvedValue({})
  getDownloadURL.mockResolvedValue(
    'https://storage.example/reports/r1/invoices/photo.jpg',
  )
  deleteObject.mockResolvedValue(undefined)
})

describe('classifyFileType (FR-DOC-01/03, from MIME)', () => {
  it('classifies any image/* MIME as image', () => {
    expect(classifyFileType(makeFile({ type: 'image/jpeg' }))).toBe('image')
    expect(classifyFileType(makeFile({ type: 'image/png' }))).toBe('image')
  })

  it('classifies application/pdf as pdf', () => {
    expect(classifyFileType(makeFile({ type: 'application/pdf' }))).toBe('pdf')
  })

  it('classifies anything else (doc/docx, empty MIME, unknown) as doc', () => {
    expect(
      classifyFileType(
        makeFile({
          type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        }),
      ),
    ).toBe('doc')
    expect(classifyFileType(makeFile({ type: '' }))).toBe('doc')
  })
})

describe('MAX_UPLOAD_SIZE_BYTES (FR-DOC-05)', () => {
  it('is exactly 10 MB', () => {
    expect(MAX_UPLOAD_SIZE_BYTES).toBe(10 * 1024 * 1024)
  })
})

describe('uploadAttachment — conditional compression (FR-DOC-05)', () => {
  it('compresses an image before uploading', async () => {
    const file = makeFile({ name: 'photo.jpg', type: 'image/jpeg' })

    const result = await uploadAttachment('reports/r1/invoices/photo.jpg', file)

    expect(imageCompression).toHaveBeenCalledWith(
      file,
      expect.objectContaining({ maxWidthOrHeight: 2000 }),
    )
    expect(uploadBytes).toHaveBeenCalledWith(
      { __ref: 'reports/r1/invoices/photo.jpg' },
      expect.any(File), // the COMPRESSED file, not the original
    )
    expect(result).toEqual({
      url: 'https://storage.example/reports/r1/invoices/photo.jpg',
      name: 'photo.jpg', // the ORIGINAL file's name, not the compressed stand-in's
      type: 'image',
    })
  })

  it('does NOT compress a PDF — uploads it byte-for-byte', async () => {
    const file = makeFile({ name: 'invoice.pdf', type: 'application/pdf' })

    await uploadAttachment('reports/r1/invoices/invoice.pdf', file)

    expect(imageCompression).not.toHaveBeenCalled()
    expect(uploadBytes).toHaveBeenCalledWith(
      { __ref: 'reports/r1/invoices/invoice.pdf' },
      file,
    )
  })

  it('does NOT compress a doc/docx either', async () => {
    const file = makeFile({
      name: 'invoice.docx',
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    })

    await uploadAttachment('reports/r1/invoices/invoice.docx', file)

    expect(imageCompression).not.toHaveBeenCalled()
    expect(uploadBytes).toHaveBeenCalledWith(
      { __ref: 'reports/r1/invoices/invoice.docx' },
      file,
    )
  })
})

describe('deleteAttachmentBestEffort', () => {
  it('resolves the Storage ref from the download URL and deletes it', async () => {
    await deleteAttachmentBestEffort('https://storage.example/some/object.jpg')

    expect(ref).toHaveBeenCalledWith(
      { __fake: 'storage' },
      'https://storage.example/some/object.jpg',
    )
    expect(deleteObject).toHaveBeenCalledWith({
      __ref: 'https://storage.example/some/object.jpg',
    })
  })

  it('swallows a delete failure — best-effort, never throws', async () => {
    deleteObject.mockRejectedValue(new Error('object-not-found'))

    await expect(
      deleteAttachmentBestEffort('https://storage.example/missing.jpg'),
    ).resolves.toBeUndefined()
  })
})
