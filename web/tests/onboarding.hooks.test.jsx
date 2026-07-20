import { beforeEach, describe, expect, it, vi } from 'vitest'
import { waitFor } from '@testing-library/react'
import {
  addDoc,
  deleteDoc,
  getDoc,
  getDocs,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore'
import { deleteObject, listAll } from 'firebase/storage'
import { renderHookWithProviders } from './renderWithProviders'
import {
  useCreateDraft,
  useDeleteDraft,
  useDraft,
  useDraftsList,
  useUpdateDraft,
  useUserById,
} from '@/features/onboarding/hooks'

// Hook tests with the BOUNDARY MOCKED — no emulator. They check the data layer's
// logic: which Firestore/Storage operation runs, with which arguments, and what
// gets invalidated. That the rules actually allow/deny sits in the rules band.

// `@/lib/firebase` MUST be mocked: the real module calls `initializeApp` and throws
// at import time without the VITE_FIREBASE_* variables (gitignored `.env`).
vi.mock('@/lib/firebase', () => ({
  db: { __fake: 'db' },
  storage: { __fake: 'storage' },
}))

vi.mock('firebase/firestore', () => ({
  collection: vi.fn((_db, name) => ({ __collection: name })),
  doc: vi.fn((_db, collection, id) => ({ __doc: `${collection}/${id}` })),
  getDocs: vi.fn(),
  getDoc: vi.fn(),
  addDoc: vi.fn(),
  updateDoc: vi.fn(),
  deleteDoc: vi.fn(),
  serverTimestamp: vi.fn(() => ({ __serverTimestamp: true })),
}))

vi.mock('firebase/storage', () => ({
  ref: vi.fn((_storage, path) => ({ __ref: path })),
  listAll: vi.fn(),
  deleteObject: vi.fn(),
}))

function listSnapshot(drafts) {
  return {
    docs: drafts.map(({ id, ...data }) => ({ id, data: () => data })),
  }
}

const DRAFT = { id: 'd1', status: 'in_progress', currentStep: 1, name: 'Ion' }

beforeEach(() => {
  vi.clearAllMocks()
  getDocs.mockResolvedValue(listSnapshot([DRAFT]))
  addDoc.mockResolvedValue({ id: 'd-new' })
  updateDoc.mockResolvedValue(undefined)
  deleteDoc.mockResolvedValue(undefined)
  listAll.mockResolvedValue({ items: [] })
  deleteObject.mockResolvedValue(undefined)
})

describe('useDraftsList (FR-TEN-19)', () => {
  it('reads the drafts with the id alongside the data', async () => {
    const { result } = await renderHookWithProviders(() => useDraftsList())

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual([DRAFT])
  })
})

describe('useDraft (FR-TEN-17)', () => {
  it('reads the requested draft', async () => {
    getDoc.mockResolvedValue({
      exists: () => true,
      id: 'd1',
      data: () => ({ name: 'Ion' }),
    })

    const { result } = await renderHookWithProviders(() => useDraft('d1'))

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual({ id: 'd1', name: 'Ion' })
  })

  it('signals an error if the draft does not exist', async () => {
    getDoc.mockResolvedValue({ exists: () => false })

    const { result } = await renderHookWithProviders(() => useDraft('missing'))

    await waitFor(() => expect(result.current.isError).toBe(true))
  })

  it('reads nothing without an id', async () => {
    const { result } = await renderHookWithProviders(() => useDraft(undefined))

    expect(result.current.fetchStatus).toBe('idle')
    expect(getDoc).not.toHaveBeenCalled()
  })
})

describe('useCreateDraft (FR-TEN-17)', () => {
  it('adds the draft with the system fields filled in', async () => {
    const { result } = await renderHookWithProviders(() => useCreateDraft())

    await result.current.mutateAsync({ email: 'ion@example.com' })

    expect(addDoc).toHaveBeenCalledWith(
      { __collection: 'onboardingDrafts' },
      {
        email: 'ion@example.com',
        status: 'in_progress',
        currentStep: 1,
        createdAt: { __serverTimestamp: true },
        updatedAt: { __serverTimestamp: true },
      },
    )
    expect(serverTimestamp).toHaveBeenCalled()
  })

  it('creates an empty draft when called with no values', async () => {
    const { result } = await renderHookWithProviders(() => useCreateDraft())

    await result.current.mutateAsync()

    expect(addDoc.mock.calls[0][1]).toMatchObject({
      status: 'in_progress',
      currentStep: 1,
    })
  })

  it('returns the created draft id', async () => {
    const { result } = await renderHookWithProviders(() => useCreateDraft())

    await expect(result.current.mutateAsync({})).resolves.toBe('d-new')
  })

  it('invalidates the list on success', async () => {
    const { result, queryClient } = await renderHookWithProviders(() =>
      useCreateDraft(),
    )
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')

    await result.current.mutateAsync({})

    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ['onboardingDrafts', 'list'],
    })
  })
})

