# M5 Sub-stage 2 — Tenant report hooks + report adapter — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. This
> project's own gate discipline (CLAUDE.md §2) overrides the generic skill's
> per-task commit steps — see "Phases & commit proposal" below. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** lay the data-access foundation the tenant-facing report pages
(dashboard, history, `/app/reports/:reportId` — all still placeholders, built
in later sub-stages) will consume: three read hooks over
`tenancies`/`monthlyReports`, and a pure adapter turning a raw, owner-read
`monthlyReports` document into the exact shape `ReportSummaryView` already
renders. **No page, no route, no i18n copy is built in this sub-stage** —
this is data-layer only, same split M4 used between "callables + tests"
(Phase 1) and "pages" (Phase 2), except here even the presentational wiring
is deferred, not just the network calls.

**Architecture:** a new `web/src/features/tenantApp/` folder — the first
tenant-only, non-admin feature besides `auth` (shared) and `sharedReport`
(public, unauthenticated). Hooks follow the exact conventions already
established in `properties/hooks.js` / `tenants/hooks.js` / `reports/hooks.js`:
`getDocs`/`getDoc` (never `onSnapshot`), TanStack Query, `null` for "doesn't
exist yet" rather than throwing, identity (`userId`) passed in explicitly by
the caller rather than the hook reaching into `useAuth()` itself — same
separation every existing hook already uses, kept for testability (a hook
under test never needs an `AuthProvider` in its tree).

`ReportSummaryView` (`web/src/components/shared/ReportSummaryView.jsx`, M4
sub-stage 8) is **reused as-is**, not forked — extended with two new,
default-preserving props so the SAME component keeps serving `/r/:shareToken`
and the admin's PDF/PNG export target unchanged, while gaining what the
tenant surfaces need.

**Tech stack:** no new dependencies.

---

## Global constraints

- **Zero SRS edits.** Every requirement this sub-stage touches is already
  pinned by commit `dce518e` (FR-TAPP-01/02/06, §5.1, §5.4). If anything below
  needs an SRS change, STOP and ask.
- **Zero Security Rules changes.** The whole design rests on the EXISTING
  rules, quoted verbatim below — no rule is loosened, tightened, or added.
- `getDocs`/`getDoc` only, never `onSnapshot` (established convention).
- No format validation, no new Firestore fields, no i18n keys — none of the
  three apply to a data-layer-only sub-stage.
- **No production code, no tests, no commit in THIS step.** This document is
  the deliverable. Bogdan reviews it; implementation is a separate, later
  gate.

### Rules this design relies on (quoted, not paraphrased) — `firestore.rules`

```
// tenancies — admin full access; the tenant reads ONLY their own tenancy
match /tenancies/{tenancyId} {
  allow read: if isAdmin() ||
    (request.auth != null && resource.data.userId == request.auth.uid);
  allow write: if isAdmin();
}

// monthlyReports — admin full access; the tenant reads ONLY their own
// SIGNED report. A draft is invisible to the tenant by design (FR-REP-06/08).
match /monthlyReports/{reportId} {
  allow read: if isAdmin() ||
    (request.auth != null &&
      resource.data.userId == request.auth.uid &&
      resource.data.status == 'signed');
  allow write: if isAdmin();
}
```

Both hooks below that touch `monthlyReports` are shaped to match this rule
exactly (`where('userId','==',uid)` + `where('status','==','signed')` for the
list; a single `getDoc` for the detail one, relying on the rule itself to
reject anything the tenant doesn't own or that isn't signed).

---

## Decisions already pinned (given, not reopened here)

1. The tenant portal reads the **raw** `monthlyReports` document (via the
   `own + status=='signed'` rule above) — **not** the `toPublicReport`
   allowlist shape from `functions/src/sharedReport.js` (that shape exists
   for the _anonymous_ `/r/:shareToken` case and deliberately hides `url`
   behind a proxied `reference`; the authenticated tenant reading their own
   document has no such need).
2. Attachment `url`s are full download URLs and are used **directly** as
   `href` — no proxy call, unlike the anonymous share-link flow.
