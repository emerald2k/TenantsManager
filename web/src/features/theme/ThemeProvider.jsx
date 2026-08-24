import { useEffect, useState } from 'react'
import { ThemeContext } from '@/features/theme/theme-context'
import {
  applyTheme,
  persistTheme,
  resolveInitialTheme,
} from '@/features/theme/themeStorage'

/**
 * The theme state (NFR-UX-04) — light/dark across admin, tenant portal and
 * `/r/:shareToken`'s page chrome (never the report card itself, which is
 * pinned light — NFR-UX-05, `ReportSummaryView`'s own `.force-light`
 * mechanism, untouched by this provider).
 *
 * `useState(resolveInitialTheme)` — a LAZY initializer, so it runs
 * synchronously on the first render and reads the exact same
 * localStorage/`prefers-color-scheme` state `web/index.html`'s blocking
 * pre-paint script already applied to `<html>` before React ever mounted.
 * The two can never disagree: same resolution order, read at (functionally)
 * the same moment.
 *
 * `persistTheme` is called ONLY from `setTheme`/`toggleTheme` — never from
 * the mount-time `useEffect` below, which only re-applies the class
 * (idempotent, matches what the pre-paint script already set). That
 * asymmetry is deliberate: a browser that has never explicitly chosen keeps
 * tracking `prefers-color-scheme` on every future load, and only starts
 * being "sticky" once a real toggle happens.
 */
export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(resolveInitialTheme)

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  function setTheme(next) {
    setThemeState(next)
    persistTheme(next)
  }

  function toggleTheme() {
    setThemeState((current) => {
      const next = current === 'dark' ? 'light' : 'dark'
      persistTheme(next)
      return next
    })
  }

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}
