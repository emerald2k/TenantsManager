# M7 Sub-stage 6a — Date-formatting helper for the tenant portal — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every date the tenant sees renders in the same long-form, current-interface-language style the contract-ended banner already uses correctly (SRS §5.4) — not just the banner.

## Inventory (found before any design decision)

**The existing correct reference** — `web/src/routes/TenantLayout.jsx`'s private `formatEndedDate(endedAt, language)` (lines 23-30): takes a Firestore `Timestamp`, maps `language` to `'ro-RO'`/`'en-US'`, formats with `Intl.DateTimeFormat(locale, {day:'numeric', month:'long', year:'numeric'})`, driven by `i18n.language` — the CURRENT interface language, read at render time from `useTranslation()`. Tested in `web/tests/tenantLayout.test.jsx`, test **L6** (lines 105-117) explicitly proves this by rendering with `{ language: 'en' }` and asserting `"Contract ended on January 31, 2026"` — the precedent this plan's own tests mirror.

**A blocking finding: `SRS.md:373-374` currently specifies the OPPOSITE of this task.**

> "The date is formatted in the current interface language (e.g. "31 ianuarie 2026" / "January 31, 2026"). **Other dates in the tenant portal remain unformatted.**"

This is not a gap or an omission — it is the literal, current, written spec, and the task ("Debt #10") asks to change exactly the behavior that sentence mandates. Per CLAUDE.md §1 ("the code and the SRS move together... a contradiction gets flagged, not coded around"), this plan cannot apply formatting beyond the banner without also updating this sentence — doing one without the other would leave `SRS.md` and the code diverging the moment this plan lands, the same failure mode this project's own process exists to prevent. **Task 1, below, updates the sentence.** The wording is proposed there for review, not silently applied.

**Why the sentence said that — traced, not assumed.** `git log -p -L 370,375:SRS.md` finds the sentence's origin at commit `40b1107` ("docs: format the ended-contract banner date in the interface language"), the same session as `171f338` ("feat: add persistent ended-contract banner to tenant portal"), M5 sub-stage 9. That sub-stage's own plan, `docs/superpowers/plans/2026-08-04-m5-substage9-ended-contract-banner.md`, states the reason explicitly at §2 (line 31-32) and again at its self-review (line 319-323):

> "Formatting applies ONLY to the banner. `/app/contract` and `ReportSummaryView` keep raw ISO dates — a conscious debt, noted for M7."
> "Date-formatting debt, accepted deliberately. ... flagged for M7, not addressed here. If M7 arrives and this hasn't been picked up, that's a process gap to catch at the M7 planning gate, not at this sub-stage's own audit."

So the reason WAS effort/scope management, stated as such at the time: FR-TAPP-06 only required the banner itself, the sub-stage stayed narrowly scoped to what it was asked for, and the wider rollout was explicitly deferred to M7 rather than treated as a design decision that raw ISO was somehow preferable elsewhere. There is no functional or product reason on record for the carve-out — it was always meant to be temporary, and M7 (this sub-stage) is that deferred pickup arriving on schedule, not a change of mind. The commit message (Task 9) states this in one line, since the diff alone will not carry it forward.

**Every place a date reaches the tenant unformatted:**

| Site                                                            | Field(s)                               | Format today                                                  | In scope?                                 |
| --------------------------------------------------------------- | -------------------------------------- | ------------------------------------------------------------- | ----------------------------------------- |
| `web/src/features/tenantApp/pages/TenantContractPage.jsx:89,93` | `tenancy.startDate`, `tenancy.endDate` | Raw `'YYYY-MM-DD'` string, rendered as-is via `ContractField` | Yes — tenant-portal-only file, not shared |
| `web/src/components/shared/ReportSummaryView.jsx:174`           | `data.dueDate`                         | Raw `'YYYY-MM-DD'` string, `<span>{data.dueDate}</span>`      | Yes — see "shared component" note below   |