3. The adapter is a **pure function**: `Firestore document → the shape
ReportSummaryView consumes`. It receives no tenancy, does no lookups, does
   no I/O.
4. `propertyName` does **not** flow through the adapter. `ReportSummaryView`
   receives it as a separate prop, sourced by the (future) page from
   `tenancies.property.name`.
5. `ReportSummaryView` gains two new props, both with **defaults that
   reproduce `/r/:shareToken`'s current output exactly**: `propertyName` and
   `showCalculatedTotal` (default: hidden).
6. Three hooks are needed: the tenant's current tenancy (active OR ended —
   must expose `endedAt`), the list of the tenant's signed reports, and one
   report by `reportId`.

## Decision: `AttachmentBadge` stays inert in this sub-stage (option (a), confirmed)

`AttachmentBadge` inside `ReportSummaryView` is **not** modified in this
sub-stage. Attachments keep rendering as inert `name (type)` badges
regardless of whether `url` is present — exactly as today, for every caller.

Decision #2 says tenant attachment URLs are "used directly in `href`," but
`ReportSummaryView`'s current `AttachmentBadge` renders `name (type)` as
plain text, no anchor, by design (M4 comment: "NEVER a click handler" — a
constraint written for the anonymous/CORS-tainted-canvas case, which still
applies to the admin's PDF/PNG capture, but not to a live, on-screen tenant
page). Two ways existed to close that gap:

- **(a) — chosen.** Leave `AttachmentBadge` untouched in this sub-stage. The
  adapter still carries `url` through (decision #3 requires the _data_ to
  flow), but nothing renders it yet — an inert-but-correct field, consumed
  starting in the sub-stage that actually builds `/app/reports/:reportId`.
  Matches this sub-stage's stated scope: "hooks + adapter", not
  "pages/components."
- **(b) — deferred, not this sub-stage.** Extend `AttachmentBadge` now:
  `href={url}` when `url` is present, same inert `<span>` when it isn't (so
  `/r/:shareToken` and the PDF/PNG capture path — neither of which ever has
  `url` in their data — would render byte-for-byte identically to today).
  Would ship the visible payoff of decision #2 sooner, at the cost of a
  larger diff outside this sub-stage's stated scope. Revisit when the
  sub-stage that builds `/app/reports/:reportId` is planned.

---

## File structure

**Create:**

- `web/src/features/tenantApp/hooks.js` — `useMyTenancy`, `useMySignedReports`, `useTenantReport`
- `web/src/features/tenantApp/reportAdapter.js` — `adaptTenantReportSummary`
- `web/tests/tenantApp.hooks.test.jsx`
- `web/tests/tenantApp.reportAdapter.test.js`

**Modify:**

- `web/src/components/shared/ReportSummaryView.jsx` — add `propertyName` and `showCalculatedTotal` props (defaults preserve current behavior)
- `web/tests/reportSummaryView.test.jsx` — two new tests for the new props' defaults

**Untouched, confirmed:** `firestore.rules`, `storage.rules`, `SRS.md`,
`web/src/routes/index.jsx` (no route wiring — the three `/app/*` routes stay
`PlaceholderPage`), `web/src/features/sharedReport/*`,
`web/src/features/reports/*` (admin-side, no changes), `web/tests/sharedReport.page.test.jsx`
(not modified — its continued green pass is the integration-level proof that
the actual production caller of `ReportSummaryView` is unaffected).

---

## Task 1: `web/src/features/tenantApp/reportAdapter.js` — `adaptTenantReportSummary`

