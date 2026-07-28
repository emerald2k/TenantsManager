# M4 Sub-stage 7 — Current month + dashboard — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. This project's own gate discipline (CLAUDE.md §2) overrides the generic skill's per-task commit steps — see "Commit discipline" below. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `/admin` and `/admin/current-month` placeholders with the real admin dashboard (FR-DASH-01/03) and current-month report-status list (FR-DASH-02) — entirely client-side, reusing the existing TanStack Query layer.

**Architecture:** One new query hook (`useReportsForMonth`) added to the existing `reports/hooks.js`, plus invalidation wiring on five already-shipped report mutations so the dashboard/current-month stay fresh after a sign/payment/draft-save. Two new pages in a new `features/dashboard/` folder, each composing existing hooks (`useProperties`, `useUsers`, `useActiveTenancies`, `useReportsForMonth`) with plain in-memory joins/filters — no new Firestore queries beyond the one hook, no new indexes, no Security Rules changes.

**Tech Stack:** React, TanStack Query, react-i18next, react-router-dom, Tailwind (existing utility classes only — no new design tokens).

## Global Constraints

- **Zero SRS edits, zero Security Rules changes, zero `functions/` changes** — confirmed explicitly below in "Confirmations."
- No format validation, no new fields, no new Firestore collections/documents.
- `getDocs`, never `onSnapshot` (established convention, every prior sub-stage).
- No `orderBy` in new queries — equality filters only, sort in memory (NFR-PERF-01 scale, matches `useProperties`/`useActiveTenancies`/`recomputeCurrentBalance` precedent).
- All visible text through i18n (RO/EN), both `ro.json` and `en.json` updated together.
- Firestore writes: N/A — this sub-stage adds zero writes (read-only pages). The `stripUndefinedDeep` discipline does not apply here.
- **Commit discipline (this project, not the generic skill default):** per CLAUDE.md §2 and the pattern used in sub-stages 4/5/6, this plan is executed as ONE implementation phase, staged but **not committed**, then verified (`test:run`, lint, build) and reported. The user validates in the browser and gives explicit commit approval before any `git commit`. Task boundaries below are for review/testing granularity within that single phase, not separate commits.

---

## Decisions already pinned by the user (not reopened here)

Reproduced verbatim from the brief, so every task can be checked against them directly:

1. **"Total to collect this month"** = Σ(`finalTotal` − (`amountPaid` ?? 0)) over reports where `status == 'signed'`, for the **current calendar month**, **on occupied properties**. `amountPaid ?? 0` guards `NaN`.
   - _Why "occupied properties" doesn't lose money on an ended tenancy mid-month:_ `endTenancy` (functions/src/tenancy.js) refuses to run while `currentBalance > 0` — a tenancy can only end once its most recent signed report's `finalTotal − amountPaid` is exactly 0. So excluding a just-ended tenancy's property from this sum can never silently drop a nonzero amount; it only ever excludes a 0. Verified against `endTenancy`'s precondition, not assumed.
2. **"Total arrears"** = Σ(`currentBalance`) over tenancies where `status == 'active'` and `currentBalance > 0`. Absent `currentBalance` → treated as 0, excluded. Red if > 0.
3. **Current-month badge** (per occupied property, for the _selected_ month), in this exact precedence:
   - No signed report (doc absent OR `status == 'draft'`) → `not-entered`
   - `paymentStatus == 'paid'` → `paid`
   - `paymentStatus == 'partial'` → `partial` (even past due date — partial always wins over overdue)
   - unpaid (`paymentStatus == 'unpaid'` OR **absent**) AND today > `dueDate` → `overdue`
   - unpaid (same as above) AND today ≤ `dueDate` → `published`
4. These are **display-only** derivations — no SRS edit, no new field.
5. Dashboard (`/admin`) is fixed to the current calendar month, no selector. The selector lives only on `/admin/current-month`, current month by default, navigable backward.

---

## File structure

**New:**

- `web/src/features/dashboard/calculations.js` — pure functions, no React/Firestore imports: `calculateOutstandingThisMonth`, `calculateTotalArrears`, `deriveReportStatusBadge`, `isFirstLaunch`, `formatMonthYearLabel`.
- `web/src/features/dashboard/pages/DashboardPage.jsx` — `/admin`.
- `web/src/features/dashboard/pages/CurrentMonthPage.jsx` — `/admin/current-month`.
- `web/tests/dashboard.calculations.test.js`
- `web/tests/dashboard.page.test.jsx`
- `web/tests/dashboard.currentMonthPage.test.jsx`

**Modified:**

- `web/src/features/reports/hooks.js` — add `useReportsForMonth`, extend `reportKeys`, add one invalidation line to 5 existing mutations.
- `web/tests/reports.hooks.test.jsx` — tests for the above.
- `web/src/routes/index.jsx` — swap the two placeholders.
- `web/src/lib/i18n/locales/ro.json`, `web/src/lib/i18n/locales/en.json` — new `dashboard` namespace.

**Untouched (confirmed):** `functions/`, `firestore.rules`, `SRS.md`, `MonthlyReportPage.jsx` (already reads `?month=&year=` from the URL — confirmed at `web/src/features/reports/pages/MonthlyReportPage.jsx:61-62` — the current-month list just needs to link there correctly), `AdminLayout.jsx` (nav already points at both routes), `PropertiesListPage.jsx` (its balance-column TODO is a different page, out of scope).

---

## Query-strategy decision (as requested: propose and justify)

**Chosen: a single two-equality query, `where('month','==',M).where('year','==',Y)` over `monthlyReports`, no `orderBy`, no status filter — fetched ONCE per (month, year) and consumed differently by each caller.**

Rejected alternative: N parallel `getDoc(buildReportId(propertyId, month, year))` calls, one per occupied property. Rejected because:

