# M5 sub-stage 7 — `/app/contract` (FR-TAPP-03)

Status: PLAN ONLY. No code, no commit.

## 1. Goal and requirements covered

- **FR-TAPP-03**: "Property/contract data + download of the signed contract."
- **FR-CON-07**: signed contract visible/downloadable by the tenant — the admin-side
  upload + Storage rule are done (M3); this sub-stage is the M5 "tenant-facing
  consumption at `/app/contract`" half, replacing the current `PlaceholderPage`.
- **SRS §5.4, `/app/contract` block**: "property data (denormalized from the
  tenancy), period, rent, security deposit, due day; download of the signed
  contract."
- **FR-TEN-09**: the tenant app reads exclusively denormalized data from
  `tenancies`/`monthlyReports` — never `properties`, never `users` directly.

## 2. Decisions pinned (not re-litigated)

- Own, simple download section. Do **not** reuse `TenantReportDetailPage`'s
  `collectAttachments`/attachments-card — that component groups by cost line,
  which has no meaning for a flat `attachedDocuments[]` list.
- List **all** documents in `tenancy.attachedDocuments[]`, one link per
  document. `doc.url` is used directly as `href` — already a complete,
  tokenized download URL (proven functional at `945f328`).
- Empty or absent `attachedDocuments[]` → show the contract data fields plus
  a "contract not yet uploaded" message. Not an error state.
- Contract data comes from the tenancy document only: `property{name,address}`,
  `startDate`, `endDate`, `monthlyRent`, `securityDeposit` (optional), `dueDay`.
  The page never reads `properties` (FR-TEN-09).
- Reuse `useMyTenancy` from sub-stage 2 as-is. It already resolves to the
  active tenancy, or else the most-recently-ended one, or `null`.
- The persistent "contract ended" banner is out of scope — sub-stage 9.

## 3. Reading done before writing this plan

- `SRS.md`: FR-TAPP-03 (line 223), FR-CON-07 (line 158), FR-TEN-09 (line 131),
  §5.4 `/app/contract` (lines 390-391), §6 `tenancies/{tenancyId}` shape
  (lines 433-455 — confirms `attachedDocuments[]` items share the exact same
  shape as `costLine.attachments[]`: `{url, name, type: 'image'|'pdf'|'doc'}`).
- `web/src/features/tenantApp/hooks.js` — `useMyTenancy(userId)`: resolves
  active tenancy, else most-recently-ended, else `null`; already exposes every
  field this page needs, no new hook required.
- `TenantReportDetailPage.jsx` — read as the pattern reference for page shell
  (loading/error handling, `max-w-2xl` container, bordered-card sections) —
  its attachments-grouping logic is explicitly NOT reused here.
- `storage.rules` (lines 44-56): `/tenancies/{tenancyId}/contract/{fileName}`
  already allows tenant read via `firestore.get(...).data.userId ==
request.auth.uid`. No rule change needed.
- `functions/src/kyc.js:157-162` — grepped to settle how an absent
  `securityDeposit` actually reaches Firestore: `tenancy.securityDeposit` is
  only set `if (typeof draft.securityDeposit === 'number')`; otherwise the
  **key is omitted entirely** from the tenancy document. So the only real
  "absent" shape is `undefined` (missing key) — never `''` or `null`. A
  single guard (`!= null`) and a single unit test cover it; there is no
  second "shape of absence" to test here, unlike `amountPaid` in sub-stage 5.