Both fields are confirmed plain `'YYYY-MM-DD'` strings (no time component): `tenancy.startDate`/`endDate` come from a native `<input type="date">` at onboarding (`StepContract.jsx:169,175`); `report.dueDate` is built by `buildDueDate()` (`web/src/features/reports/schema.js:150-154`, `` `${year}-${month}-${day}` ``) or entered through the admin's own native `<input type="date" id="dueDate">` (`MonthlyReportPage.jsx:306`). This differs from the banner's `endedAt`, which is a Firestore `Timestamp` — the new helper needs to accept both shapes (Task 2).

**`ReportSummaryView` is a shared component — the fix cannot be scoped to "tenant portal" alone.** It renders live, in-browser, for:

- `TenantDashboardPage.jsx` and `TenantReportDetailPage.jsx` (tenant portal — the actual target of this task)
- `DownloadReportPdfButton.jsx` → `useReportSummaryCapture` (tenant-triggered PDF, same component rasterized off-screen)
- `SharedReportPage.jsx` (`/r/:shareToken`, public/unauthenticated — has its own `LanguageSwitcher`, so "current interface language" is a meaningful, live concept there too, not a fixed export-time snapshot)
- `ExportReportControls.jsx` → `useReportSummaryCapture` (**admin**-triggered PDF/PNG export, same component)

Because the fix lands inside the shared component (there is no per-consumer date-rendering code to touch separately), it mechanically also formats `dueDate` on the public share page and in the admin's exported PDF/PNG — the task's own instruction ("scope the fix to the tenant portal unless the inventory shows they share a component") is answered: they do.

**The admin does NOT have this problem on its own editing surface.** `MonthlyReportPage.jsx`'s `dueDate` field (lines 304-317) is ALWAYS a native `<input type="date">`, even when the report is locked/signed (just `disabled`) — never switched to inert formatted text. The browser's own date picker already renders it appropriately; there is nothing to fix there. Confirmed by direct read and by `reports.page.test.jsx`, which only ever asserts on it via `getByLabelText('Data scadentă')`/`toHaveValue(...)`, never `getByText` on a raw date string.

**One existing test will break and needs updating, not just extending**: `web/tests/reportSummaryView.test.jsx:98` — `expect(screen.getByText('2026-07-10')).toBeVisible()` asserts the RAW string. Confirmed by grepping every touched test file specifically for `getByText`/`toHaveTextContent` on a raw ISO date (not just fixture-literal occurrences, which are harmless) — this is the only hit across `sharedReport.page.test.jsx`, `tenantApp.dashboardPage.test.jsx`, `tenantApp.reportDetailPage.test.jsx`, `reports.page.test.jsx`, `reportSummaryCapture.test.jsx`, `reportSummaryView.test.jsx`.

**An existing, unrelated duplication, found but left alone (Task 2 states this explicitly too):** `web/src/features/dashboard/calculations.js` has its own private `localeFor(language)` (admin-side, backing `formatMonthYearLabel` — "iulie 2026" shape, month+year only) — a SECOND implementation of the same `ro-RO`/`en-US` mapping `TenantLayout.jsx` already duplicates privately. `web/src/features/tenantApp/components/ReportHistoryRow.jsx:50` cross-imports `formatMonthYearLabel` from the admin's `dashboard/` feature to render report-list rows — exactly the "wrong import direction" `TenantLayout.jsx`'s own doc comment says it was avoiding for itself. This is a real, pre-existing inconsistency, but it formats a DIFFERENT shape (month+year, not day-month-year) and is not part of debt #10 (nothing here renders raw ISO — `formatMonthYearLabel` already works correctly, in both languages, today). Out of scope for this plan; noted so it isn't rediscovered as if new.

