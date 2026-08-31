# M8 plan — deep audit against the codebase

**2026-08-20.** Findings from six parallel audits of
`2026-08-19-m8-admin-overhaul-plan.md` (rev 3) against the actual repository:
`SRS.md` in full, `CLAUDE.md`, `CURRENT_SPRINT.md`, `firestore.rules`,
`storage.rules`, `firestore.indexes.json`, `functions/src/**`, `web/src/**`,
the four test bands, and both locale files.

**Verdict: the plan is not ready for stage 1.** Not because the milestone is
wrong — the shape is sound and §4's dark-export analysis is factually exact on
every checkable point. But three of its headline requirements compute wrong
numbers, five of its citations point at text that does not exist, and its
stage-1 edit set is roughly **55 SRS locations, not four**.

Every finding below carries file:line evidence. Nothing here is inference from
the shaping document — that was the failure mode being audited.

---

## SEVERITY 1 — blocking. Fix before stage 1 is written.

### 1.1 `CLAUDE.md §10` does not exist. The plan cites it twice, once as a gate.

`CLAUDE.md` has nine numbered sections, ending at §9 "Milestone audit before
merging to main" (line 146), followed by an unnumbered "Agent skills". There is
no §10. The word "migration" appears only in §7's Storage bullets.

The plan cites it at §0 (_"`CLAUDE.md` §10 ('Data migration gates') was
retitled-by-kind in rev 2"_) and again as **stage 1's acceptance gate**
(_"`CLAUDE.md` §10 retitled by kind"_). **Stage 1 cannot pass its own gate.**

It almost certainly exists only on the frozen `milestone/m9-multi-tenant`
branch, written for the multi-tenant milestone — not on baseline `d2fe582`.

### 1.2 Four more citations are fabricated or wrong. All point at §7.

| Plan says                                                                           | Reality                                                                                                                                                                 |
| ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| §7 "requires the reason on record" for spec reversals                               | Not in `CLAUDE.md` at all. The rule is `CURRENT_SPRINT.md:305` — a file `CLAUDE.md:36` explicitly declares **"NOT a source of truth"**                                  |
| §7 says "the Firestore emulator does not enforce composite indexes"                 | `grep -n "composite\|index" CLAUDE.md` → **zero hits.** The no-`orderBy` rule is `CURRENT_SPRINT.md:281`, and it gives a _different_ reason (the indexes file is empty) |
| §7 records `ownerId` as "written everywhere and read nowhere — an M7 audit finding" | `grep -n ownerId CLAUDE.md` → **zero hits.** No such finding exists anywhere. §8.3's "default applied" rests on invented text                                           |
| §4 "Recharts already named in the stack"                                            | True but the qualifier is dropped: `CLAUDE.md:57` reads **"Recharts (Phase 2 only)"**, `SRS.md:575` reads **"Recharts _(Phase 2)_"**. M8 is not Phase 2                 |

**This repo already paid for this exact defect.** `CURRENT_SPRINT.md:80-83`
records that commit `9c7b891` _"cited a 'CLAUDE.md §5.5' that does not exist;
fixed to cite `SRS.md §5.5`"_ — caught one milestone ago and written down so it
would not recur. The plan carries five instances, one load-bearing for an
approval gate and one for a "default applied" decision.

### 1.3 `FR-DASH-05` and `FR-DASH-08` double-count carried-forward arrears.

The two headline dashboard numbers are arithmetically wrong as specified, and
the codebase says so in writing.

`functions/src/reports.js:112` — _"NEVER a sum across reports"_ — because
`previousMonthArrears`/`previousMonthCredit` _"already rolled the PRIOR balance
forward into its finalTotal, so summing every signed report would double-count
that history."_ `SRS.md` §6 repeats it on `tenancies.currentBalance`: _"Sourced
from the SINGLE most recent signed report, NOT summed across all reports."_

Worked example. January `finalTotal` 1000, unpaid. February carries
`previousMonthArrears: 1000`, `finalTotal` 2000, unpaid. **Real debt: 2000.**
`FR-DASH-08` yields 1000 + 2000 = **3000**. Three unpaid months yields roughly
six times the rent.

`FR-DASH-05` has the same defect across months, and it makes `FR-DASH-09`'s
chart a debt-accumulation curve rather than a revenue series: for a non-paying
tenant the "income" line **rises every month at constant rent**.

The existing `calculateOutstandingThisMonth` escapes this only because it is
scoped to a single month's fetch. `FR-DASH-08` removes that scoping.

**Fix:** restate as _the most recent signed report per tenancy whose `dueDate`
is past_, mirroring `recomputeCurrentBalance`. For `FR-DASH-09`, net out
`previousMonthArrears`/`previousMonthCredit` per month, or relabel the series.

### 1.4 `FR-PAY-10b` selects the wrong report, silently, for exactly the tenancies the design was invented to serve.

`monthlyReports` carries `month`/`year` **and, independently, `dueDate`**
(`SRS.md:493`, `:523`). Nothing constrains `dueDate` to fall inside
`month`/`year` — `FR-REP-05` makes it a deliberate per-month override, written
straight from the browser (`hooks.js:145`, `firestore.rules:69` validates no
fields). So a January report legitimately carrying `dueDate: '2026-02-01'` is a
supported state.

`FR-PAY-10b` gates on _"the report for the due date's calendar month"_. For
`dueDay=1, N=3` on Jan 29-31, the anchor is **1 February** — so the gate looks
up **February's** report. But the admin is preparing **January's**: that is what
`MonthlyReportPage` defaults to (`MonthlyReportPage.jsx:63`) and what
`FR-REP-15` nudges them to sign — `scheduler.js:73` takes `year`/`month` from
**today**, not from the anchor.

**The two requirements select different documents for the same due date, off by
exactly one month.** Result: for every tenancy whose pre-due window crosses a
month boundary, `FR-PAY-10` finds nothing and **sends nothing, ever** — for
precisely the low-`dueDay` cases the "continuous across the boundary" anchoring
was introduced to handle. The risk table claims this case is "answered in the
SRS"; the _anchoring_ is answered, the _precondition_ is not.

**Fix:** gate on the report whose `dueDate` equals the computed anchor, or
define one canonical billing-month → due-date mapping and make `FR-REP-05`'s
override feed the reminder. The first also fixes `FR-REP-15`'s inconsistency.
Cheap: the tenancy carries `propertyId`, so it is a direct doc get on
`monthlyReports/${propertyId}_${year}-${MM}` — one read.

### 1.5 `onMailWrite` has no idempotency. Every email becomes 3–4 log rows.

The Trigger Email extension writes `delivery` back onto the same document in
stages: `PENDING` → `PROCESSING` → `SUCCESS`/`ERROR` (plus `RETRY`). An
`onDocumentWritten('mail/{mailId}')` therefore fires **3–4 times minimum per
email**, before at-least-once delivery.

The plan never uses the words _idempotent_, _dedup_, _keyed_ or _merge_. If the
trigger follows the pattern every existing sender uses — `db.collection(...).doc()`,
auto-ID — **one email produces 3–4 `notifications` documents**, identical but
for `deliveryState`. The admin's log shows every email three or four times, and
**the row reading `PENDING` becomes indistinguishable from a genuinely stuck
send** — which destroys `FR-NLOG-05`, the requirement the section exists for.

The plan's own sentence, turned on its own solution: _"It would look correct and
quietly not do the one thing it is for."_

The discipline already exists in this codebase and was not carried over —
`reports.js:127` on `onReportWrite`: _"Always a full re-derivation … naturally
idempotent under onDocumentWritten's at-least-once delivery."_

**Fix:** key the projection on the source document — `notifications/{mailId}`,
`set(..., { merge: true })`. First write establishes the metadata and `sentAt`
(never overwritten); later fires update only `deliveryState`/`deliveryError`.

### 1.6 `NFR-SEC-10`'s "append-only" is false for `notifications` — and the system's own trigger violates it on every successful send.

Stage 8's gate requires _"`deliveryState` observed transitioning `PENDING →
SUCCESS`"_. **A transition is an update.** Either `notifications` is genuinely
append-only (one document per state change → 1.5) or `onMailWrite` updates in
place (append-only is false). The plan asserts both.

There is no runtime conflict, which is worse: the SRS would state a property the
product contradicts on every send, and **no test would ever catch it** — the
Admin SDK bypasses rules either way.

**Fix:** split the requirement. `events`: admin-read, server-write, append-only.
`notifications`: admin-read, server-write, **mutable by `onMailWrite` only**.

### 1.7 "Cloud Functions write only" names a principal that does not exist — and the most likely misreading opens the audit log to the browser.

The Admin SDK **bypasses Security Rules entirely**. There is no "Functions"
principal a rule can match. An implementer taking the plan's `[ACCESS: … Cloud
Functions write only]` literally has three plausible wrong turns:

- `allow write: if request.auth == null;` — **opens both collections to the
  unauthenticated internet**
- `allow write: if request.auth.token.firebase.sign_in_provider == 'custom';` —
  opens writes to any client with a custom token
- `allow write: if isAdmin();` — **gives the browser a write path into the audit
  log**, directly negating `FR-ACT-02`

The third is the likely one, because it is the shape **every other block in
`firestore.rules` already uses** (`:20-22`, `:31-33`, `:42-44`).

**Fix:** the SRS must say verbatim: _no `allow write` clause at all; the Admin
SDK bypasses rules; the absence of a write rule IS the server-write guarantee._

Related: `FR-ACT-03`'s _"immutable … enforced in Security Rules"_ is wrong.
Rules cannot enforce immutability — the writer of every event is the one actor
rules do not apply to. It should read _immutable to the client, enforced in
Security Rules; immutability against the server is a code-review property._

### 1.8 `FR-PAY-07`'s sort silently deletes every unpaid row from the ledger.

`FR-PAY-07` sorts _"most recent first by `paymentDate`"_ while also carrying a
status badge and a status filter — so unpaid rows must appear.

**Firestore omits documents that lack the ordered field entirely.** A signed,
never-paid report has no `paymentDate` key at all — `useMarkPayment`
(`hooks.js:279`) is its only writer. So the ledger shows **only reports that
were paid**: the rows an owner opens a payments ledger to find are exactly the
rows that vanish.

Worse, `useCancelPayment` writes `paymentDate: null` (`hooks.js:311`), so
_cancelled_ payments **do** have the field and sort to one end, while
never-paid ones disappear — two visually identical states behaving differently.

**Fix:** fetch by report `year`/`month` and sort in JS, honouring the
no-`orderBy` rule the plan itself restates.

---

## SEVERITY 2 — requirement defects

### 2.1 The fifth reversal: `NFR-SEC-06` "No audit trail on reports."

Found independently by two audits. `SRS.md:269` — `| NFR-SEC-06 | No audit trail
on reports. |` — is the **direct, normative statement**, scoped precisely to
reports, which is exactly what `FR-ACT-01/02/03` create (`report.signed`,
`report.unlocked`).

The plan's reversal table lists "audit trail" as appearing in _"§2.7, one line"_.
**This is the identical failure the plan names in its own reversal #2** — _"This
is the direct statement; §2.7's is the weaker second one. Editing one and
missing the other is the zone-D failure."_ The reasoning was applied to
`NFR-UX-02`/dark-mode and not to the parallel case one subsection away.

### 2.2 A sixth: `FR-SYS-03` "No in-app notifications — email exclusively."

Same shape. The plan's clarifying note is aimed only at §2.7's list; `SRS.md`
§3.10 carries the direct statement. Not a reversal, but the note must land in
both or the contradiction is half-cured.

### 2.3 A seventh: Recharts is Phase-2-scoped in two files.

`CLAUDE.md:57` and `SRS.md:575` both scope Recharts to Phase 2. `FR-DASH-09`
puts it in M8. Both need editing — and `CLAUDE.md:66` says _"Do not introduce
technologies outside this list without asking."_ The plan asserts in-stack and
never asks. (Also unverified: current shadcn `toast` pulls `sonner`, which
would make "Recharts is the only new dependency" false.)

### 2.4 "Income" and "Rent collected" are both misnomers, and one collides with existing SRS vocabulary.

- `amountPaid` pays the **whole** report — rent + maintenance + electricity +
  gas + water + other + carried arrears. Labelling it **"Rent collected"** is
  wrong by a large factor.
- `finalTotal` is dominated by **utilities the owner collects and forwards to
  suppliers**. Labelling it "Income" overstates owner revenue — and `FR-DASH-12`
  removes the only figure that would have offset it.
- **"Income" already means something else in this SRS**: `FR-TEN-04` and §6's
  `monthlyIncome { source, amount }` — the _tenant's salary_, a KYC field.

This is §0.1's "expenses means two opposite things" trap, reappearing on the
income side, in the milestone written to avoid it. Suggested: **"Billed
(current month)"** / **"Collected (current month)"**.

### 2.5 `FR-DASH-01` and `FR-DASH-08` are the same formula. The plan commits the sin it names.

`calculations.js:16-19` computes `FR-DASH-01`'s "total to collect" as
`Σ(finalTotal − (amountPaid ?? 0))` over signed reports on occupied properties,
current month. `FR-DASH-08`'s Overdue is the **same formula** with different
scoping and **no occupancy filter**.

The plan says _"`FR-DASH-01…03` stand unchanged"_ while listing four new KPI
tiles that include neither of `FR-DASH-01`'s two numbers. So the dashboard shows
**six money figures**, three computed over the same documents with different
filters. `FR-DASH-08`'s own note compares itself to _"`FR-DASH-01`'s aggregated
arrears"_ — the wrong one of `FR-DASH-01`'s two numbers. It never compares
itself to "total to collect", which is what it actually duplicates.

The occupancy divergence is load-bearing and documented: `calculations.js:6-9`
explains why the filter is safe _for `FR-DASH-01`_. `FR-DASH-05`/`-08` have no
such filter, so after `endTenancy` a report on a now-free property counts toward
Income and Overdue but not toward "total to collect". Two tiles, same month,
different answers, by a design nobody wrote down.

### 2.6 `FR-PAY-10c`'s bound is false above N=28, and there is no cap.

The anchor always rolls to the next occurrence, so `u` never exceeds ~30 and any
`N ≥ 30` degenerates to **email the tenant every single day, forever**.
`dueDay=15, N=31` in January: **30 emails**. `NFR-VAL-01` is presence-only, so
nothing stops it, and `FR-PAY-10c` explicitly makes the field admin-editable.

Worst-case counts, executed against `schedulerLogic.js`, combining `FR-PAY-10`
and `FR-PAY-04`:

| Scenario                               | Pre-due | Arrears | Total/month  |
| -------------------------------------- | ------- | ------- | ------------ |
| Defaults `dueDay=5, N=3`               | 3       | 8       | **11**       |
| `dueDay=1, N=3`                        | 3       | 10      | **13**       |
| `dueDay=15, N=31`                      | 30      | 5       | **35**       |
| `dueDay=1, N=40`                       | 30      | 10      | **40**       |
| any of the above, scheduler runs twice | ×2      | ×2      | **up to 80** |

And on 2026-01-31 with `dueDay=1, N=3` the tenant receives, in the same 09:00
batch, **A4 ("sumă restantă, scadentă la 01.01.2026") and A8 ("payment coming
up, due 01.02.2026")**. At `dueDay=15, N=31` that collision happens five times a
month. §8.1 discusses the one-day _gap_; nothing addresses the multi-day
_overlap_.

### 2.7 The scheduler has no idempotency of any kind, anywhere.

No sent-log, no `lastReminderSentAt`, no marker on the report, no deterministic
mail-document ID. Every send is `db.collection('mail').doc()` — a fresh random
ID (`scheduler.js:97`, `:125`, `:159`; `kyc.js:173`, `:341`; `reports.js:239`).
Nothing is read back before sending.

**If the run executes twice on one date, every tenant whose predicate is true
gets two identical emails.** Live paths: a manual "Run now" from the Console; a
platform retry (`onSchedule` is configured with `{ schedule, timeZone }` only —
no `retryCount`, unexamined); a crash mid-loop, since the loop is serial and the
outer catch only covers per-tenancy failure.

The existing families are 1-shot or every-3-days, so a duplicate is annoying.
**`FR-PAY-10` is daily-repeating and tenant-facing.** The code itself records the
asymmetry (`scheduler.js:219`: _"no automatic retry for a missed daily run"_) —
under-delivery was accepted, over-delivery was never considered.

### 2.8 `paymentReminderDaysBefore` has no backfill, and the backup was never made.

`toTenancyDocument` (`kyc.js:141-156`) writes `dueDay` and
`reportReminderDaysBefore` — not this field. Every existing tenancy lacks it.
The plan declares "default 3" in the schema and specifies **no backfill and no
default-on-read rule**. Undefined vs `?? 3` is the difference between "existing
tenants get nothing" and "existing tenants silently start receiving daily
email".

`CURRENT_SPRINT.md:162`: _"A backup will be made before any migration. Decided.
**NOT done.**"_ The plan's only gesture at this is the §0 argument that no
migration is needed — attributed to the nonexistent `CLAUDE.md §10`.

### 2.9 `FR-DASH-05` income falls to zero on unlock, and the chart is not append-only.

`unlockReportCore` writes `status: 'draft'` (`reports.js:77`). While the admin
has a past month unlocked for correction, **that month's income silently falls
to zero for that property** and returns on re-sign. Combined with `FR-REP-11`'s
retroactive entry, historical bars in `FR-DASH-09` mutate. `FR-REP-12`
propagates recalculated arrears only into _future_ reports, so the chart can be
internally inconsistent in a way no recomputation fixes.

(The hypothesised "income drops when a report is paid" bug does **not** exist —
`status` is only ever `'draft' | 'signed'`; payment lives on a separate field.
`reports.js:170` states it explicitly.)

### 2.10 Occupancy: two sources of truth, a third vocabulary word, and `archived` undefined.

`properties.status` is `free | occupied`, maintained transactionally
(`kyc.js:245`, `endTenancy.js:88`). **Today's dashboard does not use it** — it
derives occupancy from `useActiveTenancies()` (`DashboardPage.jsx:50`).
`FR-DASH-04` must pick one, or the new KPI and the existing tile disagree after
any trigger failure. The plan also says **"vacant"** where the schema says
**`free`** — a third word for an existing enum. And `archived` is a separate
axis: is an archived property in "total", and does `occupied + vacant === total`
hold when an archived property retains `status: 'occupied'`?

### 2.11 `isPastDueDate` crashes the whole dashboard on one bad document.

`calculations.js:50` does `dueDate.split('-')` with no guard. A signed report
missing `dueDate` throws a `TypeError`. Scoped to one month that is survivable;
reused for a KPI over **all history** it becomes a dashboard-wide crash on one
legacy document — on a page that has no `ErrorBoundary` until stage 4.

---

## SEVERITY 3 — gates that would pass while proving nothing

### 3.1 Stage 5's gate is vacuous three ways over.

_"locale-parity check green"_. **There is no i18n-parity script** in any
`package.json`, and no `i18n*.test.js` among the 67 test files; `CLAUDE.md:159`
lists parity as a **manual zone-E item**.

Worse, if it existed it could not detect the rename: the two files are **already
at exact parity** — 378 leaf keys each, identical flattened order, zero keys
missing in either direction — and a `Tenant → Renter` _value_ edit cannot change
that.

Worse again, the fast band cannot catch it either: `renderWithProviders`
defaults to `language = 'ro'` (`renderWithProviders.jsx:71`), and only **2 of 67
test files** ever opt into `en`, neither asserting an affected string. **The
rename can be done wrong, half-done, or not at all, and all ~680 tests stay
green.**

### 3.2 Stage 8's `mail` gate has nothing to test, and relaxing it contaminates stage 9.

`grep -n mail firestore.rules` returns one hit — inside a comment about `users`.
**There is no `match /mail/{mailId}` block.** `mail` is closed solely by the
catch-all `match /{document=**} { allow read, write: if false; }` (`:74-76`).

So stage 8's _"a rule test proving `mail` is still closed"_ tests the catch-all,
and §7.2's anti-vacuity procedure — _"make the rule permissive temporarily"_ —
**has no `mail` rule to relax.** The only way to make it non-vacuous is to relax
the catch-all, which simultaneously relaxes every unimplemented collection
**including `events` and `notifications`**, contaminating stage 9's gate in the
same run.

**Fix:** add an explicit `match /mail/{mailId} { allow read, write: if false; }`
with the reason in a comment. Not redundant — it makes the load-bearing
invariant greppable and independently relaxable.

### 3.3 Stage 9's append-only test passes even with the rule fully relaxed.

To test "an admin client cannot update `events/x`" you must first _have_ an
`events/x`. With `allow create: if false`, the test cannot seed through the
rules path — it needs `testEnv.withSecurityRulesDisabled(...)`. Skip that and the
test updates a **non-existent** document, failing with `not-found` rather than
`permission-denied`. **`assertFails()` passes on both** — and so does the
temporary-relaxation check, appearing to confirm non-vacuity.

**Fix:** the gate must require asserting `permission-denied` specifically, over
a seeded document.

### 3.4 Stage 8's emulator gate is not achievable.

The gate requires observing `PENDING → SUCCESS` **against the emulator**.
`firebase.json` has **no `extensions` block** and no extensions emulator; the
functions band runs `--only auth,firestore,storage`. Nothing locally ever writes
a `delivery` field. Meeting this gate requires installing the extension into
`firebase.json` and running the Extensions emulator, or moving the check to a
real project — which turns it back into the Console round-trip `FR-NLOG-05`
exists to eliminate.

Related: `FR-NLOG-05` enumerates `PENDING | SUCCESS | ERROR`. The extension also
produces **`PROCESSING`** and **`RETRY`** — the two states an operator most wants
to distinguish from "stuck". Either widen the enum or define an explicit
collapse as a stated rule.

### 3.5 Stage 3's structural guard and stage 4 are on a collision course.

`ReportSummaryView.jsx` imports exactly `react-i18next`, `formatCurrency`,
`formatDate` — no components at all. So G3.1 is a **single-file source scan**,
much cheaper than the plan implies. (Verified: `grep -rn "dark:" web/src
--include=*.jsx` returns **zero hits** today, so it starts green as a pure
regression guard — the best-designed gate in the plan.)

But the moment stage 4 applies its **shared table component** to
`ReportSummaryView`'s hand-rolled `<table>` (lines 111-144), the subtree acquires
a `components/ui/table` child that G3.1 must traverse — **and that shared
component is by definition also used on themed admin pages where `dark:`
utilities are legitimate.** The plan does not sequence this.

### 3.6 `/r/:shareToken` has no `.force-light` mechanism, and stage 11's gate cannot catch it.

`SharedReportPage.jsx:87` renders `<ReportSummaryView data={report.data} />`
**directly into themed page chrome, with no wrapper**. §4.3 rule 3 puts
`.force-light` only on the capture wrapper (`reportSummaryCapture.jsx:56`),
which this path never touches. Rule 5 asserts the outcome — _"the report card
stays light-only"_ — and **assigns no mechanism**. Stage 11's gate only re-runs
G3.2, which exercises the _export_ path and would pass green while
`/r/:shareToken` renders the card dark on screen for an anonymous visitor.

### 3.7 Missing gates: lint, build, and the rules band at stages 7 and 10.

- **`npm run lint` and `npm run build` are named in no gate**, though
  `CLAUDE.md:31` requires _"Verify it yourself first (lint, build, behavior
  test)"_. Concretely relevant: stage 2 rewrites `index.css` token values, stage
  3 adds a `.force-light` block, stage 5 hand-edits an 18 KB JSON. A malformed
  token block or a trailing comma fails `build` while `test:run` may not notice.
- **Stage 7 needs the rules band** — `paymentReminderDaysBefore` is an admin
  _client_ write to `tenancies`, and `tenancies.rules.test.js` exists.
- **Stage 10 needs the rules band** — `FR-DASH-05/06/08` introduce new
  cross-property client read shapes over `monthlyReports`.
- The plan's §7.1 also inherits two errors from `CLAUDE.md §5`: the rules band
  covers **`storage.rules` too** (`--only firestore,storage`), and the E2E band
  seeds via `playwright.config.js` → `e2e/global-setup.js`, not via a
  `npm run seed` step. And **the E2E band contains one test** (`login.spec.js`,
  242 bytes) — stage 12's "all four bands run" passes on a smoke test.

---

## SEVERITY 4 — scope, omissions, and cost

### 4.1 The stage-1 edit set is ~55 SRS locations, not four.

The plan's gate is scoped to _the four reversals_. The real obligatory set spans
§1.3, §2.4, §2.7 (five separate edits), §2.8, §3.5, §3.6, §3.8, §3.10, §3.11,
§3.12, §4.1 (four edits), §4.2, §4.3, §4.5 (two), **§5.1, §5.2, §5.3 (six
sub-edits), §5.4, §5.5, §5.7**, §6 (six), §7.1, §7.2, §7.3, §7.4, §7.5, §8
(three) and Appendix A's preamble plus a template↔`type` mapping table.

**Two entire routes are absent from the plan**: `/admin/payments` and
`/admin/notifications` appear in §5.1's route map nowhere, and neither page has
a §5.3 specification (columns, filters, defaults, sort, pagination, empty /
loading / error).

`§5.5 Cross-cutting UI rules` needs the `ErrorBoundary` rule, the theme rule,
the **exports-are-always-light** rule, and the admin-facing date-format rule.
`§5.7` is silently invalidated twice — it claims the functions write _"the exact
`{ to, message: { subject, text } }` shape"_ (now false) and _"only the delivery
mechanism changes"_ (now false, since `FR-NLOG-05` makes the product depend on
the extension writing `delivery.state` back).

### 4.2 Nine open debts in `CURRENT_SPRINT.md` are silent, not deferred.

§6.1/§6.2 present a clean binary that reads as an exhaustive sweep. It sweeps
three bullets and stops. Silent:

- **M7 naming residue** (`collectAttachmentUrls`, `newUrls`,
  `deleteAttachmentBestEffort` — named "url", carry paths) — also in `SRS.md`
  §9's own M7 note
- **Duplicated presentation helpers** — stage 4 introduces a shared table and
  stage 5 a locale sweep; the cheapest moment to close it
- **The cost-history table has no arrears/credit column and "rows appear not to
  add up"** — in a redesign milestone that rebuilds every table
- **Bundle at 1.96 MB, code splitting explicitly deferred** — and M8 adds a
  charting library, seven shadcn components, three new pages and a token
  overhaul. Not one word about bundle size in 631 lines
- M6 #9 entity audit; M6 #3 "Assign Tenant" from the property page; the 5530
  report; the §2.7 post-MVP scope review; `onPropertyUpdate`'s specific fix
- **`ReportSummaryView`'s two-language `renderWithProviders` leak** — see 4.5

By the plan's own standard: _"'excluded from that plan' and 'someone decided
this is fine' are not the same thing."_

### 4.3 M7 may not be finished, and one of its unfinished items is the Security Rules review.

`CURRENT_SPRINT.md:255` — _"M7's remaining in-scope work: naming residue
cleanup, **Security Rules review**, deploy. None started. **This is the next
action.**"_ `SRS.md` §9's M7 row makes _"final Security Rules"_ part of M7's own
done criterion.

The plan never mentions M7 and **adds two collections' worth of new Security
Rules at stages 8-9 — on top of a rules review that was never done.** Against
`CLAUDE.md:26` ("a single milestone at a time, in order") and `:29` (check the
done criterion).

Unresolvable from the documents: the plan's baseline is a tag and `main` is said
to be frozen, implying M7 landed; the checkpoint's last state is an unmerged,
unpushed `milestone/m7-polish` with the rules and functions bands **not re-run**
and an explicit instruction to re-run them _"before the next merge to `main`"_.
**This needs answering before stage 1 and is not among the plan's open points.**

### 4.4 Read costs: two queries degrade without bound.

- **Notifications log.** Under the no-`orderBy` rule the page fetches the whole
  collection. Volume floor ≈5 emails/tenancy/month → ~1,200/year at 20 tenancies
  → **~6,000 at year 5, ~12,000 at year 10 — billed reads per page view**, on a
  page whose purpose is to be opened casually. **This is the case the plan's own
  index table already clears** (`orderBy('sentAt','desc')` needs no composite
  index) and then overrides with a blanket _"add no indexes"_. Carve the
  exception: `orderBy` + `limit` + `startAfter`.
- **Payments ledger, unfiltered.** ~240 reports/year at 20 properties; **~720
  document reads and 2-5 MB at year 3**, growing monotonically. `FR-PAY-07`
  specifies no default period and no pagination, so the default view is the
  expensive one.
- **`events` with a range filter cannot be bounded.** A range on `at` forces it
  first in the order, and the implicit direction is **ascending** — so
  `limit(50)` returns the **oldest** 50, the inverse of `FR-DASH-04`. The
  correct query is the one the standing rule forbids:
  `orderBy('at','desc'), limit(50)` — no composite index, exactly 50 reads
  forever, a literal transcription of `FR-ACT-04`.
- **`FR-DASH-08` needs a composite index and is missing from the plan's table.**
  `where('status','==','signed')` + `where('dueDate','<',today)` is equality +
  range on a different field → **`(status ASC, dueDate ASC)` required**. Exactly
  the trap §3.10's own heading names, absent from §3.10's own list.
- **One indexes.json change M8 arguably does need** — a `fieldOverrides`
  exemption for `events.summary` and `notifications.deliveryError`, neither ever
  queried, both auto-indexed. If `summary` grows past the 1,500-byte index-entry
  limit it **fails the write**, inside a best-effort emitter `FR-ACT-06` says
  must never surface.

### 4.5 Three stages walk into a documented test trap.

`CURRENT_SPRINT.md:286-296` is an entire hard-won reminder: calling
`renderWithProviders` twice in one `it()` leaves both trees mounted and the
shared i18n singleton flips the first tree too, surfacing as _"Found multiple
elements"_ — which reads like a selector bug. It ends: _"Any future test that
checks two languages (or two anything) in one `it()` block will hit this."_

**Stages 2, 3 and 11 are entirely about checking two of something in one place**
— light vs dark, themed chrome vs `.force-light` capture node. Never mentioned.

### 4.6 Things the plan asserts about the code that are wrong or overstated.

| Claim                                                                       | Reality                                                                                                                                                                                                                                                                                                                                                                                                                    |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "The palette is fully achromatic — every token `oklch(x 0 0)`"              | **Three chromatic tokens.** `--destructive` at `index.css:66` and `:101`; **`--sidebar-primary: oklch(0.488 0.243 264.376)`** at `:112` — a blue/violet already carrying a conflicting identity in dark mode                                                                                                                                                                                                               |
| "`--chart-*` already has a dark value"                                      | Literally true, practically not: `--chart-1..5` in `.dark` (`:105-109`) are **byte-identical** to `:root` (`:70-74`). Stage 2 must author **ten** values, not five                                                                                                                                                                                                                                                         |
| "`storage.rules` keeps its four existing paths"                             | **Five** `match` blocks (`:26, :37, :40, :51, :63`)                                                                                                                                                                                                                                                                                                                                                                        |
| A "new trigger" on `properties`                                             | **One already exists** — `onPropertyUpdate` (`properties.js:116`), deliberately `onDocumentUpdated`, _"deliberately NOT onDocumentWritten"_ (`:15`), so it **structurally cannot emit `property.created`**. Either reverse a documented decision or run two triggers on one collection — which §3.7.1 argues against for `monthlyReports`                                                                                  |
| "a small edit in `finalizeKyc`, `sendReportNotification`, `dailyScheduler`" | **Six write sites**, and `finalizeKyc` has **two branches** (`kyc.js:173` and `:341`), both inside `db.runTransaction`. Missing one silently drops an entire notification type. Stage 7 also adds a **seventh** site (A8) one stage _before_ `type`/`audience` exist — so it ships without them and needs retro-fitting, in a plan that explicitly ordered stage 7 first _"rather than the scheduler being touched twice"_ |
| `type`/`audience` are the only new mail fields                              | The plan's own `notifications` shape also needs **`sentAt`, `relatedId`, `ownerId`** — none derivable from a `mail` document, which today has exactly three keys: `{ to, message: { subject, text } }`                                                                                                                                                                                                                     |
| "nothing hardcodes a colour"                                                | **Unproven where it matters.** Verified clean across the 17 files I staged — but 42 of 54 modules were not staged, including every page the redesign touches (`tenantApp/*`, `tenants/*`, `properties/pages/*`, `LoginPage`, `TenantLayout`) and **all of `components/ui/`**. Re-run before stage 2 is costed                                                                                                              |
| The seven shadcn components are all new                                     | `button`, `input`, `label`, `dialog`, `accordion` already exist. The specific seven are unverified                                                                                                                                                                                                                                                                                                                         |
| §9 milestone table "renumbered M8/M9"                                       | The table ends at **M7 + stage A**; "M8", "M9" and "multi-tenant" appear **nowhere** in `SRS.md`. There is nothing to renumber — an **M8 row must be added**. As written the gate is satisfiable by doing nothing                                                                                                                                                                                                          |

### 4.7 Stage 4 is greenfield, not restyling; and stage 2 has an unaddressed theme flash.

`AdminLayout.jsx:8-13` defines **four** nav items; §2 needs six. Line 21 is a
**hardcoded `w-56` with no responsive variant, no collapse state, no toggle** —
`SRS.md:328` has required "collapsible on tablet" since M0 and it was never
built. Stage 4's gate says _"tablet collapse verified"_ as if verifying existing
behaviour.

And `web/index.html` is named nowhere in the plan. With the theme class on
`<html>` in a Vite SPA, it can only be applied after JS boots unless
`index.html` gets a blocking inline script — so **every load flashes light
before switching to dark**. Stage 2's gate cannot catch it.

### 4.8 Renaming Tenants → Renters is bigger than one locale file.

25 `en.json` values contain "tenant" — but also:

- `credentials.js:22` — `subject: 'Your tenant account has been created'`, sent
  to every EN-preference renter, **and verbatim in SRS Appendix A1**
- `assignment.js` — `` `You have a new tenancy — ${property}` ``, mirrored in
  Appendix A7
- `web/index.html:7` — `<title>TenantsManager</title>`, the browser tab title on
  every page in both languages
- **Routes `/admin/tenants` and `/admin/tenants/:id`** (`routes/index.jsx:55`,
  `:60`) — visible in the address bar. Stage 5's _"zero code identifiers
  touched"_ locks these, leaving a sidebar reading "Renters" that navigates to
  `/admin/tenants`
- **118 of 378 i18n keys contain "tenant"** — after stage 5, `tenants.list.title`
  renders "Renters". A permanent key/value divergence the plan neither names nor
  accepts

Romanian is genuinely clean: **24 values use `chiriaș`** with the correct
comma-below diacritic, zero un-diacriticked or cedilla variants, zero `locatar`
misuse. The _"`ro.json` reviewed, not changed"_ claim holds. Two wrinkles worth
fixing while open: `tenanță` is a calque of the data-model term (idiomatic
Romanian is _închiriere_, which `properties.archive.blockedOccupied` already
uses correctly) — the mirror image of the problem the rename exists to fix.

### 4.9 i18n volume: ~100 new keys per file, ~+25%, with no owner.

Estimated per stage: stage 4 12-18, stage 6 18-22, stage 8 22-28 (including
eight `type` labels), stage 10 28-35 (including eleven event-row templates),
plus theme and reminder strings. **≈90-120 keys per file, +24-32% over today's 378.** `NFR-LOC-05` makes parity a gate but assigns no owner, no check and no
per-stage locale step. Parity drift is the likeliest zone-E finding at stage 12.

### 4.10 Under-specification the implementer would have to guess.

Condensed from ~45 items:

- **"Current month" is never defined.** `FR-DASH-05` uses report-period
  semantics (`month`/`year`), `FR-DASH-06` uses calendar-date semantics
  (`paymentDate`) — **two different notions of "period" one row apart**, and
  only one is labelled. Is there a period selector on `/admin` at all?
  `DashboardPage.jsx:18-20` says _"Fixed to the current calendar month by design
  … no selector here"_
- **`FR-DASH-09`'s "rolling window" has no length.** And `month`/`year` are
  separate numbers, so "last 12 months" is not one range query. The clean fix —
  a `period: 'YYYY-MM'` field — is not in the plan
- **`events.summary`'s shape is undefined**, yet `FR-ACT-05` forbids further
  reads, so the shape _is_ the requirement
- **Event-row i18n is undecided**: is `summary` a pre-rendered sentence (written
  server-side, therefore one language, violating `NFR-LOC-01`) or structured
  data rendered through i18n keys? This determines whether `NFR-LOC-05` is even
  achievable
- **The eleven event types omit** contract extension, password reset, share-token
  revocation, report content edits, notification sends, draft deletion — while
  the justification for reversing the exclusion was that a derived feed _"would
  silently omit exactly the events worth seeing"_
- **`FR-PAY-10` does not exclude ended tenancies.** `FR-REP-15` guards its
  analogue explicitly. A terminated tenancy with an unpaid final report keeps
  generating pre-due reminders **forever**, since the anchor always finds a next
  occurrence
- **"Not fully paid" is undefined** — `paymentStatus` (which may be absent) or
  `finalTotal − (amountPaid ?? 0) > 0`? The repo's precedent is the latter
  (`reports.js:150`); overpayment makes them diverge
- **Notification backfill** — does the log start empty on deploy day? (Honestly
  yes, since `type` is unrecoverable from existing documents — but unwritten)
- **`FR-NLOG` has no filters, no window, no pagination, no sort key for
  `PENDING` rows** (which have no `sentAt`)
- **`FR-PAY-07`'s status filter spans three vocabularies** — `status`
  (`draft`/`signed`), `paymentStatus` (`unpaid`/`partial`/`paid`/**absent**), and
  the derived badge set including `overdue`, which **is not stored anywhere**
- **`amountPaid` may be absent** and the plan's formulas are written as bare
  `finalTotal − amountPaid`. `reports.js:121`: _"`finalTotal - undefined` is
  `NaN`, which would silently corrupt"_ the balance
- **`paymentDate` is an ISO string; `events.at` is a server Timestamp** — two
  date conventions on one dashboard, both in the plan's index table, neither
  noted as different types
- **`ErrorBoundary`, the shared table and the page header have no requirement ID
  at all** — so §7.3's _"at least one execution-level check per FR"_ cannot bind
  them
- **`NFR-UX-02` "replaced" is ambiguous** — delete (leaving a gap and dangling
  references) or tombstone? The SRS has no precedent for a retired ID. The same
  decision then binds `NFR-SEC-06`
- **The theme toggle has no home** — §5.3's sidebar footer, §5.4's navbar and
  §5.2's login selector are three placements, none specified. Does an anonymous
  `/r/` visitor get one?
- **`FR-PAY-08` is accurate but incomplete**: `FR-PAY-06` corrections _overwrite
  in place_ (`PaymentSection.jsx:20-22`), so the ledger can never show that a
  payment was corrected or cancelled

### 4.11 One existing rules gap worth fixing inside M8.

`firestore.rules:69` is `allow write: if isAdmin()` on `monthlyReports`, while
`SRS.md:528` states the invariant that the draft↔signed transition happens
_"EXCLUSIVELY through the signReport/unlockReport callables"_, _"never a direct
client write"_. **No rule enforces that** — it is upheld by client-side
discipline alone.

M8 turns a latent risk into an active one: stages 4-10 write new admin pages,
and any write that flips `status` outside the callables produces a signed report
with **no event**, no `signedAt`, unfrozen arrears, possibly no `shareToken` —
making `FR-ACT-01` untrue in a way the activity feed structurally cannot reveal,
because the missing row _is_ the evidence. A one-line fix is available in the
file's existing idiom:

```javascript
allow update: if isAdmin() &&
  request.resource.data.status == resource.data.status;
```

It costs the admin client nothing it is supposed to be able to do, and makes
"an event for every material action" true by construction rather than by
discipline.

---

## What I recommend

**Before stage 1:**

1. Answer §4.3 — **is M7 done?** Everything else is downstream of it.
2. Strip all five bad citations. Where the rule is real but lives in
   `CURRENT_SPRINT.md`, say so — and note `CLAUDE.md:17` forbids putting
   implementation philosophy in the SRS, which is what §3.10 and §8.3 propose.
3. Restate **`FR-DASH-05`, `-06`, `-08`, `-09`** against the arrears roll-forward
   and rename them **Billed / Collected**. Decide `FR-DASH-01`'s fate explicitly.
4. Fix **`FR-PAY-10b`**'s report lookup, add an **idempotency requirement** for
   both the scheduler and `onMailWrite`, cap `paymentReminderDaysBefore`, exclude
   ended tenancies, and specify the backfill.
5. Split **`NFR-SEC-10`**; correct **`FR-ACT-03`**'s "enforced in Security Rules";
   state the no-`allow-write` idiom verbatim.
6. Add **`NFR-SEC-06`** and **`FR-SYS-03`** to the reversal table, and Recharts as
   a stack change that `CLAUDE.md:66` requires asking about.
7. Replace the stage-1 gate with the **~55-location checklist**, committed
   alongside the SRS so it is greppable rather than remembered.

**Structural changes to the stage plan:**

- Add explicit **`/admin/payments`** and **`/admin/notifications`** route and
  page specifications — currently absent entirely.
- Sequence **stage 3's guard against stage 4's shared table**.
- Give **`/r/:shareToken`** a `.force-light` mechanism and a gate that exercises
  the _screen_ path, not just the export.
- Add **lint + build** to every stage gate; add the **rules band** to stages 7
  and 10; note that the E2E band is one smoke test.
- Fix stage 5's gate — the parity check does not exist and could not detect the
  rename. Decide the route and the 118-key divergence.
- Record the **bundle** consequence, or fold code-splitting in deliberately.

**And the question the audit does not answer:** with owner expenses deferred,
M8 is a redesign plus three read surfaces plus one email. Stages 1-5 are a
coherent, shippable milestone on their own. Stages 6-11 are a second one. The
case for carrying twelve stages on one branch, against a `main` whose last
milestone may not have merged, is the weakest part of the plan — and it is a
scoping decision, not a defect.
