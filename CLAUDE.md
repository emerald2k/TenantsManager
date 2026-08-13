# CLAUDE.md — Working guide for this project

This file is read automatically by Claude Code at every session. It contains the context and working rules for the **TenantsManager** project (tenant management platform).

---

## 1. Source of truth

**`SRS.md`** (in the project root) is the **complete and definitive specification**. It is the result of an extensive planning phase and contains: numbered functional requirements (FR-xxx), non-functional requirements (NFR-xxx), the data model, a page-by-page UI specification, the technical architecture, the milestone plan and the email templates.

**Absolute rules:**
- Read the SRS before generating any code. It is the reference for every decision.
- **Do not improvise** features, fields, rules or technologies that are not in the SRS. If something seems unclear or missing, **ask** — do not assume.
- When you implement something, reference the relevant requirements (e.g. "implementing FR-TEN-01…FR-TEN-24").
- If a contradiction or a gap appears in the SRS, flag it and ask for clarification before continuing.
- **The code and the SRS move together.** Renaming a data-model identifier, adding a field or changing a flow in code without updating the SRS in the same move breaks the source of truth. Green tests over a divergent spec is drift, not progress.
- **The SRS specifies the PRODUCT (what it does); this file holds the PROCESS (how we work).** Do not put implementation philosophy into the SRS — it belongs here. That is what keeps the SRS credible as a specification.

---

## 2. Working mode: milestone by milestone

The project is built on **milestones** (section 9 of the SRS: M0–M7).

**Rules:**
- Work on **a single milestone at a time**, in order (M0 first).
- **Do not move to the next milestone without the user's explicit confirmation.**
- At the start of each milestone: briefly summarize what you will do and which FR/NFR requirements it covers.
- At the end of each milestone: check the "done" criterion defined in the SRS and report the state.
- Prefer small, verifiable steps over massive generation in one go. The user is learning along the way — explain the decisions as you make them.
- **Do not commit product code before the administrator's explicit validation.** Verify it yourself first (lint, build, behavior test), report the result, and WAIT for confirmation. Commits on a milestone branch are not a work journal — each one is a gate.
- **`CURRENT_SPRINT.md`, at the project root, is a LOCAL context checkpoint** — regenerated so a new session (possibly a different model) can resume work without losing architectural context.
  - Regenerate it ONLY at gates, after a sub-stage is committed — never mid-sub-stage, never on incoherent state (half-written code, temporarily red tests). A checkpoint written on such a state misleads whatever session reads it next.
  - **Emergency exception:** if a session-limit warning fires mid-sub-stage, a snapshot MAY be written outside a gate — but it MUST be explicitly labeled as a mid-sub-stage snapshot (not a stable checkpoint), state plainly that nothing in it should be trusted as complete/tested/committed without verification, and instruct the next session to re-run `git status` / `git diff` / the test suite before continuing rather than trusting the file's claims.
  - It is in `.gitignore` and is NEVER committed — it is a transition snapshot, not durable documentation.
  - **It is NOT a source of truth.** It holds no architecture decisions, product requirements, or process rules — those belong in `SRS.md` / this file. It only summarizes "where things stand" and points back to `SRS.md`, `CLAUDE.md`, and `git log` for detail. A decision worth keeping durably belongs in `SRS.md`, not here.
  - Typical content: current milestone + the last committed sub-stage (SHA + message) + branch; the sub-stages of the current milestone committed so far; the next sub-stage in sequence; working-tree/test state; the essential process rules (SRS = source of truth, commits are gates, §9 audit before merging to main).

---

## 3. Language conventions

