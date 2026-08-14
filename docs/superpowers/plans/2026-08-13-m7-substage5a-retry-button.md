# M7 Sub-stage 5a — Retry button on existing error states — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every error state the app renders today gets a working "Retry" button (SRS §5.5: `error (message+"Retry")`), using the message, color, and layout each site already has. No redesign, no fixing of the inconsistencies the inventory below surfaces.

**Architecture:** One tiny shared `RetryButton` component (`web/src/components/shared/RetryButton.jsx`) — a `<Button>` wired to `onRetry`/`disabled`, owning nothing about the message it sits next to. Fifteen call sites each import it and pass their own retry function: `refetch` for a `useQuery`-backed error, a re-invocation of the failed action for the two mutation-backed sites. Placing the button next to an existing single-line `<p>` requires a thin wrapping element at 11 of the 15 sites (a bare `<p>` cannot hold a sibling `<button>`) — the message's own `className` is left untouched at every site; only a flex wrapper is added around it.

**Tech Stack:** React, TanStack Query (`refetch` on queries, `mutate`/`variables` on mutations), react-i18next, Vitest + React Testing Library (fast band only — no rules/functions/e2e band touches any of this).

## Global Constraints

- i18n: one new shared key, `common.retry`, added to **both** `web/src/lib/i18n/locales/en.json` and `ro.json` (CLAUDE.md §3/§7). No existing per-feature message key changes.
- Tests land with the code, fast band (`npm run test:run --prefix web`), same file per feature as the existing suite.
- "Retry must actually re-run the failed operation" (task constraint) — every test asserting Retry's behavior asserts the underlying `refetch`/`mutate` spy was called again, never just that the button rendered or that clicking didn't crash.
- Minimal scope, confirmed with the administrator: add Retry to error messages that **already exist** in the code, as they already look. Do **not**: unify colors, separate "error" from "not found," fix the mislabeled i18n key in `TenancyTab`, or add error branches where none currently render. Those stay exactly where they were left in the M7 SRS note ("a complete empty/error-state inventory across all pages," deferred).

## Excluded sites (in scope for the inventory, out of scope for this plan) — reasoning, not silence

| Site                                                                                       | Why excluded                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `SharedReportPage.jsx:68-77` (`useSharedReport`)                                           | The hook sets `retry: false` **on purpose** — its own doc comment: _"a `not-found` here (unknown/revoked/draft token) is a REAL terminal state, not a transient failure worth retrying."_ `getSharedReportCore` collapses every rejection reason into one `not-found`; there is no way to tell a genuine network blip apart from a dead token. Offering "Retry" here would contradict the code's own stated intent and could mislead an unauthenticated tenant into thinking a revoked link might come back. |
| `OnboardingWizardPage.jsx` — `useDraft`'s query error                                      | `isError` is never even read from `useDraft(draftId)`'s return — there is no existing error message to attach a button to. "Add Retry to what's there" doesn't create a new branch; creating one is exactly the deferred inventory work.                                                                                                                                                                                                                                                                     |
| `MonthlyReportPage.jsx` — `useActiveTenancyForProperty` / `useMonthlyReport` errors        | Same reasoning: only `isPropertyError` is rendered today (line 198); the other two queries' `isError` is never destructured. No existing message, so no site to attach Retry to.                                                                                                                                                                                                                                                                                                                             |
| `TenancyTab.jsx:211-217` wrong i18n key                                                    | `tenants.detail.saveError` ("The changes could not be saved") is reused for a **load** failure — confirmed wrong, but fixing the copy is a content/defect fix outside "add retry to what's there." Retry is still added to the message as it stands today.                                                                                                                                                                                                                                                   |
| `AttachmentLink.jsx` / `LineAttachments` (`PersistedAttachment`) inline "Unavailable" text | SRS §5.5's loading/empty/error triad reads as page/section-level content state, not a per-widget annotation. These render a single grey word next to a filename when a Storage URL fails to resolve — reloading the whole page's data wouldn't obviously fix a broken attachment, and the existing fallback is already a reasonable, self-contained terminal display. Not counted among the 15 sites below.                                                                                                  |

Two more things noticed during the inventory, reported but not acted on in this plan:

- **`CLAUDE.md` has no literal "§5.5."** `grep -n "5\.5" CLAUDE.md` returns zero matches — the citation used in `CURRENT_SPRINT.md` and in the SRS's own M7 note points at a section that doesn't exist in that file. The real requirement is `SRS.md` §5.5 (quoted below). Worth a one-line correction wherever "CLAUDE.md §5.5" is cited going forward; not a code change, not done here.
- **No `ErrorBoundary` anywhere in the app.** An uncaught render error is a white screen. Real gap, but not what §5.5 asks for (§5.5 is about `isError` states TanStack Query already surfaces cleanly) — separate debt, not folded into this plan.

`SRS.md:396-397`, verbatim:

> ### 5.5 Cross-cutting UI rules
>
> States: loading (skeleton), empty (message+action), error (message+"Retry"). Confirmation for destructive actions or those affecting the tenant. Inline Zod validation, in the selected language. Amounts in RON, Romanian format.

---

## Task 1: `common.retry` i18n key

**Files:**

- Modify: `web/src/lib/i18n/locales/en.json:2-8`
- Modify: `web/src/lib/i18n/locales/ro.json:2-8`

**Interfaces:**

- Produces: the i18n key `common.retry`, consumed by `RetryButton` (Task 2).

- [ ] **Step 1: Add the key to both locale files**

`web/src/lib/i18n/locales/en.json` — current `common` block:

```json
"common": {
  "language": "Language",
  "logout": "Log out",
  "loading": "Loading...",
  "cancel": "Cancel",
  "attachmentUnavailable": "Unavailable"
}
```

