import { QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider } from '@/features/auth/AuthProvider'
import { ThemeProvider } from '@/features/theme/ThemeProvider'
import { queryClient } from '@/lib/queryClient'
import { AppRoutes } from '@/routes'

// QueryClientProvider sits ABOVE AuthProvider: on logout we want to be able to
// clear the data cache (queryClient.clear()) without the client itself depending
// on the authentication state. ThemeProvider (NFR-UX-04) depends on neither and
// sits outermost — it is pure UI state, unrelated to data or auth.
function App() {
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </QueryClientProvider>
    </ThemeProvider>
  )
}

export default App
