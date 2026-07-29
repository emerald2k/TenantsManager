# M4 Sub-stage 8 — Report export (PDF/PNG/shareable link) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. This project's own gate discipline (CLAUDE.md §2) overrides the generic skill's per-task commit steps — see "Phases & commit proposal" below. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship FR-REP-07b/07c end to end: `getSharedReport` + `getSharedReportAttachment` (the two public callables pinned in SRS at 5a92763), the public `/r/:shareToken` page, and the admin's export zone on a signed report (copy link / revoke / PDF / PNG).

**Architecture:** Two new public (no-auth) callables in a new file (`functions/src/sharedReport.js`), reusing `parseStoragePath` from `photoMigration.js`. Client side: a shared, purely-presentational `ReportSummaryView` component reused by (a) the public page and (b) the admin's PDF/PNG capture target, so the two surfaces are structurally guaranteed to show the same thing. `shareToken`/`shareTokenRevoked` are written by a plain client `updateDoc` (no new callable), mirroring the `useMarkPayment`/`useCancelPayment` precedent.

**Tech Stack:** Firebase Admin SDK (Storage `bucket.file().download()`), React, TanStack Query, react-i18next, react-router-dom, Tailwind. **PDF/PNG library — NOT YET APPROVED, see "Blocking decision" below** — nothing in `web/package.json` today does this.

## Global Constraints

- **Zero SRS edits** — every requirement here is already pinned (FR-REP-07b/07c, §7.2 rows for `getSharedReport`/`getSharedReportAttachment`, §7.3, §6, §5.1, §5.3, all at commit `5a92763`). If anything below needs an SRS change, STOP and ask — do not improvise.
- **Zero Security Rules changes** — both `firestore.rules:61-63` and `storage.rules`'s `/reports/{reportId}/invoices/` rule already leave anonymous access closed, WITH a comment written specifically for this sub-stage. Quoted verbatim in "Rules — confirmed untouched" below.
- No format validation beyond what's already established; no new Firestore fields beyond `shareToken`/`shareTokenRevoked` (already in the schema since FR-REP-07c was pinned).
- `getDocs`/`getDoc`, never `onSnapshot`.
- `STORAGE_BUCKET` explicit, never inferred (CLAUDE.md §7, the M3 lesson) — the new backend file defines its own local copy, same convention as `kyc.js`/`reports.js`.
- All visible text through i18n (RO/EN).

---

## BLOCKING DECISION — PDF/PNG library (must be resolved before Phase 2 starts)

`web/package.json` has no PDF/canvas dependency today (verified: `grep -n "jspdf\|html2canvas\|pdf\|canvas" web/package.json` → no matches). SRS §7.1 only says `PDF | Client-side` — no library named. Proposal:

**`jsPDF` + `html2canvas`** (recommended). `html2canvas` rasterizes a DOM node to a `<canvas>`; that canvas serves BOTH exports directly — PNG is `canvas.toDataURL('image/png')`, PDF is the same canvas image embedded into a `jsPDF` document. One capture mechanism, one visual source of truth for both formats, well past 1.0 and the standard combo for "turn this DOM tree into a downloadable image/PDF" with no backend round-trip (matches `PDF | Client-side`).

Alternative considered and rejected for now: `@react-pdf/renderer` (declarative PDF-only, produces crisper vector text) — rejected because it does nothing for the PNG requirement, so PNG would still need `html2canvas` anyway, meaning two rendering paths for the two exports instead of one, with the attendant risk of them drifting apart visually.

**I am not adding either without your explicit go-ahead** (CLAUDE.md §4). Phase 1 (the two callables) needs neither — it can be approved and built independently of this decision. Phase 2 needs an answer before Task 8 (export controls) starts.

---

## Decisions already pinned in SRS at 5a92763 (not reopened here)

1. `/r/:shareToken` stays. `getSharedReport` returns the whole report + the property's `name` (context), excluding the tenant's personal data (name, `cnp`).
2. Attachments are shown to anonymous visitors, but their BYTES are served exclusively through `getSharedReportAttachment` (base64) — never a Storage URL. Storage rules stay closed to anonymous requests.
3. `getSharedReportAttachment` verifies the requested reference actually belongs to the report identified by the token — rejects any other path.
4. Revoking `shareToken` invalidates BOTH callables at once.
5. PDF/PNG export is client-side (§7.1).

## New decisions this plan needs to pin (stated explicitly, not silently assumed)

