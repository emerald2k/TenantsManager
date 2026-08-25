import { beforeEach, describe, expect, it, vi } from 'vitest'
import { waitFor } from '@testing-library/react'
import {
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { renderHookWithProviders } from './renderWithProviders'
import {
  buildReportId,
  useCancelPayment,
  useMarkPayment,
  useMonthlyReport,
  useReportsForMonth,
  useReportsForYear,
  useRevokeShareLink,
  useSaveReportDraft,
  useSendReportNotification,
  useShareReport,
  useSignedReportsForTenancy,
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
  collection: vi.fn((_db, name) => ({ __collection: name })),
  getDocs: vi.fn(),
  query: vi.fn((...args) => ({ __query: args })),
  where: vi.fn((field, op, value) => ({ __where: [field, op, value] })),
}))

vi.mock('firebase/functions', () => ({ httpsCallable: vi.fn() }))

vi.mock('@/lib/fileUpload', () => ({
  deleteAttachmentBestEffort: vi.fn(),
}))

vi.mock('@/features/reports/attachments', () => ({
  uploadPendingAttachments: vi.fn(),
  collectAttachmentPaths: vi.fn(),
}))

import { deleteAttachmentBestEffort } from '@/lib/fileUpload'
import {
  collectAttachmentPaths,
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
    newPaths: [],
  }))
  collectAttachmentPaths.mockReturnValue([])
})

describe('buildReportId (FR-REP-14 — composite/unique id)', () => {
  it('builds a deterministic id from tenancyId+year+month, zero-padding the month', () => {
    expect(buildReportId('t1', 2026, 7)).toBe('t1_2026-07')
    expect(buildReportId('t1', 2026, 12)).toBe('t1_2026-12')
  })

  it('produces the SAME id every time for the same tenancy+month+year', () => {
    expect(buildReportId('t1', 2026, 7)).toBe(buildReportId('t1', 2026, 7))
  })

  it('produces different ids for different tenancies or months', () => {
    expect(buildReportId('t1', 2026, 7)).not.toBe(buildReportId('t2', 2026, 7))
    expect(buildReportId('t1', 2026, 7)).not.toBe(buildReportId('t1', 2026, 8))
  })
})

describe('useMonthlyReport', () => {
  it('parses the document, with its id, when it exists', async () => {
    getDoc.mockResolvedValue({
      exists: () => true,
      id: 't1_2026-07',
      data: () => ({ propertyId: 'p1', tenancyId: 't1', status: 'draft' }),
    })

    const { result } = await renderHookWithProviders(() =>
      useMonthlyReport({ tenancyId: 't1', month: 7, year: 2026 }),
    )

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual({
      id: 't1_2026-07',
      propertyId: 'p1',
      tenancyId: 't1',
      status: 'draft',
    })
    expect(getDoc).toHaveBeenCalledWith({
      __doc: 'monthlyReports/t1_2026-07',
    })
  })

  it('returns null, NOT an error, when no report exists yet for that month (FR-REP-11)', async () => {
    getDoc.mockResolvedValue({ exists: () => false })

    const { result } = await renderHookWithProviders(() =>
      useMonthlyReport({ tenancyId: 't1', month: 7, year: 2026 }),
    )

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toBeNull()
  })

  it('reads nothing without a tenancyId', async () => {
    const { result } = await renderHookWithProviders(() =>
      useMonthlyReport({ tenancyId: undefined, month: 7, year: 2026 }),
    )

    expect(result.current.fetchStatus).toBe('idle')
    expect(getDoc).not.toHaveBeenCalled()
  })
})

