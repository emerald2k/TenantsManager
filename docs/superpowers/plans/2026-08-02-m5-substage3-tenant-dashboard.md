# M5 Sub-stage 3 — Tenant dashboard (`/app`, FR-TAPP-01) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. This
> project's own gate discipline (CLAUDE.md §2) overrides the generic skill's
> per-task commit steps. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** replace the `/app` `PlaceholderPage` with the real tenant dashboard
(FR-TAPP-01, SRS §5.4) — the central card showing the tenant's most recent
SIGNED report, its month prominent, a four-state payment badge, and the full
line-by-line breakdown, reusing the sub-stage 2 data layer (`useMyTenancy`,
`useMySignedReports`, `adaptTenantReportSummary`, commit `0441973`) and the
M4 `ReportSummaryView` component, extended (not duplicated) with two more
default-preserving props. `/app/history` and `/app/contract` stay
`PlaceholderPage` — out of scope here.

**Architecture:** one new page (`TenantDashboardPage`) and one new small
presentational component (`PaymentStatusBadge`), both under
`web/src/features/tenantApp/`. No new data hook is needed — `useMySignedReports`
already returns the tenant's signed reports sorted newest-first (sub-stage 2:
"Chronological ordering... newest month/year first"), so "the most recent
signed report" is simply `reports[0]`. `adaptTenantReportSummary` is
consumed exactly as sub-stage 2 built it, unmodified. `ReportSummaryView`
gains two new default-preserving props (Task 0, same mechanism as
`showCalculatedTotal` from sub-stage 2) so the page can own its own header
and payment badge instead of rendering both the page's own and the
component's built-in ones side by side.

**Tech stack:** no new dependencies. Reuses `formatMonthYearLabel`
(`web/src/features/dashboard/calculations.js`, already used by the ADMIN
`CurrentMonthPage` — a pure `Intl.DateTimeFormat` wrapper, "iulie 2026" /
"July 2026") for the prominent month heading, rather than writing a second
formatter. Cross-feature import (`tenantApp` → `dashboard`) — noted, not
relocated; it's a pure, stateless utility with no admin-specific data.

---

## Global constraints

- **Zero SRS edits.** Every decision below is already pinned in `SRS.md` at
  FR-TAPP-01 (§3.7) and the `/app` paragraph (§5.4), as they read after
  `dce518e` and `a77a9da` — read from the file, quoted below, not from memory
  per your instruction.
- **Zero Security Rules changes.** Reuses exactly the reads sub-stage 2
  already exercises against the existing `tenancies`/`monthlyReports` rules.
- `getDocs`/`getDoc` only (inherited from the reused hooks) — nothing new
  reads/writes Firestore directly from the page.
- `ReportSummaryView.jsx` **is modified** — Task 0, by the SAME mechanism as
  `showCalculatedTotal` (sub-stage 2, `0441973`): two new props,
  `showPaymentStatus`/`showHeader`, both defaulting to `true` so
  `/r/:shareToken` and the admin PDF/PNG export render byte-for-byte
  identically to today. `adaptTenantReportSummary` and the sub-stage 2 hooks
  stay unmodified.
- Currency/date formatting stays through the existing helpers
  (`formatCurrency`, `formatMonthYearLabel`) — no new formatting logic.
- All new visible text goes through i18n (RO/EN) — listed in full under
  "File structure."

### SRS text this plan implements (quoted verbatim from the file, current state)

`SRS.md:221` (FR-TAPP-01, full current text):

> Dashboard: current month total (the final total), due date, payment
> status, breakdown by lines (rent + maintenance + all active services +
> other + arrears/credit), with **each line's notes and attachments
> visible** (the supporting invoice next to its amount). For a tenant whose
> tenancy has ended, the dashboard shows the last signed report in the same
> format, labelled explicitly as the final month of the contract — never
> presented as "the current month". The dashboard shows the most recent
> signed report, whichever month it belongs to — not strictly the current
> calendar month, so a report issued late still reaches the tenant
> immediately. The report's month is always displayed on the card. Only
> when no signed report exists at all does the empty state appear. Payment
> status renders as three distinct badges: paid, partial, unpaid, plus a
> fourth neutral state when `paymentStatus` is absent — no payment has been
> recorded yet, which is not the same as an overdue debt.