- **Allowlist trimmed from my first draft.** `paymentMethod`/`paymentDate` are dropped — the SRS scope says "payment **status**", not the payment record, and this is a public unauthenticated endpoint where the narrower allowlist is the safer default. `serviceId` is dropped from `serviceCosts` entries — only the snapshotted `name` is ever displayed, `serviceId` is an internal key. Full allowlist below.
- **Attachments are never rasterized into the PDF/PNG or embedded as images anywhere in this sub-stage — name + type only, in every rendering.** Two independent reasons: (a) Firebase Storage download URLs are cross-origin from the app's own origin, and this project has no Storage CORS configuration anywhere (not in SRS, not in the repo) — `html2canvas` reading pixels from an unconfigured cross-origin image produces a **tainted canvas** (blank/broken output, not an error you'd catch in review); (b) FR-REP-07b's PNG wording — "reproduces the table with the cost lines and attachments" — is satisfied by listing each attachment's name next to its cost line, which is what a WhatsApp-shared table needs to communicate ("see attached: electricity_invoice.pdf"), not full-size embedded invoice scans. The public page's own interactive "Download" buttons (proxied through `getSharedReportAttachment`) are the actual way anonymous visitors see attachment bytes — separate from the static summary/capture concern.
- **The capture target for PDF/PNG is a dedicated, purely-presentational component (`ReportSummaryView`), not the live edit form.** The signed report's on-screen DOM is `<Input>` elements (greyed via `disabled`), a `position: sticky` footer, and the attachment upload widgets from `CostLineRow` — `html2canvas` is weakest exactly on that combination (disabled-input rendering, sticky positioning, nested interactive widgets). Building one clean summary view avoids that entirely, and — because the SAME component renders the public `/r/` page — it structurally guarantees the admin's exported PDF/PNG can never show more than what the public link already shows.
- **Unlocking a shared, signed report silently breaks its public link until re-signed — this is a consequence of existing logic, not new code, stated here for explicit sign-off.** `getSharedReport`'s `status == 'signed'` check (already pinned) means: admin unlocks → link returns the generic "unavailable" message → admin re-signs → the SAME token is live again, now serving the new numbers. `shareToken`/`shareTokenRevoked` are never touched by `signReport`/`unlockReport`/`useSaveReportDraft` (their `updateDoc`/transaction payloads don't include those keys), so the token survives the round-trip untouched. If you want unlocking to also revoke the link, say so — as scoped, it does not.
- **Callable response size is safely within the platform ceiling.** `MAX_UPLOAD_SIZE_BYTES` (fileUpload.js:20) is 10 MiB; base64 inflates by ~33%, so a max-size attachment's response body is ~13.3 MB. Cloud Functions 2nd gen (Cloud Run-based) caps non-streaming HTTP responses at **32 MB** ([Cloud Run functions quotas](https://docs.cloud.google.com/functions/quotas)) — `onCall` responses are non-streaming, so this fits with margin. No mitigation needed; noted rather than assumed.
- **No rate-limiting on the two public callables.** Not requested in scope, not added. Stated explicitly so it reads as a deliberate omission, not an oversight.

---

## Allowlist — exactly what `getSharedReport` returns

```js
{
  propertyName: string | null,        // looked up from properties/{propertyId}.name
  month: number,
  year: number,
  rent:        { amount: number, notes: string|null, attachments: [{ name, type, reference }] },
  maintenance: { amount: number, notes: string|null, attachments: [...] },
  serviceCosts:   [{ name: string, amount: number, notes: string|null, attachments: [...] }],
  otherExpenses:  [{ description: string, amount: number, notes: string|null, attachments: [...] }],
  previousMonthArrears: number,
  previousMonthCredit: number,
  calculatedTotal: number,
  finalTotal: number,
  dueDate: string,
  paymentStatus: 'paid' | 'partial' | 'unpaid' | null,
  amountPaid: number | null,
}
```

**Explicitly EXCLUDED, never touched or read:** `ownerId`, `propertyId`, `tenancyId`, `userId`, `status`, `signedAt`, `updatedAt`, `shareToken`, `shareTokenRevoked`, `paymentMethod`, `paymentDate`, `serviceId`. The strongest property in this design: **`getSharedReport` never reads the `users` collection at all** — it cannot leak `name`/`cnp`/`email`/`preferredLanguage` because it never has them in memory, not because a field was filtered out after the fact.

---

## Rules — confirmed untouched (quoted, not paraphrased)

`firestore.rules:61-63`:

```
    // Public (no-auth) access via shareToken does NOT go through this rule —
    // it is served by the getSharedReport Cloud Function (sub-stage 8), which
    // is why there is no "shareToken" branch here.
```

This comment was written FOR this sub-stage, before it started. `storage.rules`'s `/reports/{reportId}/invoices/{fileName}` rule (`allow read: if isAdmin() || (auth != null && isOwningTenantOfSignedReport)`) has no anonymous branch either — an unauthenticated request falls through to the final `allow read, write: if false`. **Neither file is touched by this plan.** Two NEW rules-band tests are added (not required, but they turn "we didn't touch it" into a run assertion — see Task 10) that seed a signed report WITH a live `shareToken` and assert direct anonymous Firestore/Storage access is still denied, proving the rules genuinely don't special-case the token rather than merely never having been asked to.

---

## Reference format — how `getSharedReportAttachment` verifies ownership

Each attachment in the allowlist output carries an opaque `reference` string instead of its real Storage path or URL:

