# M4 Sub-stage 4 — Signing & Lock Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the administrator sign a monthly report (making it final, locked, and visible to the tenant) and unlock a signed report for correction — server-side enforced, UI-reflected, security-rules-gated.

**Architecture:** Two new admin-only Cloud Functions (`signReport`, `unlockReport`) do the actual `status` transition inside a Firestore transaction — the client never writes `status` directly. `MonthlyReportPage` calls them through two new mutation hooks and switches into a read-only view whenever the loaded report's `status === 'signed'`; `schema.js`'s `buildInitialValues` stops resyncing `serviceCosts` against the property's live services once that same condition holds, so a signed report displays exactly the snapshot it was signed with (FR-PROP-08). `firestore.rules` and `storage.rules` gain the tenant-facing read rules that SRS §7.3/§6 already specify but sub-stages 1 and 3 deferred, closing both TODOs with the required anti-vacuity check.

**Tech Stack:** Firebase Cloud Functions (`onCall`, Admin SDK transactions), React Hook Form + TanStack Query, `@firebase/rules-unit-testing`, Vitest.

## Global Constraints

- No SRS edits in this sub-stage — `signReport`/`unlockReport` (§7.2), the unlock→draft behavior (FR-REP-07a), and the tenant read rules (§7.3, §6) are already correctly documented as of commit `fe8fb09`. If a gap is found, STOP and ask — do not edit `SRS.md`.
- No email/notification code (`sendReportNotification`, `mail` writes) — sub-stage 6.
- No export/shareToken/`getSharedReport` — sub-stage 8.
- No payment/`onReportWrite`/`currentBalance` work — sub-stage 5.
- `status` transitions happen **exclusively** through `signReport`/`unlockReport` — never a direct client `setDoc`/`updateDoc` of `status`.
- The edit lock (disabled inputs, hidden Save) is enforced in the UI + the callables' own precondition checks — **not** in Security Rules. The admin's `allow read, write: if isAdmin()` rule on `monthlyReports` is untouched (SRS §7.3: single-trusted-admin model, full access everywhere).
- `stripUndefinedDeep` discipline (CLAUDE.md §7) applies to any new Firestore write from the client. The two genuinely NEW client writes in this plan (`signReport`/`unlockReport`) are callable invocations, not direct `setDoc`/`updateDoc`, so it doesn't apply to them. It DOES still apply to Task 6's reworked `useSaveReportDraft` payload — already wrapped in `stripUndefinedDeep`, unchanged by that task, carried forward as-is.
- Every new client-side Firestore/Storage rule ships with BOTH an allow test and the matching deny test, plus a documented anti-vacuity pass (CLAUDE.md §7): temporarily make the new clause permissive, confirm exactly the expected deny tests fail, restore it, note which tests failed in a comment (mirrors `tenancyContract.rules.test.js:19-23`).
- Commit only after the administrator's explicit review of each task's diff — do not batch multiple tasks into one commit.

---

## Decisions carried into this plan (from the brief — do not reopen)

1. **`signedAt` at unlock: left untouched, not deleted.** FR-REP-07a's text only specifies "unlocking sets status back to draft" — it says nothing about `signedAt`. Deleting it would need an extra `FieldValue.delete()` write path and buys nothing: `signReport` unconditionally overwrites it with a fresh `serverTimestamp()` on re-signing, so a stale value never leaks into a re-signed report. Keeping it is the smaller diff and avoids inventing behavior the SRS doesn't ask for (CLAUDE.md §1: don't improvise). **Correction found during plan review (advisor pass):** this claim is only actually true end-to-end once Task 6 below lands. As originally scoped, the brief's Tasks 1-5/7 left `useSaveReportDraft`'s existing non-merge `setDoc` in place — and that call unconditionally writes `status: 'draft'` and omits `signedAt`, so ANY re-save (not just the callable path this decision was reasoning about) would silently wipe `signedAt` and de-sign the report. Task 6 fixes the actual save path so a re-save never touches either field — making this decision true of the real flow, not just of the callable in isolation.
2. **Resync gate (FREEZE snapshot, FR-PROP-08):** the ONLY place `serviceCosts` gets resynced against the property's live `services` is `buildInitialValues` in `web/src/features/reports/schema.js` (schema.js:146-161 in the pre-plan file). Rent/maintenance/otherExpenses never resync from an external live source — only `serviceCosts` does. The gate is one condition, `existingReport?.status === 'signed'`, checked once, at that single call site (Task 5 below).
3. **Save-can-never-clobber-a-signed-report, single source of truth:** `MonthlyReportPage` computes `const isLocked = existingReport?.status === 'signed'` ONCE. It is threaded to (a) disable every input, (b) hide the Save button, and (c) as a belt-and-suspenders guard, `handleValid` returns early if `isLocked` before calling `saveDraft.mutateAsync`. **This alone is NOT sufficient, and was the plan's original gap:** all three of (a)/(b)/(c) key off the SAME `existingReport.status` read off the TanStack Query cache, which is briefly stale right after `signReport` resolves (before the invalidated query refetches) and can stay stale indefinitely in a second tab. Task 6 closes the actual hole by making the save PAYLOAD itself incapable of writing `status`/`signedAt` on a re-save, so even a stray Save click during that stale window can no longer de-sign the report — the UI gate and the payload-level fix are both needed, and are two different tasks on purpose.

---

## File Structure

**New:**

- `functions/src/reports.js` — `signReport`/`unlockReport` core + handlers (mirrors `functions/src/endTenancy.js`).
- `functions/test/reports.test.js` — emulator band tests for both callables.
- `web/tests/monthlyReports.rules.test.js` — firestore rules band: tenant read-own-signed.
- `web/tests/reportsInvoices.rules.test.js` — storage rules band: tenant read-own-signed's invoices.
- `web/src/features/reports/components/SignReportControl.jsx` — sign/unlock buttons + their two confirm dialogs; keeps `MonthlyReportPage.jsx` from growing past its current shape.
- `web/tests/reports.signReportControl.test.jsx` — jsdom band for the new component.

**Modified:**

- `functions/index.js` — export the two new callables.
- `firestore.rules` — `monthlyReports` match block gains the tenant read clause; deferral comment removed.
- `storage.rules` — `/reports/{reportId}/invoices/*` match block gains the tenant read clause; deferral comment removed.
- `web/src/features/reports/hooks.js` — add `useSignReport`, `useUnlockReport`; fix `useSaveReportDraft` to stop writing `status`/`signedAt` on a re-save (Task 6, found during plan review).
- `web/tests/reports.hooks.test.jsx` _(does not exist yet as of this plan — checked: only `reports.attachments.test.js`, `reports.hooks.test.jsx` doesn't appear in the earlier `find`; verify at Task 4 time and create if absent, mirroring `tenants.hooks.test.jsx`'s `httpsCallable` mock)_.
- `web/src/features/reports/schema.js` — gate the `serviceCosts` resync.
- `web/tests/reports.schema.test.js` — cover the freeze.
- `web/src/features/reports/components/CostLineRow.jsx` — `disabled` prop.
- `web/src/features/reports/components/OtherExpensesList.jsx` — `disabled` prop.
- `web/src/features/reports/components/LineAttachments.jsx` — `disabled` prop.
- `web/src/features/reports/pages/MonthlyReportPage.jsx` — `isLocked`, thread `disabled`, hide Save when locked, render `SignReportControl`, early-return guard in `handleValid`.
- `web/tests/reports.page.test.jsx` — lock-state coverage.
- `web/src/lib/i18n/locales/ro.json`, `en.json` — new `reports.sign.*`/`reports.unlock.*` strings.

---

## Task 1: Cloud Functions — `signReport` / `unlockReport`

**Files:**

- Create: `functions/src/reports.js`
- Modify: `functions/index.js`
- Test: `functions/test/reports.test.js`

**Interfaces:**

- Produces: `signReportCore(reportId)`, `unlockReportCore(reportId)`, `signReportHandler(request)`, `unlockReportHandler(request)`, `signReport` (onCall), `unlockReport` (onCall) — all exported from `functions/src/reports.js` and re-exported from `functions/index.js` as `exports.signReport` / `exports.unlockReport`.
- Consumes: nothing new — same `firebase-admin/app`, `firebase-admin/firestore`, `firebase-functions/v2/https` used by `endTenancy.js`.

- [ ] **Step 1: Write the failing tests**

Create `functions/test/reports.test.js`:

```js
import { beforeEach, describe, expect, it } from 'vitest'
import { getFirestore } from 'firebase-admin/firestore'
import {
  signReportCore,
  signReportHandler,
  unlockReportCore,
  unlockReportHandler,
} from '../src/reports.js'

// Functions tests — the REAL boundary (Firestore emulator), no mocks of the
// data layer. Started via `npm run test:emulator` (firebase emulators:exec).
// Mirrors endTenancy.test.js's structure/conventions exactly.

const PROJECT_ID = 'tenants-manager-2026'
const db = getFirestore()

function report(overrides = {}) {
  return {
    ownerId: 'admin-uid',
    propertyId: 'prop-1',
    tenancyId: 'tenancy-1',
    userId: 'user-1',
    month: 7,
    year: 2026,
    rent: { amount: 1500, notes: '', attachments: [] },
    maintenance: { amount: 0, notes: '', attachments: [] },
    serviceCosts: [],
    otherExpenses: [],
    previousMonthArrears: 0,
    previousMonthCredit: 0,
    calculatedTotal: 1500,
    finalTotal: 1500,
    dueDate: '2026-07-05',
    status: 'draft',
    ...overrides,
  }
}

async function clearEmulators() {
  const fsHost = process.env.FIRESTORE_EMULATOR_HOST
  await fetch(
    `http://${fsHost}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`,
    { method: 'DELETE' },
  )
}