`SRS.md:373-378` (§5.4, the `/app` paragraph, full current text):

> **`/app`** — central card: the **most recent signed report**, with its
> month shown prominently; total + due date + status badge; full breakdown
> by line, each with its notes and attachments (view/download); "Download
> PDF". No signed report at all → "No report has been published yet." Ended
> tenancy → the same card, filled with the last signed report, carrying a
> **label on the card** ("Final month of the contract") distinct from the
> persistent banner (FR-TAPP-06).

Two clauses in both quotes are **already satisfied structurally, with no
new code needed**, confirmed by reading the existing files rather than
assumed:

- "breakdown by lines (rent + maintenance + all active services + other +
  arrears/credit)" and "each line's notes and attachments visible" — this is
  exactly `ReportSummaryView`'s existing table + footer (previousMonthArrears/
  previousMonthCredit rows), fed by `adaptTenantReportSummary`'s existing
  output. Nothing to add.
- "'Download PDF'" — **out of scope for this sub-stage**, not silently
  dropped: FR-TAPP-04 (client-side PDF per report) is its own requirement,
  planned as a later M5 sub-stage once the export path for the TENANT side is
  decided (the admin's own PDF export, M4 sub-stage 8, is a different flow —
  `ExportReportControls`, admin-only). Flagging this explicitly so its
  absence here reads as a scope boundary, not an oversight.

---

## Decisions already pinned (given, not reopened here)

1. The card shows `finalTotal`, **not** `currentBalance`. `tenancies.currentBalance`
   is never read by this page at all — the absence of that read is the
   guarantee, not a filter applied after reading it.
2. The most recent **signed** report is shown, whichever month — `reports[0]`
   from `useMySignedReports` (already sorted newest-first). The month is
   always visible, prominently. Empty state only when there is no signed
   report at all.
3. Payment badge, four states: `paid` / `partial` / `unpaid` / a neutral
   state when `paymentStatus` is absent (`null`) — distinct from `unpaid`.
4. Ended tenancy: same card, last signed report, **a label on the card**
   ("Final month of the contract"). The persistent contract-ended banner
   (FR-TAPP-06) is **not** built here — that is sub-stage 8.
5. Reuses `useMyTenancy`, `useMySignedReports`, `adaptTenantReportSummary`
   from `0441973`, unmodified.
6. `ReportSummaryView`'s own header and payment-status row are suppressed on
   this page (`showHeader={false}`, `showPaymentStatus={false}` — Task 0);
   the page renders `tenancy.property.name` and the prominent month in its
   OWN header instead of passing `propertyName` through to the component.
   This supersedes, for THIS caller only, the sub-stage 2-built `propertyName`
   prop mechanism — that mechanism itself is untouched, still available to
   any caller that wants `ReportSummaryView`'s own header (`SharedReportPage`,
   `ExportReportControls` — neither changes).
7. `AttachmentBadge` stays inert in this sub-stage too — clickable rendering
   is sub-stage 5, together with the report detail page.

## Note: payment status and month appear exactly once

Task 0 exists specifically so nothing is shown twice: the page (Task 2) owns
the header (property name + the prominent month) and the payment badge;
`ReportSummaryView` (`showHeader={false}`, `showPaymentStatus={false}`) owns
only the cost-line table and the footer's totals/arrears/credit/due-date
rows. Each piece of information appears in exactly one place on the
rendered card.

---

## File structure

**Create:**

- `web/src/features/tenantApp/pages/TenantDashboardPage.jsx`
- `web/src/features/tenantApp/components/PaymentStatusBadge.jsx`
- `web/tests/tenantApp.paymentStatusBadge.test.jsx`
- `web/tests/tenantApp.dashboardPage.test.jsx`

**Modify:**

- `web/src/components/shared/ReportSummaryView.jsx` — Task 0: two new
  default-preserving props, `showPaymentStatus`/`showHeader`.
- `web/tests/reportSummaryView.test.jsx` — Task 0: three new tests (R1-R3)
  appended to the existing C1-C3.
