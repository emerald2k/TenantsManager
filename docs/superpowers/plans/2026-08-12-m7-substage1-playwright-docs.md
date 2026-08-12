# M7 Sub-stage 1 — Record Playwright E2E in SRS.md and CLAUDE.md — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record Playwright as the fourth test band — naming the tool and the six critical flows in SRS.md, and adding the operational rules (command, self-containment, gate count) in CLAUDE.md — before any Playwright code, config, or dependency is added.

**Architecture:** Docs-only sub-stage. No code, no `npm install`, no config files, no test files. ONE task touching both files, ending in ONE commit. Two commits (SRS first, CLAUDE.md second) would leave a window where the SRS names Playwright but CLAUDE.md does not yet list it as a gate — structurally the same shape as the M6 failure recorded in CLAUDE.md §9 zone C history (line 155): the functions band existed and was documented in `functions/README.md`, but was never added to CLAUDE.md §5 as a gate, and §9 zone C still said "both bands" — 30 red tests went unnoticed for several milestones. A band undocumented in the gate definition behaves as if it doesn't exist, even transiently between two commits. This sub-stage's whole point is to not create even a momentary version of that gap.

**Tech Stack:** Markdown edits only (SRS.md, CLAUDE.md). No new tooling touched in this sub-stage.

## Global Constraints

