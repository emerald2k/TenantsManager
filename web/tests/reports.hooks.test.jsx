import { beforeEach, describe, expect, it, vi } from 'vitest'
import { waitFor } from '@testing-library/react'
import { getDoc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { renderHookWithProviders } from './renderWithProviders'
import {
  buildReportId,
  useMonthlyReport,
  useSaveReportDraft,
  useSignReport,
  useUnlockReport,
} from '@/features/reports/hooks'

// Hook tests with the BOUNDARY MOCKED — no emulator, same convention as
// properties.hooks.test.jsx / tenants.hooks.test.jsx. The Storage
// choreography itself (upload/delete ordering) is mocked at the module level
// here — `reports.attachments.test.js` and `fileUpload.test.js` cover what
// those modules actually DO; this file only checks that the HOOK calls them
// in the right order and with the right arguments.

vi.mock('@/lib/firebase', () => ({
  db: { __fake: 'db' },
  functions: { __fake: 'functions' },
  auth: { currentUser: { uid: 'admin-uid' } },
}))

vi.mock('firebase/firestore', () => ({
  doc: vi.fn((_db, collection, id) => ({ __doc: `${collection}/${id}` })),
  getDoc: vi.fn(),
  setDoc: vi.fn(),
  updateDoc: vi.fn(),
  serverTimestamp: vi.fn(() => ({ __serverTimestamp: true })),
}))

vi.mock('firebase/functions', () => ({ httpsCallable: vi.fn() }))

vi.mock('@/lib/fileUpload', () => ({
  deleteAttachmentBestEffort: vi.fn(),
}))

vi.mock('@/features/reports/attachments', () => ({
  uploadPendingAttachments: vi.fn(),
  collectAttachmentUrls: vi.fn(),
}))

import { deleteAttachmentBestEffort } from '@/lib/fileUpload'
import {
  collectAttachmentUrls,
  uploadPendingAttachments,
} from '@/features/reports/attachments'

beforeEach(() => {
  vi.clearAllMocks()
  setDoc.mockResolvedValue(undefined)
  updateDoc.mockResolvedValue(undefined)
  deleteAttachmentBestEffort.mockResolvedValue(undefined)
  // Default: no attachments in play — `values` passes through untouched,
  // nothing new uploaded. Individual tests override this.
  uploadPendingAttachments.mockImplementation(async (values) => ({
    values,
    newUrls: [],
  }))
  collectAttachmentUrls.mockReturnValue([])
})

describe('buildReportId (FR-REP-14 — composite/unique id)', () => {
  it('builds a deterministic id from propertyId+month+year, zero-padding the month', () => {
    expect(buildReportId('p1', 7, 2026)).toBe('p1_2026-07')
    expect(buildReportId('p1', 12, 2026)).toBe('p1_2026-12')
  })

  it('produces the SAME id every time for the same property+month+year', () => {
    expect(buildReportId('p1', 7, 2026)).toBe(buildReportId('p1', 7, 2026))
  })

  it('produces different ids for different properties or months', () => {
    expect(buildReportId('p1', 7, 2026)).not.toBe(buildReportId('p2', 7, 2026))
    expect(buildReportId('p1', 7, 2026)).not.toBe(buildReportId('p1', 8, 2026))
  })
})

describe('useMonthlyReport', () => {
  it('parses the document, with its id, when it exists', async () => {
    getDoc.mockResolvedValue({
      exists: () => true,
      id: 'p1_2026-07',
      data: () => ({ propertyId: 'p1', status: 'draft' }),
    })

    const { result } = await renderHookWithProviders(() =>
      useMonthlyReport({ propertyId: 'p1', month: 7, year: 2026 }),
    )

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual({
      id: 'p1_2026-07',
      propertyId: 'p1',
      status: 'draft',
    })
    expect(getDoc).toHaveBeenCalledWith({
      __doc: 'monthlyReports/p1_2026-07',
    })
  })

  it('returns null, NOT an error, when no report exists yet for that month (FR-REP-11)', async () => {
    getDoc.mockResolvedValue({ exists: () => false })

    const { result } = await renderHookWithProviders(() =>
      useMonthlyReport({ propertyId: 'p1', month: 7, year: 2026 }),
    )

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toBeNull()
  })

  it('reads nothing without a propertyId', async () => {
    const { result } = await renderHookWithProviders(() =>
      useMonthlyReport({ propertyId: undefined, month: 7, year: 2026 }),
    )

    expect(result.current.fetchStatus).toBe('idle')
    expect(getDoc).not.toHaveBeenCalled()
  })
})

describe('useSaveReportDraft — creation (isNew: true)', () => {
  const VALUES = {
    ownerId: 'admin-uid',
    propertyId: 'p1',
    tenancyId: 't1',
    userId: 'u1',
    month: 7,
    year: 2026,
    rent: { amount: 1500, notes: undefined },
    calculatedTotal: 1500,
  }

  it('writes the FULL document with setDoc, adding status:draft and a fresh updatedAt', async () => {
    const { result } = await renderHookWithProviders(() => useSaveReportDraft())

    await result.current.mutateAsync({
      id: 'p1_2026-07',
      values: VALUES,
      isNew: true,
    })

    expect(setDoc).toHaveBeenCalledWith(
      { __doc: 'monthlyReports/p1_2026-07' },
      {
        ownerId: 'admin-uid',
        propertyId: 'p1',
        tenancyId: 't1',
        userId: 'u1',
        month: 7,
        year: 2026,
        rent: { amount: 1500 },
        calculatedTotal: 1500,
        status: 'draft',
        updatedAt: { __serverTimestamp: true },
      },
    )
    expect(updateDoc).not.toHaveBeenCalled()
    expect(serverTimestamp).toHaveBeenCalled()
  })

  it('strips undefined values recursively before writing (CLAUDE.md §7)', async () => {
    const { result } = await renderHookWithProviders(() => useSaveReportDraft())

    await result.current.mutateAsync({
      id: 'p1_2026-07',
      values: VALUES,
      isNew: true,
    })

    const written = setDoc.mock.calls[0][1]
    expect(written.rent).not.toHaveProperty('notes')
  })

  it('resolves with the id (so the caller can invalidate/navigate)', async () => {
    const { result } = await renderHookWithProviders(() => useSaveReportDraft())

    await expect(
      result.current.mutateAsync({
        id: 'p1_2026-07',
        values: VALUES,
        isNew: true,
      }),
    ).resolves.toBe('p1_2026-07')
  })

  it('invalidates the report detail query on success', async () => {
    const { result, queryClient } = await renderHookWithProviders(() =>
      useSaveReportDraft(),
    )
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')

    await result.current.mutateAsync({
      id: 'p1_2026-07',
      values: VALUES,
      isNew: true,
    })

    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ['monthlyReports', 'detail', 'p1_2026-07'],
    })
  })

  it('invalidates nothing if the write fails', async () => {
    setDoc.mockRejectedValue(new Error('permission-denied'))
    const { result, queryClient } = await renderHookWithProviders(() =>
      useSaveReportDraft(),
    )
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')

    await expect(
      result.current.mutateAsync({
        id: 'p1_2026-07',
        values: VALUES,
        isNew: true,
      }),
    ).rejects.toThrow()
    expect(invalidate).not.toHaveBeenCalled()
  })
})

