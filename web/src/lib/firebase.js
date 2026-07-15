import { initializeApp } from 'firebase/app'
import { getAuth, connectAuthEmulator } from 'firebase/auth'
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore'
import { getStorage, connectStorageEmulator } from 'firebase/storage'
import { getFunctions, connectFunctionsEmulator } from 'firebase/functions'

/**
 * Inițializarea Firebase, configurată exclusiv prin variabile de mediu
 * (SRS §7.1: „cheile Firebase nu se hardcodează").
 */

const REQUIRED_ENV_VARS = [
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_STORAGE_BUCKET',
  'VITE_FIREBASE_MESSAGING_SENDER_ID',
  'VITE_FIREBASE_APP_ID',
]

// Eșuăm devreme și explicit. Fără asta, o variabilă lipsă s-ar manifesta mult
// mai târziu, ca o eroare obscură de la Firebase, greu de legat de cauză.
const missing = REQUIRED_ENV_VARS.filter((name) => !import.meta.env[name])
if (missing.length > 0) {
  throw new Error(
    `Configurare Firebase incompletă. Variabile lipsă: ${missing.join(', ')}.\n` +
      'Copiază web/.env.example în web/.env și completează valorile.',
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

/** Dezvoltarea M0–M6 rulează integral pe Emulator Suite (SRS §8): fără cloud,
 * fără card, fără costuri. Comutatorul e o variabilă de mediu, ca trecerea în
 * producție (M7) să nu ceară nicio modificare de cod. */
export const usingEmulators =
  import.meta.env.VITE_USE_FIREBASE_EMULATORS === 'true'

if (usingEmulators) {
  const host = '127.0.0.1'

  // Porturile trebuie să corespundă cu firebase.json.
  connectAuthEmulator(auth, `http://${host}:9099`, { disableWarnings: true })
  connectFirestoreEmulator(db, host, 8080)
  connectStorageEmulator(storage, host, 9199)
  connectFunctionsEmulator(functions, host, 5001)
}