- `rent`/`maintenance` (singular cost lines): `"rent.{attachmentIndex}"` / `"maintenance.{attachmentIndex}"`
- `serviceCosts`/`otherExpenses` (arrays): `"serviceCosts.{lineIndex}.{attachmentIndex}"` / `"otherExpenses.{lineIndex}.{attachmentIndex}"`

`getSharedReportAttachment` re-fetches the report by `shareToken` (fresh read, re-validates the SAME preconditions as `getSharedReport`), then walks the SAME structure using the reference to locate the attachment:

```js
function resolveAttachment(report, reference) {
  if (typeof reference !== 'string') return null
  const parts = reference.split('.')
  const [section] = parts
  if (section === 'rent' || section === 'maintenance') {
    return report[section]?.attachments?.[Number(parts[1])] ?? null
  }
  if (section === 'serviceCosts' || section === 'otherExpenses') {
    return (
      report[section]?.[Number(parts[1])]?.attachments?.[Number(parts[2])] ??
      null
    )
  }
  return null
}
```

**This is the ownership guarantee, structurally, not by validation.** The server NEVER accepts a client-supplied Storage path — only a locator into ITS OWN fresh read of the report identified by the token. A malformed or out-of-range reference (`Number('x')` → `NaN` → `array[NaN]` → `undefined`) simply fails to resolve and returns `not-found`; there is no path-traversal surface to defend against here, so no extra input validation is added beyond the `?? null` fallback — deliberate, not an oversight.

---

## File structure

**Phase 1 — backend:**

- Create: `functions/src/sharedReport.js`
- Create: `functions/test/sharedReport.test.js`
- Modify: `functions/index.js`
- Modify (rules band, optional but recommended — confirm you want it): `web/tests/monthlyReports.rules.test.js`, `web/tests/reportsInvoices.rules.test.js`

**Phase 2 — client (blocked on the PDF/PNG library decision for the export-controls half only):**

- Create: `web/src/components/shared/ReportSummaryView.jsx`
- Create: `web/src/features/sharedReport/hooks.js`
- Create: `web/src/features/sharedReport/utils.js`
- Create: `web/src/features/sharedReport/pages/SharedReportPage.jsx`
- Create: `web/src/features/reports/components/ExportReportControls.jsx`
- Modify: `web/src/features/reports/hooks.js` (add `useShareReport`, `useRevokeShareLink`)
- Modify: `web/src/features/reports/pages/MonthlyReportPage.jsx` (render `ExportReportControls` in the existing action row — `SignReportControl` untouched)
- Modify: `web/src/routes/index.jsx` (swap the `/r/:shareToken` placeholder)
- Modify: `web/src/lib/i18n/locales/ro.json`, `en.json` (new `sharedReport` namespace + `reports.export.*` keys)
- Test: `web/tests/sharedReport.hooks.test.jsx`, `web/tests/sharedReport.page.test.jsx`, `web/tests/reportSummaryView.test.jsx`, `web/tests/reports.exportControls.test.jsx`

**Untouched, confirmed:** `firestore.rules`, `storage.rules` (content), `SRS.md`, `functions/src/reports.js` (signReport/unlockReport/onReportWrite/sendReportNotification), `SignReportControl.jsx`, `functions/src/photoMigration.js` (only imported from, `parseStoragePath` reused as-is).

---

## Phase 1 — Backend

### Task 1: `functions/src/sharedReport.js` — `toPublicReport` + `resolveAttachment` (pure logic, no Firestore/Storage yet)

**Files:** Create `functions/src/sharedReport.js`, Create `functions/test/sharedReport.test.js`

```js
// functions/src/sharedReport.js (top portion)
function attachmentsMeta(attachments, prefix) {
  return (attachments ?? []).map((att, index) => ({
    name: att.name,
    type: att.type,
    reference: `${prefix}.${index}`,
  }))
}

function toPublicReport(report, propertyName) {
  return {
    propertyName: propertyName ?? null,
    month: report.month,
    year: report.year,
    rent: {
      amount: report.rent.amount,
      notes: report.rent.notes ?? null,
      attachments: attachmentsMeta(report.rent.attachments, 'rent'),
    },
    maintenance: {
      amount: report.maintenance.amount,
      notes: report.maintenance.notes ?? null,
      attachments: attachmentsMeta(
        report.maintenance.attachments,
        'maintenance',
      ),
    },
    serviceCosts: (report.serviceCosts ?? []).map((line, i) => ({
      name: line.name,
      amount: line.amount,
      notes: line.notes ?? null,
      attachments: attachmentsMeta(line.attachments, `serviceCosts.${i}`),
    })),
    otherExpenses: (report.otherExpenses ?? []).map((line, i) => ({
      description: line.description,
      amount: line.amount,
      notes: line.notes ?? null,
      attachments: attachmentsMeta(line.attachments, `otherExpenses.${i}`),
    })),
    previousMonthArrears: report.previousMonthArrears ?? 0,
    previousMonthCredit: report.previousMonthCredit ?? 0,
    calculatedTotal: report.calculatedTotal,
    finalTotal: report.finalTotal,
    dueDate: report.dueDate,
    paymentStatus: report.paymentStatus ?? null,
    amountPaid: report.amountPaid ?? null,
  }
}

function resolveAttachment(report, reference) {
  if (typeof reference !== 'string') return null
  const parts = reference.split('.')
  const [section] = parts
  if (section === 'rent' || section === 'maintenance') {
    return report[section]?.attachments?.[Number(parts[1])] ?? null
  }
  if (section === 'serviceCosts' || section === 'otherExpenses') {
    return (
      report[section]?.[Number(parts[1])]?.attachments?.[Number(parts[2])] ??
      null
    )
  }
  return null
}
```