describe('useSaveReportDraft — re-save (isNew: false, M4 sub-stage 4 fix)', () => {
  const VALUES = {
    ownerId: 'admin-uid',
    propertyId: 'p1',
    tenancyId: 't1',
    userId: 'u1',
    month: 7,
    year: 2026,
    rent: { amount: 1600, notes: undefined },
    calculatedTotal: 1600,
  }

  it('uses updateDoc, never setDoc, and never includes status or signedAt in the payload', async () => {
    const { result } = await renderHookWithProviders(() => useSaveReportDraft())

    await result.current.mutateAsync({
      id: 'p1_2026-07',
      values: VALUES,
      isNew: false,
    })

    expect(updateDoc).toHaveBeenCalledTimes(1)
    expect(setDoc).not.toHaveBeenCalled()
    const payload = updateDoc.mock.calls[0][1]
    expect(payload).not.toHaveProperty('status')
    expect(payload).not.toHaveProperty('signedAt')
    expect(payload.rent).toEqual({ amount: 1600 })
    expect(payload.updatedAt).toEqual({ __serverTimestamp: true })
  })

  it('a re-save on a report that was signed after page load does not change status (closes the race with signReport)', async () => {
    // Simulates the exact race the plan flagged: the client still thinks
    // it's fine to save (isNew: false, same as any re-save), but the
    // server-side document may by now be 'signed'. Proves the FIX by
    // asserting the key is ABSENT — that is what actually prevents the
    // de-sign, regardless of what the stale client believed the status was.
    const { result } = await renderHookWithProviders(() => useSaveReportDraft())

    await result.current.mutateAsync({
      id: 'p1_2026-07',
      values: VALUES,
      isNew: false,
    })

    const payload = updateDoc.mock.calls[0][1]
    expect(payload).not.toHaveProperty('status')
  })

  it('strips undefined values recursively before writing (CLAUDE.md §7)', async () => {
    const { result } = await renderHookWithProviders(() => useSaveReportDraft())

    await result.current.mutateAsync({
      id: 'p1_2026-07',
      values: VALUES,
      isNew: false,
    })

    const written = updateDoc.mock.calls[0][1]
    expect(written.rent).not.toHaveProperty('notes')
  })

  it('resolves with the id and invalidates the report detail query on success', async () => {
    const { result, queryClient } = await renderHookWithProviders(() =>
      useSaveReportDraft(),
    )
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')

    await expect(
      result.current.mutateAsync({
        id: 'p1_2026-07',
        values: VALUES,
        isNew: false,
      }),
    ).resolves.toBe('p1_2026-07')
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ['monthlyReports', 'detail', 'p1_2026-07'],
    })
  })

  it('invalidates nothing if the write fails', async () => {
    updateDoc.mockRejectedValue(new Error('permission-denied'))
    const { result, queryClient } = await renderHookWithProviders(() =>
      useSaveReportDraft(),
    )
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')

    await expect(
      result.current.mutateAsync({
        id: 'p1_2026-07',
        values: VALUES,
        isNew: false,
      }),
    ).rejects.toThrow()
    expect(invalidate).not.toHaveBeenCalled()
  })
})

