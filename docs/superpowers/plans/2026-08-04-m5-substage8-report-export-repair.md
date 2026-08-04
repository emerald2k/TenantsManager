# M5 sub-stage 8 — Report export: repair (admin) + extend (tenant) — FR-TAPP-04, FR-REP-07b

Status: PLAN ONLY. No code, no commit.

## 1. Goal and requirements covered

- **FR-REP-07b** — "Signed report export, available to the administrator in
  three forms: (a) PDF, (b) PNG image, (c) shareable link." M4 sub-stage 8
  declared this **delivered**. It was not: `html2canvas@1.4.1` cannot parse
  the `oklch()` color functions the whole Tailwind v4/shadcn theme uses
  (`web/src/index.css`), so both PDF and PNG generation fail on **every**
  signed report, silently (the three `catch` blocks in
  `ExportReportControls.jsx` swallow the real error). Confirmed live in the
  browser against `seed-prop-occupied_2026-07` (investigation, this
  session): "PDF-ul nu a putut fi generat." / "Imaginea nu a putut fi
  generată." on first click, both formats, no exceptions to that.
- **FR-TAPP-04** — "PDF download per monthly report (client-side, in the
  preferred language)." Never implemented. `TenantReportDetailPage.jsx`'s own
  docstring says so explicitly: _"'Download PDF' (FR-TAPP-04) is deliberately
  NOT implemented here — decided deferral to sub-stage 8, on both surfaces
  SRS actually requires it (`/app` and this page)."_
- **SRS §5.4** confirms the two surfaces: `/app` — _"full breakdown by line
  ... 'Download PDF'"_; `/app/reports/:reportId` — _"... 'Download PDF', link
  back to the history."_ `/app/history` (the accordion) has **no** PDF
  mention — summary rows only, breakdown lives on the detail page.

This sub-stage does BOTH in one pass: the repair is a precondition for the
extension (both use the same rasterization primitive) and both are already
approved to land as one sub-stage. **Zero SRS text changes** — FR-REP-07b's
wording was always correct; only the implementation was broken. FR-TAPP-04
was already pinned exactly as implemented here.

## 2. Decisions pinned (per the user's message, not re-litigated)

- `html2canvas` → **`html2canvas-pro@2.3.3`**. Approved new dependency.
- Repair (admin) and extension (tenant) ship in the SAME sub-stage.
- The three silent `catch` blocks in `ExportReportControls.jsx`
  (`handleCopyLink`, `handleDownloadPdf`, `handleDownloadPng`) each gain
  `console.error(error)`, keeping the existing i18n user-facing message
  unchanged.
- Tenant PDF: two surfaces, `/app` and `/app/reports/:reportId`. `/app/history`
  does not need it (confirmed against SRS §5.4 above — no PDF mention there).
- **Tenant PDF button i18n: NEW keys under `tenantApp.export.*`, NOT a reuse
  of `reports.export.*`.** `reports.*` is the admin's namespace. Every
  tenant-facing string across M5 has lived under `tenantApp.*`, even where
  the underlying technical notion was already shared (e.g. `ReportSummaryView`
  itself, `formatCurrency`) — the namespace follows the AUDIENCE the text is
  shown to, not whether the component rendering it happens to be shared.
  `DownloadReportPdfButton` is one shared component used on two tenant pages,
  so it gets ONE new sub-namespace, `tenantApp.export.downloadPdf` /
  `tenantApp.export.pdfError` — not duplicated per page (there is only one
  component instance to name), and not folded into `reports.export.*` (that
  stays admin-only). See §4/§9.

## 3. Reading done before writing this plan

- `web/src/features/reports/components/ExportReportControls.jsx` (full) —
  `captureSummaryCanvas` (flushSync-mount → `html2canvas(captureRef.current)`
  → unmount in `finally`), `handleDownloadPdf` (canvas → `jsPDF` →
  `addImage` → `save`), `handleDownloadPng` (canvas → `toDataURL` → synthetic
  `<a>` click), all three handlers' silent `catch {}`.
