import { beforeEach, describe, expect, it, vi } from 'vitest'
import { waitFor } from '@testing-library/react'
import { getDoc, serverTimestamp, setDoc } from 'firebase/firestore'
import { renderHookWithProviders } from './renderWithProviders'
import {
  buildReportId,
  useMonthlyReport,
  useSaveReportDraft,
} from '@/features/reports/hooks'

// Hook tests with the BOUNDARY MOCKED — no emulator, same convention as
// properties.hooks.test.jsx / tenants.hooks.test.jsx.

vi.mock('@/lib/firebase', () => ({
  db: { __fake: 'db' },
  auth: { currentUser: { uid: 'admin-uid' } },
}))

vi.mock('firebase/firestore', () => ({
  doc: vi.fn((_db, collection, id) => ({ __doc: `${collection}/${id}` })),
  getDoc: vi.fn(),
  setDoc: vi.fn(),
  serverTimestamp: vi.fn(() => ({ __serverTimestamp: true })),
}))

beforeEach(() => {
  vi.clearAllMocks()
  setDoc.mockResolvedValue(undefined)
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

describe('useSaveReportDraft', () => {
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

    await result.current.mutateAsync({ id: 'p1_2026-07', values: VALUES })

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
    expect(serverTimestamp).toHaveBeenCalled()
  })

  it('strips undefined values recursively before writing (CLAUDE.md §7)', async () => {
    const { result } = await renderHookWithProviders(() => useSaveReportDraft())

    await result.current.mutateAsync({ id: 'p1_2026-07', values: VALUES })

    const written = setDoc.mock.calls[0][1]
    expect(written.rent).not.toHaveProperty('notes')
  })

  it('resolves with the id (so the caller can invalidate/navigate)', async () => {
    const { result } = await renderHookWithProviders(() => useSaveReportDraft())

    await expect(
      result.current.mutateAsync({ id: 'p1_2026-07', values: VALUES }),
    ).resolves.toBe('p1_2026-07')
  })

  it('invalidates the report detail query on success', async () => {
    const { result, queryClient } = await renderHookWithProviders(() =>
      useSaveReportDraft(),
    )
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')

    await result.current.mutateAsync({ id: 'p1_2026-07', values: VALUES })

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
      result.current.mutateAsync({ id: 'p1_2026-07', values: VALUES }),
    ).rejects.toThrow()
    expect(invalidate).not.toHaveBeenCalled()
  })
})
