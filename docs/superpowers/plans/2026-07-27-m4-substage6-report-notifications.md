# M4 Sub-stage 6 — On-Demand Report Notifications (A2/A3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the administrator send the tenant an email about a signed report — explicitly choosing, every time, whether it's Appendix A2 ("new report") or A3 ("report updated") — via a new `sendReportNotification` callable and a "Send by email" control on the signed-report page.

**Architecture:** A new admin-only callable, `sendReportNotification(reportId, template)`, reads the report + the tenant's `users` doc, builds the A2/A3 email in the tenant's `preferredLanguage` via a new template module (`functions/src/mail-templates/reportNotification.js`, same shape as the existing `credentials.js`/`assignment.js`), and writes it into `mail`. No transaction, no tracking field — matches the pinned decision (`f6d5c83`) that the admin decides fresh every send. The client gets a thin `useSendReportNotification` hook (`httpsCallable`, same pattern as `useSignReport`) and a new `SendReportNotificationControl` component — a button that opens a 2-choice dialog ("New report" / "Updated report"), rendered only when the report is signed, sitting next to `SignReportControl` without touching it.

**Tech Stack:** Firebase Cloud Functions (`onCall`, same as every other callable in `functions/src/reports.js`), `Intl.DateTimeFormat`/`Intl.NumberFormat` for per-language formatting (Node 22 runtime, full ICU), React Hook Form is NOT needed here (no form — a 2-button dialog), shadcn/ui `Dialog` primitives directly (not `ConfirmDialog` — this is a 2-way choice, not a yes/no confirm).

## Global Constraints

- No SRS edits — the semantics this plan implements are already pinned at `f6d5c83` (§7.2 `sendReportNotification` row, §5.3 "Send by email" mention). If a gap is found, STOP and ask — do not edit `SRS.md`.
- The admin selects A2 ('new') vs A3 ('updated') MANUALLY, every single send — no auto-detection from `signedAt`, edit history, or anything else. No new field on `monthlyReports` for "already notified" (pinned `f6d5c83`).
- `onReportWrite` (`functions/src/reports.js`) is NOT touched — it deliberately does not send email, corrected into that shape at `b5bfff7`, reconfirmed at `f6d5c83`.
- Out of scope, touched nowhere in this plan: `getSharedReport`/PDF/PNG/copy-link (sub-stage 8), "Current month"/dashboard (sub-stage 7), `dailyScheduler` reminders (M6 milestone — arrears/expiry/report-prep, a completely different function).
- `mail` is Functions-only (NFR-SEC-02) — this is exactly why `sendReportNotification` is a callable and not a client Firestore write, same reasoning as `finalizeKyc`'s credentials email.
- The tenant's preferred language drives the email content (NFR-LOC-04) — read from `users/{userId}.preferredLanguage`, with the same "fall back to English if not ro/en" behavior already established in `credentials.js`/`assignment.js`.

---

## Decisions carried into this plan (confirm before Task 1)

1. **Where `{url}` comes from — a finding, not an invented value.** `functions/src/kyc.js:52` already defines `const APP_URL = process.env.APP_URL || 'http://localhost:5173'`, reused by both A1 (`credentials.js`) and A7 (`assignment.js`) as the generic portal login URL. SRS §5.4 (tenant area) defines no per-report deep-link route — `/app` always shows "this month's report," `/app/history` shows the rest; there is no `/app/reports/:id`. So A2/A3 use the SAME generic `APP_URL`, not a report-specific link. This mirrors A1/A7 exactly; nothing new is invented.
2. **`APP_URL` is duplicated as a local constant in `reports.js`, not extracted into a shared module.** `kyc.js` already has its own local `APP_URL`/`STORAGE_BUCKET` constants (env-configurable, same fallback pattern) — that per-file-local-constant style is the established convention in this codebase, not an oversight. Extracting a shared `config.js` would mean touching `kyc.js` (a shipped M2 file) for a one-line constant — out of scope here. `reports.js` gets its own `APP_URL` line, identical in shape.
3. **No transaction for `sendReportNotificationCore`.** Unlike `signReportCore`/`unlockReportCore` (which read-then-write the SAME `monthlyReports` doc they're validating, protecting against a status race), `sendReportNotification` only WRITES to `mail` — a different collection — after reading (not writing) `monthlyReports` and `users`. There is no invariant to protect transactionally. **Failure mode, accepted explicitly:** if an admin sends a notification in the same instant another admin action unlocks the report, one email may go out for a report that's a draft again microseconds later. This is harmless and recoverable — the admin just re-sends once it's signed again — and it's the same tolerance the "no tracking field, manual every time" pin (`f6d5c83`) already assumes: there is no single source of truth for "was this the right moment to send," so a narrow race here changes nothing about the feature's guarantees.
4. **Every interpolated value is localized by the template builder, not passed pre-formatted.** `{monthYear}`, `{total}`, AND `{dueDate}` all get formatted inside `buildReportNotificationEmail`, using the SAME resolved language (after the ro/en-or-fallback-to-en decision). This was almost missed for `{dueDate}`: `dueDate` is stored as a plain ISO string (`"2026-07-05"`) and the UI only ever shows it through `<input type="date">`, which localizes for display automatically — an email body has no such layer, so passing the raw ISO string through would read as `Data scadentă: 2026-07-05` to a Romanian tenant. Formatted with `Intl.DateTimeFormat(locale, { day:'2-digit', month:'2-digit', year:'numeric' })` — same helper family as `{monthYear}`/`{total}`, same place, no new convention introduced.
5. **`{monthYear}` in Romanian is lowercase** (`iulie 2026`) — `Intl.DateTimeFormat('ro-RO', { month: 'long', year: 'numeric' })`'s native output, and correct Romanian for this mid-sentence position (both A2's subject and body use it mid-sentence: "Raportul pentru {monthYear} este disponibil"). Tests assert the exact expected string, not a case-insensitive match — a future ICU/Node change should fail loudly here, not silently.
6. **The 2-choice "Send by email" dialog uses the `Dialog` primitives directly** (`@/components/ui/dialog`), not `ConfirmDialog` — `ConfirmDialog` is a single yes/no confirm, this is a 2-way choice between "new" and "updated." Checked for the exact bug `PaymentSection`'s cancel dialog had (two visibly identical button labels breaking `getByText`): this dialog's three buttons — "Cancel" (`common.cancel`), "New report", "Updated report" — have three distinct labels, no collision.
7. **The button lives next to `SignReportControl`, inside the same action row, not inside the (excluded) export area.** SRS §5.3 originally groups "Send by email" with the export buttons (PDF/PNG/copy-link), but those don't exist yet (sub-stage 8) — the task brief is explicit that the button stands alone for now. It goes in `MonthlyReportPage`'s existing `<div className="flex items-center gap-3">` row, right after `<SignReportControl>`, gated on the SAME `isLocked` — read-only, `isLocked` itself is not touched (same discipline as `PaymentSection`, sub-stage 5).
8. **No `invalidateQueries` after a successful send.** Sending an email changes nothing in Firestore that the client caches — no report field, no tenancy field. The mutation's only job is to report success/failure to the UI.