describe('useReportsForMonth (M4 sub-stage 7)', () => {
  it('queries monthlyReports with two equality filters (month, year), no orderBy', async () => {
    getDocs.mockResolvedValue({
      docs: [
        {
          id: 'p1_2026-07',
          data: () => ({
            propertyId: 'p1',
            month: 7,
            year: 2026,
            status: 'signed',
          }),
        },
      ],
    })

    const { result } = await renderHookWithProviders(() =>
      useReportsForMonth(7, 2026),
    )

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(where).toHaveBeenCalledWith('month', '==', 7)
    expect(where).toHaveBeenCalledWith('year', '==', 2026)
    expect(query).toHaveBeenCalled()
    expect(result.current.data).toEqual([
      {
        id: 'p1_2026-07',
        propertyId: 'p1',
        month: 7,
        year: 2026,
        status: 'signed',
      },
    ])
  })

  it('returns every status (draft AND signed) — no status filter in the query', async () => {
    getDocs.mockResolvedValue({
      docs: [
        {
          id: 'p1_2026-07',
          data: () => ({ propertyId: 'p1', status: 'draft' }),
        },
        {
          id: 'p2_2026-07',
          data: () => ({ propertyId: 'p2', status: 'signed' }),
        },
      ],
    })

    const { result } = await renderHookWithProviders(() =>
      useReportsForMonth(7, 2026),
    )

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toHaveLength(2)
    expect(result.current.data.map((r) => r.status)).toEqual([
      'draft',
      'signed',
    ])
  })

  it('returns an empty array, not an error, when no report exists for the month', async () => {
    getDocs.mockResolvedValue({ docs: [] })

    const { result } = await renderHookWithProviders(() =>
      useReportsForMonth(7, 2026),
    )

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual([])
  })
})

describe('useReportsForYear (M8 stage 12, FR-PAY-07/FR-PROP-12)', () => {
  it('queries monthlyReports with ONE equality filter (year), no orderBy', async () => {
    getDocs.mockResolvedValue({
      docs: [
        {
          id: 't1_2026-07',
          data: () => ({
            tenancyId: 't1',
            propertyId: 'p1',
            month: 7,
            year: 2026,
            status: 'signed',
          }),
        },
      ],
    })

    const { result } = await renderHookWithProviders(() =>
      useReportsForYear(2026),
    )

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(where).toHaveBeenCalledWith('year', '==', 2026)
    expect(where).not.toHaveBeenCalledWith('month', '==', expect.anything())
    expect(result.current.data).toEqual([
      {
        id: 't1_2026-07',
        tenancyId: 't1',
        propertyId: 'p1',
        month: 7,
        year: 2026,
        status: 'signed',
      },
    ])
  })

  it('returns every status (draft AND signed), across every month of the year', async () => {
    getDocs.mockResolvedValue({
      docs: [
        { id: 'a', data: () => ({ status: 'draft', month: 8 }) },
        { id: 'b', data: () => ({ status: 'signed', month: 1 }) },
      ],
    })

    const { result } = await renderHookWithProviders(() =>
      useReportsForYear(2026),
    )

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toHaveLength(2)
  })

  it('returns an empty array, not an error, when no report exists for the year', async () => {
    getDocs.mockResolvedValue({ docs: [] })

    const { result } = await renderHookWithProviders(() =>
      useReportsForYear(2026),
    )

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual([])
  })
})