- Docs only. No Playwright install, no `playwright.config.js`, no test files in this sub-stage.
- Commit type `docs:`. Body lines under 100 chars (commitlint `body-max-line-length`). Use `§` (not `S`) when referencing SRS/CLAUDE.md sections — there is no Windows encoding constraint forcing the ASCII substitute; both files already use `§` freely (e.g. SRS.md's own headers, CLAUDE.md §1–§9), so the commit message should match.
- `.prettierignore` already covers `SRS.md` and `CLAUDE.md` — no reformatting will happen on commit; edits must be hand-formatted consistently with surrounding table/list style.
- English only (CLAUDE.md §3 — both files are working documents, not displayed content).
- Do not commit without the administrator's explicit gate approval (CLAUDE.md §2) — the commit step in this plan is the _instruction_ for the future execution session; it is not pre-authorized to run unattended. **This session applies the file edits only and stops before the commit, per explicit instruction.**

---

## Investigation findings (read before starting)

**1. §7.1 Stack table — Tests row (SRS.md:575) NEEDS an edit.**
It currently lists only `Vitest + React Testing Library + jsdom`. This is the
stack's canonical "Tests" entry, and Playwright is now part of that stack
(SRS §9, M7 row) — leaving it out of §7.1 would create exactly the kind of
doc-vs-doc gap CLAUDE.md §9 zone D exists to catch (a decision written in one
place and missed in another). Step 3 below makes this edit.

**2. §2.7 "tooling consciously avoided" (SRS.md:91) needs NO edit.**
Checked verbatim: the avoided list is TypeScript, Storybook, automatic CI/CD,
Docker, and Sentry — a language choice, a component-isolation tool, a deploy
automation tool, and a production-monitoring tool. None of these are testing
tools, and Vitest + React Testing Library (already in the stack since M1)
were never weighed against this list either — the list has never covered
test tooling at all. Playwright doesn't contradict any item on it, and SRS §9
already specified "end-to-end tests on the critical flows" as M7 scope before
this sub-stage — Playwright is naming an already-planned tool, not adding new
scope. No step in this plan touches §2.7. (Recorded here so the check the
task description asked for is answered, not silently skipped.)

**3. Every "band count" location, found by grep (not by re-reading the
sections I expected them in), across CLAUDE.md, SRS.md, and
CURRENT_SPRINT.md:**

| File:line              | Current text                                                  | In scope?                                                                                                                                                                                                                   |
| ---------------------- | ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CLAUDE.md:81`         | "**All three bands are gates.**"                              | Yes — Step 5                                                                                                                                                                                                                |
| `CLAUDE.md:154`        | "all three bands green" (§9 zone C)                           | Yes — Step 6                                                                                                                                                                                                                |
| `CLAUDE.md:155`        | "The functions band was missing from §5 until M6."            | No — historical record of a past incident, not a live count. Left untouched.                                                                                                                                                |
| `CURRENT_SPRINT.md:34` | "CLAUDE.md §9 zone C, now correctly stating all three bands." | No — `CURRENT_SPRINT.md` is a gitignored, non-source-of-truth checkpoint (CLAUDE.md §2); it is regenerated at the next gate, not hand-edited mid-stream. It will pick up "four bands" naturally next time it's regenerated. |

Two locations in CLAUDE.md, zero in SRS.md (SRS.md has no band-count
language — bands are a CLAUDE.md/process concept, per CLAUDE.md §1's
product/process split).

**4. Existing M7-note style in SRS.md §9** (lines 679–693) uses a
`**M7 note — <topic>:**` paragraph directly below the milestone table for
detail that doesn't fit in a table cell (see the bundle-optimization note and
the testing-strategy note already there). The six-flow list follows that same
pattern rather than being crammed into the M7 table cell.

**5. Command name and self-containment (corrected after initial review).**
The band's command is `npm run test:e2e`, run from the **repo root**, not
`web/`. Reason: E2E is not a `web/`-only concern — flow 2 exercises
`finalizeKyc` and flow 5 exercises `getSharedReport`, both in `functions/`;
the band drives emulators, Auth, Firestore, and Storage. It belongs at the
root alongside `firebase.json` and `firestore.rules`; `playwright.config.js`
goes at the root too. The root `package.json` already hosts monorepo-wide
scripts (`dev:all`, `emulators`), confirmed by reading it — `test:e2e` joins
that group, not `web/`'s scripts.

The band must also be **self-contained like the other three**, not dependent
on a human having already run `npm run dev:all`. A gate that depends on
manual setup is a gate that gets skipped — exactly the failure mode CLAUDE.md
§5's closing line already warns about ("a band absent from this list is a
band nobody runs"; the same logic extends to "a band that needs a manual
precondition is a band that silently doesn't run"). The mechanism: Playwright's
own `webServer` config (starts the web app, waits for it to be ready, tears
it down after) composed with `firebase emulators:exec` (starts the Firebase
Emulator Suite around the whole run, tears it down after) — with seeding
(`npm run seed`) run inside that same envelope, so the flows always see
deterministic data rather than whatever the emulator happened to contain.
The exact internal composition (config file contents) is wiring, decided at
the Playwright-install sub-stage; this sub-stage fixes the command name, the
self-containment requirement, and the fact that seeding is part of the
band's own definition — not a precondition the operator remembers separately.

---

### Task: SRS.md + CLAUDE.md — name Playwright and add the self-contained E2E band

**Files:**

- Modify: `SRS.md:575` (§7.1 Stack table, Tests row)
- Modify: `SRS.md:677` (§9 milestone table, M7 row)
- Modify: `SRS.md:693` (§9, existing "Note — the testing strategy" paragraph — insert a new note immediately after it)
- Modify: `CLAUDE.md:60` (§4 Technical stack)
- Modify: `CLAUDE.md:76-81` (§5 Local development, test bands list)
- Modify: `CLAUDE.md:154` (§9 Milestone audit, zone C)

**Interfaces:**

- Consumes: none.
- Produces: the tool name "Playwright", the exact six-flow list (SRS §9),
  and the exact command name `npm run test:e2e` (repo root) — all three
  now live in both files consistently, since this task edits both before
  committing either.

- [ ] **Step 1: Confirm every anchor line hasn't drifted, in one pass**

Run:

```
grep -n "Tests | Vitest" SRS.md
grep -n "^| M7 " SRS.md
grep -n "^\*\*Note — the testing strategy" SRS.md
grep -n "Tests.*Vitest" CLAUDE.md
grep -n "All three bands are gates" CLAUDE.md
grep -n "all three bands green" CLAUDE.md
```

Expected: matches at `SRS.md:575`, `SRS.md:677`, `SRS.md:693`,
`CLAUDE.md:60`, `CLAUDE.md:81`, `CLAUDE.md:154` — the line numbers this plan
was written against. If any differ, re-read the surrounding 10 lines before
editing that spot — do not assume the offset still holds.

- [ ] **Step 2: Edit the §7.1 Stack table Tests row (SRS.md:575)**

Replace:

```
| Tests | Vitest + React Testing Library + jsdom *(foundation installed at M1; tests written continuously, from M1 onwards)* |
```

With:

```
| Tests | Vitest + React Testing Library + jsdom *(foundation installed at M1; tests written continuously, from M1 onwards)*; Playwright *(E2E on the six critical flows, from M7 — see §9)* |
```

- [ ] **Step 3: Edit the §9 M7 row (SRS.md:677) to name Playwright**

Replace:

```
| M7 | Polish & launch | Empty/error states, complete i18n, **end-to-end tests on the critical flows (final regression coverage — testing has been running continuously since M1, it does not start here)**, final Security Rules, **bundle optimization (code splitting — see the note below the table)**, deploy (Blaze already active since stage A) | Live, tested application |
```

With:

```
| M7 | Polish & launch | Empty/error states, complete i18n, **Playwright end-to-end tests on the six critical flows (final regression coverage — testing has been running continuously since M1, it does not start here; see the note below the table)**, final Security Rules, **bundle optimization (code splitting — see the note below the table)**, deploy (Blaze already active since stage A) | Live, tested application |
```

- [ ] **Step 4: Insert a new M7 note listing the six flows, directly after the existing testing-strategy note (SRS.md:693)**

The existing note at line 693 ends with:

```
...The principle: **new code = tested code**. (M0 remains without tests — the testing foundation lands at M1, together with the first product code.)
```

Immediately after that paragraph (still inside §9, before the `---` that
closes the section — confirm the `---` is still on the line right after by
re-reading the current line 694 before inserting), insert this new paragraph
verbatim:

```
**M7 note — Playwright end-to-end flows:** the six critical flows covered are:
1. Login + role redirect (admin vs tenant).
2. Full KYC onboarding → account created → credentials returned.
3. Monthly report: draft → sign → visible in the tenant portal.
4. Tenant portal: dashboard → history → report detail → PDF downloaded.
5. Shared link `/r/:shareToken` opened anonymously, then revoked and re-checked.
6. `endTenancy`: property returns to free, account becomes inactive-readonly.

Flows 4 and 5 exist specifically to close a gap the M4 audit found: it
declared FR-REP-07b delivered while the export had never produced a valid
file in a real browser, because `html2canvas` was mocked at module level in
the unit tests (CLAUDE.md §9 zone A). Playwright runs against the real
export/share pipeline, not a mocked one.
```

- [ ] **Step 5: Edit §4 Technical stack (CLAUDE.md:60)**

Replace:

```
- **Tests:** Vitest + React Testing Library
```

With:

```
- **Tests:** Vitest + React Testing Library; Playwright (E2E, from M7 — SRS §9)
```

- [ ] **Step 6: Edit §5 test bands (CLAUDE.md:76-81) — add the fourth, self-contained band and update the gate count**

Replace the whole block:

```
**Test bands** (foundation installed at M1):
- `npm run test:run --prefix web` — the fast band: components/hooks in jsdom, with the backend boundary mocked.
- `npm run test:rules --prefix web` — the rules band: `firestore.rules` against the Firestore emulator. It starts its own emulator (`firebase emulators:exec`), so port 8080 must be free.
- `npm run test:emulator --prefix functions` — the functions band: Cloud Functions against the Auth + Firestore emulators. It starts its own emulator (`firebase emulators:exec`), so port 8080 must be free — the same conflict as the rules band; the two cannot run at the same time.

**All three bands are gates.** A band absent from this list is a band nobody runs.
```

With:

```
**Test bands** (foundation installed at M1; the fourth lands at M7):
- `npm run test:run --prefix web` — the fast band: components/hooks in jsdom, with the backend boundary mocked.
- `npm run test:rules --prefix web` — the rules band: `firestore.rules` against the Firestore emulator. It starts its own emulator (`firebase emulators:exec`), so port 8080 must be free.
- `npm run test:emulator --prefix functions` — the functions band: Cloud Functions against the Auth + Firestore emulators. It starts its own emulator (`firebase emulators:exec`), so port 8080 must be free — the same conflict as the rules band; the two cannot run at the same time.
- `npm run test:e2e` (repo root, not `--prefix web` — the flows exercise `functions/` too, e.g. `finalizeKyc` and `getSharedReport`) — the E2E band: Playwright against the six critical flows (SRS §9), driving a real browser through the app. Self-contained like the other three bands, not dependent on `dev:all` already running: `firebase emulators:exec` starts the Firebase Emulator Suite (Auth + Firestore + Storage + Functions) and seeds it (`npm run seed`) before Playwright's own `webServer` config boots the web app and runs the flows; everything tears down when the command exits. Seeding is part of the band's definition, not a manual precondition — the flows need deterministic data. The config wiring lands at the Playwright-install sub-stage; this entry fixes the command name and the self-containment requirement ahead of it. Same port-8080 conflict as the rules and functions bands, now three-way: none of the three `emulators:exec`-based bands (rules, functions, e2e) can run at the same time, and none can run while the persistent dev emulator (`npm run dev:all`) is up.

**All four bands are gates.** A band absent from this list is a band nobody runs.
```

- [ ] **Step 7: Edit §9 zone C (CLAUDE.md:154)**

Replace:

```
- **C. Testing** — a complete code↔test pairing; all three bands green (**run, not inferred**); anti-vacuity confirmed (a test that would pass with the behavior removed proves nothing — see §7).
```

With:

```
- **C. Testing** — a complete code↔test pairing; all four bands green (**run, not inferred**); anti-vacuity confirmed (a test that would pass with the behavior removed proves nothing — see §7).
```

Leave `CLAUDE.md:155` (the historical note about the functions band's
past omission) untouched — it describes a past incident, not the current
count.

- [ ] **Step 8: Grep once more for any remaining "three band"/"both band" phrasing, and for the old `--prefix web` command form, before committing**

Run:

```
grep -n -i "three bands\|both bands" CLAUDE.md
grep -n "test:e2e" CLAUDE.md SRS.md
```

Expected: no matches for the first grep; the second shows only the
`npm run test:e2e` (no `--prefix web`) form. If either check fails, it was
missed by this plan's Investigation findings section — stop and re-check
before committing.

- [ ] **Step 9: Commit (both files, one commit)**

```bash
git add SRS.md CLAUDE.md
git commit -m "$(cat <<'EOF'
docs: name Playwright as the M7 E2E band across SRS and CLAUDE

Names the tool and the six critical flows (SRS §7.1, §9) and wires it in
as the fourth, self-contained test band (CLAUDE.md §4, §5, §9 zone C) in
one commit. Two commits would leave a window where the SRS names
Playwright but CLAUDE.md does not yet gate it — the same shape as the
M6 functions-band gap this sub-stage exists to avoid. No code; Playwright
is not installed yet.
EOF
)"
```

---

## Self-review (completed while writing this plan)

**Spec coverage** — every REQUIRED EDIT in the task description maps to a
step: SRS §9 row (Step 3) + six flows (Step 4); SRS §7.1/§2.7 check
(Investigation findings #1–2, plus Step 2 for the §7.1 edit); CLAUDE.md §4
(Step 5), §5 with the exact root-level command, self-containment, and
seeding-as-definition (Investigation finding #5, Step 6), §9 zone C with a
full grep for every band-count location (Investigation finding #3, Steps 1
and 8); single commit covering both files (Step 9).

**Placeholder scan** — no TBD/TODO; every step carries the literal
before/after text to paste, not a description of what to write.

**Consistency** — "the E2E band" / "Playwright" / `npm run test:e2e` (no
`--prefix web`) are used identically everywhere they appear (Investigation
finding #5, Step 6's CLAUDE.md text, Step 8's verification grep); the
six-flow numbering and wording in Step 4 matches the task description's
list verbatim, so nothing drifts between the two files or within this plan.