- **The working language of the repository is English:** code, data-model identifiers, comments, test names (`describe`/`it`), commit messages, and the working documents (this file and `SRS.md`).
- **Exception — displayed content:** the values in `web/src/lib/i18n/locales/ro.json` stay in Romanian. There, Romanian is content shown to the user, not working language. The i18n *keys* are English.
- **Exception — the RO email templates** (SRS Appendix A): the body stays Romanian; the interpolated placeholders (`{name}`, `{dueDate}`…) are English, because they are identifiers coming from code.
- `cnp` keeps its Romanian name deliberately: it is a Romanian domain term (the national identification number), like IBAN — it has no exact English equivalent. Documented in SRS §6.
- **The administrator communicates in Romanian.** The repository being English does not change the conversation language — reply in Romanian unless asked otherwise.

---

## 4. Technical stack (fixed — see section 7 of the SRS)

- **Frontend:** JavaScript (NOT TypeScript), Vite + React (SPA), React Router
- **UI:** Tailwind CSS + shadcn/ui
- **Forms:** React Hook Form + Zod
- **Data:** TanStack Query
- **Charts:** Recharts (Phase 2 only)
- **Backend (BaaS):** Firebase — Firestore, Authentication, Storage, Cloud Functions, the "Trigger Email" extension
- **i18n:** react-i18next (RO/EN)
- **Tests:** Vitest + React Testing Library; Playwright (E2E, from M7 — SRS §9)
- **Code quality:** ESLint, Prettier, Husky + lint-staged, commitlint, .editorconfig
- **Config:** environment variables through `.env` (Vite); the Firebase keys are NOT hardcoded; `.env` in `.gitignore`
- **Structure:** monorepo — `web/` (frontend) and `functions/` (Cloud Functions) in separate folders
- **Deploy:** manual, Firebase CLI

**Do not introduce** technologies outside this list without asking (see "tooling consciously avoided" in the SRS: no TypeScript, Storybook, Docker, automatic CI/CD, Sentry in the MVP).

---

## 5. Local development

- Local development runs on the **Firebase Emulator Suite** (Auth, Firestore, Storage, Functions).
- Blaze is active and the application has been in production since the alpha stage (deploy after M5, ahead of M6 — SRS §7.5). Local development stays on the emulators regardless.
- Firebase project: `tenants-manager-2026`.

**Test bands** (foundation installed at M1; the fourth lands at M7):
- `npm run test:run --prefix web` — the fast band: components/hooks in jsdom, with the backend boundary mocked.
- `npm run test:rules --prefix web` — the rules band: `firestore.rules` against the Firestore emulator. It starts its own emulator (`firebase emulators:exec`), so port 8080 must be free.
- `npm run test:emulator --prefix functions` — the functions band: Cloud Functions against the Auth + Firestore emulators. It starts its own emulator (`firebase emulators:exec`), so port 8080 must be free — the same conflict as the rules band; the two cannot run at the same time.
- `npm run test:e2e` (repo root, not `--prefix web` — the flows exercise `functions/` too, e.g. `finalizeKyc` and `getSharedReport`) — the E2E band: Playwright against the six critical flows (SRS §9), driving a real browser through the app. Self-contained like the other three bands, not dependent on `dev:all` already running: `firebase emulators:exec` starts the Firebase Emulator Suite (Auth + Firestore + Storage + Functions) and seeds it (`npm run seed`) before Playwright's own `webServer` config boots the web app and runs the flows; everything tears down when the command exits. Seeding is part of the band's definition, not a manual precondition — the flows need deterministic data. The config wiring lands at the Playwright-install sub-stage; this entry fixes the command name and the self-containment requirement ahead of it. Same port-8080 conflict as the rules and functions bands, now three-way: none of the three `emulators:exec`-based bands (rules, functions, e2e) can run at the same time, and none can run while the persistent dev emulator (`npm run dev:all`) is up.

**All four bands are gates.** A band absent from this list is a band nobody runs.

---

## 6. Git & conventions

**Branching model:**
- `main` — always stable and functional. Do not commit half-finished code here.
- `milestone/mX-name` — one branch per milestone (e.g. `milestone/m1-properties`). It is merged into `main` when the milestone is done and verified.

