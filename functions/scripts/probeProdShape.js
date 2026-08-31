/**
 * probeProdShape — READ-ONLY production shape probe, run manually.
 * M8 stage 4 (execution plan rev 6, §2). Deleted once the migration ships.
 *
 * WHY THIS EXISTS. Stage 4 re-keys every `monthlyReports` document from
 * `propertyId_YYYY-MM` to `tenancyId_YYYY-MM` and moves every invoice object
 * in Storage to match (FR-REP-14). The migration's dangerous cases cannot be
 * invented by `seed.js` — they are properties of the real data — and the full
 * production copy is not taken until deploy preparation (owner decision,
 * 2026-08-23). This probe closes that gap: it reads production, writes
 * NOTHING anywhere, and answers the five questions that decide what the
 * migration script must handle.
 *
 * WHAT IT NEVER EMITS. No names, no `cnp`, no email addresses, no phone
 * numbers, no amounts, no IBANs, no photo paths, no guarantor data — nothing
 * from SRS §4.1's personal-data set. Document IDs are hashed, not printed:
 * an id embeds `propertyId`, which is not personal but is an identifier, and
 * the questions below need only equality between ids, never the ids
 * themselves. The output is designed to be safe to paste into a chat.
 *
 * Run (from the functions/ folder):
 *   node scripts/probeProdShape.js
 *
 * It writes `probe.json` into the folder you ran it from and also prints the
 * same JSON to the terminal. **Do not redirect with `>`** — Git Bash on Windows
 * runs node through winpty, which refuses a redirected stdout with "stdout is
 * not a tty". Writing the file from inside the script removes that whole class
 * of shell problem, on every shell.
 *
 * Authentication is Application Default Credentials, exactly like
 * `bootstrapProdAdmin.js` — no credentials in this file, no service-account
 * key shipped. One of these must already be configured in this shell:
 *   - `gcloud auth application-default login`, or
 *   - GOOGLE_APPLICATION_CREDENTIALS pointing at a key file.
 *
 * SAFETY. This file imports only `getFirestore` and calls only `.get()`.
 * It never calls `set`, `update`, `delete`, `add`, `create`, `batch` or
 * `runTransaction`, and it never touches Auth or Storage. Read that claim by
 * grepping this file before running it — that is cheaper than trusting a
 * comment. The one write it performs is a local file, `probe.json`, in the
 * current working directory; nothing is ever written to Firebase.
 */
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { initializeApp } = require('firebase-admin/app')
const { getFirestore } = require('firebase-admin/firestore')

const REQUIRED_PROJECT_ID = 'tenants-manager-2026'

function readProjectId() {
  const rcPath = path.join(__dirname, '..', '..', '.firebaserc')
  const rc = JSON.parse(fs.readFileSync(rcPath, 'utf8'))
  return rc.projects.default
}

/** Same guard as bootstrapProdAdmin.js: never infer the target, check it. */
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

/** A probe that silently reads the emulator would report a clean bill of
 * health for data nobody has ever seen — the worst possible failure for a
 * script whose entire purpose is to describe production. */
function assertNoEmulatorHost() {
  const leaked = [
    'FIRESTORE_EMULATOR_HOST',
    'FIREBASE_AUTH_EMULATOR_HOST',
    'FIREBASE_STORAGE_EMULATOR_HOST',
  ].filter((name) => process.env[name])
  if (leaked.length > 0) {
    console.error(
      'Refusing to run: emulator environment variable(s) set — ' +
        `${leaked.join(', ')}.\n` +
        'This probe describes PRODUCTION. Reading the emulator instead would ' +
        'report a clean result for data nobody has looked at. Unset them ' +
        '(likely left over from "npm run seed" in this same shell) and retry.',
    )
    process.exit(1)
  }
}

/** Short, stable, one-way. Enough to compare two ids for equality across the
 * report without ever printing either one. */
const h = (value) =>
  crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 10)

