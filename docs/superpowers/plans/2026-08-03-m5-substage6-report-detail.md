# M5 Sub-stage 6 — Report detail (`/app/reports/:reportId`, FR-TAPP-02) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. This
> project's own gate discipline (CLAUDE.md §2) overrides the generic skill's
> per-task commit steps. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** build the full-breakdown report detail page, `/app/reports/:reportId`
(FR-TAPP-02, SRS §5.4), reusing `useTenantReport` (sub-stage 2) and
`ReportSummaryView` (unmodified, per this sub-stage's own decisions) with
`showCalculatedTotal={true}`, plus a SharedReportPage-style downloadable
attachments section fed by real Storage URLs. Makes `/app/history`'s rows
navigable to this route — the one deliberate, planned supersedure of
sub-stage 5's HP7 test.

**Architecture:** one new page (`TenantReportDetailPage`), zero new hooks (
`useTenantReport`, already built and tested at sub-stage 2, is used exactly
as-is), zero changes to `ReportSummaryView` or `reportAdapter.js`. The only
OTHER file that changes behavior is `ReportHistoryRow.jsx` — it gains its own
`useNavigate` call, which is the entire mechanism that makes `/app/history`'s
rows clickable. **`TenantHistoryPage.jsx` itself requires ZERO code changes
this sub-stage** — its JSX already renders `<ReportHistoryRow key={report.id}
report={report} />` unchanged; only the row component's own internals gain a
click/keyboard handler. This is stated explicitly here so the minimal diff
reads as a deliberate design outcome, not an omission.

**Tech stack:** no new dependencies. Attachment downloads use a plain
`<a href={att.url} target="_blank" rel="noreferrer">` — the SAME pattern
already shipped twice in this codebase (`ContractUpload.jsx:100`,
`LineAttachments.jsx:96`), not `SharedReportPage`'s button-plus-blob-mutation
flow, which exists only because the ANONYMOUS share link cannot expose a
real Storage URL to begin with (`functions/src/sharedReport.js`'s
`toPublicReport` proxies bytes behind an opaque `reference` for exactly that
reason). This page's reader is an authenticated tenant reading their OWN
signed document — `reportAdapter.js`'s own docstring already says the real
URL "pass[es] through unmodified, for direct `href` use later." This sub-stage
is "later."

---

## Global constraints

- **`ReportSummaryView.jsx` is NOT modified.** Used exactly as it exists
  today, with `showCalculatedTotal={true}` (an existing, already-tested prop
  — `reportSummaryView.test.jsx`'s C3 already proves it renders the
  calculatedTotal row; this sub-stage's own test proves the PAGE passes it,
  not that the prop itself works — cited, not duplicated) and `propertyName`
  passed explicitly from `tenancies.property.name` (the adapter's output has
  no `propertyName` key, same reason sub-stage 3's dashboard passes it
  explicitly too).
- **Zero SRS edits.** Every decision below is already pinned in `SRS.md` at
  FR-TAPP-02 (§3.7) and the `/app/reports/:reportId` paragraph (§5.4), as it
  reads after `dce518e` — read from the file, quoted below.
- **Zero Security Rules changes.** Reuses exactly the read `useTenantReport`
  already exercises against the existing `monthlyReports` rule.
- **`useTenantReport`, `reportAdapter.js`, `hooks.js` are NOT modified.**
  `useTenantReport` already collapses "doesn't exist" and "permission-denied"
  into the same `null` (sub-stage 2, tested at `tenantApp.hooks.test.jsx`'s
  B6-B8) — this sub-stage's own "null" test proves the PAGE reacts correctly
  to that `null`, not that the collapse itself is correct — cited, not
  duplicated.
- `getDoc` only (inherited from the reused hook) — nothing new reads/writes
  Firestore directly from the page.
- All new visible text goes through i18n (RO/EN) — five new keys, listed
  under "File structure."
- No `<thead>` on the attachments list — matches `SharedReportPage`'s own
  attachments section, which has never had one.

### SRS text this plan implements (quoted verbatim from the file, current state)

`SRS.md:384-388` (§5.4, the `/app/reports/:reportId` paragraph, full current text):

> **`/app/reports/:reportId`** — the full breakdown of a single signed report: every
> cost line with its notes and attachments, arrears/credit, calculated total and final
> total, due date, payment status, "Download PDF", link back to the history. Only the
> tenant's **own, signed** reports are reachable; a foreign or draft `reportId` is
> denied by Security Rules and must render as **not found**, not as a technical error.

`SRS.md:380-382` (§5.4, the `/app/history` paragraph — the clause this sub-stage fulfills):

> Each year lists one **summary row** per report: month, total, amount paid,
> status badge. Clicking a row navigates to `/app/reports/{reportId}`.

**One clause is a planned deferral, not an omission: "Download PDF."** This
sub-stage's decision list (given, not reopened) covers `ReportSummaryView`
reuse, the attachments section, the null state, and the history-row
supersedure — it deliberately does NOT include a PDF button. **Decided: the
button is not implemented in sub-stage 6. FR-TAPP-04 ships at sub-stage 8**,
on BOTH surfaces where SRS §5.4 actually requires it — checked against the
file, not assumed: the `/app` paragraph names "Download PDF" explicitly, and
this page's own paragraph (quoted above) does too. The `/app/history`
paragraph does **not** mention it at all (its own quoted text above lists
only the summary row's four fields and the click-through — no PDF), so
history is not a third surface FR-TAPP-04 needs to land on. Sub-stage 3
already deferred the identical requirement for `/app` with this exact
reasoning: _"FR-TAPP-04 (client-side PDF per report) is its own requirement,
planned as a later M5 sub-stage once the export path for the TENANT side is
decided (the admin's own PDF export, M4 sub-stage 8, is a different flow —
`ExportReportControls`, admin-only)."_ That reasoning still applies, now with
a named destination: sub-stage 8 delivers FR-TAPP-04 for both `/app` and
`/app/reports/:reportId` together, in the same sub-stage that decides the
tenant-side export path — the same "explicitly out of scope, not silently
dropped, next stop named" discipline sub-stage 5 applied to its own deferred
clause (the history row's click-through, at the time, landing here).

---

## Decisions already pinned (given, not reopened here)

1. `ReportSummaryView` is used exactly as-is: `showCalculatedTotal={true}`
   (SRS requires both `calculatedTotal` AND `finalTotal` visible on this
   page — unlike the dashboard, which never shows `calculatedTotal`),
   `propertyName={tenancy?.property?.name ?? null}`.
2. The attachments section is the page's OWN, separate from
   `ReportSummaryView`, modeled on `SharedReportPage`'s. The raw report's
   `url` (a complete, already-tokenized Storage download URL) is used
   directly as the `href` — no mutation, no proxy, no blob conversion.
3. `useTenantReport`'s `null` (document doesn't exist OR the rule rejected
   the read — indistinguishable, by the hook's own design) renders a
   "report not found" message plus an explicit `<Link to="/app/history">`
   (real navigation, never `history.back()` — a user who pasted a foreign id
   directly into the address bar may have no meaningful "back" history at
   all).
4. `/app/history`'s rows become navigable to this route.
   `tenantApp.historyPage.test.jsx`'s HP7 (sub-stage 5: "rows are
   non-interactive... no navigation fired") is **deliberately superseded**,
   not a regression — its own premise (non-interactive rows) is the thing
   this sub-stage exists to change. The replacement test occupies the SAME
   slot with the SAME name, and both the replacement test's docstring AND
   this plan say explicitly that it supersedes sub-stage 5's Decision 3, so
   a future reader diffing `git log` (not just this plan document) sees the
   change was planned.

---

## File structure

**Create:**

- `web/src/features/tenantApp/pages/TenantReportDetailPage.jsx`
- `web/tests/tenantApp.reportDetailPage.test.jsx`

**Modify:**

- `web/src/features/tenantApp/components/ReportHistoryRow.jsx` — gains
  `useNavigate` + `onClick`/`onKeyDown`/`tabIndex` on its root `<tr>` (Task 1).
- `web/tests/tenantApp.reportHistoryRow.test.jsx` — two new tests appended
  (H5, H6 — click and keyboard navigation).
- `web/tests/tenantApp.historyPage.test.jsx` — HP7's BODY is replaced
  in-place (same test name/slot), per Decision 4.
- `web/src/routes/index.jsx` — new route,
  `<Route path="/app/reports/:reportId" element={<TenantReportDetailPage />} />`,
  added under the existing tenant `ProtectedRoute`/`TenantLayout` group. This
  route did not exist in code at all before this sub-stage (unlike
  `/app`/`/app/history`, there is no `PlaceholderPage` to retire here — the
  route is new, not a stub being replaced).
- `web/src/lib/i18n/locales/en.json`, `web/src/lib/i18n/locales/ro.json` —
  five new keys (exact values below).

**Untouched, confirmed:** `SRS.md`, `firestore.rules`, `storage.rules`,
`web/src/features/tenantApp/hooks.js`, `web/src/features/tenantApp/reportAdapter.js`,
`web/src/components/shared/ReportSummaryView.jsx`,
`web/src/features/tenantApp/pages/TenantHistoryPage.jsx` (zero code changes —
see Architecture above), `web/src/features/tenantApp/pages/TenantDashboardPage.jsx`,
`/app/contract`, every admin-side file, `functions/scripts/seed.js`,
`web/src/features/sharedReport/**` (mirrored, not imported — see Task 3).

### New i18n keys (both locales, exact values)

| Key                                           | EN                                              | RO                                                    |
| --------------------------------------------- | ----------------------------------------------- | ----------------------------------------------------- |
| `tenantApp.reportDetail.error`                | "Could not load this report. Please try again." | "Nu am putut încărca acest raport. Încearcă din nou." |
| `tenantApp.reportDetail.notFound`             | "This report could not be found."               | "Acest raport nu a putut fi găsit."                   |
| `tenantApp.reportDetail.backToHistory`        | "Back to history"                               | "Înapoi la istoric"                                   |
| `tenantApp.reportDetail.attachments.title`    | "Attachments"                                   | "Atașamente"                                          |
| `tenantApp.reportDetail.attachments.download` | "Download"                                      | "Descarcă"                                            |

The last two deliberately duplicate `sharedReport.attachments.title`/
`download`'s EXACT wording under their own `tenantApp.reportDetail.*` key
rather than sharing the `sharedReport` namespace — same sub-stage/feature-
scoped-namespace convention sub-stage 5 already established for
`tenantApp.history.noTenancy` (duplicated `tenantApp.dashboard.noTenancy`'s
wording under its own key rather than cross-feature sharing). No new key is
needed for a download-failure message — see Task 3's reasoning on why a
plain anchor has no catchable failure path.

---

## Task 1: `web/src/features/tenantApp/components/ReportHistoryRow.jsx` — make rows navigable

**What it does (behavior change):** the row's root `<tr>` gains `onClick={()
=> navigate(`/app/reports/${report.id}`)}`, `onKeyDown` (Enter/Space →
`event.preventDefault()` + the same `navigate` call), `tabIndex={0}`, and
`cursor-pointer hover:bg-muted/50 focus-visible:bg-muted/50
focus-visible:outline-none` classes — the EXACT mechanism
`TenantsListPage.jsx:260-283` already uses for its own clickable rows
(`onClick`/`onKeyDown`/`tabIndex`, no `role="button"` — matching that
existing precedent exactly, not inventing a new one).

**Why navigation lives HERE, not in `TenantHistoryPage`:** an `<a>`/`<Link>`
cannot legally wrap a `<tr>` inside a `<table>` (invalid HTML, same
constraint `TenantsListPage` already works around with `onClick` instead of
a real link). Putting `useNavigate` inside `ReportHistoryRow` itself — rather
than having `TenantHistoryPage` pass a callback prop down — keeps the
component's prop signature exactly `{ report }`, unchanged from sub-stage 5,
so sub-stage 5's H1-H4 tests need NO changes at all (no new required prop to
thread through every existing fixture call). This is also why
`TenantHistoryPage.jsx` itself needs no code change: it already renders
`<ReportHistoryRow key={report.id} report={report} />`, and that JSX is
unaffected by the row gaining its own internal navigation.

### Paired tests — `web/tests/tenantApp.reportHistoryRow.test.jsx` (two new tests appended to H1-H4)

Mocking convention: PARTIAL `react-router-dom` mock (same pattern as
`properties.createPage.test.jsx`) — `renderWithProviders` already mounts a
real `MemoryRouter`, so only `useNavigate` is swapped out, not the whole
module.

| #   | Test                                                                                                                                                                                           | Anti-vacuity injection                                                                           |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| H5  | Clicking the row (`userEvent.click` on the `row` role) calls `navigate` with exactly `/app/reports/{report.id}` for a fixture whose `id` is e.g. `'dec'`.                                      | Remove the `onClick` handler from the `<tr>` — confirm the test fails (`navigate` never called). |
| H6  | Focusing the row and pressing Enter (`userEvent.keyboard('{Enter}')` or `.type(row, '{Enter}')`) ALSO calls `navigate` with the same path — keyboard parity with `TenantsListPage`'s own rows. | Remove the `onKeyDown` handler — confirm the test fails.                                         |

H1-H4 are unmodified — an added `onClick`/`onKeyDown`/`tabIndex` on the `<tr>`
changes nothing about text content, badge rendering, or cell order, so none
of their existing assertions are affected.

---

## Task 2: `web/tests/tenantApp.historyPage.test.jsx` — HP7 superseded (Decision 4)

**What changes:** HP7's body is replaced in place (same test name, same
slot in the file) — not appended alongside the old one, not deleted without
trace. The NEW HP7 renders the full page with the existing `SEED_REPORTS`
fixture (already in this file, unchanged), expands the "2026" year (as HP6
already does), clicks the May 2026 row (`report.id === 'may'`), and asserts
`navigate` was called with `/app/reports/may`. **The test's own docstring/
comment states explicitly that this supersedes sub-stage 5's Decision 3
("rows are non-interactive")** — not just this plan document, so a reader
who only ever looks at `git log`/the test file itself (not this plan) still
sees the change was intentional.

This is an INTEGRATION-level proof, distinct from H5/H6 (Task 1, isolated
component level): H5/H6 prove `ReportHistoryRow` correctly wires ITS OWN
`report.id` prop into a `navigate` call; this replacement HP7 proves the
ACTUAL id flowing through `useMySignedReports` → `groupReportsByYear` →
the `.map()` in `TenantHistoryPage` → the specific rendered row for May 2026
ends up, end to end, calling `navigate` with the CORRECT path for THAT
report — not a hardcoded string that happens to match H5's own hand-built
fixture.

| #         | Test                                                                                         | Anti-vacuity injection                                                                                                                                                                                         |
| --------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HP7 (new) | Clicking the rendered May 2026 row navigates to `/app/reports/may` (the fixture's own `id`). | Remove `ReportHistoryRow`'s `onClick` handler (same source change as H5's injection) — confirm this INTEGRATION test ALSO fails, proving the page-level wiring, not just the isolated component, is exercised. |

---

## Task 3: `web/src/features/tenantApp/pages/TenantReportDetailPage.jsx`

**What it does (behavior):**

1. `useParams()` for `reportId`, `useAuth()` for `user`, `useMyTenancy(user.uid)`
   (for `propertyName` ONLY — no other tenancy field is displayed; same
   "third consumer of the same 'one relevant tenancy' assumption" posture as
   the dashboard and history pages, see Risks), `useTenantReport(reportId)`.
2. **Loading:** either query pending → `t('common.loading')`.
3. **Error:** either query `isError` → `t('tenantApp.reportDetail.error')`
   (message-only, no retry — established codebase precedent, sub-stage 3).
4. **Null** (`reportQuery.data === null`, sub-stage 2's own indistinct
   collapse of "doesn't exist" and "permission-denied" — this page's job is
   only to REACT to that `null` correctly, not re-prove the collapse itself,
   which `tenantApp.hooks.test.jsx`'s B6-B8 already do) →
   `t('tenantApp.reportDetail.notFound')` plus
   `<Link to="/app/history">{t('tenantApp.reportDetail.backToHistory')}</Link>`
   — real navigation, never `history.back()` (Decision 3).
5. **Valid:** `adaptTenantReportSummary(reportQuery.data)` (unmodified,
   sub-stage 2's second real consumer — its own docstring already
   anticipated this: "attachment `url`s... pass through unmodified, for
   direct `href` use later"), then:
   - `<Link to="/app/history">{t('tenantApp.reportDetail.backToHistory')}</Link>`
     — present here TOO, not just on the not-found state (SRS explicitly
     lists "link back to the history" as part of the full-breakdown page's
     OWN content, not merely an error-recovery affordance).
   - `<ReportSummaryView data={adaptedData} propertyName={tenancyQuery.data?.property?.name ?? null} showCalculatedTotal />`.
   - The page's OWN attachments section, rendered ONLY when
     `attachments.length > 0` (mirroring `SharedReportPage`'s identical
     conditional) — see below.

**Attachments section — modeled on `SharedReportPage`, not imported from it:**
a local `collectAttachments(data)` function, mirroring
`SharedReportPage.jsx:31-38`'s private helper BODY-FOR-BODY (same four
arrays: `rent`, `maintenance`, `serviceCosts.flatMap`, `otherExpenses.flatMap`)
but operating on `adaptTenantReportSummary`'s `{ name, type, url }` shape
instead of `toPublicReport`'s `{ name, type, reference }` — mirrored, not
imported, same "different shape, same structure" precedent
`PaymentStatusBadge` already established relative to `StatusBadge`. Neither
`SharedReportPage.jsx` nor its own `collectAttachments` has a dedicated test
of its own (it's exercised only through that page's rendering tests) — this
sub-stage follows the identical precedent, not a new one.

For each collected attachment: name + type (plain text, same as
`SharedReportPage`'s row), then
`<a href={att.url} target="_blank" rel="noreferrer">{t('tenantApp.reportDetail.attachments.download')}</a>`
— the SAME pattern already shipped twice in this codebase
(`ContractUpload.jsx:100-104`, `LineAttachments.jsx:96-100`), not
`SharedReportPage`'s button-plus-`getSharedReportAttachment`-mutation flow
(that flow exists ONLY because the anonymous share link cannot expose a raw
Storage URL — irrelevant here, since this reader is the authenticated owner
of the document and the URL is already a complete, tokenized download link).
**No `download` attribute** (browsers ignore it for cross-origin URLs
anyway — Firebase Storage URLs are cross-origin from the app's own domain —
so it would be a no-op; the two existing precedents don't use it either).
**No download-error state, no new i18n key for one:** unlike
`SharedReportPage`'s `getAttachment.mutateAsync` (an async call that CAN
reject), a plain anchor has no catchable client-side failure path at all —
there is nothing to observe or handle.

### On the tolerated duplication (per this plan's own point 2 requirement)

`ReportSummaryView`'s `SummaryLineRow` already renders an inert
`AttachmentBadge` (name + type, no click handler) on every cost line,
UNCONDITIONALLY, whenever `attachments?.length > 0` — and this sub-stage's
own Decision 1 forbids modifying `ReportSummaryView` to suppress that. **This
is not a preference for duplication — it is the only available option.**
The single alternative (a new prop, e.g. `showAttachmentBadges={false}`,
mirroring the `showHeader`/`showPaymentStatus` mechanism sub-stage 3 already
used) would require touching a file this sub-stage's decisions explicitly
freeze. Given that constraint, the duplication is corroborated, not merely
tolerated, by existing precedent: `SharedReportPage` ships this EXACT same
duplication today, unchanged — inert per-line badges from `ReportSummaryView`
coexisting with its own separate, clickable "Attachments" section. This
sub-stage reproduces an already-shipped pattern, not a new risk.

### Paired tests — `web/tests/tenantApp.reportDetailPage.test.jsx`

Mocking convention: `useAuth`, `useMyTenancy`, `useTenantReport` mocked at
the module boundary (same as sub-stage 5's page tests). `useParams` PARTIAL-
mocked to a fixed `{ reportId: 'report-1' }` — same exact convention
`sharedReport.page.test.jsx:26-31` already uses for `shareToken`.
`adaptTenantReportSummary` and `ReportSummaryView` are run/rendered for REAL
(same "prove the real pipeline agrees with itself" reasoning as every prior
sub-stage's page tests).

| #   | Test                                                                                                                                                                                                                                                                                                                                     | Anti-vacuity injection                                                                                                                                                                                                                                                  |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RD1 | Either query `isPending: true` → shows `common.loading`; nothing else.                                                                                                                                                                                                                                                                   | Invert the loading condition — confirm the test fails.                                                                                                                                                                                                                  |
| RD2 | Either query `isError: true` → shows `tenantApp.reportDetail.error`.                                                                                                                                                                                                                                                                     | Remove the `isError` branch — confirm the test fails.                                                                                                                                                                                                                   |
| RD3 | `reportQuery.data: null` → shows `tenantApp.reportDetail.notFound` AND a link whose `href` is `/app/history`. Proves the PAGE reacts to `null` correctly — does NOT re-prove `useTenantReport`'s own doesn't-exist/permission-denied collapse (cited: B6-B8).                                                                            | Remove the `!reportQuery.data` branch — confirm the test fails (attempts to adapt/render `null` as a report, or falls through to the wrong state).                                                                                                                      |
| RD4 | Valid report renders the `calculatedTotal` row (proving the page WIRES `showCalculatedTotal={true}` through — does NOT re-prove the prop itself works, cited: `reportSummaryView.test.jsx`'s C3).                                                                                                                                        | Omit the `showCalculatedTotal` prop (falls back to its `false` default) — confirm the test fails (the row disappears).                                                                                                                                                  |
| RD5 | `propertyName` reaching `ReportSummaryView` comes from the MOCKED tenancy's `property.name` (a distinct, deliberately unusual string), not the report's own generic fixture data.                                                                                                                                                        | Hardcode `propertyName` to a literal string instead of reading `tenancyQuery.data?.property?.name` — confirm the test fails (wrong name shown).                                                                                                                         |
| RD6 | The attachments section lists every attachment across ALL four line types (rent, maintenance, one serviceCost, one otherExpense) — a fixture with a distinct, findable attachment name on each of the four.                                                                                                                              | Change `collectAttachments` to gather only `rent`/`maintenance` (drop the `serviceCosts`/`otherExpenses` spreads) — confirm the test fails (the serviceCost/otherExpense attachment names are missing).                                                                 |
| RD7 | Zero attachments anywhere on the report → the attachments section (its heading) is NOT rendered at all.                                                                                                                                                                                                                                  | Remove the `attachments.length > 0` guard (render the section unconditionally) — confirm the test fails (the heading now appears with an empty list).                                                                                                                   |
| RD8 | A given attachment's name appears TWICE in the DOM — once as `ReportSummaryView`'s own inert badge (inside the cost-line table, no `href` ancestor) and once inside THIS page's own attachments section (inside an element with an `href` equal to `att.url`) — pinning the tolerated duplication as real, not merely asserted in prose. | Remove the page's own attachments section entirely — confirm the count drops from 2 to 1 (only `ReportSummaryView`'s inert badge remains), proving the test is actually sensitive to the duplication's SECOND copy, not just to `ReportSummaryView`'s pre-existing one. |
| RD9 | The "back to history" link is present on the VALID render too (not only on the not-found state) — `href` equal to `/app/history`.                                                                                                                                                                                                        | Remove the `<Link>` from the valid-render branch (keep it only on the not-found branch) — confirm the test fails.                                                                                                                                                       |

---

## Page states (explicit)

| State       | Condition                                           | Rendered                                                                                              |
| ----------- | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| **Loading** | `tenancyQuery.isPending \|\| reportQuery.isPending` | `common.loading` text only                                                                            |
| **Error**   | either query `isError`                              | `tenantApp.reportDetail.error` text only                                                              |
| **Null**    | `reportQuery.data === null`                         | `tenantApp.reportDetail.notFound` + link to `/app/history`                                            |
| **Valid**   | `reportQuery.data` is a real report                 | back-to-history link, `ReportSummaryView` (calculatedTotal shown), attachments section (if any exist) |

No fifth "no tenancy" state — unlike the dashboard/history pages, this page's
ONLY use of `useMyTenancy` is the `propertyName` prop, with a defensive
`?? null` fallback for the (data-anomaly, not a real flow) case where it
resolves to `null` — following the given state list literally rather than
inventing a state the decisions don't ask for.

---

## Browser validation

1. **Normal path:** log in as `chirias@test.ro` / `chirias123`, open
   `/app/history`, expand "2026", click the July 2026 row — confirm
   `/app/reports/seed-prop-occupied_2026-07` loads, showing the full
   breakdown (rent, maintenance, electricity, gas lines with their notes),
   arrears/credit, BOTH `calculatedTotal` and `finalTotal` (2.730,00 lei),
   due date, payment badge, "Atașamente" section listing `rent-invoice.pdf`
   and `electricity-invoice.jpg`, and a working "Înapoi la istoric" link.
2. **MANDATORY — attachment download actually works.** On that same July
   2026 report, click "Descarcă" next to `rent-invoice.pdf` — confirm the
   file actually opens/downloads in a new tab (real Storage bytes, not a
   broken link).
3. **MANDATORY — a foreign tenant's reportId pasted directly into the
   address bar renders "not found," not a crash.** While still logged in as
   `chirias@test.ro`, navigate directly to
   `/app/reports/seed-prop-ended_2025-12` (one of `seed-tenant-ended`'s OWN
   signed reports, seeded at M5 sub-stage 4) — confirm
   `tenantApp.reportDetail.notFound` renders, with the back-to-history link,
   and the browser console shows NO stack trace / unhandled error.
4. **MANDATORY — the tenant's OWN draft renders identically "not found."**
   Navigate to `/app/reports/seed-prop-occupied_2026-08` (chirias's own
   August 2026 DRAFT) — confirm the SAME `notFound` message renders. This is
   the ONE case where the access restriction applies to a document the user
   actually OWNS, not a stranger's — if the "doesn't exist" vs. "exists but
   you can't read it" distinction leaks anywhere (a stray field, a console
   error, a different message), it leaks HERE, not on a foreign tenant's
   report (step 3), because this is the only document whose owner is sitting
   in front of the screen to notice. Promoted from "recommended" to
   mandatory for exactly this reason — proving the collapse is genuinely
   indistinct, not merely that "not mine" is denied.
5. **Keyboard navigation:** on `/app/history`, Tab to a row, press Enter —
   confirm it navigates the same as a click.
6. **Ended tenancy:** log in as `radu@test.ro` / `chirias123`, open
   `/app/history`, click into either of the two rows — confirm the detail
   page renders normally (FR-TAPP-06: history stays reachable after the
   contract ends).
7. Toggle RO/EN and confirm all five new strings render correctly in both
   languages.
8. With the browser console open while `/app/reports/:reportId` loads,
   confirm no "query requires an index" error (this is a single-`getDoc`,
   not a query — expected to be a non-issue, confirmed rather than assumed).

---

## Risks identified and how the plan covers them

1. **"Download PDF" (FR-TAPP-04) is a decided deferral, not an open
   question** — not a risk requiring resolution at this gate, kept here only
   as a scope-boundary record. SRS §5.4 requires it on `/app` and on THIS
   page; `/app/history`'s own paragraph does not mention it at all (verified
   by re-reading the quoted text above, not assumed). Decided: sub-stage 6
   ships neither surface's button; sub-stage 8 ships both together, once the
   tenant-side export path is decided (see "SRS text this plan implements,"
   above, for the full reasoning and the sub-stage 3 precedent it extends).
2. **`useMyTenancy` is this page's THIRD consumer of the "one relevant
   tenancy" assumption** (after the dashboard and history pages) — if a
   tenant ever had more than one tenancy across time, `tenancyQuery.data`
   could belong to a DIFFERENT tenancy than the one the viewed report
   actually came from, showing the wrong property name. Pre-existing
   assumption, not new to this sub-stage — SRS's data model does not support
   multi-tenancy-over-time in this phase, and `useMyTenancy`'s own docstring
   already states "the tenant's ONE relevant tenancy." Noted here since this
   is the third page to rely on it, not because this sub-stage introduces
   the assumption.
3. **`useTenantReport`'s `enabled: Boolean(reportId)` means a falsy
   `reportId` leaves the query permanently pending** (TanStack Query never
   resolves a disabled query), which would show `common.loading` forever
   instead of "not found." Not practically reachable — react-router cannot
   match `/app/reports/:reportId` with an empty segment — but noted rather
   than silently assumed impossible, same posture as sub-stage 3's
   "unreachable except via data anomaly" risk.
4. **HP7's replacement is a supersedure, not an addition** — a future reader
   who only sees this plan (not the test file itself) might miss that. Both
   the test's own docstring/comment AND this plan state the supersedure
   explicitly (Decision 4, Task 2) — the redundancy is deliberate.
5. **No `download` attribute on the attachment links** means clicking
   "Descarcă" may open the file in a new tab rather than triggering a native
   save dialog, depending on the browser and the file's
   `Content-Disposition`/`Content-Type` headers from Storage. Matches the
   two existing precedents in this codebase exactly (`ContractUpload.jsx`,
   `LineAttachments.jsx`) — not a regression introduced here, and browser
   validation step 2 checks the REAL behavior rather than assuming it.
6. **`collectAttachments` has no dedicated test of its own** — same accepted
   gap as `SharedReportPage`'s own identical private helper, which also has
   none. Exercised only through RD6/RD7's page-level rendering assertions.

---

## Phases & commit proposal (for when implementation is approved — not part of this step)

Two cohesive but separable units: (a) making history rows navigable
(`ReportHistoryRow.jsx` + its two new tests + HP7's supersedure) and (b) the
new detail page itself. They are dependency-linked in ONE direction only —
(b)'s browser validation requires (a) to actually click through from
`/app/history` — but each has independent test coverage and would leave the
app in a coherent state on its own. Recommendation: **one `feat:` commit**
for both, since splitting them would leave an intermediate commit where
`/app/history` links to a route that doesn't render anything real yet (the
route wouldn't exist until (b) lands) — a worse intermediate state than one
combined commit. TDD RED→GREEN per task, each anti-vacuity injection
actually run and reverted, gated on `npm run lint`, `npm run test:run
--prefix web`, and the full browser-validation list above — all reported
with raw output before asking for the commit. This plan document itself, if
approved, would normally be its own `docs:` commit, per the same pattern as
every prior sub-stage plan.