- `web/src/routes/index.jsx` — the `/app` route's element changes from
  `<PlaceholderPage titleKey="pages.tenantDashboard" />` to
  `<TenantDashboardPage />`. `/app/history` and `/app/contract` untouched.
- `web/src/lib/i18n/locales/en.json`, `web/src/lib/i18n/locales/ro.json` —
  new keys (exact values below).

**Untouched, confirmed:** `SRS.md`, `firestore.rules`, `storage.rules`,
`web/src/features/tenantApp/hooks.js`, `web/src/features/tenantApp/reportAdapter.js`,
`/app/history`, `/app/contract`, `web/src/routes/TenantLayout.jsx` (already a
real, working shell — no change needed to host a real page in its
`<Outlet/>`), every admin-side file including
`web/src/features/reports/components/ExportReportControls.jsx` (the OTHER
real caller of `ReportSummaryView`, alongside `SharedReportPage` — neither
passes either new Task 0 prop, per its default-preserving guarantee),
`web/tests/sharedReport.page.test.jsx` (must stay green, UNCHANGED — see
Task 0's paired tests), `pages.tenantDashboard` (its i18n key is left in
place, simply unused from now on — same precedent as `pages.sharedReport`
after M4 sub-stage 8 replaced that placeholder; not cleaned up here either).

### New i18n keys (both locales, exact values)

| Key                                                                                                                                                                         | EN                                                 | RO                                                  |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- | --------------------------------------------------- |
| `tenantApp.dashboard.empty`                                                                                                                                                 | "No report has been published yet."                | "Niciun raport nu a fost publicat încă."            |
| `tenantApp.dashboard.noTenancy`                                                                                                                                             | "No property is assigned to your account yet."     | "Nu ai nicio locuință atribuită momentan."          |
| `tenantApp.dashboard.error`                                                                                                                                                 | "Could not load your dashboard. Please try again." | "Nu am putut încărca panoul tău. Încearcă din nou." |
| `tenantApp.dashboard.endedLabel`                                                                                                                                            | "Final month of the contract"                      | "Ultima lună a contractului"                        |
| `reports.payment.statusNotRecorded` (new 4th state, added to the EXISTING `reports.payment` namespace — kept with its three siblings rather than fragmented into a new one) | "No payment recorded yet"                          | "Fără plată înregistrată"                           |

`tenantApp.dashboard.empty` and the SRS's own "No report has been published
yet." wording are worded identically on purpose. `reports.payment.statusPaid`
/ `statusPartial` / `statusUnpaid` (existing) are reused as-is by
`PaymentStatusBadge` for the other three states — checked for overlap before
adding anything new, per the established convention.

**Note on `reports.payment.statusPaid`/`statusPartial`/`statusUnpaid`
duplication:** `PaymentStatusBadge` hard-codes its own copy of the
`{paid,partial,unpaid} → key` map (identical to `ReportSummaryView`'s private
`PAYMENT_STATUS_KEY`) rather than importing it, because `ReportSummaryView`
doesn't export it and isn't being touched (see above). Three duplicated
lines, disclosed rather than silently introduced — same discipline as the
KYC schema duplication CLAUDE.md §7 already documents, at a much smaller
scale.

---

## Task 0: `web/src/components/shared/ReportSummaryView.jsx` — two more default-preserving props

**What it does (behavior change):** two new props, exactly the same
mechanism sub-stage 2 already used for `showCalculatedTotal`:

- `showPaymentStatus = true` — when `false`, the footer's payment-status row
  (`{t('reports.payment.title')}` + the paid/partial/unpaid label) is not
  rendered at all.
- `showHeader = true` — when `false`, the top `<div>` block
  (`<h2>{propertyName}</h2>` + `<p>{month}/{year}</p>`) is not rendered at
  all.

Both default to `true`, reproducing `/r/:shareToken` and the admin PDF/PNG
export's current output byte-for-byte — neither `SharedReportPage` nor
`ExportReportControls` passes either prop, so nothing about their rendered
output changes. Enables Task 2's dashboard to own its own header and payment
badge (see the "Note" above) instead of duplicating them alongside
`ReportSummaryView`'s built-in ones.