async function main() {
  assertNoEmulatorHost()
  const projectId = assertRealProject()
  initializeApp({ projectId })
  const db = getFirestore()

  const [reportsSnap, tenanciesSnap] = await Promise.all([
    db.collection('monthlyReports').get(),
    db.collection('tenancies').get(),
  ])

  // ---- tenancies, by property, so a month with two tenants is visible -----
  const tenanciesByProperty = new Map()
  tenanciesSnap.forEach((doc) => {
    const t = doc.data()
    const list = tenanciesByProperty.get(t.propertyId) ?? []
    list.push({
      id: doc.id,
      startDate: t.startDate ?? null,
      endDate: t.endDate ?? null,
      status: t.status ?? null,
    })
    tenanciesByProperty.set(t.propertyId, list)
  })

  const propertiesWithSeveralTenancies = [...tenanciesByProperty.entries()]
    .filter(([, list]) => list.length > 1)
    .map(([propertyId, list]) => ({
      property: h(propertyId),
      tenancies: list.length,
      // dates are not personal data and are what decide whether two tenancies
      // overlap the same billing month
      spans: list.map((t) => ({
        from: String(t.startDate ?? '').slice(0, 10) || null,
        to: String(t.endDate ?? '').slice(0, 10) || null,
        status: t.status,
      })),
    }))

  // ---- the five questions ------------------------------------------------
  const missingTenancyId = []
  const newIdCollisions = new Map()
  const attachmentShapes = new Map()
  let attachmentCount = 0
  let costLineContainers = 0
  const statusCounts = {}
  const monthsSeen = new Set()

  reportsSnap.forEach((doc) => {
    const r = doc.data()
    const month = String(r.month ?? '?').padStart(2, '0')
    const period = `${r.year ?? '?'}-${month}`
    monthsSeen.add(period)
    statusCounts[r.status ?? '(missing)'] =
      (statusCounts[r.status ?? '(missing)'] ?? 0) + 1

    if (!r.tenancyId) {
      missingTenancyId.push({
        report: h(doc.id),
        period,
        status: r.status ?? '(missing)',
        hasPropertyId: Boolean(r.propertyId),
        attachments: (r.attachments ?? []).length,
      })
    } else {
      const newId = `${r.tenancyId}_${period}`
      const bucket = newIdCollisions.get(newId) ?? []
      bucket.push({ report: h(doc.id), period })
      newIdCollisions.set(newId, bucket)
    }

    // ATTACHMENTS LIVE PER COST LINE, NOT AT THE REPORT ROOT (FR-REP-03a):
    // rent.attachments, maintenance.attachments, each serviceCosts[].attachments
    // and each otherExpenses[].attachments. The first version of this probe read
    // `report.attachments`, a field that does not exist, and reported zero
    // attachments for a production database — a false clean bill of health, and
    // exactly the vacuity failure CLAUDE.md §7 warns about: the check passed
    // because it was looking in the wrong place, not because there was nothing
    // to find. Any new cost-line container added later must be added here too.
    const lineGroups = [
      r.rent,
      r.maintenance,
      ...(Array.isArray(r.serviceCosts) ? r.serviceCosts : []),
      ...(Array.isArray(r.otherExpenses) ? r.otherExpenses : []),
    ].filter(Boolean)

    // Guard against the same mistake in reverse: if a root-level `attachments`
    // array ever does exist, count it and say so rather than ignoring it.
    if (Array.isArray(r.attachments) && r.attachments.length > 0) {
      lineGroups.push({ attachments: r.attachments, __root: true })
    }

    for (const line of lineGroups) {
      for (const a of line.attachments ?? []) {
        attachmentCount += 1
        const p = String(a?.path ?? '')
        // classify the SHAPE of the path, never the path itself
        let shape = 'other'
        if (/^reports\/[^/]+\/invoices\/[^/]+$/.test(p))
          shape = 'reports/{id}/invoices/{file}'
        else if (/^reports\//.test(p)) shape = 'reports/… (different depth)'
        else if (p === '') shape = '(empty or missing path)'
        else if (a?.url) shape = 'has url field instead of path'
        if (line.__root) shape += ' [AT REPORT ROOT — unexpected]'
        attachmentShapes.set(shape, (attachmentShapes.get(shape) ?? 0) + 1)
      }
    }

    // How many cost-line containers exist at all, so a zero attachment count
    // can be read as "none uploaded yet" instead of "probe looked nowhere".
    costLineContainers += lineGroups.length
  })

  const collisions = [...newIdCollisions.entries()]
    .filter(([, list]) => list.length > 1)
    .map(([, list]) => ({
      wouldMergeReports: list.length,
      period: list[0].period,
    }))

  const out = {
    probe: 'monthlyReports re-keying, M8 stage 4',
    generatedFrom: projectId,
    redaction: 'ids hashed; no names, cnp, emails, phones, amounts or paths',
    totals: {
      monthlyReports: reportsSnap.size,
      tenancies: tenanciesSnap.size,
      attachments: attachmentCount,
      distinctMonths: monthsSeen.size,
      reportStatus: statusCounts,
    },
    q1_reportsWithoutTenancyId: {
      count: missingTenancyId.length,
      rows: missingTenancyId,
    },
    q2_propertiesWithSeveralTenancies: {
      count: propertiesWithSeveralTenancies.length,
      rows: propertiesWithSeveralTenancies,
    },
    q3_attachmentPathShapes: {
      shapes: Object.fromEntries(attachmentShapes),
      costLineContainersInspected: costLineContainers,
      note: 'attachments are per cost line (FR-REP-03a), not at the report root',
    },
    q4_newIdCollisions: { count: collisions.length, rows: collisions },
    q5_migrationSize: {
      documentsToRewrite: reportsSnap.size,
      storageObjectsToCopy: attachmentCount,
    },
  }

  const json = JSON.stringify(out, null, 2)

  // Written here rather than left to `>` redirection: Git Bash on Windows runs
  // node through winpty, which rejects a redirected stdout outright.
  const outPath = path.join(process.cwd(), 'probe.json')
  fs.writeFileSync(outPath, json, 'utf8')

  console.log(json)
  console.error(`\nWritten to ${outPath}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
