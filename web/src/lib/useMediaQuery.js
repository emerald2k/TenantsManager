import { useEffect, useState } from 'react'

/**
 * Subscribe to a CSS media query from React (M8 stage 15b, NFR-UX-03).
 *
 * Two things in the phone shell are structural, not cosmetic, and cannot be a
 * pure CSS max-width `hidden` swap: the admin chrome switches between a side
 * rail and a bottom tab bar + "More" sheet below 700 px, and the current-month
 * table becomes cards below ~1100 px (the owner's 2026-08-30 exception). A CSS
 * swap would leave BOTH variants in the accessible tree — every existing test
 * that mounts `AdminLayout` or the dashboard would then match both, and
 * `toBeVisible()` cannot tell them apart because jsdom does not evaluate media
 * queries for layout. A hook keeps exactly one variant in the DOM and lets a
 * test drive either branch by stubbing `matchMedia`.
 *
 * jsdom ships NO `matchMedia` (undefined, not a stub — see
 * `theme.storage.test.js`, which depends on that), so every access is guarded.
 * With no `matchMedia` the hook reports `false`: the fast band then always
 * renders the desktop rail and the seven-column table, which is what the
 * current suite already asserts. A test that wants the phone branch stubs
 * `matchMedia` itself (the pattern `theme.provider.test.jsx` established).
 *
 * The initial value is resolved synchronously in the `useState` initialiser,
 * not in an effect — an effect would paint one frame of the wrong shell first.
 *
 * @param {string} query e.g. `'(max-width: 699px)'`
 * @returns {boolean} whether the query currently matches
 */
export function useMediaQuery(query) {
  const [matches, setMatches] = useState(() => getMatches(query))

  useEffect(() => {
    if (
      typeof window === 'undefined' ||
      typeof window.matchMedia !== 'function'
    ) {
      return undefined
    }
    const mql = window.matchMedia(query)
    const onChange = (event) => setMatches(event.matches)

    // Re-sync in case the query changed or the viewport moved between the
    // initial render and this effect.
    setMatches(mql.matches)

    // `addEventListener` on a MediaQueryList is the modern API; Safari < 14
    // and some jsdom stubs only have the deprecated `addListener`.
    if (typeof mql.addEventListener === 'function') {
      mql.addEventListener('change', onChange)
    } else if (typeof mql.addListener === 'function') {
      mql.addListener(onChange)
    }

    return () => {
      if (typeof mql.removeEventListener === 'function') {
        mql.removeEventListener('change', onChange)
      } else if (typeof mql.removeListener === 'function') {
        mql.removeListener(onChange)
      }
    }
  }, [query])

  return matches
}

function getMatches(query) {
  if (
    typeof window === 'undefined' ||
    typeof window.matchMedia !== 'function'
  ) {
    return false
  }
  return window.matchMedia(query).matches
}
