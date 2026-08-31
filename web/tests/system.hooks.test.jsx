import { beforeEach, describe, expect, it, vi } from 'vitest'
import { waitFor } from '@testing-library/react'
import { httpsCallable } from 'firebase/functions'
import { renderHookWithProviders } from './renderWithProviders'
import { useAdminEmailConfigured } from '@/features/system/hooks'

// Hook test with the BOUNDARY MOCKED — no emulator, same convention as
// tenants.hooks.test.jsx.

vi.mock('@/lib/firebase', () => ({
  functions: { __fake: 'functions' },
}))

vi.mock('firebase/functions', () => ({ httpsCallable: vi.fn() }))

const checkAdminEmailConfiguredMock = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  httpsCallable.mockReturnValue(checkAdminEmailConfiguredMock)
})

describe('useAdminEmailConfigured (FR-SYS-07)', () => {
  it('calls the checkAdminEmailConfigured callable and returns its configured flag', async () => {
    checkAdminEmailConfiguredMock.mockResolvedValue({
      data: { configured: true },
    })

    const { result } = await renderHookWithProviders(() =>
      useAdminEmailConfigured(),
    )

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(httpsCallable).toHaveBeenCalledWith(
      { __fake: 'functions' },
      'checkAdminEmailConfigured',
    )
    expect(result.current.data).toBe(true)
  })

  it('surfaces configured: false as-is — the caller decides what to do with it', async () => {
    checkAdminEmailConfiguredMock.mockResolvedValue({
      data: { configured: false },
    })

    const { result } = await renderHookWithProviders(() =>
      useAdminEmailConfigured(),
    )

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toBe(false)
  })
})