describe('useSignedReportsForTenancy (M8 stage 7, FR-SYS-05a)', () => {
  it('queries monthlyReports constrained by tenancyId AND status==signed, no orderBy', async () => {
    getDocs.mockResolvedValue({
      docs: [
        {
          id: 't1_2026-07',
          data: () => ({ tenancyId: 't1', status: 'signed', finalTotal: 2000 }),
        },
      ],
    })

    const { result } = await renderHookWithProviders(() =>
      useSignedReportsForTenancy('t1'),
    )

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(where).toHaveBeenCalledWith('tenancyId', '==', 't1')
    expect(where).toHaveBeenCalledWith('status', '==', 'signed')
    expect(result.current.data).toEqual([
      { id: 't1_2026-07', tenancyId: 't1', status: 'signed', finalTotal: 2000 },
    ])
  })

  it('does not query until a tenancyId is provided', async () => {
    const { result } = await renderHookWithProviders(() =>
      useSignedReportsForTenancy(undefined),
    )

    expect(result.current.fetchStatus).toBe('idle')
    expect(getDocs).not.toHaveBeenCalled()
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

  it('ALSO invalidates the month-list query key on success (M4 sub-stage 7, additive), without dropping the existing detail invalidation', async () => {
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
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ['monthlyReports', 'list'],
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

  it("a re-save never includes shareToken/shareTokenRevoked in the updateDoc payload (M4 sub-stage 8, FR-REP-07c — the whole shared-link feature's persistence rests on this)", async () => {
    const { result } = await renderHookWithProviders(() => useSaveReportDraft())

    await result.current.mutateAsync({
      id: 'p1_2026-07',
      values: VALUES,
      isNew: false,
    })

    const payload = updateDoc.mock.calls[0][1]
    expect(payload).not.toHaveProperty('shareToken')
    expect(payload).not.toHaveProperty('shareTokenRevoked')
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
        newPaths: ['https://storage.example/new.pdf'],
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
      newPaths: [],
    })
    // The just-saved document's surviving urls — only 'kept.pdf' is still
    // there, so 'removed.pdf' (below, in previousAttachmentPaths) is what the
    // admin dropped from the form before saving.
    collectAttachmentPaths.mockReturnValue(['https://storage.example/kept.pdf'])
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
      previousAttachmentPaths: [
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
      newPaths: ['https://storage.example/new.pdf'],
    })
    setDoc.mockRejectedValue(new Error('permission-denied'))

    const { result } = await renderHookWithProviders(() => useSaveReportDraft())

    await expect(
      result.current.mutateAsync({
        id: 'p1_2026-07',
        values: VALUES,
        previousAttachmentPaths: [
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

  it('with no previousAttachmentPaths given (brand new report), deletes nothing on success', async () => {
    uploadPendingAttachments.mockResolvedValue({
      values: UPLOADED_VALUES,
      newPaths: [],
    })
    collectAttachmentPaths.mockReturnValue([])

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
        newPaths: ['https://storage.example/new.pdf'],
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
      newPaths: [],
    })
    collectAttachmentPaths.mockReturnValue(['https://storage.example/kept.pdf'])
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
      previousAttachmentPaths: [
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
      newPaths: ['https://storage.example/new.pdf'],
    })
    updateDoc.mockRejectedValue(new Error('permission-denied'))

    const { result } = await renderHookWithProviders(() => useSaveReportDraft())

    await expect(
      result.current.mutateAsync({
        id: 'p1_2026-07',
        values: VALUES,
        previousAttachmentPaths: [
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

  it('passes overrideReason through to the callable when provided (FR-REP-04e)', async () => {
    const signReportMock = vi
      .fn()
      .mockResolvedValue({ data: { reportId: 'r1' } })
    httpsCallable.mockReturnValue(signReportMock)

    const { result } = await renderHookWithProviders(() => useSignReport())
    await result.current.mutateAsync({
      id: 'r1',
      overrideReason: 'Reducere negociată',
    })

    expect(signReportMock).toHaveBeenCalledWith({
      reportId: 'r1',
      overrideReason: 'Reducere negociată',
    })
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

  it('ALSO invalidates the month-list query key on success (M4 sub-stage 7, additive), without dropping the existing detail invalidation', async () => {
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
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ['monthlyReports', 'list'],
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

  it('ALSO invalidates the month-list query key on success (M4 sub-stage 7, additive), without dropping the existing detail invalidation', async () => {
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
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ['monthlyReports', 'list'],
    })
  })
})

describe('useSendReportNotification (SRS §7.2, FR-REP-06/07a)', () => {
  it('calls the sendReportNotification callable with reportId + template', async () => {
    const sendMock = vi
      .fn()
      .mockResolvedValue({ data: { reportId: 'r1', template: 'new' } })
    httpsCallable.mockReturnValue(sendMock)

    const { result } = await renderHookWithProviders(() =>
      useSendReportNotification(),
    )
    await result.current.mutateAsync({ id: 'r1', template: 'new' })

    expect(httpsCallable).toHaveBeenCalledWith(
      { __fake: 'functions' },
      'sendReportNotification',
    )
    expect(sendMock).toHaveBeenCalledWith({ reportId: 'r1', template: 'new' })
  })

  it('does NOT invalidate any query on success — nothing client-cached changes', async () => {
    const sendMock = vi
      .fn()
      .mockResolvedValue({ data: { reportId: 'r1', template: 'new' } })
    httpsCallable.mockReturnValue(sendMock)
    const { result, queryClient } = await renderHookWithProviders(() =>
      useSendReportNotification(),
    )
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')

    await result.current.mutateAsync({ id: 'r1', template: 'updated' })

    expect(invalidate).not.toHaveBeenCalled()
  })
})

describe('useMarkPayment (FR-PAY-01/02/05)', () => {
  it('writes ONLY the four payment fields + updatedAt via updateDoc — never status/signedAt', async () => {
    const { result } = await renderHookWithProviders(() => useMarkPayment())

    await result.current.mutateAsync({
      id: 'p1_2026-07',
      values: {
        amountPaid: 1000,
        paymentMethod: 'cash',
        paymentDate: '2026-07-10',
      },
      finalTotal: 1500,
    })

    expect(updateDoc).toHaveBeenCalledTimes(1)
    expect(setDoc).not.toHaveBeenCalled()
    const payload = updateDoc.mock.calls[0][1]
    expect(payload).toEqual({
      amountPaid: 1000,
      paymentMethod: 'cash',
      paymentDate: '2026-07-10',
      paymentStatus: 'partial',
      updatedAt: { __serverTimestamp: true },
    })
    expect(payload).not.toHaveProperty('status')
    expect(payload).not.toHaveProperty('signedAt')
  })

  it('derives paymentStatus: paid on an exact/overpayment', async () => {
    const { result } = await renderHookWithProviders(() => useMarkPayment())

    await result.current.mutateAsync({
      id: 'p1_2026-07',
      values: {
        amountPaid: 1800,
        paymentMethod: 'bank_transfer',
        paymentDate: '2026-07-10',
      },
      finalTotal: 1500,
    })

    expect(updateDoc.mock.calls[0][1].paymentStatus).toBe('paid')
  })

  it('invalidates the report detail AND the tenancies queries on success', async () => {
    const { result, queryClient } = await renderHookWithProviders(() =>
      useMarkPayment(),
    )
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')

    await result.current.mutateAsync({
      id: 'p1_2026-07',
      values: {
        amountPaid: 1000,
        paymentMethod: 'cash',
        paymentDate: '2026-07-10',
      },
      finalTotal: 1500,
    })

    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ['monthlyReports', 'detail', 'p1_2026-07'],
    })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['tenancies'] })
  })

  it('ALSO invalidates the month-list query key on success (M4 sub-stage 7, additive), without dropping the existing detail/tenancies invalidations', async () => {
    const { result, queryClient } = await renderHookWithProviders(() =>
      useMarkPayment(),
    )
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')

    await result.current.mutateAsync({
      id: 'p1_2026-07',
      values: {
        amountPaid: 1000,
        paymentMethod: 'cash',
        paymentDate: '2026-07-10',
      },
      finalTotal: 1500,
    })

    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ['monthlyReports', 'detail', 'p1_2026-07'],
    })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['tenancies'] })
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ['monthlyReports', 'list'],
    })
  })
})

describe('useCancelPayment (FR-PAY-06)', () => {
  it('resets all four payment fields to null/unpaid via updateDoc, using null (not undefined) so stripUndefinedDeep cannot silently skip clearing them', async () => {
    const { result } = await renderHookWithProviders(() => useCancelPayment())

    await result.current.mutateAsync({ id: 'p1_2026-07' })

    expect(updateDoc).toHaveBeenCalledTimes(1)
    const payload = updateDoc.mock.calls[0][1]
    expect(payload).toEqual({
      amountPaid: null,
      paymentMethod: null,
      paymentDate: null,
      paymentStatus: 'unpaid',
      updatedAt: { __serverTimestamp: true },
    })
  })

  it('invalidates the report detail AND the tenancies queries on success', async () => {
    const { result, queryClient } = await renderHookWithProviders(() =>
      useCancelPayment(),
    )
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')

    await result.current.mutateAsync({ id: 'p1_2026-07' })

    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ['monthlyReports', 'detail', 'p1_2026-07'],
    })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['tenancies'] })
  })

  it('ALSO invalidates the month-list query key on success (M4 sub-stage 7, additive), without dropping the existing detail/tenancies invalidations', async () => {
    const { result, queryClient } = await renderHookWithProviders(() =>
      useCancelPayment(),
    )
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')

    await result.current.mutateAsync({ id: 'p1_2026-07' })

    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ['monthlyReports', 'detail', 'p1_2026-07'],
    })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['tenancies'] })
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ['monthlyReports', 'list'],
    })
  })
})

