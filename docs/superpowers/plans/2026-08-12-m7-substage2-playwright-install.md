# M7 Sub-stage 2 — Install and wire Playwright as the E2E band — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Install `@playwright/test` at the repo root and wire `npm run test:e2e` so it satisfies CLAUDE.md §5's E2E band definition exactly — self-contained, no `dev:all` precondition, seeding as part of the band's own definition — with ONE trivial smoke test (`/login` renders) proving the chain starts and tears down cleanly. No flow tests yet; the six flows (SRS §9) are later sub-stages, each building on this scaffold.

**Architecture:** `firebase emulators:exec` wraps a single, non-compound command (`npx playwright test`) — empirically the only form of that wrapping proven safe on this Windows machine (see Investigation finding #1). Everything downstream of that one command — seeding, then booting the web app, then running the test — is composed _inside_ Playwright itself: seeding via a `globalSetup` hook that shells out to `node` directly (never `npm`, never a compound shell string), and the web app via Playwright's own cross-platform `webServer` config. This keeps exactly one shell-quoting boundary in the whole chain — the same boundary the existing rules/functions bands already cross successfully — instead of inventing a second one.

**Tech Stack:** `@playwright/test` (root devDependency only, Chromium browser only). No other new package. Config and test files are plain JavaScript (root `package.json` has `"type": "module"`, so root-level `.js` is ESM by default — matches CLAUDE.md §4, no TypeScript).

## Global Constraints

- Playwright installs at the **repo root only** — never `web/`. `playwright.config.js` sits at the root, alongside `firebase.json`.
- No TypeScript. Do not run `npm init playwright@latest` (its scaffolder defaults to `.ts` config and `.ts` tests) — install `@playwright/test` directly and hand-write plain `.js` files instead.
- Install nothing beyond `@playwright/test` itself: no extra reporter package (Playwright's built-in `list` reporter needs none), no helper libraries (SRS §2.7 — Playwright is already the one deliberate addition to a constrained stack; don't let it drag in a second one).
- `.gitignore` is updated **before** `npx playwright install` runs (Task 1 precedes Task 2) — hundreds of MB of browser binaries and run artifacts must never reach the repo.
- Node 22 (confirmed installed: `v22.23.1`, matches `functions/package.json`'s `"engines": { "node": "22" }`).
- Commit type: see "Commit type decision" below. Body lines under 100 chars.
- Do not commit without the administrator's explicit gate approval (CLAUDE.md §2). **This planning turn writes the plan only — no install, no file writes to the repo, no commit.** All Bash/PowerShell commands referenced below as "already run" were run in the session's scratchpad directory, never inside the repo.

---

## Investigation findings (read before starting — these drove every design choice below)

**1. `firebase emulators:exec "A && B"` (a compound command inside the quoted
argument) fails SILENTLY on this Windows machine — no error, no output,
exit code 0.** Verified empirically in the session scratchpad: an npm script
`"wrapped": "cmd /c \"node -e \\\"console.log('A')\\\" && node -e \\\"console.log('B')\\\"\""`
produced **zero output and exit code 0** — worse than a crash, because a
gate built this way would report green while never having run anything.
This is the exact `emulators:exec`-plus-shell-nesting composition the task
description's naive reading of CLAUDE.md §5 ("seeds it, then Playwright's
webServer boots the app, then runs the tests") could tempt someone into
writing as one big `A && B && C` string. **Do not do that.**

**2. A single, non-compound command inside `emulators:exec "..."` works.**
Verified two ways: (a) the same scratchpad test with `"wrapped-safe":
"cmd /c \"node runner.js\""` (no `&&`, no double-nesting) printed both lines
correctly, exit 0; (b) this pattern already exists and already passes in
this exact repo — `functions/package.json`'s `test:emulator` script is
`firebase emulators:exec --only auth,firestore,storage --project
tenants-manager-2026 "vitest run"`, a single quoted command with no
operators inside, and CURRENT_SPRINT.md records it passing 217/217. **The
E2E band's `emulators:exec` argument must stay a single command for the
same reason** — `"npx playwright test"`, nothing appended to it.

**3. `spawnSync('npm', [...], { shell: false })` fails with `ENOENT` on
Windows.** Verified directly: `node -e "require('node:child_process').spawnSync('npm', ['--version'], {shell:false})"`
returned `status: null, error: 'ENOENT'`. This is the well-known Windows
gotcha where `npm` resolves to `npm.cmd`, a shim `CreateProcess` cannot
launch without a shell. This matters because CLAUDE.md §5 describes seeding
as "`npm run seed`" — if the `globalSetup` hook naively tried
`spawnSync('npm', ['run', 'seed', '--prefix', 'functions'], { shell: false })`,
it would fail the exact same silent-ish way class 1 above did (a rejected
promise inside `globalSetup` does surface as a hard Playwright error here,
so this one at least fails loudly — but still: it fails).
**Mitigation:** `functions/package.json`'s `"seed"` script is exactly
`"node scripts/seed.js"` — nothing npm-specific about it. `globalSetup`
calls `spawnSync('node', ['functions/scripts/seed.js'], { shell: false })`
directly, achieving the identical outcome CLAUDE.md §5 describes ("seeds it
— `npm run seed`") without going through the `npm` binary at all. Verified
this exact shape (`spawnSync('node', [scriptPath], { shell: false })`) runs
cleanly, no shell involved, exit 0.

**4. `functions/scripts/seed.js` resolves its one file read
(`.firebaserc`) via `path.join(__dirname, '..', '..', '.firebaserc')`
(`functions/scripts/seed.js:696`), not `process.cwd()`.** Confirmed by
reading the file. So invoking it via `node functions/scripts/seed.js` from
the repo root (as `globalSetup` does) is safe regardless of the caller's
working directory — no `cwd` override needed in the `spawnSync` call.

**5. The web app's dev server points at the emulators via
`VITE_USE_FIREBASE_EMULATORS` — but only reading it from
`web/.env.development` makes the band's emulator targeting circumstantial,
not self-contained (correction from review).** `web/src/lib/firebase.js`
connects to the emulators when
`import.meta.env.VITE_USE_FIREBASE_EMULATORS === 'true'` (confirmed at
`web/src/lib/firebase.js:52,58-60`, ports 9099/8080/9199, matching
`firebase.json`). `vite` defaults to `--mode development`, which loads
`web/.env.development` automatically, and that file happens to set the
flag today — but "happens to" is exactly the failure mode CLAUDE.md §7
already names for the Storage bucket (`getStorage().bucket()` with no
argument resolving an ambient default instead of an explicit one): if
`web/.env.development` is ever edited — or a differently-scoped `.env`
shadows it — the band would silently start `webServer` against PRODUCTION,
with `globalSetup` seeding demo data into it. **Task 3 Step 2 therefore
sets `VITE_USE_FIREBASE_EMULATORS: 'true'` explicitly in
`webServer.env`**, so the band's own definition — not an ambient file —
is what decides it points at the emulators.

**6. Route and DOM target for the smoke test.** The route is `/login`
(`web/src/routes/index.jsx:37`). `LoginPage`
(`web/src/features/auth/pages/LoginPage.jsx:76,86`) renders
`<Input id="email">` and `<Input id="password">` — stable, i18n-independent
selectors (`#email`, `#password`), unlike asserting on translated button
text.

**7. `firebase` CLI is a global tool (`v15.25.1`), not a project
dependency** (not listed in any `package.json` in this repo; resolves via
the global npm bin). The rules and functions bands already depend on this
silently — this sub-stage doesn't introduce a new machine precondition, it
just becomes the third band to rely on it.

---

## Every point where the chain could fail on Windows (as required)

1. **Compound `emulators:exec` argument → silent no-op, exit 0.** Design
   avoids it entirely (finding #1/#2). If a future edit to `test:e2e`
   reintroduces a `&&` inside the quoted argument, it will silently stop
   testing anything while still reporting success — the single highest-risk
   regression for this band, worth a one-line comment in `package.json`
   pointing back at this plan.
2. **`spawnSync('npm', ...)` → `ENOENT`.** Design avoids it (finding #3) by
   calling `node` directly for seeding.
3. **Port conflicts.** The band needs 9099 (Auth), 8080 (Firestore), 9199
   (Storage), 5001 (Functions) — all via `emulators:exec` — **and** 5173
   (Vite, via Playwright's `webServer`). It cannot run while `npm run
dev:all` is up (8080 **and now 5173** both collide), and not while the
   rules or functions bands are running (8080 collision via their own
   `emulators:exec`). This is the three-way conflict CLAUDE.md §5 already
   documents; nothing new to write there, just confirming the
   implementation doesn't violate it.
4. **`reuseExistingServer: false` is hardcoded, not `!process.env.CI`.**
   If port 5173 is already bound by _anything_ (a leftover process from a
   crashed prior run, an unrelated dev server), Playwright's `webServer`
   fails fast with a clear "port in use" error rather than silently reusing
   whatever is there. This is intentional — self-containment means never
   trusting an already-running server — but it means a crashed prior run
   can leave the port stuck, requiring a manual kill before the next
   `npm run test:e2e`. Not solved here (no auto-kill logic — out of scope,
   and CLAUDE.md's "no format validation unless required" minimalism
   applies by analogy: don't build recovery machinery nothing has asked
   for yet).
5. **First-run browser download.** `npx playwright install chromium`
   downloads roughly 100–300 MB, once, network-dependent, and is a
   one-time local-machine step — not part of `test:e2e` itself and not
   repeated on every run (Playwright caches the browser at the OS level,
   outside the repo — see Task 1). Antivirus/Defender can slow this first
   run; not a functional failure, just a slow one.
6. **Missing global `firebase` CLI on a fresh machine.** Pre-existing
   condition, shared with the rules/functions bands (finding #7) — not a
   new risk this sub-stage introduces, but worth naming since the task
   description asked for every failure point in this specific chain.

None of these required relaxing CLAUDE.md §5's definition — the self-contained,
no-`dev:all` composition holds. If any of them had, this plan would stop
here and report it instead of shipping a quieter version of the contract.

---

## Commit type decision: `build:`

Conventional Commits defines `build:` as changes to the build system or
external dependencies, and `feat:` as a new capability for the product's
users. This sub-stage adds one external dependency (`@playwright/test`),
one config file, one npm script, and touches `.gitignore` for build
artifacts — it changes nothing about what the admin or tenant can do in the
app. `test:` (also in CLAUDE.md §6's type list) was a real candidate too —
the smoke test itself is a test — but it undersells the dependency/config
wiring, which is most of this change's actual content. **`build:`** is the
better fit of the two the task named, and the more accurate of all three on
strict Conventional Commits grounds.

---

### Task 1: `.gitignore` — cover Playwright's artifacts before installing anything

**Files:**

- Modify: `.gitignore` (insert after the existing "Build" section, currently `.gitignore:17-19`)

**Interfaces:**

- Consumes: none.
- Produces: the ignore patterns Task 2's install step relies on being in
  place first.

- [ ] **Step 1: Confirm the anchor**

Run: `grep -n "^# Build" .gitignore`
Expected: `.gitignore:17:# Build`.

- [ ] **Step 2: Insert the new section right after the Build section (after `.gitignore:19`, before the blank line/`# OS` section)**

Insert:

```
# E2E (Playwright) — browsers install to the OS-level cache by default,
# never inside this repo; only these in-repo artifact dirs need ignoring.
test-results/
playwright-report/
```

- [ ] **Step 3: Verify the patterns actually match, before relying on them**

Run:

```
mkdir test-results playwright-report
git check-ignore -v test-results playwright-report
rmdir test-results playwright-report
```

Expected: both print a match against the new `.gitignore` lines (confirms
the patterns work before `npx playwright install` ever runs — per the task
description's explicit ordering requirement). Directories removed after
the check so nothing untracked lingers.

- [ ] **Step 4: Note what does NOT need a gitignore entry, and why**

Browser binaries (Chromium) install to the OS-level cache
(`%LOCALAPPDATA%\ms-playwright` on Windows) by default — outside the repo
entirely, so no `.gitignore` pattern can or should target them. This
sub-stage deliberately does **not** set `PLAYWRIGHT_BROWSERS_PATH=0`
(which would force them into `node_modules/playwright-core/.local-browsers`
inside the repo) anywhere — not in `playwright.config.js`, not in the
`test:e2e` script, not in a `.env` file. If a later session is tempted to
set it (e.g. to make CI caching easier), it must add a `.gitignore` entry
first — this is the same "verify before install" discipline, not a one-time
check.

---

### Task 2: install `@playwright/test` at the root, Chromium only

**Files:**

- Modify: `package.json` (root) — new `devDependencies` entry
- Modify: `package-lock.json` (root) — regenerated by `npm install`

**Interfaces:**

- Consumes: Task 1's `.gitignore` entries (must exist first).
- Produces: the `@playwright/test` package Task 3's config/test files import.

- [ ] **Step 1: Install the package (root only)**

Run (from repo root, NOT `web/`):

```
npm install --save-dev @playwright/test
```

Expected: `package.json`'s root `devDependencies` gains
`"@playwright/test": "^<version>"`; `package-lock.json` updates; nothing
changes under `web/package.json` or `functions/package.json`.

- [ ] **Step 2: Install the Chromium browser only**

Run:

```
npx playwright install chromium
```

No `--with-deps` (that flag targets Linux system packages; irrelevant and
unsupported here). Single browser only — this sub-stage's flows are
functional checks, not a cross-browser compatibility matrix, and SRS §2.7's
"don't add unjustified complexity" applies to browser count too.

- [ ] **Step 3: Confirm nothing landed in the repo**

Run: `git status --short`
Expected: only `package.json` and `package-lock.json` show as modified —
no new untracked directory appears (the browser went to the OS cache, per
Task 1 Step 4).

---

### Task 3: `playwright.config.js`, `e2e/global-setup.js`, `e2e/login.spec.js`

**Files:**

- Create: `playwright.config.js` (root)
- Create: `e2e/global-setup.js`
- Create: `e2e/login.spec.js`

**Interfaces:**

- Consumes: `@playwright/test` (Task 2); `functions/scripts/seed.js`
  (existing, unmodified — confirmed `__dirname`-relative, finding #4).
- Produces: the `npx playwright test` entry point Task 4's `test:e2e`
  script invokes.

- [ ] **Step 1: Write `e2e/global-setup.js`**

```js
import { spawnSync } from 'node:child_process'

// Invokes functions/scripts/seed.js directly (node, not `npm run seed`) -
// npm resolves to npm.cmd on Windows, which spawnSync can't launch without
// shell:true (verified; see plan finding #3). This duplicates the intent
// of functions/package.json's "seed" script rather than calling through
// it - same duplication discipline as the KYC schema (CLAUDE.md §7): if
// that script ever gains arguments, flags, or a pre/post hook, this call
// must be updated to match, or the two will silently drift apart.
export default function globalSetup() {
  const result = spawnSync('node', ['functions/scripts/seed.js'], {
    stdio: 'inherit',
    shell: false,
  })
  if (result.status !== 0) {
    throw new Error(`Seeding failed with exit code ${result.status}`)
  }
}
```

No `cwd` override: Playwright runs `globalSetup` with the process's own
cwd, which is the repo root when `npx playwright test` is invoked from
`emulators:exec` at the root (Task 4) — and `functions/scripts/seed.js`
resolves its own path needs via `__dirname`, not `cwd` (finding #4), so the
relative script path `functions/scripts/seed.js` is correct either way.
`shell: false` is explicit, not just the default — the whole point of this
file is to never touch a shell (finding #3).

- [ ] **Step 2: Write `playwright.config.js`**

```js
import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  // No fullyParallel: the six SRS §9 flows (next sub-stages) share one
  // seeded emulator dataset, not per-worker isolation - sequential (the
  // workers: 1 below) is the deliberate default, not a temporary value to
  // "fix" once more flows land. Revisit only if flows are made data-safe
  // for parallel runs.
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: 'list',
  globalSetup: './e2e/global-setup.js',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npm run dev --prefix web',
    url: 'http://localhost:5173',
    reuseExistingServer: false,
    timeout: 60_000,
    // Explicit, not inferred from web/.env.development: same rule as the
    // Storage bucket in CLAUDE.md §7 (reference it explicitly, never rely
    // on ambient context). If .env.development ever changes, this line -
    // not that file - is what keeps the band pointed at the emulators
    // instead of silently seeding demo data into production.
    env: { VITE_USE_FIREBASE_EMULATORS: 'true' },
  },
})
```

`reporter: 'list'` is Playwright's own built-in reporter — no extra
package (Global Constraints). `reuseExistingServer: false` is hardcoded,
not `!process.env.CI` — see "chain could fail" point 4. `workers: 1`
because there is exactly one test right now and no reason yet to reason
about parallel workers hitting the same seeded emulator data — revisit
when the six flows land. `fullyParallel` is dropped rather than left at
`true` alongside `workers: 1` — the two contradicted each other's intent
(review correction 3); the comment above states why sequential is the
actual design, not an oversight.

- [ ] **Step 3: Write the smoke test, `e2e/login.spec.js`**

```js
import { test, expect } from '@playwright/test'

test('the login page renders', async ({ page }) => {
  await page.goto('/login')
  await expect(page.locator('#email')).toBeVisible()
  await expect(page.locator('#password')).toBeVisible()
})
```

Selectors are the input `id`s (finding #6) — stable across the RO/EN i18n
switch, unlike matching translated button text.

---

### Task 4: wire `npm run test:e2e`, run it for real, verify the whole chain

**Files:**

- Modify: `package.json` (root, `scripts` block, currently `package.json:7-16`)

**Interfaces:**

- Consumes: Task 2's installed package, Task 3's config/test/setup files.
- Produces: the `npm run test:e2e` command CLAUDE.md §5 already names as
  the contract.

- [ ] **Step 1: Add the script**

Insert into `package.json`'s `"scripts"` block (after `"dev:all"`,
`package.json:15`):

```json
    "test:e2e": "firebase emulators:exec --only auth,firestore,storage,functions --project tenants-manager-2026 \"npx playwright test\""
```

One inner command, no `&&`, no second layer of nesting — the exact shape
verified safe in finding #2, matching the existing `test:rules` /
`test:emulator` bands' pattern.

- [ ] **Step 2: Confirm nothing else is holding the required ports**

No separate emulator dry-run is needed — Step 3 exercises the real thing.
Just confirm no leftover process from an earlier session:

Run (PowerShell): `Get-NetTCPConnection -LocalPort 8080,9099,9199,5001,5173 -ErrorAction SilentlyContinue`
Expected: no rows (nothing bound). If something is bound, stop it first
(most likely a still-running `dev:all` from an earlier session) rather than
letting Step 3 fail on a port collision that looks like a Playwright bug.

- [ ] **Step 3: Run the band for real**

Run: `npm run test:e2e`
Expected, in order: Firebase emulator startup logs → seed script output
(the same output `npm run seed` produces manually) → Vite dev server
startup log → Playwright's `list` reporter showing `1 passed` → emulator
shutdown logs → exit code 0. This is the first point in this sub-stage
where the actual chain — not a synthetic scratch test — is verified
end-to-end. If it fails, this is exactly the "STOP AND REPORT" case: fix
forward only within the CLAUDE.md §5 contract (self-contained, no `dev:all`
dependency); if nothing within that contract works, stop and report the
specific failure rather than loosening the contract to match what runs.

- [ ] **Step 4: Run it a second time immediately**

Run: `npm run test:e2e` again, right after Step 3.
Expected: identical result (`1 passed`, clean teardown). This checks
idempotency — the seed script is documented as idempotent
(`functions/scripts/seed.js`'s own header, read during investigation), and
a self-contained band that only passes once (e.g. because teardown left a
port or a file lock behind) is not actually self-contained.

- [ ] **Step 5: Confirm repo cleanliness after two full runs**

Run: `git status --short`
Expected: only the intentional files from Tasks 1–4 show modified/new
(`.gitignore`, `package.json`, `package-lock.json`,
`playwright.config.js`, `e2e/global-setup.js`, `e2e/login.spec.js`, and
this plan file) — no `test-results/`, no `playwright-report/`, no stray
emulator export directories (`firebase-export-*/`, already covered by the
existing `.gitignore`).

- [ ] **Step 6: Commit (one commit — code, config, and this plan file together)**

```bash
git add .gitignore package.json package-lock.json playwright.config.js e2e/global-setup.js e2e/login.spec.js docs/superpowers/plans/2026-08-12-m7-substage2-playwright-install.md
git commit -m "$(cat <<'EOF'
build: install and wire Playwright as the self-contained E2E band

npm run test:e2e (root) now matches CLAUDE.md §5's contract: firebase
emulators:exec starts Auth+Firestore+Storage+Functions, a globalSetup
hook seeds via node directly (npm's Windows .cmd shim breaks under
spawnSync with shell:false - verified), then Playwright's own webServer
boots the app and runs the suite. One smoke test only (/login renders);
the six SRS §9 flows are separate sub-stages.
EOF
)"
```

Confirmed via `git log --all --format="%B" | grep §` before writing this
plan: `§` already appears freely in both subjects and bodies across this
repo's history (e.g. `c5f08f7`, `2942ab6`) — no encoding constraint, so the
commit message above uses it directly rather than the `S` substitute from
the previous sub-stage's draft.

---

## Self-review (completed while writing this plan)

**Spec coverage** — every clause of CLAUDE.md §5's E2E band text maps to a
task: `emulators:exec` starts all four emulators (Task 4 Step 1's `--only`
list); seeding as part of the definition, not a precondition (Task 3 Step
1's `globalSetup`); Playwright's own `webServer` boots the app (Task 3 Step
2); teardown on exit (native to both `emulators:exec` and Playwright's
`webServer` — no extra code needed); self-contained, not dependent on
`dev:all` (Task 4 Step 2 explicitly checks no leftover server); root-level
command, not `--prefix web` (Task 2 Step 1, Task 4 Step 1). The six SRS §9
flows are explicitly out of scope (task description's own constraint) and
not claimed anywhere in this plan.

**Placeholder scan** — no TBD/TODO; every step has literal file content or
a literal command, not a description of one.

**Review corrections applied** — `webServer.env` now sets
`VITE_USE_FIREBASE_EMULATORS` explicitly rather than relying on
`web/.env.development` (finding #5, Task 3 Step 2); `global-setup.js`
documents the direct-`node`-call duplication against
`functions/package.json`'s `seed` script (Task 3 Step 1); `fullyParallel`
is dropped and `workers: 1` is explained as a deliberate, standing choice
rather than a temporary value (Task 3 Step 2).

**Consistency** — `npm run test:e2e` (no `--prefix web`), the four-emulator
`--only` list, `functions/scripts/seed.js`'s exact path, and
`http://localhost:5173` all appear identically everywhere they're used
across Tasks 3 and 4.