- [ ] **Step 1: Write the failing round-trip test FIRST — this is the test that guards `attachmentsMeta`/`resolveAttachment` staying in sync (drift between them is the actual risk, not any single reject-case):**

```js
// functions/test/sharedReport.test.js
const { toPublicReport, resolveAttachment } = require('../src/sharedReport')

function fullReport() {
  return {
    month: 7,
    year: 2026,
    rent: {
      amount: 1000,
      attachments: [
        { name: 'rent.pdf', type: 'pdf', url: 'https://x/rent.pdf' },
      ],
    },
    maintenance: { amount: 50, attachments: [] },
    serviceCosts: [
      {
        serviceId: 'electricity',
        name: 'Electricity',
        amount: 120,
        attachments: [
          { name: 'e1.jpg', type: 'image', url: 'https://x/e1.jpg' },
        ],
      },
      {
        serviceId: 'water',
        name: 'Water',
        amount: 80,
        attachments: [
          { name: 'w1.jpg', type: 'image', url: 'https://x/w1.jpg' },
          { name: 'w2.pdf', type: 'pdf', url: 'https://x/w2.pdf' },
        ],
      },
    ],
    otherExpenses: [
      {
        description: 'Repair',
        amount: 200,
        attachments: [{ name: 'r.jpg', type: 'image', url: 'https://x/r.jpg' }],
      },
    ],
    calculatedTotal: 1450,
    finalTotal: 1450,
    dueDate: '2026-07-05',
  }
}

describe('toPublicReport / resolveAttachment — round-trip (reference must resolve back to the SAME attachment)', () => {
  it('every reference emitted by toPublicReport resolves via resolveAttachment to the matching stored attachment', () => {
    const report = fullReport()
    const pub = toPublicReport(report, 'Apartament Centru')

    const emitted = [
      ...pub.rent.attachments,
      ...pub.maintenance.attachments,
      ...pub.serviceCosts.flatMap((l) => l.attachments),
      ...pub.otherExpenses.flatMap((l) => l.attachments),
    ]
    expect(emitted).toHaveLength(4) // rent(1) + maintenance(0) + service(1+2) + other(1)

    for (const att of emitted) {
      const resolved = resolveAttachment(report, att.reference)
      expect(resolved).not.toBeNull()
      expect(resolved.name).toBe(att.name)
      expect(resolved.url).toBeDefined() // the REAL stored url, never exposed in `pub`
    }
  })

  it('never emits a url field anywhere in the public shape', () => {
    const pub = toPublicReport(fullReport(), 'X')
    expect(JSON.stringify(pub)).not.toMatch(/https:\/\//)
  })

  it('resolveAttachment rejects a reference from a DIFFERENT report shape (out of range / wrong section)', () => {
    const report = fullReport()
    expect(resolveAttachment(report, 'serviceCosts.9.0')).toBeNull()
    expect(resolveAttachment(report, 'notASection.0')).toBeNull()
    expect(resolveAttachment(report, 'rent.9')).toBeNull()
  })
})
```

- [ ] **Step 2: Run, verify failure** (module doesn't exist): `npm run test:run --prefix functions -- sharedReport.test.js` (adjust to this package's actual test command — check `functions/package.json`).
- [ ] **Step 3: Implement** the two functions above in `functions/src/sharedReport.js`.
- [ ] **Step 4: Run, verify pass.**

### Task 2: `getSharedReportCore` + handler + uniform rejection

**Files:** Modify `functions/src/sharedReport.js`, `functions/test/sharedReport.test.js`

