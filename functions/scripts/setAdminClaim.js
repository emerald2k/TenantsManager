/**
 * setAdminClaim — setup script, run manually (SRS §7.2, FR-AUTH-01).
 *
 * Marks an existing account as administrator by setting its `admin: true`
 * custom claim. It does not create accounts: the admin account is created once,
 * manually (in production from the Firebase Console; locally, from the Emulator UI).
 *
 * Run (from the functions/ folder, with the emulators started):
 *   npm run set-admin -- admin@example.com
 *
 * Against the emulator, the Admin SDK needs no credentials: it is enough that
 * FIREBASE_AUTH_EMULATOR_HOST exists, which we set below. Without it, the SDK
 * would try to connect to the REAL cloud project — exactly what we do not want at M0.
 */
const fs = require('fs')
const path = require('path')
const { initializeApp } = require('firebase-admin/app')
const { getAuth } = require('firebase-admin/auth')

const AUTH_EMULATOR_HOST = '127.0.0.1:9099' // must match firebase.json

function readProjectId() {
  const rcPath = path.join(__dirname, '..', '..', '.firebaserc')
  const rc = JSON.parse(fs.readFileSync(rcPath, 'utf8'))
  return rc.projects.default
}

async function main() {
  const email = process.argv[2]
  if (!email) {
    console.error('Missing email.\n  Usage: npm run set-admin -- <email>')
    process.exit(1)
  }

  // Targets the emulator by default. For production (M7), run the script with
  // USE_EMULATOR=false and with service account credentials configured.
  const useEmulator = process.env.USE_EMULATOR !== 'false'
  if (useEmulator) {
    process.env.FIREBASE_AUTH_EMULATOR_HOST = AUTH_EMULATOR_HOST
  }

  const projectId = readProjectId()
  initializeApp({ projectId })

  const target = useEmulator
    ? `emulator (${AUTH_EMULATOR_HOST})`
    : 'CLOUD (real)'
  console.log(`Project: ${projectId} — target: ${target}`)

  let user
  try {
    user = await getAuth().getUserByEmail(email)
  } catch (error) {
    if (error.code === 'auth/user-not-found') {
      console.error(
        `\nThe account "${email}" does not exist.\n` +
          'Create it first, then run the script again:\n' +
          '  Emulator UI → http://127.0.0.1:4000/auth → "Add user"\n',
      )
      process.exit(1)
    }
    throw error
  }

  await getAuth().setCustomUserClaims(user.uid, { admin: true })

  console.log(
    `\n✅ Custom claim "admin: true" set on ${email} (uid: ${user.uid})`,
  )
  console.log(
    '\nNOTE: the claim only enters the user token when the token is refreshed.\n' +
      'If they were already logged in, log out and log in again.',
  )
}

main().catch((error) => {
  console.error('Error:', error)
  process.exit(1)
})
