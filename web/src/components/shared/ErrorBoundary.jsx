import { Component } from 'react'
import { useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'

/**
 * SRS §5.5: "without one, an uncaught render error yields a blank white
 * screen with no message and no way back — which was the behaviour before
 * M8." A distinct concern from every per-query loading/error state already
 * in the app: those cover a FAILED FETCH (data never arrived, the tree
 * still renders); this covers a FAILED RENDER (the tree itself threw).
 * React only recognizes an error boundary through the class-component
 * lifecycle (`getDerivedStateFromError`/`componentDidCatch`) — there is no
 * hook equivalent, so this is the one class component in the app.
 */
class ErrorBoundaryImpl extends Component {
  state = { hasError: false }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error, info) {
    console.error(error, info)
  }

  render() {
    if (this.state.hasError) return <ErrorFallback />
    return this.props.children
  }
}

function ErrorFallback() {
  const { t } = useTranslation()

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-xl font-semibold text-foreground">
        {t('errorBoundary.title')}
      </h1>
      <p className="max-w-md text-sm text-muted-foreground">
        {t('errorBoundary.message')}
      </p>
      {/* A plain <a>, not <Link>: a caught render error means React's own
          tree is in an unknown state, so recovery goes through the
          browser's own full navigation rather than depending on that same
          tree to still route correctly. */}
      <Button asChild>
        <a href="/">{t('errorBoundary.backHome')}</a>
      </Button>
    </div>
  )
}

/**
 * Wraps the routed application — inside `<BrowserRouter>` (needs
 * `useLocation`), outside `<Routes>` (a route-level error must still be
 * caught by something above the routes, not beside them). Keyed on
 * `location.pathname` so the boundary REMOUNTS, and therefore clears a
 * latched `hasError`, the moment the route changes for any reason — belt
 * and suspenders alongside the fallback's own full-navigation link: a
 * `<Link>` elsewhere in the app that happens to change the route while the
 * fallback is showing would otherwise leave the error rendered forever,
 * since React does not remount a class component just because its
 * children's identity changes.
 */
export function ErrorBoundary({ children }) {
  const location = useLocation()
  return (
    <ErrorBoundaryImpl key={location.pathname}>{children}</ErrorBoundaryImpl>
  )
}
