import { beforeEach, describe, expect, it, vi } from 'vitest'
import { waitFor } from '@testing-library/react'
import {
  addDoc,
  arrayRemove,
  arrayUnion,
  deleteDoc,
  getDoc,
  getDocs,
  updateDoc,
  where,
} from 'firebase/firestore'
import { renderHookWithProviders } from './renderWithProviders'
import {
  useActiveTenancyForProperty,
  useAddService,
  useArchiveProperty,
  useCreateProperty,
  useProperties,
  useProperty,
  useRemoveService,
  useUpdateProperty,
} from '@/features/properties/hooks'

// Hook tests with the BOUNDARY MOCKED — no emulator. They check the data layer's
// logic: which Firestore operation is called, with which arguments, and what gets
// invalidated. That the rules actually allow/deny sits in the rules band; that a
// write actually reaches Firestore is verified at sub-stage C, on the first
// end-to-end flow.

// `@/lib/firebase` MUST be mocked, not just `firebase/firestore`: the real module
// calls `initializeApp` and throws at import time if the VITE_FIREBASE_* variables
// are missing. Since `.env` is gitignored, without the mock the suite would depend
// on the machine it runs on.
vi.mock('@/lib/firebase', () => ({
  db: { __fake: 'db' },
  auth: { currentUser: { uid: 'admin-uid' } },
}))

vi.mock('firebase/firestore', () => ({
  collection: vi.fn((_db, name) => ({ __collection: name })),
  doc: vi.fn((_db, collection, id) => ({ __doc: `${collection}/${id}` })),
  query: vi.fn((collection, ...constraints) => ({
    __collection: collection,
    constraints,
  })),
  where: vi.fn((field, op, value) => ({ __where: [field, op, value] })),
  limit: vi.fn((n) => ({ __limit: n })),
  getDocs: vi.fn(),
  getDoc: vi.fn(),
  addDoc: vi.fn(),
  updateDoc: vi.fn(),
  deleteDoc: vi.fn(),
  arrayUnion: vi.fn((value) => ({ __arrayUnion: value })),
  arrayRemove: vi.fn((value) => ({ __arrayRemove: value })),
}))

function listSnapshot(properties) {
  return {
    docs: properties.map(({ id, ...data }) => ({ id, data: () => data })),
    empty: properties.length === 0,
  }
}

const FREE_PROPERTY = { id: 'p1', name: 'Downtown Apartment', archived: false }

beforeEach(() => {
  vi.clearAllMocks()
  getDocs.mockResolvedValue(listSnapshot([FREE_PROPERTY]))
  addDoc.mockResolvedValue({ id: 'p-new' })
  updateDoc.mockResolvedValue(undefined)
})

describe('useProperties — filtering out archived (FR-PROP-06/07)', () => {
  it('filters out archived in the query, by default', async () => {
    const { result } = await renderHookWithProviders(() => useProperties())

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(where).toHaveBeenCalledWith('archived', '==', false)
  })

  it('stops filtering when archived are requested (the toggle from E)', async () => {
    const { result } = await renderHookWithProviders(() =>
      useProperties({ includeArchived: true }),
    )

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(where).not.toHaveBeenCalled()
  })

  it('returns the documents with the id alongside the data', async () => {
    const { result } = await renderHookWithProviders(() => useProperties())

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual([FREE_PROPERTY])
  })
})

describe('useProperty', () => {
  it('reads the requested document', async () => {
    getDoc.mockResolvedValue({
      exists: () => true,
      id: 'p1',
      data: () => ({ name: 'Downtown Apartment' }),
    })

    const { result } = await renderHookWithProviders(() => useProperty('p1'))

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual({
      id: 'p1',
      name: 'Downtown Apartment',
    })
  })

  it('signals an error if the document does not exist', async () => {
    getDoc.mockResolvedValue({ exists: () => false })

    const { result } = await renderHookWithProviders(() =>
      useProperty('missing'),
    )

    await waitFor(() => expect(result.current.isError).toBe(true))
  })

  it('reads nothing without an id', async () => {
    const { result } = await renderHookWithProviders(() =>
      useProperty(undefined),
    )

    expect(result.current.fetchStatus).toBe('idle')
    expect(getDoc).not.toHaveBeenCalled()
  })
})

describe('useCreateProperty (FR-PROP-01)', () => {
  const VALUES = { name: 'New House', address: { street: 'Plopilor' } }

  it('adds the document with the system fields filled in', async () => {
    const { result } = await renderHookWithProviders(() => useCreateProperty())

    await result.current.mutateAsync(VALUES)

    expect(addDoc).toHaveBeenCalledWith(
      { __collection: 'properties' },
      {
        ...VALUES,
        ownerId: 'admin-uid',
        services: [],
        status: 'free',
        archived: false,
      },
    )
  })

  it('sets archived:false explicitly — otherwise the document would be missing from the list', async () => {
    // `where('archived','==',false)` does NOT return documents lacking the field.
    const { result } = await renderHookWithProviders(() => useCreateProperty())

    await result.current.mutateAsync(VALUES)

    expect(addDoc.mock.calls[0][1].archived).toBe(false)
  })

  it('returns the created document id (for the redirect at C)', async () => {
    const { result } = await renderHookWithProviders(() => useCreateProperty())

    await expect(result.current.mutateAsync(VALUES)).resolves.toBe('p-new')
  })

  it('invalidates the lists on success', async () => {
    const { result, queryClient } = await renderHookWithProviders(() =>
      useCreateProperty(),
    )
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')

    await result.current.mutateAsync(VALUES)

    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ['properties', 'list'],
    })
  })

  it('invalidates nothing if the write fails', async () => {
    addDoc.mockRejectedValue(new Error('permission-denied'))
    const { result, queryClient } = await renderHookWithProviders(() =>
      useCreateProperty(),
    )
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')

    await expect(result.current.mutateAsync(VALUES)).rejects.toThrow()
    expect(invalidate).not.toHaveBeenCalled()
  })
})