---

## File Structure

**New:**

- `functions/src/mail-templates/reportNotification.js` — the A2/A3 templates (RO/EN) + the three localization helpers (`formatMonthYear`, `formatAmount`, `formatDueDate`) + `buildReportNotificationEmail(template, language, fields)`.
- `functions/test/reportNotification.test.js` — pure unit tests for the template builder (mirrors `assignment.test.js` — no emulator needed).
- `web/src/features/reports/components/SendReportNotificationControl.jsx` — the button + 2-choice dialog.
- `web/tests/reports.sendReportNotificationControl.test.jsx` — jsdom band for the new component (mirrors `reports.signReportControl.test.jsx`).

**Modified:**

- `functions/src/reports.js` — add `sendReportNotificationCore`, `sendReportNotificationHandler`, exported `sendReportNotification` (`onCall`), plus the local `APP_URL` constant.
- `functions/index.js` — export `sendReportNotification`.
- `functions/test/reports.test.js` — add `sendReportNotification` core/handler emulator-based tests (mirrors the existing `signReport`/`unlockReport` describe blocks).
- `web/src/features/reports/hooks.js` — new `useSendReportNotification`.
- `web/src/features/reports/pages/MonthlyReportPage.jsx` — render `SendReportNotificationControl` next to `SignReportControl` when `isLocked`.
- `web/src/lib/i18n/locales/ro.json`, `en.json` — `reports.notify.*` keys.
- `web/tests/reports.hooks.test.jsx` — `useSendReportNotification` tests.
- `web/tests/reports.page.test.jsx` — mock-factory + `beforeEach` default for `useSendReportNotification` (the exact trap `useMarkPayment`/`useCancelPayment` caused in sub-stage 5 — done explicitly this time, not rediscovered at test-run time) + wiring tests.

**Untouched (confirmed, no changes needed):**

- `functions/src/kyc.js` — its own `APP_URL`/`credentials.js`/`assignment.js` are read-only references for this plan, not modified (Decision 2).
- `functions/src/reports.js`'s `onReportWrite`/`recomputeCurrentBalance`/`signReportCore`/`unlockReportCore` — read-only references, not modified.
- `web/src/features/reports/components/SignReportControl.jsx`, `PaymentSection.jsx` — untouched; the new control sits beside them.
- `firestore.rules`, `storage.rules`, `firestore.indexes.json` — no new collection, no new field, no new access pattern (the callable already has full admin Firestore access; `mail` is already Functions-only in rules).
- `SRS.md` — see Global Constraints.

---

## Task 1: `reportNotification.js` mail template (A2/A3)

**Files:**

- Create: `functions/src/mail-templates/reportNotification.js`
- Create: `functions/test/reportNotification.test.js`

**Interfaces:**

- Produces: `buildReportNotificationEmail(template, language, fields)` where `template` is `'new' | 'updated'`, `language` is `'ro' | 'en'` (or anything else, falling back to `'en'`), `fields` is `{ name, email, month, year, finalTotal, dueDate, url }` (RAW, unformatted — the builder does all formatting internally). Returns `{ to: [email], message: { subject, text } }` — the `mail` document shape (SRS §5.7 / the "Trigger Email" extension contract), same as `buildCredentialsEmail`/`buildAssignmentEmail`.
- Consumed by: Task 2 (`sendReportNotificationCore`, `functions/src/reports.js`).

- [ ] **Step 1: Write the failing tests**

Create `functions/test/reportNotification.test.js`:

