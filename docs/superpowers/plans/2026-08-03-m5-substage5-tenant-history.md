# M5 Sub-stage 5 — Report history (`/app/history`, FR-TAPP-02) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. This
> project's own gate discipline (CLAUDE.md §2) overrides the generic skill's
> per-task commit steps. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** replace the `/app/history` `PlaceholderPage` with the real report
history (FR-TAPP-02, SRS §5.4) — an accordion grouped by year, all years
closed on page load, each year holding one summary row per signed report
(month, final total, amount paid, status badge). No inline breakdown; a row's
click-through to `/app/reports/:reportId` is explicitly **out of scope**,
deferred to sub-stage 6.

**Architecture:** one new page (`TenantHistoryPage`), one new pure grouping
module (`groupReportsByYear`), one new presentational row
(`ReportHistoryRow`), and one new shadcn/ui primitive (`accordion.jsx`, over
the already-installed `radix-ui` package's `Accordion` export) — all under
`web/src/features/tenantApp/` / `web/src/components/ui/`. Reuses
`useMySignedReports` (unmodified — sub-stage 2) and `PaymentStatusBadge`
(unmodified — sub-stage 3) exactly as they exist today. `useMyTenancy` is
also reused, for one reason only: distinguishing "no tenancy at all" from
"tenancy exists, zero signed reports" — the same two states the dashboard
already tells apart (sub-stage 3), and both explicitly required by this
sub-stage's own brief. Without that second hook call, a `seed-tenant-free`
(no tenancy) account and a `seed-tenant-empty` (tenancy, zero reports)
account would show the identical empty message, which is not what either the
dashboard precedent or this sub-stage's state list asks for.

**Tech stack:** no new dependencies. `radix-ui@1.6.2` (already installed,
already used for `Dialog`/`Label`) re-exports `Accordion` from
`@radix-ui/react-accordion` — confirmed by reading
`node_modules/radix-ui/dist/index.d.ts:3-4`
(`export { reactAccordion as Accordion }`). A Radix primitive is already
proven interactive in this test suite: `tenants.tenancyTab.test.jsx` opens
and closes a `Dialog` via `userEvent.click` with no extra jsdom polyfill
beyond `web/tests/setup.js`'s existing `jest-dom` registration — the same
`userEvent`-driven approach is used below for the Accordion's expand/collapse.

---

## Global constraints

- **Zero SRS edits.** Every decision below is already pinned in `SRS.md` at
  FR-TAPP-02 (§3.7) and the `/app/history` paragraph (§5.4), as they read
  after `dce518e` and `a77a9da` — read from the file, quoted below, not from
  memory.
- **Zero Security Rules changes.** Reuses exactly the read `useMySignedReports`
  already exercises against the existing `monthlyReports` rule.
- `getDocs` only (inherited from the reused hooks) — nothing new reads/writes
  Firestore directly from the page.
- No new adapter. Unlike the dashboard (which needed `adaptTenantReportSummary`
  to map attachments/notes for a full breakdown), a summary row needs only
  five flat fields that already exist directly on the raw report doc
  `useMySignedReports` returns: `id`, `month`, `year`, `finalTotal`,
  `amountPaid`, `paymentStatus` (confirmed by reading `reportAdapter.js`'s own
  mapping, which reads these same fields off `report.*` with no nesting).
- `formatCurrency` (`web/src/lib/formatCurrency.js:8`,
  `Number(amount) || 0`) already turns `null`, `undefined`, or a missing key
  into `"0,00 lei"` — the "amountPaid null → 0 lei" decision is satisfied by
  reusing this helper unmodified, not by adding a new branch.
- All new visible text goes through i18n (RO/EN) — three new keys, listed
  under "File structure."
- No `<thead>` / column-header row — matches `ReportSummaryView`'s own table,
  which has never had one; column identity comes from position, exactly as
  today's only other report-shaped table in this codebase.

### SRS text this plan implements (quoted verbatim from the file, current state)

`SRS.md:222` (FR-TAPP-02, full current text):

> Report history, grouped by years. The accordion holds one summary row per
> report — month, final total, amount paid, status. The full breakdown (cost
> lines, notes, attachments, PDF) opens on its own page,
> `/app/reports/{reportId}` — not inline in the accordion.

`SRS.md:380-382` (§5.4, the `/app/history` paragraph, full current text):

> **`/app/history`** — accordion by year. Each year lists one **summary row**
> per report: month, total, amount paid, status badge. Clicking a row
> navigates to `/app/reports/{reportId}`. No breakdown inline.

One clause is **explicitly out of scope for this sub-stage, not silently
dropped**: "Clicking a row navigates to `/app/reports/{reportId}`." That
route does not exist yet (`web/src/routes/index.jsx` has no
`/app/reports/:reportId` entry — confirmed by reading the file). Wiring a
click handler to a route that 404s would be worse than no handler at all.
Sub-stage 6 adds both the route and the click together. This plan's rows are
deliberately non-interactive — see Decision 3 and HP7 below.

---

## Decisions already pinned (given, not reopened here)

1. Accordion by year, **all years closed** when the page first renders. This
   is Radix's own default: `Accordion` with `type="multiple"` and no
   `defaultValue`/`value` prop starts with every `AccordionItem` collapsed —
   no extra state management needed to satisfy this.
2. One summary row per report: month, `finalTotal`, amount paid, status
   badge. No breakdown inline — `ReportHistoryRow` renders exactly these
   four pieces of information and nothing else (no cost lines, no notes, no
   attachments).
3. Rows do **not** navigate this sub-stage. `/app/reports/:reportId` and the
   click wiring are sub-stage 6. This plan explicitly builds rows as
   non-clickable (no `onClick`, no `<Link>`, no `role="button"`), and HP7
   below pins that as today's tested contract, flagged for deliberate
   revision (not silent contradiction) once sub-stage 6 lands.
4. Reuses `useMySignedReports` and `PaymentStatusBadge` unmodified. Sorting
   is already client-side in the hook (newest year/month first, sub-stage 2)
   — this page performs no sort of its own, only a single grouping pass over
   the already-sorted array.
5. `amountPaid: null` (or the key absent entirely) renders `"0,00 lei"` —
   `formatCurrency`'s existing behavior, reused as-is (see Global
   constraints).