```js
const { getApps, initializeApp } = require('firebase-admin/app')
const { getFirestore } = require('firebase-admin/firestore')
const { getStorage } = require('firebase-admin/storage')
const { onCall, HttpsError } = require('firebase-functions/v2/https')
const { parseStoragePath } = require('./photoMigration')

if (!getApps().length) {
  initializeApp()
}

// Same duplication discipline as kyc.js/reports.js's STORAGE_BUCKET/APP_URL
// local constants (CLAUDE.md §7) — kept hand-identical, not extracted.
const STORAGE_BUCKET =
  process.env.STORAGE_BUCKET || 'tenants-manager-2026.firebasestorage.app'

// Every rejection reason (unknown token, revoked, not yet signed) collapses
// to this SAME message/code — an anonymous caller must never be able to
// distinguish "never existed" from "was revoked" from "not published yet"
// (SRS: neutral message, don't leak why).
const LINK_UNAVAILABLE = 'Link unavailable.'

async function findReportByToken(db, shareToken) {
  const snap = await db
    .collection('monthlyReports')
    .where('shareToken', '==', shareToken)
    .limit(1)
    .get()
  if (snap.empty) return null
  const report = snap.docs[0].data()
  if (report.shareTokenRevoked === true) return null
  if (report.status !== 'signed') return null
  return report
}

async function getSharedReportCore(shareToken) {
  const db = getFirestore()
  const report = await findReportByToken(db, shareToken)
  if (!report) {
    throw new HttpsError('not-found', LINK_UNAVAILABLE)
  }

  const propertySnap = await db
    .collection('properties')
    .doc(report.propertyId)
    .get()
  const propertyName = propertySnap.exists ? propertySnap.data().name : null

  return toPublicReport(report, propertyName)
}

async function getSharedReportHandler(request) {
  const shareToken = request.data?.shareToken
  if (!shareToken) {
    throw new HttpsError('invalid-argument', 'shareToken is required.')
  }
  return getSharedReportCore(shareToken)
}

const getSharedReport = onCall(getSharedReportHandler)
```

**Interfaces produced:** `getSharedReportCore(shareToken): Promise<PublicReport>`, throws `HttpsError('not-found', ...)` uniformly for unknown/revoked/draft. `findReportByToken(db, shareToken)` — shared by Task 3 too.

