import { useEffect, useState } from 'react'
import {
  onIdTokenChanged,
  signInWithEmailAndPassword,
  signOut,
} from 'firebase/auth'
import { auth } from '@/lib/firebase'
import { AuthContext } from '@/features/auth/auth-context'

/**
 * The authentication state, held REACTIVELY (FR-AUTH-03, FR-AUTH-05).
 *
 * We listen to `onIdTokenChanged`, not `onAuthStateChanged`. The difference
 * matters: `onAuthStateChanged` fires only on login and logout, whereas
 * `onIdTokenChanged` also fires on every token refresh. That gives us exactly
 * the required behavior: if the admin disables a logged-in tenant's account or
 * resets their password, Firebase revokes the tokens; the next refresh fails,
 * the SDK logs them out, and we find out immediately and eject them from the
 * application. The state is never read once at startup — it subscribes to the
 * source.
 *
 * We do NOT implement inactivity expiry: FR-AUTH-05 explicitly forbids it
 * ("session active until manual logout").
 */
export function AuthProvider({ children }) {
  const [status, setStatus] = useState('loading')
  const [role, setRole] = useState(null)
  const [user, setUser] = useState(null)

  useEffect(() => {
    // Each callback invocation is stamped with an id; before writing state it
    // checks whether a LATER invocation has already taken over. Without this,
    // two live invocations can resolve out of order (e.g. a logout callback
    // completing while an earlier callback's getIdTokenResult() is still in
    // flight) and the earlier one's setState calls overwrite the later,
    // correct state with stale data. The cleanup sets latestCallId to a value
    // no real callId (always >= 1) can match, so a token result that resolves
    // after unmount also writes nothing.
    let latestCallId = 0

    const unsubscribe = onIdTokenChanged(auth, async (firebaseUser) => {
      const callId = ++latestCallId
      const isStale = () => callId !== latestCallId

      if (!firebaseUser) {
        if (isStale()) return
        setUser(null)
        setRole(null)
        setStatus('unauthenticated')
        return
      }

      try {
        // The role comes EXCLUSIVELY from the custom claim (FR-AUTH-01, FR-AUTH-03).
        // We do not read it from Firestore: the `users` collection is admin-only
        // (NFR-SEC-02), so a tenant could not even read their own role.
        const { claims } = await firebaseUser.getIdTokenResult()
        if (isStale()) return

        setUser({ uid: firebaseUser.uid, email: firebaseUser.email })
        setRole(claims.admin === true ? 'admin' : 'tenant')
        setStatus('authenticated')
      } catch {
        // The token could not be obtained/refreshed — the session is no longer
        // valid (disabled account, revoked tokens). We eject them.
        if (isStale()) return
        setUser(null)
        setRole(null)
        setStatus('unauthenticated')
      }
    })

    return () => {
      latestCallId = -1
      unsubscribe()
    }
  }, [])

  /** Rethrows the Firebase error; LoginPage maps it to a message (§5.2). */
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
