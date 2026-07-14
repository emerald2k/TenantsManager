import { AuthProvider } from '@/features/auth/MockAuthContext'
import { AppRoutes } from '@/routes'

function App() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  )
}

export default App