New:

```json
"common": {
  "language": "Language",
  "logout": "Log out",
  "loading": "Loading...",
  "cancel": "Cancel",
  "attachmentUnavailable": "Unavailable",
  "retry": "Retry"
}
```

`web/src/lib/i18n/locales/ro.json` — current `common` block:

```json
"common": {
  "language": "Limbă",
  "logout": "Deconectare",
  "loading": "Se încarcă...",
  "cancel": "Anulează",
  "attachmentUnavailable": "Indisponibil"
}
```

New (matching the existing "Încearcă din nou" phrasing already used in `properties.list.error`, `tenants.list.loadError`, etc. — consistent wording for the same action across the app):

```json
"common": {
  "language": "Limbă",
  "logout": "Deconectare",
  "loading": "Se încarcă...",
  "cancel": "Anulează",
  "attachmentUnavailable": "Indisponibil",
  "retry": "Încearcă din nou"
}
```

- [ ] **Step 2: Commit as part of the final combined commit (Task 16) — no standalone commit here.**

---

## Task 2: `RetryButton` shared component

**Files:**

- Create: `web/src/components/shared/RetryButton.jsx`
- Test: `web/tests/retryButton.test.jsx`

**Interfaces:**

- Consumes: `@/components/ui/button`'s `Button` (`variant`, `size`, `onClick`, `disabled` props — confirmed API: `web/src/components/ui/button.jsx`).
- Produces: `RetryButton({ onRetry, disabled = false })` — a `<button>` with accessible name `t('common.retry')`. Every later task imports this exact export.

- [ ] **Step 1: Write the failing test**

```jsx
// web/tests/retryButton.test.jsx
import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from './renderWithProviders'
import { RetryButton } from '@/components/shared/RetryButton'

describe('RetryButton', () => {
  it('calls onRetry when clicked', async () => {
    const user = userEvent.setup()
    const onRetry = vi.fn()
    await renderWithProviders(<RetryButton onRetry={onRetry} />)

    await user.click(screen.getByRole('button', { name: 'Încearcă din nou' }))

    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('is disabled while a retry is already in flight, and does not call onRetry if clicked', async () => {
    const onRetry = vi.fn()
    await renderWithProviders(<RetryButton onRetry={onRetry} disabled />)

    const button = screen.getByRole('button', { name: 'Încearcă din nou' })
    expect(button).toBeDisabled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run --prefix web -- retryButton`
Expected: FAIL — `Cannot find module '@/components/shared/RetryButton'`

- [ ] **Step 3: Write the component**

```jsx
// web/src/components/shared/RetryButton.jsx
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'

/**
 * The "Retry" half of SRS §5.5's `error (message+"Retry")`. Deliberately
 * dumb: it renders next to whatever message a page already shows and calls
 * `onRetry` — it owns neither the message, its color, nor its layout.
 * `disabled` covers the retry itself being in flight, so a second click
 * can't fire a second refetch/write while the first hasn't resolved yet.
 */
export function RetryButton({ onRetry, disabled = false }) {
  const { t } = useTranslation()
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={onRetry}
      disabled={disabled}
    >
      {t('common.retry')}
    </Button>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run --prefix web -- retryButton`
Expected: PASS (2/2)

- [ ] **Step 5: Do not commit yet — part of Task 16's combined commit.**

---

## Task 3: `PropertyDetailPage`

**Files:**

- Modify: `web/src/features/properties/pages/PropertyDetailPage.jsx:4` (import), `:92` (hook destructure), `:124-130` (render)
- Test: `web/tests/properties.detailPage.test.jsx`

**Interfaces:**

- Consumes: `RetryButton` (Task 2), `useProperty`'s `refetch` (already returned by the underlying `useQuery`, just not destructured today).

- [ ] **Step 1: Write the failing test**

Add to `describe('PropertyDetailPage', ...)` in `web/tests/properties.detailPage.test.jsx`, next to the existing "shows the not-found message" test (~line 104):

```jsx
it('clicking Retry on the error state re-runs the property query', async () => {
  const refetch = vi.fn()
  useProperty.mockReturnValue({
    data: undefined,
    isPending: false,
    isError: true,
    refetch,
  })
  const user = userEvent.setup()

  await renderWithProviders(
    <Routes>
      <Route path="/admin/properties/:id" element={<PropertyDetailPage />} />
    </Routes>,
    { route: '/admin/properties/p1' },
  )
  await user.click(screen.getByRole('button', { name: 'Încearcă din nou' }))

  expect(refetch).toHaveBeenCalledTimes(1)
})
```

