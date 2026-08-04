# M5 sub-stage 9 — Persistent "contract ended" banner (FR-TAPP-06)

Status: PLAN ONLY. No code, no commit.

## 1. Goal and requirement covered

- **FR-TAPP-06** — "After the contract ends: read-only access to the
  tenant's own history. The dashboard, the history, the report detail pages
  and the contract data all stay reachable. Every page of the portal shows
  a persistent banner stating that the contract ended on
  `tenancies.endedAt`. No new report can appear; nothing becomes editable
  (the tenant never writes anyway — FR-TAPP-05)."
- **SRS §5.4** (edited this session, `40b1107`): _"When the tenancy has
  ended, a **persistent banner** ("Contract ended on {date}", from
  `tenancies.endedAt`) sits under the navbar on **every** portal page
  (FR-TAPP-06). The date is formatted in the current interface language
  (e.g. "31 ianuarie 2026" / "January 31, 2026"). Other dates in the tenant
  portal remain unformatted."_

Two separate things FR-TAPP-06 asks for, both addressed here:

1. The banner itself (new UI).
2. "Read-only access" — investigated in §4 below; **already fully
   satisfied**, nothing left to implement for it specifically.

## 2. Decisions pinned (per the user's message, not re-litigated)

- Banner mounts in `TenantLayout`, once, not per page.
- Date formatting: `Intl.DateTimeFormat`, locale from `i18n.language`, no
  new dependency, long month name ("31 ianuarie 2026" / "January 31, 2026").
- Formatting applies ONLY to the banner. `/app/contract` and
  `ReportSummaryView` keep raw ISO dates — a conscious debt, noted for M7.
