/**
 * migrateReportKeys — M8 stage 4 migration, Firestore half + the final,
 * verification-gated delete of BOTH stores (FR-REP-14, CLAUDE.md §10.2,
 * SRS §9's six-step procedure, steps 4-6).
 *
 * Run `migrateReportStorage.js --apply` FIRST — this script reads the NEW
 * Storage paths it produced and verifies every one actually exists before
 * it will ever consider deleting anything. Running this script without
 * having copied Storage first will fail its own verification step, loudly,
 * every time — that is the guard working, not a bug.
 *
 * Steps, in order:
 *   1. CREATE — for each report needing migration, build a new document at
 *      `tenancyId_YYYY-MM`, with every `attachments[].path` in every cost
 *      line (rent, maintenance, each serviceCosts[], each otherExpenses[])
 *      rewritten from the old prefix to the new one. The OLD document is
 *      left untouched — both exist simultaneously after this step.
 *   2. VERIFY — re-reads every new document and confirms: it exists; its
 *      identifying fields match the source; no trace of the OLD id remains
 *      ANYWHERE in it (the generic form of "no attachment container was
 *      missed" — see the sanity-check comment below); and every attachment
 *      path it references actually resolves to a real Storage object.
 *   3. DELETE (only with --delete-old, and only for reports whose own
 *      verification passed) — deletes the OLD Firestore document and the
 *      OLD Storage prefix. A verification failure on ANY report cancels
 *      deletion for EVERY report in this run — CLAUDE.md §10.2: if the
 *      copy cannot be confirmed, the migration ends without the delete
 *      step. Orphaned old data costs cents; a tenant's lost invoice is
 *      permanent, so this errs toward leaving more around, never less.
 *
 * Run (from the functions/ folder):
 *   node scripts/migrateReportKeys.js                       (dry run)
 *   node scripts/migrateReportKeys.js --apply                (create + verify)
 *   node scripts/migrateReportKeys.js --apply --delete-old    (+ delete, gated)
 *
 * Idempotent: a report whose new id already exists is skipped entirely — a
 * second run after a full success (create+delete) finds nothing left to do
 * for it, because the fixed-point of this migration IS "only the new
 * document exists".
 */
const fs = require('fs')
const path = require('path')
const { initializeApp } = require('firebase-admin/app')
const { getFirestore, FieldValue } = require('firebase-admin/firestore')
const { getStorage } = require('firebase-admin/storage')

const REQUIRED_PROJECT_ID = 'tenants-manager-2026'

const LINE_FIELDS = ['rent', 'maintenance']
const LINE_ARRAY_FIELDS = ['serviceCosts', 'otherExpenses']

function readProjectId() {
  const rcPath = path.join(__dirname, '..', '..', '.firebaserc')
  const rc = JSON.parse(fs.readFileSync(rcPath, 'utf8'))
  return rc.projects.default
}

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

function buildReportId(tenancyId, year, month) {
  return `${tenancyId}_${year}-${String(month).padStart(2, '0')}`
}

function invoicesPrefix(reportId) {
  return `reports/${reportId}/invoices/`
}

/** Every costLine-shaped container on a report, mirroring web/src/features/
 * reports/attachments.js's `costLinesOf` EXACTLY — this list is the single
 * definition of "every place an attachment can live" that this script
 * trusts. It is not the only defense (see `assertNoStalePathsRemain`
 * below): if this list ever drifts from the real schema, the sanity check
 * catches it structurally instead of silently missing a container. */
function costLinesOf(report) {
  const singles = LINE_FIELDS.map((field) => report[field]).filter(Boolean)
  const arrays = LINE_ARRAY_FIELDS.flatMap((field) => report[field] ?? [])
  return [...singles, ...arrays]
}

/** Rewrites `attachments[].path` on every cost-line container, replacing
 * the OLD report id prefix with the NEW one. Returns a deep-enough clone —
 * every container that has attachments is a fresh object/array; anything
 * without attachments is passed through by reference, which is safe
 * because it is never mutated. */
