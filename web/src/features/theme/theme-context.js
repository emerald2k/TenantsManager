import { createContext } from 'react'

/** The context sits alone, in a file with no components and no hooks — same
 * split as auth-context.js/AuthProvider.jsx/useAuth.js, for the same reason
 * (a file exporting both a component and something else breaks Fast
 * Refresh). */
export const ThemeContext = createContext(null)