- CT10 (sub-stage 7, `tenantApp.contractPage.test.jsx`) is deliberately
  superseded. The replacement must say so in its own docstring; this plan
  states it too (§5 flags an architectural nuance the sub-stage 7 plan
  didn't anticipate).
- `endedAt` is a Firestore `Timestamp` — conversion goes through `.toDate()`.

## 3. Reading done before writing this plan

- **SRS.md** FR-TAPP-06 (line 226) and §5.4 (lines 368-394, quoted above,
  including this session's own edit).
- **`web/src/routes/TenantLayout.jsx`** (full) — currently calls only
  `useAuth()` (for `logout`), renders the nav (`Home`/`History`/`Contract`),
  `LanguageSwitcher`, logout button, then `<main><Outlet /></main>`. No
  tenancy data touched here at all today.
- **`web/src/features/tenantApp/hooks.js`** (full) — `useMyTenancy(userId)`
  already returns the FULL tenancy document (via `pickCurrentTenancy`):
  active tenancy if one exists, else the most-recently-ended one (compared
  by `endedAt.toMillis()`, real `Timestamp`, never `new Date()`-mangled),
  else `null`. `status` and `endedAt` are both already on that object —
  **no hook change needed**, every field the banner needs is already
  exposed.
- **All four pages** (`TenantDashboardPage.jsx`, `TenantHistoryPage.jsx`,
  `TenantReportDetailPage.jsx`, `TenantContractPage.jsx`, all read in full)
  — each independently calls `useMyTenancy(user.uid)` with the SAME
  `useAuth()`-sourced `user.uid`. None of them currently reads `status` for
  any purpose except `TenantDashboardPage` (its own per-card "Final month of
  the contract" label, `FR-TAPP-01`, unrelated to and explicitly distinct
  from the persistent banner per SRS §5.4's own wording). **Zero mutations
  anywhere** — see §4.
- **`web/tests/tenantApp.contractPage.test.jsx`**, CT10 (full context read)
  — its docstring assumed the banner would be added **inside this page**
  and would supersede CT10 **in this same file**, mirroring the HP7
  precedent (sub-stage 5→6, same-file supersedure). The decision pinned in
  §2 of THIS plan (banner lives in `TenantLayout`, not per-page) means that
  assumption was wrong in one respect — see §5 for how this is resolved
  without pretending otherwise.
- **`web/tests/tenantApp.hooks.test.jsx`** — confirms the established
  project convention for faking a Firestore `Timestamp` in tests: the REAL
  `Timestamp.fromDate(new Date(...))` from `firebase/firestore`, never a
  hand-rolled `{ toDate: () => ... }` stub — reused here.
- **`web/src/features/dashboard/calculations.js`** — `formatMonthYearLabel`
  already does exactly this shape of work (`Intl.DateTimeFormat` +
  `localeFor(language)` mapping `'ro'→'ro-RO'`, `'en'→'en-US'`) for the
  admin dashboard. **Not imported here** — that would be a `tenantApp` →
  `dashboard` cross-feature import in the wrong direction, no existing
  precedent for it (same reasoning already used for `TenantContractPage`'s
  own private `formatAddress` in sub-stage 7, rather than importing
  `PropertiesListPage`'s copy). A small, private, unexported date formatter
  is written directly in `TenantLayout.jsx` instead, duplicating the same
  two-line `localeFor` mapping.
- **`web/src/lib/i18n/index.js`** — confirms `SUPPORTED_LANGUAGES = ['ro',
'en']` exactly, both valid bare Intl locale tags on their own, matching
  `formatMonthYearLabel`'s existing `'ro'→'ro-RO'`/`'en'→'en-US'` mapping.
- **`firestore.rules`** (grepped) — `tenancies` and `monthlyReports` both
  have `allow write: if isAdmin();` — the tenant has **zero** write path
  even via a direct SDK call bypassing the UI entirely. Cited in §4.
- **Full-repo grep**, `useMutation|updateDoc|setDoc|addDoc|deleteDoc|
httpsCallable` inside `web/src/features/tenantApp/` — **zero matches**.
  Cited in §4.

## 4. FR-TAPP-06's "read-only access" — is there anything left to implement?

**No — it is already fully satisfied, at two independent layers, and this
sub-stage does not need to add anything for it.** Argued, not assumed:

1. **UI layer.** Grepped every file under `web/src/features/tenantApp/` for
   any mutation call (`useMutation`, `updateDoc`, `setDoc`, `addDoc`,
   `deleteDoc`, `httpsCallable`) — zero matches. All four pages call only
   `useQuery`-backed read hooks (`useMyTenancy`, `useMySignedReports`,
   `useTenantReport`). `TenantHistoryPage`'s own doc-comment confirms its
   rows are "deliberately non-interactive" (read-only by design, not by
   omission). `DownloadReportPdfButton` (sub-stage 8) only reads/exports —
   it writes nothing. There is no form, no editable input, no button
   anywhere in the tenant portal that could mutate `tenancies` or
   `monthlyReports`, ended or not.
2. **Rules layer, independently.** `firestore.rules`: both
   `match /tenancies/{tenancyId}` and `match /monthlyReports/{reportId}`
   read `allow write: if isAdmin();` — a tenant's own SDK call to
   `updateDoc`/`setDoc` on either collection is rejected by the rule
   itself, regardless of what the UI does or doesn't render. This holds
   for an ACTIVE tenancy too, not just an ended one — FR-TAPP-05
   ("the tenant cannot edit anything") was never conditional on
   `status`, and neither is the rule.

So "read-only access" for an ended tenancy is not a NEW state to build —
it is the SAME read-only posture the portal already has for an active
tenancy, unconditionally, at both layers. The only thing FR-TAPP-06 adds on
top is the VISIBLE banner (so the tenant knows WHY) — which is the actual,
sole deliverable of this sub-stage.

## 5. CT10's supersedure — a nuance the sub-stage 7 plan didn't anticipate

CT10 (`tenantApp.contractPage.test.jsx`) asserts: rendering
`<TenantContractPage />` **in isolation** (no `TenantLayout`) with an ended
fixture shows no banner. Its docstring, written at sub-stage 7, expected
sub-stage 9 to add the banner **inside this page** and supersede CT10
**in this same file** — mirroring the HP7 precedent (sub-stage 5→6,
same-file, same-component supersedure).

That premise turns out to be architecturally wrong, per THIS plan's own
§2 decision: the banner lives in `TenantLayout`, which
`tenantApp.contractPage.test.jsx` never mounts (it renders the page
standalone, by design, same as every other page test in this project).
**`TenantContractPage` rendered alone will still show no banner after this
sub-stage ships** — not because the banner wasn't built, but because this
page was never going to own it.

Resolution — both parts, stated honestly rather than glossed over:

1. **CT10 stays, but its ASSERTION does not change — only its docstring
   does.** It becomes a permanent architectural-boundary test: "this page,
   rendered on its own, never renders the banner — that responsibility
   belongs to `TenantLayout`." Its docstring drops the "TEMPORARY, will be
   superseded" framing (no longer true) and instead points to
   `tenantLayout.test.jsx` for where the real behavior lives.
2. **The actual supersedure of CT10's ORIGINAL claim** — "an ended tenancy
   viewing `/app/contract` sees no banner" — is proven false by a NEW test
   in `web/tests/tenantLayout.test.jsx` (§7, test L-CONTRACT), which
   mounts `TenantLayout` wrapping `TenantContractPage` for an ended
   fixture and asserts the banner NOW appears. **That test's docstring is
   the one that must explicitly say it supersedes CT10** — it is simply
   in a different file than CT10 itself, because the functionality moved
   to a different component. `git log`/this plan record why, so nothing
   here reads as an accidental contradiction.

## 6. Files — new / modified

| File                                           | Change                                                                                                                                                                                                                                                                                                           |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SRS.md`                                       | Already done this session (`40b1107`) — not part of this sub-stage's own commit.                                                                                                                                                                                                                                 |
| `web/src/routes/TenantLayout.jsx`              | Modified. Calls `useMyTenancy(user.uid)`; renders the banner between `<header>` and `<main>` when `tenancy?.status === 'ended' && tenancy.endedAt`; private, unexported date formatter (see §3).                                                                                                                 |
| `web/src/lib/i18n/locales/en.json` / `ro.json` | New key: `tenantApp.endedBanner.message` — `"Contract ended on {{date}}"` / `"Contract încheiat pe {{date}}"`.                                                                                                                                                                                                   |
| `web/tests/tenantLayout.test.jsx`              | **New** — first dedicated test file for a layout component in this project (no `guards.jsx`/`AdminLayout.jsx` test exists either; justified because the banner has real conditional logic — status, `endedAt` presence, per-language date formatting — worth covering directly, not only implied by page tests). |
| `web/tests/tenantApp.contractPage.test.jsx`    | Modified. CT10's docstring only (see §5) — its assertion is untouched.                                                                                                                                                                                                                                           |

**No other file changes.** All four tenant pages are untouched — the whole
point of mounting the banner in `TenantLayout` is that nothing downstream
needs to change. `hooks.js`, `reportAdapter.js`, `firestore.rules`,
`storage.rules`, `seed.js` are untouched (confirmed nothing here requires a
data-shape or rule change — `endedAt` already flows through `useMyTenancy`
unchanged).

## 7. Where the banner mounts, and how the tenancy data gets there

**`TenantLayout` calls `useMyTenancy(user.uid)` itself** — the exact same
hook, the exact same `queryKey` (`['tenancies', 'mine', userId]`) every one
of the four pages already calls independently. This is deliberately NOT a
new context/prop-drilling mechanism (`<Outlet context={tenancy} />` +
`useOutletContext()` in each page): TanStack Query de-dupes by `queryKey`
automatically, so `TenantLayout` calling the hook a second time does not
trigger a second network fetch — it reads the same cached result. Adding
an Outlet-context refactor would touch all four pages for zero functional
gain, purely to avoid a cache hit TanStack Query already gives for free.

```jsx
// web/src/routes/TenantLayout.jsx (sketch)
import { useAuth } from '@/features/auth/useAuth'
import { useMyTenancy } from '@/features/tenantApp/hooks'

function formatEndedDate(endedAt, language) {
  const locale = language === 'ro' ? 'ro-RO' : 'en-US'
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(endedAt.toDate())
}

export function TenantLayout() {
  const { t, i18n } = useTranslation()
  const { user, logout } = useAuth()
  const tenancyQuery = useMyTenancy(user.uid)
  const tenancy = tenancyQuery.data
  const showEndedBanner = Boolean(
    tenancy?.status === 'ended' && tenancy.endedAt,
  )

  return (
    <div className="flex min-h-svh flex-col">
      <header>...</header>
      {showEndedBanner && (
        <div
          role="status"
          className="border-b border-border bg-muted px-4 py-2 text-center text-sm text-foreground"
        >
          {t('tenantApp.endedBanner.message', {
            date: formatEndedDate(tenancy.endedAt, i18n.language),
          })}
        </div>
      )}
      <main className="flex-1">
        <Outlet />
      </main>
    </div>
  )
}
```

`user` was not previously destructured in `TenantLayout` (only `logout`
was) — this adds it, same `useAuth()` call, no new import.

## 8. What happens when there's no tenancy, or it's active

- **Active tenancy** (`status === 'active'`): `showEndedBanner` is `false`
  — no banner, every page renders exactly as before this sub-stage.
- **No tenancy at all** (`useMyTenancy` resolves to `null` —
  `cristina@test.ro`, no tenancy ever assigned): `tenancy?.status` is
  `undefined` via optional chaining, `showEndedBanner` is `false` — no
  banner, no crash. Each page still shows its own "no tenancy" message
  inside `<Outlet />`, untouched.
- **`tenancyQuery` pending or errored**: `tenancy` is `undefined`,
  `showEndedBanner` is `false` — no banner flashes in before data resolves,
  and no banner appears if the query fails. Each page's own
  loading/error message renders independently inside `<Outlet />`, same as
  today — `TenantLayout` does not duplicate or race against that.
- **Ended tenancy with `endedAt` somehow absent** (shouldn't happen per
  `endTenancy`'s contract, which always sets it — but `hooks.js`'s own
  `pickCurrentTenancy` comment already says this isn't trusted blindly):
  `tenancy.endedAt` is falsy, `showEndedBanner` is `false` — no banner, no
  crash calling `.toDate()` on something that isn't a Timestamp. This
  mirrors `pickCurrentTenancy`'s own defensive posture exactly.

## 9. Tests

### 9.1 `web/tests/tenantLayout.test.jsx` (new)

Mocks `@/features/auth/useAuth` and `@/features/tenantApp/hooks`
(`useMyTenancy` only) at the module boundary — same convention as every
other tenant-app test. Uses the REAL `Timestamp.fromDate(new Date(...))`
from `firebase/firestore` for `endedAt` fixtures, matching
`tenantApp.hooks.test.jsx`'s established convention (not a hand-rolled
stub).

| Test       | Asserts                                                                                                                                                                                                                                                                                                                                                                              | Anti-vacuity injection                                           | Expected failure                                                                                                                                                                  |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| L1         | `status: 'ended'` + a real `endedAt` → banner renders with the RO-formatted date (`i18n` defaults to `'ro'`)                                                                                                                                                                                                                                                                         | Invert `tenancy?.status === 'ended'` to `!==`                    | L1 fails: banner text disappears                                                                                                                                                  |
| L2         | `status: 'active'` → no banner                                                                                                                                                                                                                                                                                                                                                       | Remove the `status === 'ended'` condition entirely (always show) | L2 fails: banner appears for an active tenancy                                                                                                                                    |
| L3         | `data: null` (no tenancy at all) → no banner, no crash                                                                                                                                                                                                                                                                                                                               | Remove the `tenancy?.` optional chaining (`tenancy.status`)      | L3 fails: `TypeError` reading `.status` of `null`                                                                                                                                 |
| L4         | `status: 'ended'`, `endedAt` absent/`null` → no banner, no crash                                                                                                                                                                                                                                                                                                                     | Remove the `&& tenancy.endedAt` guard                            | L4 fails: `TypeError` calling `.toDate()` on `undefined`, OR (if `formatEndedDate` is called with `undefined`) an "Invalid Date" string leaks into the banner — either way, wrong |
| L5         | Exact date formatting: `endedAt` = 2026-01-31 → RO shows "31 ianuarie 2026"                                                                                                                                                                                                                                                                                                          | Change `month: 'long'` to `month: 'numeric'` in the formatter    | L5 fails: renders "31 1 2026" instead                                                                                                                                             |
| L6         | Same fixture, `i18n.language` switched to `'en'` → shows "January 31, 2026" (proves the locale is READ from `i18n`, not hardcoded)                                                                                                                                                                                                                                                   | Hardcode `'ro-RO'` regardless of `language` param                | L6 fails: still shows the Romanian month name under the English language setting                                                                                                  |
| L-CONTRACT | **Supersedes CT10** (`tenantApp.contractPage.test.jsx`, sub-stage 7): mounting `TenantLayout` wrapping `TenantContractPage` for an ended tenancy shows the banner — proving FR-TAPP-06's persistent banner reaches `/app/contract` specifically, contradicting CT10's original (now-outdated) premise that this page would never show one. Docstring states this explicitly, per §5. | Same as L1's injection, applied here                             | Fails: banner absent on this specific composed page                                                                                                                               |

### 9.2 `web/tests/tenantApp.contractPage.test.jsx` (modified, CT10 only)

Docstring rewritten (assertion untouched — still: render
`TenantContractPage` alone, ended fixture, no banner in the DOM). New text
states plainly: this is now a PERMANENT architectural-boundary test (this
page does not own the banner — `TenantLayout` does), not a temporary one;
points to `tenantLayout.test.jsx`'s `L-CONTRACT` for where FR-TAPP-06's
actual banner-reaches-this-page proof lives.

## 10. Browser validation — mandatory

`npm run seed` first. Check EVERY one of the four portal pages for each
account, not just `/app`.

1. **`radu@test.ro`** (ended tenancy, `inactive-readonly` — already
   confirmed in sub-stage 7 that this status does not block login) — log
   in, confirm the banner text ("Contract încheiat pe ...", exact date
   matching the seed's `endedAt`) appears under the navbar on ALL FOUR
   pages: `/app`, `/app/history`, `/app/reports/{a past reportId}`,
   `/app/contract`. Switch language to English mid-session (via the
   `LanguageSwitcher` already in the header) — confirm the date re-renders
   in English ("Month DD, YYYY"), banner stays present on navigation.
2. **`chirias@test.ro`** (active tenancy) — no banner on any page.
3. **`ioana@test.ro`** (active, empty state) — no banner on any page,
   including the empty-state message.
4. **`cristina@test.ro`** (no tenancy at all) — no banner, no crash, on
   `/app` (the only page reachable without a tenancy — confirm the others
   behave sanely too, though SRS doesn't require covering this explicitly).

## 11. Risks

- **Banner mount point relies on `useMyTenancy`'s cache, not a fresh
  contract.** If a future change ever gives `TenantLayout` a DIFFERENT
  `userId` source than the pages below it (unlikely — both read from the
  same `useAuth()`), the cache-sharing assumption in §7 would silently
  break and `TenantLayout` would issue its own separate fetch. Low risk
  today, worth a one-line code comment at the call site.
- **CT10's supersedure crosses files, unlike the HP7 precedent.** §5's
  resolution means the word "supersedes" now spans two test files instead
  of one — a future reader `git log`-ing just `tenantApp.contractPage.test.jsx`
  won't see WHY CT10's docstring changed without also finding
  `tenantLayout.test.jsx`'s `L-CONTRACT`. Both docstrings cross-reference
  each other by name specifically to mitigate this.
- **Date-formatting debt, accepted deliberately.** `/app/contract` and
  `ReportSummaryView` keep raw ISO dates (per §2) — flagged for M7, not
  addressed here. If M7 arrives and this hasn't been picked up, that's a
  process gap to catch at the M7 planning gate, not at this sub-stage's
  own audit.
- **No rules change, verified not needed — but not re-tested here.** §4's
  rules-layer argument is read-only evidence (`firestore.rules` already
  says `isAdmin()`-only), not a NEW rules-band test. If the user wants an
  explicit rules-band assertion pinning "an ended tenancy's tenant still
  cannot write," that's an ADDITION to scope, not something this plan
  currently includes — flagged so it's a decision, not a silent gap.
- **`endedAt` absence is unit-test-only, same shape as sub-stage 7's
  `securityDeposit` gap.** No seeded ended tenancy actually has `endedAt`
  missing — L4 covers the defensive code path but browser validation (§10)
  never exercises it. Not a blocker; stated so it isn't assumed covered
  live.
