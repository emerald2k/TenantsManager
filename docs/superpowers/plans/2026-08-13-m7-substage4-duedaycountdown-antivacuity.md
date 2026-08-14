# M7 Sub-stage 4 — dueDayCountdown DST-safe arithmetic + onPropertyUpdate anti-vacuity — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two small, independent corrections in one gate. (A) Bring `dueDayCountdown.js`'s day-count arithmetic onto the `Date.UTC` pattern CLAUDE.md §7 mandates, mirroring `functions/src/schedulerLogic.js` — not to fix a bug (none found), but because the old pattern's correctness was a numerical coincidence, not a guarantee. (B) Actually run TWO break-confirm-revert anti-vacuity cycles against `onPropertyUpdate`'s tests — one breaking the write, one breaking the guards — since the "structurally hard to make vacuous" claim was never verified, and the AuthProvider sub-stage just proved that exact kind of a-priori reasoning can be wrong.

**Architecture:** Part A touches `web/` only — a pure function, no shared code with `functions/` (they deploy independently; CLAUDE.md §7 already establishes this duplication discipline for the KYC schema and the Storage bucket). Part B produces **no source diff** — it is verification, already executed in full (twice) during this plan's preparation (each break applied to the real file, functions band run for real, results recorded, break reverted, band re-run green). What Part B contributes to the commit is the written record, not code.

**Tech Stack:** No new dependency either part.

## Global Constraints

- Part A band: `npm run test:run --prefix web` (fast band, no emulator).
- Part B band: `npm run test:emulator --prefix functions`. Per CLAUDE.md §5, this cannot run at the same time as the rules band or the E2E band (all three claim port 8080 via their own `emulators:exec`) — not a concern here since Part A never touches the emulator at all.
- Do not extract shared code between `dueDayCountdown.js` and `schedulerLogic.js` — mirror the _pattern_, not a shared import (task's own instruction, and consistent with the existing KYC-schema/Storage-bucket duplication discipline in CLAUDE.md §7).
- Do not adjust a test to force a failure that isn't real (task's own instruction, Part B).
- Do not commit without the administrator's explicit gate approval (CLAUDE.md §2). **This turn writes the plan only.** The investigation below required actually running things (per the task's explicit "RUN the cycle, do not reason about it" for Part B, and "if no such case can be constructed... say so" for Part A) — every such run happened against a real file and was fully reverted; `git status` was clean before and after. No product file is modified by this plan-writing turn.

---

## Investigation findings

**1. Count discrepancy: the task says "six original tests," the file has SEVEN.**
`git log --oneline -- functions/test/onPropertyUpdate.test.js` shows a
single commit, `7f4dc09` — so all seven `it(...)` blocks in
`functions/test/onPropertyUpdate.test.js` are "original." Ran the
anti-vacuity check (Part B, below) against all seven, not six. Flagged
here rather than silently testing six and dropping one, or silently
testing seven without noting the mismatch.

**2. Part A — exhaustive proof that no DST-distinguishing test case exists.**
Read `dueDayCountdown.js:27-53` in full: both operands
(`startOfToday`, `candidate`) are already local-**midnight**-anchored
`Date` objects (via `new Date(y, m, d)` with no time component), and a
countdown spans at most ~31 days — at most ONE DST transition can ever
fall inside that window (Europe/Bucharest's two transitions are ~6
months apart). A single DST transition shifts the raw ms difference by
at most ±3,600,000ms (1 hour = 0.0417 of a day); `Math.round` only
flips an integer result when the true fractional value is within 0.5 of
the next integer, and 0.0417 never gets close to that threshold for a
midnight-to-midnight difference (which is otherwise always an exact
integer number of days). This is CLAUDE.md §7's own stated reasoning —
verified here rather than trusted:

Wrote a throwaway comparison script (session scratchpad, not the repo)
implementing both the OLD (local-`Date` subtract + `Math.round`) and
NEW (`Date.UTC`-based) arithmetic, and ran it across every `today` in a
±45-day window around BOTH of Europe/Bucharest's 2026 DST transitions
(`2026-03-28→29` and `2026-10-24→25`, detected programmatically by
scanning `getTimezoneOffset()` day by day — not assumed from a
calendar), for every `dueDay` 1–31:

```
Total scenarios checked: 5642
Mismatches found: 0
```

**No test can be constructed that fails under the old arithmetic and
passes under the new one.** Per the task's own instruction, Part A adds
NO new test case for this — a test that passes identically either way
is exactly the vacuous-test pattern CLAUDE.md §7 (and this whole
sub-stage) exists to catch. A code comment records the finding instead
(Task 1, Step 2), so a future reader doesn't waste time re-deriving it
or wonder why a DST test is conspicuously absent.

**2a. Why make the change at all, given 0 divergences — this must be
explicit, or the diff reads as unmotivated churn in six months.** Two
reasons, neither of them "fixes a bug":

1. **Compliance.** CLAUDE.md §7 already states the project-wide rule
   ("day-count differences are computed by converting both dates
   through `Date.UTC`... never by subtracting local `Date` objects").
   The current code violates a rule this project has explicitly
   adopted; leaving it unconverted keeps CLAUDE.md's own text
   inaccurate about the code it governs.
2. **Removes a pattern that is safe only by coincidence, not by
   construction.** The 0-divergence result holds because `Math.round`'s
   0.5 threshold happens to be wider than the ≤1-hour error a single
   DST transition introduces for a ≤31-day countdown — a numerical
   coincidence of this domain's specific numbers, not a property of
   local-`Date` subtraction itself. The `Date.UTC` version needs no such
   coincidence: the subtraction is exact by construction, nothing to
   round, nothing to accidentally save it.

**Narrowing the proof honestly — this holds for Romania, 2026, not in
general.** The 5642-scenario check above is scoped to Europe/Bucharest's
DST rules as observed in 2026. SRS.md has no single sentence stating
"Romania-only," but the concrete evidence points the same way: currency
is "exclusively RON" (§2.6), `cnp` is a mandatory field documented as "a
Romanian domain term" with no exact English equivalent (§6), and every
scheduled job is hardcoded to `Europe/Bucharest` (FR-SYS-04) — this is
the actual scope boundary the proof depends on, not an assumption. If
the EU's long-discussed proposal to abolish DST ever changes the
transition rule, or the product ever ran in a different timezone, the
old version's safety — which was never structural — could break
silently; the `Date.UTC` version would not, because it never depended on
the coincidence in the first place. This reasoning is durable — it goes
into the code comment itself (Task 1, Step 1), not just this plan, so it
survives past this session.

**3. CLAUDE.md §7's existing "Day-count differences..." bullet (line 129)
goes stale once Part A lands.** It currently states
`dueDayCountdown.js` does NOT follow the `Date.UTC` pattern and frames
converting it as open M7 debt. Must be updated in the same commit —
CLAUDE.md's own "code and docs move together" discipline, applied to
itself.

**4. Part B, CYCLE 1 (breaking the WRITE) — the break, ACTUALLY APPLIED to
`functions/src/properties.js`, functions band ACTUALLY RUN, then
reverted.** This cycle alone is incomplete — it only tests whether the
write's CONTENT is correct; the five guard tests are unverified by it,
exactly as before (see finding #5 for the second cycle that actually
tests them). Chose: construct the
synced `property` map from `before.name`/`before.address` instead of
`after.name`/`after.address` (`functions/src/properties.js:111`) — the
write still happens, but with stale data. This is a more realistic
regression than disabling the write outright, and isolates exactly what
the two "positive" tests are supposed to catch: wrong CONTENT, not
"no write at all."

Applied:

```diff
-  const property = { name: after.name, address: after.address }
+  const property = { name: before.name, address: before.address } // ANTI-VACUITY BREAK
```

Ran `npm run test:emulator --prefix functions` for real. Result:

```
 ❯ test/onPropertyUpdate.test.js (7 tests | 2 failed)
     × updates the active tenancy when the property name changes
     × updates the address, WITHOUT leaving a residue of a deleted key

 Test Files  1 failed | 15 passed (16)
      Tests  2 failed | 215 passed (217)
```

Reverted (`git checkout -- functions/src/properties.js`), confirmed
`git diff` empty, re-ran the full band: `217/217`, exit 0.

**Which tests failed, which didn't, and precisely why — no test needed
adjustment, the finding is genuine:**

| Test                                                                            | Failed? | What it actually asserts                                                                                                  | Why the break did/didn't reach it                                                                                                                                |
| ------------------------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "updates the active tenancy when the property name changes"                     | **YES** | The synced `property.name` equals `after`'s NEW name                                                                      | Directly reads the broken `property` map — this is exactly what the break corrupts                                                                               |
| "updates the address, WITHOUT leaving a residue of a deleted key"               | **YES** | The synced `property.address` equals `after`'s NEW address (no stale key)                                                 | Same — directly reads the broken map                                                                                                                             |
| "does NOT write when only `services` changes (guard) — updateTime is untouched" | no      | That the change-guard (`nameChanged \|\| addressChanged`) returns BEFORE any write is attempted                           | The guard `return`s at line 61, before line 111 (the broken line) is ever reached — this input never changes `name`/`address`, so the broken line never executes |
| "is a no-op when the property has no active tenancy"                            | no      | That an empty Firestore query result (`snap.empty`) short-circuits before writing                                         | The query guard at line 102 returns before line 111 — there is no tenancy doc for the write to even target                                                       |
| "does NOT touch an ENDED tenancy on the same property"                          | no      | That the `status == 'active'` query filter excludes an ended tenancy from the write target set                            | Same as above — the ended tenancy is never in `snap.docs`, so no write (broken or not) ever targets it                                                           |
| "does NOT sync (and does not throw) when the property is missing `address`"     | no      | That the corrupted-data guard (`after.address == null`) returns before writing                                            | Guard at line 78 returns before line 111                                                                                                                         |
| "does NOT sync... missing `address` on BOTH sides, only `name` changing"        | no      | That the SAME corrupted-data guard also fires when both guards' preconditions overlap (proves guard ORDER, not the write) | Same guard, same early return                                                                                                                                    |

**Cycle 1 conclusion: only 2 of 7 tests exercise the write's correctness
at all.** The other 5 never reach line 111 (the broken line), because
each one is stopped upstream by a guard. This does not yet prove those 5
guards themselves are correctly tested — it only proves they're stopping
something BEFORE the write, without saying whether they'd stop the right
things or whether removing them would be caught. That is what cycle 2
tests.

**5. Part B, CYCLE 2 (breaking the GUARDS) — ACTUALLY APPLIED, ACTUALLY
RUN, then reverted.** Disabled all three guard mechanisms at once,
letting through everything they should block:

```diff
   const nameChanged = before.name !== after.name
   const addressChanged = !shallowEqual(before.address, after.address)
-  if (!nameChanged && !addressChanged) return
+  // ANTI-VACUITY BREAK: change-guard disabled
+  // if (!nameChanged && !addressChanged) return
@@
-  if (after.name == null || after.address == null) {
-    console.error(
-      `onPropertyUpdate: property ${event.params.propertyId} is missing ` +
-        `name or address — skipping sync to avoid writing a partial ` +
-        `denormalization. The tenancy keeps its last valid copy.`,
-    )
-    return
-  }
+  // ANTI-VACUITY BREAK: corrupted-data guard disabled
+  // if (after.name == null || after.address == null) {
+  //   console.error(...)
+  //   return
+  // }
@@
   const snap = await db
     .collection('tenancies')
     .where('propertyId', '==', propertyId)
-    .where('status', '==', 'active')
+    // ANTI-VACUITY BREAK: status filter disabled — matches ended tenancies too
+    // .where('status', '==', 'active')
     .get()
```

Ran `npm run test:emulator --prefix functions` for real. Result:

```
 ❯ test/onPropertyUpdate.test.js (7 tests | 3 failed)
     × does NOT touch an ENDED tenancy on the same property
     × does NOT sync (and does not throw) when the property is missing `address` — corrupted data
     × does NOT sync (and does not throw) when the property is missing `address` on BOTH sides, only `name` changing

 Test Files  1 failed | 15 passed (16)
      Tests  3 failed | 214 passed (217)
```

Reverted (`git checkout -- functions/src/properties.js`), confirmed
`git diff` empty, re-ran the full band: `217/217`, exit 0.

**Which of the five guard tests failed, which didn't, and precisely
why — including one genuinely surprising result:**

| Test                                                     | Failed?             | What it actually asserts                                                           | Why                                                                                                                                                                                                                                                |
| -------------------------------------------------------- | ------------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "does NOT touch an ENDED tenancy..."                     | **YES**             | The `status == 'active'` filter excludes ended tenancies from the write target     | Filter removed → the ended tenancy's `updateTime` and `name` DO change → assertion correctly fails                                                                                                                                                 |
| "does NOT sync... missing `address` — corrupted data"    | **YES**             | The corrupted-data guard prevents writing when `after.address` is null             | Guard removed → the write is attempted with `address: undefined` → Firestore's SDK throws synchronously (CLAUDE.md §7's own documented "no `undefined` values" rule) → the handler's promise REJECTS → `.resolves.toBeUndefined()` correctly fails |
| "does NOT sync... missing `address` on BOTH sides..."    | **YES**             | Same guard, proves guard ORDER on an already-corrupted doc                         | Same mechanism, same rejection                                                                                                                                                                                                                     |
| "does NOT write when only `services` changes (guard)..." | **NO — surprising** | Claims to test that the change-guard prevents a write when only `services` differs | See below — the guard was DISABLED and the test still passed                                                                                                                                                                                       |
| "is a no-op when the property has no active tenancy"     | no (expected)       | That an empty query result short-circuits before writing                           | No tenancy document exists at all in this test's setup — there is nothing for ANY guard state to write to, guard or no guard. Correctly unaffected; not a guard test in the sense the other four are                                               |

