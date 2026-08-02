# M5 Sub-stage 4 — Seed script rewrite (`functions/scripts/seed.js`) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. This
> project's own gate discipline (CLAUDE.md §2) overrides the generic skill's
> per-task commit steps. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** replace `functions/scripts/seed.js`'s single-tenant, single-report
fixture with a small, deliberately-designed set of tenant scenarios that
cover every dashboard state already built (sub-stage 3) and every state
sub-stages 5–10 will need (history accordion, contract page, the ended-tenancy
banner) — without ever reproducing an auto-referenced, incoherent total like
the "5530 (base 2800 + previousMonthArrears 2730 auto-referenced)" report
this plan was explicitly asked to retire.

**Read first, not from memory:** the plan below is built entirely from
`functions/scripts/seed.js` as it exists today (662 lines, read in full
before writing this plan) — every "kept" claim below was checked against
that file, not assumed.

---

## Global constraints (given, not reopened)

- **Idempotent, fixed ids, pinned UUIDs.** Every fixture keeps the existing
  delete-then-rewrite discipline. A re-run produces byte-identical state.
  Manually-created UI data is never touched — deletion is always scoped to
  the fixed demo ids, never a collection-wide wipe.
- **Emulator-only, Admin SDK, Security Rules bypassed** — unchanged from
  today. This still touches neither `firestore.rules`/`storage.rules` nor
  their test bands.
- **Storage bucket referenced explicitly** — the rewrite keeps requiring
  `../src/sharedReport`'s `STORAGE_BUCKET` constant lazily inside the
  function that needs it (today's `reseedSignedReport` already does this,
  with the initialization-order comment explaining why it must be lazy, not
  module-top). No ambient default, per CLAUDE.md §7 — same discipline,
  extended to every new Storage-writing function, not just one.