describe('useSaveReportDraft — attachment orchestration on CREATE (isNew: true, M4 sub-stage 3, FR-DOC-01…05)', () => {
  const VALUES = {
    ownerId: 'admin-uid',
    propertyId: 'p1',
    tenancyId: 't1',
    userId: 'u1',
    month: 7,
    year: 2026,
    rent: { amount: 1500, attachments: [] },
    calculatedTotal: 1500,
  }
  const UPLOADED_VALUES = {
    ...VALUES,
    rent: {
      amount: 1500,
      attachments: [
        {
          url: 'https://storage.example/new.pdf',
          name: 'new.pdf',
          type: 'pdf',
        },
      ],
    },
  }

  it('uploads pending attachments to reports/{id}/invoices BEFORE calling setDoc', async () => {
    const callOrder = []
    uploadPendingAttachments.mockImplementation(async () => {
      callOrder.push('upload')
      return {
        values: UPLOADED_VALUES,
        newUrls: ['https://storage.example/new.pdf'],
      }
    })
    setDoc.mockImplementation(async () => {
      callOrder.push('setDoc')
    })

    const { result } = await renderHookWithProviders(() => useSaveReportDraft())
    await result.current.mutateAsync({
      id: 'p1_2026-07',
      values: VALUES,
      isNew: true,
    })

    expect(uploadPendingAttachments).toHaveBeenCalledWith(
      VALUES,
      'reports/p1_2026-07/invoices',
    )
    expect(callOrder).toEqual(['upload', 'setDoc'])
    // The document written is the UPLOADED (clean-refs) values, not the raw input.
    expect(setDoc.mock.calls[0][1].rent.attachments).toEqual([
      { url: 'https://storage.example/new.pdf', name: 'new.pdf', type: 'pdf' },
    ])
  })

  it('deletes REMOVED attachments AFTER setDoc succeeds, never before', async () => {
    const callOrder = []
    uploadPendingAttachments.mockResolvedValue({
      values: UPLOADED_VALUES,
      newUrls: [],
    })
    // The just-saved document's surviving urls — only 'kept.pdf' is still
    // there, so 'removed.pdf' (below, in previousAttachmentUrls) is what the
    // admin dropped from the form before saving.
    collectAttachmentUrls.mockReturnValue(['https://storage.example/kept.pdf'])
    setDoc.mockImplementation(async () => {
      callOrder.push('setDoc')
    })
    deleteAttachmentBestEffort.mockImplementation(async () => {
      callOrder.push('delete')
    })

    const { result } = await renderHookWithProviders(() => useSaveReportDraft())
    await result.current.mutateAsync({
      id: 'p1_2026-07',
      values: VALUES,
      previousAttachmentUrls: [
        'https://storage.example/kept.pdf',
        'https://storage.example/removed.pdf',
      ],
      isNew: true,
    })

    expect(deleteAttachmentBestEffort).toHaveBeenCalledTimes(1)
    expect(deleteAttachmentBestEffort).toHaveBeenCalledWith(
      'https://storage.example/removed.pdf',
    )
    expect(deleteAttachmentBestEffort).not.toHaveBeenCalledWith(
      'https://storage.example/kept.pdf',
    )
    expect(callOrder).toEqual(['setDoc', 'delete'])
  })

  it('on setDoc failure: deletes ONLY the just-uploaded new objects, leaves removed/previous ones untouched', async () => {
    uploadPendingAttachments.mockResolvedValue({
      values: UPLOADED_VALUES,
      newUrls: ['https://storage.example/new.pdf'],
    })
    setDoc.mockRejectedValue(new Error('permission-denied'))

    const { result } = await renderHookWithProviders(() => useSaveReportDraft())

    await expect(
      result.current.mutateAsync({
        id: 'p1_2026-07',
        values: VALUES,
        previousAttachmentUrls: [
          'https://storage.example/old-still-referenced.pdf',
        ],
        isNew: true,
      }),
    ).rejects.toThrow()

    expect(deleteAttachmentBestEffort).toHaveBeenCalledTimes(1)
    expect(deleteAttachmentBestEffort).toHaveBeenCalledWith(
      'https://storage.example/new.pdf',
    )
    expect(deleteAttachmentBestEffort).not.toHaveBeenCalledWith(
      'https://storage.example/old-still-referenced.pdf',
    )
  })

  it('with no previousAttachmentUrls given (brand new report), deletes nothing on success', async () => {
    uploadPendingAttachments.mockResolvedValue({
      values: UPLOADED_VALUES,
      newUrls: [],
    })
    collectAttachmentUrls.mockReturnValue([])

    const { result } = await renderHookWithProviders(() => useSaveReportDraft())
    await result.current.mutateAsync({
      id: 'p1_2026-07',
      values: VALUES,
      isNew: true,
    })

    expect(deleteAttachmentBestEffort).not.toHaveBeenCalled()
  })
})