---

## File structure

**Create:**

- `web/src/components/ui/accordion.jsx`
- `web/src/features/tenantApp/groupReportsByYear.js`
- `web/src/features/tenantApp/components/ReportHistoryRow.jsx`
- `web/src/features/tenantApp/pages/TenantHistoryPage.jsx`
- `web/tests/tenantApp.groupReportsByYear.test.jsx`
- `web/tests/tenantApp.reportHistoryRow.test.jsx`
- `web/tests/tenantApp.historyPage.test.jsx`

**Modify:**

- `web/src/routes/index.jsx` — the `/app/history` route's element changes
  from `<PlaceholderPage titleKey="pages.tenantHistory" />` to
  `<TenantHistoryPage />`. `/app` and `/app/contract` untouched.
- `web/src/lib/i18n/locales/en.json`, `web/src/lib/i18n/locales/ro.json` —
  three new keys (exact values below).

**Untouched, confirmed:** `SRS.md`, `firestore.rules`, `storage.rules`,
`web/src/features/tenantApp/hooks.js`, `web/src/features/tenantApp/reportAdapter.js`,
`web/src/features/tenantApp/components/PaymentStatusBadge.jsx`,
`web/src/features/tenantApp/pages/TenantDashboardPage.jsx`, `/app/contract`,
`web/src/routes/TenantLayout.jsx` (no change needed to host a real page in
its `<Outlet/>`), `web/src/components/shared/ReportSummaryView.jsx`, every
admin-side file, `functions/scripts/seed.js` (sub-stage 4, already committed
— this sub-stage only reads its data, never changes it),
`pages.tenantHistory` (its i18n key is left in place, unused from now on —
same precedent as `pages.tenantDashboard` after sub-stage 3).