**NFR-LOC-04 conflict — flagged, not resolved, per the task's explicit instruction.** `SRS.md:284`: "automatic emails and PDFs are generated in the tenant's preferred language... editable later." `web/src/lib/reportSummaryCapture.jsx`'s `useReportSummaryCapture` (lines 55-59) mounts `<ReportSummaryView {...reportSummaryProps} />` off-screen and rasterizes whatever the live global i18n instance currently holds at click time — it never switches to the tenant's stored `preferredLanguage` before capturing. This conflict is **pre-existing**, not introduced by this plan: every label `ReportSummaryView` already renders (rent, maintenance, payment status...) has ignored `preferredLanguage` in favor of the current session's interface language since M5 sub-stage 8. This plan's `dueDate` formatting follows the exact same, already-established mechanism — consistent with the component's current behavior, not a new divergence from it. Whether "automatic... PDFs" in NFR-LOC-04 was even meant to cover a tenant's own button click (vs. a system-generated attachment) is itself unclear from the text — left for a separate conversation, not resolved here.

## Architecture

One new module, `web/src/lib/formatDate.js` (neutral `lib/`, same precedent as `formatCurrency.js` — already imported by both the admin and tenant sides without complaint, unlike a `features/dashboard/`-rooted helper). It exports one function, `formatFullDate(input, language)`, accepting either a Firestore `Timestamp` (duck-typed via `.toDate`) or a `'YYYY-MM-DD'` string — the only two shapes any real call site in this codebase produces. The string case is parsed into its own local year/month/day components (`new Date(year, month - 1, day)`), never `new Date(theString)` — the latter parses as UTC midnight per spec, which is not a bug for this app's Bucharest-only scope (UTC+2/+3, always ahead of UTC, never rolls the displayed day backward) but is coincidental safety, not structural — the same reasoning `a759890` already established for `dueDayCountdown.js` (CLAUDE.md §7). `TenantLayout.jsx` is refactored onto this shared helper (Task 3) — its existing tests are the proof the refactor changes nothing observable.

## Global Constraints