async function seedReport(id, overrides = {}) {
  await db.collection('monthlyReports').doc(id).set(report(overrides))
}

beforeEach(async () => {
  await clearEmulators()
})

describe('signReport — happy path (FR-REP-07)', () => {
  it('sets status to signed and stamps signedAt', async () => {
    await seedReport('report-1')

    const result = await signReportCore('report-1')
    expect(result.reportId).toBe('report-1')

    const snap = await db.collection('monthlyReports').doc('report-1').get()
    expect(snap.data().status).toBe('signed')
    expect(snap.data().signedAt).toBeTruthy()
  })
})

describe('signReport — invalid states', () => {
  it('rejects a report that does not exist', async () => {
    await expect(signReportCore('does-not-exist')).rejects.toMatchObject({
      code: 'not-found',
    })
  })

  it('rejects a report that is already signed — nothing changes', async () => {
    await seedReport('report-1', { status: 'signed', signedAt: 'existing' })

    await expect(signReportCore('report-1')).rejects.toMatchObject({
      code: 'failed-precondition',
      details: { reason: 'not-draft' },
    })

    const snap = await db.collection('monthlyReports').doc('report-1').get()
    expect(snap.data().status).toBe('signed')
    expect(snap.data().signedAt).toBe('existing')
  })
})

describe('signReport — callable guard', () => {
  it('rejects a non-admin caller — nothing changes', async () => {
    await seedReport('report-1')

    await expect(
      signReportHandler({
        auth: { token: {}, uid: 'x' },
        data: { reportId: 'report-1' },
      }),
    ).rejects.toMatchObject({ code: 'permission-denied' })

    const snap = await db.collection('monthlyReports').doc('report-1').get()
    expect(snap.data().status).toBe('draft')
  })

  it('rejects a missing reportId argument', async () => {
    await expect(
      signReportHandler({
        auth: { token: { admin: true }, uid: 'admin-uid' },
        data: {},
      }),
    ).rejects.toMatchObject({ code: 'invalid-argument' })
  })
})

describe('unlockReport — happy path (FR-REP-07a)', () => {
  it('sets status back to draft', async () => {
    await seedReport('report-1', { status: 'signed', signedAt: 'existing' })

    const result = await unlockReportCore('report-1')
    expect(result.reportId).toBe('report-1')

    const snap = await db.collection('monthlyReports').doc('report-1').get()
    expect(snap.data().status).toBe('draft')
    // signedAt is left untouched (Decision 1) — re-signing overwrites it.
    expect(snap.data().signedAt).toBe('existing')
  })
})

describe('unlockReport — invalid states', () => {
  it('rejects a report that does not exist', async () => {
    await expect(unlockReportCore('does-not-exist')).rejects.toMatchObject({
      code: 'not-found',
    })
  })

  it('rejects a report that is still a draft — nothing changes', async () => {
    await seedReport('report-1', { status: 'draft' })

    await expect(unlockReportCore('report-1')).rejects.toMatchObject({
      code: 'failed-precondition',
      details: { reason: 'not-signed' },
    })

    const snap = await db.collection('monthlyReports').doc('report-1').get()
    expect(snap.data().status).toBe('draft')
  })
})

