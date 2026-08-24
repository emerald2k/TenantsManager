import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithProviders } from './renderWithProviders'
import { ErrorBoundary } from '@/components/shared/ErrorBoundary'

/**
 * SRS §5.5's ErrorBoundary — a FAILED RENDER (the tree itself throws), a
 * distinct concern from every per-query loading/error state already in the
 * app (a FAILED FETCH, where the tree still renders fine).
 */

function Bomb() {
  throw new Error('boom')
}

function Fine() {
  return <p>tot bine</p>
}

describe('ErrorBoundary (SRS §5.5, M8 stage 10)', () => {
  it('renders children normally when nothing throws', async () => {
    await renderWithProviders(
      <ErrorBoundary>
        <Fine />
      </ErrorBoundary>,
    )

    expect(screen.getByText('tot bine')).toBeVisible()
  })

  it('catches a render error and shows the fallback instead of a blank screen', async () => {
    // React logs the caught error to the console by default; silence it so
    // the test output stays about the assertion, not expected noise.
    vi.spyOn(console, 'error').mockImplementation(() => {})

    await renderWithProviders(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>,
    )

    expect(
      screen.getByRole('heading', { name: 'Ceva nu a funcționat' }),
    ).toBeVisible()
    expect(
      screen.getByRole('link', { name: 'Înapoi la pagina principală' }),
    ).toHaveAttribute('href', '/')
  })

  // The `key={location.pathname}` remount (so a route change while the
  // fallback shows clears the latched error) is deliberately NOT covered
  // here beyond the component's own comment: it's a standard React
  // guarantee (changing `key` remounts), not app-specific logic, and the
  // only way to exercise it meaningfully needs two renders sharing one
  // container mid-navigation — the double-render-in-one-`it()` shape
  // CLAUDE.md already flags as its own trap (a stale i18n singleton),
  // reproduced here with the router instead. The full-navigation `<a>`
  // link above is the primary, always-available recovery path and IS
  // covered.
})