### New i18n keys (both locales, exact values)

| Key                           | EN                                                      | RO                                                                  |
| ----------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------- |
| `tenantApp.history.error`     | "Could not load your report history. Please try again." | "Nu am putut încărca istoricul rapoartelor tale. Încearcă din nou." |
| `tenantApp.history.noTenancy` | "No property is assigned to your account yet."          | "Nu ai nicio locuință atribuită momentan."                          |
| `tenantApp.history.empty`     | "You have no report history yet."                       | "Nu ai încă niciun istoric de rapoarte."                            |

`tenantApp.history.noTenancy` deliberately duplicates `tenantApp.dashboard.noTenancy`'s
wording under its own key rather than sharing the dashboard's key — same
sub-stage-scoped-namespace convention sub-stage 3 already established
(`tenantApp.dashboard.*`), not a rename of already-shipped code. No new key
is needed for the payment badge's fourth state or the three existing ones —
`PaymentStatusBadge` is reused unmodified, already covering all four.

---

## Task 1: `web/src/components/ui/accordion.jsx` — new shadcn/ui primitive

**What it does (behavior):** a thin wrapper over `radix-ui`'s `Accordion`
export, following the exact convention `dialog.jsx` already established
(`data-slot` attributes, `cn()` for class merging, named exports, Tailwind
classes for open/closed animation via Radix's `data-[state=open|closed]`
attributes). Four exports: `Accordion` (= `AccordionPrimitive.Root`),
`AccordionItem`, `AccordionTrigger` (wraps `AccordionPrimitive.Header` +
`Trigger`, chevron icon from `lucide-react` — already a dependency, used
today for `dialog.jsx`'s `XIcon` — that rotates via the same
`data-[state=open]` attribute), `AccordionContent`.

**No dedicated test file** — matches the established precedent for every
other shadcn/ui primitive in this codebase (`button.jsx`, `dialog.jsx`,
`input.jsx`, `label.jsx` — confirmed by listing `web/tests/`: none of these
four has a standalone test). Its correctness is exercised entirely through
`TenantHistoryPage`'s own tests (HP5/HP6 below), the same way `Dialog`'s
correctness is exercised entirely through `tenants.tenancyTab.test.jsx`.

---

## Task 2: `web/src/features/tenantApp/groupReportsByYear.js` — pure grouping module