describe('unlockReport — callable guard', () => {
  it('rejects a non-admin caller — nothing changes', async () => {
    await seedReport('report-1', { status: 'signed' })

    await expect(
      unlockReportHandler({
        auth: { token: {}, uid: 'x' },
        data: { reportId: 'report-1' },
      }),
    ).rejects.toMatchObject({ code: 'permission-denied' })

    const snap = await db.collection('monthlyReports').doc('report-1').get()
    expect(snap.data().status).toBe('signed')
  })

  it('rejects a missing reportId argument', async () => {
    await expect(
      unlockReportHandler({
        auth: { token: { admin: true }, uid: 'admin-uid' },
        data: {},
      }),
    ).rejects.toMatchObject({ code: 'invalid-argument' })
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (from `functions/`): `npm run test:emulator`
Expected: FAIL — `../src/reports.js` does not exist (module not found).

- [ ] **Step 3: Write the implementation**

Create `functions/src/reports.js`:

```js
const { getApps, initializeApp } = require('firebase-admin/app')
const { getFirestore, FieldValue } = require('firebase-admin/firestore')
const { onCall, HttpsError } = require('firebase-functions/v2/https')

/**
 * signReport / unlockReport (SRS §7.2, FR-REP-07/07a).
 *
 * Same shape as endTenancy.js: a thin admin-only callable handler delegates to
 * a testable `*Core` function that runs a single Firestore transaction
 * (read-then-validate-then-write, HttpsError-per-failure-path).
 *
 * The `status` field is the ONLY thing either function touches. Locking a
 * signed report's fields against further edits is enforced by the UI (the
 * admin's own Security Rules access is untouched — SRS §7.3, single-trusted-
 * admin model) and by these two preconditions themselves: draft->signed only
 * from 'draft', signed->draft only from 'signed'.
 */

if (!getApps().length) {
  initializeApp()
}

async function signReportCore(reportId) {
  const db = getFirestore()
  const reportRef = db.collection('monthlyReports').doc(reportId)

  await db.runTransaction(async (tx) => {
    const reportSnap = await tx.get(reportRef)
    if (!reportSnap.exists) {
      throw new HttpsError('not-found', `Report ${reportId} does not exist.`)
    }
    if (reportSnap.data().status !== 'draft') {
      throw new HttpsError(
        'failed-precondition',
        'Only a draft report can be signed.',
        { reason: 'not-draft' },
      )
    }
    tx.update(reportRef, {
      status: 'signed',
      signedAt: FieldValue.serverTimestamp(),
    })
  })

  return { reportId }
}

async function unlockReportCore(reportId) {
  const db = getFirestore()
  const reportRef = db.collection('monthlyReports').doc(reportId)

  await db.runTransaction(async (tx) => {
    const reportSnap = await tx.get(reportRef)
    if (!reportSnap.exists) {
      throw new HttpsError('not-found', `Report ${reportId} does not exist.`)
    }
    if (reportSnap.data().status !== 'signed') {
      throw new HttpsError(
        'failed-precondition',
        'Only a signed report can be unlocked.',
        { reason: 'not-signed' },
      )
    }
    // signedAt is deliberately left untouched — signReport overwrites it with
    // a fresh timestamp on re-signing, so no stale value ever leaks into a
    // re-signed report (plan Decision 1).
    tx.update(reportRef, { status: 'draft' })
  })

  return { reportId }
}

async function signReportHandler(request) {
  if (request.auth?.token?.admin !== true) {
    throw new HttpsError('permission-denied', 'Admin access required.')
  }
  const reportId = request.data?.reportId
  if (!reportId) {
    throw new HttpsError('invalid-argument', 'reportId is required.')
  }
  return signReportCore(reportId)
}

async function unlockReportHandler(request) {
  if (request.auth?.token?.admin !== true) {
    throw new HttpsError('permission-denied', 'Admin access required.')
  }
  const reportId = request.data?.reportId
  if (!reportId) {
    throw new HttpsError('invalid-argument', 'reportId is required.')
  }
  return unlockReportCore(reportId)
}

const signReport = onCall(signReportHandler)
const unlockReport = onCall(unlockReportHandler)

module.exports = {
  signReport,
  unlockReport,
  signReportHandler,
  unlockReportHandler,
  signReportCore,
  unlockReportCore,
}
```

Modify `functions/index.js`:

```js
// The Cloud Functions are added progressively, starting with M2 (see SRS §7.2 and §9).
const { finalizeKyc } = require('./src/kyc')
const { endTenancy } = require('./src/endTenancy')
const { resetTenantPassword } = require('./src/resetTenantPassword')
const { setTenantAccountStatus } = require('./src/setTenantAccountStatus')
const { signReport, unlockReport } = require('./src/reports')

exports.finalizeKyc = finalizeKyc
exports.endTenancy = endTenancy
exports.resetTenantPassword = resetTenantPassword
exports.setTenantAccountStatus = setTenantAccountStatus
exports.signReport = signReport
exports.unlockReport = unlockReport
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test:emulator` (from `functions/`)
Expected: PASS — all `reports.test.js` cases green.

- [ ] **Step 5: Commit**

```bash
git add functions/src/reports.js functions/index.js functions/test/reports.test.js
git commit -m "feat: add signReport/unlockReport callables (M4 sub-stage 4)"
```

---

## Task 2: firestore.rules — tenant read of their own SIGNED report

**Files:**

- Modify: `firestore.rules:57-62`
- Test: `web/tests/monthlyReports.rules.test.js`

**Interfaces:**

- Consumes: `isAdmin()` (already defined in `firestore.rules`).
- Produces: nothing consumed by other tasks — this is a leaf.

- [ ] **Step 1: Write the failing tests**

Create `web/tests/monthlyReports.rules.test.js` (mirrors `tenancies.rules.test.js`):

```js
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, describe, it } from 'vitest'
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing'
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  setDoc,
} from 'firebase/firestore'

// monthlyReports — admin full access; the tenant reads ONLY their own SIGNED
// report (SRS §6: "admin full; the tenant reads where userId == auth.uid and
// status == 'signed'"; §7.3). Closes the deferral left at M4 sub-stage 1.

let testEnv

const SIGNED_ID = 'report-signed'
const DRAFT_ID = 'report-draft'
const OTHER_TENANT_SIGNED_ID = 'report-other-tenant-signed'

function report(overrides = {}) {
  return {
    ownerId: 'admin-uid',
    propertyId: 'prop-1',
    tenancyId: 'tenancy-1',
    userId: 'tenant-1',
    month: 7,
    year: 2026,
    status: 'draft',
    ...overrides,
  }
}

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'tenants-manager-2026',
    firestore: {
      rules: readFileSync(
        path.resolve(process.cwd(), '../firestore.rules'),
        'utf8',
      ),
    },
  })
})

afterAll(async () => {
  await testEnv?.cleanup()
})

async function seed() {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore()
    await setDoc(
      doc(db, 'monthlyReports', SIGNED_ID),
      report({ status: 'signed' }),
    )
    await setDoc(
      doc(db, 'monthlyReports', DRAFT_ID),
      report({ status: 'draft' }),
    )
    await setDoc(
      doc(db, 'monthlyReports', OTHER_TENANT_SIGNED_ID),
      report({ userId: 'tenant-2', status: 'signed' }),
    )
  })
}

describe('firestore.rules — monthlyReports: admin full, tenant reads own SIGNED only', () => {
  it('denies a read by an unauthenticated visitor', async () => {
    await seed()
    const db = testEnv.unauthenticatedContext().firestore()

    await assertFails(getDoc(doc(db, 'monthlyReports', SIGNED_ID)))
  })

  it('denies a write by an unauthenticated visitor', async () => {
    const db = testEnv.unauthenticatedContext().firestore()

    await assertFails(setDoc(doc(db, 'monthlyReports', SIGNED_ID), report()))
  })

  it("denies the tenant's read of their OWN report while it is still a draft", async () => {
    await seed()
    const db = testEnv.authenticatedContext('tenant-1').firestore()

    await assertFails(getDoc(doc(db, 'monthlyReports', DRAFT_ID)))
  })

  it("denies a DIFFERENT tenant's read of a signed report that isn't theirs", async () => {
    await seed()
    const db = testEnv.authenticatedContext('tenant-1').firestore()

    await assertFails(getDoc(doc(db, 'monthlyReports', OTHER_TENANT_SIGNED_ID)))
  })

  it('denies a write by the tenant themselves (read-only for tenants)', async () => {
    await seed()
    const db = testEnv.authenticatedContext('tenant-1').firestore()

    await assertFails(
      setDoc(doc(db, 'monthlyReports', SIGNED_ID), {
        ...report({ status: 'signed' }),
        finalTotal: 1,
      }),
    )
  })

  it('denies listing the collection to a non-admin', async () => {
    const db = testEnv.authenticatedContext('tenant-1').firestore()

    await assertFails(getDocs(collection(db, 'monthlyReports')))
  })

  it('allows the tenant to read their OWN signed report', async () => {
    await seed()
    const db = testEnv.authenticatedContext('tenant-1').firestore()

    await assertSucceeds(getDoc(doc(db, 'monthlyReports', SIGNED_ID)))
  })

  it('allows the full CRUD to the admin (claim admin:true)', async () => {
    const db = testEnv
      .authenticatedContext('admin-1', { admin: true })
      .firestore()

    await assertSucceeds(
      setDoc(
        doc(db, 'monthlyReports', SIGNED_ID),
        report({ status: 'signed' }),
      ),
    )
    await assertSucceeds(getDoc(doc(db, 'monthlyReports', SIGNED_ID)))
    await assertSucceeds(getDocs(collection(db, 'monthlyReports')))
    await assertSucceeds(deleteDoc(doc(db, 'monthlyReports', SIGNED_ID)))
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run (from `web/`): `npm run test:rules`
Expected: FAIL — "allows the tenant to read their OWN signed report" fails (current rule is `allow read, write: if isAdmin()` only).

- [ ] **Step 3: Implement the rule**

Modify `firestore.rules` (replace lines 57-62):

```
    // monthlyReports — admin full access; the tenant reads ONLY their own
    // SIGNED report (SRS §6/§7.3: "admin full; the tenant reads where userId
    // == auth.uid and status == 'signed'"). A draft is invisible to the
    // tenant by design (FR-REP-06/08) — this is the exact enforcement point.
    // Public (no-auth) access via shareToken does NOT go through this rule —
    // it is served by the getSharedReport Cloud Function (sub-stage 8), which
    // is why there is no "shareToken" branch here.
    match /monthlyReports/{reportId} {
      allow read: if isAdmin() ||
        (request.auth != null &&
          resource.data.userId == request.auth.uid &&
          resource.data.status == 'signed');
      allow write: if isAdmin();
    }
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test:rules`
Expected: PASS — all `monthlyReports.rules.test.js` cases green, plus the untouched `tenancies`/`properties`/`users`/`onboardingDrafts` rules tests stay green.

- [ ] **Step 5: Anti-vacuity pass (CLAUDE.md §7) — do this, then revert**

Temporarily change the rule to `allow read: if isAdmin() || request.auth != null;` (drop the `userId`/`status` checks), rerun `npm run test:rules`, and confirm exactly THREE tests now fail:

- "denies the tenant's read of their OWN report while it is still a draft"
- "denies a DIFFERENT tenant's read of a signed report that isn't theirs"
- "denies listing the collection to a non-admin" — **this one is easy to miss before running it**: Firestore evaluates a `list` query per-document against the same `read` rule, so once the rule no longer references `resource.data`, an authenticated (non-admin) user's unfiltered `getDocs` query passes too. Don't assume only the two single-document tests are coupled to the clause — verify by actually running, not by reasoning about which tests "should" depend on it.

All other tests (both unauthenticated denies, the write deny, the two allow cases) must stay green — if any of those also flip, the rule change is too broad and the test isn't isolating what it claims to. Revert to the Step 3 rule once confirmed. Add a comment to the test file recording exactly which tests failed, mirroring `tenancyContract.rules.test.js:19-23`.

- [ ] **Step 6: Commit**

```bash
git add firestore.rules web/tests/monthlyReports.rules.test.js
git commit -m "feat: allow tenant read of their own signed monthlyReports (SRS §6/§7.3)"
```

---

## Task 3: storage.rules — tenant read of their own SIGNED report's invoices

**Files:**

- Modify: `storage.rules:47-56`
- Test: `web/tests/reportsInvoices.rules.test.js`

**Interfaces:**

- Consumes: `isAdmin()` (already defined in `storage.rules`); reads `monthlyReports/{reportId}` via `firestore.get()` — same cross-service pattern as `storage.rules`' `tenancies/{tenancyId}/contract` rule.
- Depends on Task 2 being committed first (the test seeds a `monthlyReports` document and needs both rule files loaded together, same as `tenancyContract.rules.test.js`) — but does NOT depend on Task 2's rule content, only on `monthlyReports` documents existing with a `status` field, which they already do before Task 2.

- [ ] **Step 1: Write the failing tests**

Create `web/tests/reportsInvoices.rules.test.js` (mirrors `tenancyContract.rules.test.js`):

```js
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, describe, it } from 'vitest'
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing'
import { doc, setDoc } from 'firebase/firestore'
import { deleteObject, getBytes, ref, uploadBytes } from 'firebase/storage'

// /reports/{reportId}/invoices/** (FR-DOC-01…05): admin write; read is admin
// OR the tenant that report belongs to, ONLY once it is signed (mirrors
// tenancyContract.rules.test.js's firestore.get() pattern, but additionally
// gated on status=='signed' — an unsigned report's attachments must stay
// invisible to the tenant, same as the report document itself).

let testEnv

const REPORT_ID = 'report-1'
const OTHER_REPORT_ID = 'report-2'
const DRAFT_REPORT_ID = 'report-3'

function report(overrides = {}) {
  return {
    ownerId: 'admin-uid',
    propertyId: 'prop-1',
    tenancyId: 'tenancy-1',
    userId: 'tenant-1',
    month: 7,
    year: 2026,
    status: 'signed',
    ...overrides,
  }
}

const PATH = `reports/${REPORT_ID}/invoices/invoice.pdf`
const DRAFT_PATH = `reports/${DRAFT_REPORT_ID}/invoices/invoice.pdf`
const BYTES = new Uint8Array([1, 2, 3])

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'tenants-manager-2026',
    firestore: {
      rules: readFileSync(
        path.resolve(process.cwd(), '../firestore.rules'),
        'utf8',
      ),
    },
    storage: {
      rules: readFileSync(
        path.resolve(process.cwd(), '../storage.rules'),
        'utf8',
      ),
    },
  })
})

afterAll(async () => {
  await testEnv?.cleanup()
})

async function seed() {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(
      doc(context.firestore(), 'monthlyReports', REPORT_ID),
      report(),
    )
    await setDoc(
      doc(context.firestore(), 'monthlyReports', OTHER_REPORT_ID),
      report({ userId: 'tenant-2' }),
    )
    await setDoc(
      doc(context.firestore(), 'monthlyReports', DRAFT_REPORT_ID),
      report({ status: 'draft' }),
    )
    await uploadBytes(ref(context.storage(), PATH), BYTES)
    await uploadBytes(ref(context.storage(), DRAFT_PATH), BYTES)
  })
}

