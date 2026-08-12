import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { onIdTokenChanged } from 'firebase/auth'
import { AuthProvider } from '@/features/auth/AuthProvider'
import { useAuth } from '@/features/auth/useAuth'

vi.mock('@/lib/firebase', () => ({ auth: { __fake: 'auth' } }))

vi.mock('firebase/auth', () => ({
  onIdTokenChanged: vi.fn(),
  signInWithEmailAndPassword: vi.fn(),
  signOut: vi.fn(),
}))

function createDeferred() {
  let resolve
  let reject
  const promise = new Promise((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function fakeUser(overrides = {}) {
  return {
    uid: 'uid-1',
    email: 'user@test.ro',
    getIdTokenResult: vi.fn().mockResolvedValue({ claims: {} }),
    ...overrides,
  }
}

describe('AuthProvider', () => {
  let capturedCallback
  let unsubscribeSpy

  beforeEach(() => {
    unsubscribeSpy = vi.fn()
    onIdTokenChanged.mockImplementation((_auth, callback) => {
      capturedCallback = callback
      return unsubscribeSpy
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('starts as loading, not unauthenticated, before any callback fires', () => {
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider })

    expect(result.current.status).toBe('loading')
    expect(result.current.status).not.toBe('unauthenticated')
  })

  it('sets role admin when the claim is true', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider })

    await capturedCallback(
      fakeUser({
        getIdTokenResult: vi
          .fn()
          .mockResolvedValue({ claims: { admin: true } }),
      }),
    )

    await waitFor(() => expect(result.current.status).toBe('authenticated'))
    expect(result.current.role).toBe('admin')
  })

  it('sets role tenant when the claim is absent', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider })

    await capturedCallback(
      fakeUser({
        getIdTokenResult: vi.fn().mockResolvedValue({ claims: {} }),
      }),
    )

    await waitFor(() => expect(result.current.status).toBe('authenticated'))
    expect(result.current.role).toBe('tenant')
  })

  it('goes unauthenticated when the callback receives null', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider })

    await capturedCallback(null)

    await waitFor(() => expect(result.current.status).toBe('unauthenticated'))
    expect(result.current.user).toBeNull()
    expect(result.current.role).toBeNull()
  })

  it('ejects to unauthenticated when getIdTokenResult rejects', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider })

    await capturedCallback(
      fakeUser({
        getIdTokenResult: vi.fn().mockRejectedValue(new Error('revoked')),
      }),
    )

    await waitFor(() => expect(result.current.status).toBe('unauthenticated'))
    expect(result.current.user).toBeNull()
    expect(result.current.role).toBeNull()
  })

  it('updates role on a second callback firing, without a new login call', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider })
    const user = fakeUser({
      getIdTokenResult: vi
        .fn()
        .mockResolvedValueOnce({ claims: {} })
        .mockResolvedValueOnce({ claims: { admin: true } }),
    })

    await capturedCallback(user)
    await waitFor(() => expect(result.current.role).toBe('tenant'))

    // Simulates a token refresh event on the SAME subscription - not a fresh
    // login. onAuthStateChanged would not fire here; onIdTokenChanged does
    // (AuthProvider.jsx's own header comment). This proves the consuming
    // logic reacts correctly to a second firing, not that the SDK-level
    // listener choice is itself exercised for real (see plan caveat).
    await capturedCallback(user)
    await waitFor(() => expect(result.current.role).toBe('admin'))

    const { signInWithEmailAndPassword } = await import('firebase/auth')
    expect(signInWithEmailAndPassword).not.toHaveBeenCalled()
  })

  it('unsubscribes exactly once, on unmount', () => {
    const { unmount } = renderHook(() => useAuth(), { wrapper: AuthProvider })

    expect(unsubscribeSpy).not.toHaveBeenCalled()
    unmount()
    expect(unsubscribeSpy).toHaveBeenCalledTimes(1)
  })

  it('THE RACE: a callback that resolves later does not overwrite a callback that resolved sooner', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider })
    const deferred = createDeferred()
    const staleUser = fakeUser({
      uid: 'stale-uid',
      getIdTokenResult: vi.fn(() => deferred.promise),
    })

    // Callback 1 fires and starts awaiting getIdTokenResult() - deliberately
    // left pending; nothing has resolved yet.
    const callback1Promise = capturedCallback(staleUser)

    // Callback 2 fires (logout) and completes BEFORE callback 1's await
    // resolves - this is the out-of-order part.
    await capturedCallback(null)
    await waitFor(() => expect(result.current.status).toBe('unauthenticated'))

    // NOW let callback 1 finish, resolving after callback 2 already did.
    // The empty act() flush is required here: callback 1's setState calls
    // run inside a promise continuation, not inside waitFor's act-aware
    // polling, so without an explicit flush this test reads a stale
    // result.current snapshot and passes even against the buggy provider.
    deferred.resolve({ claims: {} })
    await callback1Promise
    await act(async () => {})

    // Must still reflect callback 2's outcome, not callback 1's stale one.
    expect(result.current.status).toBe('unauthenticated')
    expect(result.current.user).toBeNull()
    expect(result.current.role).toBeNull()
  })

  it('throws when used outside a provider', () => {
    expect(() => renderHook(() => useAuth())).toThrow(
      'useAuth must be used inside an <AuthProvider>',
    )
  })
})
