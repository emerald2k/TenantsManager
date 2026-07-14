/**
 * TEMPORAR — mock auth pentru sub-etapa C.
 * Simulează starea de autentificare + rol fără Firebase Auth, ca să putem
 * construi și testa rutarea și guard-urile înainte de integrarea reală.
 * Va fi ÎNLOCUIT COMPLET cu Firebase Auth la sub-etapa D (onAuthStateChanged
 * + custom claim `admin` + citire `users/{uid}` din Firestore).
 */
import { createContext, useContext, useEffect, useState } from 'react'

const ROLE_STORAGE_KEY = 'tm_mock_role'

/** Întârziere artificială la pornire, ca să simuleze verificarea reală
 * de sesiune Firebase Auth (onAuthStateChanged) și să putem vedea/testa
 * starea de loading a guard-urilor. */
const MOCK_AUTH_CHECK_DELAY_MS = 600

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [status, setStatus] = useState('loading')
  const [role, setRole] = useState(null)

  useEffect(() => {
    const timer = setTimeout(() => {
      const storedRole = localStorage.getItem(ROLE_STORAGE_KEY)
      if (storedRole === 'admin' || storedRole === 'tenant') {
        // TODO (sub-etapa D): odată cu Firebase Auth real, aici se va verifica
        // și statusul contului (dezactivat/arhivat/inactiv-readonly) din
        // users/{uid} și se va redirecționa sau afișa mesajul corespunzător
        // în loc să se seteze direct 'authenticated'.
        setRole(storedRole)
        setStatus('authenticated')
      } else {
        setStatus('unauthenticated')
      }
    }, MOCK_AUTH_CHECK_DELAY_MS)

    return () => clearTimeout(timer)
  }, [])

  function login(nextRole) {
    localStorage.setItem(ROLE_STORAGE_KEY, nextRole)
    setRole(nextRole)
    setStatus('authenticated')
  }

  function logout() {
    localStorage.removeItem(ROLE_STORAGE_KEY)
    setRole(null)
    setStatus('unauthenticated')
  }

  return (
    <AuthContext.Provider value={{ status, role, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return ctx
}
