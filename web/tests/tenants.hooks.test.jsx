import { beforeEach, describe, expect, it, vi } from 'vitest'
import { waitFor } from '@testing-library/react'
import { doc, getDocs, query, updateDoc, where } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { renderHookWithProviders } from './renderWithProviders'
import {
  useActiveTenancies,
  useEndTenancy,
  useResetTenantPassword,
  useSetTenantAccountStatus,
  useUpdateTenancy,
  useUpdateUser,
  useUserTenancies,
  useUsers,
} from '@/features/tenants/hooks'

// Hook tests with the BOUNDARY MOCKED — no emulator, same convention as the
// onboarding/property hook tests. We check WHICH Firestore operation runs and
// with WHICH constraints; that the rules actually allow the admin read sits in
// the rules band (unchanged here — firestore.rules already grants admin full
// read on both `users` and `tenancies`).

vi.mock('@/lib/firebase', () => ({
  db: { __fake: 'db' },
  functions: { __fake: 'functions' },
}))

vi.mock('firebase/firestore', () => ({
  collection: vi.fn((_db, name) => ({ __collection: name })),
  doc: vi.fn((_db, collection, id) => ({ __doc: `${collection}/${id}` })),
  getDocs: vi.fn(),
  updateDoc: vi.fn(),
  query: vi.fn((...args) => ({ __query: args })),
  where: vi.fn((field, op, value) => ({ __where: [field, op, value] })),
}))

vi.mock('firebase/functions', () => ({ httpsCallable: vi.fn() }))

function listSnapshot(docs) {
  return { docs: docs.map(({ id, ...data }) => ({ id, data: () => data })) }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('useUsers (FR-TEN-13 — all tenants)', () => {
  it('reads every user with its id alongside the data', async () => {
    const USERS = [
      { id: 'u1', name: 'Ana', status: 'active' },
      { id: 'u2', name: 'Barbu', status: 'inactive-readonly' },
    ]
    getDocs.mockResolvedValue(listSnapshot(USERS))

    const { result } = await renderHookWithProviders(() => useUsers())

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual(USERS)
    // The whole collection — no WHERE. The archived filtering is a display
    // preference done client-side (status is an enum, not a boolean axis).
    expect(getDocs).toHaveBeenCalledWith({ __collection: 'users' })
  })
})

describe('useActiveTenancies (FR-CON-02 — join for property + balance)', () => {
  it('reads only the active tenancies, constrained by status', async () => {
    const TENANCIES = [
      {
        id: 't1',
        userId: 'u1',
        property: { name: 'Apartament Centru' },
        currentBalance: 0,
        status: 'active',
      },
    ]
    getDocs.mockResolvedValue(listSnapshot(TENANCIES))

    const { result } = await renderHookWithProviders(() => useActiveTenancies())

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual(TENANCIES)
    // The query is constrained to status == 'active' — ended tenancies never
    // decide a row's "current property".
    expect(where).toHaveBeenCalledWith('status', '==', 'active')
    expect(query).toHaveBeenCalledWith(
      { __collection: 'tenancies' },
      { __where: ['status', '==', 'active'] },
    )
  })
})

describe('useUpdateUser (FR-TEN-11 — Profile tab per-section edit)', () => {
  beforeEach(() => {
    updateDoc.mockResolvedValue(undefined)
  })

  it('writes the values to users/{id}, stripped of undefined keys', async () => {
    const { result } = await renderHookWithProviders(() => useUpdateUser())

    await result.current.mutateAsync({
      id: 'u1',
      values: { name: 'Ana Pop', mailingAddress: undefined },
    })

    expect(doc).toHaveBeenCalledWith({ __fake: 'db' }, 'users', 'u1')
    expect(updateDoc).toHaveBeenCalledWith(
      { __doc: 'users/u1' },
      { name: 'Ana Pop' },
    )
  })

  // Regression (advisor-flagged, M3-B): `guarantor` is ONE Firestore map holding
  // both the text fields (name/cnp/phone) AND `idDocumentPhotos[]` (owned by the
  // gallery, not the text-section form). A naive `{ guarantor: {name,cnp,phone} }`
  // would REPLACE the whole map and silently drop the photos. The hook itself
  // does no flattening — it is a dumb pass-through — so a caller using
  // Firestore's own dot-path keys must reach Firestore untouched, byte for byte.
  it('passes dot-path keys straight through, so a nested-object write does not need to know its siblings', async () => {
    const { result } = await renderHookWithProviders(() => useUpdateUser())

    await result.current.mutateAsync({
      id: 'u1',
      values: {
        'guarantor.name': 'Maria Ionescu',
        'guarantor.cnp': '9876543210123',
        'guarantor.phone': '0733000111',
      },
    })

    expect(updateDoc).toHaveBeenCalledWith(
      { __doc: 'users/u1' },
      {
        'guarantor.name': 'Maria Ionescu',
        'guarantor.cnp': '9876543210123',
        'guarantor.phone': '0733000111',
      },
    )
  })

  it('invalidates both the tenant list and the user detail on success', async () => {
    const { result, queryClient } = await renderHookWithProviders(() =>
      useUpdateUser(),
    )
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')

    await result.current.mutateAsync({ id: 'u1', values: { name: 'Ana' } })

    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ['users', 'list'],
    })
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ['users', 'detail', 'u1'],
    })
  })
})