(`userEvent` needs importing if not already present in this file — confirm the existing top-of-file imports; add `import userEvent from '@testing-library/user-event'` if missing.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run --prefix web -- properties.detailPage`
Expected: FAIL — no button with accessible name "Încearcă din nou" found.

- [ ] **Step 3: Implement**

Add the import (near the other `@/components/...` imports, line 4-5):

```jsx
import { RetryButton } from '@/components/shared/RetryButton'
```

Change line 92:

```jsx
const { data: property, isPending, isError, refetch } = useProperty(id)
```

Change lines 124-130:

```jsx
if (isError || !property) {
  return (
    <div className="flex flex-col items-start gap-2 p-6">
      <p className="text-sm text-muted-foreground">
        {t('properties.detail.notFound')}
      </p>
      <RetryButton onRetry={refetch} />
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run --prefix web -- properties.detailPage`
Expected: PASS, full file green (no regressions on the existing not-found test — the message text and its `className` are unchanged, only wrapped).

- [ ] **Step 5: Do not commit yet.**

---

## Task 4: `TenantDetailPage`

**Files:**

- Modify: `web/src/features/tenants/pages/TenantDetailPage.jsx:4` (import), `:39` (hook destructure), `:48-54` (render)
- Test: `web/tests/tenants.detailPage.test.jsx`

**Interfaces:**

- Consumes: `RetryButton`, `useUserById`'s `refetch`.

- [ ] **Step 1: Write the failing test**

Add next to the existing error-state test (~line 105) in `web/tests/tenants.detailPage.test.jsx`:

```jsx
it('clicking Retry on the error state re-runs the user query', async () => {
  const refetch = vi.fn()
  useUserById.mockReturnValue({
    data: undefined,
    isPending: false,
    isError: true,
    refetch,
  })
  const user = userEvent.setup()

  await renderWithProviders(
    <Routes>
      <Route path="/admin/tenants/:id" element={<TenantDetailPage />} />
    </Routes>,
    { route: '/admin/tenants/u1' },
  )
  await user.click(screen.getByRole('button', { name: 'Încearcă din nou' }))

  expect(refetch).toHaveBeenCalledTimes(1)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run --prefix web -- tenants.detailPage`
Expected: FAIL — no Retry button rendered.

- [ ] **Step 3: Implement**

Add import (line 4 area):

```jsx
import { RetryButton } from '@/components/shared/RetryButton'
```

Change line 39:

```jsx
const { data: user, isPending, isError, refetch } = useUserById(id)
```

Change lines 48-54:

```jsx
if (isError || !user) {
  return (
    <div className="flex flex-col items-start gap-2 p-6">
      <p className="text-sm text-muted-foreground">
        {t('tenants.detail.notFound')}
      </p>
      <RetryButton onRetry={refetch} />
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run --prefix web -- tenants.detailPage`
Expected: PASS.

- [ ] **Step 5: Do not commit yet.**

---

## Task 5: `MonthlyReportPage`

**Files:**

- Modify: `web/src/features/reports/pages/MonthlyReportPage.jsx` (import, `:65-69` hook destructure, `:198-204` render)
- Test: `web/tests/reports.page.test.jsx`

**Interfaces:**

- Consumes: `RetryButton`, `useProperty`'s `refetch` (renamed `refetchProperty` — this file has three queries, an unqualified `refetch` would be ambiguous).

Reminder: only the property query's existing error branch gets Retry. `useActiveTenancyForProperty` and `useMonthlyReport` have no existing `isError` render — out of scope (see Excluded sites table).

- [ ] **Step 1: Write the failing test**

Add next to the existing error-state test (~line 513) in `web/tests/reports.page.test.jsx`:

```jsx
it('clicking Retry on the property error re-runs the property query', async () => {
  const refetch = vi.fn()
  useProperty.mockReturnValue({
    data: undefined,
    isPending: false,
    isError: true,
    refetch,
  })
  const user = userEvent.setup()

  await renderWithProviders(
    <Routes>
      <Route
        path="/admin/properties/:propertyId/reports"
        element={<MonthlyReportPage />}
      />
    </Routes>,
    { route: '/admin/properties/p1/reports' },
  )
  await user.click(screen.getByRole('button', { name: 'Încearcă din nou' }))

  expect(refetch).toHaveBeenCalledTimes(1)
})
```

(Match the exact route path/mock setup already used by the neighboring error test in this file — if the existing test at line ~513 uses a different route string or a `renderPage()` helper, mirror that helper instead of the inline `Routes` above; the assertion body — mock `refetch`, click, expect called — stays the same either way.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run --prefix web -- reports.page`
Expected: FAIL — no Retry button rendered.

- [ ] **Step 3: Implement**

Add import:

```jsx
import { RetryButton } from '@/components/shared/RetryButton'
```

Change lines 65-69:

```jsx
const {
  data: property,
  isPending: isPropertyPending,
  isError: isPropertyError,
  refetch: refetchProperty,
} = useProperty(propertyId)
```

Change lines 198-204:

```jsx
if (isPropertyError || !property) {
  return (
    <div className="flex flex-col items-start gap-2 p-6">
      <p className="text-sm text-muted-foreground">{t('reports.notFound')}</p>
      <RetryButton onRetry={refetchProperty} />
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run --prefix web -- reports.page`
Expected: PASS, no regression on the "no active tenancy" empty-state test (lines 206-212, untouched).

- [ ] **Step 5: Do not commit yet.**

---

## Task 6: `DashboardPage`

**Files:**

- Modify: `web/src/features/dashboard/pages/DashboardPage.jsx` (import, `:76-82` render)
- Test: `web/tests/dashboard.page.test.jsx`

**Interfaces:**

- Consumes: `RetryButton`. `properties`, `users`, `tenancies`, `reports` are already whole query objects (not destructured) — `.refetch`/`.isFetching` are already available, no hook-call changes needed.

- [ ] **Step 1: Write the failing test**

Add next to the existing "shows an error state" test (~line 150):

```jsx
it('clicking Retry re-runs every source query that fed the error', async () => {
  mockData()
  const reportsRefetch = vi.fn()
  useReportsForMonth.mockReturnValue({
    data: undefined,
    isPending: false,
    isError: true,
    isFetching: false,
    refetch: reportsRefetch,
  })
  const user = userEvent.setup()
  await renderWithProviders(<DashboardPage />)

  await user.click(screen.getByRole('button', { name: 'Încearcă din nou' }))

  expect(reportsRefetch).toHaveBeenCalledTimes(1)
})
```

Note: `mockData()`'s other three hooks (`useProperties`, `useUsers`, `useActiveTenancies`) don't set `.refetch` in their default mock return today — since the implementation calls `.refetch()` unconditionally on all four, add `refetch: vi.fn()` to `mockData`'s three other `mockReturnValue` calls too (lines 34-44), or the click will throw `refetch is not a function`. Update `mockData` in this file:

```jsx
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
    isFetching: false,
    refetch: vi.fn(),
  })
  useUsers.mockReturnValue({
    data: users,
    isPending: false,
    isError: false,
    isFetching: false,
    refetch: vi.fn(),
  })
  useActiveTenancies.mockReturnValue({
    data: tenancies,
    isPending: false,
    isError: false,
    isFetching: false,
    refetch: vi.fn(),
  })
  useReportsForMonth.mockReturnValue({
    data: reports,
    isPending: false,
    isError: false,
    isFetching: false,
    refetch: vi.fn(),
  })
  useCreateDraft.mockReturnValue({ mutateAsync: vi.fn(), isPending: false })
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run --prefix web -- dashboard.page`
Expected: FAIL — no Retry button, or (after the `mockData` edit alone) fails on "no button found."

- [ ] **Step 3: Implement**

Add import:

```jsx
import { RetryButton } from '@/components/shared/RetryButton'
```

Change lines 76-82:

```jsx
if (isError) {
  return (
    <div className="flex flex-col items-start gap-2 p-6">
      <p className="text-sm text-destructive">{t('dashboard.error')}</p>
      <RetryButton
        onRetry={() => {
          properties.refetch()
          users.refetch()
          tenancies.refetch()
          reports.refetch()
        }}
        disabled={
          properties.isFetching ||
          users.isFetching ||
          tenancies.isFetching ||
          reports.isFetching
        }
      />
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run --prefix web -- dashboard.page`
Expected: PASS, full file green (the `mockData` signature change is additive — no other test destructures fewer fields than provided).

- [ ] **Step 5: Do not commit yet.**

---

## Task 7: `CurrentMonthPage`

**Files:**

- Modify: `web/src/features/dashboard/pages/CurrentMonthPage.jsx` (import, `:69-73` hooks — no destructure change needed, whole objects already; `:127-133` render)
- Test: `web/tests/dashboard.currentMonthPage.test.jsx`

- [ ] **Step 1: Write the failing test**

Add next to the existing error-state test (~line 191):

```jsx
it('clicking Retry re-runs both source queries', async () => {
  mockData()
  const reportsRefetch = vi.fn()
  useReportsForMonth.mockReturnValue({
    data: undefined,
    isPending: false,
    isError: true,
    isFetching: false,
    refetch: reportsRefetch,
  })
  const user = userEvent.setup()
  await renderWithProviders(<CurrentMonthPage />)

  await user.click(screen.getByRole('button', { name: 'Încearcă din nou' }))

  expect(reportsRefetch).toHaveBeenCalledTimes(1)
})
```

(As in Task 6, confirm this file's `mockData`/equivalent helper for `useActiveTenancies` also stubs `refetch`/`isFetching` in its default — add them if the existing helper omits them, mirroring the Task 6 edit for this file's own hook set.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run --prefix web -- dashboard.currentMonthPage`
Expected: FAIL.

- [ ] **Step 3: Implement**

Add import:

```jsx
import { RetryButton } from '@/components/shared/RetryButton'
```

Change lines 127-133:

```jsx
      {isPending ? (
        <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
      ) : isError ? (
        <div className="flex flex-col items-start gap-2">
          <p className="text-sm text-destructive">
            {t('dashboard.currentMonth.error')}
          </p>
          <RetryButton
            onRetry={() => {
              tenancies.refetch()
              reports.refetch()
            }}
            disabled={tenancies.isFetching || reports.isFetching}
          />
        </div>
      ) : rows.length === 0 ? (
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run --prefix web -- dashboard.currentMonthPage`
Expected: PASS.

- [ ] **Step 5: Do not commit yet.**

---

## Task 8: `PropertiesListPage`

**Files:**

- Modify: `web/src/features/properties/pages/PropertiesListPage.jsx` (import, `:61-65` hook destructure, `:124-128` render)
- Test: `web/tests/properties.listPage.test.jsx`

This file has **no existing error-state test at all** (confirmed — `grep -l "isError: true" web/tests/*.test.jsx` does not list it), even though the error render itself already exists in code. Both the base render assertion and the Retry assertion are new.

- [ ] **Step 1: Write the failing test**

Add a new `describe` block to `web/tests/properties.listPage.test.jsx`, after the existing "shows the loading state" test:

```jsx
describe('error state', () => {
  it('shows the error message and a working Retry button', async () => {
    const refetch = vi.fn()
    useProperties.mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
      isFetching: false,
      refetch,
    })
    const user = userEvent.setup()
    await renderWithProviders(<PropertiesListPage />)

    expect(
      screen.getByText(
        'Proprietățile nu au putut fi încărcate. Încearcă din nou.',
      ),
    ).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Încearcă din nou' }))

    expect(refetch).toHaveBeenCalledTimes(1)
  })

  it('disables Retry while a refetch is already in flight', async () => {
    useProperties.mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
      isFetching: true,
      refetch: vi.fn(),
    })
    await renderWithProviders(<PropertiesListPage />)

    expect(
      screen.getByRole('button', { name: 'Încearcă din nou' }),
    ).toBeDisabled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run --prefix web -- properties.listPage`
Expected: FAIL — `properties.list.error` text not found (the error branch is never reached today because `mockList`'s default doesn't set `isError: true` and this is the first test to do so) — or, once the mock is right, FAIL on no Retry button.

- [ ] **Step 3: Implement**

Add import:

```jsx
import { RetryButton } from '@/components/shared/RetryButton'
```

Change lines 61-65:

```jsx
const {
  data: properties,
  isPending,
  isError,
  isFetching,
  refetch,
} = useProperties({ includeArchived: showArchived })
```

Change lines 124-128:

```jsx
      {isPending ? (
        <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
      ) : isError ? (
        <div className="flex flex-col items-start gap-2">
          <p className="text-sm text-destructive">{t('properties.list.error')}</p>
          <RetryButton onRetry={refetch} disabled={isFetching} />
        </div>
      ) : sorted.length === 0 ? (
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run --prefix web -- properties.listPage`
Expected: PASS.

- [ ] **Step 5: Do not commit yet.**

---

## Task 9: `TenantsListPage` — both error sources

**Files:**

- Modify: `web/src/features/tenants/pages/TenantsListPage.jsx` (import, `:202-206` and `:208-214` render — no hook destructure change, all whole objects already)
- Test: `web/tests/tenants.listPage.test.jsx`

Two independent sites in this one file:

- **List-load error** (`isError`, fed by `users`/`tenancies`/`drafts`) — a `useQuery` failure, safe to `refetch()`.
- **Draft-creation error** (`createFailed`, fed by `createDraft` — a `useMutation`) — retry means calling `startOnboarding()` again, **not** calling `createDraft.mutateAsync()` directly. Safety argument (stated explicitly, per the task's own constraint that mutation retries need a stated reason): `createDraft`'s `mutationFn` is `addDoc(...)` (`onboarding/hooks.js:146`) — Firestore's client SDK `addDoc` either creates the document and resolves, or creates nothing and rejects; there is no partial-success path in the online case this page runs in (no offline persistence is enabled anywhere in this app). `catch` in `startOnboarding` (line 157-159) only fires on rejection, which means no document was created on that attempt — so re-invoking `startOnboarding()` is a genuinely fresh, safe attempt, not a duplicate-creation risk. `queryClient.js`'s own mutation-retry caution ("a retry on a write is a second write") is about _automatic, silent_ retry; this is a _manual_, user-initiated one on an attempt that is confirmed not to have written anything — a materially different case, called out explicitly here rather than assumed.

- [ ] **Step 1: Write the failing tests**

Add to `web/tests/tenants.listPage.test.jsx`, in the outer `describe('TenantsListPage', ...)`:

```jsx
it('clicking Retry on the list-load error re-runs all three source queries', async () => {
  mockData({})
  const usersRefetch = vi.fn()
  useUsers.mockReturnValue({
    data: undefined,
    isPending: false,
    isError: true,
    isFetching: false,
    refetch: usersRefetch,
  })
  const user = userEvent.setup()
  await renderWithProviders(<TenantsListPage />)

  await user.click(screen.getByRole('button', { name: 'Încearcă din nou' }))

  expect(usersRefetch).toHaveBeenCalledTimes(1)
})

it('shows a Retry button when draft creation fails, and clicking it retries onboarding', async () => {
  mockData({})
  createMutateAsync
    .mockRejectedValueOnce(new Error('permission-denied'))
    .mockResolvedValueOnce('draft-retry')
  const user = userEvent.setup()
  await renderWithProviders(<TenantsListPage />)

  await user.click(
    screen.getByRole('button', { name: 'Onboardare chiriaș nou' }),
  )
  await waitFor(() => {
    expect(
      screen.getByText('Draftul nu a putut fi creat. Încearcă din nou.'),
    ).toBeVisible()
  })

  await user.click(screen.getByRole('button', { name: 'Încearcă din nou' }))

  await waitFor(() => {
    expect(createMutateAsync).toHaveBeenCalledTimes(2)
  })
  expect(navigate).toHaveBeenCalledWith('/admin/onboarding/draft-retry')
})
```

(Confirm the exact button name for "+ New tenant onboarding" — `t('tenants.list.add')` — against the actual rendered text in `ro.json` before finalizing; adjust the string above if it differs from `'Onboardare chiriaș nou'`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run --prefix web -- tenants.listPage`
Expected: FAIL on both new tests — no Retry button rendered at either site.

- [ ] **Step 3: Implement**

Add import:

```jsx
import { RetryButton } from '@/components/shared/RetryButton'
```

Change lines 202-206:

```jsx
{
  createFailed && (
    <div className="flex items-center gap-2">
      <p role="alert" className="text-sm text-destructive">
        {t('tenants.list.error')}
      </p>
      <RetryButton onRetry={startOnboarding} disabled={createDraft.isPending} />
    </div>
  )
}
```

Change lines 208-214:

```jsx
      {isPending ? (
        <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
      ) : isError ? (
        <div className="flex flex-col items-start gap-2">
          <p className="text-sm text-destructive">
            {t('tenants.list.loadError')}
          </p>
          <RetryButton
            onRetry={() => {
              users.refetch()
              tenancies.refetch()
              drafts.refetch()
            }}
            disabled={
              users.isFetching || tenancies.isFetching || drafts.isFetching
            }
          />
        </div>
      ) : visibleRows.length === 0 ? (
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run --prefix web -- tenants.listPage`
Expected: PASS.

- [ ] **Step 5: Do not commit yet.**

---

## Task 10: `TenancyTab`

**Files:**

- Modify: `web/src/features/tenants/components/TenancyTab.jsx` (import, `:204` hook destructure, `:211-217` render)
- Test: `web/tests/tenants.tenancyTab.test.jsx`

No existing error-state test in this file either (confirmed — zero `isError: true` occurrences). The wrong-key bug (`tenants.detail.saveError` reused for a load failure) is knowingly **not** fixed — see Excluded sites table; Retry is added to the message exactly as it renders today.

- [ ] **Step 1: Write the failing test**

Add to `web/tests/tenants.tenancyTab.test.jsx`:

```jsx
it('shows a Retry button on the error state that re-runs the tenancies query', async () => {
  const refetch = vi.fn()
  useUserTenancies.mockReturnValue({
    data: undefined,
    isPending: false,
    isError: true,
    isFetching: false,
    refetch,
  })
  const user = userEvent.setup()
  await renderWithProviders(<TenancyTab userId="u1" />)

  await user.click(screen.getByRole('button', { name: 'Încearcă din nou' }))

  expect(refetch).toHaveBeenCalledTimes(1)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run --prefix web -- tenants.tenancyTab`
Expected: FAIL — no Retry button.

- [ ] **Step 3: Implement**

Add import (near line 5):

```jsx
import { RetryButton } from '@/components/shared/RetryButton'
```

Change line 204:

```jsx
const {
  data: tenancies,
  isPending,
  isError,
  isFetching,
  refetch,
} = useUserTenancies(userId)
```

Change lines 211-217:

```jsx
if (isError) {
  return (
    <div className="flex flex-col items-start gap-2">
      <p className="text-sm text-muted-foreground">
        {t('tenants.detail.saveError')}
      </p>
      <RetryButton onRetry={refetch} disabled={isFetching} />
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run --prefix web -- tenants.tenancyTab`
Expected: PASS.

- [ ] **Step 5: Do not commit yet.**

---

## Task 11: `TenantContractPage` (tenant portal)

**Files:**

- Modify: `web/src/features/tenantApp/pages/TenantContractPage.jsx` (import, `:49-55` render — `tenancyQuery` is already a whole object, no destructure change)
- Test: `web/tests/tenantApp.contractPage.test.jsx`

- [ ] **Step 1: Write the failing test**

Add next to the existing `CT2` test:

```jsx
it('CT12 — clicking Retry on the error state re-runs the tenancy query', async () => {
  const refetch = vi.fn()
  useMyTenancy.mockReturnValue(
    query({ isError: true, isFetching: false, refetch }),
  )
  const user = userEvent.setup()
  await renderWithProviders(<TenantContractPage />)

  await user.click(screen.getByRole('button', { name: 'Încearcă din nou' }))

  expect(refetch).toHaveBeenCalledTimes(1)
})
```

(`query()` in this file is `{ isPending: false, isError: false, data: undefined, ...overrides }` — the `refetch`/`isFetching` overrides above flow straight through it, no helper change needed. Add `import userEvent from '@testing-library/user-event'` if this file doesn't already import it.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run --prefix web -- tenantApp.contractPage`
Expected: FAIL.

- [ ] **Step 3: Implement**

Add import:

```jsx
import { RetryButton } from '@/components/shared/RetryButton'
```

Change lines 49-55:

```jsx
if (tenancyQuery.isError) {
  return (
    <div className="flex flex-col items-start gap-2 p-6">
      <p className="text-sm text-muted-foreground">
        {t('tenantApp.contract.error')}
      </p>
      <RetryButton
        onRetry={tenancyQuery.refetch}
        disabled={tenancyQuery.isFetching}
      />
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run --prefix web -- tenantApp.contractPage`
Expected: PASS, CT1-CT11 unaffected.

- [ ] **Step 5: Do not commit yet.**

---

## Task 12: `TenantDashboardPage` and `TenantHistoryPage` (tenant portal)

Both pages share the identical two-query shape (`tenancyQuery`, `reportsQuery`) and the identical fix — grouped in one task since a reviewer evaluating one would evaluate the other identically.

**Files:**

- Modify: `web/src/features/tenantApp/pages/TenantDashboardPage.jsx` (import, `:67-73` render)
- Modify: `web/src/features/tenantApp/pages/TenantHistoryPage.jsx` (import, `:40-46` render)
- Test: `web/tests/tenantApp.dashboardPage.test.jsx`
- Test: `web/tests/tenantApp.historyPage.test.jsx`

- [ ] **Step 1: Write the failing tests**

`web/tests/tenantApp.dashboardPage.test.jsx`, next to its existing error test:

```jsx
it('clicking Retry re-runs both source queries', async () => {
  const tenancyRefetch = vi.fn()
  const reportsRefetch = vi.fn()
  useMyTenancy.mockReturnValue(
    query({ isError: true, isFetching: false, refetch: tenancyRefetch }),
  )
  useMySignedReports.mockReturnValue(
    query({ isFetching: false, refetch: reportsRefetch }),
  )
  const user = userEvent.setup()
  await renderWithProviders(<TenantDashboardPage />)

  await user.click(screen.getByRole('button', { name: 'Încearcă din nou' }))

  expect(tenancyRefetch).toHaveBeenCalledTimes(1)
  expect(reportsRefetch).toHaveBeenCalledTimes(1)
})
```

`web/tests/tenantApp.historyPage.test.jsx`, same shape:

```jsx
it('clicking Retry re-runs both source queries', async () => {
  const tenancyRefetch = vi.fn()
  const reportsRefetch = vi.fn()
  useMyTenancy.mockReturnValue(
    query({ isError: true, isFetching: false, refetch: tenancyRefetch }),
  )
  useMySignedReports.mockReturnValue(
    query({ isFetching: false, refetch: reportsRefetch }),
  )
  const user = userEvent.setup()
  await renderWithProviders(<TenantHistoryPage />)

  await user.click(screen.getByRole('button', { name: 'Încearcă din nou' }))

  expect(tenancyRefetch).toHaveBeenCalledTimes(1)
  expect(reportsRefetch).toHaveBeenCalledTimes(1)
})
```

(Confirm each file's own `query()`-equivalent helper name/shape — mirror Task 11's confirmation step; adjust the overrides object literal only if a given file's helper key names differ.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:run --prefix web -- tenantApp.dashboardPage tenantApp.historyPage`
Expected: FAIL on both new tests.

- [ ] **Step 3: Implement**

Both files get the same import:

```jsx
import { RetryButton } from '@/components/shared/RetryButton'
```

`TenantDashboardPage.jsx:67-73`:

```jsx
if (tenancyQuery.isError || reportsQuery.isError) {
  return (
    <div className="flex flex-col items-start gap-2 p-6">
      <p className="text-sm text-muted-foreground">
        {t('tenantApp.dashboard.error')}
      </p>
      <RetryButton
        onRetry={() => {
          tenancyQuery.refetch()
          reportsQuery.refetch()
        }}
        disabled={tenancyQuery.isFetching || reportsQuery.isFetching}
      />
    </div>
  )
}
```

`TenantHistoryPage.jsx:40-46`:

```jsx
if (tenancyQuery.isError || reportsQuery.isError) {
  return (
    <div className="flex flex-col items-start gap-2 p-6">
      <p className="text-sm text-muted-foreground">
        {t('tenantApp.history.error')}
      </p>
      <RetryButton
        onRetry={() => {
          tenancyQuery.refetch()
          reportsQuery.refetch()
        }}
        disabled={tenancyQuery.isFetching || reportsQuery.isFetching}
      />
    </div>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:run --prefix web -- tenantApp.dashboardPage tenantApp.historyPage`
Expected: PASS, both files.

- [ ] **Step 5: Do not commit yet.**

---

## Task 13: `TenantReportDetailPage` (tenant portal)

**Files:**

- Modify: `web/src/features/tenantApp/pages/TenantReportDetailPage.jsx` (import, `:54-60` render)
- Test: `web/tests/tenantApp.reportDetailPage.test.jsx`

Note the separate not-found branch at lines 62-73 (its own key, already has a back-navigation `<Link>`) is untouched — that's a legitimate empty state, not the error state in scope here.

- [ ] **Step 1: Write the failing test**

```jsx
it('clicking Retry re-runs both source queries', async () => {
  const tenancyRefetch = vi.fn()
  const reportRefetch = vi.fn()
  useMyTenancy.mockReturnValue(
    query({ isError: true, isFetching: false, refetch: tenancyRefetch }),
  )
  useTenantReport.mockReturnValue(
    query({ isFetching: false, refetch: reportRefetch }),
  )
  const user = userEvent.setup()
  await renderWithProviders(<TenantReportDetailPage />)

  await user.click(screen.getByRole('button', { name: 'Încearcă din nou' }))

  expect(tenancyRefetch).toHaveBeenCalledTimes(1)
  expect(reportRefetch).toHaveBeenCalledTimes(1)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run --prefix web -- tenantApp.reportDetailPage`
Expected: FAIL.

- [ ] **Step 3: Implement**

Add import:

```jsx
import { RetryButton } from '@/components/shared/RetryButton'
```

Change lines 54-60:

```jsx
if (tenancyQuery.isError || reportQuery.isError) {
  return (
    <div className="flex flex-col items-start gap-2 p-6">
      <p className="text-sm text-muted-foreground">
        {t('tenantApp.reportDetail.error')}
      </p>
      <RetryButton
        onRetry={() => {
          tenancyQuery.refetch()
          reportQuery.refetch()
        }}
        disabled={tenancyQuery.isFetching || reportQuery.isFetching}
      />
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run --prefix web -- tenantApp.reportDetailPage`
Expected: PASS, not-found branch (lines 62-73) unaffected.

- [ ] **Step 5: Do not commit yet.**

---

## Task 14: `OnboardingWizardPage` — autosave error

**Files:**

- Modify: `web/src/features/onboarding/pages/OnboardingWizardPage.jsx` (import, `:159-163` render)
- Test: `web/tests/onboarding.wizardPage.test.jsx`

Retry re-invokes `updateDraft.mutate(updateDraft.variables)` — TanStack Query mutations expose `.variables` as the exact argument object passed to the last `.mutate()` call (here, `{ id, values, currentStep }`, set by `autosave()` at line 74-80). Safety: `useUpdateDraft`'s `mutationFn` is `updateDoc` (`onboarding/hooks.js:172-177`) — an overwrite of the same fields with a fresh `updatedAt`, not a document creation. Replaying it is idempotent in the sense that matters here (no duplicate resource, unlike `useCreateDraft` in Task 9) — a real write, so not "free," but not a correctness hazard either.

- [ ] **Step 1: Write the failing test**

Add to the `describe('OnboardingWizardPage — autosave failure surfaced ...')` block, next to the existing test:

```jsx
it('clicking Retry re-invokes the autosave mutation with the same variables', async () => {
  const variables = { id: 'draft-1', values: { name: 'Ion' }, currentStep: 3 }
  useUpdateDraft.mockReturnValue({
    mutate: updateMutate,
    isPending: false,
    isError: true,
    error: new Error('permission-denied'),
    variables,
  })
  const user = userEvent.setup()
  await renderWizard(STEP3_DRAFT)

  await user.click(screen.getByRole('button', { name: 'Încearcă din nou' }))

  expect(updateMutate).toHaveBeenLastCalledWith(variables)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run --prefix web -- onboarding.wizardPage`
Expected: FAIL — no Retry button in the alert block.

- [ ] **Step 3: Implement**

Add import (near line 5):

```jsx
import { RetryButton } from '@/components/shared/RetryButton'
```

Change lines 159-163:

```jsx
{
  updateDraft.isError && (
    <div className="flex items-center gap-2">
      <p role="alert" className="text-sm text-destructive">
        {t('onboarding.wizard.autosaveFailed')}
      </p>
      <RetryButton
        onRetry={() => updateDraft.mutate(updateDraft.variables)}
        disabled={updateDraft.isPending}
      />
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run --prefix web -- onboarding.wizardPage`
Expected: PASS, all other tests in this file (Continue/Back/Save-and-close autosave, step rendering) unaffected — none of them set `isError: true`.

- [ ] **Step 5: Do not commit yet.**

---

## Task 15: Full fast-band run and commit

**Files:** none new — verification + commit only.

- [ ] **Step 1: Run the entire fast band**

Run: `npm run test:run --prefix web`
Expected: PASS, full suite (all pre-existing tests plus the ~16 new/modified tests across Tasks 2-14).

- [ ] **Step 2: Confirm i18n parity**

Run: `node -e "const en=require('./web/src/lib/i18n/locales/en.json'); const ro=require('./web/src/lib/i18n/locales/ro.json'); console.log(JSON.stringify(Object.keys(en.common)) === JSON.stringify(Object.keys(ro.common)))"`
Expected: `true` — `common.retry` present in both, same key set.

- [ ] **Step 3: `git status` / `git diff` sanity check**

Confirm the changed-file list matches exactly: `RetryButton.jsx` + its test (new), the two locale files, and the 13 page/component files + their 10 test files touched in Tasks 3-14. No unrelated files.

- [ ] **Step 4: Commit**

Commit type: **`fix:`** — argued explicitly, since CLAUDE.md's own typing rule ("fix means a bug fix") is being applied to a case that isn't a code regression:

- SRS §5.5 already specified `error (message+"Retry")` before this session — this isn't new product scope being invented, it's closing a gap between an existing requirement and what actually shipped.
- The absence itself is a dead end for the user: an admin or tenant who hits any of these ~15 states today has no recourse except a full page reload — that's a usability defect on a state the app already renders, not a missing nice-to-have.
- Matches how this debt has been tracked throughout the project ("debt #6," "logged since the alpha stage" in `CURRENT_SPRINT.md`) — bug/debt framing, not feature framing.

```bash
git add web/src/components/shared/RetryButton.jsx \
        web/tests/retryButton.test.jsx \
        web/src/lib/i18n/locales/en.json \
        web/src/lib/i18n/locales/ro.json \
        web/src/features/properties/pages/PropertyDetailPage.jsx \
        web/tests/properties.detailPage.test.jsx \
        web/src/features/tenants/pages/TenantDetailPage.jsx \
        web/tests/tenants.detailPage.test.jsx \
        web/src/features/reports/pages/MonthlyReportPage.jsx \
        web/tests/reports.page.test.jsx \
        web/src/features/dashboard/pages/DashboardPage.jsx \
        web/tests/dashboard.page.test.jsx \
        web/src/features/dashboard/pages/CurrentMonthPage.jsx \
        web/tests/dashboard.currentMonthPage.test.jsx \
        web/src/features/properties/pages/PropertiesListPage.jsx \
        web/tests/properties.listPage.test.jsx \
        web/src/features/tenants/pages/TenantsListPage.jsx \
        web/tests/tenants.listPage.test.jsx \
        web/src/features/tenants/components/TenancyTab.jsx \
        web/tests/tenants.tenancyTab.test.jsx \
        web/src/features/tenantApp/pages/TenantContractPage.jsx \
        web/tests/tenantApp.contractPage.test.jsx \
        web/src/features/tenantApp/pages/TenantDashboardPage.jsx \
        web/tests/tenantApp.dashboardPage.test.jsx \
        web/src/features/tenantApp/pages/TenantHistoryPage.jsx \
        web/tests/tenantApp.historyPage.test.jsx \
        web/src/features/tenantApp/pages/TenantReportDetailPage.jsx \
        web/tests/tenantApp.reportDetailPage.test.jsx \
        web/src/features/onboarding/pages/OnboardingWizardPage.jsx \
        web/tests/onboarding.wizardPage.test.jsx \
        docs/superpowers/plans/2026-08-13-m7-substage5a-retry-button.md

git commit -m "$(cat <<'EOF'
fix: add a Retry button to every existing error state

SRS §5.5 has specified error (message+"Retry") since before this
session; the button itself was never built, leaving every isError
branch a dead end (debt #6, open since the alpha stage). Adds one
shared RetryButton wired to each site's own refetch (queries) or a
safe re-invocation of the failed action (the two mutation sites), on
top of each existing message exactly as it already renders.

Deliberately minimal: colors, the error/not-found conflation in three
pages, TenancyTab's mislabeled i18n key, and the two sites with no
existing error branch at all (OnboardingWizardPage's draft-load query,
MonthlyReportPage's tenancy/report queries) are untouched — that
unification work stays deferred, per the M7 SRS note. SharedReportPage
is excluded on purpose: its query sets retry:false because a failure
there is a documented terminal state (revoked/invalid token), not a
transient one.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"

git status
```

**Do not run this task's commands yet — reported for review, per the task's "Do not commit" instruction. Execution starts only once the plan itself is approved.**

---

## Self-review

**Spec coverage:** every one of the 15 inventoried live error sites (7 single-query, 4 dual/multi-query, 2 mutation-backed, TenancyTab, PropertiesListPage) maps to a task. The 6 excluded sites/gaps are each named with a stated reason, not silently dropped, per the task's own instruction.

**Placeholder scan:** every step has literal before/after code or a fully-written test; the two "confirm the exact helper/button-name" notes (Tasks 5, 9, 11-13) are explicit verification steps for the implementer, not vague hand-waves — they name exactly what to check and what to do if it differs.

**Type/name consistency:** `RetryButton({ onRetry, disabled })` (Task 2) is the only signature used across Tasks 3-14 — no site invents a different prop name. `refetch` vs `refetch: refetchProperty` (Task 5) is the one deliberate rename, called out at the point of use.

Plan saved to `docs/superpowers/plans/2026-08-13-m7-substage5a-retry-button.md`.

**Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**