**The services-only test not failing is the real finding of cycle 2.**
With the change-guard disabled, execution reaches the write: it queries
for the active tenancy (still finds `tenancy-1` — the propertyId filter
alone is enough, and it IS active), constructs
`property = { name: after.name, address: after.address }`, and calls
`.update({ property })`. But in THIS test's specific data, `after.name`
and `after.address` are byte-identical to `before.name`/`before.address`
(only `services` differs, a field this sync never touches) — so the
write's resulting content is identical to what was already stored.
`onPropertyUpdateHandler` resolved without throwing (confirmed — the
test would otherwise fail on the `await` itself), and `updateTime` did
not change. The most likely mechanism, based on this observed behavior:
Firestore does not advance `updateTime` for an `.update()` call whose
resulting document content is unchanged — not independently verified
against Firestore's own documentation here (out of this sub-stage's
scope), but consistent with everything observed across both cycles.

**This means the test does not actually verify the change-guard.** It
verifies "an update that doesn't change name/address doesn't visibly
change `updateTime`" — true whether the guard exists (write never
attempted) or not (write attempted, but content-identical, so
`updateTime` doesn't move either way). Both cause the same observable
outcome, so the test cannot distinguish them. This is different from
finding #1's "narrower than claimed" conclusion — this one test genuinely
does not test what its own name and comment say it tests. **Recorded as
a follow-up debt, not fixed here** — the task asked for a report, not a
rewrite: strengthening it would mean asserting on something the guard
specifically controls (e.g. spying on `doc.ref.update` and asserting it
was never called), not `updateTime`.

**Part B conclusion, both cycles combined:** of the seven tests, five
test something real and are confirmed non-vacuous (2 content tests in
cycle 1, 3 guard tests in cycle 2); one (`no active tenancy`) is
correctly guard-independent, not vacuous, just testing a different
precondition (query-empty, not a guard); one (`services-only`) is
genuinely non-discriminating for the mechanism it claims to test, found
only by actually breaking that specific guard — exactly the kind of
result an a-priori "structurally hard to make vacuous" claim would have
missed, the same way the AuthProvider race test's own first draft did.

**No code change results from Part B** — the mechanisms are already
correct; both cycles were verification, not a fix. The one follow-up
(strengthening the services-only test) is noted as debt, not applied.

---

## Commit type decision: `refactor:`, not `fix:`

First instinct was `fix:` (CLAUDE.md §7 already frames the old
`dueDayCountdown.js` pattern as a "structural risk"). The DST proof
(finding #2) overturns that: there is no case, real or constructed,
where the old and new implementations disagree. Conventional Commits'
`fix:` is for correcting a bug; `refactor:` is "a code change that
neither fixes a bug nor adds a feature" — which is exactly what Part A
is, now that "no bug" is proven rather than assumed. Calling it `fix:`
after spending this much effort proving no observable defect exists
would misstate what changed. Part B contributes no code diff, so it
doesn't move the type either way — it's recorded in the same commit's
body per the task's instruction ("one gate, one commit"), not the type.

---

### Task 1 (Part A): convert `dueDayCountdown.js` to the `Date.UTC` pattern

**Files:**

- Modify: `web/src/features/properties/dueDayCountdown.js`
- Modify: `web/tests/properties.dueDayCountdown.test.js` (comment only — no new test, per finding #2)
- Modify: `CLAUDE.md:129`

**Interfaces:**

- Consumes: none new.
- Produces: `computeDaysUntilDueDay(dueDay, today)`'s public signature and
  return values are UNCHANGED (proven identical for every real input,
  finding #2) — `web/src/features/properties/pages/PropertyDetailPage.jsx`
  and `web/tests/properties.costHistory.test.js` (the two other
  consumers, found via grep) need no changes.

- [ ] **Step 1: Replace `dueDayCountdown.js`'s day-count arithmetic**

Replace (`web/src/features/properties/dueDayCountdown.js`, full file):

```js
/** The number of days in `monthIndex` (0-based, JS convention) of `year`. */
function daysInMonth(year, monthIndex) {
  return new Date(year, monthIndex + 1, 0).getDate()
}

/** Midnight of `year`/`monthIndex`/`day`, `day` CLAMPED to that month's length —
 * `dueDay`'s own valid range is 1-31 (schema.js), wider than some months, so 31
 * in February lands on Feb's last day instead of overflowing into March. */
function clampedDateFor(year, monthIndex, day) {
  const clampedDay = Math.min(day, daysInMonth(year, monthIndex))
  return new Date(year, monthIndex, clampedDay)
}

/**
 * Days remaining until the NEXT occurrence of `dueDay` (FR-PROP-11) — a pure
 * calendar calculation, independent of monthly reports. `dueDay` is the
 * tenancy's own field — a real NUMBER (Sub-stage E, type correction; previously
 * a presence-only string, coerced here via `parseInt`). `today` defaults to now,
 * overridable for tests.
 *
 * Returns `null` for anything that is not a positive integer (wrong type, zero,
 * negative) — the countdown is hidden rather than showing a wrong number. This
 * still guards against bad/stale data reaching the function; it just no longer
 * COERCES a numeric-looking string, since the source is a number everywhere now.
 * Returns `0` when today IS the due day (not a full cycle away).
 */
export function computeDaysUntilDueDay(dueDay, today = new Date()) {
  if (!Number.isInteger(dueDay) || dueDay < 1) return null

  const startOfToday = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  )

  let candidate = clampedDateFor(
    startOfToday.getFullYear(),
    startOfToday.getMonth(),
    dueDay,
  )
  if (candidate < startOfToday) {
    // `monthIndex + 1` overflowing past 11 rolls the Date into January of the
    // next year automatically — no manual year-boundary handling needed.
    candidate = clampedDateFor(
      startOfToday.getFullYear(),
      startOfToday.getMonth() + 1,
      dueDay,
    )
  }

  const MS_PER_DAY = 1000 * 60 * 60 * 24
  return Math.round((candidate - startOfToday) / MS_PER_DAY)
}
```

With:

```js
/** The number of days in `monthIndex` (0-based, JS convention) of `year`. */
function daysInMonth(year, monthIndex) {
  return new Date(year, monthIndex + 1, 0).getDate()
}

/** Midnight of `year`/`monthIndex`/`day`, `day` CLAMPED to that month's length —
 * `dueDay`'s own valid range is 1-31 (schema.js), wider than some months, so 31
 * in February lands on Feb's last day instead of overflowing into March. */
function clampedDateFor(year, monthIndex, day) {
  const clampedDay = Math.min(day, daysInMonth(year, monthIndex))
  return new Date(year, monthIndex, clampedDay)
}

/** Whole days from local-calendar date `a` to local-calendar date `b`
 * (negative if `b` is earlier). Both are converted through `Date.UTC` on
 * their own (year, month, day) components before subtracting — never a
 * raw local-`Date` subtraction — so the result is always an exact integer,
 * immune to Europe/Bucharest's DST transitions (CLAUDE.md §7). Mirrors
 * `functions/src/schedulerLogic.js`'s `daysBetween`; not shared as code —
 * `functions/` deploys without `web/`, the same reason the KYC schema is
 * duplicated rather than shared (CLAUDE.md §7).
 *
 * NOT a bug fix: exhaustively verified (5642 scenarios, both Europe/
 * Bucharest DST transitions in 2026, every `dueDay` 1-31) that the old
 * local-`Date` + `Math.round` arithmetic never actually diverged from
 * this. That safety was coincidental, not structural: `Math.round`'s 0.5
 * threshold happens to be wider than a single DST transition's <=1hr
 * error, for THIS product's specific, narrow scope — RON-only currency
 * (SRS §2.6), `cnp` as a mandatory field (a Romanian domain term, SRS
 * §6), every scheduled job hardcoded to Europe/Bucharest (FR-SYS-04).
 * Converted anyway so correctness no longer depends on that coincidence
 * holding — a DST-rule change (the EU has repeatedly discussed abolishing
 * it) or a future non-Romania timezone would not silently break this the
 * way it could have broken the old version. */
function daysBetweenLocalDates(a, b) {
  const utcA = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())
  const utcB = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate())
  return (utcB - utcA) / 86400000
}

/**
 * Days remaining until the NEXT occurrence of `dueDay` (FR-PROP-11) — a pure
 * calendar calculation, independent of monthly reports. `dueDay` is the
 * tenancy's own field — a real NUMBER (Sub-stage E, type correction; previously
 * a presence-only string, coerced here via `parseInt`). `today` defaults to now,
 * overridable for tests.
 *
 * Returns `null` for anything that is not a positive integer (wrong type, zero,
 * negative) — the countdown is hidden rather than showing a wrong number. This
 * still guards against bad/stale data reaching the function; it just no longer
 * COERCES a numeric-looking string, since the source is a number everywhere now.
 * Returns `0` when today IS the due day (not a full cycle away).
 */
export function computeDaysUntilDueDay(dueDay, today = new Date()) {
  if (!Number.isInteger(dueDay) || dueDay < 1) return null

  const startOfToday = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  )

  let candidate = clampedDateFor(
    startOfToday.getFullYear(),
    startOfToday.getMonth(),
    dueDay,
  )
  if (candidate < startOfToday) {
    // `monthIndex + 1` overflowing past 11 rolls the Date into January of the
    // next year automatically — no manual year-boundary handling needed.
    candidate = clampedDateFor(
      startOfToday.getFullYear(),
      startOfToday.getMonth() + 1,
      dueDay,
    )
  }

  return daysBetweenLocalDates(startOfToday, candidate)
}
```

Note what did NOT change: `daysInMonth`, `clampedDateFor`, the
`candidate < startOfToday` ordering comparison (comparing `Date` objects
for ORDER, not computing a numeric difference, is unaffected by DST —
only the final subtraction was ever at risk). `MS_PER_DAY` and
`Math.round` are removed — with both operands converted through
`Date.UTC` on date-only components, the division is always an exact
integer, so rounding is never needed (matches `schedulerLogic.js`'s own
`daysBetween`, which also has no `Math.round`).

- [ ] **Step 2: Add the DST-investigation comment to the test file**

Insert into `web/tests/properties.dueDayCountdown.test.js`, after the
existing header comment block (currently ending at line 21) and before
`describe(...)`:

```js
// DST investigated, not added as a test case: exhaustively compared the
// old (local-Date subtraction + Math.round) and new (Date.UTC-based)
// implementations across both Europe/Bucharest DST transitions in 2026
// (+/-45 days around each, every dueDay 1-31 — 5642 scenarios) and found
// ZERO divergence. Both operands are already local-midnight-anchored, a
// countdown spans at most ~31 days (at most one DST transition), and
// Math.round's 0.5 threshold absorbs the <=1-hour DST error every time.
// No test can be constructed that fails under the old arithmetic and
// passes under the new — adding one anyway would be the exact vacuous-
// test pattern CLAUDE.md §7 warns against. See
// docs/superpowers/plans/2026-08-13-m7-substage4-duedaycountdown-antivacuity.md.
```

No test cases added or removed — all 8 existing tests stay exactly as
they are.

- [ ] **Step 3: Update the stale CLAUDE.md §7 bullet**

Replace (`CLAUDE.md:129`):

```
- **Day-count differences are computed by converting both dates through `Date.UTC` and dividing by 86400000 — never by subtracting local `Date` objects in milliseconds.** UTC has no daylight-saving transitions, so the result is always an exact integer; a local-time millisecond diff lands on a fractional day (e.g. 2.958) across the one night a year Europe/Bucharest's clocks change. `functions/src/schedulerLogic.js` (M6) follows this rule; `web/src/features/properties/dueDayCountdown.js:27` (`computeDaysUntilDueDay`, FR-PROP-11, pre-M6) does not — it subtracts local `Date` objects and rounds with `Math.round`. Not an active bug today: `Math.round` absorbs the ~1-hour error from a single DST transition. But it is the same structural risk the M6 code was written specifically to avoid, left unaddressed because the two files don't share code — correctly so: `functions/` deploys without `web/`, the same reason the KYC schema is duplicated rather than shared (above). Each side must apply this rule independently. Converting `dueDayCountdown.js` to the same pattern is M7 debt, found at the M6 audit.
```

With:

```
- **Day-count differences are computed by converting both dates through `Date.UTC` and dividing by 86400000 — never by subtracting local `Date` objects in milliseconds.** UTC has no daylight-saving transitions, so the result is always an exact integer; a local-time millisecond diff lands on a fractional day (e.g. 2.958) across the one night a year Europe/Bucharest's clocks change. `functions/src/schedulerLogic.js` (M6) and `web/src/features/properties/dueDayCountdown.js` (`computeDaysUntilDueDay`, FR-PROP-11, converted at M7 sub-stage 4) both follow this rule, independently — `functions/` deploys without `web/`, the same reason the KYC schema is duplicated rather than shared (above), so each side implements it separately rather than sharing a helper. Not an active bug on the `dueDayCountdown.js` side even before the conversion: `Math.round` already absorbed the ~1-hour DST error for every real (today, dueDay) pair — verified exhaustively (both 2026 Europe/Bucharest transitions, ±45 days, every `dueDay` 1–31, zero divergences found) rather than assumed, so no test distinguishes the old and new implementations. That proof is scoped to Romania and 2026's DST rule — SRS.md has no single "Romania-only" sentence, but RON-only currency (§2.6), `cnp` as a mandatory Romanian-specific field (§6), and every scheduled job hardcoded to Europe/Bucharest (FR-SYS-04) are the actual boundary it depends on. Converted anyway, not to fix an observed bug but because the old version's safety was a numerical coincidence of these specific numbers, not a property of the technique — the `Date.UTC` version is correct by construction and does not depend on that coincidence continuing to hold (a DST-rule change or a future non-Romania deployment could break the old one silently). See `docs/superpowers/plans/2026-08-13-m7-substage4-duedaycountdown-antivacuity.md`.
```

- [ ] **Step 4: Run the fast band**

Run: `npm run test:run --prefix web -- tests/properties.dueDayCountdown.test.js`
Expected: 8/8 pass (identical results to before the change — proven in
finding #2, not just hoped for).

Run: `npm run test:run --prefix web`
Expected: full band green (this file has exactly two other consumers —
`PropertyDetailPage.jsx` and `properties.costHistory.test.js`, found via
grep — neither depends on the internal arithmetic technique, only the
public return value, which is unchanged).

---

### Task 2 (Part B): record the anti-vacuity verification (no code change)

**Files:** none — BOTH cycles already ran (Investigation findings #4 and
#5) and left the repo unmodified after each revert. This task's only
output is the written record already captured above, going into the
same commit as Task 1.

- [ ] **Step 1: No further action for the verification itself.** Cycle 1
      (break the write) and cycle 2 (break all three guards) are both
      complete, in "Investigation findings #4 and #5" above, each applied to
      the real file, run against the real functions band, and reverted with
      a green re-run confirmed after both. Re-running either again before
      the gate is optional, not required.

- [ ] **Step 2: Decide what to do with the one follow-up finding
      (services-only test doesn't discriminate its own guard).** Per the
      task's instruction, NOT fixed in this sub-stage — reported only
      (finding #5). Carry it forward as debt: the next session that touches
      `functions/test/onPropertyUpdate.test.js` should strengthen that one
      test (e.g. spy on `doc.ref.update`, assert it was never called) rather
      than continue relying on `updateTime` for a case where content doesn't
      change either way.

---

### Task 3: commit (once approved)

```bash
git add web/src/features/properties/dueDayCountdown.js web/tests/properties.dueDayCountdown.test.js CLAUDE.md docs/superpowers/plans/2026-08-13-m7-substage4-duedaycountdown-antivacuity.md
git commit -m "$(cat <<'EOF'
refactor: bring dueDayCountdown onto the Date.UTC day-count pattern

Mirrors functions/src/schedulerLogic.js's daysBetween (CLAUDE.md §7):
both operands go through Date.UTC before subtracting, no Math.round.
Not an observed bug - exhaustively verified across both 2026 Romania
DST transitions (5642 scenarios) that the old and new arithmetic never
diverge. Converted anyway: that safety was a numerical coincidence of
RON/Bucharest-only scope (SRS §2.6, FR-SYS-04), not a property of the
old technique - Date.UTC is correct by construction instead.

Also ran the anti-vacuity check on onPropertyUpdate's tests (7, not 6
as first described - count corrected). Two cycles: breaking the write
(stale before-data) caught the 2 content tests; breaking all 3 guards
caught 3 of the 5 remaining. The 5th (services-only) did not fail -
Firestore does not appear to advance updateTime for a content-
identical write, so that test cannot tell "guard blocked it" from
"guard didn't block it but nothing changed." Recorded as follow-up
debt, not fixed here. No production code change from Part B.
EOF
)"
```

---

## Self-review (completed while writing this plan)

**Spec coverage** — Part A: exact diff (Step 1) carrying the WHY
durably in the code comment (finding #2a), the DST proof narrowed
honestly to Romania/2026 with the concrete SRS evidence cited (finding
#2a), existing tests unchanged and re-run (Step 4). Part B: BOTH cycles
run for real — cycle 1 (break the write, finding #4) and cycle 2 (break
all three guards, finding #5) — with a precise per-test table for each,
the one non-discriminating test (services-only) reported with its
mechanism and recorded as follow-up debt rather than silently fixed or
silently ignored. The task's "six" vs the file's actual seven is
flagged (finding #1), not silently resolved either way.

**Placeholder scan** — no TBD; every diff is literal, the DST script's
real output (5642/0), cycle 1's real output (2 failed/215 passed, then
217/217), and cycle 2's real output (3 failed/214 passed, then 217/217)
are all actual captured runs, not projected numbers.

**Consistency** — `daysBetweenLocalDates` naming, the DST scenario count
(5642), the RO/2026 scope caveat, the "7, not 6" correction, and the
services-only follow-up all match verbatim between the Investigation
findings section, the Task steps, the CLAUDE.md replacement text, the
code comment, and the commit message.
