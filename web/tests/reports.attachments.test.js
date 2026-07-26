import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/firebase', () => ({ storage: { __fake: 'storage' } }))
vi.mock('firebase/storage', () => ({
  ref: vi.fn((_storage, path) => ({ __ref: path })),
  uploadBytes: vi.fn(),
  getDownloadURL: vi.fn(),
  deleteObject: vi.fn(),
}))
vi.mock('browser-image-compression', () => ({ default: vi.fn() }))

import { getDownloadURL, uploadBytes } from 'firebase/storage'
import imageCompression from 'browser-image-compression'
import {
  collectAttachmentUrls,
  uploadPendingAttachments,
} from '@/features/reports/attachments'

function makeFile({ name = 'invoice.pdf', type = 'application/pdf' } = {}) {
  return new File(['x'], name, { type })
}

let uploadCounter

beforeEach(() => {
  vi.clearAllMocks()
  uploadCounter = 0
  imageCompression.mockImplementation(async (file) => file)
  uploadBytes.mockResolvedValue({})
  // A distinct URL per call, so tests can tell uploads apart.
  getDownloadURL.mockImplementation(async () => {
    uploadCounter += 1
    return `https://storage.example/uploaded-${uploadCounter}`
  })
})

describe('collectAttachmentUrls', () => {
  it('returns [] for a brand new report (no existingReport yet)', () => {
    expect(collectAttachmentUrls(null)).toEqual([])
    expect(collectAttachmentUrls(undefined)).toEqual([])
  })

  it('collects urls from rent, maintenance, services, and other expenses', () => {
    const report = {
      rent: {
        amount: 1500,
        attachments: [{ url: 'u1', name: 'a', type: 'pdf' }],
      },
      maintenance: { amount: 0, attachments: [] },
      serviceCosts: [
        {
          serviceId: 'gas',
          amount: 50,
          attachments: [{ url: 'u2', name: 'b', type: 'image' }],
        },
      ],
      otherExpenses: [
        {
          description: 'Repair',
          amount: 20,
          attachments: [{ url: 'u3', name: 'c', type: 'doc' }],
        },
      ],
    }

    expect(collectAttachmentUrls(report)).toEqual(['u1', 'u2', 'u3'])
  })

  it('ignores lines with no attachments at all (undefined field)', () => {
    const report = { rent: { amount: 1500 }, maintenance: { amount: 0 } }
    expect(collectAttachmentUrls(report)).toEqual([])
  })
})

describe('uploadPendingAttachments', () => {
  it('replaces a pending File with an uploaded {url,name,type} ref — zero File left', async () => {
    const values = {
      rent: {
        amount: 1500,
        attachments: [
          {
            name: 'lease.pdf',
            type: 'pdf',
            file: makeFile({ name: 'lease.pdf' }),
          },
        ],
      },
      maintenance: { amount: 0, attachments: [] },
      serviceCosts: [],
      otherExpenses: [],
    }

    const { values: result, newUrls } = await uploadPendingAttachments(
      values,
      'reports/r1/invoices',
    )

    expect(result.rent.attachments).toEqual([
      {
        url: 'https://storage.example/uploaded-1',
        name: 'lease.pdf',
        type: 'pdf',
      },
    ])
    expect(result.rent.attachments[0]).not.toHaveProperty('file')
    expect(newUrls).toEqual(['https://storage.example/uploaded-1'])
  })

  it('leaves an already-persisted attachment (has url, no file) untouched — no re-upload', async () => {
    const values = {
      rent: {
        amount: 1500,
        attachments: [
          {
            url: 'https://storage.example/old.pdf',
            name: 'old.pdf',
            type: 'pdf',
          },
        ],
      },
      maintenance: { amount: 0, attachments: [] },
      serviceCosts: [],
      otherExpenses: [],
    }

    const { values: result, newUrls } = await uploadPendingAttachments(
      values,
      'reports/r1/invoices',
    )

    expect(result.rent.attachments).toEqual([
      { url: 'https://storage.example/old.pdf', name: 'old.pdf', type: 'pdf' },
    ])
    expect(uploadBytes).not.toHaveBeenCalled()
    expect(newUrls).toEqual([])
  })

  it('handles a mix of existing and pending on the same line, and across service/other-expense arrays', async () => {
    const values = {
      rent: { amount: 1500, attachments: [] },
      maintenance: { amount: 0, attachments: [] },
      serviceCosts: [
        {
          serviceId: 'gas',
          amount: 50,
          attachments: [
            {
              url: 'https://storage.example/kept.jpg',
              name: 'kept.jpg',
              type: 'image',
            },
            {
              name: 'new.pdf',
              type: 'pdf',
              file: makeFile({ name: 'new.pdf' }),
            },
          ],
        },
      ],
      otherExpenses: [
        {
          description: 'Repair',
          amount: 20,
          attachments: [
            {
              name: 'receipt.jpg',
              type: 'image',
              file: makeFile({ name: 'receipt.jpg', type: 'image/jpeg' }),
            },
          ],
        },
      ],
    }

    const { values: result, newUrls } = await uploadPendingAttachments(
      values,
      'reports/r1/invoices',
    )

    expect(result.serviceCosts[0].attachments).toEqual([
      {
        url: 'https://storage.example/kept.jpg',
        name: 'kept.jpg',
        type: 'image',
      },
      {
        url: 'https://storage.example/uploaded-1',
        name: 'new.pdf',
        type: 'pdf',
      },
    ])
    expect(result.otherExpenses[0].attachments).toEqual([
      {
        url: 'https://storage.example/uploaded-2',
        name: 'receipt.jpg',
        type: 'image',
      },
    ])
    expect(newUrls).toEqual([
      'https://storage.example/uploaded-1',
      'https://storage.example/uploaded-2',
    ])
    // The image one went through compression, the pdf one didn't.
    expect(imageCompression).toHaveBeenCalledTimes(1)
  })

  it('does nothing (no upload calls) for a report with no attachments anywhere', async () => {
    const values = {
      rent: { amount: 1500, attachments: [] },
      maintenance: { amount: 0, attachments: [] },
      serviceCosts: [],
      otherExpenses: [],
    }

    const { values: result, newUrls } = await uploadPendingAttachments(
      values,
      'reports/r1/invoices',
    )

    expect(newUrls).toEqual([])
    expect(uploadBytes).not.toHaveBeenCalled()
    expect(result.rent.attachments).toEqual([])
  })
})