describe('storage.rules — /reports/{reportId}/invoices/**: admin write; owning tenant reads once SIGNED', () => {
  it('denies an upload by an unauthenticated visitor', async () => {
    await seed()
    const storage = testEnv.unauthenticatedContext().storage()

    await assertFails(uploadBytes(ref(storage, PATH), BYTES))
  })

  it('denies a read by an unauthenticated visitor', async () => {
    await seed()
    const storage = testEnv.unauthenticatedContext().storage()

    await assertFails(getBytes(ref(storage, PATH)))
  })

  it('denies a write by the tenant that owns the report (read-only for tenants)', async () => {
    await seed()
    const storage = testEnv.authenticatedContext('tenant-1').storage()

    await assertFails(uploadBytes(ref(storage, PATH), BYTES))
  })

  it('denies a delete by the tenant that owns the report', async () => {
    await seed()
    const storage = testEnv.authenticatedContext('tenant-1').storage()

    await assertFails(deleteObject(ref(storage, PATH)))
  })

  it('denies a read by a DIFFERENT tenant (not this report’s owner)', async () => {
    await seed()
    const storage = testEnv.authenticatedContext('tenant-2').storage()

    await assertFails(getBytes(ref(storage, PATH)))
  })

  it("denies the owning tenant's read while the report is still a draft", async () => {
    await seed()
    const storage = testEnv.authenticatedContext('tenant-1').storage()

    await assertFails(getBytes(ref(storage, DRAFT_PATH)))
  })

  it('allows a read by the tenant that owns the SIGNED report', async () => {
    await seed()
    const storage = testEnv.authenticatedContext('tenant-1').storage()

    await assertSucceeds(getBytes(ref(storage, PATH)))
  })

  it('allows the admin to upload', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(
        doc(context.firestore(), 'monthlyReports', REPORT_ID),
        report(),
      )
    })
    const storage = testEnv
      .authenticatedContext('admin-1', { admin: true })
      .storage()

    await assertSucceeds(uploadBytes(ref(storage, PATH), BYTES))
  })

  it('allows the admin to read', async () => {
    await seed()
    const storage = testEnv
      .authenticatedContext('admin-1', { admin: true })
      .storage()

    await assertSucceeds(getBytes(ref(storage, PATH)))
  })

  it('allows the admin to delete', async () => {
    await seed()
    const storage = testEnv
      .authenticatedContext('admin-1', { admin: true })
      .storage()

    await assertSucceeds(deleteObject(ref(storage, PATH)))
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run (from `web/`): `npm run test:rules`
Expected: FAIL — the two "allows a read by the tenant..." style tests fail (current rule is `allow read, write: if isAdmin()` only); the "denies... while draft" test currently PASSES vacuously (everything is denied to non-admins today) — that's expected and will be re-checked for real gating once the rule exists.

- [ ] **Step 3: Implement the rule**

**Found during implementation (deviates from the plan's original snippet above — do this version instead):** the `tenancies/contract` rule (`storage.rules:40-43`) only ever checks ONE field (`userId`), so its inline `firestore.get()` call is fine as written. This rule needs TWO fields (`userId` AND `status`) off the SAME document — writing two separate inline `firestore.get()` calls (as the plan originally sketched) would read the document twice per request. Instead, add ONE helper function using `let` to fetch it once, and call that from the `match` block:

Modify `storage.rules` — add the helper function near the top, right after `isAdmin()`:

```
    // Reads the monthlyReports doc ONCE (via `let`) and checks BOTH fields
    // against that single fetch — unlike the tenancies/contract rule below
    // (which only ever checks one field, so a bare inline firestore.get() is
    // enough there), this path needs userId AND status from the SAME
    // document, so a helper avoids two separate firestore.get() calls for
    // one read request.
    function isOwningTenantOfSignedReport(reportId) {
      let report = firestore.get(/databases/(default)/documents/monthlyReports/$(reportId)).data;
      return report.userId == request.auth.uid && report.status == 'signed';
    }
```

Then replace lines 47-56 (the `/reports/{reportId}/invoices/*` match block):

```
    // /reports/{reportId}/invoices/* — admin write; the tenant that report
    // belongs to may READ, ONLY once it is signed (FR-DOC-01…05, mirrors the
    // tenancies/contract rule's firestore.get() pattern, SRS §6). An unsigned
    // report's attachments stay invisible to the tenant — same visibility
    // boundary as the report document itself (FR-REP-06/08).
    match /reports/{reportId}/invoices/{fileName} {
      allow read: if isAdmin() ||
        (request.auth != null && isOwningTenantOfSignedReport(reportId));
      allow write: if isAdmin();
    }
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test:rules`
Expected: PASS — all `reportsInvoices.rules.test.js` cases green, plus `tenancyContract.rules.test.js`/`storage.rules.test.js` stay green (untouched paths).

- [ ] **Step 5: Anti-vacuity pass (CLAUDE.md §7) — do this, then revert**

Temporarily change the rule to `allow read: if isAdmin() || request.auth != null;` — this keeps the `request.auth != null` check (so the unauthenticated-read deny test stays green, since that test isn't what this pass is probing) but drops the ownership/status checks. Rerun `npm run test:rules` and confirm ONLY these two tests now fail:

- "denies a read by a DIFFERENT tenant (not this report's owner)"
- "denies the owning tenant's read while the report is still a draft"

Every other test — both write-deny tests, the unauthenticated-read deny, and the three admin-allow tests — must stay green; if any of those also flip, the rule is being probed incorrectly. Revert to the Step 3 rule once confirmed. Add a comment recording which tests failed, mirroring `tenancyContract.rules.test.js:19-23`.

- [ ] **Step 6: Commit**

```bash
git add storage.rules web/tests/reportsInvoices.rules.test.js
git commit -m "feat: allow tenant read of their signed report's invoices (SRS §6)"
```

---

## Task 4: Web hooks — `useSignReport` / `useUnlockReport`

**Files:**

- Modify: `web/src/features/reports/hooks.js`
- Test: `web/tests/reports.hooks.test.jsx` (create — verify at execution time whether this file already exists from an earlier sub-stage; if it does, add to it instead of overwriting)

**Interfaces:**

- Consumes: `reportKeys.detail(id)` (already exported from `hooks.js`), `functions`/`db` from `@/lib/firebase`, `httpsCallable` from `firebase/functions`.
- Produces: `useSignReport()` → `{ mutateAsync({ id }) }`; `useUnlockReport()` → `{ mutateAsync({ id }) }`. Both invalidate `reportKeys.detail(id)` on success. Consumed by Task 7's `SignReportControl`.

- [ ] **Step 1: Write the failing test**

Add to `web/tests/reports.hooks.test.jsx` (create it if absent — mirror the mocking convention from `tenants.hooks.test.jsx:23-37`, adapted to this feature's `db`/`functions` fakes):

```js
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { waitFor } from '@testing-library/react'
import { httpsCallable } from 'firebase/functions'
import { renderHookWithProviders } from './renderWithProviders'
import { useSignReport, useUnlockReport } from '@/features/reports/hooks'

vi.mock('@/lib/firebase', () => ({
  db: { __fake: 'db' },
  functions: { __fake: 'functions' },
}))
vi.mock('firebase/functions', () => ({ httpsCallable: vi.fn() }))

beforeEach(() => {
  vi.clearAllMocks()
})

describe('useSignReport (FR-REP-07)', () => {
  it('calls the signReport callable with the report id', async () => {
    const signReportMock = vi
      .fn()
      .mockResolvedValue({ data: { reportId: 'r1' } })
    httpsCallable.mockReturnValue(signReportMock)

    const { result } = await renderHookWithProviders(() => useSignReport())
    await result.current.mutateAsync({ id: 'r1' })

    expect(httpsCallable).toHaveBeenCalledWith(
      { __fake: 'functions' },
      'signReport',
    )
    expect(signReportMock).toHaveBeenCalledWith({ reportId: 'r1' })
  })
})

describe('useUnlockReport (FR-REP-07a)', () => {
  it('calls the unlockReport callable with the report id', async () => {
    const unlockReportMock = vi
      .fn()
      .mockResolvedValue({ data: { reportId: 'r1' } })
    httpsCallable.mockReturnValue(unlockReportMock)

    const { result } = await renderHookWithProviders(() => useUnlockReport())
    await result.current.mutateAsync({ id: 'r1' })

    expect(httpsCallable).toHaveBeenCalledWith(
      { __fake: 'functions' },
      'unlockReport',
    )
    expect(unlockReportMock).toHaveBeenCalledWith({ reportId: 'r1' })
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run (from `web/`): `npm run test:run`
Expected: FAIL — `useSignReport`/`useUnlockReport` are not exported yet.

- [ ] **Step 3: Implement the hooks**

Modify `web/src/features/reports/hooks.js` — add the import and the two hooks at the end of the file:

```js
import { httpsCallable } from 'firebase/functions'
import { db, functions } from '@/lib/firebase'
```

(add `functions` to the existing `import { db } from '@/lib/firebase'` line, and add the new `httpsCallable` import alongside the existing `firebase/firestore` import block)

```js
// ─────────────────────────── useSignReport ───────────────────────
/**
 * Signs the report (FR-REP-07) via the `signReport` callable
 * (functions/src/reports.js) — NOT a direct Firestore write: the transition
 * is validated server-side (status must be 'draft') and stamps `signedAt`
 * with a server timestamp, neither of which the client can do trustworthily.
 * Invalidates the report detail so the page re-fetches with `status:'signed'`
 * and switches into its read-only view.
 */
export function useSignReport() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id }) => {
      const signReport = httpsCallable(functions, 'signReport')
      return signReport({ reportId: id })
    },
    onSuccess: (_result, { id }) => {
      queryClient.invalidateQueries({ queryKey: reportKeys.detail(id) })
    },
  })
}

// ─────────────────────────── useUnlockReport ─────────────────────
/**
 * Unlocks a signed report back to draft (FR-REP-07a) via the `unlockReport`
 * callable — same reasoning as `useSignReport`: the precondition (status must
 * be 'signed') is enforced server-side, not just hidden behind a disabled UI
 * button.
 */