- It requires the occupied-property list to exist _first_ (from `useActiveTenancies`), turning one hook into two sequential round-trips instead of one.
- N `getDoc`s (typically 5–20 at this project's scale, NFR-PERF-01) is not obviously cheaper than 1 query, and is strictly worse for the dashboard total, which needs **every** signed report of the month regardless of whether its tenancy is still active today (see pinned Decision 1's "occupied" filter — that filter is applied in memory, against the _current_ active-tenancy set, not baked into which reports get fetched).

Why the two-equality query needs no composite index: Firestore auto-indexes every field for single-field equality; a query combining **only** `==` filters (no `orderBy`, no range/`!=`) is served by the automatic single-field indexes composed at query time — no entry in `firestore.indexes.json` is required. This mirrors the exact precedent already in this codebase: `useActiveTenancies` (`where('status','==','active')`), `useActiveTenancyForProperty` (two equalities), and `recomputeCurrentBalance` (functions/src/reports.js). **This is confirmed against the Firestore emulator in this codebase's existing test suite, not a production guarantee** — `firestore.indexes.json` stays empty; if a real deploy at M7 ever surfaces an index requirement (Firestore's own error message names the exact index to create), that's a one-line addition at that time, not a redesign.

The one query serves both consumers by filtering client-side after the fetch:

- **Dashboard total:** filter to `status === 'signed'` AND `propertyId` in the occupied set (from `useActiveTenancies`).
- **Current-month list:** no status filter — a `draft` report still needs to show its running total and drive the `not-entered` badge correctly, so all statuses for the month are needed in memory.

---

## Empty-state detection (FR-DASH-03)

`isFirstLaunch(properties, users)` = `properties.length === 0 && users.length === 0`. Sourced from `useProperties()` (default call — `includeArchived: false`) and `useUsers()`, both already used elsewhere in the app, so this costs no extra cache entry. `includeArchived: true` is deliberately **not** used: reaching "first launch" (zero properties) requires never having archived one either — archiving presupposes a property existed — so the default query already covers the real case, and a second cache entry for a state that can't occur on a genuine first launch would be waste.

---

## Task 1: `useReportsForMonth` + invalidation wiring on 5 existing mutations

**Files:**

- Modify: `web/src/features/reports/hooks.js`
- Test: `web/tests/reports.hooks.test.jsx`

**Interfaces:**

