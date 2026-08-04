import { beforeEach, describe, expect, it, vi } from 'vitest'
import { waitFor } from '@testing-library/react'
import { getDoc, getDocs, Timestamp, where } from 'firebase/firestore'
import { renderHookWithProviders } from './renderWithProviders'
import {
  useMySignedReports,
  useMyTenancy,
  useTenantReport,
} from '@/features/tenantApp/hooks'

// Hook tests with the BOUNDARY MOCKED — no emulator, same convention as
// reports.hooks.test.jsx/tenants.hooks.test.jsx. `Timestamp` is kept REAL
// (via importOriginal) so `useMyTenancy`'s endedAt comparisons are exercised
// against actual Firestore Timestamp semantics (.toMillis()), not a
// hand-rolled stand-in — the M5 sub-stage 2 plan calls this out explicitly.

vi.mock('@/lib/firebase', () => ({
  db: { __fake: 'db' },
}))

vi.mock('firebase/firestore', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    doc: vi.fn((_db, collection, id) => ({ __doc: `${collection}/${id}` })),
    getDoc: vi.fn(),
    getDocs: vi.fn(),
    collection: vi.fn((_db, name) => ({ __collection: name })),
    query: vi.fn((...args) => ({ __query: args })),
    where: vi.fn((field, op, value) => ({ __where: [field, op, value] })),
  }
})

beforeEach(() => {
  vi.clearAllMocks()
})

function snapshot(docs) {
  return {
    docs: docs.map((data, index) => ({
      id: data.id ?? `doc-${index}`,
      data: () => data,
    })),
  }
}

describe('useMyTenancy', () => {
  it('B1 — returns the ACTIVE tenancy regardless of array order (seeded LAST)', async () => {
    getDocs.mockResolvedValue(
      snapshot([
        {
          id: 't-ended',
          status: 'ended',
          endedAt: Timestamp.fromDate(new Date('2025-01-01')),
        },
        { id: 't-active', status: 'active' },
      ]),
    )

    const { result } = await renderHookWithProviders(() =>
      useMyTenancy('tenant-1'),
    )
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data.id).toBe('t-active')
  })

  it('B2 — falls back to the most-recently-ENDED tenancy, comparing REAL Timestamps, out of order', async () => {
    getDocs.mockResolvedValue(
      snapshot([
        {
          id: 't-older',
          status: 'ended',
          endedAt: Timestamp.fromDate(new Date('2025-01-01')),
        },
        {
          id: 't-newer',
          status: 'ended',
          endedAt: Timestamp.fromDate(new Date('2026-06-01')),
        },
      ]),
    )

    const { result } = await renderHookWithProviders(() =>
      useMyTenancy('tenant-1'),
    )
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data.id).toBe('t-newer')
  })

  it('B3 — returns null when there are no tenancies at all', async () => {
    getDocs.mockResolvedValue(snapshot([]))

    const { result } = await renderHookWithProviders(() =>
      useMyTenancy('tenant-1'),
    )
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toBeNull()
  })

  it('B4a — an ended tenancy with NO endedAt is never chosen over one that has it, and does not crash', async () => {
    getDocs.mockResolvedValue(
      snapshot([
        { id: 't-no-date', status: 'ended' },
        {
          id: 't-dated',
          status: 'ended',
          endedAt: Timestamp.fromDate(new Date('2025-01-01')),
        },
      ]),
    )

    const { result } = await renderHookWithProviders(() =>
      useMyTenancy('tenant-1'),
    )
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data.id).toBe('t-dated')
  })

  it('B4b — resolves to null (not that tenancy) when the ONLY ended tenancy has no endedAt and none is active', async () => {
    getDocs.mockResolvedValue(snapshot([{ id: 't-no-date', status: 'ended' }]))

    const { result } = await renderHookWithProviders(() =>
      useMyTenancy('tenant-1'),
    )
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toBeNull()
  })
})

describe('useMySignedReports', () => {
  it('B5 — issues the query with BOTH userId== and status==signed', async () => {
    getDocs.mockResolvedValue(snapshot([]))

    const { result } = await renderHookWithProviders(() =>
      useMySignedReports('tenant-1'),
    )
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(where).toHaveBeenCalledWith('userId', '==', 'tenant-1')
    expect(where).toHaveBeenCalledWith('status', '==', 'signed')
  })

  it('sorts the results CLIENT-SIDE, newest month/year first (not via orderBy — plan Task 2 note)', async () => {
    getDocs.mockResolvedValue(
      snapshot([
        { id: 'r-jan', month: 1, year: 2026 },
        { id: 'r-jul-prev', month: 7, year: 2025 },
        { id: 'r-jul', month: 7, year: 2026 },
      ]),
    )

    const { result } = await renderHookWithProviders(() =>
      useMySignedReports('tenant-1'),
    )
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data.map((r) => r.id)).toEqual([
      'r-jul',
      'r-jan',
      'r-jul-prev',
    ])
  })
})

describe('useTenantReport', () => {
  it('B6 — resolves to null when getDoc rejects with permission-denied (foreign/draft report)', async () => {
    getDoc.mockRejectedValue({ code: 'permission-denied' })

    const { result } = await renderHookWithProviders(() =>
      useTenantReport('report-1'),
    )
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toBeNull()
  })

  it('B7 — resolves to null when the document plainly does not exist', async () => {
    getDoc.mockResolvedValue({ exists: () => false })

    const { result } = await renderHookWithProviders(() =>
      useTenantReport('report-1'),
    )
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toBeNull()
  })

  it('B8 — returns { id, ...data } for a real, owned, signed report', async () => {
    getDoc.mockResolvedValue({
      exists: () => true,
      id: 'report-1',
      data: () => ({ status: 'signed', finalTotal: 100 }),
    })

    const { result } = await renderHookWithProviders(() =>
      useTenantReport('report-1'),
    )
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual({
      id: 'report-1',
      status: 'signed',
      finalTotal: 100,
    })
  })
})
