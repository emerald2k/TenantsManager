import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useMediaQuery } from '@/lib/useMediaQuery'

// M8 stage 15b. The phone shell (< 700 px) and the current-month card swap
// (< ~1100 px) both hang off this hook, so both branches must be drivable
// from a test. jsdom ships no `matchMedia` — the hook must survive that AND
// react to `change` events when a test provides one.

afterEach(() => {
  vi.unstubAllGlobals()
})

/** A minimal MediaQueryList stub with a working `change` listener. */
function stubMatchMedia(initialMatches) {
  let matches = initialMatches
  const listeners = new Set()
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({
      get matches() {
        return matches
      },
      addEventListener: (_type, cb) => listeners.add(cb),
      removeEventListener: (_type, cb) => listeners.delete(cb),
    })),
  )
  return {
    emit(next) {
      matches = next
      listeners.forEach((cb) => cb({ matches: next }))
    },
  }
}

describe('useMediaQuery', () => {
  it('reports false and never throws when matchMedia is absent (jsdom default)', () => {
    expect(typeof window.matchMedia).toBe('undefined')
    const { result } = renderHook(() => useMediaQuery('(max-width: 699px)'))
    expect(result.current).toBe(false)
  })

  it('reads the initial match synchronously on first render', () => {
    stubMatchMedia(true)
    const { result } = renderHook(() => useMediaQuery('(max-width: 699px)'))
    expect(result.current).toBe(true)
  })

  it('updates when the media query fires a change event', () => {
    const mql = stubMatchMedia(false)
    const { result } = renderHook(() => useMediaQuery('(max-width: 1100px)'))
    expect(result.current).toBe(false)

    act(() => mql.emit(true))
    expect(result.current).toBe(true)

    act(() => mql.emit(false))
    expect(result.current).toBe(false)
  })
})