- Produces: `reportKeys.lists()` → `['monthlyReports','list']`; `reportKeys.forMonth(month, year)` → `['monthlyReports','list','month',month,year]`; `useReportsForMonth(month, year)` → `{ data: Report[], isPending, isError }`, where each `Report` is `{ id, ...docData }` (same shape as `useMonthlyReport`'s single-doc read).

- [ ] **Step 1: Extend imports and `reportKeys`**

At the top of `web/src/features/reports/hooks.js`, change:

```js
import {
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore'
```

to:

```js
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore'
```

Replace:

```js
export const reportKeys = {
  all: ['monthlyReports'],
  details: () => [...reportKeys.all, 'detail'],
  detail: (id) => [...reportKeys.details(), id],
}
```

with:

```js
export const reportKeys = {
  all: ['monthlyReports'],
  details: () => [...reportKeys.all, 'detail'],
  detail: (id) => [...reportKeys.details(), id],
  lists: () => [...reportKeys.all, 'list'],
  forMonth: (month, year) => [...reportKeys.lists(), 'month', month, year],
}
```

- [ ] **Step 2: Add `useReportsForMonth`**, right after `useMonthlyReport`:

```js
/**
 * Every report (any status) for one calendar month, across ALL properties —
 * the shared read behind both dashboard cards and the Current month list
 * (M4 sub-stage 7 plan, "Query-strategy decision"). A single two-equality
 * query (month, year), no orderBy — same no-composite-index convention as
 * useActiveTenancies/useActiveTenancyForProperty. Callers filter further
 * in memory (by status, by occupied propertyId) because the two consumers
 * need different subsets of the same fetch.
 */
export function useReportsForMonth(month, year) {
  return useQuery({
    queryKey: reportKeys.forMonth(month, year),
    queryFn: async () => {
      const snap = await getDocs(
        query(
          collection(db, COLLECTION),
          where('month', '==', month),
          where('year', '==', year),
        ),
      )
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
    },
  })
}
```

- [ ] **Step 3: Write the failing tests** — append to `web/tests/reports.hooks.test.jsx` (mirrors this file's existing Firestore-mock harness — check the top of the file for how `getDocs`/`query`/`where`/`collection` are already mocked from `firebase/firestore` for other hooks in this suite, and reuse that same mock shape):

```js
describe('useReportsForMonth', () => {
  it('queries monthlyReports with two equality filters (month, year), no orderBy', async () => {
    getDocs.mockResolvedValue({
      docs: [
        {
          id: 'p1_2026-07',
          data: () => ({
            propertyId: 'p1',
            month: 7,
            year: 2026,
            status: 'signed',
          }),
        },
      ],
    })

    const { result } = renderHook(() => useReportsForMonth(7, 2026), {
      wrapper: createWrapper(),
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(where).toHaveBeenCalledWith('month', '==', 7)
    expect(where).toHaveBeenCalledWith('year', '==', 2026)
    expect(result.current.data).toEqual([
      {
        id: 'p1_2026-07',
        propertyId: 'p1',
        month: 7,
        year: 2026,
        status: 'signed',
      },
    ])
  })
})
```

(Match this test's exact mocking mechanics to whatever pattern the rest of `reports.hooks.test.jsx` already uses for `useMonthlyReport` — `renderHook`/`createWrapper`/mock shape must be copied from there, not invented fresh.)

- [ ] **Step 4: Run to verify it fails**, then implement Step 1-2 above, then run again to verify it passes.

Run: `npm run test:run --prefix web -- reports.hooks.test.jsx`

- [ ] **Step 5: Add `reportKeys.lists()` invalidation to the 5 existing mutations.**

This is a deliberate change to hooks shipped in sub-stages 4/5/6 — without it, signing a report (or marking a payment) leaves the dashboard/current-month showing stale data for up to `staleTime` (30s) or until an unrelated remount. Five one-line additions, each inside the existing `onSuccess`:

In `useSaveReportDraft`'s `onSuccess`:

```js
onSuccess: (id) => {
  queryClient.invalidateQueries({ queryKey: reportKeys.detail(id) })
  queryClient.invalidateQueries({ queryKey: reportKeys.lists() })
},
```

In `useSignReport`'s `onSuccess`:

```js
onSuccess: (_result, { id }) => {
  queryClient.invalidateQueries({ queryKey: reportKeys.detail(id) })
  queryClient.invalidateQueries({ queryKey: reportKeys.lists() })
},
```

In `useUnlockReport`'s `onSuccess`: same pattern as `useSignReport`.

In `useMarkPayment`'s `onSuccess`:

```js
onSuccess: (_result, { id }) => {
  queryClient.invalidateQueries({ queryKey: reportKeys.detail(id) })
  queryClient.invalidateQueries({ queryKey: ['tenancies'] })
  queryClient.invalidateQueries({ queryKey: reportKeys.lists() })
},
```

In `useCancelPayment`'s `onSuccess`: same pattern as `useMarkPayment`.

`useSendReportNotification` is deliberately **not** touched — it writes only to `mail`, nothing report-related changes (already documented in its own doc-comment).

- [ ] **Step 6: Write the failing tests for the invalidation**, appended to the existing `describe('useSignReport', ...)` and `describe('useMarkPayment', ...)` blocks in `reports.hooks.test.jsx`:

```js
it('also invalidates the month-list query key on success', async () => {
  const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
  httpsCallableMock.mockResolvedValue({ data: {} }) // adjust to this file's existing signReport-mock convention
  const { result } = renderHook(() => useSignReport(), {
    wrapper: createWrapper(),
  })

  await result.current.mutateAsync({ id: 'r1' })

  expect(invalidateSpy).toHaveBeenCalledWith({
    queryKey: ['monthlyReports', 'list'],
  })
})
```

(and the equivalent for `useMarkPayment`, using that hook's existing `updateDoc`-mock convention in this file rather than `httpsCallable`).

- [ ] **Step 7: Run the full reports.hooks test file, verify all green.**

Run: `npm run test:run --prefix web -- reports.hooks.test.jsx`

---

## Task 2: `dashboard/calculations.js` — pure functions + tests

**Files:**

- Create: `web/src/features/dashboard/calculations.js`
- Test: `web/tests/dashboard.calculations.test.js`

**Interfaces:**

- Consumes: nothing (pure, no imports beyond `Intl`).
- Produces:
  - `calculateOutstandingThisMonth(reports: Report[], occupiedPropertyIds: string[]): number`
  - `calculateTotalArrears(activeTenancies: Tenancy[]): number`
  - `deriveReportStatusBadge(report: Report | null, referenceDate?: Date): 'not-entered' | 'published' | 'paid' | 'partial' | 'overdue'`
  - `isFirstLaunch(properties: Property[], users: User[]): boolean`
  - `formatMonthYearLabel(month: number, year: number, language: 'ro' | 'en'): string`

- [ ] **Step 1: Write the failing tests** — `web/tests/dashboard.calculations.test.js`:

```js
import { describe, expect, it } from 'vitest'
import {
  calculateOutstandingThisMonth,
  calculateTotalArrears,
  deriveReportStatusBadge,
  isFirstLaunch,
  formatMonthYearLabel,
} from '@/features/dashboard/calculations'

describe('calculateOutstandingThisMonth', () => {
  it('sums finalTotal - amountPaid over SIGNED reports only, on occupied properties', () => {
    const reports = [
      { propertyId: 'p1', status: 'signed', finalTotal: 1000, amountPaid: 400 },
      { propertyId: 'p2', status: 'draft', finalTotal: 500, amountPaid: 0 },
    ]
    expect(calculateOutstandingThisMonth(reports, ['p1', 'p2'])).toBe(600)
  })

  it('treats missing amountPaid as 0 (guards NaN)', () => {
    const reports = [{ propertyId: 'p1', status: 'signed', finalTotal: 1000 }]
    expect(calculateOutstandingThisMonth(reports, ['p1'])).toBe(1000)
  })

  it('excludes a signed report whose property is not in the occupied set', () => {
    const reports = [
      { propertyId: 'p9', status: 'signed', finalTotal: 1000, amountPaid: 0 },
    ]
    expect(calculateOutstandingThisMonth(reports, ['p1'])).toBe(0)
  })
})

describe('calculateTotalArrears', () => {
  it('sums currentBalance over active tenancies where currentBalance > 0', () => {
    const tenancies = [
      { status: 'active', currentBalance: 300 },
      { status: 'active', currentBalance: -100 },
      { status: 'active', currentBalance: 0 },
    ]
    expect(calculateTotalArrears(tenancies)).toBe(300)
  })

  it('treats missing currentBalance as 0 (excluded)', () => {
    expect(calculateTotalArrears([{ status: 'active' }])).toBe(0)
  })
})

describe('deriveReportStatusBadge', () => {
  const TODAY = new Date(2026, 6, 20) // 20 iulie 2026

  it('no report at all -> not-entered', () => {
    expect(deriveReportStatusBadge(null, TODAY)).toBe('not-entered')
  })

  it('draft report -> not-entered (never signed yet)', () => {
    expect(deriveReportStatusBadge({ status: 'draft' }, TODAY)).toBe(
      'not-entered',
    )
  })

  it('signed + paid -> paid', () => {
    expect(
      deriveReportStatusBadge(
        { status: 'signed', paymentStatus: 'paid', dueDate: '2026-07-05' },
        TODAY,
      ),
    ).toBe('paid')
  })

  it('signed + partial, PAST due date -> partial (never overdue)', () => {
    expect(
      deriveReportStatusBadge(
        { status: 'signed', paymentStatus: 'partial', dueDate: '2026-07-05' },
        TODAY,
      ),
    ).toBe('partial')
  })

  it('signed + unpaid, past due date -> overdue', () => {
    expect(
      deriveReportStatusBadge(
        { status: 'signed', paymentStatus: 'unpaid', dueDate: '2026-07-05' },
        TODAY,
      ),
    ).toBe('overdue')
  })

  it('signed + unpaid, within due date -> published', () => {
    expect(
      deriveReportStatusBadge(
        { status: 'signed', paymentStatus: 'unpaid', dueDate: '2026-07-25' },
        TODAY,
      ),
    ).toBe('published')
  })

  it('signed + paymentStatus ABSENT entirely (never marked), past due -> overdue, never crashes', () => {
    expect(
      deriveReportStatusBadge(
        { status: 'signed', dueDate: '2026-07-05' },
        TODAY,
      ),
    ).toBe('overdue')
  })

  it('signed + paymentStatus ABSENT entirely, within due date -> published', () => {
    expect(
      deriveReportStatusBadge(
        { status: 'signed', dueDate: '2026-07-25' },
        TODAY,
      ),
    ).toBe('published')
  })

  it('due date is exactly today -> not yet overdue (published)', () => {
    expect(
      deriveReportStatusBadge(
        { status: 'signed', dueDate: '2026-07-20' },
        TODAY,
      ),
    ).toBe('published')
  })
})

describe('isFirstLaunch', () => {
  it('true only when both properties and users are empty', () => {
    expect(isFirstLaunch([], [])).toBe(true)
    expect(isFirstLaunch([{ id: 'p1' }], [])).toBe(false)
    expect(isFirstLaunch([], [{ id: 'u1' }])).toBe(false)
  })
})

describe('formatMonthYearLabel', () => {
  it('formats in Romanian', () => {
    expect(formatMonthYearLabel(7, 2026, 'ro')).toBe('iulie 2026')
  })

  it('formats in English', () => {
    expect(formatMonthYearLabel(7, 2026, 'en')).toBe('July 2026')
  })
})
```

- [ ] **Step 2: Run to verify all fail** (module doesn't exist yet).

Run: `npm run test:run --prefix web -- dashboard.calculations.test.js`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Implement** `web/src/features/dashboard/calculations.js`:

```js
/**
 * Pure display-derivation functions for the admin dashboard (FR-DASH-01/02/03,
 * SRS §5.3) and the Current month list. No Firestore/React imports — every
 * function here takes already-fetched data and returns a number/string/enum.
 * The formulas are the M4 sub-stage 7 plan's pinned decisions, not
 * independent design choices — see the plan doc's "Decisions already pinned"
 * section for the full reasoning (especially why "on occupied properties"
 * can never silently drop a nonzero amount, given endTenancy's currentBalance
 * === 0 precondition).
 */

export function calculateOutstandingThisMonth(reports, occupiedPropertyIds) {
  const occupied = new Set(occupiedPropertyIds)
  return reports
    .filter(
      (report) => report.status === 'signed' && occupied.has(report.propertyId),
    )
    .reduce(
      (sum, report) => sum + (report.finalTotal - (report.amountPaid ?? 0)),
      0,
    )
}

export function calculateTotalArrears(activeTenancies) {
  return activeTenancies
    .filter((tenancy) => (tenancy.currentBalance ?? 0) > 0)
    .reduce((sum, tenancy) => sum + tenancy.currentBalance, 0)
}

/**
 * Badge precedence (pinned, do not reorder):
 * no signed report -> not-entered; paid -> paid; partial -> partial (even
 * past due); unpaid/absent + past due -> overdue; unpaid/absent + in term
 * -> published. `paymentStatus` absent (report never had a payment marked)
 * falls through to the same branch as 'unpaid' by construction below.
 */
export function deriveReportStatusBadge(report, referenceDate = new Date()) {
  if (!report || report.status !== 'signed') return 'not-entered'
  if (report.paymentStatus === 'paid') return 'paid'
  if (report.paymentStatus === 'partial') return 'partial'
  return isPastDueDate(report.dueDate, referenceDate) ? 'overdue' : 'published'
}

/** ISO date string split into a LOCAL Date (not `new Date(isoString)`, which
 * parses as UTC and would misreport the day near midnight in Bucharest —
 * same reasoning as functions/src/mail-templates/reportNotification.js's
 * formatDueDate). Compares local midnight-to-midnight: the due date itself
 * is never "overdue" yet. */
function isPastDueDate(dueDate, referenceDate) {
  const [year, month, day] = dueDate.split('-').map(Number)
  const due = new Date(year, month - 1, day)
  const today = new Date(
    referenceDate.getFullYear(),
    referenceDate.getMonth(),
    referenceDate.getDate(),
  )
  return today > due
}

export function isFirstLaunch(properties, users) {
  return properties.length === 0 && users.length === 0
}

function localeFor(language) {
  return language === 'ro' ? 'ro-RO' : 'en-US'
}

export function formatMonthYearLabel(month, year, language) {
  const date = new Date(year, month - 1, 1)
  return new Intl.DateTimeFormat(localeFor(language), {
    month: 'long',
    year: 'numeric',
  }).format(date)
}
```

- [ ] **Step 4: Run to verify all pass.**

Run: `npm run test:run --prefix web -- dashboard.calculations.test.js`
Expected: PASS, all cases.

---

## Task 3: `DashboardPage` (`/admin`)

**Files:**

- Create: `web/src/features/dashboard/pages/DashboardPage.jsx`
- Modify: `web/src/routes/index.jsx`
- Modify: `web/src/lib/i18n/locales/ro.json`, `web/src/lib/i18n/locales/en.json`
- Test: `web/tests/dashboard.page.test.jsx`

**Interfaces:**

- Consumes: `useProperties()`, `useUsers()` (`@/features/tenants/hooks`), `useActiveTenancies()` (`@/features/tenants/hooks`), `useReportsForMonth(month, year)` (`@/features/reports/hooks`, Task 1), `calculateOutstandingThisMonth`/`calculateTotalArrears`/`isFirstLaunch` (Task 2), `useCreateDraft` (`@/features/onboarding/hooks`, same as `TenantsListPage`'s "+ New tenant onboarding" button at `web/src/features/tenants/pages/TenantsListPage.jsx:88,155-156`), `formatCurrency` (`@/lib/formatCurrency`).
- Produces: default export-free named export `DashboardPage`, mounted at `/admin`.

- [ ] **Step 1: Add i18n keys.** In `web/src/lib/i18n/locales/en.json`, add a new top-level `"dashboard"` object (placed after the existing `"reports"` block, matching this file's alphabetical-ish existing ordering by feature):

```json
"dashboard": {
  "title": "Dashboard",
  "outstandingThisMonth": "Total to collect this month",
  "totalArrears": "Total arrears",
  "error": "Could not load the dashboard.",
  "emptyState": {
    "title": "Welcome — let's get started",
    "addProperty": "Add property",
    "enrollTenant": "Enroll tenant"
  }
}
```

In `web/src/lib/i18n/locales/ro.json`, the matching Romanian block in the same position:

```json
"dashboard": {
  "title": "Panou de control",
  "outstandingThisMonth": "Total de încasat luna asta",
  "totalArrears": "Total arierate",
  "error": "Panoul de control nu a putut fi încărcat.",
  "emptyState": {
    "title": "Bine ai venit — hai să începem",
    "addProperty": "Adaugă proprietate",
    "enrollTenant": "Înrolează chiriaș"
  }
}
```

(This task only needs the keys above; Task 4 adds a `dashboard.currentMonth` sibling block in the same file.)

- [ ] **Step 2: Write the failing tests** — `web/tests/dashboard.page.test.jsx`, following `web/tests/properties.listPage.test.jsx`'s exact mocking pattern (hook module mocked, `react-router-dom`'s `useNavigate` partially mocked, `renderWithProviders`):

```jsx
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithProviders } from './renderWithProviders'
import { DashboardPage } from '@/features/dashboard/pages/DashboardPage'
import { useProperties } from '@/features/properties/hooks'
import { useUsers, useActiveTenancies } from '@/features/tenants/hooks'
import { useReportsForMonth } from '@/features/reports/hooks'
import { useCreateDraft } from '@/features/onboarding/hooks'

vi.mock('@/features/properties/hooks', () => ({ useProperties: vi.fn() }))
vi.mock('@/features/tenants/hooks', () => ({
  useUsers: vi.fn(),
  useActiveTenancies: vi.fn(),
}))
vi.mock('@/features/reports/hooks', () => ({ useReportsForMonth: vi.fn() }))
vi.mock('@/features/onboarding/hooks', () => ({ useCreateDraft: vi.fn() }))

const navigate = vi.fn()
vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal()),
  useNavigate: () => navigate,
}))

function mockData({
  properties = [],
  users = [],
  tenancies = [],
  reports = [],
} = {}) {
  useProperties.mockReturnValue({
    data: properties,
    isPending: false,
    isError: false,
  })
  useUsers.mockReturnValue({ data: users, isPending: false, isError: false })
  useActiveTenancies.mockReturnValue({
    data: tenancies,
    isPending: false,
    isError: false,
  })
  useReportsForMonth.mockReturnValue({
    data: reports,
    isPending: false,
    isError: false,
  })
  useCreateDraft.mockReturnValue({ mutateAsync: vi.fn(), isPending: false })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('DashboardPage', () => {
  it('empty state: zero properties AND zero users -> only the two actions, no totals', async () => {
    mockData({ properties: [], users: [] })
    await renderWithProviders(<DashboardPage />)

    expect(screen.getByText('Adaugă proprietate')).toBeVisible()
    expect(screen.getByText('Înrolează chiriaș')).toBeVisible()
    expect(
      screen.queryByText('Total de încasat luna asta'),
    ).not.toBeInTheDocument()
  })

  it('with data: shows both totals, computed via the pinned formulas', async () => {
    mockData({
      properties: [{ id: 'p1' }],
      users: [{ id: 'u1' }],
      tenancies: [{ propertyId: 'p1', status: 'active', currentBalance: 300 }],
      reports: [
        {
          propertyId: 'p1',
          status: 'signed',
          finalTotal: 1000,
          amountPaid: 400,
        },
      ],
    })
    await renderWithProviders(<DashboardPage />)

    expect(screen.getByText('600,00 lei')).toBeVisible()
    expect(screen.getByText('300,00 lei')).toBeVisible()
  })

  it('total arrears renders in the destructive tone when > 0', async () => {
    mockData({
      properties: [{ id: 'p1' }],
      users: [{ id: 'u1' }],
      tenancies: [{ propertyId: 'p1', status: 'active', currentBalance: 300 }],
    })
    await renderWithProviders(<DashboardPage />)

    expect(screen.getByText('300,00 lei')).toHaveClass('text-destructive')
  })

  it('shows 0, not hidden, when totals are genuinely zero but data exists', async () => {
    mockData({ properties: [{ id: 'p1' }], users: [{ id: 'u1' }] })
    await renderWithProviders(<DashboardPage />)

    expect(screen.getAllByText('0,00 lei')).toHaveLength(2)
  })

  it('clicking a total card navigates to /admin/current-month', async () => {
    mockData({ properties: [{ id: 'p1' }], users: [{ id: 'u1' }] })
    await renderWithProviders(<DashboardPage />)

    screen.getByText('Total de încasat luna asta').closest('button').click()
    expect(navigate).toHaveBeenCalledWith('/admin/current-month')
  })

  it('shows a loading state while any source query is pending', async () => {
    mockData()
    useProperties.mockReturnValue({
      data: undefined,
      isPending: true,
      isError: false,
    })
    await renderWithProviders(<DashboardPage />)

    expect(screen.getByText('Se încarcă…')).toBeVisible()
  })
})
```

(Adjust the loading-text assertion to whatever `common.loading` actually resolves to in `ro.json` — check the file rather than assume.)

- [ ] **Step 3: Run to verify failure** (component doesn't exist).

Run: `npm run test:run --prefix web -- dashboard.page.test.jsx`

- [ ] **Step 4: Implement** `web/src/features/dashboard/pages/DashboardPage.jsx`:

```jsx
import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { useProperties } from '@/features/properties/hooks'
import { useUsers, useActiveTenancies } from '@/features/tenants/hooks'
import { useReportsForMonth } from '@/features/reports/hooks'
import { useCreateDraft } from '@/features/onboarding/hooks'
import { formatCurrency } from '@/lib/formatCurrency'
import {
  calculateOutstandingThisMonth,
  calculateTotalArrears,
  isFirstLaunch,
} from '@/features/dashboard/calculations'

/**
 * The admin dashboard (FR-DASH-01/03, SRS §5.3). Fixed to the current
 * calendar month by design (pinned decision, M4 sub-stage 7 plan) — no
 * selector here; the selector lives on /admin/current-month.
 */
export function DashboardPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const createDraft = useCreateDraft()

  const now = new Date()
  const month = now.getMonth() + 1
  const year = now.getFullYear()

  const properties = useProperties()
  const users = useUsers()
  const tenancies = useActiveTenancies()
  const reports = useReportsForMonth(month, year)

  const isPending =
    properties.isPending ||
    users.isPending ||
    tenancies.isPending ||
    reports.isPending
  const isError =
    properties.isError || users.isError || tenancies.isError || reports.isError

  const occupiedPropertyIds = useMemo(
    () => (tenancies.data ?? []).map((tenancy) => tenancy.propertyId),
    [tenancies.data],
  )

  const outstandingThisMonth = useMemo(
    () =>
      calculateOutstandingThisMonth(reports.data ?? [], occupiedPropertyIds),
    [reports.data, occupiedPropertyIds],
  )
  const totalArrears = useMemo(
    () => calculateTotalArrears(tenancies.data ?? []),
    [tenancies.data],
  )

  async function goToNewTenant() {
    const draftId = await createDraft.mutateAsync()
    navigate(`/admin/onboarding/${draftId}`)
  }

  if (isPending) {
    return (
      <div className="p-6">
        <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
      </div>
    )
  }

  if (isError) {
    return (
      <div className="p-6">
        <p className="text-sm text-destructive">{t('dashboard.error')}</p>
      </div>
    )
  }

  if (isFirstLaunch(properties.data, users.data)) {
    return (
      <div className="flex flex-col items-start gap-4 p-6">
        <h1 className="text-xl font-semibold text-foreground">
          {t('dashboard.emptyState.title')}
        </h1>
        <div className="flex gap-3">
          <Button
            type="button"
            onClick={() => navigate('/admin/properties/new')}
          >
            {t('dashboard.emptyState.addProperty')}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={goToNewTenant}
            disabled={createDraft.isPending}
          >
            {t('dashboard.emptyState.enrollTenant')}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <h1 className="text-xl font-semibold text-foreground">
        {t('dashboard.title')}
      </h1>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <button
          type="button"
          onClick={() => navigate('/admin/current-month')}
          className="flex flex-col items-start gap-2 rounded-lg border border-border p-6 text-left hover:bg-muted/50"
        >
          <span className="text-sm text-muted-foreground">
            {t('dashboard.outstandingThisMonth')}
          </span>
          <span className="text-2xl font-semibold text-foreground tabular-nums">
            {formatCurrency(outstandingThisMonth)}
          </span>
        </button>
        <button
          type="button"
          onClick={() => navigate('/admin/current-month')}
          className="flex flex-col items-start gap-2 rounded-lg border border-border p-6 text-left hover:bg-muted/50"
        >
          <span className="text-sm text-muted-foreground">
            {t('dashboard.totalArrears')}
          </span>
          <span
            className={`text-2xl font-semibold tabular-nums ${
              totalArrears > 0 ? 'text-destructive' : 'text-foreground'
            }`}
          >
            {formatCurrency(totalArrears)}
          </span>
        </button>
      </div>
    </div>
  )
}
```

Design call, stated plainly: both cards navigate to `/admin/current-month` (the SRS's "card-button → Current month" doesn't name which of the two cards; since both summarize "what's due this month," both being clickable is the more useful and consistent reading — low-stakes, reversible if the user wants only one).

- [ ] **Step 5: Wire the route.** In `web/src/routes/index.jsx`, add the import:

```js
import { DashboardPage } from '@/features/dashboard/pages/DashboardPage'
```

and replace:

```jsx
<Route
  path="/admin"
  element={<PlaceholderPage titleKey="pages.adminDashboard" />}
/>
```

with:

```jsx
<Route path="/admin" element={<DashboardPage />} />
```

- [ ] **Step 6: Run to verify green.**

Run: `npm run test:run --prefix web -- dashboard.page.test.jsx`

---

## Task 4: `CurrentMonthPage` (`/admin/current-month`)

**Files:**

- Create: `web/src/features/dashboard/pages/CurrentMonthPage.jsx`
- Modify: `web/src/routes/index.jsx`
- Modify: `web/src/lib/i18n/locales/ro.json`, `web/src/lib/i18n/locales/en.json`
- Test: `web/tests/dashboard.currentMonthPage.test.jsx`

**Interfaces:**

- Consumes: `useActiveTenancies()`, `useReportsForMonth(month, year)`, `deriveReportStatusBadge`, `formatMonthYearLabel` (Task 2), `formatCurrency`.
- Produces: named export `CurrentMonthPage`, mounted at `/admin/current-month`.

- [ ] **Step 1: Add the `dashboard.currentMonth` i18n block** to the same `"dashboard"` object added in Task 3, in both files.

`en.json`, inside `"dashboard": { ... }`, add:

```json
"currentMonth": {
  "title": "Current month",
  "previousMonth": "Previous month",
  "nextMonth": "Next month",
  "error": "Could not load the current month.",
  "noOccupiedProperties": "No occupied properties yet.",
  "columns": {
    "property": "Property",
    "tenant": "Tenant",
    "status": "Status",
    "total": "Total"
  },
  "badge": {
    "notEntered": "Not entered",
    "published": "Published",
    "paid": "Paid",
    "partial": "Partial",
    "overdue": "Overdue"
  }
}
```

`ro.json`, matching:

```json
"currentMonth": {
  "title": "Luna curentă",
  "previousMonth": "Luna anterioară",
  "nextMonth": "Luna următoare",
  "error": "Luna curentă nu a putut fi încărcată.",
  "noOccupiedProperties": "Nicio proprietate ocupată încă.",
  "columns": {
    "property": "Proprietate",
    "tenant": "Chiriaș",
    "status": "Status",
    "total": "Total"
  },
  "badge": {
    "notEntered": "Neintrodus",
    "published": "Publicat",
    "paid": "Plătit",
    "partial": "Parțial",
    "overdue": "Restant"
  }
}
```

- [ ] **Step 2: Write the failing tests** — `web/tests/dashboard.currentMonthPage.test.jsx`:

```jsx
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from './renderWithProviders'
import { CurrentMonthPage } from '@/features/dashboard/pages/CurrentMonthPage'
import { useActiveTenancies } from '@/features/tenants/hooks'
import { useReportsForMonth } from '@/features/reports/hooks'

vi.mock('@/features/tenants/hooks', () => ({ useActiveTenancies: vi.fn() }))
vi.mock('@/features/reports/hooks', () => ({ useReportsForMonth: vi.fn() }))

const navigate = vi.fn()
vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal()),
  useNavigate: () => navigate,
}))

function tenancy(overrides) {
  return {
    propertyId: 'p1',
    tenantName: 'Ion Popescu',
    property: { name: 'Apartament Centru' },
    status: 'active',
    currentBalance: 0,
    ...overrides,
  }
}

function mockData({ tenancies = [], reports = [] } = {}) {
  useActiveTenancies.mockReturnValue({
    data: tenancies,
    isPending: false,
    isError: false,
  })
  useReportsForMonth.mockReturnValue({
    data: reports,
    isPending: false,
    isError: false,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('CurrentMonthPage', () => {
  it('lists occupied properties with name, tenant, badge, and total', async () => {
    mockData({
      tenancies: [tenancy()],
      reports: [
        {
          propertyId: 'p1',
          month: expect.any(Number),
          status: 'signed',
          paymentStatus: 'paid',
          finalTotal: 900,
          dueDate: '2026-07-05',
        },
      ],
    })
    await renderWithProviders(<CurrentMonthPage />)

    expect(screen.getByText('Apartament Centru')).toBeVisible()
    expect(screen.getByText('Ion Popescu')).toBeVisible()
    expect(screen.getByText('Plătit')).toBeVisible()
    expect(screen.getByText('900,00 lei')).toBeVisible()
  })

  it('shows "not entered" and "—" total when no report exists for the property', async () => {
    mockData({ tenancies: [tenancy()], reports: [] })
    await renderWithProviders(<CurrentMonthPage />)

    expect(screen.getByText('Neintrodus')).toBeVisible()
    expect(screen.getByText('—')).toBeVisible()
  })

  it('shows the running total for a DRAFT report too, still badged not-entered', async () => {
    mockData({
      tenancies: [tenancy()],
      reports: [{ propertyId: 'p1', status: 'draft', finalTotal: 750 }],
    })
    await renderWithProviders(<CurrentMonthPage />)

    expect(screen.getByText('Neintrodus')).toBeVisible()
    expect(screen.getByText('750,00 lei')).toBeVisible()
  })

  it('clicking a row navigates to the report form with propertyId, month and year', async () => {
    mockData({ tenancies: [tenancy({ propertyId: 'p7' })] })
    await renderWithProviders(<CurrentMonthPage />)

    screen.getByRole('row', { name: /Apartament Centru/ }).click()

    const now = new Date()
    expect(navigate).toHaveBeenCalledWith(
      `/admin/reports/p7?month=${now.getMonth() + 1}&year=${now.getFullYear()}`,
    )
  })

  it('navigating to the previous month re-queries useReportsForMonth with the prior month/year', async () => {
    mockData({ tenancies: [tenancy()] })
    const user = userEvent.setup()
    await renderWithProviders(<CurrentMonthPage />)

    await user.click(screen.getByRole('button', { name: 'Luna anterioară' }))

    const now = new Date()
    const prevMonth = now.getMonth() === 0 ? 12 : now.getMonth()
    const prevYear =
      now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear()
    expect(useReportsForMonth).toHaveBeenLastCalledWith(prevMonth, prevYear)
  })

  it('the "next month" control is disabled once back at the current month', async () => {
    mockData({ tenancies: [tenancy()] })
    await renderWithProviders(<CurrentMonthPage />)

    expect(
      screen.getByRole('button', { name: 'Luna următoare' }),
    ).toBeDisabled()
  })

  it('free properties (no active tenancy) never appear', async () => {
    mockData({ tenancies: [] })
    await renderWithProviders(<CurrentMonthPage />)

    expect(screen.getByText('Nicio proprietate ocupată încă.')).toBeVisible()
  })
})
```

- [ ] **Step 3: Run to verify failure.**

Run: `npm run test:run --prefix web -- dashboard.currentMonthPage.test.jsx`

- [ ] **Step 4: Implement** `web/src/features/dashboard/pages/CurrentMonthPage.jsx`:

```jsx
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { useActiveTenancies } from '@/features/tenants/hooks'
import { useReportsForMonth } from '@/features/reports/hooks'
import { formatCurrency } from '@/lib/formatCurrency'
import {
  deriveReportStatusBadge,
  formatMonthYearLabel,
} from '@/features/dashboard/calculations'

const BADGE_TONE = {
  'not-entered': 'bg-muted text-muted-foreground',
  published: 'bg-secondary text-secondary-foreground',
  partial: 'bg-primary/10 text-primary',
  paid: 'bg-primary text-primary-foreground',
  overdue: 'bg-destructive/10 text-destructive',
}

function StatusBadge({ status }) {
  const { t } = useTranslation()
  const labelKey = {
    'not-entered': 'notEntered',
    published: 'published',
    paid: 'paid',
    partial: 'partial',
    overdue: 'overdue',
  }[status]

  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${BADGE_TONE[status]}`}
    >
      {t(`dashboard.currentMonth.badge.${labelKey}`)}
    </span>
  )
}

function shiftMonth({ month, year }, delta) {
  const zeroBased = month - 1 + delta
  return {
    month: (((zeroBased % 12) + 12) % 12) + 1,
    year: year + Math.floor(zeroBased / 12),
  }
}

/**
 * The Current month list (FR-DASH-02, SRS §5.3). Rows are sourced directly
 * from `useActiveTenancies` — an active tenancy already denormalizes
 * `property.name`/`tenantName` (SRS §6), so occupied-property rows need no
 * separate `properties` read/join here. Reports for the selected month are
 * fetched once (Task 1's `useReportsForMonth`) and matched by `propertyId`.
 */
export function CurrentMonthPage() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()

  const now = new Date()
  const current = { month: now.getMonth() + 1, year: now.getFullYear() }
  const [selected, setSelected] = useState(current)
  const isAtCurrentMonth =
    selected.month === current.month && selected.year === current.year

  const tenancies = useActiveTenancies()
  const reports = useReportsForMonth(selected.month, selected.year)

  const isPending = tenancies.isPending || reports.isPending
  const isError = tenancies.isError || reports.isError

  const rows = useMemo(() => {
    const reportsByProperty = new Map(
      (reports.data ?? []).map((report) => [report.propertyId, report]),
    )
    return (tenancies.data ?? [])
      .map((tenancy) => {
        const report = reportsByProperty.get(tenancy.propertyId) ?? null
        return {
          propertyId: tenancy.propertyId,
          propertyName: tenancy.property?.name ?? '',
          tenantName: tenancy.tenantName,
          badge: deriveReportStatusBadge(report),
          total: report ? report.finalTotal : null,
        }
      })
      .sort((a, b) => a.propertyName.localeCompare(b.propertyName))
  }, [tenancies.data, reports.data])

  function goToReport(propertyId) {
    navigate(
      `/admin/reports/${propertyId}?month=${selected.month}&year=${selected.year}`,
    )
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-xl font-semibold text-foreground">
          {t('dashboard.currentMonth.title')}
        </h1>
        <div className="flex items-center gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={() => setSelected((prev) => shiftMonth(prev, -1))}
          >
            {t('dashboard.currentMonth.previousMonth')}
          </Button>
          <span className="text-sm font-medium text-foreground">
            {formatMonthYearLabel(selected.month, selected.year, i18n.language)}
          </span>
          <Button
            type="button"
            variant="outline"
            disabled={isAtCurrentMonth}
            onClick={() => setSelected((prev) => shiftMonth(prev, 1))}
          >
            {t('dashboard.currentMonth.nextMonth')}
          </Button>
        </div>
      </div>

      {isPending ? (
        <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
      ) : isError ? (
        <p className="text-sm text-destructive">
          {t('dashboard.currentMonth.error')}
        </p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t('dashboard.currentMonth.noOccupiedProperties')}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border bg-muted/50">
              <tr className="text-xs text-muted-foreground">
                <th className="px-4 py-2 font-medium">
                  {t('dashboard.currentMonth.columns.property')}
                </th>
                <th className="px-4 py-2 font-medium">
                  {t('dashboard.currentMonth.columns.tenant')}
                </th>
                <th className="px-4 py-2 font-medium">
                  {t('dashboard.currentMonth.columns.status')}
                </th>
                <th className="px-4 py-2 text-right font-medium">
                  {t('dashboard.currentMonth.columns.total')}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.propertyId}
                  onClick={() => goToReport(row.propertyId)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      goToReport(row.propertyId)
                    }
                  }}
                  tabIndex={0}
                  className="cursor-pointer border-b border-border last:border-0 hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none"
                >
                  <td className="px-4 py-3 font-medium text-foreground">
                    {row.propertyName}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {row.tenantName}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={row.badge} />
                  </td>
                  <td className="px-4 py-3 text-right text-muted-foreground tabular-nums">
                    {row.total === null ? '—' : formatCurrency(row.total)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 5: Wire the route.** In `web/src/routes/index.jsx`, add the import:

```js
import { CurrentMonthPage } from '@/features/dashboard/pages/CurrentMonthPage'
```

and replace:

```jsx
<Route
  path="/admin/current-month"
  element={<PlaceholderPage titleKey="pages.currentMonth" />}
/>
```

with:

```jsx
<Route path="/admin/current-month" element={<CurrentMonthPage />} />
```

- [ ] **Step 6: Run to verify green.**

Run: `npm run test:run --prefix web -- dashboard.currentMonthPage.test.jsx`

---

## Confirmations (per the user's explicit request)

- **Zero SRS edits.** Every formula/badge rule implemented here is already pinned display-only logic (FR-DASH-01/02/03, §5.3, §6) — nothing new is defined, nothing existing is changed.
- **Zero Security Rules changes.** Both pages read `properties`, `users`, `tenancies`, `monthlyReports` — all already admin-full-access per existing `firestore.rules` (established M1-M4), exercised the same way `PropertiesListPage`/`TenantsListPage`/`MonthlyReportPage` already do. No new collection, no new access pattern.
- **Zero `functions/` changes.** No callable, no trigger, no scheduler touched.

---

## Final verification (after all 4 tasks, before staging)

Run in sequence, report raw output for each:

```bash
npm run test:run --prefix web
npm run lint --prefix web
npm run build --prefix web
```

Then browser-check manually (dev server): `/admin` empty state (fresh emulator data) → add a property + enroll a tenant → totals appear; `/admin/current-month` → previous-month navigation, row click lands on `/admin/reports/:propertyId?month=&year=` with the right values; sign a report and confirm the dashboard/current-month reflect it without a manual refresh (proves Task 1's invalidation wiring).

**STOP here after implementation + self-verification — do not commit. Report raw output, wait for browser validation and explicit commit approval, same gate as every prior sub-stage.**