### Paired tests — `web/tests/reportSummaryView.test.jsx` (three more tests appended, alongside the existing C1-C3)

| #   | Test                                                                                                                                                                                                                                                                            | Anti-vacuity injection                                                                                                                                                                                                                                                                         |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | No new props passed (the existing call shape — e.g. the file's original "renders the property name, month/year, and the rent/maintenance lines" test): BOTH the header block (property name + month/year) AND the payment-status row are present — today's behavior, unchanged. | Run TWICE, once per default: (i) change `showPaymentStatus = true` to `showPaymentStatus = false` in the implementation — confirm the test's payment-row assertion fails; revert; (ii) change `showHeader = true` to `showHeader = false` — confirm the test's header assertion fails; revert. |
| R2  | `showPaymentStatus={false}`: the payment-status label (e.g. "Neachitat") is NOT in the DOM; the header and the cost-line table still are.                                                                                                                                       | Ignore the prop in the implementation (the row always renders regardless) — confirm the test fails (the label is still found).                                                                                                                                                                 |
| R3  | `showHeader={false}`: the property name and the `{month}/{year}` text are NOT in the DOM; the cost-line table still is.                                                                                                                                                         | Ignore the prop in the implementation (the header always renders regardless) — confirm the test fails (the name/month text is still found).                                                                                                                                                    |

`web/tests/sharedReport.page.test.jsx` is left **unmodified** and must keep
passing green, unchanged — that page never passes either new prop, so its
continued green pass is the concrete proof that today's one real production
caller renders exactly as before.

---

## Task 1: `web/src/features/tenantApp/components/PaymentStatusBadge.jsx`

**What it does (behavior):** a small presentational badge, pure function of
one prop. `paymentStatus` is exactly what `adaptTenantReportSummary` already
produces: `'paid' | 'partial' | 'unpaid' | null`. Renders a colored pill
(same `rounded-full px-2 py-0.5 text-xs font-medium` shape as the existing
`StatusBadge` in `tenants/pages/TenantsListPage.jsx` — mirrored, not
imported, since that one is keyed on `users.status`, a different enum) with
the matching i18n label. `null`/`undefined` maps to the NEW neutral state,
**never** silently collapsed into `unpaid` — that collapse is exactly the bug
decision #3 exists to prevent.

### Paired tests — `web/tests/tenantApp.paymentStatusBadge.test.jsx`

| #   | Test                                                                                                                                                                                        | Anti-vacuity injection                                                                                                                                                                                         |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1  | `paymentStatus="paid"` renders "Achitat"/"Paid" (RO/EN).                                                                                                                                    | Point the `'paid'` lookup at the `unpaid` key instead — confirm the test fails (wrong label).                                                                                                                  |
| P2  | `paymentStatus="partial"` renders "Parțial achitat"/"Partial paid".                                                                                                                         | Remove the `'partial'` case from the lookup map — confirm the test fails (falls through to `undefined`/wrong label).                                                                                           |
| P3  | `paymentStatus="unpaid"` renders "Neachitat"/"Unpaid".                                                                                                                                      | Remove the `'unpaid'` case — confirm the test fails.                                                                                                                                                           |
| P4  | `paymentStatus={null}` (and, separately, the prop simply omitted) renders "Fără plată înregistrată"/"No payment recorded yet" — explicitly asserting this text is NOT "Neachitat"/"Unpaid". | Change the fallback from `paymentStatus ?? 'notRecorded'` to `paymentStatus ?? 'unpaid'` — confirm the test fails because the badge now shows "Neachitat", reproducing the exact collapse decision #3 forbids. |

---

## Task 2: `web/src/features/tenantApp/pages/TenantDashboardPage.jsx`

**What it does (behavior):**

1. Reads `user` from `useAuth()` (`@/features/auth/useAuth`) — guaranteed
   present here, since `ProtectedRoute allowedRole="tenant"` already gates
   this route on an authenticated session before it can render.
2. `useMyTenancy(user.uid)` and `useMySignedReports(user.uid)`.
3. **Loading:** either query still pending → `t('common.loading')`, nothing
   else rendered.
4. **Error:** either query `isError` → `t('tenantApp.dashboard.error')`.
   (No retry button — see "Note on the error state" below.)
