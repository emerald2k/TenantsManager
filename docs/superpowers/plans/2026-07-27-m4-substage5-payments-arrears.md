# M4 Sub-stage 5 — Payments, Carry-Forward Arrears/Credit, Live FR-CON-04 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the administrator record/cancel a payment on a signed report; make `tenancies.currentBalance` a live, server-computed value (most recent SIGNED report's `finalTotal − amountPaid`); make a DRAFT report's `previousMonthArrears`/`previousMonthCredit` mirror that live balance until signing, then freeze; make `endTenancy`'s FR-CON-04 guard (already written in M3) actually block/allow based on real data for the first time.

**Architecture:** A new Firestore trigger, `onReportWrite` (`functions/src/reports.js`), recomputes `tenancies.currentBalance` from the tenancy's most recent SIGNED report whenever any `monthlyReports` document changes status-relevantly. The client marks/cancels a payment via a plain `updateDoc` (admin already has full write access — no new Security Rule, no callable) that touches ONLY the four payment fields, never `status`/`signedAt`. `schema.js`'s `buildInitialValues` gains a second FREEZE gate — identical in shape to the M4 sub-stage 4 `serviceCosts` gate — for `previousMonthArrears`/`previousMonthCredit`.

**Tech Stack:** Firebase Cloud Functions (`onDocumentWritten` — the first Firestore trigger in this codebase, alongside the existing `onCall` callables), React Hook Form + Zod, TanStack Query.

## Global Constraints

