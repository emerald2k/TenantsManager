import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from '@testing-library/react'
import { renderHookWithProviders } from './renderWithProviders'
import { ThemeProvider } from '@/features/theme/ThemeProvider'
import { useTheme } from '@/features/theme/useTheme'
import { THEME_STORAGE_KEY } from '@/features/theme/themeStorage'

// NFR-UX-04, M8 stage 8. `renderHookWithProviders`'s own wrapper (i18n +
// router + query client) does not include ThemeProvider, so it is supplied
// per-test here via the `wrapper` option — the same pattern any test needing
// a provider NOT in the shared tree already uses.

beforeEach(() => {
  localStorage.clear()
  document.documentElement.classList.remove('dark')
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function withTheme(children) {
  return <ThemeProvider>{children}</ThemeProvider>
}

describe('ThemeProvider — initial resolution', () => {
  it('starts on the stored theme and applies it to <html> on mount', async () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark')

    const { result } = await renderHookWithProviders(() => useTheme(), {
      wrapper: ({ children }) => withTheme(children),
    })

    expect(result.current.theme).toBe('dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it('does NOT persist anything on mount — only an explicit toggle/setTheme call does', async () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: true })),
    )

    await renderHookWithProviders(() => useTheme(), {
      wrapper: ({ children }) => withTheme(children),
    })

    // The OS-derived value was applied to <html>, but never written back —
    // a future load with a changed OS preference must still track it.
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull()
  })
})

describe('ThemeProvider — toggleTheme', () => {
  it('flips light -> dark, applies the class, and persists the explicit choice', async () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'light')

    const { result } = await renderHookWithProviders(() => useTheme(), {
      wrapper: ({ children }) => withTheme(children),
    })

    act(() => result.current.toggleTheme())

    expect(result.current.theme).toBe('dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark')
  })

  it('flips dark -> light', async () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark')

    const { result } = await renderHookWithProviders(() => useTheme(), {
      wrapper: ({ children }) => withTheme(children),
    })

    act(() => result.current.toggleTheme())

    expect(result.current.theme).toBe('light')
    expect(document.documentElement.classList.contains('dark')).toBe(false)
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light')
  })
})

describe('ThemeProvider — setTheme', () => {
  it('sets an explicit value directly and persists it', async () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'light')

    const { result } = await renderHookWithProviders(() => useTheme(), {
      wrapper: ({ children }) => withTheme(children),
    })

    act(() => result.current.setTheme('dark'))

    expect(result.current.theme).toBe('dark')
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark')
  })
})

describe('useTheme — outside a provider', () => {
  it('throws a clear error', async () => {
    // renderHook with NO ThemeProvider wrapper at all.
    await expect(async () => {
      await renderHookWithProviders(() => useTheme())
    }).rejects.toThrow('useTheme must be used inside a <ThemeProvider>')
  })
})