- `web/src/components/shared/ReportSummaryView.jsx` (full) — the shared,
  purely-presentational capture target; attachments are ALWAYS inert
  `{name} ({type})` badges, never `<img>`, never a link — stated in its own
  comment as deliberate (no Storage CORS configured anywhere).
- `web/src/features/tenantApp/pages/TenantDashboardPage.jsx` (full) — renders
  `ReportSummaryView` with `showHeader={false} showPaymentStatus={false}`;
  the page supplies its OWN header (property name, `h1`) and its OWN
  `PaymentStatusBadge` above it.
- `web/src/features/tenantApp/pages/TenantReportDetailPage.jsx` (full) —
  renders `ReportSummaryView` with `showCalculatedTotal` and an explicit
  `propertyName` prop (all its OTHER flags at their true defaults — header
  and payment status both shown). Separately, its OWN `collectAttachments` +
  a hand-built section of REAL `<a href={attachment.url}>` links, entirely
  OUTSIDE `ReportSummaryView` — this is new information relative to the
  admin side, see §5.
- `web/tests/reports.exportControls.test.jsx` (full) — mocks
  `'html2canvas'`/`'jspdf'` at the module boundary; existing coverage:
  copy-link success, revoke-confirm gating, PDF download composition, PNG
  download composition. **No existing test exercises the failure path of any
  of the three handlers** — confirmed by reading the whole file, this is a
  real gap, not an oversight in this plan.
- `web/tests/reports.page.test.jsx` (full) — mocks `'html2canvas'`/`'jspdf'`
  only so `MonthlyReportPage` can mount `ExportReportControls` without
  touching the real libraries; asserts wiring only (renders when signed,
  absent on draft/new).
- `SRS.md` FR-TAPP-04 (line 224), FR-REP-07b (line 195), §5.4 (lines
  368-391, quoted in full above).
