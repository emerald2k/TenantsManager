/**
 * bootstrapProdAdmin — ONE-TIME production setup script, run manually
 * (SRS §2.8, §7.5's alpha-deploy stage). Creates the single admin Auth
 * account in the REAL cloud project, generates its password, and sets the
 * `admin: true` custom claim — the one every Firestore/Storage rule in this
 * codebase checks via `request.auth.token.admin` (NFR-SEC-09).
 *
 * Deliberately a SEPARATE script from `setAdminClaim.js` (emulator-only,
 * claims-only — never creates accounts) and `seed.js` (emulator-only, demo
 * data). Production starts EMPTY: no demo data, just this one account;
 * properties and tenants are entered afterward through the UI (FR-DASH-03's
 * empty state).
 *
 * Run (from the functions/ folder):
 *   npm run bootstrap-prod-admin -- admin@example.com
 *
 * Authentication against the REAL cloud project is Application Default
 * Credentials (ADC) — this script never hardcodes credentials and never
 * ships a service-account file. Before running it, the admin must have ONE
 * of, already configured in this shell:
 *   - `gcloud auth application-default login` (interactive, one-time), or
 *   - `GOOGLE_APPLICATION_CREDENTIALS` pointing at a service-account key file.
 * Neither is set up BY this script — it is a one-time environment
 * prerequisite, exactly like any other Admin SDK cloud script.
 *
 * The generated password is shown ONCE, in this terminal's output. It is
 * never written to a file, a log, or a Firestore document, and it cannot be
 * recovered afterward — only reset, from the Firebase Console (SRS §2.8).
 */
const fs = require('fs')
const path = require('path')
const { initializeApp } = require('firebase-admin/app')
const { getAuth } = require('firebase-admin/auth')

const REQUIRED_PROJECT_ID = 'tenants-manager-2026'

function readProjectId() {
  const rcPath = path.join(__dirname, '..', '..', '.firebaserc')
  const rc = JSON.parse(fs.readFileSync(rcPath, 'utf8'))
  return rc.projects.default
}

/** Refuses to run against anything but the real production project — same
 * "never infer, always check explicitly" spirit as CLAUDE.md §7's Storage
 * bucket lesson, applied here to project identity instead. */
function assertRealProject() {
  const projectId = readProjectId()
  if (projectId !== REQUIRED_PROJECT_ID) {
    console.error(
      `Refusing to run: .firebaserc's project is "${projectId}", expected ` +
        `"${REQUIRED_PROJECT_ID}".`,
    )
    process.exit(1)
  }
  return projectId
}

/** Refuses to run if EITHER emulator env var is set. This script never sets
 * them itself (unlike seed.js, which deliberately does, for the emulator) —
 * if one is present here, it leaked in from the calling shell (e.g. a
 * previous `npm run seed` session), and continuing would silently write to
 * the emulator while claiming to be a production bootstrap. The same
 * "works in one context, means something else in the other" bug class
 * CLAUDE.md §7 already documents twice (the ambient Storage bucket, the
 * nested metadata token) — this guard exists so it does not happen a third
 * time, here, in reverse (a prod script silently landing on the emulator). */
function assertNoEmulatorHost() {
  const leaked = [
    'FIRESTORE_EMULATOR_HOST',
    'FIREBASE_AUTH_EMULATOR_HOST',
  ].filter((name) => process.env[name])
  if (leaked.length > 0) {
    console.error(
      'Refusing to run: emulator environment variable(s) set — ' +
        `${leaked.join(', ')}.\n` +
        'This script targets PRODUCTION only. Unset them (likely left over ' +
        'from a previous "npm run seed" or emulator session in this same ' +
        'shell) and try again.',
    )
    process.exit(1)
  }
}

async function main() {
  // Guards first, in order of cheapest/most-independent to most-dependent —
  // none of them touch Firebase; all of them must pass before anything below
  // does.
  assertNoEmulatorHost()

  const email = process.argv[2]
  if (!email) {
    console.error(
      'Missing email.\n  Usage: npm run bootstrap-prod-admin -- <email>',
    )
    process.exit(1)
  }

  const projectId = assertRealProject()

  initializeApp({ projectId })
  console.log(`Project: ${projectId} — target: CLOUD (real, production)`)

  const auth = getAuth()

  let existing = null
  try {
    existing = await auth.getUserByEmail(email)
  } catch (error) {
    if (error.code !== 'auth/user-not-found') throw error
  }

  if (existing) {
    const alreadyAdmin = existing.customClaims?.admin === true
    if (alreadyAdmin) {
      console.error(
        `Refusing to run: "${email}" already exists (uid: ${existing.uid}) ` +
          'and already carries the admin:true claim. This script never ' +
          'regenerates the password of a live account — nothing to do.',
      )
      process.exit(1)
    }
    // Recovery case: the account exists but has no admin claim yet. Refusing
    // (rather than prompting interactively, or silently changing its
    // password) is the safer choice — this script only ever CREATES a
    // brand-new account; it never touches the credentials of one that
    // already exists. Granting the claim to an existing account is exactly
    // what setAdminClaim.js already does, deliberately kept separate.
    console.error(
      `Refusing to run: "${email}" already exists (uid: ${existing.uid}) ` +
        'but has NO admin claim. This script only creates a brand-new ' +
        'account; it never changes an existing one. To grant the claim to ' +
        'this existing account instead, run:\n' +
        `  npm run set-admin -- ${email}\n`,
    )
    process.exit(1)
  }

  // Required lazily, AFTER initializeApp({ projectId }) above — kyc.js runs
  // its own `if (!getApps().length) initializeApp()` guard at require-time,
  // which must find the app already initialized with THIS explicit project
  // id, never an ambient default (CLAUDE.md §7, same reasoning seed.js's own
  // lazy require of sharedReport.js documents). Reused, not duplicated: the
  // same 12-char, unambiguous-charset generator finalizeKyc already uses for
  // real tenant credentials.
  const { generatePassword } = require('../src/kyc')
  const password = generatePassword()

  const user = await auth.createUser({ email, password, emailVerified: true })
  await auth.setCustomUserClaims(user.uid, { admin: true })

  console.log(`\n✅ Admin account created: ${email} (uid: ${user.uid})`)
  console.log('✅ Custom claim "admin: true" set.')
  console.log(
    '\n⚠️  PASSWORD (shown ONCE — never logged or stored anywhere else):\n' +
      `   ${password}\n\n` +
      'Write it down NOW. It cannot be recovered afterward — only reset, ' +
      'from the Firebase Console (SRS §2.8).',
  )
}

main().catch((error) => {
  console.error('Error:', error)
  process.exit(1)
})