- `web/src/routes/guards.jsx` + SRS §3.3 (FR-TEN-24, FR-CON-05, line 351):
  confirmed `inactive-readonly` (radu's post-termination status) is distinct
  from `disabled`/`archived` — only those two block native Auth login.
  `inactive-readonly` tenants can still authenticate and reach `/app/*`
  read-only, which is exactly why radu is the required ended-tenancy browser
  check below.
- `web/src/features/tenants/components/TenancyTab.jsx` /`ProfileTab.jsx`
  (admin side) and `web/src/features/properties/pages/PropertiesListPage.jsx`
  read for formatting precedent — see §5.

## 4. Files — new/modified

| File                                                      | Change                                                                                                                                                                                                   |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `web/src/features/tenantApp/pages/TenantContractPage.jsx` | **New.** The page.                                                                                                                                                                                       |
| `web/tests/tenantApp.contractPage.test.jsx`               | **New.** CT1-CT9.                                                                                                                                                                                        |
| `web/src/routes/index.jsx`                                | Replace the `/app/contract` `PlaceholderPage` route with `TenantContractPage`. `pages.tenantContract` i18n key stays in place, unused — same precedent as `pages.tenantDashboard`/`pages.tenantHistory`. |
| `web/src/lib/i18n/locales/en.json` / `ro.json`            | New keys under `tenantApp.contract.*` (below).                                                                                                                                                           |

No other file changes. `ReportSummaryView.jsx`, `hooks.js`, `reportAdapter.js`,
`seed.js`, `SRS.md`, `firestore.rules`, `storage.rules` are untouched.

### New i18n keys — `tenantApp.contract.*`

| Key                      | EN                                                  | RO                                                  |
| ------------------------ | --------------------------------------------------- | --------------------------------------------------- |
| `error`                  | "We couldn't load your contract. Try again."        | "Nu am putut încărca contractul. Încearcă din nou." |
| `noTenancy`              | "You don't have a property assigned at the moment." | "Nu ai nicio locuință atribuită momentan."          |
| `documents.title`        | "Documents"                                         | "Documente"                                         |
| `documents.empty`        | "The contract has not been uploaded yet."           | "Contractul nu a fost încă încărcat."               |
| `documents.download`     | "Download"                                          | "Descarcă"                                          |
| `fields.startDate`       | "Start date"                                        | "Dată început"                                      |
| `fields.endDate`         | "End date"                                          | "Dată sfârșit"                                      |
| `fields.monthlyRent`     | "Monthly rent"                                      | "Chirie lunară"                                     |
| `fields.securityDeposit` | "Security deposit"                                  | "Garanție"                                          |
| `fields.dueDay`          | "Due day"                                           | "Zi scadentă"                                       |

The `fields.*` wording duplicates `onboarding.fields.*` verbatim. This
repeats the sub-stage 5/6 precedent (page-scoped namespacing over cross-
feature key reuse) rather than importing the admin-facing namespace.

`noTenancy` duplicates `tenantApp.dashboard.noTenancy`'s wording verbatim,
same precedent.

`documents.download` feeds each link's `aria-label` (`"{download}: {name}"`),
mirroring `tenantApp.reportDetail.attachments.download`'s existing pattern —
not required by SRS text, but needed for an accessible name distinct per
link when two documents share a generic type.

## 5. Data formatting — what's reused, what's new

- **`monthlyRent` / `securityDeposit`**: formatted with the existing
  `formatCurrency` helper (already used by every other M5 tenant page —
  `TenantDashboardPage`, `TenantHistoryPage`, `ReportSummaryView`). This is a
  **deliberate divergence from `TenancyTab`** (admin side), which renders the
  raw number via its own `Field` component with no currency formatting. The
  admin's raw-number display is that feature's own established convention;
  the tenant portal's own convention (every other M5 page) is
  `formatCurrency`, per NFR-LOC-02. Stated explicitly so this isn't read as
  inconsistency — it is the tenant-app's own consistency.
- **`startDate` / `endDate`**: rendered as the raw ISO string, unformatted.
  This matches BOTH `TenancyTab` (admin) and `ReportSummaryView`'s own
  `dueDate` field — no date-formatting helper exists anywhere in the app, and
  none is added here. This is a finding, not a gap: nothing to reuse because
  nothing exists, and no page currently needs one.
- **`dueDay`**: rendered as the raw number, no special phrasing — same as
  `TenancyTab`'s own `Field` for this value. SRS does not ask for a phrase
  like "day N of the month".
- **`property.address`**: reuses `formatAddress` — but NOT by importing
  `PropertiesListPage`'s copy (that would be a `tenantApp` → `properties`
  cross-feature import in the wrong direction, no existing precedent for
  it). A private, unexported copy of the same one-line helper is written
  directly in `TenantContractPage.jsx`, exactly mirroring how
  `TenantReportDetailPage.jsx` keeps its own private `collectAttachments`
  rather than exporting/sharing it. `property.name` is rendered as-is, as the
  page's own heading (same role it plays in `TenantDashboardPage`).
- **`securityDeposit` absence**: guarded with `tenancy.securityDeposit != null
? formatCurrency(...) : '—'` — the `'—'` fallback matches `ProfileTab.jsx`'s
  `Field` component's own `value || '—'` precedent. This guard is NOT
  decorative: `formatCurrency(undefined)` resolves through `Number(amount) ||
0` to `"0,00 lei"`, so without the explicit `!= null` check, an unset
  deposit would silently render as **a deposit of zero** — a materially
  different, misleading claim to a tenant. This is exactly the class of bug
  the guard exists to prevent (see CT6 below).
- The page never reads or branches on `tenancy.status` — nothing here differs
  for an ended tenancy. This is asserted structurally by CT8.

## 6. Page states