export function useUnlockReport() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id }) => {
      const unlockReport = httpsCallable(functions, 'unlockReport')
      return unlockReport({ reportId: id })
    },
    onSuccess: (_result, { id }) => {
      queryClient.invalidateQueries({ queryKey: reportKeys.detail(id) })
    },
  })
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test:run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/features/reports/hooks.js web/tests/reports.hooks.test.jsx
git commit -m "feat: add useSignReport/useUnlockReport hooks (M4 sub-stage 4)"
```

---

## Task 5: schema.js — freeze `serviceCosts` snapshot once signed (FR-PROP-08)

**Files:**

- Modify: `web/src/features/reports/schema.js:139-161` (the `buildInitialValues` `serviceCosts` computation)
- Test: `web/tests/reports.schema.test.js`

**Interfaces:**

- Consumes: `existingReport.status` (new — `buildInitialValues` didn't read `status` before).
- Produces: no signature change to `buildInitialValues({ tenancy, property, month, year, existingReport })` — same call site in `MonthlyReportPage.jsx` needs no change for this task alone.

- [ ] **Step 1: Write the failing test**

Add to `web/tests/reports.schema.test.js`:

```js
describe('buildInitialValues — FREEZE snapshot on a signed report (FR-PROP-08)', () => {
  it('does NOT resync serviceCosts against the property’s current services once signed', () => {
    const result = buildInitialValues({
      tenancy: { monthlyRent: 1500, dueDay: 5 },
      property: {
        // The property now has a DIFFERENT/renamed service than what the
        // signed report was signed with.
        services: [{ serviceId: 'water', name: 'Water', source: 'catalog' }],
      },
      month: 7,
      year: 2026,
      existingReport: {
        status: 'signed',
        serviceCosts: [
          {
            serviceId: 'gas',
            name: 'Gas',
            amount: 80,
            notes: '',
            attachments: [],
          },
        ],
        rent: { amount: 1500, notes: '', attachments: [] },
        maintenance: { amount: 0, notes: '', attachments: [] },
        otherExpenses: [],
        previousMonthArrears: 0,
        previousMonthCredit: 0,
        dueDate: '2026-07-05',
      },
    })

    // The signed snapshot's "Gas" line survives untouched...
    expect(result.serviceCosts).toEqual([
      { serviceId: 'gas', name: 'Gas', amount: 80, notes: '', attachments: [] },
    ])
    // ...even though "Water" is now the property's only active service —
    // proof this is the FROZEN snapshot, not a live resync.
  })

  it('still resyncs serviceCosts against current services while DRAFT (unchanged behavior)', () => {
    const result = buildInitialValues({
      tenancy: { monthlyRent: 1500, dueDay: 5 },
      property: {
        services: [{ serviceId: 'water', name: 'Water', source: 'catalog' }],
      },
      month: 7,
      year: 2026,
      existingReport: {
        status: 'draft',
        serviceCosts: [
          {
            serviceId: 'gas',
            name: 'Gas',
            amount: 80,
            notes: '',
            attachments: [],
          },
        ],
        rent: { amount: 1500, notes: '', attachments: [] },
        maintenance: { amount: 0, notes: '', attachments: [] },
        otherExpenses: [],
        previousMonthArrears: 0,
        previousMonthCredit: 0,
        dueDate: '2026-07-05',
      },
    })

    // Draft still resyncs: "Gas" drops out (no longer an active service),
    // "Water" shows up fresh at amount 0 — the pre-existing sub-stage-1 behavior.
    expect(result.serviceCosts).toEqual([
      {
        serviceId: 'water',
        name: 'Water',
        amount: 0,
        notes: '',
        attachments: [],
      },
    ])
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run (from `web/`): `npm run test:run`
Expected: FAIL on the first new test — today's `buildInitialValues` always resyncs against `property.services` regardless of `status`, so the signed report would incorrectly return the "Water" line, not "Gas".

- [ ] **Step 3: Implement the gate**

Modify `web/src/features/reports/schema.js`, replacing the `serviceCosts` block inside `buildInitialValues` (current lines 146-161):

```js
const activeServices = property?.services ?? []
const savedServiceCosts = existingReport?.serviceCosts ?? []
// FREEZE (FR-PROP-08): once a report is SIGNED, its serviceCosts is a
// locked snapshot — it must NOT resync against the property's current
// services (a renamed/removed/added service after signing must not alter
// what the tenant already saw). Only a DRAFT still resyncs, exactly as
// sub-stage 1 built it.
const serviceCosts =
  existingReport?.status === 'signed'
    ? savedServiceCosts.map((line) => ({
        serviceId: line.serviceId,
        name: line.name,
        amount: line.amount ?? 0,
        notes: line.notes ?? '',
        attachments: line.attachments ?? [],
      }))
    : activeServices.map((service) => {
        const saved = savedServiceCosts.find(
          (line) => line.serviceId === service.serviceId,
        )
        return {
          serviceId: service.serviceId,
          name: service.name,
          amount: saved?.amount ?? 0,
          notes: saved?.notes ?? '',
          attachments: saved?.attachments ?? [],
        }
      })
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test:run`
Expected: PASS — both new tests, plus every existing `reports.schema.test.js` case (all of which use draft-shaped or status-less `existingReport`, so they exercise the unchanged `else` branch).

- [ ] **Step 5: Commit**

```bash
git add web/src/features/reports/schema.js web/tests/reports.schema.test.js
git commit -m "feat: freeze serviceCosts snapshot once a report is signed (FR-PROP-08)"
```

---

## Task 6: Stop `useSaveReportDraft` from writing `status`/`signedAt` on a re-save

**Why this task exists (found during plan review, not in the original brief):** `useSaveReportDraft` (`hooks.js:96-103`) does a non-merge `setDoc` that unconditionally writes `status: 'draft'` and omits `signedAt`. Combined with Task 7's `isLocked = existingReport?.status === 'signed'` gate, this is a race, not just a theoretical one: `existingReport` comes from TanStack Query cache, which is briefly stale right after `signReport` resolves (before the invalidated query refetches) and stays stale indefinitely if a second browser tab has the same report open while it gets signed elsewhere. In that window `isLocked` reads `false`, the Save button is visible and enabled, and clicking it de-signs the report (`status` flips back to `'draft'`) and silently deletes `signedAt` (a non-merge `setDoc` drops any field not in the payload). This is exactly the hazard the sub-stage-1 author already flagged in `hooks.js:80-85` ("Do not carry this full setDoc into the edit path of a signed/paid report without that fix"), and it directly contradicts the SRS §6 line committed at `fe8fb09`: _"the draft<->signed transition happens EXCLUSIVELY through the signReport/unlockReport callables — never a direct client write."_ A client `setDoc` that writes `status` is that write, regardless of what the UI shows.

The fix must NOT simply drop `status` from the payload — `setDoc` without `{ merge: true }` replaces the whole document, so an omitted `status` would be **deleted** outright, and `signReport`'s `status !== 'draft'` precondition would then throw forever (the document has no `status` to match). The correct fix separates CREATE (a brand-new report — `status: 'draft'` is the correct initial value, set exactly once) from RE-SAVE (an existing report — `status`/`signedAt` are never part of the payload at all, so whatever the server currently holds survives untouched, whether that's `'draft'` or `'signed'`). Re-save switches from `setDoc` to `updateDoc` — the same pattern `useUpdateTenancy`/`useUpdateUser` (`tenants/hooks.js:93-104,161-176`) already use elsewhere in this codebase: partial writes via `updateDoc`, not document replacement via `setDoc`.

This also closes the "does Save clobber a signed report's content" question for the disabled-inputs case: since the payload no longer includes `status`, even a stray Save click while stale-unlocked can only ever re-write cost-line fields (which, since every input was disabled, are unchanged from what was loaded) — it can no longer flip `status` or erase `signedAt`, no matter how stale `existingReport` was when the click happened.

**Files:**

- Modify: `web/src/features/reports/hooks.js:87-128` (`useSaveReportDraft`)
- Modify: `web/src/features/reports/pages/MonthlyReportPage.jsx` (pass the new `isNew` argument)
- Test: `web/tests/reports.hooks.test.jsx`

**Interfaces:**

- Produces: `useSaveReportDraft().mutateAsync({ id, values, previousAttachmentUrls, isNew })` — `isNew` is a NEW required argument (no default — every call site must decide explicitly). Task 7's `MonthlyReportPage` call site passes `isNew: !existingReport`.
- Consumes: `updateDoc` from `firebase/firestore` (not yet imported in `hooks.js` — `setDoc`/`getDoc`/`doc`/`serverTimestamp` are already there).

- [ ] **Step 1: Write the failing tests**

Add to `web/tests/reports.hooks.test.jsx` (the file created in Task 4):

```js
import {
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore'
import { useSaveReportDraft } from '@/features/reports/hooks'

vi.mock('firebase/firestore', () => ({
  doc: vi.fn((_db, collection, id) => ({ __doc: `${collection}/${id}` })),
  getDoc: vi.fn(),
  setDoc: vi.fn(),
  updateDoc: vi.fn(),
  serverTimestamp: vi.fn(() => '__serverTimestamp__'),
}))
vi.mock('@/lib/fileUpload', () => ({
  deleteAttachmentBestEffort: vi.fn(),
}))
vi.mock('@/features/reports/attachments', () => ({
  collectAttachmentUrls: vi.fn(() => []),
  uploadPendingAttachments: vi.fn(async (values) => ({
    values,
    newUrls: [],
  })),
}))

describe('useSaveReportDraft — status/signedAt ownership (found at plan review)', () => {
  it('a NEW report (isNew: true) is created via setDoc with status:"draft"', async () => {
    setDoc.mockResolvedValue()
    const { result } = await renderHookWithProviders(() => useSaveReportDraft())

    await result.current.mutateAsync({
      id: 'p1_2026-07',
      values: { rent: { amount: 1500 } },
      isNew: true,
    })

    expect(setDoc).toHaveBeenCalledTimes(1)
    expect(updateDoc).not.toHaveBeenCalled()
    const payload = setDoc.mock.calls[0][1]
    expect(payload.status).toBe('draft')
  })

  it('a RE-SAVE (isNew: false) uses updateDoc and never includes status or signedAt', async () => {
    updateDoc.mockResolvedValue()
    const { result } = await renderHookWithProviders(() => useSaveReportDraft())

    await result.current.mutateAsync({
      id: 'p1_2026-07',
      values: { rent: { amount: 1600 } },
      isNew: false,
    })

    expect(updateDoc).toHaveBeenCalledTimes(1)
    expect(setDoc).not.toHaveBeenCalled()
    const payload = updateDoc.mock.calls[0][1]
    expect(payload).not.toHaveProperty('status')
    expect(payload).not.toHaveProperty('signedAt')
    // The cost-line fields still get through untouched.
    expect(payload.rent).toEqual({ amount: 1600 })
  })

  it('a re-save on a report that was signed after page load does not change status (anti-vacuity of the race fix)', async () => {
    // Simulates the exact race: the client still thinks it's fine to save
    // (isNew: false, same as any re-save), but the server-side document is
    // actually 'signed' by now. Proves the FIX, not just the happy path: if
    // `status` were still in the updateDoc payload, this test would need to
    // assert it EQUALS 'draft' to catch a regression — instead it asserts the
    // key is absent, which is what actually prevents the de-sign.
    updateDoc.mockResolvedValue()
    const { result } = await renderHookWithProviders(() => useSaveReportDraft())

    await result.current.mutateAsync({
      id: 'p1_2026-07',
      values: { rent: { amount: 1600 } },
      isNew: false,
    })

    const payload = updateDoc.mock.calls[0][1]
    expect(payload).not.toHaveProperty('status')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run (from `web/`): `npm run test:run`
Expected: FAIL — `useSaveReportDraft` doesn't accept `isNew`, always calls `setDoc`, always writes `status: 'draft'`.

- [ ] **Step 3: Implement the fix**

Modify `web/src/features/reports/hooks.js`:

Add `updateDoc` to the existing `firebase/firestore` import:

```js
import {
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore'
```

Replace the `useSaveReportDraft` mutation body (current lines 87-128):

```js
export function useSaveReportDraft() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ id, values, previousAttachmentUrls = [], isNew }) => {
      const { values: uploadedValues, newUrls } =
        await uploadPendingAttachments(values, `reports/${id}/invoices`)

      const payload = stripUndefinedDeep({
        ...uploadedValues,
        updatedAt: serverTimestamp(),
        // `status` is set ONLY at creation. A re-save is a plain `updateDoc`
        // that never mentions `status`/`signedAt` at all, so whatever the
        // server currently holds survives untouched — the draft<->signed
        // transition happens EXCLUSIVELY through signReport/unlockReport
        // (SRS §6), never through this form save, no matter how stale the
        // client's own idea of the report's status is (plan Task 6).
        ...(isNew ? { status: 'draft' } : {}),
      })

      try {
        if (isNew) {
          await setDoc(reportRef(id), payload)
        } else {
          await updateDoc(reportRef(id), payload)
        }
      } catch (error) {
        // `.map((url) => ...)`, NOT `.map(deleteAttachmentBestEffort)` directly:
        // Array#map also passes (index, array) to its callback, and
        // deleteAttachmentBestEffort would silently receive them as extra args.
        await Promise.allSettled(
          newUrls.map((url) => deleteAttachmentBestEffort(url)),
        )
        throw error
      }

      const survivingUrls = collectAttachmentUrls(uploadedValues)
      const removedUrls = previousAttachmentUrls.filter(
        (url) => !survivingUrls.includes(url),
      )
      await Promise.allSettled(
        removedUrls.map((url) => deleteAttachmentBestEffort(url)),
      )

      return id
    },
    onSuccess: (id) => {
      queryClient.invalidateQueries({ queryKey: reportKeys.detail(id) })
    },
  })
}
```

Also update the doc-comment above it (currently ending "...Do not carry this full setDoc into the edit path of a signed/paid report without that fix.") to state the fix landed here — replace that paragraph with:

```js
 * `isNew` decides setDoc-with-status (creation) vs. updateDoc-without-status
 * (re-save). This is the fix the sub-stage-1 comment called for: a re-save
 * NEVER writes `status`/`signedAt`, so it can't clobber a report that was
 * signed after the page loaded, however stale the client's cache is.