describe('useSaveReportDraft — attachment orchestration on RE-SAVE (isNew: false) — same choreography must survive the create/update split', () => {
  const VALUES = {
    ownerId: 'admin-uid',
    propertyId: 'p1',
    tenancyId: 't1',
    userId: 'u1',
    month: 7,
    year: 2026,
    rent: { amount: 1600, attachments: [] },
    calculatedTotal: 1600,
  }
  const UPLOADED_VALUES = {
    ...VALUES,
    rent: {
      amount: 1600,
      attachments: [
        {
          url: 'https://storage.example/new.pdf',
          name: 'new.pdf',
          type: 'pdf',
        },
      ],
    },
  }

  it('uploads pending attachments to reports/{id}/invoices BEFORE calling updateDoc', async () => {
    const callOrder = []
    uploadPendingAttachments.mockImplementation(async () => {
      callOrder.push('upload')
      return {
        values: UPLOADED_VALUES,
        newUrls: ['https://storage.example/new.pdf'],
      }
    })
    updateDoc.mockImplementation(async () => {
      callOrder.push('updateDoc')
    })

    const { result } = await renderHookWithProviders(() => useSaveReportDraft())
    await result.current.mutateAsync({
      id: 'p1_2026-07',
      values: VALUES,
      isNew: false,
    })

    expect(uploadPendingAttachments).toHaveBeenCalledWith(
      VALUES,
      'reports/p1_2026-07/invoices',
    )
    expect(callOrder).toEqual(['upload', 'updateDoc'])
    expect(updateDoc.mock.calls[0][1].rent.attachments).toEqual([
      { url: 'https://storage.example/new.pdf', name: 'new.pdf', type: 'pdf' },
    ])
  })

  it('deletes REMOVED attachments AFTER updateDoc succeeds, never before', async () => {
    const callOrder = []
    uploadPendingAttachments.mockResolvedValue({
      values: UPLOADED_VALUES,
      newUrls: [],
    })
    collectAttachmentUrls.mockReturnValue(['https://storage.example/kept.pdf'])
    updateDoc.mockImplementation(async () => {
      callOrder.push('updateDoc')
    })
    deleteAttachmentBestEffort.mockImplementation(async () => {
      callOrder.push('delete')
    })

    const { result } = await renderHookWithProviders(() => useSaveReportDraft())
    await result.current.mutateAsync({
      id: 'p1_2026-07',
      values: VALUES,
      previousAttachmentUrls: [
        'https://storage.example/kept.pdf',
        'https://storage.example/removed.pdf',
      ],
      isNew: false,
    })

    expect(deleteAttachmentBestEffort).toHaveBeenCalledTimes(1)
    expect(deleteAttachmentBestEffort).toHaveBeenCalledWith(
      'https://storage.example/removed.pdf',
    )
    expect(callOrder).toEqual(['updateDoc', 'delete'])
  })

  it('on updateDoc failure: deletes ONLY the just-uploaded new objects, leaves everything else untouched', async () => {
    uploadPendingAttachments.mockResolvedValue({
      values: UPLOADED_VALUES,
      newUrls: ['https://storage.example/new.pdf'],
    })
    updateDoc.mockRejectedValue(new Error('permission-denied'))

    const { result } = await renderHookWithProviders(() => useSaveReportDraft())

    await expect(
      result.current.mutateAsync({
        id: 'p1_2026-07',
        values: VALUES,
        previousAttachmentUrls: [
          'https://storage.example/old-still-referenced.pdf',
        ],
        isNew: false,
      }),
    ).rejects.toThrow()

    expect(deleteAttachmentBestEffort).toHaveBeenCalledTimes(1)
    expect(deleteAttachmentBestEffort).toHaveBeenCalledWith(
      'https://storage.example/new.pdf',
    )
    expect(deleteAttachmentBestEffort).not.toHaveBeenCalledWith(
      'https://storage.example/old-still-referenced.pdf',
    )
  })
})

