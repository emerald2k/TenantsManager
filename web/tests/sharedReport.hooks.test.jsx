import { beforeEach, describe, expect, it, vi } from 'vitest'
import { waitFor } from '@testing-library/react'
import { QueryClient } from '@tanstack/react-query'
import { httpsCallable } from 'firebase/functions'
import { renderHookWithProviders } from './renderWithProviders'
import {
  useSharedReport,
  useSharedReportAttachment,
} from '@/features/sharedReport/hooks'

// The REAL hook is exercised here (M4 sub-stage 8 audit gate C1) — the only
// prior reference to this module (sharedReport.page.test.jsx) mocks the
// whole module away, so `retry: false`, the query key, and the `result.data`
// unwrap had never actually run under test. Same boundary-mock convention as
// reports.hooks.test.jsx: only `firebase/functions`/`@/lib/firebase` are
// mocked, the hook itself (useQuery/useMutation) runs for real.

vi.mock('@/lib/firebase', () => ({
  functions: { __fake: 'functions' },
}))

vi.mock('firebase/functions', () => ({ httpsCallable: vi.fn() }))

beforeEach(() => {
  vi.clearAllMocks()
})

// A QueryClient whose OWN default would retry twice on failure — used only
// by the retry:false test below. `useSharedReport`'s per-query `retry: false`
// must override this client default; if it didn't, the callable would be
// invoked 3 times (1 + 2 retries) instead of once. `retryDelay: 1` keeps a
// failing anti-vacuity run (see below) fast rather than hitting the default
// exponential backoff.
function retryingQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: 2, retryDelay: 1 } },
  })
}

describe('useSharedReport (FR-REP-07c, M4 sub-stage 8)', () => {
  it('calls getSharedReport with the shareToken and unwraps result.data', async () => {
    const callableFn = vi
      .fn()
      .mockResolvedValue({ data: { month: 7, year: 2026 } })
    httpsCallable.mockReturnValue(callableFn)

    const { result } = await renderHookWithProviders(() =>
      useSharedReport('tok-1'),
    )

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(httpsCallable).toHaveBeenCalledWith(
      { __fake: 'functions' },
      'getSharedReport',
    )
    expect(callableFn).toHaveBeenCalledWith({ shareToken: 'tok-1' })
    expect(result.current.data).toEqual({ month: 7, year: 2026 })
  })

  it('caches the result under the ["sharedReport", shareToken] query key', async () => {
    const callableFn = vi
      .fn()
      .mockResolvedValue({ data: { month: 7, year: 2026 } })
    httpsCallable.mockReturnValue(callableFn)

    const { result, queryClient } = await renderHookWithProviders(() =>
      useSharedReport('tok-1'),
    )

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(queryClient.getQueryData(['sharedReport', 'tok-1'])).toEqual({
      month: 7,
      year: 2026,
    })
  })

  it('does not call the callable at all when shareToken is falsy (enabled: Boolean(shareToken))', async () => {
    const callableFn = vi.fn()
    httpsCallable.mockReturnValue(callableFn)

    const { result } = await renderHookWithProviders(() =>
      useSharedReport(undefined),
    )

    expect(result.current.fetchStatus).toBe('idle')
    expect(callableFn).not.toHaveBeenCalled()
  })

  it('propagates a rejection (invalid/revoked/draft token) as an error, without retrying, even against a client that would otherwise retry', async () => {
    const notFound = new Error('not-found')
    const callableFn = vi.fn().mockRejectedValue(notFound)
    httpsCallable.mockReturnValue(callableFn)

    const { result } = await renderHookWithProviders(
      () => useSharedReport('bad-token'),
      { queryClient: retryingQueryClient() },
    )

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.error).toBe(notFound)
    expect(callableFn).toHaveBeenCalledTimes(1)
  })
})

describe('useSharedReportAttachment (FR-REP-07c, M4 sub-stage 8)', () => {
  it('calls getSharedReportAttachment with shareToken + reference and unwraps result.data', async () => {
    const callableFn = vi.fn().mockResolvedValue({
      data: {
        base64: 'YmFzZTY0',
        contentType: 'application/pdf',
        name: 'x.pdf',
      },
    })
    httpsCallable.mockReturnValue(callableFn)

    const { result } = await renderHookWithProviders(() =>
      useSharedReportAttachment(),
    )
    const data = await result.current.mutateAsync({
      shareToken: 'tok-1',
      reference: 'rent.0',
    })

    expect(httpsCallable).toHaveBeenCalledWith(
      { __fake: 'functions' },
      'getSharedReportAttachment',
    )
    expect(callableFn).toHaveBeenCalledWith({
      shareToken: 'tok-1',
      reference: 'rent.0',
    })
    expect(data).toEqual({
      base64: 'YmFzZTY0',
      contentType: 'application/pdf',
      name: 'x.pdf',
    })
  })
})