| #   | State                   | Condition                                                       | Render                                                                                                   |
| --- | ----------------------- | --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| 1   | Loading                 | `tenancyQuery.isPending`                                        | `common.loading` text only                                                                               |
| 2   | Error                   | `tenancyQuery.isError`                                          | `tenantApp.contract.error` text only                                                                     |
| 3   | No tenancy              | `tenancyQuery.data` is `null`                                   | `tenantApp.contract.noTenancy` text only                                                                 |
| 4   | Tenancy, no documents   | `data`, `attachedDocuments` empty or absent                     | property + contract fields, then `documents.empty` message, no links                                     |
| 5   | Tenancy, with documents | `data`, `attachedDocuments.length > 0`                          | property + contract fields, then one link per document                                                   |
| 6   | Ended tenancy           | `useMyTenancy` already resolved the most-recently-ended tenancy | renders identically to state 4/5 depending on its own `attachedDocuments` — no special-casing, no banner |

## 7. Component sketch

```jsx
function formatAddress(address) {
  if (!address) return '—'
  return `${address.street} ${address.number}, ${address.city}`
}

export function TenantContractPage() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const tenancyQuery = useMyTenancy(user.uid)

  if (tenancyQuery.isPending) return <p>{t('common.loading')}</p>
  if (tenancyQuery.isError) return <p>{t('tenantApp.contract.error')}</p>

  const tenancy = tenancyQuery.data
  if (!tenancy) return <p>{t('tenantApp.contract.noTenancy')}</p>

  const documents = tenancy.attachedDocuments ?? []

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4 p-6">
      <div className="rounded-lg border border-border p-4">
        <h2>{tenancy.property?.name}</h2>
        <p>{formatAddress(tenancy.property?.address)}</p>
        {/* Field-per-row: startDate, endDate, monthlyRent (formatCurrency),
            securityDeposit (guarded), dueDay */}
      </div>
      <div className="rounded-lg border border-border p-4">
        <h3>{t('tenantApp.contract.documents.title')}</h3>
        {documents.length > 0 ? (
          documents.map((doc, i) => (
            <a
              key={i}
              href={doc.url}
              target="_blank"
              rel="noreferrer"
              aria-label={`${t('tenantApp.contract.documents.download')}: ${doc.name}`}
            >
              {doc.name} ({doc.type})
            </a>
          ))
        ) : (
          <p>{t('tenantApp.contract.documents.empty')}</p>
        )}
      </div>
    </div>
  )
}
```

No `Link`/navigation needed — this is a leaf page reached only via
`TenantLayout`'s existing "Contract" nav item.

## 8. Tests — `web/tests/tenantApp.contractPage.test.jsx`

Mocks: `useAuth`, `useMyTenancy` from `@/features/tenantApp/hooks` (module
boundary — same convention as every other tenant-app page test). No router
mocking needed (no `useParams`/`useNavigate` used).

`tenancyFixture(overrides)`: `property: {name: 'Apartament Zorilor', address:
{street: 'Str. Zorilor', number: '12', city: 'Cluj-Napoca'}}, startDate:
'2026-01-01', endDate: '2026-12-31', monthlyRent: 2500, securityDeposit:
1800, dueDay: 10, attachedDocuments: []`.

`monthlyRent` (2500) and `securityDeposit` (1800) are deliberately DIFFERENT
values in this fixture — every seeded tenancy has them equal, which would
make a field-swap bug invisible to a global `getByText`. Assertions query by
label first, then check that label's own value cell — not a page-wide text
search — so a swapped-field bug is actually caught (the RD6/H3 lesson: a
test that can pass via the wrong element is vacuous).

| Test | Asserts                                                                                                                                                                                | Anti-vacuity injection                                                              | Expected failure                                                                                |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| CT1  | pending → loading text only                                                                                                                                                            | Invert the `isPending` check                                                        | CT1 fails: loading text disappears                                                              |
| CT2  | error → error text only                                                                                                                                                                | Remove the `isError` branch                                                         | CT2 fails: error text never renders                                                             |
| CT3  | `data: null` → noTenancy text only                                                                                                                                                     | Remove the `!tenancy` branch                                                        | CT3 fails: page crashes reading `tenancy.property` on `null`                                    |
| CT4  | `attachedDocuments: []` → shows fields + `documents.empty`, no `<a>` present                                                                                                           | Invert the ternary condition (`documents.length === 0 ? map : empty-message`)       | CT4 fails: empty message disappears (or CT5 starts failing instead)                             |
| CT5  | `attachedDocuments` key **absent entirely** (delete it from the fixture, not just empty array) → same as CT4, no crash                                                                 | Remove the `?? []` fallback (`tenancy.attachedDocuments.length`)                    | CT5 fails: `TypeError` reading `.length` of `undefined`                                         |
| CT6  | 2 documents → 2 links rendered, each `href` = that doc's own `url`                                                                                                                     | Remove/short-circuit the `.map()` rendering branch                                  | CT6 fails: `getByRole('link', ...)` finds nothing                                               |
| CT7  | `securityDeposit` key absent from fixture → renders `'—'` under that label, NOT `"0,00 lei"`                                                                                           | Drop the `!= null` guard, always call `formatCurrency(tenancy.securityDeposit)`     | CT7 fails: renders `"0,00 lei"` instead of `'—'` — the exact silent-zero bug the guard prevents |
| CT8  | `monthlyRent: 2500` renders `"2.500,00 lei"` under its own label; `securityDeposit: 1800` renders `"1.800,00 lei"` under its own label (scoped per-label, not a page-wide `getByText`) | Swap `formatCurrency(monthlyRent)` for the raw number                               | CT8 fails: `"2500"` (unformatted) appears under the rent label instead of `"2.500,00 lei"`      |
| CT9  | `property.address` renders full `"Str. Zorilor 12, Cluj-Napoca"` (proves the private `formatAddress` copy is wired, not just `property.name`)                                          | Truncate the local `formatAddress` to drop the city                                 | CT9 fails: city text missing from the rendered address                                          |
| CT10 | No banner/"ended" text of any kind appears, regardless of fixture — proves the page never branches on `tenancy.status`                                                                 | Temporarily add a fake `{tenancy.status === 'ended' && <p>Contract ended</p>}` line | CT10 fails: the injected banner text is found, catching a premature sub-stage-9 leak            |

