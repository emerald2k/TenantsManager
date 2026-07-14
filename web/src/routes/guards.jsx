import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '@/features/auth/useAuth'
import { LoadingScreen } from '@/components/shared/LoadingScreen'

function roleHome(role) {
  return role === 'admin' ? '/admin' : '/app'
}

/** Rute protejate pentru un singur rol (§5.1: neautentificat → /login;
 * chiriaș pe /admin/* → /app; admin pe /app/* → /admin). */
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

/** Rute publice (doar /login) — dacă e deja autentificat, sare direct
 * pe dashboard-ul rolului lui în loc să mai vadă ecranul de login. */
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

/** Ruta rădăcină "/" — redirect inteligent în funcție de starea de auth. */
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