- **No coincidental/auto-referenced totals.** Every `previousMonthArrears`/
  `previousMonthCredit` value is derived BY HAND from the actual prior
  report in the SAME tenancy's chain — never a literal borrowed from an
  unrelated fixture, never both non-zero on the same report (mirrors
  `schema.js`'s "never both at once" invariant). Full worked chain in
  "Sums" below.

## One documented tension, flagged rather than silently resolved

`seed.js`'s own header states: _"It GROWS each milestone; do not seed shapes
the code does not have yet."_ This sub-stage's brief explicitly asks for
fixtures serving sub-stages 5–10 (`/app/history`'s two-year accordion,
`/app/contract`, the FR-TAPP-06 persistent banner) — none of which have
landed yet. That is a direct, deliberate reversal of the stated principle,
not an oversight. Two of the requested scenarios ARE already consumable
today (the empty state and the ended-tenancy card both render correctly as
of sub-stage 3), but the multi-year history, the draft-exclusion-via-UI, and
the contract attachment have no consuming screen yet. **Approved: the header
comment is rewritten** as part of this sub-stage, to something like _"grows
ahead of a milestone's own sub-stages once their SRS requirements are
pinned, so later sub-stages have real data to build against — not strictly
lockstep with already-shipped code."_

---

## 1. Fixture structure — ids and relationships

### Properties (6 — 3 kept as pure admin-demo data, 3 tied to a tenant scenario)

| id                      | role                                  | status                                                                                            | services                          |
| ----------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------- | --------------------------------- |
| `seed-prop-free`        | admin demo — free, no services        | free                                                                                              | none                              |
| `seed-prop-services`    | admin demo — free, with services      | free                                                                                              | electricity, gas, water, 1 custom |
| `seed-prop-archived`    | admin demo — archived                 | free, `archived:true`                                                                             | none                              |
| `seed-prop-occupied`    | **seed-tenant**'s home                | occupied                                                                                          | electricity, gas                  |
| `seed-prop-empty` (NEW) | **seed-tenant-empty**'s home          | occupied                                                                                          | electricity, gas                  |
| `seed-prop-ended` (NEW) | **seed-tenant-ended**'s (former) home | **free** — freed on end, matching `endTenancy`'s real transaction (`functions/src/endTenancy.js`) | electricity, gas                  |

The first three are **kept exactly as they are today** (same names,
addresses, services) — they exist purely to demo admin-side property
management and have no tenant attached; nothing here touches them.

### Tenants (4 — 1 kept identity + richer history, 2 new, 1 unchanged)

| uid                                      | email            | tenancy                                        | property             | scenario                                                     |
| ---------------------------------------- | ---------------- | ---------------------------------------------- | -------------------- | ------------------------------------------------------------ |
| `seed-tenant` (kept identity)            | chirias@test.ro  | `seed-tenancy-occupied`, **active**            | `seed-prop-occupied` | Rich history: 2 years, all 4 payment badge states, 1 draft   |
| `seed-tenant-empty` (NEW)                | ioana@test.ro    | `seed-tenancy-empty`, **active**               | `seed-prop-empty`    | Zero reports at all — FR-TAPP-01 empty state                 |
| `seed-tenant-ended` (NEW)                | radu@test.ro     | `seed-tenancy-ended`, **ended**, `endedAt` set | `seed-prop-ended`    | FR-TAPP-06: ended-label + (once built) the persistent banner |
| `seed-tenant-free` (kept, **unchanged**) | cristina@test.ro | none                                           | none                 | FR-TAPP: no-tenancy state                                    |

**Approved:** `seed-tenant-free`'s id/email are kept as-is rather than
renamed to `seed-tenant-no-tenancy` (which would read more consistently
next to the three new names above) — a rename would orphan the old fixed-id
Auth account/`users` doc from any seed run before this rewrite ships, since
the new script would never again reference the old id to delete it. Zero
behavior difference either way; kept as-is to avoid that orphan risk for a
purely cosmetic gain.

`seed-tenant-empty`/`seed-tenant-ended` get the same KYC-complete `users`
shape as `tenantUser()` today (distinct name/cnp/email/guarantor — proposed:
"Ioana Dumitrescu" / cnp `2960815234567`, guarantor "Vasile Dumitrescu"; and
"Radu Constantin" / cnp `1750604234567`, guarantor "Maria Constantin" —
final wording is a detail, not a plan decision). `seed-tenant-ended`'s
`users.status` is **`'inactive-readonly'`**, matching what real `endTenancy`
sets (`functions/src/endTenancy.js:89`) — an ended tenant whose account is
still `'active'` is a state the real app can never produce, so the seed must
not produce it either (see Risks #1).

### Tenancies (3 — 1 restructured, 2 new)

| id                         | tenant            | status                           | start / end             | monthlyRent | dueDay |
| -------------------------- | ----------------- | -------------------------------- | ----------------------- | ----------- | ------ |
| `seed-tenancy-occupied`    | seed-tenant       | active                           | 2025-10-01 → 2026-12-31 | 2500        | 10     |
| `seed-tenancy-empty` (NEW) | seed-tenant-empty | active                           | 2026-07-20 → 2027-07-19 | 2200        | 20     |
| `seed-tenancy-ended` (NEW) | seed-tenant-ended | **ended**, `endedAt: 2026-02-28` | 2025-09-01 → 2026-02-28 | 1800        | 5      |

`seed-tenancy-occupied`'s `startDate` moves from today's `2026-01-01` to
`2025-10-01` — the ONE change needed to make room for 2025 history months.
`endedAt` is written as a real `Timestamp` (`Timestamp.fromDate(new
Date('2026-02-28'))`, imported from `firebase-admin/firestore`) — a string
would crash sub-stage 2's `useMyTenancy` the first time it calls
`.toMillis()` on it (see Risks #3).

### Reports — `seed-tenant` (7 docs: 6 signed + 1 draft, all on `seed-tenancy-occupied`)

Full worked chain — every `previousMonthArrears`/`previousMonthCredit` is
`Math.max(runningBalance, 0)` / `Math.max(-runningBalance, 0)`, exactly
`schema.js`'s own `buildInitialValues` formula, threaded from the PRIOR row's
own outcome (`finalTotal − amountPaid`), never a borrowed number:

| #         | month   | prevArrears                                             | prevCredit | base (rent 2500+maint 0+elec 150+gas 80) | finalTotal       | payment                                                                                                                      | amountPaid | balance after |
| --------- | ------- | ------------------------------------------------------- | ---------- | ---------------------------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------- | ---------- | ------------- |
| 1         | 2025-11 | 0                                                       | 0          | 2730                                     | **2730**         | **paid** (bank_transfer, 2025-11-10)                                                                                         | 2730       | 0             |
| 2         | 2025-12 | 0                                                       | 0          | 2730                                     | **2730**         | **partial** (cash, 2025-12-12)                                                                                               | 2000       | 730           |
| 3         | 2026-01 | 730                                                     | 0          | 2730                                     | **3460**         | **paid** (bank_transfer, 2026-01-10)                                                                                         | 3460       | 0             |
| 4         | 2026-02 | 0                                                       | 0          | 2730                                     | **2730**         | **unpaid** (marked, then cancelled)                                                                                          | `null`     | 2730          |
| 5         | 2026-05 | 2730                                                    | 0          | 2730                                     | **5460**         | **paid** (cash, 2026-05-11)                                                                                                  | 5460       | 0             |
| 6         | 2026-07 | 0                                                       | 0          | 2730                                     | **2730**         | **absent** (never touched — today's most-recent-signed slot, KEPT at the same 2730/July value the current seed already uses) | —          | 2730          |
| 7 (draft) | 2026-08 | 2730 (live, = tenancy's real `currentBalance` after #6) | 0          | 2730                                     | 5460 (live calc) | draft, unsigned                                                                                                              | —          | —             |

March/April/June are deliberately **not seeded** — arrears carry-forward is
keyed on "most recent SIGNED report," not on adjacent calendar months, so
gaps are realistic (an admin who skipped a month) and change nothing about
the chain's correctness.

**This chain deliberately hits all four required payment-badge states**
(paid ×3, partial ×1, unpaid-explicit ×1, absent ×1) using the EXACT field
combination the real app itself would write for each — not an invented
shape (see "Sums," below, and Risks #2). Report #6 keeps EXACTLY today's
numbers (July 2026, finalTotal 2730, `shareToken: SIGNED_REPORT_SHARE_TOKEN`)
— the already-documented `/r/{token}` demo link and `sharedReport.page`
manual-verification flow keep working unchanged. `tenancyId`/`propertyId`/
`userId` on all 7 docs point at `seed-tenancy-occupied` / `seed-prop-occupied`
/ `seed-tenant`'s uid — the one field that, mistyped on any single row,
would silently break `recomputeCurrentBalance`'s query with no visible error
(Risks #4).

### Reports — `seed-tenant-ended` (2 docs, both on `seed-tenancy-ended`)

| #   | month   | prevArrears | prevCredit | base (rent 1800+maint 0+elec 120+gas 60) | finalTotal | payment                          | amountPaid | balance after |
| --- | ------- | ----------- | ---------- | ---------------------------------------- | ---------- | -------------------------------- | ---------- | ------------- |
| 1   | 2025-12 | 0           | 0          | 1980                                     | **1980**   | paid (bank_transfer, 2025-12-05) | 1980       | 0             |
| 2   | 2026-01 | 0           | 0          | 1980                                     | **1980**   | paid (bank_transfer, 2026-01-05) | 1980       | 0             |

**Both fully settled — deliberately, not incidentally.** FR-CON-04 blocks
`endTenancy` while arrears are outstanding, so an ended tenancy with a
non-zero `currentBalance` is a state the real app can never produce. Seeding
one anyway would be exactly the kind of fixture that "masks a real bug" —
any code that assumes "an ended tenancy is always settled" would never be
exercised against a violating fixture, because that fixture would be a lie
about what the app can actually do (Risks #1). `tenancy.currentBalance` is
hand-set to `0` after writing these two.

### `seed-tenant-empty` — zero `monthlyReports` docs

No draft, no signed report, nothing — the starkest, least ambiguous
demonstration of FR-TAPP-01's empty state. `tenancy.currentBalance: 0`
(matches `recomputeCurrentBalance`'s own "no signed reports → 0" branch).

### Attachments

- **Cost-line invoices**: on `seed-tenant`'s report #6 (July 2026, the
  fixture the `/r/:shareToken` link already points at) — `rent-invoice.pdf`
  on `rent`, `electricity-invoice.jpg` on the `electricity` service line.
  Exactly today's 2 files, same paths, same `uploadSeedAttachment` helper —
  only the identity of "which report" changes (still id
  `seed-prop-occupied_2026-07`, unchanged).
- **Tenancy contract**: `tenancies/{tenancyId}/contract/{uuid}-contract.pdf`
  (the exact path `ContractUpload.jsx:56` writes), `attachedDocuments: [{url,
name, type}]` on the tenancy doc — matching the shape `useUpdateTenancy`
  persists. **Proposed on BOTH `seed-tenancy-occupied` AND
  `seed-tenancy-ended`** (not just the "at least one" the brief asked for):
  cheap (one more upload call) and lets `/app/contract` (whenever it lands)
  be checked against both an active AND an ended tenancy in the same seed
  run, which is exactly the FR-TAPP-06/FR-CON-07 pairing that page has to
  get right. `seed-tenant-empty` gets none (no contract signed yet — matches
  a brand-new tenancy realistically).

---

## 2. Kept vs. rewritten

**Kept, unchanged:**

- `ADMIN`, `demoProperties()` (the 3 non-tenant properties), `CUSTOM_SERVICE_ID`.
- `seed-tenant-free` / `tenantNoTenancyUser()` — the whole no-tenancy scenario, byte-for-byte.
- `seed-tenant`'s identity (`tenantUser()` — name/cnp/profile) and Auth account.
- The mechanisms: idempotent delete-then-write batches, `ensureXxx()` Auth
  pattern, `uploadSeedAttachment`/`clearSeedAttachments`, the lazy
  `STORAGE_BUCKET` require, `buildDownloadUrl`.
- Report #6's exact numbers (July 2026, 2730, the `/r/` share link).

**Rewritten completely:**

- `seed-tenancy-occupied`'s `startDate` (→ 2025-10-01) and its single
  `signedReport()` builder → the 7-row chain above, computed by a small
  running-balance fold (see Risks #5 for why NOT hardcoded per-row literals).
- Two brand-new scenarios end to end: `seed-tenant-empty` and
  `seed-tenant-ended` (users, properties, tenancies, reports, contract).
- `main()`'s orchestration — three parallel `reseedXxxScenario()` functions
  (occupied / empty / ended), mirroring today's `reseedOccupied` +
  `reseedSignedReport` split, extended by two.
- The closing console summary — now lists 4 tenant credentials, one line
  each on what scenario they demonstrate (today's summary only has 2 lines).
- The file's header doc-comment, per the flagged tension above.
- `reseedSignedReport`'s doc-comment claiming "Admin SDK writes bypass
  Firestore triggers entirely" — empirically false (Risk #8); replaced with
  an accurate explanation of why `currentBalance` is still set by hand
  (determinism, not trigger-avoidance).

---

## 3. Idempotency

Same mechanism as today, extended to the new ids — nothing new invented:

- **Firestore delete-then-write**, batched per scenario: `properties` (6
  fixed ids), `users` (4 fixed uids), `tenancies` (3 fixed ids),
  `monthlyReports` (9 fixed ids — deterministic via the SAME
  `${propertyId}_${year}-${paddedMonth}` format `buildReportId` uses,
  replicated locally exactly as today's `SIGNED_REPORT_ID` literal already
  is, not imported cross-package).
- **Storage delete-then-reupload**, per prefix, via the existing
  `clearSeedAttachments(bucket, prefix)`: `reports/seed-prop-occupied_2026-07/invoices/`,
  `tenancies/seed-tenancy-occupied/contract/`,
  `tenancies/seed-tenancy-ended/contract/`. Deleting a non-existent object
  is already a no-op (`.catch(() => {})`) — first run is safe, same as today.
- **Auth**: `ensureXxx()` — get-or-create by email, never delete/recreate
  (unchanged pattern, now 4 instances instead of 2).
- Deletion never targets anything outside these fixed lists — a manually
  created property/tenant/report (random Firestore id) is structurally
  unreachable by any delete call here, exactly as today.

---

## 4. Sums — the actual chain, computed, not asserted

The two tables in §1 above ARE this section — repeating them would just
duplicate the file. The two invariants that make them "coherent, callable by
hand, no auto-reference":

1. **Every arrears/credit value is `f(previous row)`, never a literal.**
   Recommended implementation: a local array of month "intents" (base cost,
   payment fraction) folded left-to-right with a running `balance` variable,
   producing `previousMonthArrears`/`previousMonthCredit`/`finalTotal` as
   OUTPUTS — the numbers in this plan's tables are what that fold produces,
   not hand-typed magic numbers to copy into the source. This is the direct
   fix for how the flagged "5530" report happened in the first place: a
   number got hardcoded/copied instead of derived.
2. **`finalTotal` always equals `calculatedTotal`** — the seed never
   exercises the admin's manual-override path (`isFinalTotalDirty`); that
   divergence is explicitly out of scope here, same as today.

---

## 5. Risks — especially fixtures that could mask a real bug

1. **An ended tenancy with outstanding arrears is a state the real app
   cannot produce** (FR-CON-04 blocks `endTenancy` while arrears exist).
   Seeding one anyway would let bugs in "ended ⇒ always settled" code paths
   go completely unexercised, because the fixture would be lying about what
   `endTenancy` actually allows. — Covered: `seed-tenant-ended`'s two
   reports are both paid in full; `currentBalance` ends at exactly `0`;
   `users.status` is `'inactive-readonly'`, matching the real postcondition
   exactly, not just "ended" on the tenancy alone.
2. **The four payment-badge fixtures must use the field-set the app itself
   actually writes**, or a UI bug that only appears on a shape the real app
   never produces would hide behind a green-looking seed. — Covered: `paid`/
   `partial` mirror `useMarkPayment`'s exact payload
   (`amountPaid`+`paymentMethod`+`paymentDate`+`paymentStatus`); the
   `unpaid` row mirrors `useCancelPayment`'s exact payload (the same three
   fields explicitly `null`, not just absent); `absent` mirrors a
   never-touched just-signed report (no payment keys at all) — the FOUR
   distinct shapes the real mutations produce, not four shapes I invented.
3. **`endedAt` must be a real Firestore `Timestamp`, not a string.**
   Sub-stage 2's `useMyTenancy` calls `.toMillis()` on it directly — a
   string would throw the first time an admin or tenant loads a page that
   touches this tenancy. — Covered: `Timestamp.fromDate(...)`, imported from
   `firebase-admin/firestore`, same package the file already imports
   `FieldValue` from.
4. **A mistyped `tenancyId`/`propertyId` on any one of the 9 report docs
   silently breaks `recomputeCurrentBalance`'s query** (`where('tenancyId',
'==', tenancyId)`) with no error anywhere — the report would simply never
   be found as "most recent," and `currentBalance` would silently reflect
   an older or wrong report. — Mitigated by construction (all 7 of
   `seed-tenant`'s reports and both of `seed-tenant-ended`'s are built from
   the SAME `tenancyId`/`propertyId`/`userId` triple passed once into the
   fold, never repeated per row) and called out explicitly in §6's
   post-run checklist as something to eyeball in the Emulator UI.
5. **Hand-maintaining a 7-row arrears chain as literal numbers is exactly
   how the original "5530" number happened** — a later edit to one row
   (say, May's `amountPaid`) would silently desync every row after it
   unless the whole chain is manually recomputed again. — Covered by §4's
   implementation recommendation (a running-balance fold, numbers as
   OUTPUTS) rather than literals baked into the source; this plan's tables
   are what that fold must produce, not what gets typed in by hand per row.
6. **These fixtures serve UI that doesn't exist yet** (history accordion,
   contract page, the persistent banner — sub-stages 5–10). There is no
   click-through way to confirm they "look right" beyond the Emulator UI and
   the one dashboard already built (sub-stage 3). If sub-stages 5–10 end up
   needing a shape this plan didn't anticipate (pagination, a specific edge
   case), this seed will need revising again — not a reason to skip seeding
   now, but worth flagging so a later mismatch isn't a surprise.
7. **`seed-tenant-free`'s deliberately-unrenamed id** reads inconsistently
   next to the three new `seed-tenant-{empty,ended}` names — a future reader
   might assume it's an oversight rather than a deliberate orphan-avoidance
   choice. — Mitigated by a comment at its definition site pointing at this
   plan's reasoning (§1's flagged decision).
8. **Investigated empirically — does `onReportWrite` fire on the seed
   script's Admin-SDK writes?** Checked in code and config, then confirmed
   live: wrote a probe `monthlyReports` doc (via the exact same Admin-SDK
   pattern `seed.js` uses) against this project's own already-running
   emulator suite, with an obviously-wrong sentinel `currentBalance`
   pre-set on its tenancy and untouched afterward. Within 5 seconds,
   `currentBalance` was recomputed, unprompted, to the correct
   `finalTotal − amountPaid` value — the trigger fired. `firebase.json`
   declares `functions` as one of the default emulators (port 5001, no
   `--only` exclusion anywhere), and `README.md`'s documented workflow runs
   plain `firebase emulators:start` — the FULL set — before `npm run seed`.
   This is expected, not surprising, once stated plainly: Firestore's
   trigger mechanism is source-agnostic — it fires on ANY write reaching
   the emulator's Firestore instance, regardless of which client performed
   it. The Admin SDK bypasses Security Rules (an access-control concept);
   it does NOT bypass Firestore triggers (an unrelated, server-side
   change-notification mechanism). **The existing `reseedSignedReport`
   doc-comment's claim — "Admin SDK writes bypass Firestore triggers
   entirely, so that trigger never actually fires here" — is therefore
   incorrect**, and the rewrite must not carry it forward unchanged (added
   to §2's rewritten list).

   Given the trigger DOES fire, is the manual `currentBalance` set now
   pointless, or a race hazard? **Neither** — worked through explicitly:
   - `recomputeCurrentBalance` (`functions/src/reports.js:130`) is a FULL
     RE-DERIVATION from scratch every time it runs, never an
     increment/decrement — it queries every signed report for the tenancy
     and recomputes from the true most-recent one. Any number of trigger
     invocations, firing in any order, for any subset of a tenancy's
     reports, converge on the exact SAME final value once they've all run.
     There is no interleaving that produces a WRONG answer — only a
     possibly-STALE one if not all of them have finished yet.
   - The real risk is therefore completion TIMING, not correctness: the
     seed script is a short-lived process that exits right after its OWN
     writes are acknowledged, with no way to know whether the LAST
     report's trigger invocation (a separate, asynchronous
     Functions-emulator execution) has actually finished. The probe above
     needed an explicit 5-second wait before the recomputed value became
     visible.
   - **Chosen mitigation: keep the manual `currentBalance` set, executed
     synchronously as the LAST step for each tenancy, strictly AFTER all
     of that tenancy's report writes are acknowledged.** This guarantees a
     deterministic final state that never depends on the trigger's
     unobservable completion timing. It is not "racing" the trigger in any
     harmful sense: because the formula is identical and
     `recomputeCurrentBalance` is idempotent, a straggling trigger that
     completes AFTER the manual set simply re-writes the SAME correct
     value — a benign, self-agreeing race, not a correctness bug. The
     manual set's real job is making the seed's own completion independent
     of the trigger firing at all, not avoiding a conflict with it.

---

## 6. Post-run validation (Emulator UI — what must appear)

**This validation pass also closes the browser-validation debt deferred at
sub-stage 3's commit `50672aa`** ("Browser validation partial: empty and
ended-tenancy states not verified live, pending seed rewrite"). Before this
seed existed, there was no `seed-tenant-empty`/`seed-tenant-ended` account to
log in as — the "one already-built screen" checklist below (`chirias@test.ro`
/ `ioana@test.ro` / `radu@test.ro` / `cristina@test.ro`) is that missing
verification, not a new one. Report it explicitly as closing that debt, not
just as this sub-stage's own gate.

No app screen exists yet for most of this (Risk #6), so validation is
primarily direct inspection:

**Auth tab** — 5 accounts: `admin@test.ro`, `chirias@test.ro`,
`ioana@test.ro`, `radu@test.ro`, `cristina@test.ro`.

**Firestore tab:**

| Collection       | Expected doc count                                           | Spot-check                                                                                                                                                                                                                                                       |
| ---------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `properties`     | 6                                                            | `seed-prop-ended` has `status: 'free'` (not `'occupied'`)                                                                                                                                                                                                        |
| `users`          | 4                                                            | `seed-tenant-ended`'s doc has `status: 'inactive-readonly'`                                                                                                                                                                                                      |
| `tenancies`      | 3                                                            | `seed-tenancy-ended` has `status: 'ended'` and a real `Timestamp` (not a string) on `endedAt`; `seed-tenancy-occupied.currentBalance == 2730` (report #6's outcome); `seed-tenancy-ended.currentBalance == 0`                                                    |
| `monthlyReports` | 9 (7 for seed-tenant incl. 1 draft, 2 for seed-tenant-ended) | Every doc's `tenancyId` matches its owning tenancy's id exactly (Risk #4); the `2026-02` doc has `paymentStatus: 'unpaid'` WITH `amountPaid/paymentMethod/paymentDate` all `null` (not absent); the `2026-07` doc has NO `paymentStatus` key at all (not `null`) |

**Storage tab:**

- `reports/seed-prop-occupied_2026-07/invoices/` — 2 objects.
- `tenancies/seed-tenancy-occupied/contract/` — 1 object.
- `tenancies/seed-tenancy-ended/contract/` — 1 object.

**The one already-built screen (sub-stage 3, `/app`):**

- Log in as `chirias@test.ro` → dashboard shows July 2026, finalTotal 2730,
  the "no payment recorded yet" badge (absent state) — SAME as before this
  rewrite (report #6 is byte-identical to today's single fixture).
- Log in as `ioana@test.ro` → empty-state message, nothing else.
- Log in as `radu@test.ro` → last signed report (Jan 2026) with the "Final
  month of the contract" label.
- Log in as `cristina@test.ro` → no-tenancy message (unchanged from today).

**Console output** of `npm run seed` itself — confirm it prints all 4
tenant credentials with a one-line description of what each demonstrates
(today's output only documents 2).

---

## Phases & commit proposal (for when implementation is approved — not part of this step)

One script, one cohesive rewrite — splitting it into multiple commits would
just fragment a single coherent change. **One `chore:` commit** (decided —
this is dev tooling, not shippable product code), gated on: `npm run seed`
actually run against a fresh emulator, the full post-run checklist above
executed and reported with raw output (doc counts, spot-checked field
values), and the sub-stage 3 dashboard manually re-checked for all 4
accounts. This plan document itself, if approved, would normally be its own
`docs:` commit, per the same pattern as every prior sub-stage plan.