function rewriteAttachmentPaths(report, oldId, newId) {
  const oldPrefix = invoicesPrefix(oldId)
  const newPrefix = invoicesPrefix(newId)

  function rewriteLine(line) {
    if (!line || !Array.isArray(line.attachments)) return line
    return {
      ...line,
      attachments: line.attachments.map((attachment) =>
        attachment?.path?.startsWith(oldPrefix)
          ? {
              ...attachment,
              path: newPrefix + attachment.path.slice(oldPrefix.length),
            }
          : attachment,
      ),
    }
  }

  const next = { ...report }
  for (const field of LINE_FIELDS) {
    if (next[field]) next[field] = rewriteLine(next[field])
  }
  for (const field of LINE_ARRAY_FIELDS) {
    if (Array.isArray(next[field])) next[field] = next[field].map(rewriteLine)
  }
  return next
}

/** The generic form of "no cost-line container was missed" (raised in the
 * planning session's inbox note): rather than trusting `costLinesOf`'s
 * field list is exhaustive, this recursively walks the ENTIRE about-to-be-
 * written document for any string that still starts with the OLD report's
 * invoices prefix. If one survives, some container held an attachment this
 * script's field list does not know about, and migrating anyway would
 * silently leave the tenant's invoice pointing at a Storage object that is
 * about to be deleted. Throws — this report's migration is REFUSED, never
 * partially applied. */
function assertNoStalePathsRemain(value, oldPrefix, reportId) {
  if (typeof value === 'string') {
    if (value.startsWith(oldPrefix)) {
      throw new Error(
        `Report ${reportId}: a reference to the OLD prefix ("${value}") ` +
          'survived rewriting — some attachment container is not one this ' +
          'script knows about. Refusing to migrate this report. Add the ' +
          'missing container to costLinesOf() and re-run.',
      )
    }
    return
  }
  if (Array.isArray(value)) {
    for (const item of value)
      assertNoStalePathsRemain(item, oldPrefix, reportId)
    return
  }
  if (value && typeof value === 'object') {
    for (const key of Object.keys(value)) {
      assertNoStalePathsRemain(value[key], oldPrefix, reportId)
    }
  }
}

