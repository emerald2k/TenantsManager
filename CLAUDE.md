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

The project is built on **milestones** (section 9 of the SRS: M0–M8).

**Rules:**
- Work on **a single milestone at a time**, in order (M0 first).
- **Do not move to the next milestone without the user's explicit confirmation.**
- At the start of each milestone: briefly summarize what you will do and which FR/NFR requirements it covers.
- At the end of each milestone: check the "done" criterion defined in the SRS and report the state.
- Prefer small, verifiable steps over massive generation in one go. The user is learning along the way — explain the decisions as you make them.
- **Commit at the end of a stage, then report — the review happens after the commit, not before it** *(changed 2026-08-24, by the administrator, to match how the work actually runs)*. Verify it yourself first: lint, build, every band the stage's gate names, and whatever behavioural check the requirement implies. Then commit, and report what you committed, what you verified, and what you are unsure about. **This is a real gate, not a formality** — it is safe only because of where it sits: on a milestone branch, nothing on `main`, every commit revertible on its own. A stage reported as done that was not verified defeats the whole arrangement, and nobody downstream can tell.
  - **Two gates keep their old shape and are the administrator's alone:** the merge into `main` (stage 19) and anything that touches production — the deploy, the migrations run for real, the export taken before them. Those wait for an explicit yes, every time.
  - **§8 is untouched.** Stopping mid-stage to ask is still required whenever a requirement turns out ambiguous, contradictory or missing, whenever a decision would change the data model, security or a defined flow, and whenever the honest answer to "what should this do?" is a guess. The change above is about *when the commit happens*, never about proceeding on an assumption.
  - *(The previous rule read: do not commit before explicit validation, report and WAIT. It was overtaken in practice during M8 — stages 8, 9 and 10 were each committed on a combined "approved, now go to the next stage" instruction — and a written rule that is routinely not followed is worse than no rule, because it stops describing what anyone actually does.)*