```

- [ ] **Step 4: Update the `MonthlyReportPage` call site**

Modify `web/src/features/reports/pages/MonthlyReportPage.jsx`'s `handleValid`, adding `isNew: !existingReport` to the `mutateAsync` call:

```js
await saveDraft.mutateAsync({
  id,
  values: {
    ownerId: property.ownerId,
    propertyId,
    tenancyId: tenancy.id,
    userId: tenancy.userId,
    month,
    year,
    ...values,
    calculatedTotal,
    finalTotal,
  },
  previousAttachmentUrls: collectAttachmentUrls(existingReport),
  isNew: !existingReport,
})
```

- [ ] **Step 5: Run to verify it passes**

Run: `npm run test:run`
Expected: PASS — the three new `reports.hooks.test.jsx` cases, plus every existing `reports.page.test.jsx`/`reports.hooks.test.jsx` save-path case (none of which asserted on `setDoc` vs. `updateDoc` before, so check the pre-existing `reports.attachments.test.js` and any `reports.page.test.jsx` assertions that read `mutateAsync.mock.calls[0][0].values` — those only look at the `values` sub-key, unaffected by this change; if any test mocks `firebase/firestore` without `updateDoc`, add it to that mock).

- [ ] **Step 6: Commit**

```bash
git add web/src/features/reports/hooks.js web/src/features/reports/pages/MonthlyReportPage.jsx web/tests/reports.hooks.test.jsx
git commit -m "fix: stop report draft re-save from writing status/signedAt (race with signReport)"
```

---

## Task 7: UI — read-only lock, Sign/Unlock controls

**Files:**

- Modify: `web/src/features/reports/components/CostLineRow.jsx`
- Modify: `web/src/features/reports/components/OtherExpensesList.jsx`
- Modify: `web/src/features/reports/components/LineAttachments.jsx`
- Create: `web/src/features/reports/components/SignReportControl.jsx`
- Modify: `web/src/features/reports/pages/MonthlyReportPage.jsx`
- Modify: `web/src/lib/i18n/locales/ro.json`, `web/src/lib/i18n/locales/en.json`
- Test: `web/tests/reports.page.test.jsx` (lock-state cases), `web/tests/reports.signReportControl.test.jsx` (new)

**Interfaces:**

- Consumes: `useSignReport`/`useUnlockReport` (Task 4), `ConfirmDialog` (`@/components/shared/ConfirmDialog.jsx`, unmodified).
- Produces: `CostLineRow({ ..., disabled })`, `OtherExpensesList({ ..., disabled })`, `LineAttachments({ ..., disabled })`, `SignReportControl({ report })`.

### 7.1 — i18n strings

- [ ] **Step 1: Add strings**

`web/src/lib/i18n/locales/ro.json`, inside the `reports` object (after `"save"`):

```json
    "save": "Salvează draftul",
    "sign": {
      "button": "Semnează lista",
      "confirmTitle": "Semnează lista",
      "confirmBody": "Lista devine finală și blocată pentru editare.",
      "confirmButton": "Semnează",
      "error": "Lista nu a putut fi semnată. Încearcă din nou."
    },
    "unlock": {
      "button": "Deblochează pentru corecție",
      "confirmTitle": "Deblochează pentru corecție",
      "confirmBody": "Raportul redevine editabil și nu mai este vizibil chiriașului până la o nouă semnare.",
      "confirmButton": "Deblochează",
      "error": "Raportul nu a putut fi deblocat. Încearcă din nou."
    }
```

`web/src/lib/i18n/locales/en.json`, same position:

```json
    "save": "Save draft",
    "sign": {
      "button": "Sign the list",
      "confirmTitle": "Sign the list",
      "confirmBody": "The list becomes final and locked for editing.",
      "confirmButton": "Sign",
      "error": "The list could not be signed. Please try again."
    },
    "unlock": {
      "button": "Unlock for correction",
      "confirmTitle": "Unlock for correction",
      "confirmBody": "The report becomes editable again and is no longer visible to the tenant until re-signed.",
      "confirmButton": "Unlock",
      "error": "The report could not be unlocked. Please try again."
    }
```

(Trailing comma after `"save"` — remember to fix the closing of the previous block; both files currently end `"save": "..."\n  },` so this is a straightforward insertion before that closing brace.)

No header status badge in this sub-stage: SRS §5.3's "header: property + tenant + month + badge" for this route is satisfied by the existing status-badge work on `/admin/current-month` (already spec'd there as "not entered/published/paid/partial/overdue") — adding a second, redundant badge here is out of this sub-stage's explicit scope (brief only asks for disabled-when-signed + Sign/Unlock buttons). If the administrator wants one added to this page too, that's a follow-up, not silently folded in here.

### 7.2 — thread `disabled` through the line components

- [ ] **Step 2: Write the failing tests** (add to `web/tests/reports.page.test.jsx`, new `describe` block)

```js
const SIGNED_REPORT = {
  id: 'p1_2026-07',
  status: 'signed',
  signedAt: '2026-07-01T10:00:00Z',
  rent: { amount: 1500, notes: '', attachments: [] },
  maintenance: { amount: 0, notes: '', attachments: [] },
  serviceCosts: [
    { serviceId: 'gas', name: 'Gas', amount: 0, notes: '', attachments: [] },
    {
      serviceId: 'electricity',
      name: 'Electricity',
      amount: 0,
      notes: '',
      attachments: [],
    },
  ],
  otherExpenses: [],
  previousMonthArrears: 0,
  previousMonthCredit: 0,
  calculatedTotal: 1500,
  finalTotal: 1500,
  dueDate: '2026-07-05',
}