```js
import { describe, expect, it } from 'vitest'
import { buildReportNotificationEmail } from '../src/mail-templates/reportNotification.js'

// Templates A2 (new report) / A3 (report updated) — SRS Appendix A. Same
// `mail` document shape as buildCredentialsEmail/buildAssignmentEmail (SRS
// §5.7). Unlike A1/A7, A2/A3 interpolate a formatted month/year, a formatted
// amount, and a formatted due date — all localized by the builder itself
// from the SAME resolved language (M4 sub-stage 6, plan Decision 4).

const FIELDS = {
  name: 'Ion Popescu',
  email: 'ion@example.com',
  month: 7,
  year: 2026,
  finalTotal: 1500,
  dueDate: '2026-07-05',
  url: 'http://localhost:5173',
}

describe('buildReportNotificationEmail — A2 (new report)', () => {
  it('addresses the mail to the recipient email', () => {
    const mail = buildReportNotificationEmail('new', 'ro', FIELDS)
    expect(mail.to).toEqual(['ion@example.com'])
  })

  it('builds the RO subject and body verbatim from SRS Appendix A2, with formatted month/total/date', () => {
    const mail = buildReportNotificationEmail('new', 'ro', FIELDS)
    expect(mail.message.subject).toBe(
      'Raportul pentru iulie 2026 este disponibil — 1.500,00 lei',
    )
    expect(mail.message.text).toBe(
      'Bună, Ion Popescu,\n' +
        'Raportul lunar pentru iulie 2026 a fost publicat.\n' +
        'Total de plată: 1.500,00 lei / Data scadentă: 05.07.2026\n' +
        'Detaliile complete: http://localhost:5173',
    )
  })

  it('builds the EN subject and body verbatim from SRS Appendix A2, with formatted month/total/date', () => {
    const mail = buildReportNotificationEmail('new', 'en', FIELDS)
    expect(mail.message.subject).toBe(
      'Your July 2026 report is available — 1,500.00 RON',
    )
    expect(mail.message.text).toBe(
      'Hi Ion Popescu,\n' +
        'Your monthly report for July 2026 has been published.\n' +
        'Total due: 1,500.00 RON / Due date: 07/05/2026\n' +
        'Full details: http://localhost:5173',
    )
  })
})

describe('buildReportNotificationEmail — A3 (report updated)', () => {
  it('builds the RO subject and body verbatim from SRS Appendix A3', () => {
    const mail = buildReportNotificationEmail('updated', 'ro', FIELDS)
    expect(mail.message.subject).toBe(
      'Raportul pentru iulie 2026 a fost actualizat',
    )
    expect(mail.message.text).toBe(
      'Bună, Ion Popescu,\n' +
        'Raportul lunar pentru iulie 2026 a fost actualizat de proprietar.\n' +
        'Total de plată actualizat: 1.500,00 lei / Data scadentă: 05.07.2026\n' +
        'Verifică detaliile: http://localhost:5173',
    )
  })

  it('builds the EN subject and body verbatim from SRS Appendix A3', () => {
    const mail = buildReportNotificationEmail('updated', 'en', FIELDS)
    expect(mail.message.subject).toBe('Your July 2026 report has been updated')
    expect(mail.message.text).toBe(
      'Hi Ion Popescu,\n' +
        'Your monthly report for July 2026 has been updated by the landlord.\n' +
        'Updated total due: 1,500.00 RON / Due date: 07/05/2026\n' +
        'Check the details: http://localhost:5173',
    )
  })
})

describe('buildReportNotificationEmail — language fallback (NFR-LOC-04)', () => {
  it('falls back to English for an unknown/missing preferredLanguage', () => {
    const mail = buildReportNotificationEmail('new', 'fr', FIELDS)
    expect(mail.message.subject).toBe(
      'Your July 2026 report is available — 1,500.00 RON',
    )
  })

  it('falls back to English when preferredLanguage is undefined', () => {
    const mail = buildReportNotificationEmail('new', undefined, FIELDS)
    expect(mail.message.subject).toBe(
      'Your July 2026 report is available — 1,500.00 RON',
    )
  })
})

describe('buildReportNotificationEmail — anti-vacuity: A2 and A3 are actually different text', () => {
  it('the subject and body differ between templates for the SAME fields/language', () => {
    const a2 = buildReportNotificationEmail('new', 'ro', FIELDS)
    const a3 = buildReportNotificationEmail('updated', 'ro', FIELDS)
    expect(a2.message.subject).not.toBe(a3.message.subject)
    expect(a2.message.text).not.toBe(a3.message.text)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (from `functions/`): `npm test`
Expected: FAIL — the module doesn't exist yet.

- [ ] **Step 3: Write the implementation**

Create `functions/src/mail-templates/reportNotification.js`:

```js
/**
 * Templates A2 (new report published) / A3 (report updated) — SRS Appendix
 * A, FR-REP-06/FR-REP-07a. Sent ON-DEMAND ONLY, via the `sendReportNotification`
 * callable (functions/src/reports.js) — the admin picks 'new' vs 'updated'
 * manually every send, pinned at f6d5c83; there is no auto-detection and no
 * tracking field anywhere.
 *
 * Unlike A1 (credentials.js) / A7 (assignment.js), every interpolated value
 * here needs LOCALIZED formatting, not just language-switched copy — a plain
 * ISO month/year, a raw number, and an ISO date string would all read wrong
 * to a human. This module resolves the language ONCE (with the same
 * fallback-to-English convention as credentials.js/assignment.js) and
 * formats month/year, amount, and due date from that SAME resolved
 * language, so nothing here can end up half-Romanian, half-raw.
 */

const TEMPLATES = {
  ro: {
    new: {
      subject: ({ monthYear, total }) =>
        `Raportul pentru ${monthYear} este disponibil — ${total} lei`,
      body: ({ name, monthYear, total, dueDate, url }) =>
        `Bună, ${name},\n` +
        `Raportul lunar pentru ${monthYear} a fost publicat.\n` +
        `Total de plată: ${total} lei / Data scadentă: ${dueDate}\n` +
        `Detaliile complete: ${url}`,
    },
    updated: {
      subject: ({ monthYear }) =>
        `Raportul pentru ${monthYear} a fost actualizat`,
      body: ({ name, monthYear, total, dueDate, url }) =>
        `Bună, ${name},\n` +
        `Raportul lunar pentru ${monthYear} a fost actualizat de proprietar.\n` +
        `Total de plată actualizat: ${total} lei / Data scadentă: ${dueDate}\n` +
        `Verifică detaliile: ${url}`,
    },
  },
  en: {
    new: {
      subject: ({ monthYear, total }) =>
        `Your ${monthYear} report is available — ${total} RON`,
      body: ({ name, monthYear, total, dueDate, url }) =>
        `Hi ${name},\n` +
        `Your monthly report for ${monthYear} has been published.\n` +
        `Total due: ${total} RON / Due date: ${dueDate}\n` +
        `Full details: ${url}`,
    },
    updated: {
      subject: ({ monthYear }) => `Your ${monthYear} report has been updated`,
      body: ({ name, monthYear, total, dueDate, url }) =>
        `Hi ${name},\n` +
        `Your monthly report for ${monthYear} has been updated by the landlord.\n` +
        `Updated total due: ${total} RON / Due date: ${dueDate}\n` +
        `Check the details: ${url}`,
    },
  },
}

function localeFor(language) {
  return language === 'ro' ? 'ro-RO' : 'en-US'
}

/** "iulie 2026" / "July 2026" — lowercase in Romanian is correct here, both
 * A2's subject and body use it mid-sentence. */
