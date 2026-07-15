/**
 * setAdminClaim — script de setup, rulat manual (SRS §7.2, FR-AUTH-01).
 *
 * Marchează un cont existent ca administrator, setându-i custom claim-ul
 * `admin: true`. Nu creează conturi: contul de admin se creează o singură dată,
 * manual (în producție din Firebase Console; local, din Emulator UI).
 *
 * Rulare (din folderul functions/, cu emulatoarele pornite):
 *   npm run set-admin -- admin@exemplu.ro
 *
 * Împotriva emulatorului, Admin SDK-ul nu are nevoie de credențiale: e suficient
 * să existe FIREBASE_AUTH_EMULATOR_HOST, pe care îl setăm mai jos. Fără el, SDK-ul
 * ar încerca să se conecteze la proiectul REAL din cloud — exact ce nu vrem la M0.
 */
const fs = require('fs')
const path = require('path')
const { initializeApp } = require('firebase-admin/app')
const { getAuth } = require('firebase-admin/auth')

const AUTH_EMULATOR_HOST = '127.0.0.1:9099' // trebuie să corespundă cu firebase.json

function readProjectId() {
  const rcPath = path.join(__dirname, '..', '..', '.firebaserc')
  const rc = JSON.parse(fs.readFileSync(rcPath, 'utf8'))
  return rc.projects.default
}

async function main() {
  const email = process.argv[2]
  if (!email) {
    console.error(
      'Lipsește emailul.\n  Utilizare: npm run set-admin -- <email>',
    )
    process.exit(1)
  }

  // Implicit țintește emulatorul. Pentru producție (M7), rulează scriptul cu
  // USE_EMULATOR=false și cu credențiale de service account configurate.
  const useEmulator = process.env.USE_EMULATOR !== 'false'
  if (useEmulator) {
    process.env.FIREBASE_AUTH_EMULATOR_HOST = AUTH_EMULATOR_HOST
  }

  const projectId = readProjectId()
  initializeApp({ projectId })

  const target = useEmulator
    ? `emulator (${AUTH_EMULATOR_HOST})`
    : 'CLOUD (real)'
  console.log(`Proiect: ${projectId} — țintă: ${target}`)

  let user
  try {
    user = await getAuth().getUserByEmail(email)
  } catch (error) {
    if (error.code === 'auth/user-not-found') {
      console.error(
        `\nContul "${email}" nu există.\n` +
          'Creează-l întâi, apoi rulează scriptul din nou:\n' +
          '  Emulator UI → http://127.0.0.1:4000/auth → "Add user"\n',
      )
      process.exit(1)
    }
    throw error
  }

  await getAuth().setCustomUserClaims(user.uid, { admin: true })

  console.log(
    `\n✅ Custom claim "admin: true" setat pe ${email} (uid: ${user.uid})`,
  )
  console.log(
    '\nATENȚIE: claim-ul intră în tokenul utilizatorului abia la reîmprospătarea\n' +
      'acestuia. Dacă era deja logat, delogare + login din nou.',
  )
}

main().catch((error) => {
  console.error('Eroare:', error)
  process.exit(1)
})