describe('useShareReport (FR-REP-07c, M4 sub-stage 8)', () => {
  it('mints a FRESH token (≥32 chars, base64url charset) when none exists yet', async () => {
    const { result } = await renderHookWithProviders(() => useShareReport())

    const { token } = await result.current.mutateAsync({
      id: 'p1_2026-07',
      shareToken: null,
      shareTokenRevoked: false,
    })

    expect(token.length).toBeGreaterThanOrEqual(32)
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it('writes ONLY shareToken + shareTokenRevoked via updateDoc — never status/signedAt/any report line', async () => {
    const { result } = await renderHookWithProviders(() => useShareReport())

    await result.current.mutateAsync({
      id: 'p1_2026-07',
      shareToken: null,
      shareTokenRevoked: false,
    })

    expect(updateDoc).toHaveBeenCalledTimes(1)
    const payload = updateDoc.mock.calls[0][1]
    expect(Object.keys(payload).sort()).toEqual([
      'shareToken',
      'shareTokenRevoked',
    ])
    expect(payload.shareTokenRevoked).toBe(false)
    expect(typeof payload.shareToken).toBe('string')
  })

  it('reuses the EXISTING token when one is live (not revoked) — writes NOTHING', async () => {
    const { result } = await renderHookWithProviders(() => useShareReport())

    const { token, wrote } = await result.current.mutateAsync({
      id: 'p1_2026-07',
      shareToken: 'existing-live-token',
      shareTokenRevoked: false,
    })

    expect(token).toBe('existing-live-token')
    expect(wrote).toBe(false)
    expect(updateDoc).not.toHaveBeenCalled()
  })

  it('mints a NEW token when the previous one was REVOKED — never reuses a revoked token', async () => {
    const { result } = await renderHookWithProviders(() => useShareReport())

    const { token, wrote } = await result.current.mutateAsync({
      id: 'p1_2026-07',
      shareToken: 'old-revoked-token',
      shareTokenRevoked: true,
    })

    expect(token).not.toBe('old-revoked-token')
    expect(wrote).toBe(true)
    expect(updateDoc.mock.calls[0][1].shareToken).toBe(token)
    expect(updateDoc.mock.calls[0][1].shareTokenRevoked).toBe(false)
  })

  it('invalidates the report detail query only when it actually wrote (fresh/re-minted token)', async () => {
    const { result, queryClient } = await renderHookWithProviders(() =>
      useShareReport(),
    )
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')

    await result.current.mutateAsync({
      id: 'p1_2026-07',
      shareToken: null,
      shareTokenRevoked: false,
    })

    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ['monthlyReports', 'detail', 'p1_2026-07'],
    })
  })

  it('does NOT invalidate anything when reusing an existing token (no write happened)', async () => {
    const { result, queryClient } = await renderHookWithProviders(() =>
      useShareReport(),
    )
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')

    await result.current.mutateAsync({
      id: 'p1_2026-07',
      shareToken: 'existing-live-token',
      shareTokenRevoked: false,
    })

    expect(invalidate).not.toHaveBeenCalled()
  })
})

describe('useRevokeShareLink (FR-REP-07c)', () => {
  it('writes ONLY shareTokenRevoked:true — never touches shareToken, status, or signedAt', async () => {
    const { result } = await renderHookWithProviders(() => useRevokeShareLink())

    await result.current.mutateAsync({ id: 'p1_2026-07' })

    expect(updateDoc).toHaveBeenCalledTimes(1)
    const payload = updateDoc.mock.calls[0][1]
    expect(payload).toEqual({ shareTokenRevoked: true })
  })

  it('invalidates the report detail query on success', async () => {
    const { result, queryClient } = await renderHookWithProviders(() =>
      useRevokeShareLink(),
    )
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')

    await result.current.mutateAsync({ id: 'p1_2026-07' })

    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ['monthlyReports', 'detail', 'p1_2026-07'],
    })
  })
})