describe('useSignReport (FR-REP-07)', () => {
  it('calls the signReport callable with the report id', async () => {
    const signReportMock = vi
      .fn()
      .mockResolvedValue({ data: { reportId: 'r1' } })
    httpsCallable.mockReturnValue(signReportMock)

    const { result } = await renderHookWithProviders(() => useSignReport())
    await result.current.mutateAsync({ id: 'r1' })

    expect(httpsCallable).toHaveBeenCalledWith(
      { __fake: 'functions' },
      'signReport',
    )
    expect(signReportMock).toHaveBeenCalledWith({ reportId: 'r1' })
  })

  it('invalidates the report detail query on success', async () => {
    const signReportMock = vi
      .fn()
      .mockResolvedValue({ data: { reportId: 'r1' } })
    httpsCallable.mockReturnValue(signReportMock)
    const { result, queryClient } = await renderHookWithProviders(() =>
      useSignReport(),
    )
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')

    await result.current.mutateAsync({ id: 'r1' })

    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ['monthlyReports', 'detail', 'r1'],
    })
  })
})

describe('useUnlockReport (FR-REP-07a)', () => {
  it('calls the unlockReport callable with the report id', async () => {
    const unlockReportMock = vi
      .fn()
      .mockResolvedValue({ data: { reportId: 'r1' } })
    httpsCallable.mockReturnValue(unlockReportMock)

    const { result } = await renderHookWithProviders(() => useUnlockReport())
    await result.current.mutateAsync({ id: 'r1' })

    expect(httpsCallable).toHaveBeenCalledWith(
      { __fake: 'functions' },
      'unlockReport',
    )
    expect(unlockReportMock).toHaveBeenCalledWith({ reportId: 'r1' })
  })

  it('invalidates the report detail query on success', async () => {
    const unlockReportMock = vi
      .fn()
      .mockResolvedValue({ data: { reportId: 'r1' } })
    httpsCallable.mockReturnValue(unlockReportMock)
    const { result, queryClient } = await renderHookWithProviders(() =>
      useUnlockReport(),
    )
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')

    await result.current.mutateAsync({ id: 'r1' })

    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ['monthlyReports', 'detail', 'r1'],
    })
  })
})