**Commits:** follow **Conventional Commits** — `<type>: <imperative description, lowercase>`.
- Types: `feat`, `fix`, `docs`, `chore`, `test`, `refactor`, `style`, `build`, `ci`.
- Examples: `feat: add property list page`, `chore: configure eslint and prettier`, `docs: update SRS`.
- Small, frequent commits, each with a clear purpose.

---

## 7. Quality principles

- **Clean code from the first line:** all code respects the ESLint/Prettier rules configured in M0.
- **Continuous testing — new code comes with tests (from M1):** testing is not piled up at the end. The testing foundation (Vitest + React Testing Library + jsdom) lands at **M1**; from there on **every feature is delivered with its own tests**, written together with the code, not retroactively. The end-to-end tests on the critical flows at M7 are final regression coverage, not the first moment of testing. See SRS §9.
- **Tests must not pass vacuously.** A test that would still pass with the behavior removed proves nothing. For a security rule, check it: make the rule permissive temporarily and confirm the deny tests fail.
- **A `setState` fired from inside a promise continuation is NOT captured by React Testing Library's implicit `act()` flush.** A mutation that reaches `setState` via an async callback's own promise chain — e.g. a subscription callback like `onIdTokenChanged`, invoked directly in a test and resolved later — schedules the update without committing it before the test's next line runs. Reading `result.current` right after `await`-ing such a callback observes a stale snapshot — the assertion PASSES AGAINST AN UNFIXED, BUGGY IMPLEMENTATION, certifying a real bug as fixed rather than merely proving nothing. Discovered while writing the `AuthProvider` race test (M7): with no explicit flush, the test read `result.current` immediately after `await callback1Promise` and passed even against the unfixed provider, because the buggy `setState` calls had been scheduled but not yet committed. Wrap the read in `await act(async () => {})` before asserting on state mutated this way. Any EXISTING test that reads state right after an async mutation has the same shape and the same defect — auditing the current suite for it is open debt. See `docs/superpowers/plans/2026-08-13-m7-substage3-authprovider-race.md` and the race test in `web/tests/auth.provider.test.jsx`.
- **Security:** the KYC data (CNP, ID photos, financial data, guarantor) is STRICTLY admin-only (see NFR-SEC-01…09 and the data model in SRS §6). The tenant only accesses denormalized data in `tenancies` and their own published `monthlyReports`. Check the Security Rules for every feature that touches sensitive data.
- **Security Rules are an ACCESS boundary, not a business-logic boundary.** Display preferences (e.g. hiding archived properties) belong in the query/hook, not in the rules: a rule filtering by `archived` would make soft-delete look like a real deletion and would block the admin from seeing their own archived data.
- **No format validation** on fields (NFR-VAL-01): fields are mandatory only as presence, without format checking (CNP, phone etc. accept anything). Do not add format validations unless the SRS explicitly requires them.
- **The KYC validation schema is intentionally duplicated** in two places: `web/src/features/onboarding/schema.js` (browser-side) and `functions/src/draftValidation.js` (server-side). `functions/` deploys without `web/`, so a shared import would break at deploy (M7). **SRS §6 is the single source of truth for both — on ANY change to the KYC fields or validation rules, update BOTH files.** Both are tested against the same cases, so drift tends to surface as a failing test. If this cross-package sharing grows beyond the one schema, promote it to a shared package (ask first).
- **Localization:** all visible text goes through i18n (RO/EN) from the start, not hardcoded.
- **Firestore writes must never contain `undefined` values** — the SDK throws synchronously (before any network call) if any field, including nested ones, holds `undefined`. This is especially dangerous with silent-fail mutations (no onError observed): the UI can advance optimistically while the actual document is never written. Any code path writing form state to Firestore (autosave, updates) must sanitize `undefined` recursively before the write — see `stripUndefinedDeep` in `web/src/features/onboarding/hooks.js` for the established pattern. Discovered and fixed in Sub-stage E (M2) after a silent autosave failure blocked the "existing tenant" onboarding flow.
- **Firestore `update()` with dotted-path notation on an array field silently replaces the array with a keyed object** — `update({ 'arrayField.0.nested': value })` does not merge into the array element; it destroys the array entirely, replacing it with `{"0": {"nested": value}}`. No error is thrown. Discovered in M5 when `serviceCosts` (an array of cost lines) was silently converted to an object, losing all fields except the one being patched. The only safe pattern for modifying a nested value inside an array element is to rewrite the entire array field. See commit `4e677ce`.
- **Storage writes adjacent to a Firestore transaction follow copy-first, delete-after-commit.** When a flow both relocates Storage objects and writes Firestore state that references them (e.g. `finalizeKyc` migrating draft photos to `/users/`), the objects are COPIED to the new location first, and the Firestore transaction writes the FINAL references — never the originals. The old copies are deleted only AFTER the transaction commits, best-effort. If the transaction fails, compensation deletes the new copies; the originals, never touched, are still there — the operation is fully resumable. See `functions/src/kyc.js`'s "3.5. MIGRATE PHOTOS" step and `functions/src/photoMigration.js`. A direct move (delete-then-write) is never used: it would destroy the original before the transaction that depends on the new location has actually committed.
- **The Storage bucket name is referenced explicitly and identically at the client and in Functions, never inferred.** `getStorage().bucket()` with no argument resolves the Admin SDK's own ambient default, which is CONTEXT-DEPENDENT — it differs between the real Cloud Functions Framework runtime and a `firebase emulators:exec`-spawned script. Relying on it silently pointed `finalizeKyc`'s photo migration at the wrong bucket in M3, invisible to every test until browser validation caught it. `web/.env`'s `VITE_FIREBASE_STORAGE_BUCKET` and `functions/src/kyc.js`'s `STORAGE_BUCKET` must stay hand-identical (same duplication discipline as the KYC schema, above) — `functions/test/kyc.bucketMismatch.test.js` guards the must-match by faking a divergent ambient default and proving migration only succeeds because the reference is explicit, never inferred.
- **Download URLs are never persisted — the Storage `path` is stored, the URL is
  derived at display time.** `getDownloadURL()` mints a
  `firebaseStorageDownloadTokens` entry in the object's own metadata on first
  call, and that token is permanent: a request carrying it is served with
  `alt=media` WITHOUT Security Rules being consulted — proven empirically with an
  unauthenticated `curl`. Anyone who obtains the URL (a log line, a browser
  history entry, a screenshot, a forwarded message) keeps access forever,
  regardless of the report being unlocked, the share link revoked, or the account
  disabled. Firestore therefore stores `path`; authenticated clients call
  `getDownloadURL()` at render time so each access passes through the rules;
  anonymous shared-report visitors never receive a URL at all. Discovered as debt
  #5 before the alpha deploy — SRS §6 had specified `(Storage ref)` from the
  start, and the code had drifted, unnoticed by two audits because the field was
  named `url`. When a spec says one thing and the field name suggests another,
  the field name wins in practice: name it unambiguously.
