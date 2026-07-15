import { createContext } from 'react'

/** Contextul stă singur, într-un fișier fără componente și fără hook-uri.
 * Motiv: un fișier care exportă și o componentă, și altceva, strică Fast Refresh
 * (avertismentul react-refresh/only-export-components). Separarea în
 * auth-context.js / AuthProvider.jsx / useAuth.js îl elimină din start. */
export const AuthContext = createContext(null)