**CT10 is a deliberately TEMPORARY contract, not a permanent one.** Its own
docstring must say so explicitly — e.g. "CT10 — no ended-tenancy banner
renders (TEMPORARY: sub-stage 9, FR-TAPP-06, will deliberately supersede
this test by adding exactly that banner; this is a planned supersedure, not
a future regression, exactly as sub-stage 6's HP7 superseded sub-stage 5's
own HP7)." This mirrors the HP7 precedent: the replacement test at
sub-stage 9 must likewise state in ITS OWN docstring that it deliberately
supersedes CT10, so `git log` and the plan agree independently that the
contradiction was intentional.

## 9. Browser validation (against seeded data, after `npm run seed`)

Mandatory:

1. **`radu@test.ro`** (ended tenancy, `inactive-readonly` account status —
   confirmed via SRS FR-TEN-24/FR-CON-05 and `guards.jsx` that this status
   does NOT block Auth login, unlike `disabled`/`archived`) — log in, open
   `/app/contract`: contract fields render (ended tenancy's own dates/rent/
   deposit/dueDay), the attached contract document is listed with a working
   download link, no crash, no "ended" banner (out of scope here).
2. **`ioana@test.ro`** (active tenancy, `attachedDocuments: []`) — log in,
   open `/app/contract`: contract fields render, "contract not yet uploaded"
   message shows, no document links.

Also check: 3. `chirias@test.ro` (active, has a contract) — documents list renders, link
opens/downloads the seeded contract PDF successfully (same token
mechanism proven at `945f328`). 4. Nav — `TenantLayout`'s existing "Contract" link actually reaches this
page (no route/nav wiring bug).

## 10. Risks

- **`securityDeposit` absence is unit-test-only.** Grepped `functions/src/
kyc.js` and confirmed the only real "absent" shape is a missing key
  (`undefined`), never `''`/`null` — so CT7 fully covers the real shape.
  However, no seeded tenancy actually has `securityDeposit` absent (chirias/
  radu/ioana all have a value) — this state is never seen in browser
  validation, only in the unit test. The fix is not to change `seed.js`
  (frozen this sub-stage) — just a known gap in live coverage, flagged here
  rather than silently assumed covered.
- **Denormalization trust.** `tenancy.property.name`/`.address` are assumed
  present, same "trust the denormalized field, don't defensively re-validate
  it" posture as sub-stage 3. Low risk — `onPropertyUpdate` keeps it synced.
- **`formatAddress` duplication.** A second private copy of the same
  one-line helper (after `PropertiesListPage`'s own) is a small amount of
  duplication, consistent with this codebase's existing choice not to share
  page-local presentational helpers across features (mirrors
  `collectAttachments` staying private per page). Flagged, not blocking.
- **CT10 will fail at sub-stage 9, by design.** CT10 asserts that no
  ended-tenancy banner renders — sub-stage 9 (the persistent "contract
  ended" banner, FR-TAPP-06) will deliberately add exactly that banner to
  this same page. This is a planned supersedure of CT10, not a regression to
  investigate when it happens — same precedent as sub-stage 6 superseding
  sub-stage 5's own HP7. Sub-stage 9's replacement test must say so in its
  own docstring, per §8's CT10 note above.

## 11. Not in scope here

- The "Download PDF" (FR-TAPP-04) generation button — separate feature,
  sub-stage 8, and doesn't apply to this page's static per-document links
  anyway (those are direct Storage downloads, not generated PDFs).
- The persistent "contract ended" banner — sub-stage 9.
- Any change to `storage.rules`, `firestore.rules`, `seed.js`, `hooks.js`,
  `reportAdapter.js`, `ReportSummaryView.jsx`, or `SRS.md`.
