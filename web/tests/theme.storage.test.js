import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  applyTheme,
  persistTheme,
  resolveInitialTheme,
  THEME_STORAGE_KEY,
} from '@/features/theme/themeStorage'

// Pure functions, tested in isolation (CLAUDE.md §7) — NFR-UX-04, M8 stage
// 8. jsdom provides a real `localStorage` but no `matchMedia` at all
// (undefined, not a stub) — `resolveInitialTheme`'s `window.matchMedia?.(…)`
// exists specifically to survive that, exercised directly below.

beforeEach(() => {
  localStorage.clear()
  document.documentElement.classList.remove('dark')
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('resolveInitialTheme', () => {
  it('returns an explicitly stored "dark" value, ignoring matchMedia entirely', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark')
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: false })),
    )

    expect(resolveInitialTheme()).toBe('dark')
  })

  it('returns an explicitly stored "light" value, ignoring matchMedia entirely', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'light')
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: true })),
    )

    expect(resolveInitialTheme()).toBe('light')
  })

  it('falls back to prefers-color-scheme when nothing is stored — dark', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: true })),
    )

    expect(resolveInitialTheme()).toBe('dark')
  })

  it('falls back to prefers-color-scheme when nothing is stored — light', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: false })),
    )

    expect(resolveInitialTheme()).toBe('light')
  })

  it('ignores a garbage stored value and falls back to matchMedia', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'blue')
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: true })),
    )

    expect(resolveInitialTheme()).toBe('dark')
  })

  it('defaults to light when matchMedia itself is unavailable (jsdom’s real default — no stub)', () => {
    expect(resolveInitialTheme()).toBe('light')
  })
})

describe('applyTheme', () => {
  it('adds the dark class for "dark"', () => {
    applyTheme('dark')

    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it('removes the dark class for "light"', () => {
    document.documentElement.classList.add('dark')

    applyTheme('light')

    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })
})

describe('persistTheme', () => {
  it('writes the value under THEME_STORAGE_KEY', () => {
    persistTheme('dark')

    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark')
  })

  it('swallows a storage error rather than throwing (private mode, quota)', () => {
    const spy = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new Error('quota exceeded')
      })

    expect(() => persistTheme('dark')).not.toThrow()

    spy.mockRestore()
  })
})