function formatMonthYear(month, year, language) {
  const date = new Date(year, month - 1, 1)
  return new Intl.DateTimeFormat(localeFor(language), {
    month: 'long',
    year: 'numeric',
  }).format(date)
}

/** "1.500,00" (ro) / "1,500.00" (en) — no currency suffix: every A2/A3
 * template already appends " lei"/" RON" around {total} itself. */
function formatAmount(amount, language) {
  return new Intl.NumberFormat(localeFor(language), {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(amount) || 0)
}

/** "05.07.2026" (ro) / "07/05/2026" (en) — dueDate is stored as a plain ISO
 * string ("2026-07-05"); an email body has no <input type="date"> layer to
 * localize it for free, unlike the admin UI, so it must be formatted here
 * explicitly (plan Decision 4). */
function formatDueDate(isoDate, language) {
  const [year, month, day] = isoDate.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  return new Intl.DateTimeFormat(localeFor(language), {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date)
}

/**
 * Builds the `mail` document for the report notification email (SRS §5.7
 * shape). Falls back to English if `language` is not one of ro/en — same
 * convention as buildCredentialsEmail/buildAssignmentEmail.
 *
 * @param template  'new' | 'updated' — the admin's explicit choice (A2/A3)
 * @param language  'ro' | 'en' — the tenant's preferred language
 * @param fields    { name, email, month, year, finalTotal, dueDate, url } — RAW,
 *                  unformatted; this function does all localization internally.
 */
function buildReportNotificationEmail(template, language, fields) {
  const lang = TEMPLATES[language] ? language : 'en'
  const values = {
    name: fields.name,
    monthYear: formatMonthYear(fields.month, fields.year, lang),
    total: formatAmount(fields.finalTotal, lang),
    dueDate: formatDueDate(fields.dueDate, lang),
    url: fields.url,
  }
  const tpl = TEMPLATES[lang][template]
  return {
    to: [fields.email],
    message: {
      subject: tpl.subject(values),
      text: tpl.body(values),
    },
  }
}

module.exports = { buildReportNotificationEmail }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS — all cases, including both fallback cases and the anti-vacuity A2≠A3 check.

- [ ] **Step 5: Commit**

```bash
git add functions/src/mail-templates/reportNotification.js functions/test/reportNotification.test.js
git commit -m "feat: add A2/A3 report notification email templates (SRS Appendix A)"
```

---

## Task 2: `sendReportNotification` callable

**Files:**

- Modify: `functions/src/reports.js`
- Modify: `functions/index.js`
- Modify: `functions/test/reports.test.js`

**Interfaces:**

- Consumes: `buildReportNotificationEmail` (Task 1).
- Produces: `sendReportNotificationCore(reportId, template)` (async, returns `{ reportId, template }`), `sendReportNotificationHandler(request)`, exported `sendReportNotification` (`onCall`). Added to `functions/src/reports.js`'s existing `module.exports`.
- Consumed by: Task 4 (`useSendReportNotification`, via the callable name `'sendReportNotification'`).

- [ ] **Step 1: Write the failing tests**

Add to `functions/test/reports.test.js`:

```js
import { buildReportNotificationEmail } from '../src/mail-templates/reportNotification.js'
// (add to the existing import line from '../src/reports.js':)
//   sendReportNotificationCore, sendReportNotificationHandler,

async function seedUser(id, overrides = {}) {
  await db
    .collection('users')
    .doc(id)
    .set({
      name: 'Ion Popescu',
      email: 'ion@example.com',
      preferredLanguage: 'ro',
      status: 'active',
      ...overrides,
    })
}

describe('sendReportNotificationCore (SRS §7.2, FR-REP-06/07a, pinned at f6d5c83)', () => {
  it('rejects a report that does not exist', async () => {
    await expect(
      sendReportNotificationCore('does-not-exist', 'new'),
    ).rejects.toMatchObject({ code: 'not-found' })
  })

  it('rejects a DRAFT report — the tenant cannot see it yet, so it cannot be notified', async () => {
    await seedReport('report-1', { status: 'draft' })
    await seedUser('user-1')

    await expect(
      sendReportNotificationCore('report-1', 'new'),
    ).rejects.toMatchObject({
      code: 'failed-precondition',
      details: { reason: 'not-signed' },
    })

    const mailSnap = await db.collection('mail').get()
    expect(mailSnap.size).toBe(0)
  })

  it('writes an A2 email when template is "new"', async () => {
    await seedReport('report-1', {
      status: 'signed',
      userId: 'user-1',
      month: 7,
      year: 2026,
      finalTotal: 1500,
      dueDate: '2026-07-05',
    })
    await seedUser('user-1')

    const result = await sendReportNotificationCore('report-1', 'new')
    expect(result).toEqual({ reportId: 'report-1', template: 'new' })

    const mailSnap = await db.collection('mail').get()
    expect(mailSnap.size).toBe(1)
    const mail = mailSnap.docs[0].data()
    expect(mail.to).toEqual(['ion@example.com'])
    expect(mail.message.subject).toBe(
      'Raportul pentru iulie 2026 este disponibil — 1.500,00 lei',
    )
  })

  it('writes an A3 email when template is "updated" — different text from A2 for the same report', async () => {
    await seedReport('report-1', {
      status: 'signed',
      userId: 'user-1',
      month: 7,
      year: 2026,
      finalTotal: 1500,
      dueDate: '2026-07-05',
    })
    await seedUser('user-1')

    await sendReportNotificationCore('report-1', 'updated')

    const mail = (await db.collection('mail').get()).docs[0].data()
    expect(mail.message.subject).toBe(
      'Raportul pentru iulie 2026 a fost actualizat',
    )
  })

  it('sends in the tenant preferred language (NFR-LOC-04), not a hardcoded one', async () => {
    await seedReport('report-1', {
      status: 'signed',
      userId: 'user-1',
      finalTotal: 1500,
      dueDate: '2026-07-05',
    })
    await seedUser('user-1', { preferredLanguage: 'en' })

    await sendReportNotificationCore('report-1', 'new')

    const mail = (await db.collection('mail').get()).docs[0].data()
    expect(mail.message.subject).toContain('is available')
  })

  it('uses finalTotal, never calculatedTotal, in the email amount (FR-REP-04c)', async () => {
    await seedReport('report-1', {
      status: 'signed',
      userId: 'user-1',
      calculatedTotal: 1550, // diverged — an admin rounding adjustment
      finalTotal: 1500,
      dueDate: '2026-07-05',
    })
    await seedUser('user-1')

    await sendReportNotificationCore('report-1', 'new')

    const mail = (await db.collection('mail').get()).docs[0].data()
    expect(mail.message.subject).toContain('1.500,00')
    expect(mail.message.subject).not.toContain('1.550,00')
  })

  it('rejects if the tenant account no longer exists', async () => {
    await seedReport('report-1', { status: 'signed', userId: 'ghost-user' })

    await expect(
      sendReportNotificationCore('report-1', 'new'),
    ).rejects.toMatchObject({ code: 'not-found' })
  })
})

describe('sendReportNotification — callable guard', () => {
  it('rejects a non-admin caller — nothing written to mail', async () => {
    await seedReport('report-1', { status: 'signed', userId: 'user-1' })
    await seedUser('user-1')

    await expect(
      sendReportNotificationHandler({
        auth: { token: {}, uid: 'x' },
        data: { reportId: 'report-1', template: 'new' },
      }),
    ).rejects.toMatchObject({ code: 'permission-denied' })

    expect((await db.collection('mail').get()).size).toBe(0)
  })

  it('rejects a missing reportId argument', async () => {
    await expect(
      sendReportNotificationHandler({
        auth: { token: { admin: true }, uid: 'admin-uid' },
        data: { template: 'new' },
      }),
    ).rejects.toMatchObject({ code: 'invalid-argument' })
  })

  it('rejects a missing/invalid template argument', async () => {
    await seedReport('report-1', { status: 'signed', userId: 'user-1' })
    await seedUser('user-1')

    await expect(
      sendReportNotificationHandler({
        auth: { token: { admin: true }, uid: 'admin-uid' },
        data: { reportId: 'report-1' },
      }),
    ).rejects.toMatchObject({ code: 'invalid-argument' })

    await expect(
      sendReportNotificationHandler({
        auth: { token: { admin: true }, uid: 'admin-uid' },
        data: { reportId: 'report-1', template: 'garbage' },
      }),
    ).rejects.toMatchObject({ code: 'invalid-argument' })
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (from `functions/`): `npm run test:emulator`
Expected: FAIL — `sendReportNotificationCore`/`sendReportNotificationHandler` are not exported yet.

- [ ] **Step 3: Write the implementation**

Modify `functions/src/reports.js` — add the import and the local `APP_URL` constant near the top (after the existing requires):

```js
const {
  buildReportNotificationEmail,
} = require('./mail-templates/reportNotification')
```

```js
// The tenant-portal URL that goes into the A2/A3 report notification email —
// same env-configurable local constant as kyc.js's APP_URL (plan Decision 2,
// M4 sub-stage 6): no per-report deep link exists (SRS §5.4 defines only
// /app and /app/history), so this is the same generic portal URL A1/A7
// already use.
const APP_URL = process.env.APP_URL || 'http://localhost:5173'
```

Add near the bottom, after `onReportWrite`'s definition, before `module.exports`:

```js
/**
 * sendReportNotification (SRS §7.2, FR-REP-06/FR-REP-07a, pinned at f6d5c83).
 * ON-DEMAND ONLY — the admin picks `template` ('new' | 'updated' → A2 | A3)
 * fresh at every send; there is no auto-detection and no tracking field.
 *
 * No transaction (plan Decision 3): this only WRITES to `mail`, a different
 * collection from the one it reads (`monthlyReports`) — there is no
 * invariant to protect between the status read and the mail write. A signed
 * report that gets unlocked in that narrow window may still get one stale
 * email; that's harmless and the admin just re-sends, the same tolerance the
 * "no tracking, manual every time" pin already assumes.
 */
async function sendReportNotificationCore(reportId, template) {
  const db = getFirestore()
  const reportSnap = await db.collection('monthlyReports').doc(reportId).get()
  if (!reportSnap.exists) {
    throw new HttpsError('not-found', `Report ${reportId} does not exist.`)
  }
  const report = reportSnap.data()
  if (report.status !== 'signed') {
    throw new HttpsError(
      'failed-precondition',
      'Only a signed report can be notified by email.',
      { reason: 'not-signed' },
    )
  }

  const userSnap = await db.collection('users').doc(report.userId).get()
  if (!userSnap.exists) {
    throw new HttpsError('not-found', 'The tenant account does not exist.')
  }
  const user = userSnap.data()

  const mailRef = db.collection('mail').doc()
  await mailRef.set(
    buildReportNotificationEmail(template, user.preferredLanguage, {
      name: user.name,
      email: user.email,
      month: report.month,
      year: report.year,
      finalTotal: report.finalTotal,
      dueDate: report.dueDate,
      url: APP_URL,
    }),
  )

  return { reportId, template }
}

async function sendReportNotificationHandler(request) {
  if (request.auth?.token?.admin !== true) {
    throw new HttpsError('permission-denied', 'Admin access required.')
  }
  const reportId = request.data?.reportId
  if (!reportId) {
    throw new HttpsError('invalid-argument', 'reportId is required.')
  }
  const template = request.data?.template
  if (template !== 'new' && template !== 'updated') {
    throw new HttpsError(
      'invalid-argument',
      "template must be 'new' or 'updated'.",
    )
  }
  return sendReportNotificationCore(reportId, template)
}

const sendReportNotification = onCall(sendReportNotificationHandler)
```

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
  sendReportNotification,
  sendReportNotificationHandler,
  sendReportNotificationCore,
}
```

Modify `functions/index.js`:

```js
const {
  signReport,
  unlockReport,
  onReportWrite,
  sendReportNotification,
} = require('./src/reports')
// ...
exports.sendReportNotification = sendReportNotification
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test:emulator`
Expected: PASS — all `sendReportNotification` cases.

- [ ] **Step 5: Commit**

```bash
git add functions/src/reports.js functions/index.js functions/test/reports.test.js
git commit -m "feat: add sendReportNotification callable (A2/A3, SRS §7.2)"
```

---

## Task 3: `useSendReportNotification` hook

**Files:**

- Modify: `web/src/features/reports/hooks.js`
- Modify: `web/tests/reports.hooks.test.jsx`

**Interfaces:**

- Produces: `useSendReportNotification()` → `{ mutateAsync({ id, template }), isPending }`, calling the `sendReportNotification` callable with `{ reportId: id, template }`.
- Consumed by: Task 4 (`SendReportNotificationControl`).

- [ ] **Step 1: Write the failing tests**

Add to `web/tests/reports.hooks.test.jsx`:

```js
import { useSendReportNotification } from '@/features/reports/hooks'
// (add to the existing import line)

describe('useSendReportNotification (SRS §7.2, FR-REP-06/07a)', () => {
  it('calls the sendReportNotification callable with reportId + template', async () => {
    const sendMock = vi
      .fn()
      .mockResolvedValue({ data: { reportId: 'r1', template: 'new' } })
    httpsCallable.mockReturnValue(sendMock)

    const { result } = await renderHookWithProviders(() =>
      useSendReportNotification(),
    )
    await result.current.mutateAsync({ id: 'r1', template: 'new' })

    expect(httpsCallable).toHaveBeenCalledWith(
      { __fake: 'functions' },
      'sendReportNotification',
    )
    expect(sendMock).toHaveBeenCalledWith({ reportId: 'r1', template: 'new' })
  })

  it('does NOT invalidate any query on success — nothing client-cached changes', async () => {
    const sendMock = vi
      .fn()
      .mockResolvedValue({ data: { reportId: 'r1', template: 'new' } })
    httpsCallable.mockReturnValue(sendMock)
    const { result, queryClient } = await renderHookWithProviders(() =>
      useSendReportNotification(),
    )
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')

    await result.current.mutateAsync({ id: 'r1', template: 'updated' })

    expect(invalidate).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run (from `web/`): `npm run test:run`
Expected: FAIL — `useSendReportNotification` not exported yet.

- [ ] **Step 3: Implement**

Modify `web/src/features/reports/hooks.js` — add near `useSignReport`/`useUnlockReport`:

```js
// ─────────────────────────── useSendReportNotification ───────────
/**
 * Sends the A2 ('new') or A3 ('updated') report notification email
 * on-demand (FR-REP-06/07a, pinned at f6d5c83) via the `sendReportNotification`
 * callable. No `invalidateQueries`: sending an email writes only to `mail`
 * (Functions-only, NFR-SEC-02), which the client never reads — nothing
 * cached needs to be refreshed.
 */
export function useSendReportNotification() {
  return useMutation({
    mutationFn: ({ id, template }) => {
      const sendReportNotification = httpsCallable(
        functions,
        'sendReportNotification',
      )
      return sendReportNotification({ reportId: id, template })
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
git commit -m "feat: add useSendReportNotification hook"
```

---

## Task 4: `SendReportNotificationControl` component

**Files:**

- Create: `web/src/features/reports/components/SendReportNotificationControl.jsx`
- Create: `web/tests/reports.sendReportNotificationControl.test.jsx`
- Modify: `web/src/lib/i18n/locales/ro.json`, `web/src/lib/i18n/locales/en.json`

**Interfaces:**

- Consumes: `useSendReportNotification` (Task 3), `Dialog`/`DialogContent`/`DialogDescription`/`DialogFooter`/`DialogHeader`/`DialogTitle` (`@/components/ui/dialog`, unmodified).
- Produces: `SendReportNotificationControl({ report })` — `report` needs only `id`. Consumed by Task 5.

### 4.1 — i18n strings

- [ ] **Step 1: Add strings**

`web/src/lib/i18n/locales/ro.json`, inside `reports` (after the `payment` block added in M4 sub-stage 5):

```json
    "notify": {
      "button": "Trimite pe email",
      "dialogTitle": "Trimite notificare",
      "dialogBody": "Alege ce tip de raport trimiți chiriașului.",
      "templateNew": "Raport nou",
      "templateUpdated": "Raport actualizat",
      "success": "Emailul a fost trimis.",
      "error": "Emailul nu a putut fi trimis. Încearcă din nou."
    }
```

`web/src/lib/i18n/locales/en.json`, same position:

```json
    "notify": {
      "button": "Send by email",
      "dialogTitle": "Send notification",
      "dialogBody": "Choose which report type to send the tenant.",
      "templateNew": "New report",
      "templateUpdated": "Updated report",
      "success": "The email has been sent.",
      "error": "The email could not be sent. Please try again."
    }
```

Verified no collision (the `PaymentSection` cancel-dialog lesson, M4 sub-stage 5): this dialog's three buttons are `common.cancel` ("Anulează"), `templateNew` ("Raport nou"), `templateUpdated` ("Raport actualizat") — three distinct strings.

### 4.2 — the component

- [ ] **Step 2: Write the failing tests**

Create `web/tests/reports.sendReportNotificationControl.test.jsx`:

```js
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from './renderWithProviders'
import { SendReportNotificationControl } from '@/features/reports/components/SendReportNotificationControl'
import { useSendReportNotification } from '@/features/reports/hooks'

vi.mock('@/features/reports/hooks', () => ({
  useSendReportNotification: vi.fn(),
}))

const sendMutateAsync = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  sendMutateAsync.mockResolvedValue({})
  useSendReportNotification.mockReturnValue({
    mutateAsync: sendMutateAsync,
    isPending: false,
  })
})

describe('SendReportNotificationControl', () => {
  it('opens the dialog on click, offering both template choices', async () => {
    const user = userEvent.setup()
    await renderWithProviders(
      <SendReportNotificationControl report={{ id: 'r1' }} />,
    )

    await user.click(screen.getByText('Trimite pe email'))

    expect(screen.getByText('Raport nou')).toBeVisible()
    expect(screen.getByText('Raport actualizat')).toBeVisible()
  })

  it('sends template "new" and shows a success message', async () => {
    const user = userEvent.setup()
    await renderWithProviders(
      <SendReportNotificationControl report={{ id: 'r1' }} />,
    )

    await user.click(screen.getByText('Trimite pe email'))
    await user.click(screen.getByText('Raport nou'))

    expect(sendMutateAsync).toHaveBeenCalledWith({ id: 'r1', template: 'new' })
    expect(await screen.findByText('Emailul a fost trimis.')).toBeVisible()
  })

  it('sends template "updated" when that choice is picked', async () => {
    const user = userEvent.setup()
    await renderWithProviders(
      <SendReportNotificationControl report={{ id: 'r1' }} />,
    )

    await user.click(screen.getByText('Trimite pe email'))
    await user.click(screen.getByText('Raport actualizat'))

    expect(sendMutateAsync).toHaveBeenCalledWith({
      id: 'r1',
      template: 'updated',
    })
  })

  it('shows an error message INSIDE the still-open dialog if sending fails', async () => {
    const user = userEvent.setup()
    sendMutateAsync.mockRejectedValue(new Error('internal'))
    await renderWithProviders(
      <SendReportNotificationControl report={{ id: 'r1' }} />,
    )

    await user.click(screen.getByText('Trimite pe email'))
    await user.click(screen.getByText('Raport nou'))

    // Scoped through the dialog's role: getByRole DOES respect aria-hidden,
    // unlike findByText/toBeVisible — this is what would have caught the
    // error message being painted in the (now aria-hidden) outer wrapper
    // instead of inside DialogContent.
    const dialog = screen.getByRole('dialog')
    expect(
      await within(dialog).findByText(
        'Emailul nu a putut fi trimis. Încearcă din nou.',
      ),
    ).toBeVisible()
    // The dialog is still open and usable — both choices are still there.
    expect(within(dialog).getByText('Raport nou')).toBeVisible()
    expect(within(dialog).getByText('Raport actualizat')).toBeVisible()
  })

  it('closes the dialog via the Cancel button without sending anything', async () => {
    const user = userEvent.setup()
    await renderWithProviders(
      <SendReportNotificationControl report={{ id: 'r1' }} />,
    )

    await user.click(screen.getByText('Trimite pe email'))
    await user.click(screen.getByText('Anulează'))

    expect(sendMutateAsync).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 3: Run to verify it fails**

Run: `npm run test:run`
Expected: FAIL — `SendReportNotificationControl` doesn't exist.

- [ ] **Step 4: Implement**

Create `web/src/features/reports/components/SendReportNotificationControl.jsx`:

```js
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useSendReportNotification } from '@/features/reports/hooks'

/**
 * The "Send by email" control (SRS §5.3, FR-REP-06/FR-REP-07a). A signed
 * report ONLY — rendered by MonthlyReportPage next to SignReportControl,
 * gated on the SAME `isLocked`, read-only (M4 sub-stage 6). The admin picks
 * A2 ("new report") vs A3 ("report updated") explicitly, every time — this
 * dialog IS that choice; there is no default or remembered selection.
 *
 * The error message renders INSIDE `DialogContent`, not in the outer
 * wrapper: on failure the dialog deliberately stays open, and Radix marks
 * everything OUTSIDE the open dialog `aria-hidden` + `pointer-events: none`
 * (the same subtree `PaymentSection`'s tests surfaced in M4 sub-stage 5). An
 * error painted in the outer wrapper would be invisible/unreachable to the
 * admin even though `findByText`/`toBeVisible()` don't catch that — neither
 * checks `aria-hidden`. The success message stays in the outer wrapper on
 * purpose: the dialog is already closed by the time it renders.
 */
export function SendReportNotificationControl({ report }) {
  const { t } = useTranslation()
  const sendNotification = useSendReportNotification()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState(false)

  async function handleSend(template) {
    setError(false)
    try {
      await sendNotification.mutateAsync({ id: report.id, template })
      setSuccess(true)
      setDialogOpen(false)
    } catch {
      setError(true)
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <Button
        type="button"
        variant="outline"
        onClick={() => {
          setSuccess(false)
          setError(false)
          setDialogOpen(true)
        }}
      >
        {t('reports.notify.button')}
      </Button>

      {success && (
        <p role="status" className="text-sm text-muted-foreground">
          {t('reports.notify.success')}
        </p>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t('reports.notify.dialogTitle')}</DialogTitle>
            <DialogDescription>
              {t('reports.notify.dialogBody')}
            </DialogDescription>
          </DialogHeader>

          {error && (
            <p role="alert" className="text-sm text-destructive">
              {t('reports.notify.error')}
            </p>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setDialogOpen(false)}
            >
              {t('common.cancel')}
            </Button>
            <Button
              type="button"
              onClick={() => handleSend('new')}
              disabled={sendNotification.isPending}
            >
              {t('reports.notify.templateNew')}
            </Button>
            <Button
              type="button"
              onClick={() => handleSend('updated')}
              disabled={sendNotification.isPending}
            >
              {t('reports.notify.templateUpdated')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `npm run test:run`
Expected: PASS for `reports.sendReportNotificationControl.test.jsx`.

- [ ] **Step 6: Commit**

```bash
git add web/src/features/reports/components/SendReportNotificationControl.jsx web/tests/reports.sendReportNotificationControl.test.jsx web/src/lib/i18n/locales/ro.json web/src/lib/i18n/locales/en.json
git commit -m "feat: add SendReportNotificationControl (SRS §5.3)"
```

---

## Task 5: Wire `SendReportNotificationControl` into `MonthlyReportPage`

**Files:**

- Modify: `web/src/features/reports/pages/MonthlyReportPage.jsx`
- Modify: `web/tests/reports.page.test.jsx`

**Interfaces:**

- Consumes: `SendReportNotificationControl` (Task 4). Reuses the EXISTING `isLocked` constant — read-only, not modified.

- [ ] **Step 1: Add `useSendReportNotification` to the page test's mock factory FIRST**

This is the exact trap `useMarkPayment`/`useCancelPayment` caused in sub-stage 5 (discovered only when the pre-existing signed-report tests crashed) — done explicitly up front this time. Modify `web/tests/reports.page.test.jsx`:

```js
import {
  useCancelPayment,
  useMarkPayment,
  useMonthlyReport,
  useSaveReportDraft,
  useSendReportNotification,
  useSignReport,
  useUnlockReport,
} from '@/features/reports/hooks'
```

```js
vi.mock('@/features/reports/hooks', () => ({
  useMonthlyReport: vi.fn(),
  useSaveReportDraft: vi.fn(),
  useSignReport: vi.fn(),
  useUnlockReport: vi.fn(),
  useMarkPayment: vi.fn(),
  useCancelPayment: vi.fn(),
  useSendReportNotification: vi.fn(),
}))
```

In the shared `beforeEach`, alongside the `useMarkPayment`/`useCancelPayment` defaults:

```js
const sendNotificationMutateAsync = vi.fn()
// ...
sendNotificationMutateAsync.mockResolvedValue({})
useSendReportNotification.mockReturnValue({
  mutateAsync: sendNotificationMutateAsync,
  isPending: false,
})
```

- [ ] **Step 2: Write the failing tests**

Add to `web/tests/reports.page.test.jsx`:

```js
describe('MonthlyReportPage — SendReportNotificationControl wiring (M4 sub-stage 6)', () => {
  it('renders the "Send by email" button when the report is signed', async () => {
    mockData({ report: SIGNED_REPORT })
    await renderWithProviders(<MonthlyReportPage />)

    expect(await screen.findByText('Trimite pe email')).toBeVisible()
  })

  it('does NOT render it on a draft', async () => {
    mockData({ report: REPORT_WITH_RENT_ATTACHMENT })
    await renderWithProviders(<MonthlyReportPage />)

    await screen.findByText('Semnează lista')
    expect(screen.queryByText('Trimite pe email')).toBeNull()
  })

  it('does NOT render it on a brand new (never-saved) report', async () => {
    mockData()
    await renderWithProviders(<MonthlyReportPage />)

    await screen.findByText('Gas')
    expect(screen.queryByText('Trimite pe email')).toBeNull()
  })
})
```

- [ ] **Step 3: Run to verify it fails**

Run (from `web/`): `npm run test:run`
Expected: FAIL — `SendReportNotificationControl` never rendered yet.

- [ ] **Step 4: Implement**

Modify `web/src/features/reports/pages/MonthlyReportPage.jsx`:

```js
import { SendReportNotificationControl } from '@/features/reports/components/SendReportNotificationControl'
```

In the action row (plan Decision 7 — next to `SignReportControl`, inside the form, NOT inside the `PaymentSection` area):

```js
<div className="flex items-center gap-3">
  {!isLocked && (
    <Button type="submit" disabled={saveDraft.isPending}>
      {saveDraft.isPending ? t('common.loading') : t('reports.save')}
    </Button>
  )}
  {existingReport && <SignReportControl report={existingReport} />}
  {isLocked && <SendReportNotificationControl report={existingReport} />}
</div>
```

No other change to this file — `isLocked` is READ here for a third, independent purpose; nothing about its existing role changes.

- [ ] **Step 5: Run to verify it passes**

Run: `npm run test:run`
Expected: PASS — new tests, plus the FULL pre-existing M4 sub-stage 4/5 suite.

- [ ] **Step 6: Commit**

```bash
git add web/src/features/reports/pages/MonthlyReportPage.jsx web/tests/reports.page.test.jsx
git commit -m "feat: render SendReportNotificationControl on a signed report (M4 sub-stage 6)"
```

---

## Self-Review

**1. Spec coverage:**

- FR-REP-06 (optional, admin-triggered "Send by email", never automatic) → Task 2 (`sendReportNotificationCore` requires `status=='signed'`, never called by any trigger) + Task 4/5 (button only on signed).
- FR-REP-07a ("after correction and re-signing, the admin can OPTIONALLY notify... using the same button") → Task 4's dialog offers BOTH template choices identically regardless of whether this is the report's first or a later signing — nothing in the UI or callable distinguishes "first send" from "re-send," matching "the same button."
- SRS §7.2 `sendReportNotification` row (pinned `f6d5c83`: manual selection, parameter, no auto-detection, no tracking field) → Task 2, `template` is a required, validated parameter with no default and no read of `signedAt`/any history.
- SRS §5.3 "Send by email" (optional, triggers A2/A3 on demand) → Task 4/5.
- Appendix A2/A3 (verbatim RO/EN copy) → Task 1, copied verbatim from SRS.md's Appendix A section.
- NFR-LOC-04 (tenant's preferred language) → Task 1 (`buildReportNotificationEmail`'s `language` param, fallback-to-English) + Task 2 (reads `users.preferredLanguage`).
- NFR-SEC-02 (`mail` Functions-only) → Task 2, the write happens exclusively inside the callable, never client-side.
- Explicitly excluded (export/PDF/PNG/link, Current month/dashboard, `dailyScheduler`) → touched nowhere in this plan.

**2. Placeholder scan:** none found — every step has complete code and exact assertions.

**3. Type/signature consistency:**

- `buildReportNotificationEmail(template, language, fields)` — same signature in Task 1's own tests, Task 2's `sendReportNotificationCore` call site.
- `sendReportNotificationCore(reportId, template)` / `sendReportNotificationHandler(request)` — used identically in Task 2's tests and its own definition.
- `useSendReportNotification().mutateAsync({ id, template })` — matches between Task 3's hook, its own tests, and Task 4's `SendReportNotificationControl` call sites.
- `SendReportNotificationControl({ report })` — `report` needs only `id`, matching what Task 5 passes (`existingReport`, which always has `id` once persisted).

**4. Confirmed zero SRS edits, zero new fields, zero new Security Rules** (Global Constraints) — no task in this plan touches `SRS.md`, `firestore.rules`, `storage.rules`, or adds any field to `monthlyReports`/`users`/`tenancies`.
