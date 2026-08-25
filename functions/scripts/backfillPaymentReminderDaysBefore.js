/**
 * backfillPaymentReminderDaysBefore — M8 stage 13 migration (FR-PAY-10,
 * NFR-VAL-02, CLAUDE.md §10, SRS §9 "M8 note").
 *
 * `paymentReminderDaysBefore` is a new field on `tenancies` (default 3,
 * range 1-10) that `dailyScheduler`'s pre-due reminder (FAMILY 4,
 * scheduler.js) reads to size its reminder window. Every tenancy created
 * from M8 onward gets it at assignment time; every tenancy that already
 * existed in production before this stage does not have it at all.
 * `scheduler.js` tolerates its absence (`tenancy.paymentReminderDaysBefore
 * ?? 3`), so the reminder still works without this script — the point of
 * running it is CLAUDE.md §6's own rule: a backfill makes the value
 * EXPLICIT in the data, so a future reader never has to wonder whether its
 * absence means "3" or "nobody has looked at this tenancy since M8".
 *
 * ADDITIVE AND LOW-RISK (CLAUDE.md §10): this script only ever WRITES the
 * field where it is completely absent — it never overwrites an existing
 * value, however that value got there (a later assignment, a manual edit,
 * or a previous run of this very script). Nothing is rewritten, nothing is
 * deleted, no Storage is touched. Still gated like any write to production
 * data: a verified export is taken first, as its own gate, before this
 * script runs for real (CLAUDE.md §10) — **that run happens at stage 20,
 * step 6, not now.** This stage only writes and tests the script.
 *
 * Idempotent: a tenancy that already has the field (from a previous run,
 * or because it was created after M8) is skipped entirely — the
 * fixed-point of this migration is "every tenancy has the field", and a
 * second run against that state finds nothing left to do.
 *
 * Run (from the functions/ folder):
 *   node scripts/backfillPaymentReminderDaysBefore.js          (dry run)
 *   node scripts/backfillPaymentReminderDaysBefore.js --apply   (writes)
 */
const fs = require('fs')
const path = require('path')
const { initializeApp } = require('firebase-admin/app')
const { getFirestore } = require('firebase-admin/firestore')

const REQUIRED_PROJECT_ID = 'tenants-manager-2026'

// SRS §6: "paymentReminderDaysBefore: number (default 3, range 1-10 per
// NFR-VAL-02)". The backfill writes the SAME default the schema already
// documents — never a value invented for this script.
const DEFAULT_PAYMENT_REMINDER_DAYS_BEFORE = 3

function readProjectId() {
  const rcPath = path.join(__dirname, '..', '..', '.firebaserc')
  const rc = JSON.parse(fs.readFileSync(rcPath, 'utf8'))
  return rc.projects.default
}

/** Same guard as migrateReportKeys.js/bootstrapProdAdmin.js: never infer
 * the target, check it. Does not block the emulator — the Admin SDK
 * redirects to `FIRESTORE_EMULATOR_HOST` automatically when set,
 * regardless of the configured project id, which is exactly what lets the
 * functions band exercise this script locally before it ever runs for
 * real (stage 20, step 6). */
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

/**
 * The core of the migration, separated from `main()`'s CLI concerns so the
 * functions band can call it directly against the emulator without going
 * through `process.argv`/`process.exit`. Returns the same counts `main()`
 * prints, for the test to assert on.
 *
 * @param db       a Firestore instance (real or emulator-backed)
 * @param apply    `false` (default) previews only; `true` writes
 */
async function backfillPaymentReminderDaysBefore(db, { apply = false } = {}) {
  const snap = await db.collection('tenancies').get()

  const alreadySet = []
  const toBackfill = []
  for (const doc of snap.docs) {
    if (doc.data().paymentReminderDaysBefore === undefined) {
      toBackfill.push(doc.id)
    } else {
      alreadySet.push(doc.id)
    }
  }

  if (apply) {
    for (const id of toBackfill) {
      await db.collection('tenancies').doc(id).update({
        paymentReminderDaysBefore: DEFAULT_PAYMENT_REMINDER_DAYS_BEFORE,
      })
    }
  }

  return {
    total: snap.size,
    backfilled: toBackfill,
    alreadySet: alreadySet.length,
  }
}

async function main() {
  const apply = process.argv.includes('--apply')

  const projectId = assertRealProject()
  initializeApp({ projectId })
  console.log(
    `Project: ${projectId} — mode: ${apply ? 'APPLY (writes)' : 'DRY RUN (no writes)'}`,
  )

  const db = getFirestore()
  const result = await backfillPaymentReminderDaysBefore(db, { apply })

  console.log(
    `\n${result.total} tenancies total — ${result.backfilled.length} need ` +
      `the backfill, ${result.alreadySet} already have the field.`,
  )
  if (result.backfilled.length > 0) {
    console.log(
      `${apply ? 'Backfilled' : 'Would backfill'} (-> ` +
        `${DEFAULT_PAYMENT_REMINDER_DAYS_BEFORE}):`,
    )
    for (const id of result.backfilled) console.log(`   - ${id}`)
  }
  if (!apply && result.backfilled.length > 0) {
    console.log('\nDry run only — nothing was written. Re-run with --apply.')
  }
  if (result.backfilled.length === 0) {
    console.log('\nNothing to backfill.')
  }
}

module.exports = {
  backfillPaymentReminderDaysBefore,
  DEFAULT_PAYMENT_REMINDER_DAYS_BEFORE,
}

if (require.main === module) {
  main().catch((error) => {
    console.error('Error:', error)
    process.exit(1)
  })
}