describe('useUserTenancies (FR-TEN-15 — full history for one user)', () => {
  it('reads every tenancy for the user, active and ended alike (no status filter)', async () => {
    const TENANCIES = [
      { id: 't1', userId: 'u1', status: 'active' },
      { id: 't2', userId: 'u1', status: 'ended' },
    ]
    getDocs.mockResolvedValue(listSnapshot(TENANCIES))

    const { result } = await renderHookWithProviders(() =>
      useUserTenancies('u1'),
    )

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual(TENANCIES)
    expect(where).toHaveBeenCalledWith('userId', '==', 'u1')
    expect(query).toHaveBeenCalledWith(
      { __collection: 'tenancies' },
      { __where: ['userId', '==', 'u1'] },
    )
  })

  it('does not query until a userId is provided', async () => {
    const { result } = await renderHookWithProviders(() =>
      useUserTenancies(undefined),
    )

    expect(result.current.fetchStatus).toBe('idle')
    expect(getDocs).not.toHaveBeenCalled()
  })
})

describe('useUpdateTenancy (FR-CON-06 — Extend)', () => {
  beforeEach(() => {
    updateDoc.mockResolvedValue(undefined)
  })

  it('writes the values to tenancies/{id}, stripped of undefined keys', async () => {
    const { result } = await renderHookWithProviders(() => useUpdateTenancy())

    await result.current.mutateAsync({
      id: 't1',
      userId: 'u1',
      values: { endDate: '2028-01-01', securityDeposit: undefined },
    })

    expect(doc).toHaveBeenCalledWith({ __fake: 'db' }, 'tenancies', 't1')
    expect(updateDoc).toHaveBeenCalledWith(
      { __doc: 'tenancies/t1' },
      { endDate: '2028-01-01' },
    )
  })

  it('invalidates the user’s tenancy history and the active-tenancies list', async () => {
    const { result, queryClient } = await renderHookWithProviders(() =>
      useUpdateTenancy(),
    )
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')

    await result.current.mutateAsync({
      id: 't1',
      userId: 'u1',
      values: { endDate: '2028-01-01' },
    })

    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ['tenancies', 'byUser', 'u1'],
    })
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ['tenancies', 'active', 'list'],
    })
  })
})

