import { initializeApp } from 'firebase/app'
import { getAuth, connectAuthEmulator } from 'firebase/auth'
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore'
import { getStorage, connectStorageEmulator } from 'firebase/storage'
import { getFunctions, connectFunctionsEmulator } from 'firebase/functions'

/**
 * Firebase initialization, configured exclusively through environment variables
 * (SRS §7.1: "the Firebase keys are not hardcoded").
 */

const REQUIRED_ENV_VARS = [
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_STORAGE_BUCKET',
  'VITE_FIREBASE_MESSAGING_SENDER_ID',
  'VITE_FIREBASE_APP_ID',
]

// Fail early and explicitly. Without this, a missing variable would surface much
// later, as an obscure Firebase error, hard to trace back to its cause.
const missing = REQUIRED_ENV_VARS.filter((name) => !import.meta.env[name])
if (missing.length > 0) {
  throw new Error(
    `Incomplete Firebase configuration. Missing variables: ${missing.join(', ')}.\n` +
      'Copy web/.env.example to web/.env and fill in the values.',
  )
}

const firebaseConfig = {
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

const app = initializeApp(firebaseConfig)

export const auth = getAuth(app)
export const db = getFirestore(app)
export const storage = getStorage(app)
export const functions = getFunctions(app)

/** Development M0–M6 runs entirely on the Emulator Suite (SRS §8): no cloud,
 * no card, no costs. The switch is an environment variable, so that moving to
 * production (M7) requires no code change. */
export const usingEmulators =
  import.meta.env.VITE_USE_FIREBASE_EMULATORS === 'true'

if (usingEmulators) {
  const host = '127.0.0.1'

  // The ports must match firebase.json.
  connectAuthEmulator(auth, `http://${host}:9099`, { disableWarnings: true })
  connectFirestoreEmulator(db, host, 8080)
  connectStorageEmulator(storage, host, 9199)
  connectFunctionsEmulator(functions, host, 5001)
}
