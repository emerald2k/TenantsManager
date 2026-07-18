import { createContext } from 'react'

/** The context sits alone, in a file with no components and no hooks.
 * Reason: a file that exports both a component and something else breaks Fast
 * Refresh (the react-refresh/only-export-components warning). Splitting into
 * auth-context.js / AuthProvider.jsx / useAuth.js eliminates it from the start. */
export const AuthContext = createContext(null)