describe('useEndTenancy (FR-CON-03/04/05 — End contract)', () => {
  const endTenancyMock = vi.fn()

  beforeEach(() => {
    httpsCallable.mockReturnValue(endTenancyMock)
    endTenancyMock.mockResolvedValue({ data: { tenancyId: 't1' } })
  })

  it('calls the endTenancy callable with the tenancyId', async () => {
    const { result } = await renderHookWithProviders(() => useEndTenancy())

    await result.current.mutateAsync({
      tenancyId: 't1',
      userId: 'u1',
      propertyId: 'p1',
    })

    expect(httpsCallable).toHaveBeenCalledWith(
      { __fake: 'functions' },
      'endTenancy',
    )
    expect(endTenancyMock).toHaveBeenCalledWith({ tenancyId: 't1' })
  })

  it('invalidates tenancy, user, and property caches on success', async () => {
    const { result, queryClient } = await renderHookWithProviders(() =>
      useEndTenancy(),
    )
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')

    await result.current.mutateAsync({
      tenancyId: 't1',
      userId: 'u1',
      propertyId: 'p1',
    })

    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ['tenancies', 'byUser', 'u1'],
    })
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ['tenancies', 'active', 'list'],
    })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['users', 'list'] })
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ['users', 'detail', 'u1'],
    })
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ['properties', 'list'],
    })
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ['properties', 'detail', 'p1'],
    })
  })

  // Anti-vacuity: without a try/catch swallowing it, this proves the caller
  // (the End-contract dialog) can classify the arrears error and show the
  // right message instead of a generic failure.
  it('propagates a failed-precondition (arrears) error without swallowing it', async () => {
    const arrearsError = Object.assign(new Error('failed'), {
      code: 'functions/failed-precondition',
      details: { reason: 'arrears', currentBalance: 150 },
    })
    endTenancyMock.mockRejectedValue(arrearsError)
    const { result } = await renderHookWithProviders(() => useEndTenancy())

    await expect(
      result.current.mutateAsync({
        tenancyId: 't1',
        userId: 'u1',
        propertyId: 'p1',
      }),
    ).rejects.toMatchObject({ details: { reason: 'arrears' } })
  })
})

describe('useResetTenantPassword (Account tab — Reset password)', () => {
  const resetMock = vi.fn()

  beforeEach(() => {
    httpsCallable.mockReturnValue(resetMock)
    resetMock.mockResolvedValue({ data: { password: 'AbCdEfGh2345' } })
  })

  it('calls the resetTenantPassword callable with userId', async () => {
    const { result } = await renderHookWithProviders(() =>
      useResetTenantPassword(),
    )

    const response = await result.current.mutateAsync({ userId: 'u1' })

    expect(httpsCallable).toHaveBeenCalledWith(
      { __fake: 'functions' },
      'resetTenantPassword',
    )
    expect(resetMock).toHaveBeenCalledWith({ userId: 'u1' })
    expect(response.data.password).toBe('AbCdEfGh2345')
  })
})

describe('useSetTenantAccountStatus (Account tab — Disable/Re-enable)', () => {
  const statusMock = vi.fn()

  beforeEach(() => {
    httpsCallable.mockReturnValue(statusMock)
    statusMock.mockResolvedValue({ data: { status: 'disabled' } })
  })

  it('calls the setTenantAccountStatus callable with userId + action', async () => {
    const { result } = await renderHookWithProviders(() =>
      useSetTenantAccountStatus(),
    )

    await result.current.mutateAsync({ userId: 'u1', action: 'disable' })

    expect(httpsCallable).toHaveBeenCalledWith(
      { __fake: 'functions' },
      'setTenantAccountStatus',
    )
    expect(statusMock).toHaveBeenCalledWith({
      userId: 'u1',
      action: 'disable',
    })
  })

  it('invalidates the tenant list and the user detail on success', async () => {
    const { result, queryClient } = await renderHookWithProviders(() =>
      useSetTenantAccountStatus(),
    )
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')

    await result.current.mutateAsync({ userId: 'u1', action: 'enable' })

    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['users', 'list'] })
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ['users', 'detail', 'u1'],
    })
  })
})
