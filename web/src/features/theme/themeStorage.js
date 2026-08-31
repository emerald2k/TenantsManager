/**
 * The storage/detection half of the theme mechanism (NFR-UX-04) — kept
 * separate from the React provider so both `ThemeProvider.jsx` and (in
 * spirit, since it cannot be imported there) `web/index.html`'s blocking
 * pre-paint script describe the SAME resolution order:
 *
 *   1. An explicit choice already persisted in this browser (`localStorage`).
 *   2. Otherwise, `prefers-color-scheme` — read ONCE, at resolution time,
 *      never subscribed to afterward. SRS §5.5 says "initial value from
 *      prefers-color-scheme", not "always follows the OS" — once the admin
 *      (or tenant) explicitly toggles, that choice persists and no longer
 *      tracks a later OS-level change.
 *
 * `index.html`'s inline script duplicates this logic in plain JS, because a
 * module import there would be deferred, defeating the pre-paint script's
 * entire purpose (CLAUDE.md §7 cross-boundary-duplication precedent). Keep
 * both in sync by hand — the storage KEY especially, since a mismatch would
 * make the provider and the pre-paint script disagree about which value
 * means what.
 */

export const THEME_STORAGE_KEY = 'theme'

/** The theme to render with on this load — read once, synchronously, so it
 * can seed `useState`'s lazy initializer and match whatever `index.html`'s
 * script already applied before React mounted (no flash, no mismatch). */
export function resolveInitialTheme() {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY)
    if (stored === 'light' || stored === 'dark') return stored
  } catch {
    // localStorage blocked (private mode) — fall through to the OS
    // preference below rather than throwing during render.
  }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light'
}

/** Applies `theme` to `<html>` — the single point every visible surface
 * (admin, tenant portal, `/r/:shareToken` chrome) actually reads from,
 * via Tailwind's `@custom-variant dark (&:is(.dark *))`. */
export function applyTheme(theme) {
  document.documentElement.classList.toggle('dark', theme === 'dark')
}

/** Persists an EXPLICIT choice — called only when the admin/tenant actually
 * toggles, never on the initial resolve, so a browser that has never chosen
 * keeps tracking `prefers-color-scheme` on its NEXT load (this function is
 * simply never called for that browser until it does choose). */
export function persistTheme(theme) {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme)
  } catch {
    // Storage blocked — the choice just does not survive a reload. Not
    // worth surfacing to the user; the toggle still works for this session.
  }
}