- **Day-count differences are computed by converting both dates through `Date.UTC` and dividing by 86400000 — never by subtracting local `Date` objects in milliseconds.** UTC has no daylight-saving transitions, so the result is always an exact integer; a local-time millisecond diff lands on a fractional day (e.g. 2.958) across the one night a year Europe/Bucharest's clocks change. `functions/src/schedulerLogic.js` (M6) and `web/src/features/properties/dueDayCountdown.js` (`computeDaysUntilDueDay`, FR-PROP-11, converted at M7 sub-stage 4) both follow this rule, independently — `functions/` deploys without `web/`, the same reason the KYC schema is duplicated rather than shared (above), so each side implements it separately rather than sharing a helper. Not an active bug on the `dueDayCountdown.js` side even before the conversion: `Math.round` already absorbed the ~1-hour DST error for every real (today, dueDay) pair — verified exhaustively (both 2026 Europe/Bucharest transitions, ±45 days, every `dueDay` 1–31, zero divergences found) rather than assumed, so no test distinguishes the old and new implementations. That proof is scoped to Romania and 2026's DST rule — SRS.md has no single "Romania-only" sentence, but RON-only currency (§2.6), `cnp` as a mandatory Romanian-specific field (§6), and every scheduled job hardcoded to Europe/Bucharest (FR-SYS-04) are the actual boundary it depends on. Converted anyway, not to fix an observed bug but because the old version's safety was a numerical coincidence of these specific numbers, not a property of the technique — the `Date.UTC` version is correct by construction and does not depend on that coincidence continuing to hold (a DST-rule change or a future non-Romania deployment could break the old one silently). See `docs/superpowers/plans/2026-08-13-m7-substage4-duedaycountdown-antivacuity.md`.
- **Explain the decisions:** the user is learning. When you make a non-trivial implementation decision, briefly explain the reasoning.

