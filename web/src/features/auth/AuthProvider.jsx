import { useEffect, useState } from 'react'
import {
  onIdTokenChanged,
  signInWithEmailAndPassword,
  signOut,
} from 'firebase/auth'
import { auth } from '@/lib/firebase'
import { AuthContext } from '@/features/auth/auth-context'

/**
 * Starea de autentificare, ținută REACTIV (FR-AUTH-03, FR-AUTH-05).
 *
 * Ascultăm `onIdTokenChanged`, nu `onAuthStateChanged`. Diferența contează:
 * `onAuthStateChanged` se declanșează doar la login și logout, pe când
 * `onIdTokenChanged` se declanșează și la fiecare reîmprospătare a tokenului.
 * Asta ne dă exact comportamentul cerut: dacă adminul dezactivează contul unui
 * chiriaș logat sau îi resetează parola, Firebase revocă tokenurile; următoarea
 * reîmprospătare eșuează, SDK-ul îl deloghează, iar noi aflăm imediat și îl
 * scoatem din aplicație. Starea nu se citește niciodată o singură dată la
 * pornire — se abonează la sursă.
 *
 * NU implementăm expirare din inactivitate: FR-AUTH-05 o interzice explicit
 * („sesiune activă până la delogare manuală").
 */
export function AuthProvider({ children }) {
  const [status, setStatus] = useState('loading')
  const [role, setRole] = useState(null)
  const [user, setUser] = useState(null)

  useEffect(() => {
    const unsubscribe = onIdTokenChanged(auth, async (firebaseUser) => {
      if (!firebaseUser) {
        setUser(null)
        setRole(null)
        setStatus('unauthenticated')
        return
      }

      try {
        // Rolul vine EXCLUSIV din custom claim (FR-AUTH-01, FR-AUTH-03).
        // Nu-l citim din Firestore: colecția `users` e acces exclusiv admin
        // (NFR-SEC-02), deci un chiriaș nici n-ar putea să-și citească rolul.
        const { claims } = await firebaseUser.getIdTokenResult()

        setUser({ uid: firebaseUser.uid, email: firebaseUser.email })
        setRole(claims.admin === true ? 'admin' : 'tenant')
        setStatus('authenticated')
      } catch {
        // Tokenul nu a putut fi obținut/reîmprospătat — sesiunea nu mai e
        // validă (cont dezactivat, tokenuri revocate). Îl scoatem.
        setUser(null)
        setRole(null)
        setStatus('unauthenticated')
      }
    })

    return unsubscribe
  }, [])

  /** Aruncă mai departe eroarea Firebase; LoginPage o traduce în mesaj (§5.2). */
  async function login(email, password) {
    await signInWithEmailAndPassword(auth, email, password)
  }

  async function logout() {
    await signOut(auth)
  }

  return (
    <AuthContext.Provider value={{ status, role, user, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}