- The helper reads `language` from the CALLER's `i18n.language` (current interface language) — never `tenancy.preferredLanguage`/any stored field. Every call site passes `i18n.language` explicitly.
- i18n: no new translation keys. `Intl.DateTimeFormat` with a resolved `ro-RO`/`en-US` locale already produces correctly localized month names natively — the same mechanism the banner already relies on. Only the VALUE changes at each site; the field labels (`tenantApp.contract.fields.startDate`, `reports.fields.dueDate`, etc.) are untouched.
- Tests land with the code, fast band (`npm run test:run --prefix web`). Every site gets an explicit two-language assertion (`renderWithProviders(..., { language: 'en' })` plus the RO default) — a test that only checks the Romanian string would pass even with a hardcoded `'ro-RO'` locale and prove nothing about the language plumbing (the exact trap `tenantLayout.test.jsx`'s own L6 test was written to catch).
- Do not change `useReportSummaryCapture`/PDF language behavior. The NFR-LOC-04 conflict above is reported, not fixed.
- `web/src/features/dashboard/calculations.js` (`localeFor`, `formatMonthYearLabel`) and `ReportHistoryRow.jsx`'s cross-import stay untouched — different format shape, not part of this debt.

---

## Task 1: Update `SRS.md` §5.4

**Files:**

- Modify: `SRS.md:373-374`

**Interfaces:** none — text only.

- [ ] **Step 1: Replace the sentence**

Current (`SRS.md:372-374`):

```
The date is formatted in the current interface language
(e.g. "31 ianuarie 2026" / "January 31, 2026"). Other dates in the tenant
portal remain unformatted.
```

New:

```
The date is formatted in the current interface language
(e.g. "31 ianuarie 2026" / "January 31, 2026") — and so is every other
date the tenant sees: the contract period on `/app/contract`, and the due
date wherever a report summary renders. The report-summary due date uses
the same shared component on the public `/r/:shareToken` page and in
exported PDFs/PNGs, so it follows this rule there too, regardless of who
is viewing it.
```

- [ ] **Step 2: Do not commit yet — lands in Task 9's combined commit.**

---

## Task 2: `formatDate.js` helper

**Files:**

- Create: `web/src/lib/formatDate.js`
- Test: `web/tests/formatDate.test.js`

**Interfaces:**

- Produces: `formatFullDate(input, language)` — `input` is a Firestore `Timestamp` or a `'YYYY-MM-DD'` string; `language` is `'ro'`/`'en'` (or anything else, which falls back to `en-US`, matching `TenantLayout.jsx`'s existing `formatEndedDate` and `dashboard/calculations.js`'s existing `formatMonthYearLabel` — same convention, not invented here). Every later task imports this exact name.

- [ ] **Step 1: Write the failing tests**

```js
// web/tests/formatDate.test.js
import { describe, expect, it } from 'vitest'
import { Timestamp } from 'firebase/firestore'
import { formatFullDate } from '@/lib/formatDate'

describe('formatFullDate', () => {
  it('formats a Firestore Timestamp in Romanian', () => {
    const timestamp = Timestamp.fromDate(new Date(2026, 0, 31))
    expect(formatFullDate(timestamp, 'ro')).toBe('31 ianuarie 2026')
  })

  it('formats a Firestore Timestamp in English', () => {
    const timestamp = Timestamp.fromDate(new Date(2026, 0, 31))
    expect(formatFullDate(timestamp, 'en')).toBe('January 31, 2026')
  })

  it("formats a 'YYYY-MM-DD' string in Romanian", () => {
    expect(formatFullDate('2026-07-10', 'ro')).toBe('10 iulie 2026')
  })

  it("formats a 'YYYY-MM-DD' string in English", () => {
    expect(formatFullDate('2026-07-10', 'en')).toBe('July 10, 2026')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:run --prefix web -- formatDate`
Expected: FAIL — `Cannot find module '@/lib/formatDate'`

- [ ] **Step 3: Write the helper**

```js
// web/src/lib/formatDate.js
function localeFor(language) {
  return language === 'ro' ? 'ro-RO' : 'en-US'
}

/** A Firestore Timestamp (duck-typed via `.toDate`) or a plain 'YYYY-MM-DD'
 * string, coerced to a LOCAL-midnight Date. The string case is built from
 * its own year/month/day components — never `new Date(theString)`, which
 * parses as UTC midnight and is only safe here by coincidence (Bucharest is
 * always ahead of UTC), the same reasoning as `dueDayCountdown.js` (CLAUDE.md
 * §7). */
function toLocalDate(input) {
  if (typeof input?.toDate === 'function') return input.toDate()
  const [year, month, day] = input.split('-').map(Number)
  return new Date(year, month - 1, day)
}

/** "31 ianuarie 2026" / "January 31, 2026" (SRS §5.4). `language` is the
 * CURRENT interface language ('ro'/'en') — callers pass `i18n.language`,
 * never a stored preference. */
export function formatFullDate(input, language) {
  return new Intl.DateTimeFormat(localeFor(language), {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(toLocalDate(input))
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:run --prefix web -- formatDate`
Expected: PASS (4/4)

- [ ] **Step 5: Do not commit yet.**

---

## Task 3: Refactor `TenantLayout.jsx` onto the shared helper

**Files:**

- Modify: `web/src/routes/TenantLayout.jsx:16-30` (delete the private `formatEndedDate`, import and call the shared one)
- Test: `web/tests/tenantLayout.test.jsx` — **must pass UNCHANGED.** If any existing assertion needs editing to keep this green, that is a signal this refactor is not behavior-preserving — stop and leave `TenantLayout.jsx` as-is rather than edit the test to fit.

**Interfaces:**

- Consumes: `formatFullDate` (Task 2).

- [ ] **Step 1: Confirm the baseline is green before touching anything**

Run: `npm run test:run --prefix web -- tenantLayout`
Expected: PASS (existing count, unchanged) — this is the "before" snapshot the refactor must reproduce exactly.

- [ ] **Step 2: Replace the private implementation**

Remove lines 16-30 (the `formatEndedDate` function and its doc comment) and the now-unneeded local ternary. Add the import:

```jsx
import { formatFullDate } from '@/lib/formatDate'
```

Change the call site (was `formatEndedDate(tenancy.endedAt, i18n.language)`):

```jsx
{
  showEndedBanner && (
    <div
      role="status"
      className="border-b border-border bg-muted px-4 py-2 text-center text-sm text-foreground"
    >
      {t('tenantApp.endedBanner.message', {
        date: formatFullDate(tenancy.endedAt, i18n.language),
      })}
    </div>
  )
}
```

- [ ] **Step 3: Run the SAME tests again, unmodified**

Run: `npm run test:run --prefix web -- tenantLayout`
Expected: PASS, same count as Step 1, same assertions (including L6's English-locale check) — this is the proof the refactor is behavior-preserving, not a claim.

- [ ] **Step 4: Do not commit yet.**

---

## Task 4: `TenantContractPage.jsx` — `startDate`/`endDate`

**Files:**

- Modify: `web/src/features/tenantApp/pages/TenantContractPage.jsx` (import, `i18n` destructure, the two `ContractField` values)
- Test: `web/tests/tenantApp.contractPage.test.jsx`

**Interfaces:**

- Consumes: `formatFullDate` (Task 2).

- [ ] **Step 1: Write the failing tests**

Add to `web/tests/tenantApp.contractPage.test.jsx`, near CT8/CT9 (which already use the `valueFor(labelText)` helper on the same `ContractField` rows):

```jsx
it('CT13 — startDate and endDate render as long-form dates, not raw ISO', async () => {
  useMyTenancy.mockReturnValue(
    query({
      data: tenancyFixture({ startDate: '2026-01-01', endDate: '2026-12-31' }),
    }),
  )

  await renderWithProviders(<TenantContractPage />)

  expect(valueFor('Dată început')).toHaveTextContent('1 ianuarie 2026')
  expect(valueFor('Dată sfârșit')).toHaveTextContent('31 decembrie 2026')
})

it('CT14 — startDate and endDate follow the interface language, not a hardcoded locale', async () => {
  useMyTenancy.mockReturnValue(
    query({
      data: tenancyFixture({ startDate: '2026-01-01', endDate: '2026-12-31' }),
    }),
  )

  await renderWithProviders(<TenantContractPage />, { language: 'en' })

  expect(valueFor('Start date')).toHaveTextContent('January 1, 2026')
  expect(valueFor('End date')).toHaveTextContent('December 31, 2026')
})
```

(`tenancyFixture()`'s defaults already include `startDate: '2026-01-01'`, `endDate: '2026-12-31'` — the overrides above are explicit for readability, not a behavior change from the file's existing default fixture.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:run --prefix web -- tenantApp.contractPage`
Expected: FAIL — both new tests fail (raw `'2026-01-01'`/`'2026-12-31'` render instead of the formatted strings); CT1-CT11 (existing) still pass, since none of them assert on these two fields' text.

- [ ] **Step 3: Implement**

Change the `useTranslation()` destructure:

```jsx
const { t, i18n } = useTranslation()
```

Add the import:

```jsx
import { formatFullDate } from '@/lib/formatDate'
```

Change the two fields:

```jsx
          <ContractField
            label={t('tenantApp.contract.fields.startDate')}
            value={formatFullDate(tenancy.startDate, i18n.language)}
          />
          <ContractField
            label={t('tenantApp.contract.fields.endDate')}
            value={formatFullDate(tenancy.endDate, i18n.language)}
          />
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:run --prefix web -- tenantApp.contractPage`
Expected: PASS, full file (CT1-CT14).

- [ ] **Step 5: Do not commit yet.**

---

## Task 5: `ReportSummaryView.jsx` — `dueDate`

**Files:**

- Modify: `web/src/components/shared/ReportSummaryView.jsx` (import, `i18n` destructure, the `dueDate` row)
- Test: `web/tests/reportSummaryView.test.jsx` (one existing assertion updated, one new test added)

**Interfaces:**

- Consumes: `formatFullDate` (Task 2).

- [ ] **Step 1: Update the breaking assertion and add the failing two-language test**

In `web/tests/reportSummaryView.test.jsx`, change the existing test (line 84-99):

```jsx
it('renders the final total, due date, and previous arrears/credit', async () => {
  await renderWithProviders(
    <ReportSummaryView
      data={summaryData({
        finalTotal: 2730,
        previousMonthArrears: 100,
        previousMonthCredit: 50,
      })}
    />,
  )

  expect(screen.getByText('2.730,00 lei')).toBeVisible()
  expect(screen.getByText('100,00 lei')).toBeVisible()
  expect(screen.getByText('50,00 lei')).toBeVisible()
  expect(screen.getByText('10 iulie 2026')).toBeVisible()
})
```

(Only the last line changes — `'2026-07-10'` → `'10 iulie 2026'`, the RO-default formatted form of `summaryData()`'s own `dueDate: '2026-07-10'`.)

Add a new test right after it, asserting both languages explicitly:

```jsx
it('renders the due date in the current interface language, not a hardcoded locale', async () => {
  const ro = await renderWithProviders(
    <ReportSummaryView data={summaryData()} />,
  )
  expect(screen.getByText('10 iulie 2026')).toBeVisible()
  ro.unmount()

  await renderWithProviders(<ReportSummaryView data={summaryData()} />, {
    language: 'en',
  })
  expect(screen.getByText('July 10, 2026')).toBeVisible()
})
```

(`ro.unmount()` matters: `renderWithProviders` does not unmount between calls, and the shared i18n singleton means the FIRST tree would also re-render in English once the second call switches the language — producing two elements with the same text and a false "multiple elements found" failure. Discovered while implementing, not anticipated in the original draft.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:run --prefix web -- reportSummaryView`
Expected: FAIL — the updated assertion fails (still renders raw `'2026-07-10'`), the new test fails on both checks.

- [ ] **Step 3: Implement**

Add the import:

```jsx
import { formatFullDate } from '@/lib/formatDate'
```

Change the destructure:

```jsx
const { t, i18n } = useTranslation()
```

Change the `dueDate` row:

```jsx
<div className="flex items-center justify-between">
  <span>{t('reports.fields.dueDate')}</span>
  <span>{formatFullDate(data.dueDate, i18n.language)}</span>
</div>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:run --prefix web -- reportSummaryView`
Expected: PASS, full file.

- [ ] **Step 5: Do not commit yet.**

---

## Task 6: Confirm the shared-component consequence — public page and admin export

**Files:** none modified — verification only, since Task 5 already covers the one render site all three consumers share.

- [ ] **Step 1: Run the full set of `ReportSummaryView` consumers' own test files**

Run: `npm run test:run --prefix web -- sharedReport.page tenantApp.dashboardPage tenantApp.reportDetailPage reportSummaryCapture reports.page`
Expected: PASS across all five files. None of them assert on the raw `dueDate` text directly (confirmed in the inventory above via a targeted grep, not assumed) — Task 5's change flows through to `SharedReportPage`, `TenantDashboardPage`, `TenantReportDetailPage`, the PDF capture pipeline, and the admin's `ExportReportControls` without any of their own tests needing an update. If any of them DO fail here, that is new information contradicting the inventory — stop and re-examine before continuing, rather than patching the failing test to match.

- [ ] **Step 2: Do not commit yet.**

---

## Task 7: Manual browser validation — REQUIRED gate, not optional (CLAUDE.md §9 zone A)

**Files:** none — this task produces no diff. It exists because the fast band cannot catch what it's structurally blind to.

**Why this is required, not a nice-to-have.** CLAUDE.md §9 zone A records exactly this failure shape already happening once: _"The M4 audit declared FR-REP-07b delivered while the export had never produced a valid file — the mock-total test proved correct wiring, but could not structurally detect a real library incompatibility (`oklch`)."_ This sub-stage has the same structural blind spot: `reportSummaryView.test.jsx` and `reportSummaryCapture.test.jsx` mock `html2canvas-pro` at the module boundary (confirmed by their own fast-band nature — no real rasterization happens in jsdom). `Intl.DateTimeFormat` producing a correctly-localized string in a jsdom-rendered React tree is not proof it survives being rasterized into a `<canvas>` and re-encoded as PNG/PDF — a font substitution, a text-rendering quirk in `html2canvas-pro`, or a layout reflow at capture time could all silently corrupt or truncate the date text in a way no DOM-level assertion would ever see. Because `ReportSummaryView` is shared (Task 5's inventory finding), this one render site now needs checking across every surface it reaches, not just the tenant portal named in the task.

- [ ] **Step 1: Boot the stack**

`npm run dev:all` (repo root), then `cd functions && npm run seed` in a second terminal — per CLAUDE.md §5. Confirm the seed includes at least one tenant with an active tenancy (contract dates) and at least one signed report with a `dueDate`, plus (for the banner spot-check) one ended tenancy — `functions/scripts/seed.js` already seeds this shape for prior sub-stages' own manual checks.

- [ ] **Step 2: Tenant portal, both languages**

Log in as the seeded tenant. Visit `/app` (dashboard), `/app/history`, `/app/reports/:reportId` (click into a report), and `/app/contract`. For each, confirm the dates render as long-form text (e.g. "10 iulie 2026"), not raw ISO. Then use the `LanguageSwitcher` to switch to English and repeat all four pages, confirming the SAME dates now read in English (e.g. "July 10, 2026") — not stuck in Romanian, not reverted to raw ISO.

- [ ] **Step 3: The public share link, opened anonymously**

From the admin side, on a signed report, copy the share link (`ExportReportControls`). Open it in a fresh browser context with no session (private/incognito window, or simply log out first) — `/r/:shareToken` must be reachable with zero authentication. Confirm the due date renders formatted, in Romanian by default, and switches to English via the page's own `LanguageSwitcher`.

- [ ] **Step 4: An actual PDF, opened**

From the tenant portal (`DownloadReportPdfButton`) AND from the admin's `ExportReportControls`, click "Download PDF." Open the resulting `.pdf` file (not just confirm a download started) and visually confirm the due date is present, legible, and correctly formatted — not blank, not a broken/substituted glyph, not still raw ISO.

- [ ] **Step 5: An actual PNG, opened**

From the admin's `ExportReportControls` (PNG export is admin-only, FR-REP-07b), click "Download PNG." Open the resulting `.png` file and visually confirm the same as Step 4.

- [ ] **Step 6: Report the outcome explicitly**

For each of Steps 2-5, state what was actually observed (which page, which language, what the date read as) — not a blanket "looks fine." A step that wasn't actually performed must be reported as not performed, not silently assumed to have passed because the fast band was green.

- [ ] **Step 7: Do not commit until this task is complete and reported.**

---

## Task 8: i18n key parity check

**Files:** none — verification only. No new keys were added (see Global Constraints), so this is a NO-OP check, not a step that should find anything.

- [ ] **Step 1: Confirm no locale drift was introduced**

Run: `git diff --stat -- web/src/lib/i18n/locales/`
Expected: empty — this task adds no i18n keys, so there should be no diff under `locales/` at all. An empty diff here is the correct, expected result, not a shortfall.

---

## Task 9: Full fast band and commit

**Files:** none new — verification + commit only.

- [ ] **Step 1: Run the entire fast band**

Run: `npm run test:run --prefix web`
Expected: PASS, full suite (all pre-existing tests, `formatDate.test.js`'s new 4, `tenantApp.contractPage.test.jsx`'s new 2, `reportSummaryView.test.jsx`'s 1 updated + 1 new).

- [ ] **Step 2: `git status` / `git diff` sanity check**

Confirm the changed-file list is exactly: `SRS.md`, `web/src/lib/formatDate.js` (new), `web/tests/formatDate.test.js` (new), `web/src/routes/TenantLayout.jsx`, `web/src/features/tenantApp/pages/TenantContractPage.jsx`, `web/tests/tenantApp.contractPage.test.jsx`, `web/src/components/shared/ReportSummaryView.jsx`, `web/tests/reportSummaryView.test.jsx`, plus this plan file. No locale file diff (Task 8). No `functions/`/`firestore.rules` diff.

- [ ] **Step 3: Commit**

Commit type: **`feat:`** — argued explicitly, because the discriminator here is the OPPOSITE of `c8a7c53`'s (the Retry-button sub-stage, also `fix:`). There, the SRS already required the behavior and the code hadn't caught up — closing a spec-vs-shipped gap. Here, `SRS.md:373-374` currently REQUIRES the behavior being changed ("other dates... remain unformatted") — this sub-stage changes the spec itself (Task 1) and then implements the new spec. That is not a defect being repaired; it is new, deliberately-chosen product behavior plus its SRS update — the honest label is `feat:`, not `fix:`, even though both sub-stages are about dates and both close named debt items.

```bash
git add SRS.md \
        web/src/lib/formatDate.js \
        web/tests/formatDate.test.js \
        web/src/routes/TenantLayout.jsx \
        web/src/features/tenantApp/pages/TenantContractPage.jsx \
        web/tests/tenantApp.contractPage.test.jsx \
        web/src/components/shared/ReportSummaryView.jsx \
        web/tests/reportSummaryView.test.jsx \
        docs/superpowers/plans/2026-08-14-m7-substage6a-date-formatting.md

git commit -m "$(cat <<'EOF'
feat: format every date the tenant sees, not just the ended-contract banner

SRS §5.4 explicitly required every date except the persistent banner to
stay raw ISO; this changes that rule (SRS.md updated in the same commit)
and implements it. That carve-out was never a design choice - the M5
sub-stage 9 plan that introduced it (40b1107) says outright it was
scope management for that sub-stage alone, deliberately deferred to M7
rather than decided as correct. A new shared helper, formatDate.js, is
applied to the contract period on /app/contract and to the report due
date, both previously plain 'YYYY-MM-DD' text. TenantLayout's own
banner is refactored onto the same helper instead of keeping a private
duplicate.

The due-date fix lands inside ReportSummaryView, a component shared with
the public /r/:shareToken page and the admin's PDF/PNG export - there is
no way to scope it to the tenant portal alone, and the inventory in the
plan confirms neither of those two other consumers has a test asserting
the old raw string, so nothing else needed updating.

The admin's own MonthlyReportPage never had this problem: its due-date
field is always a native <input type="date">, never rendered as inert
text.

Language always follows the CURRENT interface language (i18n.language),
never the tenant's stored preferredLanguage - matching the banner's own,
already-correct behavior. NFR-LOC-04 ("PDFs follow preferredLanguage")
already conflicts with how the shared component's exported PDFs render
every other label, before this change; that conflict is documented in
the plan, not resolved here.

Manually verified beyond the fast band (Task 7 of the plan) - the fast
band mocks html2canvas-pro, so it cannot prove the formatted date
survives rasterization: tenant portal in both languages, /r/:shareToken
opened anonymously, and an actual PDF and PNG opened and read. The M4
audit's own lesson (CLAUDE.md §9 zone A) is that a green mocked-export
test previously certified a file that never rendered.
EOF
)"

git status
```

**Do not run this task's commands yet — reported for review. Execution starts only once the plan itself is approved.**

---

## Self-review

**Spec coverage:** both raw-ISO sites named in the task (dashboard/history/report-detail/contract-page/PDF) are covered — `dashboard`/`history`/`report-detail`/PDF all resolve to the SAME `ReportSummaryView` site (Task 5), `contract-page` is its own site (Task 4). The SRS contradiction the inventory surfaced is resolved as Task 1, not silently absorbed into the code tasks.

**Placeholder scan:** every step has literal before/after code or fully-written tests; no "add appropriate formatting" language anywhere.

**Type/name consistency:** `formatFullDate(input, language)` (Task 2) is the only signature used across Tasks 3-5 — no site invents a different name or argument order.

Plan saved to `docs/superpowers/plans/2026-08-14-m7-substage6a-date-formatting.md`.

**Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**