---

## 8. When to stop and ask

Stop and ask for clarification if:
- A requirement in the SRS seems ambiguous, contradictory or missing.
- You need a technology or a pattern that is not in the stack.
- A decision would affect the data model, security or an already-defined flow.
- You are about to move to the next milestone.

Better one extra question than one wrong assumption. The project's principle: **measure ten times, cut once.**

---

## 9. Milestone audit before merging to main

**No milestone branch merges into `main` without a prior read-only audit.** Claude Code gathers the evidence (`file:line`, command results); the administrator is the final gate. The audit changes nothing — it only reports.

**Guiding principle: prove that nothing was LOST, not just that what exists is green.** An audit that does not actively hunt for discrepancies is not an audit. A passing test suite over a divergent spec is drift, not proof of completeness.

The audit covers **five zones**:

- **A. Functional completeness** — every in-scope FR mapped to code, OR explicitly marked deferred (where/when). Checked **against the SRS, not against the code** — this is what catches what is missing, not merely what exists.
- **B. "Done" criterion** — quoted verbatim from SRS §9, confirmed point by point.
- **C. Testing** — a complete code↔test pairing; all four bands green (**run, not inferred**); anti-vacuity confirmed (a test that would pass with the behavior removed proves nothing — see §7).
- **The functions band was missing from §5 until M6.** The alpha-stage audit passed zone C with 30 failing tests sitting in that band — the audit correctly checked everything the rule asked of it; the rule itself was incomplete. The band was documented in `functions/README.md` the whole time: knowledge present in documentation but absent from the gate's own definition behaves as if it does not exist.
- **D. Code↔SRS consistency** — every decision that touched the SRS is actually written down, **in ALL the relevant places**. One SRS edit can touch one spot and miss another (e.g. a requirement marked deferred in §5.3 but left unmarked in §9 — the real case from the M1 audit). The audit actively looks for such residual divergences.
- **E. Repo hygiene** — correct branch, `main` untouched until the merge, working tree clean, zero committed artifacts, i18n parity, tooling config in place.
- **Zone A must verify execution, not just existence.** Mapping a requirement to `file:line` proves the code exists; it does not prove the code works. A test suite with mocked boundaries (e.g. `html2canvas` mocked at module level) can pass green over a feature that fails 100% in a real browser. The M4 audit declared FR-REP-07b delivered while the export had never produced a valid file — the mock-total test proved correct wiring, but could not structurally detect a real library incompatibility (`oklch`). Zone A's standard must include at least one execution-level check per FR: either a passing integration/E2E test against the real dependency, or an explicit browser-validation step whose result is recorded in the audit report. "Code exists + unit tests pass" is necessary but not sufficient.

**If the audit surfaces a discrepancy, it is fixed as a separate gate BEFORE the merge** — not rationalized away, not deferred.

---

## Agent skills

### Issue tracker

Issues live in GitHub Issues (github.com/emerald2k/TenantsManager), using the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Domain docs

Single-context layout: `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.