- **Between gates, keep going — do not stop after every sub-step.** A commit is the unit of approval; the steps inside it are not. Work a commit through to the end — code, tests, the seed and fixtures it touches, lint, build, the bands its gate names — and stop only when the whole thing is done and verified. Then report and wait. Pausing after each sub-step to ask "shall I continue?" converts one gate into ten and buys no additional safety: the administrator is approving the commit, and nothing has been committed yet.
  - **The exceptions are §8's, and they still apply mid-commit.** Stop immediately, whatever else is unfinished, if a requirement turns out to be ambiguous, contradictory or missing; if the work needs a technology or pattern outside the stack; if a decision would change the data model, security or an already-defined flow; if anything would touch production or be irreversible; or if the honest answer to "what should this do?" is a guess. Those are not interruptions of the work — they ARE the work reaching a question that is the administrator's to answer.
  - A stage that spans **two commits** (M8 stage 4 is the first) has **two** gates, not one. Run to the end of commit A, stop, get approval; then run to the end of commit B.
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
- **Charts:** Recharts — **from M8** (FR-DASH-09). Previously "Phase 2 only"; brought forward with the administrator's explicit approval, and the only new runtime dependency M8 adds. **Not** lazy-loaded: code splitting stays deferred (SRS §9's M8 note), so M8 knowingly grows a bundle already at ~1.96 MB. The §9 M7 code-splitting note lists the chart as a future lazy-load *target*, which is not the same as it being one today.
- **Backend (BaaS):** Firebase — Firestore, Authentication, Storage, Cloud Functions, the "Trigger Email" extension
- **i18n:** react-i18next (RO/EN)
- **Export:** jsPDF (PDF) + **html2canvas-pro** (DOM→canvas). The `-pro` fork specifically — plain `html2canvas` cannot parse `oklch()`, which every design token uses. Load-bearing for NFR-UX-05.
- **Theming:** Tailwind v4 `@custom-variant dark` + `@theme inline` over CSS custom properties in `index.css`. The `inline` form is what lets `.force-light` override tokens through an ancestor.
- **Tests:** Vitest + React Testing Library + jsdom; Playwright (E2E, from M7 — SRS §9)
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
- **First-run setup, none of which was written down until the 2026-08-31 audit (finding #9):**
  - **Node 22** (matches `functions`' `nodejs22` runtime). **Java must be on `PATH`** — the Firestore and Storage emulators are Java processes and fail to start without it.
  - **Three separate installs** — this is not a workspace: `npm install` at the repo root, `npm install` in `web/`, `npm install` in `functions/`.
  - **`.env` files are not committed.** `cp web/.env.example web/.env` and `cp functions/.env.example functions/.env`; the templates' emulator defaults work as-is. A clone with **no `web/.env` throws at `firebase.js` load** ("Incomplete Firebase configuration"); a clone with a `functions/.env` missing is fine locally (every var has a code fallback) and only matters for a real deploy.
  - **`VITE_EMULATOR_HOST`** (optional, default `127.0.0.1`): set it to the hostname the emulators actually resolve on when the app is served through a proxy, tunnel or containerised browser — otherwise the app loads and only sign-in fails, with `auth/network-request-failed`. The login page now names the host and the variable in that case.
  - **`npm run test:e2e -- --headed` does not work** — npm appends `--headed` to the `firebase emulators:exec` invocation, not to `playwright`, and the flag is rejected there. Run headed Playwright by hand inside an already-running emulator session instead.

**Test bands** (foundation installed at M1; the fourth lands at M7):
- `npm run test:run --prefix web` — the fast band: components/hooks in jsdom, with the backend boundary mocked.
- `npm run test:rules --prefix web` — the rules band: **`firestore.rules` AND `storage.rules`** against the Firestore + Storage emulators (`--only firestore,storage`; the suite includes `storage.rules.test.js`). It starts its own emulator (`firebase emulators:exec`), so port 8080 must be free. *Corrected at M8: this entry previously said "firestore.rules" only, which made a Storage-rules change look like it had no band.*
- `npm run test:emulator --prefix functions` — the functions band: Cloud Functions against the Auth + Firestore emulators. It starts its own emulator (`firebase emulators:exec`), so port 8080 must be free — the same conflict as the rules band; the two cannot run at the same time.
- `npm run test:e2e` (repo root, not `--prefix web` — the flows exercise `functions/` too, e.g. `finalizeKyc` and `getSharedReport`) — the E2E band: Playwright against the six critical flows (SRS §9), driving a real browser through the app. Self-contained like the other three bands, not dependent on `dev:all` already running: `firebase emulators:exec` starts the Firebase Emulator Suite (Auth + Firestore + Storage + Functions) and seeds it (`npm run seed`) before Playwright's own `webServer` config boots the web app and runs the flows; everything tears down when the command exits. Seeding is part of the band's definition, not a manual precondition — the flows need deterministic data. The config wiring lands at the Playwright-install sub-stage; this entry fixes the command name and the self-containment requirement ahead of it. Same port-8080 conflict as the rules and functions bands, now three-way: none of the three `emulators:exec`-based bands (rules, functions, e2e) can run at the same time, and none can run while the persistent dev emulator (`npm run dev:all`) is up.

**All four bands are gates.** A band absent from this list is a band nobody runs.

**Two corrections to the E2E entry above, made at M8.** (1) Seeding is wired through `playwright.config.js` → `e2e/global-setup.js`, which spawns `functions/scripts/seed.js` — there is **no `npm run seed` step in the root `test:e2e` script**. The requirement (seeding is part of the band, not a manual precondition) is unchanged; the mechanism described was wrong. (2) Until M8 the band contained **one** test — a login smoke test — so "the E2E band is green" was never a statement about coverage. M8 adds two flows (dark-mode export, payments ledger); the six flows listed in SRS §9 remain deferred. **A band with one test is a gate that passes on nothing** — the sibling of the lesson in §9 about a band nobody runs.

**Lint and build are gates too, and were never written down here.** `npm run lint` and `npm run build` are named in §2's "verify it yourself first" but appear in no band list, so they get skipped. A malformed `index.css` token block or a trailing comma in a locale JSON fails `build` while the fast band stays green — both are M8-shaped mistakes.

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
- **A test that asserts a stub's empty state CERTIFIES the gap as correct behaviour — worse than vacuous.** A vacuous test proves nothing; this one actively defends the absence. It passes *because* the feature is missing, and the day someone wires the component it turns RED, so the correct implementation looks like the regression and the stub looks like the baseline. Discovered by the 2026-08-31 UI/UX audit (finding #1): `web/src/features/tenants/components/FinancialTab.jsx` was an M3-D stub — a hardcoded empty-state `<p>`, no hook, no props — and `web/tests/tenants.financialTab.test.jsx` asserted that exact string. **The tell is in the test's own comment**, which described what would happen *if* the component were ever implemented ("If FinancialTab ever imports a data hook, this file has nothing mocking it and would fail loudly instead of silently passing"). A test that narrates the feature it is not testing is guarding a hole. When a delivered requirement is shipped as a stub, either its test asserts the stub is a stub *and says so in its name*, or it has no test — never one that reads as coverage to anyone who does not open the file.
- **The seed can produce a value that is present, plausible, and wrong in a way no band sees.** Same family as the stub-certifying test above. `Buffer.from('… not a real JPEG')` written under `contentType: image/jpeg` is the case (2026-08-31 UI/UX audit, finding #2): the Storage path resolves, the rule allows the read, `getDownloadURL` succeeds, the request returns 200 — every automated check is green — and only a human looking at the screen sees the broken-image icon. **When the seed produces something a human is meant to look at — an image, a PDF, an export — the check is not that the file exists, it is that it OPENS**: seed a real (tiny) valid artefact and confirm it renders in the surface that displays it. `functions/scripts/seed.js`'s `JPEG_SWATCHES` are the pattern — real 16×16 baseline JPEGs, one colour per photo kind, generated once by a throwaway encoder with no image library added (§8).
- **The second fix is the dangerous one: it can change the failure from loud to silent.** The seed photos were once `gs://demo/...` literals that 404'd — noisy, obviously broken. A 2026-08 commit replaced them with "synthetic bytes" that return 200 and still will not decode — quiet, and now with a plausible green suite behind it. **A repair that changes how something fails without removing the failure is worse than the original bug**, because this time someone looked, saw green, and left convinced. When you touch a fix, verify the failure mode is *gone*, not merely relocated or muffled — and say in the report which one you did.
- **A `setState` fired from inside a promise continuation is NOT captured by React Testing Library's implicit `act()` flush.** A mutation that reaches `setState` via an async callback's own promise chain — e.g. a subscription callback like `onIdTokenChanged`, invoked directly in a test and resolved later — schedules the update without committing it before the test's next line runs. Reading `result.current` right after `await`-ing such a callback observes a stale snapshot — the assertion PASSES AGAINST AN UNFIXED, BUGGY IMPLEMENTATION, certifying a real bug as fixed rather than merely proving nothing. Discovered while writing the `AuthProvider` race test (M7): with no explicit flush, the test read `result.current` immediately after `await callback1Promise` and passed even against the unfixed provider, because the buggy `setState` calls had been scheduled but not yet committed. Wrap the read in `await act(async () => {})` before asserting on state mutated this way. Any EXISTING test that reads state right after an async mutation has the same shape and the same defect — auditing the current suite for it is open debt. See `docs/superpowers/plans/2026-08-13-m7-substage3-authprovider-race.md` and the race test in `web/tests/auth.provider.test.jsx`.
- **Security:** the KYC data (CNP, ID photos, financial data, guarantor) is STRICTLY admin-only (see NFR-SEC-01…09 and the data model in SRS §6). The tenant only accesses denormalized data in `tenancies` and their own **signed** `monthlyReports` (`status == 'signed'` — "published" was renamed at v4.3 and is not a value the rules can match). Check the Security Rules for every feature that touches sensitive data.
- **Security Rules are an ACCESS boundary, not a business-logic boundary.** Display preferences (e.g. hiding archived properties) belong in the query/hook, not in the rules: a rule filtering by `archived` would make soft-delete look like a real deletion and would block the admin from seeing their own archived data.
- **No format validation** on fields (NFR-VAL-01): fields are mandatory only as presence, without format checking (CNP, phone etc. accept anything). Do not add format validations unless the SRS explicitly requires them.
- **The KYC validation schema is intentionally duplicated** in two places: `web/src/features/onboarding/schema.js` (browser-side) and `functions/src/draftValidation.js` (server-side). `functions/` deploys without `web/`, so a shared import would break at deploy (M7). **SRS §6 is the single source of truth for both — on ANY change to the KYC fields or validation rules, update BOTH files.** Both are tested against the same cases, so drift tends to surface as a failing test. If this cross-package sharing grows beyond the one schema, promote it to a shared package (ask first).
- **Localization:** all visible text goes through i18n (RO/EN) from the start, not hardcoded.
- **Firestore writes must never contain `undefined` values** — the SDK throws synchronously (before any network call) if any field, including nested ones, holds `undefined`. This is especially dangerous with silent-fail mutations (no onError observed): the UI can advance optimistically while the actual document is never written. Any code path writing form state to Firestore (autosave, updates) must sanitize `undefined` recursively before the write — see `stripUndefinedDeep` in `web/src/features/onboarding/hooks.js` for the established pattern. Discovered and fixed in Sub-stage E (M2) after a silent autosave failure blocked the "existing tenant" onboarding flow.
- **Firestore `update()` with dotted-path notation on an array field silently replaces the array with a keyed object** — `update({ 'arrayField.0.nested': value })` does not merge into the array element; it destroys the array entirely, replacing it with `{"0": {"nested": value}}`. No error is thrown. Discovered in M5 when `serviceCosts` (an array of cost lines) was silently converted to an object, losing all fields except the one being patched. The only safe pattern for modifying a nested value inside an array element is to rewrite the entire array field. See commit `4e677ce`.
- **Storage writes adjacent to a Firestore transaction follow copy-first, delete-after-commit.** When a flow both relocates Storage objects and writes Firestore state that references them (e.g. `finalizeKyc` migrating draft photos to `/users/`), the objects are COPIED to the new location first, and the Firestore transaction writes the FINAL references — never the originals. The old copies are deleted only AFTER the transaction commits, best-effort. If the transaction fails, compensation deletes the new copies; the originals, never touched, are still there — the operation is fully resumable. See `functions/src/kyc.js`'s "3.5. MIGRATE PHOTOS" step and `functions/src/photoMigration.js`. A direct move (delete-then-write) is never used: it would destroy the original before the transaction that depends on the new location has actually committed.
- **The Storage bucket name is referenced explicitly and identically at the client and in Functions, never inferred.** `getStorage().bucket()` with no argument resolves the Admin SDK's own ambient default, which is CONTEXT-DEPENDENT — it differs between the real Cloud Functions Framework runtime and a `firebase emulators:exec`-spawned script. Relying on it silently pointed `finalizeKyc`'s photo migration at the wrong bucket in M3, invisible to every test until browser validation caught it. `web/.env`'s `VITE_FIREBASE_STORAGE_BUCKET` and `functions/src/kyc.js`'s `STORAGE_BUCKET` must stay hand-identical (same duplication discipline as the KYC schema, above) — `functions/test/kyc.bucketMismatch.test.js` guards the must-match by faking a divergent ambient default and proving migration only succeeds because the reference is explicit, never inferred.
- **A module that calls `initializeApp()` at require time decides the Firebase app for whatever requires it — including a script that has not initialised its own yet.** `functions/src/sharedReport.js` initialises on import. A script that does `require('../src/sharedReport')` at the top of the file and `initializeApp({ projectId })` inside `main()` gets the module's ambient-default app, not its own explicit one: the first call wins, and the top of the file always runs first. **Require such a module lazily, inside `main()`, after the script's own `initializeApp()`** — the discipline `seed.js` already documents. Caught at M8 stage 4 while rehearsing the migration scripts, and caught **only because they were run**, not read: nothing about the import looks wrong, the script names the right project in its own code, and every log line claims the intended project. This is the third form of one family already recorded above — the ambient Storage bucket, the metadata download token, and now import order — and the family's signature never changes: **a value that resolves differently depending on context nobody is looking at, inside code that reads as correct.**
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
- **The Firestore emulator does not enforce composite indexes.** A query that needs one runs green locally and fails only in production — invisible to every band. `firestore.indexes.json` is empty and stays empty; queries use equality filters only, or a single-field range, and sort/filter the rest in JS (SRS §6, "Composite indexes"). If a query genuinely needs an index, **the index ships in the same commit as the query** — never afterwards.
- **A Firestore `orderBy` silently omits every document that lacks the ordered field.** Not an error, not an empty result — those rows just are not there. This is a data-shape trap, not a query-syntax one: `monthlyReports.paymentDate` does not exist at all on an unpaid report, so ordering the payments ledger by it would delete exactly the rows the page exists to show (SRS §5.3, FR-PAY-07). Sorting in JS avoids it, which is a second reason for the no-`orderBy` rule beyond indexes.
- **"Cloud Functions write only" is not something a Security Rule can express.** The Admin SDK **bypasses Security Rules entirely** — there is no Functions principal to match. The *absence* of an `allow write` clause IS the server-write guarantee. Every attempt to write it positively opens the collection instead: `if request.auth == null` opens it to the unauthenticated internet, `if isAdmin()` hands the browser the write path the rule was meant to deny. This matters most for `notifications` (NFR-SEC-10), and the wrong version is the one that looks like every other block in the file.
- **For a formula, the anti-vacuity check is a MUTATION: write the bug in, confirm the guard fires, take it back out.** Relaxing a rule proves a deny test is real; a money formula has no rule to relax, so the equivalent is to introduce the specific error the tests exist to catch — and to watch which of them notice. Used at M8 stage 12 on the payments ledger's footer: the double-counting of carried balances was deliberately reintroduced, three guard tests failed as intended, **and one test that had been written for exactly that bug turned out to pass anyway** — vacuous by coincidence, and it would have gone on reporting success forever. Nothing but the mutation could have revealed that. Do this for every formula whose wrongness would still look plausible on screen: balances, totals, aggregates, anything that ends up in a figure the administrator reads and believes.
- **A collection closed only by the catch-all cannot be tested in isolation.** `match /{document=**} { allow read, write: if false }` denies by default, so a load-bearing closure (e.g. `mail`) has no rule of its own to grep, to point a test at, or to relax for the anti-vacuity check in §7 — relaxing the catch-all relaxes every unimplemented collection at once. Give any invariant that matters its own explicit `match` block with the reason in a comment.
- **An anti-vacuity test on a deny-update rule must assert `permission-denied` specifically, over a document that actually exists.** With `allow create: if false`, a test cannot seed through the rules path; it needs `withSecurityRulesDisabled`. Skip that and the update targets a missing document, fails with `not-found`, and `assertFails()` passes — as does the relaxation check, appearing to confirm non-vacuity. The test proves nothing in both directions at once.
- **A trigger on a document the platform writes back to fires several times per logical event.** The Trigger Email extension updates `delivery` on a `mail` document repeatedly (`PENDING → PROCESSING → SUCCESS`), so `onMailWrite` fires 3-4 times for one email. A projection using an auto-generated ID would create a row per fire. **Key the projection on the source document ID and write with `merge`**, so repeated fires converge on one row (SRS §6, `notifications`). The same discipline `onReportWrite` already documents as "always a full re-derivation, naturally idempotent under at-least-once delivery".
- **`dailyScheduler` has no dedup: it re-sends whatever its predicate says is true today.** A manual "Run now", a platform retry, or a crash mid-loop re-sends to every tenancy already processed. Tolerable for the 1-shot, weekly and every-3-days families; not for a daily-repeating tenant-facing job, which is why FR-PAY-10 uses a **deterministic `mail` document ID** (`{reportId}_predue_{date}`) so a second run overwrites instead of duplicating. Any future daily job needs the same treatment.
- **Calling `renderWithProviders` twice inside one `it()` leaves both trees mounted**, and the shared i18n singleton flips the first tree too — surfacing as `Found multiple elements`, which reads like a selector bug and is not. Unmount the first, or split the test. Any test comparing two languages, **two themes**, or two of anything in one block will hit this; M8's theme and export work is full of exactly that shape.
- **A data-model change is not finished until `functions/scripts/seed.js` reflects it.** The seed is not a convenience — `e2e/global-setup.js` runs it as part of the E2E band's own definition, so a stale seed silently degrades a whole gate, and a seed that never writes a field means the feature reading that field has never been exercised locally by anyone. Two rules follow. **Every new or changed field gets seeded**, with at least one row exercising the interesting case, not just the happy default. And **every state a requirement describes should be reachable in seeded data** — a terminated tenancy, an unpaid month, a credit balance, a property that changed hands mid-month. Discovered at M8: the seed had never written `reportReminderDaysBefore`, added at M6, so that reminder had never once been testable against local data — and nothing failed, because nothing looked.
- **Test fixtures follow the same rule as the seed.** A change to a document id scheme, a field name, or a route shape breaks fixtures scattered across dozens of test files. Fix them in the same commit as the change, never as a follow-up: a red band postponed is a band whose next failure nobody reads.
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
- **Zone A re-checks a sample of EARLIER milestones' requirements, once per audit.** The audit reads the *current* milestone against the SRS; a requirement delivered as a stub two milestones ago is then never re-read by anyone, and the four bands stay green because the stub ships with its own passing test that certifies the hole (see §7). So each milestone audit also picks a handful of FRs from prior milestones — weighted toward UI surfaces and anything a code comment marks as "empty state", "placeholder", "stub", or "lands with M\<later\>" — and runs the same execution-level check zone A already demands of the current milestone: open the surface in a browser, or point an integration/E2E test at it, and record the result. The `FinancialTab` gap (FR-TEN, SRS §5.3 tab 3 — shipped as a hardcoded empty state on 2026-07-21, caught only by a manual screenshot session on 2026-08-31) is the case this clause exists to catch.

**If the audit surfaces a discrepancy, it is fixed as a separate gate BEFORE the merge** — not rationalized away, not deferred.

---

## 10. Data migration gates

**This section did not exist before M8.** It is written now because M8 is the first milestone to modify existing production documents, and because a planning draft cited a "CLAUDE.md §10" that had never been written — a fabricated citation that survived into an acceptance gate. The rule below is real; check that a citation resolves before relying on it.

**A milestone that transforms production data — not a milestone identified by number.** M8 qualifies twice over, and the two are not equally risky:

- **`FR-REP-14` re-keys every `monthlyReports` document** from `propertyId + month + year` to `tenancyId + month + year`. Document IDs change; every existing report is rewritten under a new key. This is the dangerous one, and it is the reason the gate exists.
- **The `paymentReminderDaysBefore` backfill** adds one number to each `tenancies` document and rewrites nothing. Additive and low-risk, but still a write to live data.

A milestone that only *adds* collections and fields, and never rewrites or re-keys an existing document, does not qualify.

When a milestone qualifies:

1. **A verified, restorable export of production Firestore is taken first, as its own gate**, with its own approval — before the migration script runs. "Verified" means the export was actually inspected or test-restored, not merely that the command exited zero. A Firestore export is verified by importing it into a **separate database in the same project** (never over production) and opening real documents in it; `firebase emulators:export` is a different format and cannot validate a production export.
2. **The backup covers every store the migration rewrites, not only Firestore.** M8 exposed the gap: `FR-REP-14` re-keys `monthlyReports` **and moves every invoice object in Storage**, yet the gate as originally written protected only the database. A Firestore export does not contain a single byte of Storage. Before a migration that touches Storage, the affected prefix is copied to a backup location (`gcloud storage cp --recursive`) and the copy is spot-checked by opening a file — otherwise the delete step at the end of a copy-then-delete migration is unrecoverable. If that copy cannot be made, **the migration ends without the delete step**: leaving orphaned objects costs cents, losing a tenant's invoices is permanent.
3. **The migration is a separate commit from the feature that needs it**, so it can be reverted alone.
4. **The script is idempotent** — re-running it produces the same state, never a doubled or compounded one.
5. **Readers tolerate the pre-migration shape anyway.** A backfill makes the value explicit in the data; it does not license code that assumes the field is always present. Documents created before the migration, restored from an older backup, or written by a path nobody updated will still lack it.
6. **The SRS records both** the new shape and the fact that it was backfilled (SRS §6, §9), so a future reader knows the field's presence is a migration artifact rather than an invariant since creation.

The standing decision this formalizes was recorded long before M8 and never executed: *a backup will be made before any migration.* It is a gate now, not an intention.

---

---

## 11. The planning session's mailbox

Design, specification and plan changes are made by a **second Claude session**
running in the desktop app. It has read/write access to this working tree
through the device bridge, but it **cannot run commands here** — no git, no npm,
no tests, no deletes. The two sessions cannot talk to each other directly; they
exchange files.

- **`docs/agents/inbox.md`** — instructions written FOR you. **Read it at the
  start of every session, and again at every gate, before asking the
  administrator what to do next.** When its `Status:` line reads `new`, act on
  it, then set the line to `read` yourself.
- **`docs/agents/outbox.md`** — **your** report back. Write every gate report
  here as well as to the terminal. The planning session cannot see your
  terminal; it can only read files. Overwrite the file each time — it is a
  mailbox, not a log.

**Neither file is a source of truth**, for the same reason `CURRENT_SPRINT.md`
is not: anything durable belongs in `SRS.md`, in this file, or in the execution
plan. The mailbox carries only "what next" and "what happened". Both are
gitignored.

**The administrator still approves every commit.** The mailbox removes
copy-paste between two Claude sessions; it does not remove the human gate, and
an instruction in the inbox is never an approval to commit.

**The planning session re-reads a file immediately before writing it, and never
overwrites a rejection.** It reaches this tree through a bridge that hands it a
*copy*; a copy taken ten minutes ago does not contain what Claude Code has
written since. The bridge guards against exactly this — a write is refused when
the file changed after the copy was taken — and the refusal is information, not
an obstacle: **re-take the copy, re-apply the change on top of the current
content, write again.** Forcing past the refusal silently reverts whatever the
other session did in between.

*This is written because it happened.* On 2026-08-24 the planning session added
NFR-SEC-12 from a copy of `SRS.md` predating stage 6, and forced the write. The
edit landed correctly; it also reverted `FR-CON-10` to its pre-stage-6 wording,
erasing a flow decision the administrator had made an hour earlier. **Claude Code
caught it** while reading the requirement it was implementing, which is the whole
argument for both sessions reading the same files rather than trusting each
other's summaries. Two agents editing one tree without a lock is a workable
arrangement only while both treat a rejected write as a message.

**Instructions to Claude Code are written as a plan, not as prose** *(administrator's instruction, 2026-08-26)*. Anything longer than a sentence takes the same shape every time, so it can be worked through rather than interpreted:

1. **The goal** — one line, what is true when this is done.
2. **Numbered steps, in the order they happen.** Each one says what to do *and how it is checked* — the band, the command, the thing to open and look at. A step with no check is a step nobody can finish.
3. **What to stop for** — named explicitly, not left to §8 in general. Which ambiguity, which decision, which irreversible thing.
4. **The deliverable** — what is committed, which file is written, what the report must contain.

Prose hides the checks inside sentences and makes an instruction feel finished when only its first half was read. A plan makes the unfinished parts visible while the work is happening, which is the point.

**He reads both files, so both carry a mandatory `Needs Bogdan:` line** directly
under `Status:` — `no`, or a one-sentence statement of the decision, risk or
command waiting on him. **Whatever goes on that line is also said in the
terminal**, where he is actually looking. A question parked only in a file is a
question nobody answers, and two agents exchanging files is exactly the
arrangement in which that happens without anyone noticing.

**Neither session decides on his behalf.** A change to a requirement, to the
stage sequence, to an accepted risk, or to anything that touches production is
proposed to him and waits. The mailbox is for carrying work and reports, never
for settling questions that are his.

## Agent skills

### Issue tracker

Issues live in GitHub Issues (github.com/emerald2k/TenantsManager), using the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Domain docs

Single-context layout: `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.