- [ ] **Step 1: Write failing tests** (real Firestore emulator, same harness as `functions/test/reports.test.js` — `seedReport`-style helper, check that file's exact `beforeAll`/emulator-REST-clear pattern and copy it, do not reinvent):

```js
describe('getSharedReportCore — security (the priority band)', () => {
  it('a valid, non-revoked, SIGNED token returns the public report shape', async () => {
    await seedReport('r1', {
      shareToken: 'tok-valid',
      shareTokenRevoked: false,
      status: 'signed',
    })
    const result = await getSharedReportCore('tok-valid')
    expect(result.finalTotal).toBeDefined()
  })

  it('an unknown token is rejected with not-found', async () => {
    await expect(getSharedReportCore('does-not-exist')).rejects.toMatchObject({
      code: 'not-found',
    })
  })

  it('a REVOKED token is rejected with the SAME not-found (indistinguishable from unknown)', async () => {
    await seedReport('r2', {
      shareToken: 'tok-revoked',
      shareTokenRevoked: true,
      status: 'signed',
    })
    await expect(getSharedReportCore('tok-revoked')).rejects.toMatchObject({
      code: 'not-found',
    })
  })

  it('a DRAFT report (even with a valid token) is rejected with the SAME not-found', async () => {
    await seedReport('r3', {
      shareToken: 'tok-draft',
      shareTokenRevoked: false,
      status: 'draft',
    })
    await expect(getSharedReportCore('tok-draft')).rejects.toMatchObject({
      code: 'not-found',
    })
  })

  it('anti-vacuity: ZERO personal data anywhere in the output — no userId, name, or cnp substring', async () => {
    await seedUser('tenant-1', { name: 'Ion Testescu', cnp: '1234567890123' })
    await seedReport('r4', {
      shareToken: 'tok-personal',
      shareTokenRevoked: false,
      status: 'signed',
      userId: 'tenant-1',
    })
    const result = await getSharedReportCore('tok-personal')
    const serialized = JSON.stringify(result)
    expect(result).not.toHaveProperty('userId')
    expect(result).not.toHaveProperty('ownerId')
    expect(result).not.toHaveProperty('tenancyId')
    expect(serialized).not.toContain('Ion Testescu')
    expect(serialized).not.toContain('1234567890123')
  })

  it('never queries the users collection at all — structural, not filtered', async () => {
    // spies on db.collection to prove 'users' is never touched by getSharedReportCore
  })

  it('includes the property name for context', async () => {
    await seedProperty('prop-1', { name: 'Apartament Centru' })
    await seedReport('r5', {
      shareToken: 'tok-prop',
      shareTokenRevoked: false,
      status: 'signed',
      propertyId: 'prop-1',
    })
    const result = await getSharedReportCore('tok-prop')
    expect(result.propertyName).toBe('Apartament Centru')
  })
})
```

- [ ] **Step 2-4: fail → implement → pass**, same rhythm as Task 1.

### Task 3: `getSharedReportAttachmentCore` + handler — bytes via proxy

**Files:** Modify `functions/src/sharedReport.js`, `functions/test/sharedReport.test.js`

```js
async function getSharedReportAttachmentCore(shareToken, reference) {
  const db = getFirestore()
  const report = await findReportByToken(db, shareToken)
  if (!report) {
    throw new HttpsError('not-found', LINK_UNAVAILABLE)
  }

  const attachment = resolveAttachment(report, reference)
  if (!attachment) {
    throw new HttpsError('not-found', 'Attachment not found.')
  }

  const bucket = getStorage().bucket(STORAGE_BUCKET)
  const path = parseStoragePath(attachment.url)
  const file = bucket.file(path)
  const [bytes] = await file.download()
  const [metadata] = await file.getMetadata()

  return {
    base64: bytes.toString('base64'),
    contentType: metadata.contentType ?? null,
    name: attachment.name,
  }
}

async function getSharedReportAttachmentHandler(request) {
  const shareToken = request.data?.shareToken
  const reference = request.data?.reference
  if (!shareToken || !reference) {
    throw new HttpsError(
      'invalid-argument',
      'shareToken and reference are required.',
    )
  }
  return getSharedReportAttachmentCore(shareToken, reference)
}

const getSharedReportAttachment = onCall(getSharedReportAttachmentHandler)

module.exports = {
  getSharedReport,
  getSharedReportHandler,
  getSharedReportCore,
  getSharedReportAttachment,
  getSharedReportAttachmentHandler,
  getSharedReportAttachmentCore,
  toPublicReport,
  resolveAttachment,
}
```

- [ ] **Step 1: Write failing tests** — real Storage emulator, same pattern as `photoMigration.test.js` (`bucket.file(path).save(Buffer.from(...))` to seed a real object):

```js
describe('getSharedReportAttachmentCore — security', () => {
  it('a valid token + a reference that belongs to the report returns the real bytes', async () => {
    const path = 'reports/r6_2026-07/invoices/invoice.pdf'
    await bucket
      .file(path)
      .save(Buffer.from('hello invoice'), { contentType: 'application/pdf' })
    const url = buildDownloadUrl(bucket.name, path, 'tok')
    await seedReport('r6', {
      shareToken: 'tok-att',
      shareTokenRevoked: false,
      status: 'signed',
      rent: {
        amount: 100,
        attachments: [{ name: 'invoice.pdf', type: 'pdf', url }],
      },
    })

    const result = await getSharedReportAttachmentCore('tok-att', 'rent.0')
    expect(Buffer.from(result.base64, 'base64').toString()).toBe(
      'hello invoice',
    )
    expect(result.contentType).toBe('application/pdf')
  })

  it('a REVOKED token is rejected, even for a reference that would otherwise be valid', async () => {
    await seedReport('r7', {
      shareToken: 'tok-att-revoked',
      shareTokenRevoked: true,
      status: 'signed',
    })
    await expect(
      getSharedReportAttachmentCore('tok-att-revoked', 'rent.0'),
    ).rejects.toMatchObject({ code: 'not-found' })
  })

  it('a DRAFT report is rejected', async () => {
    await seedReport('r8', {
      shareToken: 'tok-att-draft',
      shareTokenRevoked: false,
      status: 'draft',
    })
    await expect(
      getSharedReportAttachmentCore('tok-att-draft', 'rent.0'),
    ).rejects.toMatchObject({ code: 'not-found' })
  })

  it('a reference that does NOT belong to the report is rejected (ownership check)', async () => {
    await seedReport('r9', {
      shareToken: 'tok-att-wrong',
      shareTokenRevoked: false,
      status: 'signed',
    })
    await expect(
      getSharedReportAttachmentCore('tok-att-wrong', 'serviceCosts.5.0'),
    ).rejects.toMatchObject({ code: 'not-found' })
  })

  it('an unknown token is rejected', async () => {
    await expect(
      getSharedReportAttachmentCore('nope', 'rent.0'),
    ).rejects.toMatchObject({ code: 'not-found' })
  })
})
```

- [ ] **Step 2-4: fail → implement → pass.**

### Task 4: `functions/index.js` wiring

```js
const {
  getSharedReport,
  getSharedReportAttachment,
} = require('./src/sharedReport')
// ...
exports.getSharedReport = getSharedReport
exports.getSharedReportAttachment = getSharedReportAttachment
```

### Task 5 (recommended, confirm before including): two rules-band reinforcement tests

Extend `web/tests/monthlyReports.rules.test.js`'s `report()` fixture to seed one signed doc WITH a live `shareToken`, assert anonymous Firestore read is STILL denied. Same for `reportsInvoices.rules.test.js`'s Storage fixture. Zero rules changes — these only exercise the existing rule against a new fixture shape.

### Phase 1 gate

`npm run test:run --prefix functions` (or this repo's actual functions test command — confirm from `functions/package.json`, do not assume `npm test`), plus `npm run test:rules --prefix web` if Task 5 is included. **No UI exists yet to browser-validate** — the gate is the test bands plus one manual `firebase emulators:start` + calling `getSharedReport`/`getSharedReportAttachment` via the emulator's function shell or a scratch script, reported with raw output.

---

## Phase 2 — Client

### Task 6: `ReportSummaryView` — the shared presentational component

**Files:** Create `web/src/components/shared/ReportSummaryView.jsx`, Test `web/tests/reportSummaryView.test.jsx`

**Interfaces:** `ReportSummaryView({ data })` where `data` matches the SAME shape `toPublicReport` returns (`propertyName, month, year, rent, maintenance, serviceCosts, otherExpenses, previousMonthArrears, previousMonthCredit, calculatedTotal, finalTotal, dueDate, paymentStatus, amountPaid`). Renders read-only: header (property name + month/year), a table of cost lines (name, amount, notes, attachment names as inert badges — NO click handlers, NO images), footer (previous arrears/credit, calculated total, final total, due date, payment status). Used by:

- `SharedReportPage` (Task 9), fed directly by `getSharedReport`'s response.
- `ExportReportControls` (Task 8), fed by an adapter mapping the admin's own `existingReport` + `property.name` into the identical shape (a small `toReportSummaryData(existingReport, property)` helper — same field names, just sourced from the admin's already-loaded data instead of a network call).

### Task 7: `web/src/features/sharedReport/` — hooks + utils

**Files:** Create `hooks.js`, `utils.js`

```js
// hooks.js
export function useSharedReport(shareToken) {
  return useQuery({
    queryKey: ['sharedReport', shareToken],
    enabled: Boolean(shareToken),
    retry: false, // a not-found here is a REAL terminal state, not worth retrying
    queryFn: async () => {
      const getSharedReport = httpsCallable(functions, 'getSharedReport')
      const result = await getSharedReport({ shareToken })
      return result.data
    },
  })
}

export function useSharedReportAttachment() {
  return useMutation({
    mutationFn: async ({ shareToken, reference }) => {
      const getSharedReportAttachment = httpsCallable(
        functions,
        'getSharedReportAttachment',
      )
      const result = await getSharedReportAttachment({ shareToken, reference })
      return result.data // { base64, contentType, name }
    },
  })
}
```

```js
// utils.js
export function base64ToBlob(base64, contentType) {
  const byteChars = atob(base64)
  const bytes = new Uint8Array(byteChars.length)
  for (let i = 0; i < byteChars.length; i++) bytes[i] = byteChars.charCodeAt(i)
  return new Blob([bytes], { type: contentType || 'application/octet-stream' })
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
```

### Task 8: `useShareReport` / `useRevokeShareLink` — added to `reports/hooks.js`

```js
function generateShareToken() {
  const bytes = new Uint8Array(24) // 192 bits — far past "min 32 chars, impossible to guess"
  crypto.getRandomValues(bytes)
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

// Reuses the EXISTING token if one is live; mints a fresh one (and writes it)
// only if none exists yet OR the previous one was revoked — a revoked token
// never comes back (FR-REP-07c: "invalidates the link permanently"), a NEW
// share always gets a NEW token.
export function useShareReport() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, shareToken, shareTokenRevoked }) => {
      if (shareToken && !shareTokenRevoked) {
        return { token: shareToken, wrote: false }
      }
      const token = generateShareToken()
      await updateDoc(reportRef(id), {
        shareToken: token,
        shareTokenRevoked: false,
      })
      return { token, wrote: true }
    },
    onSuccess: ({ wrote }, { id }) => {
      if (wrote)
        queryClient.invalidateQueries({ queryKey: reportKeys.detail(id) })
    },
  })
}

export function useRevokeShareLink() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id }) =>
      updateDoc(reportRef(id), { shareTokenRevoked: true }),
    onSuccess: (_result, { id }) => {
      queryClient.invalidateQueries({ queryKey: reportKeys.detail(id) })
    },
  })
}
```

Test additions in `reports.hooks.test.jsx`: token is ≥32 chars and URL-safe (no `+`/`/`/`=`); reusing an existing non-revoked token performs NO write; a missing or revoked token triggers exactly one `updateDoc` with a fresh token + `shareTokenRevoked: false`; `useRevokeShareLink` writes only `{shareTokenRevoked: true}`, never touching `status`/`signedAt` (same discipline as `useMarkPayment`); **a draft re-save (`useSaveReportDraft`) does not drop `shareToken`/`shareTokenRevoked`** — its `updateDoc` payload never includes those keys, so Firestore leaves them untouched; add one explicit test asserting this, since the whole feature's persistence now rests on it.

### Task 9: `SharedReportPage` — `/r/:shareToken`

**Files:** Create `web/src/features/sharedReport/pages/SharedReportPage.jsx`

States: loading (`common.loading`) → error/not-found (`sharedReport.unavailable`, generic — never echoes the callable's error detail) → success (`ReportSummaryView` + an "Attachments" section listing every attachment across all cost lines with a "Download" button each, calling `useSharedReportAttachment().mutateAsync({shareToken, reference})` on click, converting the result via `base64ToBlob`/`downloadBlob`) + `LanguageSwitcher` (reused as-is from `components/shared/`, since this page has no tenant identity to infer a language from — same reasoning as `/login`). No portal/history/contract link anywhere on this page.

Route wiring in `web/src/routes/index.jsx`: replace

```jsx
<Route
  path="/r/:shareToken"
  element={<PlaceholderPage titleKey="pages.sharedReport" />}
/>
```

with

```jsx
<Route path="/r/:shareToken" element={<SharedReportPage />} />
```

— stays OUTSIDE both `ProtectedRoute` wrappers, exactly where the placeholder already sits.

### Task 10: `ExportReportControls` — admin's export zone

**Files:** Create `web/src/features/reports/components/ExportReportControls.jsx`, Modify `MonthlyReportPage.jsx`

Renders (only when `isLocked`, alongside `SendReportNotificationControl` in the existing `<div className="flex items-center gap-3">` row — that row and `SignReportControl` are not otherwise touched):

- **"Copiază link"** — calls `useShareReport().mutateAsync({id, shareToken: report.shareToken, shareTokenRevoked: report.shareTokenRevoked})`, then `navigator.clipboard.writeText(`${window.location.origin}/r/${token}`)`, shows a brief success message.
- **"Revocă"** — confirmation dialog (same `Dialog` pattern as `SendReportNotificationControl`), then `useRevokeShareLink().mutateAsync({id})`. Disabled/hidden if there's no live token yet (`!report.shareToken || report.shareTokenRevoked`).
- **"Descarcă PDF"** / **"Descarcă PNG"** — render a visually-hidden `ReportSummaryView` (fed by `toReportSummaryData(existingReport, property)`) into a `ref`, `html2canvas(ref.current)` on click → canvas → `toDataURL('image/png')` for PNG (via `downloadBlob`-equivalent for data URLs), or embedded into a new `jsPDF()` document for PDF. **Blocked on the library decision above — do not implement until approved.**

### Task 11: i18n

New `sharedReport` namespace (`ro.json`/`en.json`): `unavailable`, `attachments.title`, `attachments.download`, plus `ReportSummaryView`'s own labels (can reuse existing `reports.fields.*`/`reports.sections.*` keys directly — check for overlap before adding new ones, most of the vocabulary already exists). New `reports.export.*` keys: `copyLink`, `copySuccess`, `revoke`, `revokeConfirm`, `revokeSuccess`, `downloadPdf`, `downloadPng`.

### Phase 2 gate

`npm run test:run --prefix web`, `npm run lint`, `npm run build --prefix web`, then manual browser validation: sign a report → copy link → open `/r/{token}` in an incognito/unauthenticated window → confirm report renders, no personal data, attachments downloadable → revoke → confirm the SAME link now shows "unavailable" → PDF/PNG download produce sane files.

---

## Testing summary (three bands, as required)

- **Functions band (priority):** Tasks 1-3's tests — round-trip reference resolution, uniform `not-found` across unknown/revoked/draft (both callables), zero-personal-data anti-vacuity check, ownership-mismatch rejection, real bytes round-trip through the real Storage emulator.
- **Fast band (jsdom):** `SharedReportPage` (loading/report/unavailable), `ReportSummaryView` (renders the allowlisted fields, never anything else), `ExportReportControls` (copy/revoke call the right mutations with the right args, mocked; export buttons call `html2canvas`/`jsPDF`, mocked — no real rendering in jsdom), `useShareReport`/`useRevokeShareLink` (token generation, reuse-vs-mint logic, payload shape), export zone only rendered when `isLocked`.
- **Rules band:** Task 5 (optional, recommend including) — confirms anonymous denial holds even on a fixture carrying a live `shareToken`.

---

## Phases & commit proposal (my recommendation — you decide)

**Phase 1 = one `feat:` commit** (Tasks 1-5): the two callables + functions security tests + optional rules reinforcement tests. Gate: test bands green + one manual emulator invocation (no UI exists yet to browser-validate against). This can be approved and merged into the sub-stage branch independently of the PDF/PNG library decision.

**Phase 2 = one `feat:` commit** (Tasks 6-11): public page + admin export zone + PDF/PNG. Gate: full browser validation (sign → share → open incognito → revoke → re-check → download PDF/PNG).

**The plan document itself = a `docs:` commit**, same pattern as every prior sub-stage.

Three commits total, in this order: `docs:` (plan) → `feat:` (Phase 1) → `feat:` (Phase 2) — each staged, verified, and reported separately, none committed without your explicit approval, no push.

---

## Confirmations

- **Zero SRS edits.** Every requirement implemented here is already pinned at 5a92763.
- **Zero Security Rules changes.** `firestore.rules`/`storage.rules` content untouched — quoted evidence above. If Task 5's rules tests reveal ANY gap (an anonymous read somehow succeeding), that is a STOP-and-ask condition per your instruction, not a silent fix.
