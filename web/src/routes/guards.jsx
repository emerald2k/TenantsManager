import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '@/features/auth/useAuth'
import { LoadingScreen } from '@/components/shared/LoadingScreen'

function roleHome(role) {
  return role === 'admin' ? '/admin' : '/app'
}

/** Routes protected for a single role (§5.1: unauthenticated → /login;
 * tenant on /admin/* → /app; admin on /app/* → /admin). */
export function ProtectedRoute({ allowedRole }) {
  const { status, role } = useAuth()

  if (status === 'loading') {
    return <LoadingScreen />
  }
  if (status === 'unauthenticated') {
    return <Navigate to="/login" replace />
  }
  if (role !== allowedRole) {
    return <Navigate to={roleHome(role)} replace />
  }
  return <Outlet />
}

/** Public routes (only /login) — if already authenticated, jump straight to
 * their role's dashboard instead of showing the login screen again. */
export function GuestRoute() {
  const { status, role } = useAuth()

  if (status === 'loading') {
    return <LoadingScreen />
  }
  if (status === 'authenticated') {
    return <Navigate to={roleHome(role)} replace />
  }
  return <Outlet />
}

/** The root route "/" — smart redirect based on the auth state. */
export function RootRedirect() {
  const { status, role } = useAuth()

  if (status === 'loading') {
    return <LoadingScreen />
  }
  if (status === 'unauthenticated') {
    return <Navigate to="/login" replace />
  }
  return <Navigate to={roleHome(role)} replace />
}