- **html2canvas-pro, verified directly against its own source** (previous
  investigation turn, read-only, nothing installed): `2.3.3`, published
  2026-07-31, 39 published versions, ~1.25M weekly downloads. Fork of
  `niklasvh/html2canvas`. Signature `html2canvas(element, options, config?):
Promise<HTMLCanvasElement>` — same shape as today's call. `useCORS` /
  `allowTaint` exist verbatim (`src/core/cache-storage.ts`'s
  `ResourceOptions`, `src/dom/document-cloner.ts`'s `CloneOptions`). README:
  _"Color functions `lab()` / `lch()` / `oklab()` / `oklch()`"_.
  `CHANGELOG.md` v1.5.2 (2024-07-03): _"when used with Tailwind, the oklch
  color is sometimes downgraded to the default black [#134]"_ — direct,
  dated evidence, not an inference. Import shape (`main`/`module`/`exports`)
  is CJS+ESM, same as the original — no Vite config change needed.
  `package.json`'s dependency slot: alphabetically identical position
  (`html2canvas-pro` sorts right where `html2canvas` sits today, before
  `i18next`).

## 4. Files — new / modified

| File                                                                | Change                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `web/package.json`                                                  | Remove `"html2canvas": "^1.4.1"`. Add `"html2canvas-pro": "^2.3.3"`, same alphabetical slot.                                                                                                                                                                                                    |
| `web/src/lib/reportSummaryCapture.js`                               | **New.** Shared hook `useReportSummaryCapture(reportSummaryProps)` — see §2 of the design below.                                                                                                                                                                                                |
| `web/tests/reportSummaryCapture.test.jsx`                           | **New.** Hook tests, mocking `html2canvas-pro`/`jspdf`.                                                                                                                                                                                                                                         |
| `web/src/features/reports/components/ExportReportControls.jsx`      | Modified. Import swaps to the new hook; local `captureRef`/`captureMounted`/`captureSummaryCanvas` removed (now owned by the hook); `handleDownloadPdf` calls the hook's `downloadPdf`; all three `catch` blocks bind the error and add `console.error(error)`.                                 |
| `web/tests/reports.exportControls.test.jsx`                         | Modified. `vi.mock('html2canvas', ...)` → `vi.mock('html2canvas-pro', ...)`. New tests: PDF/PNG/copy-link failure paths log via `console.error` while still showing the existing i18n message.                                                                                                  |
| `web/tests/reports.page.test.jsx`                                   | Modified. `vi.mock('html2canvas', ...)` → `vi.mock('html2canvas-pro', ...)`. No other change — this file only checks wiring.                                                                                                                                                                    |
| `web/src/features/tenantApp/components/DownloadReportPdfButton.jsx` | **New.** Shared tenant-side button (PDF only — no PNG, no share link, those are FR-REP-07b/07c, admin-only), built on `useReportSummaryCapture`. Used by both tenant surfaces.                                                                                                                  |
| `web/tests/tenantApp.downloadReportPdfButton.test.jsx`              | **New.** Unit tests for the button, mocking `@/lib/reportSummaryCapture` at the module boundary (isolates the button's own error/pending-state logic from the capture mechanics, which have their own dedicated test file).                                                                     |
| `web/src/features/tenantApp/pages/TenantDashboardPage.jsx`          | Modified. Renders `<DownloadReportPdfButton>` in the header row.                                                                                                                                                                                                                                |
| `web/src/features/tenantApp/pages/TenantReportDetailPage.jsx`       | Modified. Renders `<DownloadReportPdfButton>` near the top. Docstring's "deliberately NOT implemented here — deferred to sub-stage 8" line is removed (no longer true).                                                                                                                         |
| `web/tests/tenantApp.dashboardPage.test.jsx`                        | Modified. Adds `vi.mock('html2canvas-pro', ...)` / `vi.mock('jspdf', ...)` (the page now mounts the real button + real hook, same precedent as `reports.page.test.jsx`). New tests: button present when a report exists, absent in every other state.                                           |
| `web/tests/tenantApp.reportDetailPage.test.jsx`                     | Modified. Same two additions as above.                                                                                                                                                                                                                                                          |
| `web/src/lib/i18n/locales/en.json` / `ro.json`                      | New keys: `tenantApp.export.downloadPdf` ("Download PDF" / "Descarcă PDF"), `tenantApp.export.pdfError` ("The PDF could not be generated. Please try again." / "Nu am putut genera PDF-ul. Încearcă din nou."). Used by `DownloadReportPdfButton` on both tenant pages — decision pinned in §2. |

Untouched, confirmed: `ReportSummaryView.jsx`, `hooks.js` (both reports/ and
tenantApp/), `reportAdapter.js`, `seed.js`, `SRS.md`, `firestore.rules`,
`storage.rules`, `MonthlyReportPage.jsx` (its
`<ExportReportControls report={existingReport} property={property} />` call
site keeps the exact same external props).

## 5. What's shared between the admin export and the tenant export — and what isn't

**Shared: the capture mechanics.** Both need "mount an off-screen
`<ReportSummaryView>`, rasterize it with `html2canvas-pro`, turn the canvas
into a downloadable PDF." That mechanical piece is identical regardless of
who's asking, so it moves into one new hook,
`web/src/lib/reportSummaryCapture.js`:

```js
export function useReportSummaryCapture(reportSummaryProps) {
  const captureRef = useRef(null)
  const [captureMounted, setCaptureMounted] = useState(false)

  async function captureCanvas() {
    flushSync(() => setCaptureMounted(true))
    try {
      return await html2canvas(captureRef.current)
    } finally {
      setCaptureMounted(false)
    }
  }

  async function downloadPdf(fileNameBase) {
    const canvas = await captureCanvas()
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'pt' })
    const pageWidth = pdf.internal.pageSize.getWidth()
    const imgHeight = (canvas.height * pageWidth) / canvas.width
    pdf.addImage(
      canvas.toDataURL('image/png'),
      'PNG',
      0,
      0,
      pageWidth,
      imgHeight,
    )
    pdf.save(`${fileNameBase}.pdf`)
  }

  const captureNode = captureMounted ? (
    <div ref={captureRef} className="absolute -left-[9999px] top-0">
      <ReportSummaryView {...reportSummaryProps} />
    </div>
  ) : null

  return { captureCanvas, downloadPdf, captureNode }
}
```

The hook itself does **not** catch anything — a rejected `captureCanvas`/
`downloadPdf` propagates to the caller. Each caller (admin's
`ExportReportControls`, the new `DownloadReportPdfButton`) owns its own
pending/error UI state and its own `console.error(error)`, per §2's
decision — the hook has no UI state of its own to keep it reusable for a
PDF-only caller (tenant) and a PDF+PNG caller (admin) alike.

- **Admin** (`ExportReportControls`) uses BOTH `downloadPdf` (for "Descarcă
  PDF") AND `captureCanvas` directly (for "Descarcă PNG" — canvas →
  `toDataURL` → synthetic `<a>` click, no `jsPDF` involved). PNG is
  FR-REP-07b, admin-only; FR-TAPP-04 only ever asks for PDF, so the tenant
  button never touches `captureCanvas` directly.
- **Tenant** (`DownloadReportPdfButton`) uses only `downloadPdf`.

**Not shared: the JSX passed into the hook (the `reportSummaryProps`), and
the button chrome around it.** Admin's `toReportSummaryData(report,
property)` and the tenant's `adaptTenantReportSummary(report)` are different
adapters, already established in different sub-stages, and stay that way —
unifying them was never on the table and isn't needed for this hook to work
(it just spreads whatever props it's given onto `ReportSummaryView`). Admin
also has copy-link/revoke UI the tenant never needs — `ExportReportControls`
keeps that, `DownloadReportPdfButton` is a separate, smaller component with
only a button + its own pending/error state, not a fork of
`ExportReportControls`.

### The capture props differ between the two tenant surfaces themselves — a deliberate asymmetry, not an inconsistency

The **live, on-page** `ReportSummaryView` and the **PDF-capture** instance of
`ReportSummaryView` do not always use the same props, and that's correct:

- **`/app`**: the live page renders `ReportSummaryView` with `showHeader=
{false} showPaymentStatus={false}` — because the page's OWN header
  (property name, month) and OWN `PaymentStatusBadge` already cover that
  content, right above it. The **PDF capture**, though, must use the
  DEFAULTS (`showHeader=true`, `showPaymentStatus=true`) — a downloaded PDF
  is a standalone document with no surrounding page chrome to supply the
  property name, month, or payment status otherwise. So the capture's props
  deliberately differ from the live component's props on this page.
- **`/app/reports/:reportId`**: the live page's `ReportSummaryView` already
  uses `showHeader=true` (default), `showPaymentStatus=true` (default),
  `showCalculatedTotal` (explicit) — nothing is suppressed for surrounding
  chrome. So here the PDF capture's props are identical to the live
  component's props.

This must be called out as a deliberate decision in both pages' code
comments during implementation — a future reader diffing the two call
sites will otherwise read the `/app` asymmetry as a bug.

## 6. What differs in the tenant's capture vs. the admin's — the attachments-with-real-links question

**`/app/reports/:reportId` has a second, separate section — built by its own
`collectAttachments` — of REAL `<a href={attachment.url}>` links, entirely
OUTSIDE `ReportSummaryView`.** Nothing equivalent exists on the admin side:
admin's capture target is (and always has been) exclusively
`<ReportSummaryView>`, nothing else, per its own doc-comment ("the admin's
exported PDF/PNG can never structurally show more than what the public link
already shows").

**Decision: this attachments-with-links section does NOT enter the
capture.** The PDF capture for `/app/reports/:reportId` is
`<ReportSummaryView {...sameLivePropsAsAbove} />` and nothing more — same
boundary as admin, same boundary as the shareable link. Three reasons:

1. **One invariant, not one per surface.** The whole feature (admin export,
   shareable link) is built on "the capture boundary is `ReportSummaryView`,
   full stop." Letting the tenant surface capture something ELSE alongside
   it would mean three different definitions of "what a report export
   contains" across three surfaces that are supposed to show the same
   thing.
2. **A rasterized link is a dead link.** `collectAttachments`'s section
   exists so the tenant can click through to the real file. Baking it into
   a flattened PNG-in-PDF turns a working link into unclickable text in an
   image — strictly worse than not including it, since the tenant already
   has the real, clickable version one section away on the very same page.
3. **Keeps the "no real anchors/images ever enter a canvas capture"
   property project-wide.** `ReportSummaryView`'s own attachments are
   ALREADY inert badges specifically because there's no Storage CORS
   configuration anywhere (documented in its own comment). Excluding the
   tenant's separate links section from the capture means that property
   still holds everywhere a capture happens, not just on the admin side.

## 7. Tests

### 7.1 `web/tests/reportSummaryCapture.test.jsx` (new)

Mocks `html2canvas-pro` and `jspdf` (module boundary), same style as
`reports.exportControls.test.jsx` today.

| Test | Asserts                                                                                                                                       | Anti-vacuity injection                                                              | Expected failure                                                      |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| HC1  | `captureCanvas()` mounts the ref (via `flushSync`) BEFORE calling `html2canvas`, then unmounts after                                          | Remove the `flushSync` wrapper (plain `setState`)                                   | HC1 fails: `html2canvas` is called with `captureRef.current === null` |
| HC2  | `downloadPdf(base)` calls `pdf.save('${base}.pdf')` — the EXACT interpolated name, not a hardcoded string                                     | Replace the interpolation with a fixed literal                                      | HC2 fails on a second `downloadPdf` call with a different `base`      |
| HC3  | A capture failure (mocked `html2canvas` rejects) propagates OUT of both `captureCanvas` and `downloadPdf` — the hook itself never swallows it | Wrap the hook's internals in a local `try/catch` that resolves instead of rejecting | HC3 fails: the awaited call resolves instead of throwing              |

**Explicit limitation, stated in this file's own top-of-file comment:**
_this suite mocks `html2canvas-pro` entirely — it proves the hook's own
plumbing (mount timing, prop composition, error propagation), and proves
NOTHING about whether `html2canvas-pro` actually parses `oklch()` correctly.
jsdom's mocked module never touches real CSS color parsing, so no automated
test in this repository can demonstrate the oklch repair. The only proof is
a real browser render — §8._

### 7.2 `web/tests/reports.exportControls.test.jsx` (modified)

`vi.mock('html2canvas', ...)` → `vi.mock('html2canvas-pro', ...)` (the mock
target must match whatever module the hook now imports — still resolves the
same way regardless of which file does the importing).

New tests, each with its own anti-vacuity injection on the SOURCE
(`ExportReportControls.jsx` and/or the new hook), because the existing
suite already proves the i18n message shows on failure — the new value
being added here is specifically that the real error reaches the console:

| Test         | Asserts                                                                                                                                        | Anti-vacuity injection                                                                      | Expected failure                                                                                                                                                          |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| EC-console-1 | PDF failure: `console.error` called with the SAME error object the capture rejected with, AND the existing `pdfError` i18n message still shows | Remove `console.error(error)` from `handleDownloadPdf`'s catch, leaving `setPdfError(true)` | EC-console-1 fails: `console.error` was never called (the pre-existing i18n-message test still passes unchanged, proving this is genuinely new coverage, not a duplicate) |
| EC-console-2 | PNG failure: same pairing for `handleDownloadPng`                                                                                              | Remove `console.error(error)` from that catch only                                          | EC-console-2 fails, EC-console-1 still passes (proves the two are independent, not one shared spy accidentally covering both)                                             |
| EC-console-3 | Copy-link failure: `console.error` called, `copyError` message still shows                                                                     | Remove `console.error(error)` from `handleCopyLink`'s catch only                            | EC-console-3 fails, the other two still pass                                                                                                                              |

### 7.3 `web/tests/reports.page.test.jsx` (modified)

Only the mock-target rename. No new tests — this file's job is wiring
(export zone renders when signed, not on draft/new), unaffected by the
library swap or the console.error additions.

### 7.4 `web/tests/tenantApp.downloadReportPdfButton.test.jsx` (new)

Mocks `@/lib/reportSummaryCapture` (`useReportSummaryCapture: vi.fn()`) —
isolates the button's OWN pending/error state from the capture mechanics
(already covered in 7.1).

| Test | Asserts                                                                                                          | Anti-vacuity injection                                    | Expected failure                                                                                                                                     |
| ---- | ---------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| DPB1 | Renders the "Descarcă PDF" button, calls `downloadPdf(fileNameBase)` on click with the EXACT `fileNameBase` prop | Hardcode a different string in the source                 | DPB1 fails on a second render with a different `fileNameBase` prop                                                                                   |
| DPB2 | Button is `disabled` while the download is pending                                                               | Remove the `disabled` binding                             | DPB2 fails                                                                                                                                           |
| DPB3 | On a rejected `downloadPdf`, `console.error(error)` is called AND the i18n `pdfError` message shows              | Remove `console.error(error)` from this component's catch | DPB3 fails: `console.error` not called (mirrors EC-console-1's reasoning — proves it's checking something a bare "message shows" assertion wouldn't) |

### 7.5 `web/tests/tenantApp.dashboardPage.test.jsx` / `tenantApp.reportDetailPage.test.jsx` (modified)

Add `vi.mock('html2canvas-pro', () => ({ default: vi.fn() }))` and
`vi.mock('jspdf', () => ({ jsPDF: vi.fn() }))` at the top of both files
(same precedent as `reports.page.test.jsx`) — both pages now mount the
REAL `DownloadReportPdfButton` + REAL `useReportSummaryCapture` hook, per
each file's existing "render the real pipeline, not a mock of it"
convention.

| Test                   | Asserts                                                      | Anti-vacuity injection                                | Expected failure                           |
| ---------------------- | ------------------------------------------------------------ | ----------------------------------------------------- | ------------------------------------------ |
| (dashboard) DASH-PDF-1 | "Descarcă PDF" button renders when a report exists           | Remove the button from `TenantDashboardPage`          | Fails: button not found                    |
| (dashboard) DASH-PDF-2 | Button is absent in loading/error/no-tenancy/empty states    | Render it unconditionally, outside the `report` guard | Fails: button found in the empty state     |
| (detail) RD-PDF-1      | "Descarcă PDF" button renders alongside the report breakdown | Remove the button                                     | Fails: button not found                    |
| (detail) RD-PDF-2      | Button is absent in loading/error/not-found states           | Render it unconditionally                             | Fails: button found in the not-found state |

## 8. Browser validation — mandatory, each artifact opened and visually inspected

Not "it downloaded" — every item below requires opening the produced file
and looking at it. `npm run seed` first; admin `admin@test.ro` / tenants
`chirias@test.ro` (occupied, 2 attachments on 7/2026), `ioana@test.ro`
(empty state, for the "absent" checks).

1. **Admin, `seed-prop-occupied?month=7&year=2026`** (the exact report that
   failed in the investigation) — click "Descarcă PDF". Open the downloaded
   PDF: confirm it is NOT blank, confirm the property name/month header,
   the cost-line table (rent/maintenance/electricity/gas with their
   amounts), the two attachment badges (`rent-invoice.pdf`,
   `electricity-invoice.jpg` as inert text, not images/links), the
   totals/footer, and record the **exact page count**. `jsPDF.addImage`
   stretches the WHOLE canvas into a single page at a fixed width, with no
   pagination logic anywhere in the code — if the rendered content is
   taller than one page's worth, confirm whether it's scaled to fit or
   clipped. This is a **pre-existing, separate risk** never visible before
   this sub-stage (the export never produced ANY output to inspect until
   now) — see §9.
2. **Same report, "Descarcă PNG"** — open the PNG file, confirm it is NOT
   blank and shows the same content as the PDF.
3. **`chirias@test.ro`, `/app`** — click "Descarcă PDF". Open it: confirm
   property name + month header IS present (the standalone-document
   asymmetry from §5), the cost-line table, footer, AND the payment-status
   row (shown here even though the LIVE page suppresses it).
4. **`chirias@test.ro`, `/app/reports/{a past reportId}`** — click "Descarcă
   PDF". Open it: confirm calculatedTotal AND finalTotal both appear (this
   page's `showCalculatedTotal`), confirm the attachments-with-real-links
   section does **NOT** appear in the PDF (per §6's decision — visually
   confirm the boundary), then separately confirm those same links are
   still live and clickable directly ON the page (unaffected by the PDF
   feature at all).
5. **`ioana@test.ro`, `/app`** (empty state — no signed report at all) —
   confirm NO "Descarcă PDF" button renders anywhere on the page.

## 9. Risks

- **Third-party fork trust.** `html2canvas-pro` is maintained by a single
  individual (`yorickshan`), not the original `niklasvh`. ~1.25M weekly
  downloads vs. the original's ~16.5M — real adoption, but a materially
  smaller, single-maintainer surface. Accepted per the user's explicit
  approval (§2) — flagged, not blocking.
- **Untested pagination behavior.** `jsPDF.addImage` receives one
  `imgHeight` computed from the canvas's own aspect ratio and is never
  checked against the page's actual height — there is no pagination
  anywhere in this code, admin or tenant. Every report captured so far has
  never actually rendered (the oklch bug preceded this concern entirely),
  so this may be a second, independent defect that only becomes visible
  once the oklch fix lands. §8, item 1 is written specifically to catch
  this — if a tall report clips or overflows, that is a NEW finding to
  report back before closing this sub-stage, not something to silently
  work around.
- **i18n namespace — resolved, not a risk.** Earlier drafts of this plan
  proposed reusing `reports.export.downloadPdf`/`pdfError` for the tenant
  button. Decided against: `reports.*` is the admin's namespace; `tenantApp.*`
  is where every tenant-facing string has lived throughout M5, regardless of
  whether the underlying component/technical notion was shared — see §2/§4.
  New `tenantApp.export.*` keys, added once, used by the one shared
  `DownloadReportPdfButton` component.
- **Automated tests cannot prove the repair.** Restated from §7.1: every
  test in this plan mocks `html2canvas-pro` — none of them touch real CSS
  color parsing. If `html2canvas-pro` regresses its oklch support in a
  future version bump, the test suite would stay green while the feature
  silently breaks again, exactly like before. The only real guard is
  browser validation (§8) at each future dependency bump — not something
  this plan can encode as an automated gate.
- **CORS on Storage images remains completely unaddressed.** `html2canvas-
pro` fixes color parsing only. If a future change ever puts a real
  `<img>` inside `ReportSummaryView`'s capture path, tainted-canvas
  failures return regardless of this fix — the invariant in §6 (no real
  images/links ever enter a capture) is what actually prevents that, not
  the library swap.
- **Reopens a milestone already marked done.** M4's own sub-stage 8 declared
  FR-REP-07b delivered; this sub-stage's own existence is proof that
  declaration was wrong (a broken feature, not a missing one). No SRS text
  changes are needed since the requirement itself was always correct — but
  worth a `CURRENT_SPRINT.md`/commit-message note that this is a **repair**
  of a previously-miscounted "done," not new scope, so the M5 audit doesn't
  read it as scope creep.

## 10. Not in scope here

- `/app/history` — confirmed against SRS §5.4, no PDF requirement there.
- The persistent "contract ended" banner (FR-TAPP-06) — sub-stage 9,
  unrelated to export.
- Any change to `firestore.rules`, `storage.rules`, `seed.js`,
  `reportAdapter.js`, or `ReportSummaryView.jsx` itself.
- Storage CORS configuration — out of scope, not requested, and (per §9)
  wouldn't be exercised by anything this sub-stage touches anyway (no real
  images ever enter a capture, before or after this change).
- Any pagination fix for tall reports, unless §8 item 1 actually finds a
  problem — if it does, that becomes a new, explicit decision point before
  closing this sub-stage, not a silent addition.