async function main() {
  const apply = process.argv.includes('--apply')
  const deleteOld = process.argv.includes('--delete-old')

  const projectId = assertRealProject()
  initializeApp({ projectId })
  console.log(
    `Project: ${projectId} — mode: ${
      !apply
        ? 'DRY RUN (no writes)'
        : deleteOld
          ? 'APPLY + DELETE-OLD'
          : 'APPLY (create + verify only)'
    }`,
  )

  // Required lazily, AFTER initializeApp({ projectId }) above — sharedReport.js
  // runs its own `if (!getApps().length) initializeApp()` guard at require-time,
  // which must find the app already initialized with THIS explicit project id
  // (CLAUDE.md §7, same reasoning seed.js's own lazy require documents).
  const { STORAGE_BUCKET } = require('../src/sharedReport')
  const db = getFirestore()
  const bucket = getStorage().bucket(STORAGE_BUCKET)

  const [reportsSnap, tenanciesSnap] = await Promise.all([
    db.collection('monthlyReports').get(),
    db.collection('tenancies').get(),
  ])
  const knownTenancyIds = new Set(tenanciesSnap.docs.map((d) => d.id))

  const missingTenancyId = []
  const danglingTenancyId = []
  const alreadyNewShape = []
  const seenNewIds = new Map() // newId -> oldId, to catch a same-run collision
  const toMigrate = []

  for (const doc of reportsSnap.docs) {
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
    if (!knownTenancyIds.has(report.tenancyId)) {
      danglingTenancyId.push({ oldId: doc.id, tenancyId: report.tenancyId })
      // Still migrated: a dangling tenancyId is a data-quality warning, not
      // a reason to leave the report unreachable under its old, soon-to-be-
      // deleted key. Reported loudly below either way.
    }
    if (seenNewIds.has(newId)) {
      throw new Error(
        `Refusing to run: both "${seenNewIds.get(newId)}" and "${doc.id}" ` +
          `would migrate to the SAME new id "${newId}". This is exactly the ` +
          'collision the production probe checked for and found zero of — ' +
          'investigate by hand before re-running.',
      )
    }
    seenNewIds.set(newId, doc.id)
    toMigrate.push({ oldId: doc.id, newId, report })
  }

  console.log(
    `\n${reportsSnap.size} monthlyReports total — ${toMigrate.length} need migration, ` +
      `${alreadyNewShape.length} already at the new shape, ${missingTenancyId.length} missing tenancyId.`,
  )
  if (missingTenancyId.length > 0) {
    console.log('\n⚠️  Reports with NO tenancyId (skipped, never guessed):')
    for (const id of missingTenancyId) console.log(`   - ${id}`)
  }
  if (danglingTenancyId.length > 0) {
    console.log(
      '\n⚠️  Reports whose tenancyId does not match any tenancies document ' +
        '(migrated anyway — this is a pre-existing data defect, not something ' +
        'this script can repair):',
    )
    for (const { oldId, tenancyId } of danglingTenancyId) {
      console.log(`   - ${oldId} (tenancyId: ${tenancyId})`)
    }
  }

  if (toMigrate.length === 0) {
    console.log('\nNothing to migrate.')
    return
  }

  if (!apply) {
    for (const { oldId, newId } of toMigrate) {
      console.log(`would create: ${oldId} -> ${newId}`)
    }
    console.log(
      '\nDry run only — nothing was written. Re-run with --apply to create.',
    )
    return
  }

  // ---- 1. CREATE ------------------------------------------------------
  const created = []
  for (const { oldId, newId, report } of toMigrate) {
    const oldPrefix = invoicesPrefix(oldId)
    const rewritten = rewriteAttachmentPaths(report, oldId, newId)
    assertNoStalePathsRemain(rewritten, oldPrefix, oldId)

    const newRef = db.collection('monthlyReports').doc(newId)
    const existing = await newRef.get()
    if (existing.exists) {
      console.log(`already exists, skipping create: ${newId}`)
      created.push({ oldId, newId })
      continue
    }
    await newRef.create({
      ...rewritten,
      updatedAt: FieldValue.serverTimestamp(),
    })
    console.log(`created: ${oldId} -> ${newId}`)
    created.push({ oldId, newId })
  }

  // ---- 2. VERIFY --------------------------------------------------------
  console.log('\nVerifying...')
  const verifiedOk = []
  const verifiedFailed = []
  for (const { oldId, newId } of created) {
    try {
      const snap = await db.collection('monthlyReports').doc(newId).get()
      if (!snap.exists) {
        throw new Error(`${newId} does not exist after create`)
      }
      const data = snap.data()
      assertNoStalePathsRemain(data, invoicesPrefix(oldId), oldId)

      for (const line of costLinesOf(data)) {
        for (const attachment of line.attachments ?? []) {
          const [exists] = await bucket.file(attachment.path).exists()
          if (!exists) {
            throw new Error(
              `${newId}: attachment path "${attachment.path}" does not exist ` +
                'in Storage — run migrateReportStorage.js --apply first.',
            )
          }
        }
      }
      verifiedOk.push({ oldId, newId })
      console.log(`   verified: ${newId}`)
    } catch (error) {
      verifiedFailed.push({ oldId, newId, error })
      console.error(`   FAILED to verify ${newId}: ${error.message}`)
    }
  }

  console.log(
    `\n${verifiedOk.length} verified OK, ${verifiedFailed.length} failed verification.`,
  )

  if (!deleteOld) {
    console.log(
      '\nNot deleting old documents/objects (--delete-old not passed). ' +
        'Both old and new now coexist — inspect, then re-run with ' +
        '--apply --delete-old once satisfied.',
    )
    if (verifiedFailed.length > 0) process.exitCode = 1
    return
  }

  // ---- 3. DELETE (gated) -------------------------------------------------
  if (verifiedFailed.length > 0) {
    console.error(
      `\n⚠️  ${verifiedFailed.length} report(s) failed verification in THIS run — ` +
        'deleting NOTHING. CLAUDE.md §10.2: the migration ends without the ' +
        'delete step if the copy cannot be confirmed. Fix the failures above ' +
        'and re-run before attempting --delete-old again.',
    )
    process.exitCode = 1
    return
  }

  console.log(
    `\nDeleting ${verifiedOk.length} old document(s) and their Storage prefixes...`,
  )
  for (const { oldId } of verifiedOk) {
    await db.collection('monthlyReports').doc(oldId).delete()
    const [files] = await bucket.getFiles({ prefix: invoicesPrefix(oldId) })
    await Promise.all(files.map((file) => file.delete().catch(() => {})))
    console.log(`   deleted old: ${oldId} (${files.length} Storage object(s))`)
  }
  console.log('\nDone.')
}

main().catch((error) => {
  console.error('Error:', error)
  process.exit(1)
})