- No SRS edits — the semantics this plan implements are already pinned at commit `e8ca367` (§6 `currentBalance`, §6 `previousMonthArrears/Credit`, FR-CON-04). If a gap is found, STOP and ask — do not edit `SRS.md`.
- No Security Rules changes — payment writes are plain admin `updateDoc`s, already covered by the existing `monthlyReports` admin-full-write rule (`firestore.rules`, unchanged since `b2b9296`). No new rules-band test file.
- No email/notification (`sendReportNotification` — sub-stage 6), no export/shareToken (sub-stage 8), no `dailyScheduler`/FR-PAY-04 reminders (M6).
- `currentBalance` is sourced from the SINGLE most recent SIGNED report — never summed across reports (SRS §6, pinned at `e8ca367`: summing would double-count arrears that are already rolled forward inside `finalTotal` via `previousMonthArrears`/`previousMonthCredit`).
- A payment write (`useMarkPayment`/`useCancelPayment`) NEVER includes `status` or `signedAt` in its `updateDoc` payload — same discipline as M4 sub-stage 4's `useSaveReportDraft` re-save fix, for the same reason (a payment write must not be a de-facto second path that could transition or de-sign a report).
- `isLocked` (from M4 sub-stage 4, `MonthlyReportPage.jsx`) keeps its existing, unchanged meaning: it gates ONLY the cost-line inputs, `dueDate`, `finalTotal`, and the Save button. `PaymentSection`'s visibility is a SEPARATE concern that happens to read the same underlying boolean — see Task 6.
- `stripUndefinedDeep` (CLAUDE.md §7) applies to the payment write's payload. Cancelling a payment must set fields to `null` (not `undefined`) — `updateDoc` only touches keys present in its payload, and `stripUndefinedDeep` REMOVES `undefined` keys before the write, so an `undefined` clear-value would silently leave the OLD payment data in Firestore instead of clearing it. This is the plan's version of the sub-stage 4 clobber lesson — same root cause (write-path only touches what's actually in the payload), different field.

---

## Decisions carried into this plan (confirm before Task 1)

1. **Client `updateDoc`, not a callable, for marking/cancelling a payment.** Bogdan's own reasoning in the brief, confirmed: this is a single-document field update the admin already has full write access to (unlike `signReport`/`unlockReport`, there is no cross-document transaction, no precondition that only a trusted server can enforce, and no state machine to protect — `paymentStatus` is a pure, deterministic function of `finalTotal`/`amountPaid` computed client-side before the write). A callable here would be unjustified abstraction (CLAUDE.md: don't add machinery beyond what's needed).
2. **`onReportWrite` recomputes by re-QUERYING, not by incrementing/decrementing.** On every relevant write, it re-derives `currentBalance` from scratch (query the tenancy's signed reports, sort in memory, take the most recent). This makes the trigger naturally idempotent under Firestore's at-least-once delivery — no dedup/version bookkeeping needed, unlike the create-next-month-report design discussed and dropped earlier in this conversation.
3. **No composite Firestore index.** The query is `monthlyReports` where `tenancyId == X AND status == 'signed'` — two equality filters, no `orderBy`, no range — which Firestore serves from its automatic single-field indexes without a composite index. Sorting by `(year, month)` to find "most recent" happens in-memory, in the Cloud Function, after the fetch. At this project's scale (5-20 properties, SRS §7.5), a tenancy has at most a handful of signed reports — fetching all of them and sorting client-side (server-side, but "client" of Firestore) is cheaper than provisioning and maintaining an index for a query this small. `firestore.indexes.json` stays untouched.
4. **The trigger skips work on drafts.** `onReportWrite` only recomputes when the write is "status-relevant" — `after.status === 'signed' || before.status === 'signed'`. A plain draft save (create or re-save, `status` staying `'draft'` throughout) can never change "the most recent signed report," so recomputing on every keystroke-triggered draft save would be correct but wasteful (NFR-PERF-04 cost-consciousness, SRS §7.5's explicit Blaze-plan budget concern). Covers: `signReport` (draft→signed), `unlockReport` (signed→draft — the just-unlocked report drops out, balance may fall back to an older signed report or 0), a payment write on an already-signed report (status stays `'signed'` throughout — still relevant).
5. **`PaymentSection` renders only once the report is `signed`**, not on a draft (SRS §5.3: "After publication — payment section..."). It is a fully separate component from the cost-line inputs — it does not receive or use `disabled`/`isLocked` as a disabling prop; `MonthlyReportPage` uses the SAME `isLocked` boolean purely to decide WHETHER to render it (`{isLocked && <PaymentSection .../>}`), which is a read, not a mutation, of that boundary — see Task 6.
6. **"Mark payment" is an upsert, not create-once.** The mini-form is always pre-filled with whatever payment data currently exists (blank if none) and "Mark payment" always overwrites — this is what FR-PAY-06 ("payments can be... corrected") means in practice: correcting is just re-marking with new values, no separate "edit" mode.
7. **"Cancel payment" resets to the four fields' unpaid state**: `amountPaid: null, paymentMethod: null, paymentDate: null, paymentStatus: 'unpaid'` (plus `updatedAt`). Guarded by a confirm dialog (`ConfirmDialog`, shared/), matching the codebase's existing convention for consequential state-clearing actions (End contract, Sign, Unlock all use one).

---

## File Structure

**New:**

- `functions/test/currentBalance.integration.test.js` — the "live FR-CON-04" test spanning `reports.js`'s `recomputeCurrentBalance` and `endTenancy.js`'s guard together.
- `web/src/features/reports/components/PaymentSection.jsx` — the payment mini-form + Mark/Cancel + credit indicator.
- `web/tests/reports.paymentSection.test.jsx` — jsdom band for the new component.

**Modified:**

- `functions/src/reports.js` — add `onReportWrite` (Firestore trigger) + `recomputeCurrentBalance` (testable core).
- `functions/index.js` — export `onReportWrite`.
- `functions/test/reports.test.js` — add `recomputeCurrentBalance` unit coverage.
- `web/src/features/reports/schema.js` — carry-forward FREEZE gate in `buildInitialValues`; new `paymentSchema`; new `derivePaymentStatus`.
- `web/src/features/reports/hooks.js` — new `useMarkPayment`, `useCancelPayment`.
- `web/src/features/reports/pages/MonthlyReportPage.jsx` — render `PaymentSection` when `isLocked`.
- `web/src/lib/i18n/locales/ro.json`, `en.json` — `reports.payment.*` strings.
- `web/tests/reports.schema.test.js` — carry-forward + `derivePaymentStatus` tests.
- `web/tests/reports.hooks.test.jsx` — `useMarkPayment`/`useCancelPayment` tests.
- `web/tests/reports.page.test.jsx` — `PaymentSection` rendering/wiring integration tests.

**Untouched (confirmed, no changes needed):**

- `functions/src/endTenancy.js` — `endTenancy.js:74`'s `if (tenancyData.currentBalance > 0)` guard already reads exactly the pinned FR-CON-04 semantics. It has been correct since M3; it was simply never exercised against a LIVE value because nothing wrote `currentBalance` until this sub-stage. Task 2 below proves it end-to-end; no source line changes.
- `firestore.rules`, `storage.rules`, `firestore.indexes.json` — see Decisions 1 and 3.
- `SRS.md` — see Global Constraints.

---

## Task 1: `onReportWrite` trigger + `recomputeCurrentBalance`

**Files:**

- Modify: `functions/src/reports.js`
- Modify: `functions/index.js`
- Modify: `functions/test/reports.test.js`

**Interfaces:**

- Produces: `recomputeCurrentBalance(tenancyId)` (async, no return value — writes `tenancies/{tenancyId}.currentBalance`), `onReportWriteHandler(event)`, `onReportWrite` (the exported `onDocumentWritten` trigger). All added to `functions/src/reports.js`'s existing `module.exports`.
- Consumes: nothing new from other tasks.

- [ ] **Step 1: Write the failing tests**

Add to `functions/test/reports.test.js`:

```js
import {
  recomputeCurrentBalance,
  onReportWriteHandler,
} from '../src/reports.js'

// ... (existing imports/helpers stay; `report()` helper already exists)

async function seedTenancy(id, overrides = {}) {
  await db
    .collection('tenancies')
    .doc(id)
    .set({
      userId: 'user-1',
      ownerId: 'admin-uid',
      propertyId: 'prop-1',
      tenantName: 'Ion Popescu',
      status: 'active',
      currentBalance: 0,
      ...overrides,
    })
}

describe('recomputeCurrentBalance (SRS §6, pinned at e8ca367)', () => {
  it('sets currentBalance to 0 when the tenancy has no signed report yet', async () => {
    await seedTenancy('tenancy-1')
    await seedReport('report-1', {
      tenancyId: 'tenancy-1',
      status: 'draft',
      finalTotal: 1500,
    })

    await recomputeCurrentBalance('tenancy-1')

    const snap = await db.collection('tenancies').doc('tenancy-1').get()
    expect(snap.data().currentBalance).toBe(0)
  })

  it('computes finalTotal - amountPaid from the single signed report (partial payment -> arrears)', async () => {
    await seedTenancy('tenancy-1')
    await seedReport('report-1', {
      tenancyId: 'tenancy-1',
      status: 'signed',
      finalTotal: 1500,
      amountPaid: 1000,
    })

    await recomputeCurrentBalance('tenancy-1')

    const snap = await db.collection('tenancies').doc('tenancy-1').get()
    expect(snap.data().currentBalance).toBe(500)
  })

  it('is negative (credit) on overpayment', async () => {
    await seedTenancy('tenancy-1')
    await seedReport('report-1', {
      tenancyId: 'tenancy-1',
      status: 'signed',
      finalTotal: 1500,
      amountPaid: 1800,
    })

    await recomputeCurrentBalance('tenancy-1')

    const snap = await db.collection('tenancies').doc('tenancy-1').get()
    expect(snap.data().currentBalance).toBe(-300)
  })

  it('is the full finalTotal when nothing has been paid (amountPaid absent)', async () => {
    await seedTenancy('tenancy-1')
    await seedReport('report-1', {
      tenancyId: 'tenancy-1',
      status: 'signed',
      finalTotal: 1500,
    })

    await recomputeCurrentBalance('tenancy-1')

    const snap = await db.collection('tenancies').doc('tenancy-1').get()
    expect(snap.data().currentBalance).toBe(1500)
  })

  it('anti-vacuity: uses ONLY the most recent signed report, NOT a sum across all of them', async () => {
    await seedTenancy('tenancy-1')
    // An OLDER signed report with a large arrears...
    await seedReport('report-old', {
      tenancyId: 'tenancy-1',
      status: 'signed',
      month: 6,
      year: 2026,
      finalTotal: 1500,
      amountPaid: 0, // 1500 arrears, if it were (wrongly) summed
    })
    // ...and a NEWER signed report, fully paid.
    await seedReport('report-new', {
      tenancyId: 'tenancy-1',
      status: 'signed',
      month: 7,
      year: 2026,
      finalTotal: 1600,
      amountPaid: 1600,
    })

    await recomputeCurrentBalance('tenancy-1')

    const snap = await db.collection('tenancies').doc('tenancy-1').get()
    // If this summed, it would be 1500 (old arrears) + 0 (new, fully paid) = 1500.
    // The correct, pinned semantics: only report-new (the most recent signed) counts.
    expect(snap.data().currentBalance).toBe(0)
  })

  it('picks the most recent by (year, month), not by document write order', async () => {
    await seedTenancy('tenancy-1')
    // Written in reverse chronological order on purpose — proves the sort is by
    // (year, month), not by Firestore insertion/query order.
    await seedReport('report-jan', {
      tenancyId: 'tenancy-1',
      status: 'signed',
      month: 1,
      year: 2026,
      finalTotal: 100,
      amountPaid: 100,
    })
    await seedReport('report-dec-prev-year', {
      tenancyId: 'tenancy-1',
      status: 'signed',
      month: 12,
      year: 2025,
      finalTotal: 9999,
      amountPaid: 0,
    })

    await recomputeCurrentBalance('tenancy-1')

    const snap = await db.collection('tenancies').doc('tenancy-1').get()
    // January 2026 is more recent than December 2025, even though the December
    // document has the larger (wrong-if-picked) arrears.
    expect(snap.data().currentBalance).toBe(0)
  })

  it('ignores a DRAFT report even if it is more recent than the last signed one', async () => {
    await seedTenancy('tenancy-1')
    await seedReport('report-signed', {
      tenancyId: 'tenancy-1',
      status: 'signed',
      month: 6,
      year: 2026,
      finalTotal: 1500,
      amountPaid: 1500,
    })
    await seedReport('report-draft', {
      tenancyId: 'tenancy-1',
      status: 'draft',
      month: 7,
      year: 2026,
      finalTotal: 9999,
      amountPaid: 0,
    })

    await recomputeCurrentBalance('tenancy-1')

    const snap = await db.collection('tenancies').doc('tenancy-1').get()
    expect(snap.data().currentBalance).toBe(0)
  })
})

describe('onReportWriteHandler — status-relevance skip guard (plan Decision 4)', () => {
  // These call the exported HANDLER directly with a hand-built event object
  // — NOT the deployed onDocumentWritten trigger. `test:emulator` only starts
  // auth/firestore/storage (functions/package.json), so the real trigger
  // dispatch never fires in this test band; see Task 1's Step 2.5 below for
  // how the actual wiring gets proven. This suite only pins the pure
  // skip/no-skip LOGIC, using real Firestore underneath (via
  // recomputeCurrentBalance) to observe whether it ran.
  function fakeEvent({ beforeData, afterData }) {
    return {
      data: {
        before: beforeData
          ? { exists: true, data: () => beforeData }
          : { exists: false },
        after: afterData
          ? { exists: true, data: () => afterData }
          : { exists: false },
      },
    }
  }

  it('skips recompute on a draft-to-draft write (status never signed on either side)', async () => {
    await seedTenancy('tenancy-1', { currentBalance: 42 })

    await onReportWriteHandler(
      fakeEvent({
        beforeData: {
          tenancyId: 'tenancy-1',
          status: 'draft',
          finalTotal: 100,
        },
        afterData: { tenancyId: 'tenancy-1', status: 'draft', finalTotal: 200 },
      }),
    )

    const snap = await db.collection('tenancies').doc('tenancy-1').get()
    // Untouched — 42 would never be a real recompute result for these
    // fixtures, so an unchanged value proves the skip, not a coincidence.
    expect(snap.data().currentBalance).toBe(42)
  })

  it('recomputes on a signed-to-draft write (unlockReport — the just-unlocked report must drop out)', async () => {
    await seedTenancy('tenancy-1', { currentBalance: 999 })
    // No OTHER signed report exists, so a correct recompute lands on 0.

    await onReportWriteHandler(
      fakeEvent({
        beforeData: {
          tenancyId: 'tenancy-1',
          status: 'signed',
          finalTotal: 1500,
          amountPaid: 0,
        },
        afterData: {
          tenancyId: 'tenancy-1',
          status: 'draft',
          finalTotal: 1500,
          amountPaid: 0,
        },
      }),
    )

    const snap = await db.collection('tenancies').doc('tenancy-1').get()
    expect(snap.data().currentBalance).toBe(0)
  })

  it('recomputes on a draft-to-signed write (signReport)', async () => {
    await seedTenancy('tenancy-1', { currentBalance: 0 })

    await onReportWriteHandler(
      fakeEvent({
        beforeData: {
          tenancyId: 'tenancy-1',
          status: 'draft',
          finalTotal: 1500,
          amountPaid: 0,
        },
        afterData: {
          tenancyId: 'tenancy-1',
          status: 'signed',
          finalTotal: 1500,
          amountPaid: 600,
        },
      }),
    )

    const snap = await db.collection('tenancies').doc('tenancy-1').get()
    expect(snap.data().currentBalance).toBe(900)
  })
})
```

This requires a `seedReport(id, overrides)` helper — check `functions/test/reports.test.js`'s existing `seedReport` (already defined for the `signReport`/`unlockReport` tests, Task 1 of the M4 sub-stage 4 plan) and extend its `overrides` usage; no new helper needed if the existing one already spreads `overrides` over the base `report()` shape (it does — `functions/test/reports.test.js`'s current `seedReport` is `db.collection('monthlyReports').doc(id).set(report(overrides))`).

- [ ] **Step 2: Run the tests to verify they fail**

Run (from `functions/`): `npm run test:emulator`
Expected: FAIL — `recomputeCurrentBalance` is not exported yet.

- [ ] **Step 3: Write the implementation**

Modify `functions/src/reports.js` — add the import and the two new exports:

````js
const { onDocumentWritten } = require('firebase-functions/v2/firestore')
```//  (add alongside the existing `onCall, HttpsError` import from `firebase-functions/v2/https`)

```js
/**
 * recomputeCurrentBalance (SRS §6, pinned at e8ca367): re-derives
 * `tenancies/{tenancyId}.currentBalance` from scratch — the tenancy's most
 * recent SIGNED report's `finalTotal − amountPaid`. NEVER a sum across
 * reports: a signed report's own `previousMonthArrears`/`previousMonthCredit`
 * already rolled the PRIOR balance forward into its `finalTotal`, so summing
 * every signed report would double-count that history.
 *
 * "Most recent" is by (year, month), sorted IN MEMORY after an equality-only
 * fetch (tenancyId == X AND status == 'signed') — deliberately NOT a
 * Firestore orderBy, so no composite index is needed (plan Decision 3). At
 * this project's scale, a tenancy has at most a handful of signed reports.
 *
 * Always a full re-derivation, never an increment/decrement — naturally
 * idempotent under onDocumentWritten's at-least-once delivery (plan
 * Decision 2).
 */
async function recomputeCurrentBalance(tenancyId) {
  const db = getFirestore()
  const snap = await db
    .collection('monthlyReports')
    .where('tenancyId', '==', tenancyId)
    .where('status', '==', 'signed')
    .get()

  if (snap.empty) {
    await db.collection('tenancies').doc(tenancyId).update({ currentBalance: 0 })
    return
  }

  const mostRecent = snap.docs
    .map((doc) => doc.data())
    .sort((a, b) => b.year - a.year || b.month - a.month)[0]

  const currentBalance = (mostRecent.finalTotal ?? 0) - (mostRecent.amountPaid ?? 0)
  await db.collection('tenancies').doc(tenancyId).update({ currentBalance })
}

/**
 * onReportWrite (SRS §7.2, NFR-PERF-04). The FIRST Firestore trigger in this
 * codebase (every other Cloud Function so far is an onCall). Fires on every
 * write to monthlyReports/{reportId} but SKIPS the recompute unless the
 * write is status-relevant (plan Decision 4) — a plain draft save can never
 * change "the most recent signed report," so recomputing on it would be
 * correct but wasted cost. Deliberately does NOT send email — report
 * notifications are exclusively on-demand via sendReportNotification
 * (FR-REP-06/07a, sub-stage 6), a scope this function was explicitly
 * corrected to stay out of at b5bfff7.
 */
async function onReportWriteHandler(event) {
  const after = event.data?.after?.exists ? event.data.after.data() : null
  const before = event.data?.before?.exists ? event.data.before.data() : null

  const isStatusRelevant = after?.status === 'signed' || before?.status === 'signed'
  if (!isStatusRelevant) return

  const tenancyId = after?.tenancyId ?? before?.tenancyId
  if (!tenancyId) return

  await recomputeCurrentBalance(tenancyId)
}

const onReportWrite = onDocumentWritten('monthlyReports/{reportId}', onReportWriteHandler)
````

Modify `functions/src/reports.js`'s `module.exports`:

```js
module.exports = {
  signReport,
  unlockReport,
  signReportHandler,
  unlockReportHandler,
  signReportCore,
  unlockReportCore,
  onReportWrite,
  onReportWriteHandler,
  recomputeCurrentBalance,
}
```

Modify `functions/index.js`:

```js
const { signReport, unlockReport, onReportWrite } = require('./src/reports')
// ...
exports.onReportWrite = onReportWrite
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test:emulator`
Expected: PASS — all `recomputeCurrentBalance` cases, both anti-vacuity cases (sum-vs-most-recent, write-order-vs-chronological-order), and all three `onReportWriteHandler` skip-guard cases.

- [ ] **Step 5: Manual validation — prove the DEPLOYED trigger actually fires**

Everything above calls `recomputeCurrentBalance`/`onReportWriteHandler` directly, as plain functions. `test:emulator` (`functions/package.json`) runs `firebase emulators:exec --only auth,firestore,storage` — it never starts the **functions** emulator, so `onReportWrite`'s real registration (`onDocumentWritten('monthlyReports/{reportId}', ...)`) is never exercised by any automated test in this plan. This step is the one place that gap gets closed, manually, before the gate:

1. Start the full suite including functions: `firebase emulators:start` (from repo root — no `--only` filter, so `functions` loads too).
2. In the app (or directly via the Emulator UI's Firestore tab), open a SIGNED report that has an unpaid `finalTotal`, mark a partial payment through `PaymentSection` (this exists starting Task 5 — if running this validation right after Task 1 alone, instead hand-edit the report doc's `amountPaid` field directly in the Emulator UI's Firestore tab and save).
3. In the Emulator UI's Firestore tab, open `tenancies/{tenancyId}` and confirm `currentBalance` changed to the new `finalTotal − amountPaid` — WITHOUT anything in the app or a test having called `recomputeCurrentBalance` directly. If it didn't change, check the Emulator UI's Functions logs tab for `onReportWrite` — either it didn't fire (registration issue) or it threw (check the Firestore rules used for the Admin SDK write path, and that `functions/index.js` actually exports `onReportWrite`).

Record the pass/fail of this step when reporting Task 1 back for approval — "unit tests green" alone does not establish the trigger fires; this step does.

- [ ] **Step 6: Commit**

```bash
git add functions/src/reports.js functions/index.js functions/test/reports.test.js
git commit -m "feat: add onReportWrite trigger, live currentBalance (SRS §6)"
```

---

## Task 2: Live FR-CON-04 — prove the existing `endTenancy` guard now works end-to-end

**Files:**

- Create: `functions/test/currentBalance.integration.test.js`

**Interfaces:**

- Consumes: `recomputeCurrentBalance` (Task 1, `functions/src/reports.js`), `endTenancyCore` (already exported from `functions/src/endTenancy.js`).
- Produces: nothing — this is a leaf, test-only task. No source file changes.

**Confirmation (per the brief's explicit ask):** `functions/src/endTenancy.js:74` already reads `if (tenancyData.currentBalance > 0)` — exactly the pinned FR-CON-04 semantics ("credit or 0 does NOT block"). This line has not changed since M3 and does not need to. What changes here is that `currentBalance` is, for the first time, a value the system itself computed from a real signed report — Task 1's `recomputeCurrentBalance` — rather than a hand-seeded test fixture.

- [ ] **Step 1: Write the failing tests**

Create `functions/test/currentBalance.integration.test.js`:

```js
import { beforeEach, describe, expect, it } from 'vitest'
import { getFirestore } from 'firebase-admin/firestore'
import { recomputeCurrentBalance } from '../src/reports.js'
import { endTenancyCore } from '../src/endTenancy.js'

// Proves FR-CON-04 end-to-end for the first time: endTenancy.js's arrears
// guard (currentBalance > 0, unchanged since M3) now reacts to a currentBalance
// the SYSTEM computed via recomputeCurrentBalance, not a hand-seeded fixture.

const PROJECT_ID = 'tenants-manager-2026'
const db = getFirestore()

const PROPERTY = {
  name: 'Apartament Centru',
  address: {
    street: 'Str. Memorandumului',
    number: '4',
    city: 'Cluj-Napoca',
    county: 'Cluj',
    postalCode: '400114',
  },
  ownerId: 'admin-uid',
  status: 'occupied',
  archived: false,
  services: [],
}
const USER = {
  name: 'Ion Popescu',
  email: 'ion@example.com',
  cnp: '1900101123456',
  preferredLanguage: 'ro',
  status: 'active',
}

function tenancy(overrides = {}) {
  return {
    userId: 'user-1',
    ownerId: 'admin-uid',
    propertyId: 'prop-1',
    tenantName: 'Ion Popescu',
    property: { name: PROPERTY.name, address: PROPERTY.address },
    startDate: '2026-01-01',
    endDate: '2027-01-01',
    monthlyRent: 2000,
    dueDay: 5,
    reportReminderDaysBefore: 3,
    currentBalance: 0,
    status: 'active',
    attachedDocuments: [],
    ...overrides,
  }
}

function report(overrides = {}) {
  return {
    ownerId: 'admin-uid',
    propertyId: 'prop-1',
    tenancyId: 'tenancy-1',
    userId: 'user-1',
    month: 7,
    year: 2026,
    status: 'signed',
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

beforeEach(async () => {
  await clearEmulators()
  await db.collection('properties').doc('prop-1').set(PROPERTY)
  await db.collection('users').doc('user-1').set(USER)
  await db.collection('tenancies').doc('tenancy-1').set(tenancy())
})

describe('FR-CON-04, live: a signed report with arrears blocks termination', () => {
  it('blocks endTenancy after a signed report with a partial payment', async () => {
    await db
      .collection('monthlyReports')
      .doc('report-1')
      .set(report({ finalTotal: 1500, amountPaid: 1000 }))
    await recomputeCurrentBalance('tenancy-1')

    await expect(
      endTenancyCore('tenancy-1', 'admin-uid'),
    ).rejects.toMatchObject({
      code: 'failed-precondition',
      details: { reason: 'arrears', currentBalance: 500 },
    })

    const tenancySnap = await db.collection('tenancies').doc('tenancy-1').get()
    expect(tenancySnap.data().status).toBe('active') // unchanged — termination did not go through
  })
})

describe('FR-CON-04, live: fully paid / credit / never-signed do NOT block termination', () => {
  it('permits endTenancy once fully paid (currentBalance == 0)', async () => {
    await db
      .collection('monthlyReports')
      .doc('report-1')
      .set(report({ finalTotal: 1500, amountPaid: 1500 }))
    await recomputeCurrentBalance('tenancy-1')

    const result = await endTenancyCore('tenancy-1', 'admin-uid')
    expect(result.tenancyId).toBe('tenancy-1')
  })

  it('permits endTenancy on an overpayment (currentBalance negative — a credit)', async () => {
    await db
      .collection('monthlyReports')
      .doc('report-1')
      .set(report({ finalTotal: 1500, amountPaid: 1800 }))
    await recomputeCurrentBalance('tenancy-1')

    const result = await endTenancyCore('tenancy-1', 'admin-uid')
    expect(result.tenancyId).toBe('tenancy-1')
  })

  it('permits endTenancy when no report has EVER been signed (currentBalance stays 0)', async () => {
    // No monthlyReports document at all — currentBalance is whatever kyc.js
    // seeded it as (0), never touched by recomputeCurrentBalance.
    const result = await endTenancyCore('tenancy-1', 'admin-uid')
    expect(result.tenancyId).toBe('tenancy-1')
  })
})
```

- [ ] **Step 2: Run the tests to verify they pass**

Run (from `functions/`): `npm run test:emulator`
Expected: PASS. (This task adds no source code — if any of these fail, Task 1's `recomputeCurrentBalance` or the pre-existing `endTenancy.js:74` guard has a bug; STOP and investigate before continuing, do not "fix" by editing this test's expectations.)

- [ ] **Step 3: Commit**

```bash
git add functions/test/currentBalance.integration.test.js
git commit -m "test: prove FR-CON-04 blocks/allows termination on live currentBalance"
```

---

## Task 3: `schema.js` — carry-forward FREEZE gate, `paymentSchema`, `derivePaymentStatus`

**Files:**

- Modify: `web/src/features/reports/schema.js`
- Modify: `web/tests/reports.schema.test.js`

**Interfaces:**

- Produces: `derivePaymentStatus(finalTotal, amountPaid)` → `'paid' | 'partial' | 'unpaid'`; `paymentSchema` (Zod object: `amountPaid`, `paymentMethod`, `paymentDate`). `buildInitialValues` keeps its existing signature — `tenancy` (already carries `currentBalance`, confirmed at `properties/hooks.js:206-223`'s `useActiveTenancyForProperty`, no new hook/prop needed) is now READ for the carry-forward gate.
- Consumed by: Task 4 (`derivePaymentStatus`, `paymentSchema` — via `PaymentSection`), Task 6 (`buildInitialValues`'s new behavior, transparently — `MonthlyReportPage` already calls it with `tenancy` in scope).

- [ ] **Step 1: Write the failing tests**

Add to `web/tests/reports.schema.test.js`:

```js
import { derivePaymentStatus } from '@/features/reports/schema'

describe('derivePaymentStatus (FR-PAY-01/02/05)', () => {
  it('is "unpaid" when nothing has been paid', () => {
    expect(derivePaymentStatus(1500, 0)).toBe('unpaid')
  })

  it('is "partial" for a payment less than finalTotal', () => {
    expect(derivePaymentStatus(1500, 1000)).toBe('partial')
  })

  it('is "paid" when the payment exactly equals finalTotal', () => {
    expect(derivePaymentStatus(1500, 1500)).toBe('paid')
  })

  it('is "paid" (not a fourth state) on overpayment — the excess is a credit, not a status of its own', () => {
    expect(derivePaymentStatus(1500, 1800)).toBe('paid')
  })
})

describe('buildInitialValues — carry-forward arrears/credit (SRS §6, pinned at e8ca367)', () => {
  const property = { services: [] }
  const tenancy = { monthlyRent: 1500, dueDay: 5 }

  it('a DRAFT mirrors a POSITIVE tenancy.currentBalance as previousMonthArrears', () => {
    const values = buildInitialValues({
      tenancy: { ...tenancy, currentBalance: 500 },
      property,
      month: 7,
      year: 2026,
      existingReport: { status: 'draft', dueDate: '2026-07-05' },
    })

    expect(values.previousMonthArrears).toBe(500)
    expect(values.previousMonthCredit).toBe(0)
  })

  it('a DRAFT mirrors a NEGATIVE tenancy.currentBalance as previousMonthCredit', () => {
    const values = buildInitialValues({
      tenancy: { ...tenancy, currentBalance: -300 },
      property,
      month: 7,
      year: 2026,
      existingReport: { status: 'draft', dueDate: '2026-07-05' },
    })

    expect(values.previousMonthArrears).toBe(0)
    expect(values.previousMonthCredit).toBe(300)
  })

  it('a brand NEW draft (no existingReport) also mirrors tenancy.currentBalance', () => {
    const values = buildInitialValues({
      tenancy: { ...tenancy, currentBalance: 500 },
      property,
      month: 7,
      year: 2026,
      existingReport: null,
    })

    expect(values.previousMonthArrears).toBe(500)
  })

  it('zero balance mirrors as both fields at 0', () => {
    const values = buildInitialValues({
      tenancy: { ...tenancy, currentBalance: 0 },
      property,
      month: 7,
      year: 2026,
      existingReport: { status: 'draft', dueDate: '2026-07-05' },
    })

    expect(values.previousMonthArrears).toBe(0)
    expect(values.previousMonthCredit).toBe(0)
  })

  it('a fresh draft with a positive currentBalance includes it in finalTotal, not just previousMonthArrears', () => {
    // Discriminates against the bug where previousMonthArrears/Credit are
    // computed for display but never fed into calculateTotal(base) — see
    // the ordering note in Task 3's implementation step.
    const values = buildInitialValues({
      tenancy: { ...tenancy, currentBalance: 500 },
      property,
      month: 7,
      year: 2026,
      existingReport: null,
    })

    expect(values.previousMonthArrears).toBe(500)
    expect(values.finalTotal).toBe(2000) // rent 1500 + arrears 500
  })

  it('FREEZE: a SIGNED report keeps its OWN saved previousMonthArrears/Credit, ignoring tenancy.currentBalance entirely', () => {
    const values = buildInitialValues({
      // The tenancy's balance has since moved on (e.g. a later report changed it) —
      // must NOT leak into this already-signed report's frozen carry-forward.
      tenancy: { ...tenancy, currentBalance: 9999 },
      property,
      month: 7,
      year: 2026,
      existingReport: {
        status: 'signed',
        previousMonthArrears: 500,
        previousMonthCredit: 0,
        dueDate: '2026-07-05',
      },
    })

    expect(values.previousMonthArrears).toBe(500)
    expect(values.previousMonthCredit).toBe(0)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run (from `web/`): `npm run test:run`
Expected: FAIL — `derivePaymentStatus` doesn't exist; `buildInitialValues` still carries over `existingReport.previousMonthArrears` (or 0) regardless of `status`/`tenancy.currentBalance`.

- [ ] **Step 3: Implement**

Modify `web/src/features/reports/schema.js` — add near `calculateTotal`:

```js
/**
 * paymentStatus (FR-PAY-01/02/05, SRS §6): a pure function of finalTotal vs.
 * amountPaid, computed client-side before every payment write — 'paid'
 * covers BOTH an exact match and an overpayment (the excess becomes credit
 * via currentBalance going negative — FR-PAY-05 — it is not a distinct
 * paymentStatus of its own).
 */
export function derivePaymentStatus(finalTotal, amountPaid) {
  const paid = Number(amountPaid) || 0
  const total = Number(finalTotal) || 0
  if (paid >= total) return 'paid'
  if (paid > 0) return 'partial'
  return 'unpaid'
}

/**
 * The payment mini-form's schema (FR-PAY-01). Presence-only (NFR-VAL-01) —
 * no minimum-amount or date-format validation.
 */
export const paymentSchema = z.object({
  amountPaid: amountField(),
  paymentMethod: z.enum(['cash', 'bank_transfer', 'other'], {
    error: REQUIRED,
  }),
  paymentDate: required(),
})
```

**Important — ordering constraint:** `finalTotal` (line 217, unchanged) is computed as `existingReport?.finalTotal ?? calculateTotal(base)`, and `calculateTotal` (line 98) reads `values.previousMonthArrears`/`values.previousMonthCredit` directly off whatever object it's given. That means `previousMonthArrears`/`previousMonthCredit` MUST still be present ON `base` itself when `calculateTotal(base)` runs for a fresh draft — computing them separately and only spreading them into the FINAL returned object (after `finalTotal` is already computed) would silently drop them from the total. A fresh draft on a tenancy with `currentBalance: 500` would then show `previousMonthArrears: 500` in the arrears field but a `finalTotal` that never added it in.

First, hoist the existing inline `existingReport?.status === 'signed'` check (currently only used once, for `serviceCosts`) into a single named `isSignedSnapshot` at the top of the function, and compute the two carry-forward values right after it:

```js
const isSignedSnapshot = existingReport?.status === 'signed'
const currentBalance = tenancy?.currentBalance ?? 0
// FREEZE (SRS §6, pinned at e8ca367): a SIGNED report's carry-forward
// values are locked at whatever they were when it was signed — they must
// NOT react to the tenancy's currentBalance moving on afterward. A DRAFT
// mirrors currentBalance LIVE: positive → arrears, negative → credit
// (never both at once). Same snapshot-at-signing discipline as
// `serviceCosts` below (FR-PROP-08).
const previousMonthArrears = isSignedSnapshot
  ? (existingReport.previousMonthArrears ?? 0)
  : Math.max(currentBalance, 0)
const previousMonthCredit = isSignedSnapshot
  ? (existingReport.previousMonthCredit ?? 0)
  : Math.max(-currentBalance, 0)
```

Replace the `serviceCosts` block's own inline check (`existingReport?.status === 'signed'`, currently repeated at its own `? :`) with a reference to this same `isSignedSnapshot` — so there is exactly ONE `=== 'signed'` check in the whole function, not two independent ones that could drift.

Then, inside the `base` ternary, replace the two `previousMonthArrears`/`previousMonthCredit` lines in BOTH branches (`existingReport.previousMonthArrears ?? 0` in the reopen branch, hardcoded `0` in the fresh branch) with the pre-computed consts — keep them ON `base` so `calculateTotal(base)` still sees them:

```js
  const base = existingReport
    ? {
        // ...rent, maintenance, serviceCosts, otherExpenses unchanged...
        previousMonthArrears,
        previousMonthCredit,
        dueDate: /* unchanged */,
      }
    : {
        // ...rent, maintenance, serviceCosts, otherExpenses unchanged...
        previousMonthArrears,
        previousMonthCredit,
        dueDate: /* unchanged */,
      }

  const finalTotal = existingReport?.finalTotal ?? calculateTotal(base)

  return { ...base, finalTotal }
```

The final `return` statement itself does NOT change — `base` already carries the two fields, so `{ ...base, finalTotal }` is correct as it already was. Only the two lines inside each branch change (from a `?? 0`/hardcoded literal to the shared const), and `finalTotal`'s line is untouched.

The discriminating test for exactly this class of bug (`finalTotal` silently excluding the carried-forward arrears) is already included in Step 1's test block above — "a fresh draft with a positive currentBalance includes it in finalTotal, not just previousMonthArrears".

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test:run`
Expected: PASS — all new tests, plus every pre-existing `reports.schema.test.js` case. In particular, re-verify the M4 sub-stage 4 test "editing an existing draft: uses the SAVED values, not blank ones" (`web/tests/reports.schema.test.js`, `previousMonthArrears: 0, previousMonthCredit: 0` in its `existingReport` fixture, no `tenancy.currentBalance` override) still passes — it should, since a `tenancy` object without `currentBalance` reads as `0` via the `?? 0` fallback, same as before.

- [ ] **Step 5: Commit**

```bash
git add web/src/features/reports/schema.js web/tests/reports.schema.test.js
git commit -m "feat: carry-forward arrears/credit on draft, freeze on sign; add payment schema"
```

---

## Task 4: `useMarkPayment` / `useCancelPayment`

**Files:**

- Modify: `web/src/features/reports/hooks.js`
- Modify: `web/tests/reports.hooks.test.jsx`

**Interfaces:**

- Produces: `useMarkPayment()` → `{ mutateAsync({ id, values }) }` where `values` is `{ amountPaid, paymentMethod, paymentDate }` (from the `paymentSchema`-validated form); `useCancelPayment()` → `{ mutateAsync({ id }) }`. Both invalidate `reportKeys.detail(id)` AND `['tenancies']` (broad partial-key invalidation — covers `useActiveTenancyForProperty`, `useActiveTenancies`, `useUserTenancies`, so the tenant list's balance column and the NEXT month's draft carry-forward both see the fresh `currentBalance` on their next read).
- Consumed by: Task 5 (`PaymentSection`).

- [ ] **Step 1: Write the failing tests**

Add to `web/tests/reports.hooks.test.jsx`:

```js
import { useCancelPayment, useMarkPayment } from '@/features/reports/hooks'

describe('useMarkPayment (FR-PAY-01/02/05)', () => {
  it('writes ONLY the four payment fields + updatedAt via updateDoc — never status/signedAt', async () => {
    const { result } = await renderHookWithProviders(() => useMarkPayment())

    await result.current.mutateAsync({
      id: 'p1_2026-07',
      values: {
        amountPaid: 1000,
        paymentMethod: 'cash',
        paymentDate: '2026-07-10',
      },
      finalTotal: 1500,
    })

    expect(updateDoc).toHaveBeenCalledTimes(1)
    expect(setDoc).not.toHaveBeenCalled()
    const payload = updateDoc.mock.calls[0][1]
    expect(payload).toEqual({
      amountPaid: 1000,
      paymentMethod: 'cash',
      paymentDate: '2026-07-10',
      paymentStatus: 'partial',
      updatedAt: { __serverTimestamp: true },
    })
    expect(payload).not.toHaveProperty('status')
    expect(payload).not.toHaveProperty('signedAt')
  })

  it('derives paymentStatus: paid on an exact/overpayment', async () => {
    const { result } = await renderHookWithProviders(() => useMarkPayment())

    await result.current.mutateAsync({
      id: 'p1_2026-07',
      values: {
        amountPaid: 1800,
        paymentMethod: 'bank_transfer',
        paymentDate: '2026-07-10',
      },
      finalTotal: 1500,
    })

    expect(updateDoc.mock.calls[0][1].paymentStatus).toBe('paid')
  })

  it('invalidates the report detail AND the tenancies queries on success', async () => {
    const { result, queryClient } = await renderHookWithProviders(() =>
      useMarkPayment(),
    )
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')

    await result.current.mutateAsync({
      id: 'p1_2026-07',
      values: {
        amountPaid: 1000,
        paymentMethod: 'cash',
        paymentDate: '2026-07-10',
      },
      finalTotal: 1500,
    })

    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ['monthlyReports', 'detail', 'p1_2026-07'],
    })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['tenancies'] })
  })
})

describe('useCancelPayment (FR-PAY-06)', () => {
  it('resets all four payment fields to null/unpaid via updateDoc, using null (not undefined) so stripUndefinedDeep cannot silently skip clearing them', async () => {
    const { result } = await renderHookWithProviders(() => useCancelPayment())

    await result.current.mutateAsync({ id: 'p1_2026-07' })

    expect(updateDoc).toHaveBeenCalledTimes(1)
    const payload = updateDoc.mock.calls[0][1]
    expect(payload).toEqual({
      amountPaid: null,
      paymentMethod: null,
      paymentDate: null,
      paymentStatus: 'unpaid',
      updatedAt: { __serverTimestamp: true },
    })
  })

  it('invalidates the report detail AND the tenancies queries on success', async () => {
    const { result, queryClient } = await renderHookWithProviders(() =>
      useCancelPayment(),
    )
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')

    await result.current.mutateAsync({ id: 'p1_2026-07' })

    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ['monthlyReports', 'detail', 'p1_2026-07'],
    })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['tenancies'] })
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:run`
Expected: FAIL — `useMarkPayment`/`useCancelPayment` not exported yet.

- [ ] **Step 3: Implement**

Modify `web/src/features/reports/hooks.js` — add near `useSaveReportDraft` (import `derivePaymentStatus` from `./schema`):

```js
import { derivePaymentStatus } from './schema'
```

```js
// ─────────────────────────── useMarkPayment ──────────────────────
/**
 * Records/corrects a payment on a SIGNED report (FR-PAY-01/02/05/06) via a
 * plain `updateDoc` — NOT a callable (plan Decision 1, M4 sub-stage 5): the
 * admin already has full write access to `monthlyReports`, and there is no
 * cross-document transaction or precondition here that only a trusted
 * server could enforce. The payload touches ONLY the four payment fields —
 * `status`/`signedAt` are never in it, so this can never de-sign a report
 * (same discipline as `useSaveReportDraft`'s re-save path, M4 sub-stage 4).
 * `onReportWrite` (functions/src/reports.js) reacts to this write and
 * recomputes `tenancies.currentBalance` — this hook does not touch the
 * tenancy document directly, it just invalidates the cached read of it.
 */
export function useMarkPayment() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, values, finalTotal }) =>
      updateDoc(
        reportRef(id),
        stripUndefinedDeep({
          amountPaid: values.amountPaid,
          paymentMethod: values.paymentMethod,
          paymentDate: values.paymentDate,
          paymentStatus: derivePaymentStatus(finalTotal, values.amountPaid),
          updatedAt: serverTimestamp(),
        }),
      ),
    onSuccess: (_result, { id }) => {
      queryClient.invalidateQueries({ queryKey: reportKeys.detail(id) })
      queryClient.invalidateQueries({ queryKey: ['tenancies'] })
    },
  })
}

// ─────────────────────────── useCancelPayment ────────────────────
/**
 * Clears a payment back to unpaid (FR-PAY-06). Uses `null`, NOT `undefined`,
 * for the three payment fields — `updateDoc` only touches keys present in
 * its payload, and `stripUndefinedDeep` (CLAUDE.md §7) REMOVES `undefined`
 * keys before the write, so an `undefined` "clear" value here would silently
 * leave the OLD payment data untouched in Firestore instead of clearing it.
 * `null` survives `stripUndefinedDeep` and is written as an explicit clear.
 */
export function useCancelPayment() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id }) =>
      updateDoc(reportRef(id), {
        amountPaid: null,
        paymentMethod: null,
        paymentDate: null,
        paymentStatus: 'unpaid',
        updatedAt: serverTimestamp(),
      }),
    onSuccess: (_result, { id }) => {
      queryClient.invalidateQueries({ queryKey: reportKeys.detail(id) })
      queryClient.invalidateQueries({ queryKey: ['tenancies'] })
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
git commit -m "feat: add useMarkPayment/useCancelPayment hooks (FR-PAY-01/02/05/06)"
```

---

## Task 5: `PaymentSection` component

**Files:**

- Create: `web/src/features/reports/components/PaymentSection.jsx`
- Create: `web/tests/reports.paymentSection.test.jsx`
- Modify: `web/src/lib/i18n/locales/ro.json`, `web/src/lib/i18n/locales/en.json`

**Interfaces:**

- Consumes: `useMarkPayment`/`useCancelPayment` (Task 4), `paymentSchema` (Task 3), `ConfirmDialog` (`@/components/shared/ConfirmDialog.jsx`, unmodified).
- Produces: `PaymentSection({ report })` — `report` needs `id`, `finalTotal`, `amountPaid`, `paymentMethod`, `paymentDate`, `paymentStatus`. Consumed by Task 6.

### 5.1 — i18n strings

- [ ] **Step 1: Add strings**

`web/src/lib/i18n/locales/ro.json`, inside `reports` (after the `unlock` block added in M4 sub-stage 4):

```json
    "payment": {
      "title": "Plată",
      "amountPaid": "Sumă achitată",
      "method": "Metodă",
      "methodCash": "Numerar",
      "methodBankTransfer": "Transfer bancar",
      "methodOther": "Altă metodă",
      "date": "Data plății",
      "markButton": "Marchează plata",
      "cancelButton": "Anulează plata",
      "cancelConfirmTitle": "Anulează plata",
      "cancelConfirmBody": "Plata înregistrată este ștearsă, iar raportul redevine neplătit.",
      "cancelConfirmButton": "Anulează",
      "statusPaid": "Achitat",
      "statusPartial": "Parțial achitat",
      "statusUnpaid": "Neachitat",
      "creditNotice": "Suprasumă de {{amount}} — apare drept credit pe raportul lunii următoare.",
      "markError": "Plata nu a putut fi înregistrată. Încearcă din nou.",
      "cancelError": "Plata nu a putut fi anulată. Încearcă din nou."
    }
```

`web/src/lib/i18n/locales/en.json`, same position:

```json
    "payment": {
      "title": "Payment",
      "amountPaid": "Amount paid",
      "method": "Method",
      "methodCash": "Cash",
      "methodBankTransfer": "Bank transfer",
      "methodOther": "Other method",
      "date": "Payment date",
      "markButton": "Mark payment",
      "cancelButton": "Cancel payment",
      "cancelConfirmTitle": "Cancel payment",
      "cancelConfirmBody": "The recorded payment is cleared and the report becomes unpaid again.",
      "cancelConfirmButton": "Cancel payment",
      "statusPaid": "Paid",
      "statusPartial": "Partially paid",
      "statusUnpaid": "Unpaid",
      "creditNotice": "Overpaid by {{amount}} — appears as credit on next month's report.",
      "markError": "The payment could not be recorded. Please try again.",
      "cancelError": "The payment could not be cancelled. Please try again."
    }
```

**Note on the raw `<select>` below:** checked before writing this — there is no shadcn/ui `Select` component anywhere in `web/src/components/ui/` yet, and the only existing dropdown in the codebase (`web/src/features/onboarding/components/StepContract.jsx:145-163`) is itself a hand-styled raw `<select>`. `paymentMethod`'s `<select>` here follows that same existing convention rather than introducing a new one — not a CLAUDE.md §4 stack deviation.

### 5.2 — the component

- [ ] **Step 2: Write the failing tests**

Create `web/tests/reports.paymentSection.test.jsx`:

```js
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from './renderWithProviders'
import { PaymentSection } from '@/features/reports/components/PaymentSection'
import { useCancelPayment, useMarkPayment } from '@/features/reports/hooks'

vi.mock('@/features/reports/hooks', () => ({
  useMarkPayment: vi.fn(),
  useCancelPayment: vi.fn(),
}))

const markMutateAsync = vi.fn()
const cancelMutateAsync = vi.fn()

const UNPAID_REPORT = {
  id: 'r1',
  finalTotal: 1500,
  amountPaid: null,
  paymentMethod: null,
  paymentDate: null,
  paymentStatus: 'unpaid',
}

beforeEach(() => {
  vi.clearAllMocks()
  markMutateAsync.mockResolvedValue({})
  cancelMutateAsync.mockResolvedValue({})
  useMarkPayment.mockReturnValue({
    mutateAsync: markMutateAsync,
    isPending: false,
  })
  useCancelPayment.mockReturnValue({
    mutateAsync: cancelMutateAsync,
    isPending: false,
  })
})

describe('PaymentSection — marking a payment', () => {
  it('submits amountPaid/paymentMethod/paymentDate + finalTotal to useMarkPayment', async () => {
    const user = userEvent.setup()
    await renderWithProviders(<PaymentSection report={UNPAID_REPORT} />)

    const amountInput = screen.getByLabelText('Sumă achitată')
    await user.clear(amountInput) // default is 0 — clear before typing, or '1000' appends onto it
    await user.type(amountInput, '1000')
    await user.selectOptions(screen.getByLabelText('Metodă'), 'cash')
    const dateInput = screen.getByLabelText('Data plății')
    await user.clear(dateInput)
    await user.type(dateInput, '2026-07-10')
    await user.click(screen.getByText('Marchează plata'))

    expect(markMutateAsync).toHaveBeenCalledWith({
      id: 'r1',
      values: {
        amountPaid: 1000,
        paymentMethod: 'cash',
        paymentDate: '2026-07-10',
      },
      finalTotal: 1500,
    })
  })

  it('pre-fills the form from an EXISTING payment (correction, FR-PAY-06)', async () => {
    await renderWithProviders(
      <PaymentSection
        report={{
          ...UNPAID_REPORT,
          amountPaid: 1000,
          paymentMethod: 'cash',
          paymentDate: '2026-07-10',
          paymentStatus: 'partial',
        }}
      />,
    )

    expect(screen.getByLabelText('Sumă achitată')).toHaveValue(1000)
    expect(screen.getByDisplayValue('2026-07-10')).toBeVisible()
  })

  it('shows the credit notice on an overpayment', async () => {
    await renderWithProviders(
      <PaymentSection
        report={{
          ...UNPAID_REPORT,
          amountPaid: 1800,
          paymentMethod: 'cash',
          paymentDate: '2026-07-10',
          paymentStatus: 'paid',
        }}
      />,
    )

    expect(await screen.findByText(/apare drept credit/)).toBeVisible()
  })

  it('does NOT show the credit notice when paid exactly / partially / unpaid', async () => {
    await renderWithProviders(<PaymentSection report={UNPAID_REPORT} />)
    expect(screen.queryByText(/apare drept credit/)).toBeNull()
  })
})

describe('PaymentSection — reflects fresh data after a mutation (no stale form state)', () => {
  it('re-syncs the amount input when the report prop changes (e.g. after a mark/cancel refetch)', async () => {
    const { rerender } = await renderWithProviders(
      <PaymentSection report={UNPAID_REPORT} />,
    )
    expect(screen.getByLabelText('Sumă achitată')).toHaveValue(0)

    // Simulates the invalidateQueries-driven refetch after useMarkPayment
    // resolves — a NEW report object arrives as a prop; the form must not
    // keep showing the pre-mutation defaultValues from mount.
    rerender(
      <PaymentSection
        report={{
          ...UNPAID_REPORT,
          amountPaid: 1000,
          paymentMethod: 'cash',
          paymentStatus: 'partial',
        }}
      />,
    )

    expect(await screen.findByLabelText('Sumă achitată')).toHaveValue(1000)
  })
})

describe('PaymentSection — cancelling a payment', () => {
  it('confirms then calls useCancelPayment with the report id', async () => {
    const user = userEvent.setup()
    await renderWithProviders(
      <PaymentSection
        report={{
          ...UNPAID_REPORT,
          amountPaid: 1000,
          paymentStatus: 'partial',
        }}
      />,
    )

    await user.click(screen.getByText('Anulează plata'))
    expect(
      screen.getByText(
        'Plata înregistrată este ștearsă, iar raportul redevine neplătit.',
      ),
    ).toBeVisible()
    await user.click(screen.getByText('Anulează'))

    expect(cancelMutateAsync).toHaveBeenCalledWith({ id: 'r1' })
  })
})
```

- [ ] **Step 3: Run to verify it fails**

Run: `npm run test:run`
Expected: FAIL — `PaymentSection` doesn't exist.

- [ ] **Step 4: Implement**

Create `web/src/features/reports/components/PaymentSection.jsx`:

```js
import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { paymentSchema } from '@/features/reports/schema'
import { useCancelPayment, useMarkPayment } from '@/features/reports/hooks'

/**
 * The payment section (SRS §5.3: "After publication — payment section:
 * amount, method, date, 'Mark payment', 'Cancel payment', credit indicator
 * on overpayment"). Rendered by MonthlyReportPage ONLY once the report is
 * signed (M4 sub-stage 5, plan Decision 5) — entirely separate from the
 * cost-line `isLocked`/`disabled` machinery of M4 sub-stage 4; this
 * component never receives or reads that prop.
 *
 * "Mark payment" is an upsert (plan Decision 6): the form is pre-filled from
 * whatever payment already exists (blank if none) and always overwrites —
 * FR-PAY-06's "corrected" is just re-marking with new values.
 */
export function PaymentSection({ report }) {
  const { t } = useTranslation()
  const markPayment = useMarkPayment()
  const cancelPayment = useCancelPayment()
  const [error, setError] = useState(null)
  const [confirmOpen, setConfirmOpen] = useState(false)

  const {
    register,
    handleSubmit,
    watch,
    reset,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(paymentSchema),
    defaultValues: {
      amountPaid: report.amountPaid ?? 0,
      paymentMethod: report.paymentMethod ?? 'cash',
      paymentDate: report.paymentDate ?? '',
    },
  })

  // `useForm`'s defaultValues are read ONCE, at mount — a payment mark/cancel
  // invalidates and refetches `report` (useMarkPayment/useCancelPayment,
  // Task 4), but without this effect the inputs would keep showing whatever
  // was there before the mutation, even though report.paymentStatus (and the
  // Cancel button's visibility, below) already reflect the fresh data. Same
  // reset-on-external-change pattern as MonthlyReportPage's own effect.
  useEffect(() => {
    reset({
      amountPaid: report.amountPaid ?? 0,
      paymentMethod: report.paymentMethod ?? 'cash',
      paymentDate: report.paymentDate ?? '',
    })
  }, [report.amountPaid, report.paymentMethod, report.paymentDate, reset])

  const watchedAmountPaid = watch('amountPaid')
  const isOverpaid = Number(watchedAmountPaid) > Number(report.finalTotal)

  async function handleValid(values) {
    setError(null)
    try {
      await markPayment.mutateAsync({
        id: report.id,
        values,
        finalTotal: report.finalTotal,
      })
    } catch {
      setError('reports.payment.markError')
    }
  }

  async function handleCancel() {
    setError(null)
    try {
      await cancelPayment.mutateAsync({ id: report.id })
      setConfirmOpen(false)
    } catch {
      setError('reports.payment.cancelError')
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border p-4">
      <h2 className="text-sm font-semibold text-foreground">
        {t('reports.payment.title')}
      </h2>

      <form
        onSubmit={handleSubmit(handleValid)}
        noValidate
        className="flex flex-wrap items-end gap-4"
      >
        <div className="flex flex-col gap-1">
          <Label htmlFor="amountPaid">{t('reports.payment.amountPaid')}</Label>
          <Input
            id="amountPaid"
            type="number"
            step="any"
            className="w-32"
            {...register('amountPaid', { valueAsNumber: true })}
          />
          {errors.amountPaid && (
            <p className="text-xs text-destructive">
              {t(errors.amountPaid.message)}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="paymentMethod">{t('reports.payment.method')}</Label>
          <select
            id="paymentMethod"
            className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm"
            {...register('paymentMethod')}
          >
            <option value="cash">{t('reports.payment.methodCash')}</option>
            <option value="bank_transfer">
              {t('reports.payment.methodBankTransfer')}
            </option>
            <option value="other">{t('reports.payment.methodOther')}</option>
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="paymentDate">{t('reports.payment.date')}</Label>
          <Input id="paymentDate" type="date" {...register('paymentDate')} />
          {errors.paymentDate && (
            <p className="text-xs text-destructive">
              {t(errors.paymentDate.message)}
            </p>
          )}
        </div>

        <Button type="submit" disabled={markPayment.isPending}>
          {t('reports.payment.markButton')}
        </Button>

        {report.paymentStatus !== 'unpaid' && (
          <Button
            type="button"
            variant="outline"
            onClick={() => setConfirmOpen(true)}
          >
            {t('reports.payment.cancelButton')}
          </Button>
        )}
      </form>

      {isOverpaid && (
        <p className="text-sm text-muted-foreground">
          {t('reports.payment.creditNotice', {
            amount: (
              Number(watchedAmountPaid) - Number(report.finalTotal)
            ).toFixed(2),
          })}
        </p>
      )}

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {t(error)}
        </p>
      )}

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        titleKey="reports.payment.cancelConfirmTitle"
        descriptionKey="reports.payment.cancelConfirmBody"
        confirmKey="reports.payment.cancelConfirmButton"
        onConfirm={handleCancel}
        isPending={cancelPayment.isPending}
      />
    </div>
  )
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `npm run test:run`
Expected: PASS for `reports.paymentSection.test.jsx`.

- [ ] **Step 6: Commit**

```bash
git add web/src/features/reports/components/PaymentSection.jsx web/tests/reports.paymentSection.test.jsx web/src/lib/i18n/locales/ro.json web/src/lib/i18n/locales/en.json
git commit -m "feat: add PaymentSection (FR-PAY-01/02/05/06, SRS §5.3)"
```

---

## Task 6: Wire `PaymentSection` into `MonthlyReportPage`

**Files:**

- Modify: `web/src/features/reports/pages/MonthlyReportPage.jsx`
- Modify: `web/tests/reports.page.test.jsx`

**Interfaces:**

- Consumes: `PaymentSection` (Task 5). Reuses the EXISTING `isLocked` constant (M4 sub-stage 4) — read-only, not modified.

- [ ] **Step 1: Write the failing tests**

Add to `web/tests/reports.page.test.jsx`:

```js
describe('MonthlyReportPage — PaymentSection wiring (M4 sub-stage 5)', () => {
  it('renders PaymentSection when the report is signed', async () => {
    mockData({ report: SIGNED_REPORT })
    await renderWithProviders(<MonthlyReportPage />)

    expect(await screen.findByText('Plată')).toBeVisible()
  })

  it('does NOT render PaymentSection on a draft', async () => {
    mockData({ report: REPORT_WITH_RENT_ATTACHMENT })
    await renderWithProviders(<MonthlyReportPage />)

    await screen.findByText('Semnează lista')
    expect(screen.queryByText('Plată')).toBeNull()
  })

  it('does NOT render PaymentSection on a brand new (never-saved) report', async () => {
    mockData()
    await renderWithProviders(<MonthlyReportPage />)

    await screen.findByText('Gas')
    expect(screen.queryByText('Plată')).toBeNull()
  })
})
```

(`SIGNED_REPORT`/`REPORT_WITH_RENT_ATTACHMENT` already exist as fixtures in this file from M4 sub-stage 4 — `SIGNED_REPORT` will need `finalTotal` already present, which it has.)

- [ ] **Step 2: Run to verify it fails**

Run (from `web/`): `npm run test:run`
Expected: FAIL — `PaymentSection` never rendered yet.

- [ ] **Step 3: Implement**

Modify `web/src/features/reports/pages/MonthlyReportPage.jsx`:

```js
import { PaymentSection } from '@/features/reports/components/PaymentSection'
```

Right after the closing `</form>` tag, before the closing `</div>` of the page's outer wrapper:

```js
      </form>

      {isLocked && <PaymentSection report={existingReport} />}
    </div>
```

No other change to this file — `isLocked` is READ here for a second, independent purpose (plan Decision 5); nothing about its existing role (disabling cost-line inputs, hiding Save, guarding `handleValid`) changes.

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test:run`
Expected: PASS — new tests, plus the FULL pre-existing M4 sub-stage 4 suite (nothing about `isLocked`'s existing behavior changed, only a new sibling read of it was added).

- [ ] **Step 5: Commit**

```bash
git add web/src/features/reports/pages/MonthlyReportPage.jsx web/tests/reports.page.test.jsx
git commit -m "feat: render PaymentSection on a signed report (M4 sub-stage 5)"
```

---

## Self-Review

**1. Spec coverage:**

- FR-PAY-01 (mark payment: amount/method/date) → Task 5.
- FR-PAY-02 (partial → arrears) → Task 3 (`derivePaymentStatus`) + Task 1 (`currentBalance` sign) — arrears is the POSITIVE `currentBalance`, carried forward by Task 3's other half (`buildInitialValues`).
- FR-PAY-03 (arrears carried into next report as previousMonthArrears) → Task 3 (`buildInitialValues` carry-forward gate).
- FR-PAY-05 (overpayment → credit, applied next report) → Task 1 (negative `currentBalance`) + Task 3 (`previousMonthCredit` carry-forward) + Task 5 (credit indicator UI).
- FR-PAY-06 (cancel/correct; effects only into future reports per FR-REP-12) → Task 4 (`useCancelPayment`, upsert-shaped `useMarkPayment`) + Task 1 (recompute is naturally "only affects future/draft reports" since signed reports' carry-forward is frozen — Task 3).
- FR-CON-04 (blocked on unpaid arrears, live) → Task 2 (proves the unchanged M3 guard against real data for the first time).
- SRS §6 `currentBalance` formula (pinned `e8ca367`) → Task 1, implemented verbatim (most recent signed, not summed, `finalTotal − amountPaid`, initial 0).
- SRS §6 `previousMonthArrears/Credit` draft-mirrors/freeze-at-sign (pinned `e8ca367`) → Task 3.
- SRS §5.3 payment section (amount/method/date, Mark/Cancel, credit indicator) → Task 5.
- NFR-PERF-04 → Task 1's status-relevant skip (Decision 4) and no-composite-index design (Decision 3).
- Explicitly excluded (FR-PAY-04 reminders, export/shareToken, email) → touched nowhere in this plan.

**2. Placeholder scan:** none found — every step has complete code and exact assertions.

**3. Type/signature consistency:**

- `recomputeCurrentBalance(tenancyId)` — same signature used in Task 1's own tests and Task 2's integration test.
- `derivePaymentStatus(finalTotal, amountPaid)` — used identically in `schema.js` (Task 3), `hooks.js`'s `useMarkPayment` (Task 4), and indirectly verified via `PaymentSection`'s credit-notice condition (Task 5, computed inline as `amountPaid > finalTotal` rather than re-deriving status — consistent since "paid" already covers both exact and over).
- `PaymentSection({ report })` — `report` shape (`id, finalTotal, amountPaid, paymentMethod, paymentDate, paymentStatus`) matches what `MonthlyReportPage` passes (`existingReport`, which already carries all of these once persisted) in Task 6.
- `useMarkPayment().mutateAsync({ id, values, finalTotal })` / `useCancelPayment().mutateAsync({ id })` — signatures match between Task 4's definition, its own tests, and Task 5's `PaymentSection` call sites.
