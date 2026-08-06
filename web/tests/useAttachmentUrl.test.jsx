import { beforeEach, describe, expect, it, vi } from 'vitest'
import { waitFor } from '@testing-library/react'
import { renderHookWithProviders } from './renderWithProviders'
import { useAttachmentUrl } from '@/lib/useAttachmentUrl'

// Fast band — Storage mocked at the module boundary, same convention as
// fileUpload.test.js/tenantApp.hooks.test.jsx. `ref` is a passthrough stub
// that echoes back its `path` argument, so assertions can confirm the exact
// value that reaches `getDownloadURL` without depending on the real SDK.

vi.mock('@/lib/firebase', () => ({ storage: { __fake: 'storage' } }))

vi.mock('firebase/storage', () => ({
  ref: vi.fn((_storage, path) => ({ __ref: path })),
  getDownloadURL: vi.fn(),
}))

import { getDownloadURL, ref } from 'firebase/storage'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('useAttachmentUrl', () => {
  it('A1 — path reaches getDownloadURL via ref(storage, path); the resolved url is exposed', async () => {
    getDownloadURL.mockResolvedValue(
      'https://storage.example/reports/r1/invoices/photo.jpg',
    )

    const { result } = await renderHookWithProviders(() =>
      useAttachmentUrl('reports/r1/invoices/photo.jpg'),
    )

    await waitFor(() =>
      expect(result.current.url).toBe(
        'https://storage.example/reports/r1/invoices/photo.jpg',
      ),
    )
    expect(ref).toHaveBeenCalledWith(
      { __fake: 'storage' },
      'reports/r1/invoices/photo.jpg',
    )
    expect(getDownloadURL).toHaveBeenCalledWith({
      __ref: 'reports/r1/invoices/photo.jpg',
    })
  })

  it('A2 — a DIFFERENT path is a different queryKey — no cache collision between two attachments', async () => {
    getDownloadURL.mockImplementation((objectRef) =>
      Promise.resolve(`resolved:${objectRef.__ref}`),
    )

    const first = await renderHookWithProviders(() =>
      useAttachmentUrl('reports/r1/invoices/a.jpg'),
    )
    const second = await renderHookWithProviders(
      () => useAttachmentUrl('reports/r1/invoices/b.jpg'),
      { queryClient: first.queryClient },
    )

    await waitFor(() =>
      expect(first.result.current.url).toBe(
        'resolved:reports/r1/invoices/a.jpg',
      ),
    )
    await waitFor(() =>
      expect(second.result.current.url).toBe(
        'resolved:reports/r1/invoices/b.jpg',
      ),
    )
  })

  it('A3 — an empty/undefined path never calls getDownloadURL (enabled: false)', async () => {
    const { result } = await renderHookWithProviders(() =>
      useAttachmentUrl(undefined),
    )

    expect(result.current.isLoading).toBe(false)
    expect(result.current.url).toBeUndefined()
    expect(getDownloadURL).not.toHaveBeenCalled()
  })

  it('A4 — a rejected getDownloadURL surfaces isError, without a url', async () => {
    getDownloadURL.mockRejectedValue(new Error('permission-denied'))

    const { result } = await renderHookWithProviders(() =>
      useAttachmentUrl('reports/r1/invoices/photo.jpg'),
    )

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.url).toBeUndefined()
  })
})