**What it does (behavior):** one exported function,
`groupReportsByYear(reports)`, a single left-to-right pass over the
already-sorted array `useMySignedReports` returns (newest year first, newest
month first within a year — sub-stage 2's contract, not re-verified here).
Starts a new `{ year, reports: [] }` bucket whenever the current report's
`year` differs from the previous one; otherwise pushes onto the current
bucket. Because the input is already grouped-adjacent by construction (same
year is never split by a different year in between, per the hook's own sort),
a single pass — no re-sort, no `Map`, no post-hoc re-ordering — is sufficient
and preserves the hook's order exactly, both across years and within a year.
Returns `[]` for an empty input.

This module exists separately from the page (not inlined) for the same
reason `reportAdapter.js` is its own file rather than inlined into
`TenantDashboardPage.jsx`: a pure, no-I/O transformation gets its own
focused test, independent of rendering.

### Paired tests — `web/tests/tenantApp.groupReportsByYear.test.jsx`

| #   | Test                                                                                                                                                                                                                                                                      | Anti-vacuity injection                                                                                                                                                      |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G1  | A seed-shaped input (2026: Jul, May, Feb, Jan; then 2025: Dec, Nov — i.e. already sorted, exactly `useMySignedReports`'s contract) groups into exactly TWO buckets, `{year:2026, reports:[4 items, in that order]}` then `{year:2025, reports:[2 items, in that order]}`. | Remove the `year` boundary check in the implementation (always start a new bucket per report) — confirm the test fails (6 buckets instead of 2, each with 1 report).        |
| G2  | Empty array input → `[]` output, not `[{year: undefined, reports: []}]`.                                                                                                                                                                                                  | Remove the `if (!current)` initial-bucket guard, letting the loop always reference a starting `current` — confirm the test fails (crashes or returns a stray empty bucket). |
| G3  | A single-report input → exactly one bucket with exactly one report, matching that report's own `id`/`year`.                                                                                                                                                               | Push the report into TWO buckets instead of one (duplicate the `.push` call) — confirm the test fails (bucket count or report count off by one).                            |

---

## Task 3: `web/src/features/tenantApp/components/ReportHistoryRow.jsx` — presentational row

**What it does (behavior):** pure function of one `report` prop (the raw
shape `useMySignedReports` returns). Renders, in this exact column order
(matching FR-TAPP-02's own listed order):

1. Month label — `formatMonthYearLabel(report.month, report.year, i18n.language)`
   (reused as-is from `web/src/features/dashboard/calculations.js`, same
   cross-feature import precedent sub-stage 3 already established for this
   exact helper — no new formatter written).
2. `finalTotal` — `formatCurrency(report.finalTotal)`.
3. Amount paid — `formatCurrency(report.amountPaid)`. Because
   `formatCurrency` computes `Number(amount) || 0`, this renders `"0,00 lei"`
   identically whether `amountPaid` is explicitly `null` (the seed's
   `useCancelPayment`-shaped February row) or the key is **absent entirely**
   (the seed's never-touched July row) — both real shapes the app itself
   produces (M5 sub-stage 4 plan), not one invented case.
4. `<PaymentStatusBadge paymentStatus={report.paymentStatus ?? null} />` —
   unmodified import, same usage as the dashboard.

No breakdown line items (rent/maintenance/service costs/other expenses), no
notes, no attachments — this component never reads those fields off
`report` at all, structurally enforcing "no breakdown inline" rather than
merely omitting a call to render them.

### Paired tests — `web/tests/tenantApp.reportHistoryRow.test.jsx`

| #   | Test                                                                                                                                                                                                                                                                                   | Anti-vacuity injection                                                                                                                                                                                                                                                                          |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H1  | `amountPaid: null` (February-shaped fixture, `paymentStatus: 'unpaid'`) renders `"0,00 lei"` for the paid amount AND "Neachitat"/"Unpaid" for the badge.                                                                                                                               | Change the paid-amount call from `formatCurrency(report.amountPaid)` to `report.amountPaid ?? '-'` — confirm the test fails (shows `"-"` instead of `"0,00 lei"`).                                                                                                                              |
| H2  | `amountPaid` key **absent entirely**, `paymentStatus` key **absent entirely** (July-shaped fixture) renders `"0,00 lei"` for the paid amount AND explicitly the NEUTRAL badge ("Fără plată înregistrată"/"No payment recorded yet") — asserting this text is NOT "Neachitat"/"Unpaid". | Hardcode `paymentStatus={report.paymentStatus ?? 'unpaid'}` on the badge instead of `?? null` — confirm the test fails (shows "Neachitat" instead of the neutral label), reproducing the exact collapse `PaymentStatusBadge`'s own decision #3 forbids, now caught at this row's call site too. |
| H3  | A genuine partial-payment fixture (`finalTotal: 2730`, `amountPaid: 2000`, distinct values) renders BOTH `"2.730,00 lei"` (total) AND `"2.000,00 lei"` (paid) — both present, not just one.                                                                                            | Swap which field feeds which column (`formatCurrency(report.amountPaid)` for the total column and vice versa) — confirm the test fails (the two values appear under the wrong label, caught because the fixture's two amounts are deliberately DIFFERENT, not equal).                           |
| H4  | No cost-line text (e.g. a service name like "Electricitate") appears anywhere in the row's rendered output, even when the fixture is given extra fields (`serviceCosts: [...]`) that a breakdown WOULD read.                                                                           | Add a breakdown render (e.g. import and render `ReportSummaryView`-style line items inside the row) — confirm the test fails (the service name now appears), catching a future "helpful" regression toward inline breakdown.                                                                    |

---

## Task 4: `web/src/features/tenantApp/pages/TenantHistoryPage.jsx`

**What it does (behavior):**

1. Reads `user` from `useAuth()` — same guarantee as the dashboard
   (`ProtectedRoute allowedRole="tenant"` gates this route already).
2. `useMyTenancy(user.uid)` and `useMySignedReports(user.uid)` — the SAME two
   hooks the dashboard calls, for the SAME reason: `useMyTenancy` is read
   ONLY to tell "no tenancy at all" apart from "tenancy exists, zero
   reports" — no field of the resolved tenancy is otherwise displayed on
   this page. (Flagged explicitly here, same as sub-stage 3's own risk #3
   precedent, so a future reader doesn't mistake this call for dead code and
   remove it.)
3. **Loading:** either query still pending → `t('common.loading')`.
4. **Error:** either query `isError` → `t('tenantApp.history.error')`
   (message-only, no retry button — same established codebase precedent
   sub-stage 3 already documented and logged as a separate cross-cutting
   debt item, not re-decided per page).
5. **No tenancy at all** (`tenancyQuery.data === null`) →
   `t('tenantApp.history.noTenancy')`.
6. **Empty** (tenancy resolved, `reportsQuery.data` is `[]`) →
   `t('tenantApp.history.empty')`.
7. **Normal render:** `groupReportsByYear(reportsQuery.data)`, then one
   `Accordion` (`type="multiple"`, no `defaultValue` — all closed by
   default), one `AccordionItem` per year group (`value={String(group.year)}`),
   `AccordionTrigger` showing **the year number alone** (e.g. `"2026"`) as
   the closed-state header — a minimal, literal reading of FR-TAPP-02's
   wording (which specifies row content, not year-header content, in any
   more detail); flagged as a low-risk, easily revisable presentational
   choice, not a hidden behavior (visible and checked in browser validation
   step 1). `AccordionContent` renders one `<ReportHistoryRow report={r} />`
   per report in that year group, in the hook's own order (no re-sort).

### Paired tests — `web/tests/tenantApp.historyPage.test.jsx`

Mocking convention: identical to `tenantApp.dashboardPage.test.jsx`'s
established pattern — `vi.mock('@/features/auth/useAuth', ...)`,
`vi.mock('@/features/tenantApp/hooks', () => ({ useMyTenancy: vi.fn(),
useMySignedReports: vi.fn() }))`. `groupReportsByYear`, `ReportHistoryRow`,
`PaymentStatusBadge`, and the real `Accordion` primitive are rendered/run for
REAL — same reasoning as sub-stage 2's A5 and sub-stage 3's D-series: proving
the real pipeline agrees with itself.

| #   | Test                                                                                                                                                                                                                                                                                                                                                                                                                                      | Anti-vacuity injection                                                                                                                                                                                                                                                                         |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HP1 | Both queries `isPending: true` → shows `common.loading`; nothing else in the DOM.                                                                                                                                                                                                                                                                                                                                                         | Invert the loading condition in the page — confirm the test fails.                                                                                                                                                                                                                             |
| HP2 | Either query `isError: true` → shows `tenantApp.history.error`.                                                                                                                                                                                                                                                                                                                                                                           | Remove the `isError` branch — confirm the test fails.                                                                                                                                                                                                                                          |
| HP3 | `tenancyQuery.data: null` → shows `tenantApp.history.noTenancy`; no accordion/year text rendered.                                                                                                                                                                                                                                                                                                                                         | Remove the `!tenancy` branch — confirm the test fails (attempts to group `undefined` reports, or silently proceeds to the wrong state).                                                                                                                                                        |
| HP4 | Tenancy resolved, `reportsQuery.data: []` → shows `tenantApp.history.empty`; no accordion rendered.                                                                                                                                                                                                                                                                                                                                       | Remove the `reports.length === 0` branch — confirm the test fails.                                                                                                                                                                                                                             |
| HP5 | Normal render with a seed-realistic two-year fixture (2026: Jul/May/Feb/Jan, 2025: Dec/Nov) → BOTH year triggers ("2026","2025") are present, but EVERY row's rendered content (e.g. a specific amount) is NOT visible yet — years start collapsed.                                                                                                                                                                                       | Add `defaultValue={groups.map((g) => String(g.year))}` to the page's own `<Accordion>` element (implementation file, not the test) — confirm the "not visible yet" assertions now fail, since Radix would render both years already expanded.                                                  |
| HP6 | Clicking the "2026" trigger (`userEvent.click`, same driving pattern as `tenants.tenancyTab.test.jsx`'s Dialog) expands it — a specific July row's `finalTotal` amount becomes visible; the "2025" year's content stays hidden.                                                                                                                                                                                                           | Remove the `AccordionContent` wrapper around the rows (render them unconditionally regardless of open state) — confirm HP5's "not visible before the click" assertion breaks, proving HP6's click is what actually reveals the content, not an always-rendered DOM node hidden by coincidence. |
| HP7 | Rows render as plain, non-interactive markup — no `<a>`/`role="link"`/`role="button"` wraps a row, and clicking a row (`userEvent.click`) fires no navigation (no `useNavigate` mock is ever called). **Marked explicitly (code comment + this test's own docstring) as a contract that sub-stage 6 will deliberately supersede**, not an oversight to be silently left contradicting the next sub-stage's own click-through requirement. | Wrap `ReportHistoryRow`'s root element in a `<button>`/`onClick` stub — confirm the "no navigation fired" assertion fails.                                                                                                                                                                     |

### Note on draft-exclusion — no new test proposed at this page, and why

FR-REP-06/08's "a draft is invisible to the tenant" guarantee for
`/app/history` rests on layers that already exist, none of which are at the
page level, because this page adds no filtering of its own — it renders
exactly what `useMySignedReports` returns:

1. **Firestore query semantics.** `useMySignedReports`'s
   `where('status', '==', 'signed')` (`web/src/features/tenantApp/hooks.js:87`)
   makes it mathematically impossible for the query to return a document
   whose `status` is anything but `'signed'` — this is a property of an
   equality filter, not something a test proves or disproves.
2. **The where-clause SHAPE is what could regress**, and that is already
   pinned by `tenantApp.hooks.test.jsx`'s existing **B5** test ("issues the
   query with BOTH `userId==` and `status==signed`") — cited here, not
   duplicated.
3. **`firestore.rules:64-70`** additionally requires, for THIS EXACT query
   shape, that Firestore can prove every possible result document satisfies
   `resource.data.status == 'signed'` from the query's own filters — if the
   where-clause shape ever drifted from the rule's condition, Firestore
   would reject the ENTIRE list request (a visible, immediate error — HP2's
   error state), never partially return an extra draft. `monthlyReports.rules.test.js`'s
   existing "denies the tenant's read of their OWN report while it is still
   a draft" test independently confirms the rule itself correctly gates a
   draft, at the single-document level — cited, not duplicated.
4. Given (1)-(3), a page-level unit test asserting "no draft row appears"
   would necessarily inject a draft into the **mocked** `useMySignedReports`
   return value and then assert it's absent from the rendered rows — which
   only proves the test's own fixture assertion is self-consistent, not that
   production code would ever exclude a real draft (the mocked hook would
   dutifully render whatever it's told to return, real filtering or not).
   That is exactly the vacuous-test shape CLAUDE.md §7 rules out — no such
   test is added here.

The one genuinely end-to-end proof — the real Firestore emulator, the real
security rule, the real seeded draft — is **mandatory browser-validation
step 1** below, using `seed-tenant`'s actual August 2026 draft
(`functions/scripts/seed.js`'s `OCCUPIED_DRAFT_MONTH`).

---

## Page states (explicit)

| State                         | Condition                                            | Rendered                                                     |
| ----------------------------- | ---------------------------------------------------- | ------------------------------------------------------------ |
| **Loading**                   | `tenancyQuery.isPending \|\| reportsQuery.isPending` | `common.loading` text only                                   |
| **Error**                     | either query `isError`                               | `tenantApp.history.error` text only                          |
| **No tenancy at all**         | tenancy resolved to `null`                           | `tenantApp.history.noTenancy` text only                      |
| **Empty (no signed reports)** | tenancy resolved, `reports.length === 0`             | `tenantApp.history.empty` text only                          |
| **Normal**                    | tenancy resolved, `reports.length > 0`               | accordion, one item per distinct year, all closed by default |

No special "ended tenancy" state at this page — unlike the dashboard, history
access is unconditional once a tenancy and reports exist (FR-TAPP-06: history
stays reachable after the contract ends); the persistent contract-ended
banner is cross-page and lands at sub-stage 8, not duplicated here.

---

## Browser validation

Concrete expected values below, computed from `functions/scripts/seed.js`'s
own `foldReportChain` output (M5 sub-stage 4 plan §1's worked tables) — a
comparison to run against, not a vibe check.

1. **`chirias@test.ro` / `chirias123` (the rich-history account) — the
   mandatory draft-exclusion check.** Log in, open `/app/history`. Confirm
   TWO year triggers: "2026" and "2025", both collapsed. Click "2026" —
   confirm EXACTLY four rows appear, in this order and with these exact
   values, and that **August 2026 (the draft) is absent** from this list
   entirely:

   | Month (newest first) | Final total  | Amount paid  | Badge                                                                                        |
   | -------------------- | ------------ | ------------ | -------------------------------------------------------------------------------------------- |
   | July 2026            | 2.730,00 lei | 0,00 lei     | "Fără plată înregistrată" / "No payment recorded yet" (neutral — `paymentStatus` key absent) |
   | May 2026             | 5.460,00 lei | 5.460,00 lei | "Achitat" / "Paid"                                                                           |
   | February 2026        | 2.730,00 lei | 0,00 lei     | "Neachitat" / "Unpaid" (explicit — distinct from July's neutral badge)                       |
   | January 2026         | 3.460,00 lei | 3.460,00 lei | "Achitat" / "Paid"                                                                           |

   Click "2025" — confirm EXACTLY two rows:

   | Month         | Final total  | Amount paid  | Badge                              |
   | ------------- | ------------ | ------------ | ---------------------------------- |
   | December 2025 | 2.730,00 lei | 2.000,00 lei | "Parțial achitat" / "Partial paid" |
   | November 2025 | 2.730,00 lei | 2.730,00 lei | "Achitat" / "Paid"                 |

2. **`ioana@test.ro` / `chirias123` (empty scenario).** `/app/history` shows
   `tenantApp.history.empty`, no accordion.
3. **`radu@test.ro` / `chirias123` (ended tenancy).** `/app/history` shows
   TWO year triggers, "2026" (one row: January 2026, 1.980,00 lei /
   1.980,00 lei, "Achitat") and "2025" (one row: December 2025, same
   values) — confirms history stays reachable after the contract ended
   (FR-TAPP-06), with no persistent banner yet (sub-stage 8, correctly
   absent).
4. **`cristina@test.ro` / `chirias123` (no tenancy).**
   `tenantApp.history.noTenancy`, no accordion.
5. Toggle RO/EN via `LanguageSwitcher` and confirm all three new strings
   (`error`/`noTenancy`/`empty`) render correctly in both languages.
6. **Rows are confirmed non-interactive.** Click a row directly (not the
   year trigger) on any account above — confirm nothing happens: no
   navigation, no console error, no 404. This is the deliberate, temporary
   state Decision 3 and HP7 describe; sub-stage 6 replaces this specific
   check.
7. With the browser console open while `/app/history` loads, confirm no
   "The query requires an index" error appears — `useMySignedReports`'s
   two-`where` query was already checked for this at sub-stage 3 for the
   dashboard; this page is a second consumer of the exact same hook, so a
   quick re-confirmation here is cheap and closes any doubt that a
   DIFFERENT calling context could trigger a different index requirement.

---

## Risks identified and how the plan covers them

1. **Fast-band tests cannot exercise the real Firestore query filter** (the
   SDK is mocked at the hook boundary, per `hooks.js`'s own docstring). The
   draft-exclusion guarantee is therefore proven across three already-existing
   layers (query semantics, `tenantApp.hooks.test.jsx`'s B5, and
   `monthlyReports.rules.test.js`'s existing draft-deny test) plus one
   mandatory manual check (browser-validation step 1) — not by a new
   page-level unit test, which would necessarily be vacuous (see the "Note on
   draft-exclusion" section above for the full reasoning).
2. **The closed-year header showing only the year number** is a plan-level
   design call — FR-TAPP-02/§5.4 specify row content in detail but not
   closed-header content beyond "accordion by year." Low risk: purely
   presentational, visible and checked in browser-validation step 1, trivial
   to revise later (e.g. adding a report count) without touching any other
   decision in this plan.
3. **`type="multiple"` (years expand independently) vs. `type="single"`
   (only one year open at a time)** is similarly unspecified by the SRS.
   This plan defaults to `multiple` as the more forgiving UX default — also
   presentational, also checked live in browser-validation step 1, also
   trivially revisable.
4. **Rows are deliberately non-interactive this sub-stage** — a future
   contributor skimming `ReportHistoryRow.jsx` in isolation might assume the
   missing click handler is an oversight rather than a deliberate scope
   boundary. Mitigated by: an explicit code comment at the component's
   definition site, Decision 3, and HP7's test docstring all pointing at the
   same fact — sub-stage 6 supersedes this, on purpose.
5. **`accordion.jsx` has no dedicated test file of its own** — matches the
   established precedent for every other shadcn/ui primitive in this
   codebase (`button.jsx`/`dialog.jsx`/`input.jsx`/`label.jsx`, none
   individually tested). Its behavior is exercised entirely through
   `TenantHistoryPage`'s HP5/HP6. If a future page adopts this wrapper under
   different assumptions, it inherits the same accepted gap every other
   primitive already has — not a new one introduced here.
6. **`useMyTenancy` is called on this page but no tenancy FIELD is ever
   displayed** — a future reader might see the unused-looking data and
   remove the call. Documented explicitly in Task 4 point 2 and the page
   states table (the "no tenancy" vs. "empty" distinction depends entirely
   on this call), mirroring how sub-stage 3 flagged its own analogous risk.
7. **No dedicated routing-level test asserts `/app/history` renders
   `TenantHistoryPage`** — same accepted gap as every other route in this
   codebase (sub-stage 3's own risk #4). Covered by browser-validation steps
   1-4, the same substitute every prior sub-stage has used.
8. **`seed-tenant-ended` (radu) exercises only ONE report per year**, never
   a year with several — the "many rows in one year" case is exercised only
   by `seed-tenant` (chirias). Acceptable: the goal is mechanism coverage
   (grouping, expand/collapse, row rendering), not exhaustive per-account
   symmetry: chirias already covers the "several reports, one year" shape
   twice over (four rows in 2026, two in 2025).

---

## Phases & commit proposal (for when implementation is approved — not part of this step)

One cohesive unit — the four new files (accordion primitive, grouping
module, row, page) have a strict dependency chain (page depends on all
three) and no independent shippable value on their own. Splitting into
separate commits would only add churn. Recommendation: **one `feat:` commit**
(all four tasks, TDD RED→GREEN per task, each anti-vacuity injection
actually run and reverted, same discipline as sub-stages 2-4), gated on
`npm run lint`, `npm run test:run --prefix web`, and the full
browser-validation list above — all reported with raw output before asking
for the commit. This plan document itself, if approved, would normally be
its own `docs:` commit, per the same pattern as every prior sub-stage plan.