**What it does (behavior, not implementation):** takes one raw
`monthlyReports` document (the object shape a tenant is allowed to read under
the rule above — same shape `functions/scripts/seed.js`'s `signedReport()`
fixture produces) and returns exactly the fields `ReportSummaryView` reads:
`month, year, rent{amount,notes,attachments}, maintenance{...},
serviceCosts[], otherExpenses[], previousMonthArrears, previousMonthCredit,
calculatedTotal, finalTotal, dueDate, paymentStatus, amountPaid`. Each
attachment keeps `{name, type, url}` — `url` preserved even though nothing
renders it yet (see the `AttachmentBadge` decision above). Everything the tenant must never
see structurally (`ownerId, propertyId, tenancyId, userId, status,
shareToken, shareTokenRevoked`, and each service line's internal `serviceId`)
is simply never copied — not filtered out after the fact, the same
"never touches it" property `toPublicReport` has, just via omission from a
plain object literal instead of a field-by-field allowlist function. No
`propertyName` key anywhere in the output (decision #4).

Defensive `?? 0` / `?? null` fallbacks mirror `toPublicReport`'s, since a
report missing `paymentStatus`/`amountPaid` (unpaid, not yet marked) is a
normal state, not an error — same fixture pattern as `seed.js`'s deliberately
UNPAID signed report.

### Paired tests — `web/tests/tenantApp.reportAdapter.test.js`

| #   | Test                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | What it proves                                                                                                                                                                                                                                                           | Anti-vacuity injection                                                                                                                                                                                                                    |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | **Shape-conformance, against a fixture matching `functions/scripts/seed.js`'s `signedReport()`.** Import the fixture from a shared source if the test setup allows it; if not — `functions/` and `web/` are separate packages with no shared import path in this monorepo (the same boundary CLAUDE.md §7 documents for the duplicated KYC schema) — the fixture is a hand-written copy of `signedReport()`'s shape, kept in the test file (including nested `serviceCosts`/`otherExpenses` with `serviceId`, and attachments with real `{name,type,url}`). **This copy can silently diverge from the real fixture over time** (someone updates `seed.js`, forgets this copy) — A1 alone does not catch that, since it only checks the adapter against its OWN local copy. Assert the adapter's output deep-equals exactly the fields `ReportSummaryView` is documented to read, nested attachments included. | The adapter stays in sync with what THIS TEST believes the document shape is — not proof it matches the real one; see A5 and the browser-validation step for what actually catches real divergence.                                                                      | Delete one mapped field's line from the implementation (e.g. the `dueDate` or `previousMonthArrears` mapping) — confirm the test fails on that exact field, not just "some assertion failed."                                             |
| A2  | **Never leaks internal/ownership fields, even under a spread-bug.** Assert `Object.keys(output)` contains none of `ownerId, propertyId, tenancyId, userId, status, shareToken, shareTokenRevoked, propertyName`; assert no `serviceCosts[].serviceId` in the output.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | The exclusion is structural, not incidental.                                                                                                                                                                                                                             | Temporarily change the implementation to `return { ...report, ...explicitMapping }` (a spread-then-override bug) — confirm the test fails because `ownerId`/`userId` now leak through.                                                    |
| A3  | **Attachment `url` passes through unmodified.** Assert `output.rent.attachments[0].url` equals the fixture's real download URL (string equality, not just "truthy").                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | The one field decision #2 depends on for the future `href` isn't silently dropped now, even though nothing consumes it yet.                                                                                                                                              | Remove `url: att.url` from the attachment-mapping helper — confirm the test fails.                                                                                                                                                        |
| A4  | **Graceful defaults when optional fields are absent** — feed a document shaped like `seed.js`'s deliberately-UNPAID fixture (no `paymentStatus`, no `amountPaid` keys at all, empty `otherExpenses`). Assert `paymentStatus === null`, `amountPaid === null`, `previousMonthArrears === 0`, `otherExpenses` is `[]`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | An unpaid/fresh report renders through `ReportSummaryView` the same way it already does for `/r/:shareToken` (which hits the identical "absent, not zero-filled" case via `toPublicReport`'s own `?? ` fallbacks).                                                       | Remove one `?? ` fallback (e.g. `report.paymentStatus ?? null` → `report.paymentStatus`) — confirm the test fails with `undefined` instead of `null`.                                                                                     |
| A5  | **Integration: adapter output actually renders through `ReportSummaryView`.** Render `<ReportSummaryView data={adaptTenantReportSummary(sameFixtureAsA1)} propertyName="Test Property" />` and assert the DOM shows the key values: each cost line's amount (rent, maintenance, each service), `finalTotal`, each service's `name`, and each attachment's `name`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Proves the adapter and `ReportSummaryView` actually agree end-to-end on the SAME fixture — the gap A1 alone cannot close, since A1 only checks the adapter against its own documented output shape in isolation, never against what the component actually reads off it. | Remove one field's mapping from the adapter (e.g. drop `serviceCosts[].name`, or stop returning `finalTotal`) — confirm the corresponding value disappears from the rendered DOM, not just from an assertion on the adapter's raw output. |

**On "real divergence":** A1 and A5 both work off the same local test
fixture — neither can prove, on its own, that this fixture still matches the
true shape `seed.js` produces in production. A5 closes the
_adapter↔component_ gap (do the two agree with EACH OTHER, given the same
input); the browser-validation step's step 4 (below) closes the separate
_fixture↔reality_ gap, by running `adaptTenantReportSummary` against a
document actually fetched from a live-seeded emulator, not a hand-copied
stand-in. Both are needed — one without the other leaves a gap unchecked.

---

## Task 2: `web/src/features/tenantApp/hooks.js` — three read hooks

### `useMyTenancy(userId)`

**What it does:** returns the tenant's ONE relevant tenancy — the active one
if it exists; otherwise the most-recently-ended one (by `endedAt`), so a
tenant with a lapsed contract still resolves to something (FR-TAPP-06). Query
mirrors `useUserTenancies` (`tenants/hooks.js`) — `where('userId','==',userId)`,
no status filter server-side (the selection between active/ended happens
client-side, in JS, on the returned array) — then applies: prefer
`status==='active'`; else pick the max by `endedAt`.

`endedAt` is a **Firestore `Timestamp`**, not a number or an ISO string —
the comparison is `a.endedAt.toMillis() > b.endedAt.toMillis()`, never a raw
`>` on the `Timestamp` objects themselves (which compares by reference, not
value) and never `new Date(endedAt)` (which mangles a raw `Timestamp`).

**Edge case — an `ended` tenancy with no `endedAt` at all** (shouldn't
happen per `endTenancy`'s contract, which always sets it, but the hook
doesn't trust that blindly): such a tenancy is excluded from the
"most-recently-ended" comparison entirely — it is never picked, and its
absence never throws (no `.toMillis()` call on `undefined`). If it's the
ONLY ended tenancy and there's no active one, the hook resolves to `null`
rather than guessing which contract to show.

Returns `null` while there's genuinely nothing to show (no tenancy at all,
or only unrankable ended ones as above) — a hook must still resolve cleanly
rather than throw. `enabled: Boolean(userId)`, matching every existing "wait
for an id" hook.

### `useMySignedReports(userId)`

**What it does:** the tenant's full signed-report history for
`/app/history` (later sub-stage). `where('userId','==',userId)` AND
`where('status','==','signed')` — the exact two conditions the Firestore rule
itself checks, so the query can never return something the rule would reject
anyway. (Confirmed: pure multi-equality compound queries need no manually
declared composite index — Firestore serves them off the automatic
single-field indexes. Still verified empirically in the browser-validation
step below, not just assumed from documentation — CLAUDE.md's "measure, don't
infer" applies to index behavior too.)

Chronological ordering (newest month/year first, for the accordion-by-year
grouping FR-TAPP-02 describes) is done **client-side, in JS, after the
fetch** — sorting the returned array by `(year, month)` — deliberately NOT
via Firestore's `orderBy`. Adding `orderBy` on a field beyond the two
equality filters is exactly the query shape that WOULD require a composite
index; keeping the sort client-side is what keeps this hook on the
automatic-index path confirmed above.

### `useTenantReport(reportId)`

**What it does:** one report by id, for `/app/reports/:reportId` (later
sub-stage). A single `getDoc`. Two DIFFERENT ways "there's nothing here" can
happen, both resolved to the SAME `null`:

- the document plainly doesn't exist (`snap.exists() === false`);
- the document exists but the rule rejects the read (`permission-denied`) —
  a foreign report, or the tenant's own but still a draft.

The SRS is explicit that a foreign/draft `reportId` "must render as not
found, not as a technical error" — collapsing both cases to `null` in the
hook is what makes that possible without the (future) page needing to know
Firestore error codes at all.

### Paired tests — `web/tests/tenantApp.hooks.test.jsx`

(Same mocking convention as `reports.hooks.test.jsx`/`tenants` hook tests —
`firebase/firestore`'s `getDocs`/`getDoc`/`query`/`where` mocked; a fast-band
test proves the hook builds the RIGHT query/handles the RIGHT
success-vs-error shape, not that Firestore's server-side filtering itself
works — that's the rule's job, already covered by
`web/tests/monthlyReports.rules.test.js`.)

| #   | Test                                                                                                                                                                                                                                                                                                                                                          | What it proves                                                                                                                                                                                                    | Anti-vacuity injection                                                                                                                                                                      |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1  | `useMyTenancy` returns the ACTIVE tenancy when the mock includes both an active and an ended one, **regardless of array order** (seed the active one LAST).                                                                                                                                                                                                   | The active tenancy always wins, not "whichever happens to be returned first."                                                                                                                                     | Change the selection to "first array element" instead of "prefer active" — confirm the test fails (an ended tenancy placed first would now win).                                            |
| B2  | `useMyTenancy` falls back to the most-recently-ENDED tenancy (by `endedAt`) when none is active — seed TWO ended tenancies with **real Firestore `Timestamp` instances** (e.g. `Timestamp.fromDate(...)`, not plain numbers or strings) for `endedAt`, out of chronological array order.                                                                      | The fallback picks the right one by actual `Timestamp` value (via `.toMillis()`), not by array position, and not by a comparison that happens to work on numbers but silently breaks on real `Timestamp` objects. | Change the comparison to ascending, drop it entirely (return the first ended one found), or compare the raw `Timestamp` objects with `>` instead of `.toMillis()` — confirm the test fails. |
| B3  | `useMyTenancy` returns `null` when the query result is empty.                                                                                                                                                                                                                                                                                                 | No-tenancy resolves cleanly, doesn't throw.                                                                                                                                                                       | Remove the empty-check, letting `undefined[0]` or similar throw — confirm the test now sees a rejected/error state instead of `null`.                                                       |
| B4  | `useMyTenancy` — an ended tenancy with NO `endedAt` at all is never chosen and never crashes the comparison: (a) seed one ended tenancy WITH `endedAt` alongside one ended tenancy WITHOUT it — assert the one WITH `endedAt` is returned; (b) seed ONLY an endedAt-less ended tenancy, no active one — assert the hook resolves to `null`, not that tenancy. | A malformed/unexpected document (missing a field `endTenancy` always sets) degrades safely instead of crashing the comparison (`undefined.toMillis()`) or being guessed at.                                       | Remove the `endedAt`-presence guard, letting `.toMillis()` be called on `undefined` — confirm the test now sees a thrown error instead of the expected result.                              |
| B5  | `useMySignedReports` issues the query with BOTH `where('userId','==',userId)` AND `where('status','==','signed')` (assert on the mock's call arguments, not on data-filtering — Firestore does the actual filtering server-side).                                                                                                                             | The query can't structurally return a draft or a foreign report even before the rule is consulted.                                                                                                                | Change the status filter's value to `'draft'`, or delete that `where(...)` call entirely — confirm the assertion on call arguments fails.                                                   |
| B6  | `useTenantReport` resolves to `null` when the mocked `getDoc` rejects with `{ code: 'permission-denied' }`.                                                                                                                                                                                                                                                   | A foreign/draft report id degrades to a clean `null`, per SRS.                                                                                                                                                    | Remove the `catch` (or narrow it to a different error code) — confirm the test's `null` expectation fails because the rejection now propagates.                                             |
| B7  | `useTenantReport` resolves to `null` when `snap.exists()` is `false`.                                                                                                                                                                                                                                                                                         | The "genuinely doesn't exist" case collapses to the same terminal state as the rule-rejected case.                                                                                                                | Remove the `exists()` check — confirm the test fails (would otherwise try to read `.data()` off a non-existent snapshot).                                                                   |
| B8  | `useTenantReport` returns `{ id, ...data }` for a real, owned, signed report.                                                                                                                                                                                                                                                                                 | The id is available to the (future) page without a second read.                                                                                                                                                   | Drop `id: snap.id` from the returned object — confirm the `.id` assertion fails.                                                                                                            |

---

## Task 3: `web/src/components/shared/ReportSummaryView.jsx` — two new props

**What it does (behavior change):** the component signature becomes
`ReportSummaryView({ data, propertyName = data.propertyName,
showCalculatedTotal = false })`. `propertyName`'s default reads
`data.propertyName` — the EXACT field every existing caller
(`SharedReportPage`, `ExportReportControls`'s `toReportSummaryData`) already
embeds inside `data` — so neither of those two callers needs to change at
all; only a future tenant caller, whose adapter output has no `propertyName`
key (decision #4), will pass the prop explicitly. `showCalculatedTotal`
defaults to `false`; when `true`, one new row renders in the footer (before
arrears/credit, "Calculated total: `{data.calculatedTotal}`") — today the
component never renders `calculatedTotal` at all, so `false` reproduces that
exactly.

**Per the `AttachmentBadge` decision above, it is NOT touched in this
task** — attachments keep rendering as inert `name (type)` badges regardless
of whether `url` is present, exactly as today.

### Paired tests — `web/tests/reportSummaryView.test.jsx` (two new tests appended to the existing file)

| #                  | Test                                                                                                                                                                                                                  | What it proves                                                                                                                                  | Anti-vacuity injection                                                                                                                                                           |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1                 | Rendering `<ReportSummaryView data={summaryData()} />` with **no `propertyName` prop** still shows `data.propertyName`'s value — same call shape every existing test in this file already uses.                       | The default genuinely falls back to `data.propertyName`; `/r/:shareToken` and the export capture path are byte-for-byte unaffected.             | Change the default from `data.propertyName` to `null`/omit the fallback — confirm the property-name assertion fails.                                                             |
| C2                 | Rendering with no `showCalculatedTotal` prop, and `data.calculatedTotal` set to a value DISTINCT from `finalTotal` (e.g. `3000` vs `2500`), asserts the `3000` text is **absent** from the DOM.                       | `/r/:shareToken`'s current output — which never shows `calculatedTotal` — is unchanged.                                                         | Flip the default to `true` (or remove the conditional gating the row) — confirm the test fails because `3000` now unexpectedly renders.                                          |
| C3 _(recommended)_ | Rendering WITH `showCalculatedTotal` explicitly `true` and a distinct `calculatedTotal` value shows it; rendering with an explicit `propertyName` prop (and NO `propertyName` on `data`) still shows the passed name. | The new props work forward, not just default safely backward — proves the feature actually does something, not just that it's inert by default. | Hardcode the calculatedTotal row to never render regardless of the prop, or hardcode `propertyName` to always read from `data` — confirm this test fails while C1/C2 still pass. |

`web/tests/sharedReport.page.test.jsx` is left untouched and is expected to
keep passing unmodified — that's the integration-level confirmation that the
one real production caller of `ReportSummaryView` today is unaffected.

---

## Browser validation at the end of this sub-stage

No page/route exists yet to click through normally, so validation is via a
**temporary, throwaway scratch harness** — explicitly NOT committed, deleted
before the sub-stage's gate closes:

1. `firebase emulators:start` + run the seed script (`functions/scripts/seed.js`) so `SEED_TENANT` has a real active tenancy and a real signed report with real uploaded attachments (the existing M4 sub-stage 8 fixture already provides this).
2. Add a temporary debug component (e.g. a scratch route or a `console.log` dropped into any already-rendered tenant page component for the duration of this check) that calls `useMyTenancy(user.uid)`, `useMySignedReports(user.uid)`, and `useTenantReport(<the seeded signed report's id>)`, and logs each result.
3. Log in as `SEED_TENANT` in the browser at `/login`; confirm in the console:
   - `useMyTenancy` resolves to the seeded active tenancy (not `null`, not an error).
   - `useMySignedReports` resolves to an array containing exactly the seeded signed report. **Unconditionally** confirm a draft is excluded: if the current seed data doesn't already include a draft report for this tenant, create one temporarily via the admin UI first (open the tenant's property, save a new month's report WITHOUT signing it) — then confirm that draft does NOT appear in `useMySignedReports`'s result, and delete the temporary draft afterward. (Proves the rule + query combination end-to-end, against the REAL emulator, not a mock.)
   - `useTenantReport(<seeded signed id>)` resolves to the report data.
   - `useTenantReport(<some other tenant's report id, or a known draft id>)` resolves to `null` — **check the browser console for a Firestore "Missing or insufficient permissions" error logged alongside it** (expected — the SDK logs the underlying rejection even though the hook swallows it into `null`); confirm nothing crashes or shows a stack trace in the UI.
   - No "The query requires an index" error appears anywhere in the console for `useMySignedReports` — the empirical check that the multi-equality query needs no manual composite index (see Task 2 note).
4. In the console, call `adaptTenantReportSummary(report)` on the real fetched report object; confirm by eye: no `propertyName`/`ownerId`/`userId`/`status` keys in the output, and `rent.attachments[0].url` is a real, working Storage download URL (paste it into a new tab, confirm the file downloads).
5. Load `/r/:shareToken` for the existing M4 seeded share token in an incognito window; confirm it renders IDENTICALLY to before this sub-stage (property name shown, no "calculated total" row, attachments still plain badges, nothing clickable) — the concrete proof that Task 3's new props didn't change the one real production caller.
6. Remove the temporary debug component/logging before considering the sub-stage done.

---

## Risks identified and how the plan covers them

1. **`permission-denied` vs "doesn't exist" ambiguity.** A tenant fetching a foreign or draft report id gets a Firestore rejection, not a clean 404-like state. — Covered by `useTenantReport` collapsing both to `null` (B5/B6), plus the browser step that specifically triggers the rejected case and confirms no crash.
2. **Adapter/`ReportSummaryView` silent drift over time** — the two evolve independently; a field renamed on one side and not the other would only surface as a visually blank cell, not a thrown error. — Covered by **A5**, not A1: A5 renders the adapter's actual output through the actual component and asserts on the DOM, so a field the adapter stops emitting (or renames) is caught by its value disappearing from the rendered page, not just by a mismatch against A1's own local fixture copy. A1 alone only proves the adapter matches ITS OWN documented shape in isolation — it cannot, by itself, prove `ReportSummaryView` actually consumes what the adapter emits.
3. **`url` is a "dead field" today** (kept per decision #2 but not rendered per the Open Decision's option (a)) — could silently rot (typo'd, dropped) since nothing currently consumes it. — Covered by A3 asserting the exact URL string, not just presence; explicitly flagged as an open item rather than a forgotten one.
4. **`useMyTenancy`'s active/most-recent-ended tie-break is easy to get subtly wrong** (e.g. picking array order instead of the real active/date logic, or mishandling a missing `endedAt`) and would silently show the WRONG contract to a tenant with history. — Covered by B1/B2 deliberately seeding out-of-order fixtures so array-order bugs can't hide, and by B4's endedAt-less edge case so a malformed document can't crash the comparison or get guessed at.
5. **Composite-index assumption for `useMySignedReports`'s two-equality query.** Pure-equality compound queries don't need a declared composite index per Firestore's documented behavior, but a fast-band test mocking `getDocs` cannot prove this empirically — it only proves the right `where()` calls were made. — Covered by pushing the empirical check into the browser-validation list (step 3's "no index-required error" check) rather than asserting it as already proven.
6. **New props with safe defaults don't force the NEXT sub-stage's author to actually pass the right values** when wiring `/app/reports/:reportId`. — Not fully mitigable here since that caller doesn't exist yet; flagged as a reminder to carry into that sub-stage's own plan.

---

## Phases & commit proposal (for when implementation is approved — not part of this step)

Everything above is ONE small, cohesive unit (hooks + adapter + two new
props, all pure/data-layer, no UI). Recommendation for when this is
implemented: **one `feat:` commit** (Tasks 1-3 together, TDD RED→GREEN per
task as tabulated above), gated on: `npm run lint`, `npm run test:run --prefix web`,
and the browser-validation list above, all reported with raw output before
asking for the commit. This plan document itself, if approved as-is, would
normally be its own `docs:` commit (same pattern as every prior sub-stage
plan) — **not done in this step**, per your instruction not to commit.