describe('useUpdateProperty (FR-PROP-04)', () => {
  it('updates the requested document', async () => {
    const { result } = await renderHookWithProviders(() => useUpdateProperty())

    await result.current.mutateAsync({
      id: 'p1',
      values: { name: 'Renamed' },
    })

    expect(updateDoc).toHaveBeenCalledWith(
      { __doc: 'properties/p1' },
      { name: 'Renamed' },
    )
  })

  it('invalidates the list and the detail on success', async () => {
    const { result, queryClient } = await renderHookWithProviders(() =>
      useUpdateProperty(),
    )
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')

    await result.current.mutateAsync({
      id: 'p1',
      values: { name: 'Renamed' },
    })

    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ['properties', 'list'],
    })
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ['properties', 'detail', 'p1'],
    })
  })
})

describe('useArchiveProperty — soft-delete (FR-PROP-06)', () => {
  it('marks archived:true', async () => {
    const { result } = await renderHookWithProviders(() => useArchiveProperty())

    await result.current.mutateAsync('p1')

    expect(updateDoc).toHaveBeenCalledWith(
      { __doc: 'properties/p1' },
      { archived: true },
    )
  })

  it('does NOT delete the document — the history must survive', async () => {
    const { result } = await renderHookWithProviders(() => useArchiveProperty())

    await result.current.mutateAsync('p1')

    expect(deleteDoc).not.toHaveBeenCalled()
  })

  it('invalidates the list and the detail on success', async () => {
    const { result, queryClient } = await renderHookWithProviders(() =>
      useArchiveProperty(),
    )
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')

    await result.current.mutateAsync('p1')

    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ['properties', 'list'],
    })
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ['properties', 'detail', 'p1'],
    })
  })
})

describe('useAddService / useRemoveService (FR-PROP-02)', () => {
  const SERVICE = { serviceId: 'gas', name: 'Gas', source: 'catalog' }

  it('adds the service with arrayUnion, without re-reading the document', async () => {
    const { result } = await renderHookWithProviders(() => useAddService())

    await result.current.mutateAsync({ propertyId: 'p1', service: SERVICE })

    expect(arrayUnion).toHaveBeenCalledWith(SERVICE)
    expect(updateDoc).toHaveBeenCalledWith(
      { __doc: 'properties/p1' },
      { services: { __arrayUnion: SERVICE } },
    )
    expect(getDoc).not.toHaveBeenCalled()
  })

  it('removes the service with arrayRemove', async () => {
    const { result } = await renderHookWithProviders(() => useRemoveService())

    await result.current.mutateAsync({ propertyId: 'p1', service: SERVICE })

    expect(arrayRemove).toHaveBeenCalledWith(SERVICE)
    expect(updateDoc).toHaveBeenCalledWith(
      { __doc: 'properties/p1' },
      { services: { __arrayRemove: SERVICE } },
    )
  })

  it('passes custom services through too, without knowing the difference', async () => {
    const custom = { serviceId: 'gardener', name: 'Gardener', source: 'custom' }
    const { result } = await renderHookWithProviders(() => useAddService())

    await result.current.mutateAsync({ propertyId: 'p1', service: custom })

    expect(arrayUnion).toHaveBeenCalledWith(custom)
  })

  it('invalidates the property detail on success', async () => {
    const { result, queryClient } = await renderHookWithProviders(() =>
      useAddService(),
    )
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')

    await result.current.mutateAsync({ propertyId: 'p1', service: SERVICE })

    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ['properties', 'detail', 'p1'],
    })
  })
})

describe('useActiveTenancyForProperty (Sub-stage E, FR-PROP-11)', () => {
  it('returns the active tenancy for the property', async () => {
    getDocs.mockResolvedValue(
      listSnapshot([
        { id: 't1', propertyId: 'p1', status: 'active', dueDay: '5' },
      ]),
    )

    const { result } = await renderHookWithProviders(() =>
      useActiveTenancyForProperty('p1'),
    )

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual({
      id: 't1',
      propertyId: 'p1',
      status: 'active',
      dueDay: '5',
    })
    expect(where).toHaveBeenCalledWith('propertyId', '==', 'p1')
    expect(where).toHaveBeenCalledWith('status', '==', 'active')
  })

  it('returns null when the property has no active tenancy', async () => {
    getDocs.mockResolvedValue(listSnapshot([]))

    const { result } = await renderHookWithProviders(() =>
      useActiveTenancyForProperty('p1'),
    )

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toBeNull()
  })

  it('reads nothing without a propertyId', async () => {
    const { result } = await renderHookWithProviders(() =>
      useActiveTenancyForProperty(undefined),
    )

    expect(result.current.fetchStatus).toBe('idle')
    expect(getDocs).not.toHaveBeenCalled()
  })
})
