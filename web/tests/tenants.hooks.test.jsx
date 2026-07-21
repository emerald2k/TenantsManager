import { beforeEach, describe, expect, it, vi } from 'vitest'
import { waitFor } from '@testing-library/react'
import { doc, getDocs, query, updateDoc, where } from 'firebase/firestore'
import { renderHookWithProviders } from './renderWithProviders'
import {
  useActiveTenancies,
  useUpdateUser,
  useUsers,
} from '@/features/tenants/hooks'

// Hook tests with the BOUNDARY MOCKED — no emulator, same convention as the
// onboarding/property hook tests. We check WHICH Firestore operation runs and
// with WHICH constraints; that the rules actually allow the admin read sits in
// the rules band (unchanged here — firestore.rules already grants admin full
// read on both `users` and `tenancies`).

vi.mock('@/lib/firebase', () => ({
  db: { __fake: 'db' },
}))

vi.mock('firebase/firestore', () => ({
  collection: vi.fn((_db, name) => ({ __collection: name })),
  doc: vi.fn((_db, collection, id) => ({ __doc: `${collection}/${id}` })),
  getDocs: vi.fn(),
  updateDoc: vi.fn(),
  query: vi.fn((...args) => ({ __query: args })),
  where: vi.fn((field, op, value) => ({ __where: [field, op, value] })),
}))

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