describe('useUpdateDraft — autosave (FR-TEN-17)', () => {
  it('updates the draft with the values, the current step, and a fresh updatedAt', async () => {
    const { result } = await renderHookWithProviders(() => useUpdateDraft())

    await result.current.mutateAsync({
      id: 'd1',
      values: { name: 'Ion Popescu' },
      currentStep: 2,
    })

    expect(updateDoc).toHaveBeenCalledWith(
      { __doc: 'onboardingDrafts/d1' },
      {
        name: 'Ion Popescu',
        currentStep: 2,
        updatedAt: { __serverTimestamp: true },
      },
    )
  })

  it('omits currentStep when not provided', async () => {
    const { result } = await renderHookWithProviders(() => useUpdateDraft())

    await result.current.mutateAsync({ id: 'd1', values: { name: 'Ion' } })

    expect(updateDoc.mock.calls[0][1]).not.toHaveProperty('currentStep')
    expect(updateDoc.mock.calls[0][1]).toHaveProperty('updatedAt')
  })

  it('invalidates the list and the detail on success', async () => {
    const { result, queryClient } = await renderHookWithProviders(() =>
      useUpdateDraft(),
    )
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')

    await result.current.mutateAsync({ id: 'd1', values: {} })

    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ['onboardingDrafts', 'list'],
    })
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ['onboardingDrafts', 'detail', 'd1'],
    })
  })

  // Bug reproduction (Sub-stage E): `draftFormDefaults` deliberately leaves
  // preferredLanguage/smoker/pets.has/vehicle.has `undefined` until the admin
  // picks — correct for validation, but `updateDoc()` THROWS SYNCHRONOUSLY on
  // any undefined field, before any network call. On the existing-tenant path,
  // autosave(4) fires with Steps 1-3 still untouched, so the write always
  // carried undefined and always failed — silently, since `useUpdateDraft` has
  // no `onError`. Diagnosed live: the Firestore doc stayed at its
  // creation-only fields (createdAt === updatedAt) no matter how many times
  // the wizard "confirmed" the existing tenant.
  it('strips undefined keys, including nested ones, before writing to Firestore', async () => {
    const { result } = await renderHookWithProviders(() => useUpdateDraft())

    await result.current.mutateAsync({
      id: 'd1',
      values: {
        name: 'Ion',
        existingUserId: 'seed-tenant',
        preferredLanguage: undefined,
        smoker: undefined,
        pets: { has: undefined, type: '' },
        vehicle: { has: undefined, make: '', plateNumber: '' },
        securityDeposit: null,
      },
      currentStep: 4,
    })

    const payload = updateDoc.mock.calls[0][1]

    function assertNoUndefinedDeep(value, path) {
      if (Array.isArray(value)) {
        value.forEach((item, i) => assertNoUndefinedDeep(item, `${path}[${i}]`))
        return
      }
      if (value !== null && typeof value === 'object') {
        for (const [key, val] of Object.entries(value)) {
          expect(val, `${path}.${key} must not be undefined`).not.toBe(
            undefined,
          )
          assertNoUndefinedDeep(val, `${path}.${key}`)
        }
      }
    }
    assertNoUndefinedDeep(payload, 'payload')

    // The KEYS themselves must be gone, not just falsy-checked — an explicit
    // `undefined` value still satisfies a loose falsy check but still crashes
    // updateDoc().
    expect(payload).not.toHaveProperty('preferredLanguage')
    expect(payload).not.toHaveProperty('smoker')
    expect(payload.pets).not.toHaveProperty('has')
    expect(payload.vehicle).not.toHaveProperty('has')

    // Untouched but MEANINGFUL values survive as-is: `null` is a chosen
    // "explicitly empty" (securityDeposit), not an unset field.
    expect(payload.pets).toEqual({ type: '' })
    expect(payload.securityDeposit).toBe(null)
    expect(payload.existingUserId).toBe('seed-tenant')
  })
})

describe('useDeleteDraft (FR-TEN-20)', () => {
  it('cleans up the Storage folder, then deletes the document', async () => {
    listAll.mockResolvedValue({
      items: [{ __item: 'a' }, { __item: 'b' }],
    })
    const { result } = await renderHookWithProviders(() => useDeleteDraft())

    await result.current.mutateAsync('d1')

    // The Storage folder for this draft was listed and each item removed.
    expect(listAll).toHaveBeenCalledWith({ __ref: 'drafts/d1' })
    expect(deleteObject).toHaveBeenCalledTimes(2)
    // The document was deleted.
    expect(deleteDoc).toHaveBeenCalledWith({ __doc: 'onboardingDrafts/d1' })
  })

  it('still deletes the document when the Storage cleanup fails (best-effort)', async () => {
    listAll.mockRejectedValue(new Error('storage/unauthorized'))
    const { result } = await renderHookWithProviders(() => useDeleteDraft())

    await result.current.mutateAsync('d1')

    // The Storage failure was swallowed — the document deletion still happened.
    expect(deleteDoc).toHaveBeenCalledWith({ __doc: 'onboardingDrafts/d1' })
  })

  it('invalidates the list on success', async () => {
    const { result, queryClient } = await renderHookWithProviders(() =>
      useDeleteDraft(),
    )
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')

    await result.current.mutateAsync('d1')

    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ['onboardingDrafts', 'list'],
    })
  })
})

describe('useUserById (Sub-stage E, FR-TEN-07 — existing-tenant banner)', () => {
  it('reads the requested user document', async () => {
    getDoc.mockResolvedValue({
      exists: () => true,
      id: 'user-1',
      data: () => ({ name: 'Maria Ionescu', email: 'maria@example.com' }),
    })

    const { result } = await renderHookWithProviders(() =>
      useUserById('user-1'),
    )

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual({
      id: 'user-1',
      name: 'Maria Ionescu',
      email: 'maria@example.com',
    })
  })

  it('signals an error if the user does not exist', async () => {
    getDoc.mockResolvedValue({ exists: () => false })

    const { result } = await renderHookWithProviders(() =>
      useUserById('missing'),
    )

    await waitFor(() => expect(result.current.isError).toBe(true))
  })

  it('reads nothing without an id', async () => {
    const { result } = await renderHookWithProviders(() =>
      useUserById(undefined),
    )

    expect(result.current.fetchStatus).toBe('idle')
    expect(getDoc).not.toHaveBeenCalled()
  })
})