5. **No tenancy at all** (`tenancyQuery.data === null`) →
   `t('tenantApp.dashboard.noTenancy')`. In practice this is reached via the
   sub-stage 2 edge case (an `ended` tenancy missing `endedAt`, B4b), not a
   normal "brand-new tenant" path — `finalizeKyc` always creates a tenancy
   together with the account.
6. **Empty** (tenancy resolved, but `reportsQuery.data` is `[]`) →
   `t('tenantApp.dashboard.empty')` — the exact SRS wording.
7. **Normal render** (tenancy resolved, `reports[0]` exists): one bordered
   card containing, top to bottom, ALL owned by the page itself (Task 0's
   `showHeader`/`showPaymentStatus` suppress `ReportSummaryView`'s own
   copies of the same information):
   - the page's OWN header: `tenancy.property?.name` (heading) + the
     prominent month (`formatMonthYearLabel(report.month, report.year,
i18n.language)`) + `<PaymentStatusBadge paymentStatus={report.paymentStatus ?? null} />`;
   - if `tenancy.status === 'ended'`: the ended-label line
     (`t('tenantApp.dashboard.endedLabel')`);
   - `<ReportSummaryView data={adaptTenantReportSummary(report)} showHeader={false} showPaymentStatus={false} />`
     — table + footer totals/arrears/credit/due-date only; no `propertyName`
     prop is passed, since the header it would feed is suppressed.

**Note on the error state:** every existing page in this codebase (checked:
`PropertyDetailPage`, admin `DashboardPage`, `CurrentMonthPage`, the reports
mutations) renders a message-only error state — none wires an actual
`.refetch()` retry button, despite CLAUDE.md §5.5 naming "message+'Retry'" as
the cross-cutting rule. This plan follows that ACTUAL established codebase
precedent (message only), for consistency with every sibling page. The
CLAUDE.md §5.5 divergence itself is NOT this sub-stage's to fix — it
predates it and spans every page listed above, not just this one — so it is
logged here as a separate, cross-cutting debt item to be raised at the M5
milestone audit (CLAUDE.md §9), not resolved ad hoc by whichever sub-stage
happens to touch a loading/error state next.

### Paired tests — `web/tests/tenantApp.dashboardPage.test.jsx`

Mocking convention (new for this test file — no prior test mocks
`useAuth`): `vi.mock('@/features/auth/useAuth', () => ({ useAuth: vi.fn() }))`
and `vi.mock('@/features/tenantApp/hooks', () => ({ useMyTenancy: vi.fn(),
useMySignedReports: vi.fn() }))`. `ReportSummaryView`, `PaymentStatusBadge`,
and `adaptTenantReportSummary` are **rendered/run for real** (not mocked) —
same reasoning as sub-stage 2's A5: proving the real pipeline agrees with
itself, not just that each piece matches its own mock.

