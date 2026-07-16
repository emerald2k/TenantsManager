import { QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider } from '@/features/auth/AuthProvider'
import { queryClient } from '@/lib/queryClient'
import { AppRoutes } from '@/routes'

// QueryClientProvider sits ABOVE AuthProvider: on logout we want to be able to
// clear the data cache (queryClient.clear()) without the client itself depending
// on the authentication state.
function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </QueryClientProvider>
  )
}

export default App