describe('MonthlyReportPage — locked when signed (M4 sub-stage 4, FR-REP-07)', () => {
  it('disables every cost-line input when the report is signed', async () => {
    mockData({ report: SIGNED_REPORT })
    await renderWithProviders(<MonthlyReportPage />)

    expect(await screen.findByLabelText('Chirie')).toBeDisabled()
    const spinbuttons = await screen.findAllByRole('spinbutton')
    spinbuttons.forEach((input) => expect(input).toBeDisabled())
    expect(screen.getByLabelText('Total final')).toBeDisabled()
    expect(screen.getByLabelText('Data scadentă')).toBeDisabled()
  })

  it('hides the Save button when the report is signed', async () => {
    mockData({ report: SIGNED_REPORT })
    await renderWithProviders(<MonthlyReportPage />)

    await screen.findByText('Gas')
    expect(screen.queryByText('Salvează draftul')).toBeNull()
  })

  it('shows the Sign button (not Unlock) on an editable draft', async () => {
    mockData()
    await renderWithProviders(<MonthlyReportPage />)

    expect(await screen.findByText('Semnează lista')).toBeVisible()
    expect(screen.queryByText('Deblochează pentru corecție')).toBeNull()
  })

  it('shows the Unlock button (not Sign) on a signed report', async () => {
    mockData({ report: SIGNED_REPORT })
    await renderWithProviders(<MonthlyReportPage />)

    expect(await screen.findByText('Deblochează pentru corecție')).toBeVisible()
    expect(screen.queryByText('Semnează lista')).toBeNull()
  })

  it('does not resync serviceCosts against the live property once signed (FR-PROP-08 — page-level integration)', async () => {
    useProperty.mockReturnValue({
      data: {
        ...PROPERTY,
        services: [{ serviceId: 'water', name: 'Water', source: 'catalog' }],
      },
      isPending: false,
      isError: false,
    })
    useActiveTenancyForProperty.mockReturnValue({
      data: TENANCY,
      isPending: false,
    })
    useMonthlyReport.mockReturnValue({ data: SIGNED_REPORT, isPending: false })

    await renderWithProviders(<MonthlyReportPage />)

    expect(await screen.findByText('Gas')).toBeVisible()
    expect(screen.queryByText('Water')).toBeNull()
  })
})
```

- [ ] **Step 3: Run to verify it fails**

Run (from `web/`): `npm run test:run`
Expected: FAIL — no `disabled` wiring exists yet, no Sign/Unlock buttons rendered yet.

- [ ] **Step 4: Implement `disabled` threading**

Modify `web/src/features/reports/components/LineAttachments.jsx` — add `disabled` prop, apply to the trigger button and every remove button (the hidden `<input>` doesn't need it separately since it's only reachable through the button):

```js
export function LineAttachments({ control, prefix, t, disabled = false }) {
  ...
        <Button
          type="button"
          variant="outline"
          size="xs"
          onClick={() => inputRef.current?.click()}
          disabled={disabled}
        >
          {t('reports.attachments.add')}
        </Button>
  ...
              <Button
                type="button"
                variant="ghost"
                size="xs"
                onClick={() => remove(index)}
                disabled={disabled}
              >
                {t('reports.attachments.remove')}
              </Button>
  ...
```

Modify `web/src/features/reports/components/CostLineRow.jsx` — add `disabled` prop, apply to both inputs, forward to `LineAttachments`:

```js
export function CostLineRow({
  label,
  prefix,
  register,
  control,
  error,
  t,
  disabled = false,
}) {
  return (
    <div className="flex flex-col gap-2 border-b border-border py-3 last:border-0">
      <div className="grid grid-cols-[1fr_140px_1fr] items-start gap-3">
        <span className="pt-2 text-sm font-medium text-foreground">
          {label}
        </span>
        <div className="flex flex-col gap-1">
          <Input
            type="number"
            step="any"
            aria-label={label}
            disabled={disabled}
            {...register(`${prefix}.amount`, { valueAsNumber: true })}
          />
          {error && (
            <p className="text-xs text-destructive">{t(error.message)}</p>
          )}
        </div>
        <Input
          placeholder={t('reports.fields.notes')}
          disabled={disabled}
          {...register(`${prefix}.notes`)}
        />
      </div>
      <LineAttachments
        control={control}
        prefix={prefix}
        t={t}
        disabled={disabled}
      />
    </div>
  )
}
```

Modify `web/src/features/reports/components/OtherExpensesList.jsx` — add `disabled` prop, apply to every input, the per-row remove button, the "Add expense" button, and forward to `LineAttachments`:

```js
export function OtherExpensesList({
  fields,
  register,
  control,
  errors,
  onAdd,
  onRemove,
  t,
  disabled = false,
}) {
  return (
    <div className="rounded-lg border border-border p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground">
          {t('reports.sections.otherExpenses')}
        </h2>
        <Button type="button" size="sm" onClick={onAdd} disabled={disabled}>
          {t('reports.otherExpenses.add')}
        </Button>
      </div>
      {fields.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t('reports.otherExpenses.empty')}
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {fields.map((field, index) => (
            <div key={field.id} className="flex flex-col gap-2">
              <div className="grid grid-cols-[1fr_140px_1fr_auto] items-start gap-3">
                <div className="flex flex-col gap-1">
                  <Input
                    placeholder={t('reports.fields.description')}
                    disabled={disabled}
                    {...register(`otherExpenses.${index}.description`)}
                  />
                  {errors?.[index]?.description && (
                    <p className="text-xs text-destructive">
                      {t(errors[index].description.message)}
                    </p>
                  )}
                </div>
                <Input
                  type="number"
                  step="any"
                  aria-label={t('reports.fields.amount')}
                  disabled={disabled}
                  {...register(`otherExpenses.${index}.amount`, {
                    valueAsNumber: true,
                  })}
                />
                <Input
                  placeholder={t('reports.fields.notes')}
                  disabled={disabled}
                  {...register(`otherExpenses.${index}.notes`)}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => onRemove(index)}
                  disabled={disabled}
                >
                  {t('reports.otherExpenses.remove')}
                </Button>
              </div>
              <LineAttachments
                control={control}
                prefix={`otherExpenses.${index}`}
                t={t}
                disabled={disabled}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
```

### 7.3 — `SignReportControl`

- [ ] **Step 5: Write the failing test**

Create `web/tests/reports.signReportControl.test.jsx`:

```js
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from './renderWithProviders'
import { SignReportControl } from '@/features/reports/components/SignReportControl'
import { useSignReport, useUnlockReport } from '@/features/reports/hooks'

vi.mock('@/features/reports/hooks', () => ({
  useSignReport: vi.fn(),
  useUnlockReport: vi.fn(),
}))

const signMutateAsync = vi.fn()
const unlockMutateAsync = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  signMutateAsync.mockResolvedValue({})
  unlockMutateAsync.mockResolvedValue({})
  useSignReport.mockReturnValue({
    mutateAsync: signMutateAsync,
    isPending: false,
  })
  useUnlockReport.mockReturnValue({
    mutateAsync: unlockMutateAsync,
    isPending: false,
  })
})

describe('SignReportControl — draft report', () => {
  it('shows the Sign button; confirming calls signReport with the report id', async () => {
    const user = userEvent.setup()
    await renderWithProviders(
      <SignReportControl report={{ id: 'r1', status: 'draft' }} />,
    )

    await user.click(screen.getByText('Semnează lista'))
    expect(
      screen.getByText('Lista devine finală și blocată pentru editare.'),
    ).toBeVisible()

    await user.click(screen.getByText('Semnează'))
    expect(signMutateAsync).toHaveBeenCalledWith({ id: 'r1' })
  })
})

describe('SignReportControl — signed report', () => {
  it('shows the Unlock button; confirming calls unlockReport with the report id', async () => {
    const user = userEvent.setup()
    await renderWithProviders(
      <SignReportControl report={{ id: 'r1', status: 'signed' }} />,
    )

    await user.click(screen.getByText('Deblochează pentru corecție'))
    await user.click(screen.getByText('Deblochează'))

    expect(unlockMutateAsync).toHaveBeenCalledWith({ id: 'r1' })
  })
})
```

- [ ] **Step 6: Run to verify it fails**

Run: `npm run test:run`
Expected: FAIL — `SignReportControl` doesn't exist.

- [ ] **Step 7: Implement `SignReportControl`**

Create `web/src/features/reports/components/SignReportControl.jsx`:

```js
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { useSignReport, useUnlockReport } from '@/features/reports/hooks'

/**
 * The Sign/Unlock control (SRS §5.3 sticky footer, FR-REP-07/07a). Renders
 * exactly ONE of the two buttons depending on `report.status` — never both.
 * Owns its own confirm dialog per action (ConfirmDialog, shared/) and its own
 * error line; the callable failure (e.g. a race where the report was already
 * signed elsewhere) surfaces here, not silently swallowed.
 */
export function SignReportControl({ report }) {
  const { t } = useTranslation()
  const signReport = useSignReport()
  const unlockReport = useUnlockReport()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [error, setError] = useState(null)

  const isSigned = report.status === 'signed'
  const mutation = isSigned ? unlockReport : signReport

  async function handleConfirm() {
    setError(null)
    try {
      await mutation.mutateAsync({ id: report.id })
      setConfirmOpen(false)
    } catch {
      setError(isSigned ? 'reports.unlock.error' : 'reports.sign.error')
    }
  }

  return (
    <>
      <Button
        type="button"
        variant={isSigned ? 'outline' : 'default'}
        onClick={() => {
          setError(null)
          setConfirmOpen(true)
        }}
      >
        {t(isSigned ? 'reports.unlock.button' : 'reports.sign.button')}
      </Button>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {t(error)}
        </p>
      )}

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        titleKey={
          isSigned ? 'reports.unlock.confirmTitle' : 'reports.sign.confirmTitle'
        }
        descriptionKey={
          isSigned ? 'reports.unlock.confirmBody' : 'reports.sign.confirmBody'
        }
        confirmKey={
          isSigned
            ? 'reports.unlock.confirmButton'
            : 'reports.sign.confirmButton'
        }
        onConfirm={handleConfirm}
        destructive={false}
        isPending={mutation.isPending}
      />
    </>
  )
}
```

- [ ] **Step 8: Run to verify it passes**

Run: `npm run test:run`
Expected: PASS for `reports.signReportControl.test.jsx`.

### 7.4 — Wire it all into `MonthlyReportPage`

- [ ] **Step 9: Implement the page changes**

Modify `web/src/features/reports/pages/MonthlyReportPage.jsx`:

Add the import:

```js
import { SignReportControl } from '@/features/reports/components/SignReportControl'
```

After the existing hooks (near `const saveDraft = useSaveReportDraft()`), add:

```js
// FR-REP-07: once signed, the report is READ-ONLY — every input disabled,
// Save hidden, Sign replaced by Unlock. Computed ONCE here; every consumer
// below (CostLineRow, OtherExpensesList, the dueDate/finalTotal inputs, the
// Save button) reads this SAME boolean — no re-derivation, no drift.
const isLocked = existingReport?.status === 'signed'
```

In `handleValid`, add the guard as its first line (belt-and-suspenders — Save is already hidden/disabled when locked, this stops a stray call from ever reaching the mutation):

```js
  async function handleValid(values) {
    if (isLocked) return
    setSaveError(null)
    ...
```

Thread `disabled={isLocked}` into every `CostLineRow` call (rent, maintenance, each service), into `OtherExpensesList`, and onto the `dueDate` and `finalTotal` `Input`s:

```js
          <CostLineRow
            label={t('reports.sections.rent')}
            prefix="rent"
            register={register}
            control={control}
            error={errors.rent?.amount}
            t={t}
            disabled={isLocked}
          />
          <CostLineRow
            label={t('reports.sections.maintenance')}
            prefix="maintenance"
            register={register}
            control={control}
            error={errors.maintenance?.amount}
            t={t}
            disabled={isLocked}
          />
          {serviceFields.map((field, index) => (
            <CostLineRow
              key={field.id}
              label={field.name}
              prefix={`serviceCosts.${index}`}
              register={register}
              control={control}
              error={errors.serviceCosts?.[index]?.amount}
              t={t}
              disabled={isLocked}
            />
          ))}
        </div>

        <OtherExpensesList
          fields={otherExpenseFields}
          register={register}
          control={control}
          errors={errors.otherExpenses}
          onAdd={() => appendOtherExpense({ description: '', amount: 0, notes: '', attachments: [] })}
          onRemove={removeOtherExpense}
          t={t}
          disabled={isLocked}
        />
```

```js
<Input
  id="dueDate"
  type="date"
  className="w-40"
  disabled={isLocked}
  {...register('dueDate')}
/>
```

```js
<Input
  id="finalTotal"
  type="number"
  step="any"
  className="w-32 text-right text-lg font-semibold"
  disabled={isLocked}
  {...register('finalTotal', {
    valueAsNumber: true,
    onChange: () => setIsFinalTotalDirty(true),
  })}
/>
```

Replace the sticky footer's Save button block with a Save-or-nothing plus the new `SignReportControl`:

```js
<div className="flex items-center gap-3">
  {!isLocked && (
    <Button type="submit" disabled={saveDraft.isPending}>
      {saveDraft.isPending ? t('common.loading') : t('reports.save')}
    </Button>
  )}
  {existingReport && <SignReportControl report={existingReport} />}
</div>
```

(`SignReportControl` only renders once `existingReport` exists — a brand-new, never-saved draft has nothing to sign yet, consistent with FR-REP-14's "the report is created by the first save.")

- [ ] **Step 10: Run to verify it passes**

Run: `npm run test:run`
Expected: PASS — every test added in Step 2, plus the full pre-existing `reports.page.test.jsx` suite (draft-mode tests never set `existingReport.status`, so `isLocked` is `false` for them — unchanged behavior).

- [ ] **Step 11: Commit**

```bash
git add web/src/features/reports/components/CostLineRow.jsx \
        web/src/features/reports/components/OtherExpensesList.jsx \
        web/src/features/reports/components/LineAttachments.jsx \
        web/src/features/reports/components/SignReportControl.jsx \
        web/src/features/reports/pages/MonthlyReportPage.jsx \
        web/src/lib/i18n/locales/ro.json \
        web/src/lib/i18n/locales/en.json \
        web/tests/reports.page.test.jsx \
        web/tests/reports.signReportControl.test.jsx
git commit -m "feat: lock report editing when signed, add Sign/Unlock UI (M4 sub-stage 4)"
```

---

## Self-Review

**1. Spec coverage:**

- FR-REP-07 (sign, lock, visible to tenant) → Tasks 1, 2, 7.
- FR-REP-07a (unlock → draft, editable again, re-sign) → Tasks 1, 7.
- FR-REP-08 (no auto-publication, unlock→edit→re-sign) → Task 7 (lock gating), Task 1 (server-enforced transition), Task 6 (closes the re-save loophole that would otherwise silently re-publish an unlocked report's stale data as if it were a fresh save).
- FR-PROP-08 (serviceCosts snapshot freeze at signing) → Task 5.
- SRS §6/§7.3 tenant read of signed `monthlyReports` → Task 2.
- SRS §6 tenant read of signed report's invoices → Task 3.
- SRS §7.2 `signReport`/`unlockReport` callable contracts (already documented at `fe8fb09`) → Task 1 implements exactly what's documented; no SRS edit needed.
- SRS §6 line 474-475 ("the draft<->signed transition happens EXCLUSIVELY through the signReport/unlockReport callables — never a direct client write") → Task 1 satisfies it for the callables' own writes; Task 6 is what actually makes it true, because without it `useSaveReportDraft`'s pre-existing `setDoc` WAS a second, non-compliant client write of `status`. This gap was not in the original brief — found during the advisor review pass on this plan, before any code was written.
- SRS §5.3 sticky-footer "Sign the list" + confirm dialog + "Unlock for correction" + confirm dialog → Task 7.
- CLAUDE.md §7 anti-vacuity → Tasks 2 and 3, Step 5 each; Task 6, Step 1's third test (asserts the fixed payload shape directly, not just a happy-path outcome).
- Clobber risk flagged in `hooks.js`'s existing comment (`hooks.js:80-85`) → Task 6 (payload-level fix: a re-save never writes `status`/`signedAt`) + Task 7, Step 9 (`isLocked` guard in `handleValid`, disabled Save button, hidden Save button). Both are needed: Task 7's defenses gate the UI path; Task 6 closes the gap those defenses can't reach on their own (stale-cache race, second tab) — see Decision 3's correction above.
- Explicitly excluded (email, export/shareToken, payments, dashboard) → touched nowhere in this plan; confirmed absent from every task's file list.

**2. Placeholder scan:** none found — every step has real, complete code, exact file paths, and exact test assertions.

**3. Type/signature consistency:**

- `buildInitialValues({ tenancy, property, month, year, existingReport })` — signature unchanged across Task 5 and its Task 7 call site.
- `useSignReport()`/`useUnlockReport()` both return `{ mutateAsync({ id }), isPending }` — used identically in `SignReportControl` (Task 7) as designed in Task 4.
- `signReportCore(reportId)` / `unlockReportCore(reportId)` and their `HttpsError` `details.reason` values (`'not-draft'` / `'not-signed'`) are used consistently between the Task 1 implementation and its own tests — nothing in later tasks reads `details.reason`, so no cross-task drift risk there.
- `CostLineRow`/`OtherExpensesList`/`LineAttachments` all gain the same `disabled = false` default — a caller that doesn't pass it (there are none besides `MonthlyReportPage`) keeps today's always-enabled behavior.
- `useSaveReportDraft().mutateAsync({ id, values, previousAttachmentUrls, isNew })` — Task 6 adds `isNew` with NO default (deliberately — every call site must decide explicitly); Task 7's `MonthlyReportPage` is the only call site in this plan and passes `isNew: !existingReport`. If any other call site is added later, it must supply `isNew` too or `useSaveReportDraft` will throw trying to `updateDoc` a document that was never created.

**4. Final gate — run all three test bands together before asking for sign-off on the whole sub-stage** (each task above only proves its own band in isolation):

```bash
npm run test:run --prefix web
npm run test:rules --prefix web
npm run test:emulator --prefix functions
```

Paste the output of all three. All must be green, and the rules-band run must include both new rules files (`monthlyReports.rules.test.js`, `reportsInvoices.rules.test.js`) alongside every pre-existing rules test, confirming nothing in `tenancies`/`properties`/`users`/`onboardingDrafts`/the tenancy-contract Storage rule regressed.