| #   | Test                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Anti-vacuity injection                                                                                                                                                                                                                                                                                                                                                                |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Both queries `isPending: true` → shows `common.loading`; nothing else in the DOM.                                                                                                                                                                                                                                                                                                                                                                                                                                  | Invert the loading condition (e.g. `if (!tenancyQuery.isPending)`) — confirm the test fails (loading text disappears when it should show, or the real content wrongly appears too early).                                                                                                                                                                                             |
| D2  | Either query `isError: true` → shows `tenantApp.dashboard.error`.                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Remove the `isError` branch — confirm the test fails (falls through to a crash or the wrong state, since `tenancyQuery.data`/`reportsQuery.data` are `undefined` on error, not `null`/`[]`).                                                                                                                                                                                          |
| D3  | `tenancyQuery.data: null` (resolved, no tenancy) → shows `tenantApp.dashboard.noTenancy`; `ReportSummaryView` is NOT rendered.                                                                                                                                                                                                                                                                                                                                                                                     | Remove the `!tenancy` branch — confirm the test fails (attempts `tenancy.property.name` on `null`, or silently proceeds to the wrong state).                                                                                                                                                                                                                                          |
| D4  | Tenancy resolved (`status: 'active'`), `reportsQuery.data: []` → shows `tenantApp.dashboard.empty`.                                                                                                                                                                                                                                                                                                                                                                                                                | Remove the `reports.length === 0` branch — confirm the test fails.                                                                                                                                                                                                                                                                                                                    |
| D5  | Normal render: asserts (a) the prominent month heading text (via `formatMonthYearLabel` for a KNOWN month/year, e.g. "iulie 2026"), (b) the PAGE's OWN header shows the property name from `tenancy.property.name` — its own markup, NOT a prop reaching `ReportSummaryView` (`showHeader={false}` means the component renders no property name at all), (c) a cost-line amount from the report renders (proving `adaptTenantReportSummary` output actually reached `ReportSummaryView`), (d) NO ended-label text. | Three independent injections, run separately: (i) remove the page's own property-name element (its own markup, not a prop pass-through) — confirm (b) fails; (ii) pass `reportsQuery.data[1]` instead of `[0]` to the adapter (with a fixture where `[0]` and `[1]` have different amounts) — confirm (c) fails; (iii) remove the month-heading element entirely — confirm (a) fails. |
| D6  | Ended tenancy (`status: 'ended'`) + a signed report → the ended-label text IS present.                                                                                                                                                                                                                                                                                                                                                                                                                             | Remove the `tenancy.status === 'ended'` conditional (always false) — confirm the test fails.                                                                                                                                                                                                                                                                                          |
| D7  | `PaymentStatusBadge` receives the report's OWN `paymentStatus`, not a hardcoded value — feed a report with `paymentStatus: 'partial'`, assert "Parțial achitat"/"Partial paid" renders on the page.                                                                                                                                                                                                                                                                                                                | Hardcode the prop to `null` regardless of `report.paymentStatus` — confirm the test fails (shows the neutral label instead of "partial").                                                                                                                                                                                                                                             |
| D8  | The page trusts `reports[0]` as "the most recent" WITHOUT re-deriving it — feed a mocked `useMySignedReports` result where `reports[0]` is NOT the numerically largest `finalTotal`/latest date (a deliberately "weird" fixture, since sorting is the HOOK's job per sub-stage 2, already tested there) — assert the page shows `reports[0]`'s data specifically.                                                                                                                                                  | Change the page to read `reports.at(-1)` instead of `reports[0]` — confirm the test fails (shows the other report's data).                                                                                                                                                                                                                                                            |

---

## Page states (explicit)

| State                        | Condition                                            | Rendered                                                                                                                                                  |
| ---------------------------- | ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Loading**                  | `tenancyQuery.isPending \|\| reportsQuery.isPending` | `common.loading` text only                                                                                                                                |
| **Error**                    | either query `isError`                               | `tenantApp.dashboard.error` text only                                                                                                                     |
| **No tenancy at all**        | tenancy resolved to `null`                           | `tenantApp.dashboard.noTenancy` text only                                                                                                                 |
| **Empty (no signed report)** | tenancy resolved, `reports.length === 0`             | `tenantApp.dashboard.empty` text only — same message whether the tenancy is active or ended (SRS does not special-case an ended-but-never-signed tenancy) |
| **Active, has report**       | tenancy `status==='active'`, `reports[0]` exists     | full card, no ended-label                                                                                                                                 |
| **Ended, has report**        | tenancy `status==='ended'`, `reports[0]` exists      | full card + `endedLabel` line (no persistent banner — sub-stage 8)                                                                                        |

---

## Browser validation

No temporary debug component needed this time — the real page and hooks
exist, so validation goes through the actual UI:

1. **Route wiring:** log in as the seeded tenant (`chirias@test.ro` /
   `chirias123`), land on `/app`, confirm the real dashboard renders (not the
   `PlaceholderPage` skeleton).
2. **Normal state:** confirm the card shows July 2026 prominently, the
   correct property name, the full cost-line breakdown with correct amounts,
   `finalTotal` (not any `currentBalance`-looking number), and a payment
   badge matching the seeded report's actual `paymentStatus`.
3. **Empty state:** temporarily unsign the seeded report (or point at a
   tenant/property with no signed reports) and confirm
   `tenantApp.dashboard.empty` renders, nothing crashes.
4. **Ended tenancy:** log in as a tenant whose tenancy has `status: 'ended'`
   (seed one if none exists) and confirm the card still renders the last
   signed report, WITH the "Final month of the contract" label, and WITHOUT
   any persistent banner (that's sub-stage 8, not yet built — its absence
   now is correct, not a bug).
5. **Inherited from sub-stage 2, now checkable through real UI (mandatory):**
   - **(a) A draft does NOT leak through.** From the admin UI, open the
     seeded tenant's property and save a NEW month's report WITHOUT signing
     it. Reload `/app` as the tenant — confirm the dashboard still shows the
     PREVIOUS most-recent SIGNED report, never the new draft. Delete the
     temporary draft afterward.
   - **(b) No composite-index error.** With the browser console open while
     `/app` loads, confirm no "The query requires an index" error appears
     for `useMySignedReports`'s two-`where` query.
   - **(c) An attachment's URL genuinely downloads.** Using React DevTools'
     Components panel (no code change needed), select the mounted
     `ReportSummaryView`, inspect its `data` prop, find a cost line's
     `attachments[0].url` (a real Storage download URL — `AttachmentBadge`
     itself stays inert, so this is not a page click, it's a props
     inspection), paste that URL into a new browser tab, and confirm the
     file actually downloads.
6. Toggle RO/EN via the existing `LanguageSwitcher` in `TenantLayout` and
   confirm every new string above (empty/noTenancy/error/endedLabel/the four
   payment badge states) renders correctly in both languages.

---

## Risks identified and how the plan covers them

1. **`tenancy.property.name` assumed present.** If the denormalization sync
   (`onPropertyUpdate`) ever silently failed for an older tenancy, the
   heading would render blank rather than crash (same "trust the
   denormalized field" posture `ExportReportControls` already takes with
   `property?.name ?? null`) — no new validation added, since nothing in
   scope asks for one; noted rather than silently assumed to be impossible.
2. **The page trusts `reports[0]` as "most recent" without re-deriving it,**
   so a future change to `useMySignedReports`'s sort (sub-stage 2) that
   flips the order would silently break this page with no compiler signal.
   — Covered by D8, which pins today's contract at the PAGE level
   independently of the hook's own tests, so a regression is caught twice.
3. **The "no tenancy at all" state is reachable in production only through
   a data anomaly** (an `ended` tenancy missing `endedAt`, sub-stage 2's B4
   case), not a normal flow — a developer reading this page's code in
   isolation might assume it's dead code and remove it. — Documented
   explicitly in the state table and D3's test, so the branch's reason for
   existing is traceable without re-deriving it from the sub-stage 2 plan.
4. **No dedicated routing-level test asserts `/app` renders
   `TenantDashboardPage`** — consistent with the rest of the codebase (no
   other route has one either: `/admin`, `/admin/properties/:id`, etc. are
   all unverified at the routing layer, only at the component layer). —
   Covered by browser-validation step 1, the same substitute every prior
   sub-stage has used for this exact gap.
5. **The error-state precedent question** (message-only vs. CLAUDE.md's
   literal "message+Retry" wording) is a real, pre-existing discrepancy that
   spans every page in the codebase, not manufactured for this plan. — This
   plan follows the existing message-only precedent and logs the divergence
   as a separate debt item for the M5 milestone audit (CLAUDE.md §9), rather
   than letting this or any other single sub-stage quietly decide it for the
   whole app.

---

## Phases & commit proposal (for when implementation is approved — not part of this step)

One cohesive unit — Task 0 (the two new `ReportSummaryView` props) is a
small, backward-compatible extension with no dependents besides Task 2;
Task 1 (badge) is independent of Task 0. Splitting these three into separate
commits would only add churn. Recommendation: **one `feat:` commit** (all
three tasks, TDD RED→GREEN per task, each anti-vacuity injection actually
run and reverted, same discipline as sub-stage 2), gated on `npm run lint`,
`npm run test:run --prefix web`, and the full browser-validation list above
— all reported with raw output before asking for the commit. This plan
document itself, if approved, would normally be its own `docs:` commit, per
the same pattern as every prior sub-stage plan.
