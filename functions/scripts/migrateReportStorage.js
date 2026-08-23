/**
 * migrateReportStorage — M8 stage 4 migration, Storage half (FR-REP-14,
 * CLAUDE.md §10.2, SRS §9's six-step procedure, step 3).
 *
 * `monthlyReports` is being re-keyed from `propertyId_YYYY-MM` to
 * `tenancyId_YYYY-MM`. Every invoice attachment lives at
 * `reports/{reportId}/invoices/*`, so a document re-key without a matching
 * Storage move makes every historical invoice unreadable — silently, as a
 * permission denial, because `storage.rules` resolves access via
 * `firestore.get(monthlyReports/$(reportId))` on the id taken from the
 * Storage path. This script performs ONLY the copy (CLAUDE.md §7's
 * copy-first/delete-after-commit rule): it never deletes anything and never
 * writes to Firestore. `migrateReportKeys.js` does the Firestore re-key
 * (reading the NEW paths this script produces) and owns the final,
 * verification-gated delete of both stores.
 *
 * Works against EITHER the emulator (rehearsal, M8 stage 4) or production
 * (M8 stage 20) — whichever `initializeApp({ projectId })` resolves to,
 * driven by whatever emulator env vars are already set in the calling
 * shell. This script does not set or refuse them itself: unlike
 * `seed.js` (emulator-only by design) or `bootstrapProdAdmin.js`
 * (production-only by design), this one is meant to run in both places.
 *
 * Run (from the functions/ folder):
 *   node scripts/migrateReportStorage.js               (dry run — default)
 *   node scripts/migrateReportStorage.js --apply        (actually copies)
 *
 * Idempotent: a report whose destination objects already exist is skipped
 * object-by-object — re-running after a partial or full success only copies
 * what is still missing. A report with no `tenancyId` is REPORTED, never
 * guessed at from `propertyId` — it is skipped and listed at the end.
 */
const fs = require('fs')
const path = require('path')
const { initializeApp } = require('firebase-admin/app')
const { getFirestore } = require('firebase-admin/firestore')
const { getStorage } = require('firebase-admin/storage')

const REQUIRED_PROJECT_ID = 'tenants-manager-2026'

function readProjectId() {
  const rcPath = path.join(__dirname, '..', '..', '.firebaserc')
  const rc = JSON.parse(fs.readFileSync(rcPath, 'utf8'))
  return rc.projects.default
}

/** Same guard as bootstrapProdAdmin.js/probeProdShape.js: never infer the
 * target project, check it explicitly against `.firebaserc`. */
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

/** Re-keyed at M8 (FR-REP-14): identical to web/src/features/reports/
 * hooks.js's own `buildReportId` (tenancyId, year, month) — duplicated
 * locally for the same cross-package reason as seed.js's own copy
 * (CLAUDE.md §7). */
function buildReportId(tenancyId, year, month) {
  return `${tenancyId}_${year}-${String(month).padStart(2, '0')}`
}

function invoicesPrefix(reportId) {
  return `reports/${reportId}/invoices/`
}

async function main() {
  const apply = process.argv.includes('--apply')

  const projectId = assertRealProject()
  initializeApp({ projectId })
  console.log(
    `Project: ${projectId} — mode: ${apply ? 'APPLY (writes objects)' : 'DRY RUN (no writes)'}`,
  )

  // Required lazily, AFTER initializeApp({ projectId }) above — sharedReport.js
  // runs its own `if (!getApps().length) initializeApp()` guard at require-time,
  // which must find the app already initialized with THIS explicit project id
  // (CLAUDE.md §7, same reasoning seed.js's own lazy require documents).
  const { STORAGE_BUCKET } = require('../src/sharedReport')
  const db = getFirestore()
  const bucket = getStorage().bucket(STORAGE_BUCKET)

  const snap = await db.collection('monthlyReports').get()

  const missingTenancyId = []
  const alreadyNewShape = []
  const toMigrate = []

  for (const doc of snap.docs) {
    const report = doc.data()
    if (!report.tenancyId) {
      missingTenancyId.push(doc.id)
      continue
    }
    const newId = buildReportId(report.tenancyId, report.year, report.month)
    if (newId === doc.id) {
      alreadyNewShape.push(doc.id)
      continue
    }
    toMigrate.push({ oldId: doc.id, newId })
  }

  console.log(
    `\n${snap.size} monthlyReports total — ${toMigrate.length} need a Storage copy, ` +
      `${alreadyNewShape.length} already at the new shape, ${missingTenancyId.length} missing tenancyId.`,
  )
  if (missingTenancyId.length > 0) {
    console.log('\n⚠️  Reports with NO tenancyId (skipped, never guessed):')
    for (const id of missingTenancyId) console.log(`   - ${id}`)
  }

  let objectsCopied = 0
  let objectsAlreadyPresent = 0
  let objectsFailed = 0

  for (const { oldId, newId } of toMigrate) {
    const [files] = await bucket.getFiles({ prefix: invoicesPrefix(oldId) })
    if (files.length === 0) {
      console.log(
        `\n${oldId} -> ${newId}: no invoice objects, nothing to copy.`,
      )
      continue
    }
    console.log(`\n${oldId} -> ${newId}: ${files.length} object(s)`)
    for (const file of files) {
      const basename = file.name.slice(invoicesPrefix(oldId).length)
      const destPath = `${invoicesPrefix(newId)}${basename}`
      const [exists] = await bucket.file(destPath).exists()
      if (exists) {
        console.log(`   already present: ${destPath}`)
        objectsAlreadyPresent += 1
        continue
      }
      if (!apply) {
        console.log(`   would copy: ${file.name} -> ${destPath}`)
        continue
      }
      try {
        await bucket.file(file.name).copy(bucket.file(destPath))
        console.log(`   copied: ${file.name} -> ${destPath}`)
        objectsCopied += 1
      } catch (error) {
        console.error(
          `   FAILED to copy ${file.name} -> ${destPath}: ${error.message}`,
        )
        objectsFailed += 1
      }
    }
  }

  console.log(
    `\n${apply ? 'Copied' : 'Would copy'} ${apply ? objectsCopied : ''} — ` +
      `${objectsAlreadyPresent} already present, ${objectsFailed} failed.`,
  )
  if (objectsFailed > 0) {
    console.error(
      '\n⚠️  At least one object failed to copy. Do not proceed to ' +
        'migrateReportKeys.js --delete-old until every failure above is ' +
        'resolved and this script re-run clean.',
    )
    process.exitCode = 1
  }
  if (!apply) {
    console.log(
      '\nDry run only — nothing was written. Re-run with --apply to copy.',
    )
  }
}

main().catch((error) => {
  console.error('Error:', error)
  process.exit(1)
})
