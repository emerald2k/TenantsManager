# TenantsManager

## Description

Web platform for tenant management, for an administrator who rents out properties
(5–20 units). The admin keeps track of properties and services, does KYC onboarding
for tenants, issues monthly payment reports and follows up on payments; the tenant
has their own portal where they see their contract, the signed reports and the
invoices. It replaces paper/Excel bookkeeping with a single digital flow, bilingual
(RO/EN).

> **The complete specification** (functional requirements FR-xxx, non-functional
> NFR-xxx, data model, page-by-page UI, architecture, milestones) is in
> [`SRS.md`](./SRS.md). This README covers only _how to start the project locally_.
> The SRS is the source of truth for _what it does_.

---

## Technical stack

| Area                     | Technology                                                                          |
| ------------------------ | ----------------------------------------------------------------------------------- |
| **Frontend**             | JavaScript (not TypeScript), Vite 8 + React 19 (SPA), React Router 7                |
| **UI**                   | Tailwind CSS 4 + shadcn/ui (Radix UI), Geist font                                   |
| **Forms**                | React Hook Form + Zod                                                               |
| **i18n**                 | react-i18next (RO/EN)                                                               |
| **Backend (BaaS)**       | Firebase — Firestore, Authentication, Storage, Cloud Functions (Node.js 22 runtime) |
| **Code quality tooling** | ESLint 9, Prettier 3, Husky + lint-staged, commitlint, .editorconfig                |

Development (milestones M0–M6) runs **entirely on the Firebase Emulator Suite** —
no card, no cloud, no costs. Moving to the Blaze plan + a real deploy comes only
at M7.

---

## Prerequisites

Check each tool before installing. In parentheses, the expected version.

### Node.js 22 LTS

```bash
node --version   # expected: v22.x
```

**Why exactly 22:** Cloud Functions run on the `nodejs22` runtime (see
`firebase.json` → `functions.runtime` and `functions/package.json` → `engines.node`).
Keeping the local Node aligned with the production runtime avoids the class of bugs
"works locally, breaks when deployed" caused by API differences between Node versions.

Installation: the official installer from [nodejs.org](https://nodejs.org) — direct
installation, the approach used in this project. Optionally, if you need to switch
between several Node versions on the same machine, you can use a version manager
such as [nvm-windows](https://github.com/coreybutler/nvm-windows); it is not
required for the project.

### Java 21+ (JDK)

```bash
java -version    # expected: openjdk version "21" or newer
```

**Why it is needed:** the **Firestore** emulator is a Java application (it runs on
the JVM). Without a JDK installed, `firebase emulators:start` starts
Auth/Storage/Functions but fails on Firestore. The other emulators do not need Java.

Recommended distribution: **Eclipse Temurin (Adoptium)** — a free OpenJDK build,
without licensing complications — from [adoptium.net](https://adoptium.net).
Any JDK 21 LTS or newer works; the project is tested with **Temurin 25**.

### Firebase CLI

```bash
firebase --version   # expected: 15.x or newer
```

Global installation through npm (it is not a local dependency of the project):

```bash
npm install -g firebase-tools
```

**Authentication** (once per machine — required even for the emulators):

```bash
firebase login
```

### Git

```bash
git --version
```

### Google account

Required for `firebase login` and, later (M7), for access to the Firebase Console
of the `tenants-manager-2026` project. For local development on emulators you do
**not** need access to the real cloud project.

---

## Step-by-step installation

### 1. Clone the repo

```bash
git clone <repo-url> TenantsManager
cd TenantsManager
```

### 2. Install the dependencies

A monorepo with three `package.json` files (root for tooling, `web/` for the
frontend, `functions/` for Cloud Functions). Install all three:

```bash
npm install                 # root — ESLint, Prettier, Husky, commitlint
npm install --prefix web    # frontend
npm install --prefix functions   # Cloud Functions + Admin SDK
```

`npm install` from the root also activates the Husky hooks (through the `prepare`
script), so from now on every commit automatically runs lint + format.

### 3. Configure `.env`

The frontend reads the Firebase configuration exclusively from environment
variables (the keys are never hardcoded in the code). Start from the template
committed in git:

```bash
cp web/.env.example web/.env
```

For **development on emulators the default values from the template are enough** —
you do not need to change anything. Only these matter:

- `VITE_USE_FIREBASE_EMULATORS=true` — connects the application to the emulators,
  not to the cloud.
- `VITE_FIREBASE_PROJECT_ID=tenants-manager-2026` — must be identical to `default`
  in `.firebaserc`.

The other keys (`API_KEY`, `APP_ID` etc.) can stay fictitious for the emulator.
Security note: the client Firebase keys **are not secrets** — they end up in the
public bundle anyway and only identify the project. The real security sits in the
Security Rules and custom claims. `web/.env` is in `.gitignore` and is not committed.

---

## Running locally

You need **two terminals**: one for the emulators, one for the dev server.

### Terminal 1 — the Firebase emulators

From the project **root** (where `firebase.json` is):

```bash
firebase emulators:start
```

They start on the ports from `firebase.json`:

| Emulator                    | Port     |
| --------------------------- | -------- |
| Emulator UI (control panel) | **4000** |
| Authentication              | 9099     |
| Firestore                   | 8080     |
| Functions                   | 5001     |
| Storage                     | 9199     |

**Verify** by opening the Emulator UI: <http://127.0.0.1:4000>. If the panel with
Auth / Firestore / Storage / Functions loads, everything is up.

> The emulators run **without disk persistence** in the current configuration:
> on shutdown, the accounts and the data are lost. For repeated testing, leave
> them running; for persistence between sessions the `--export-on-exit` /
> `--import` flags can be added (not configured by default).

### Terminal 2 — the frontend dev server

```bash
npm run dev --prefix web
```

The application starts on <http://localhost:5173>.

**The order:** start the emulators **first** (or in parallel). The application
connects to Auth/Firestore on load; if the emulators are not up, authentication
fails. The dev server can be started at any time — Vite does hot-reload — but
login only works with the emulators active.

---

## Creating the administrator account

There is no self-service registration: the admin account is created once, manually.
The steps (identical to the ones used when validating authentication):

### 1. Create the user in the Auth emulator

1. Open the Emulator UI → **Authentication**: <http://127.0.0.1:4000/auth>
2. **Add user** → fill in an email (e.g. `admin@test.ro`) and a password
   (minimum 6 characters, e.g. `parola123`). The other fields can stay empty.

### 2. Grant it the admin role (custom claim)

The administrator role comes **exclusively** from an `admin: true` custom claim in
the token — not from a field in the database (the `users` collection is strictly
admin-only, so a tenant could not even read their own role). Run the setup script
from the `functions/` folder, with the emulators running:

```bash
cd functions
npm run set-admin -- admin@test.ro
```

Expected:

```
✅ Custom claim "admin: true" set on admin@test.ro (uid: ...)
```

The script targets the emulator by default (it sets `FIREBASE_AUTH_EMULATOR_HOST`
itself), so it does not touch the cloud.

### 3. Verify

Two ways:

- **In the Emulator UI** → Authentication → the user's row → the **Custom claims**
  column must show `{"admin":true}`.
- **In the application**: log in at <http://localhost:5173> with the admin account →
  you must land on `/admin`. Landing on the admin dashboard is possible _only_ if
  the claim actually reached the token.

> **Watch the timing:** the claim enters the user's token only when the token is
> refreshed. If you were already logged in when you ran the script, log out and
> log in again.

An account without this claim is automatically treated as a **tenant** (it lands
on `/app`).

---

## Project structure

```
TenantsManager/
├── web/                      # Vite + React frontend (SPA)
│   ├── src/
│   │   ├── components/       # ui/ (shadcn) + shared/ (common components)
│   │   ├── features/         # code by domain: auth/, (properties/, tenants/… at M1+)
│   │   ├── lib/              # firebase.js, i18n/ (ro.json, en.json), utils
│   │   ├── routes/           # route definitions + role guards
│   │   ├── App.jsx           # provider composition
│   │   └── main.jsx          # entry point
│   └── .env.example          # config template (copied to .env)
├── functions/                # Cloud Functions (Firebase)
│   ├── index.js              # the functions (populated from M2)
│   └── scripts/
│       └── setAdminClaim.js  # setup script: grants the admin role
├── firebase.json             # emulator config + functions runtime + rules
├── .firebaserc               # the Firebase project id (tenants-manager-2026)
├── firestore.rules           # Firestore Security Rules
├── storage.rules             # Storage Security Rules
├── firestore.indexes.json    # Firestore indexes
├── eslint.config.js          # ESLint rules (flat config)
├── commitlint.config.js      # Conventional Commits rules
├── package.json              # code quality tooling (shared web/ + functions/)
├── CLAUDE.md                 # working guide for the AI assistant
└── SRS.md                    # the complete specification (the source of truth)
```

---

## Code quality tooling

The code follows a fixed set of rules, applied automatically on commit:

- **ESLint** — static analysis (errors, React anti-patterns).
- **Prettier** — consistent formatting.
- **Husky + lint-staged** — on every `git commit`, a `pre-commit` hook runs ESLint
  (`--fix`) and Prettier **only on the staged files**. A commit with lint errors is
  blocked.
- **commitlint** — a `commit-msg` hook enforces the
  [Conventional Commits](https://www.conventionalcommits.org) format
  (`feat:`, `fix:`, `docs:`, `chore:`, `test:`, `refactor:`…).

Manual commands (from the root):

```bash
npm run lint          # checks the whole repo
npm run lint:fix      # checks and automatically fixes what it can
npm run format        # formats everything with Prettier
npm run format:check  # checks the formatting without modifying
```

---

## Tests

The test suite runs in **two separate bands**, because they need different things:

```bash
npm run test:run --prefix web    # fast band — jsdom, no emulator
npm run test:rules --prefix web  # rules band — against the Firestore emulator
```

- **Fast band** (`vitest.config.js`): components and hooks in jsdom, with the
  boundary to the backend mocked. It touches no emulator, so it is quick and runs
  anywhere. This is where the bulk of the tests live.
- **Rules band** (`vitest.rules.config.js`): checks `firestore.rules` for real,
  against the Firestore emulator, through `@firebase/rules-unit-testing`. It runs
  in Node, not jsdom.

`test:rules` starts **its own** Firestore emulator (`firebase emulators:exec`) and
shuts it down at the end — so **port 8080 must be free**. If you already have
`firebase emulators:start` running in another terminal, stop it first or the
command fails on a port conflict.

The testing foundation lands at M1 and from there on every feature comes with its
own tests (see SRS §9).

---

## Recovering administrator access

The project has a **single administrator** and there is no self-service password
reset flow — an assumed risk, mitigated through recovery from the Firebase Console
(see SRS §2.8).

- **In production (M7+):** if the admin loses their password, they reset it from the
  [Firebase Console](https://console.firebase.google.com) → Authentication → the
  respective user → **Reset password**. The admin has access to the Console as the
  owner of the project.
- **Locally (emulator):** the accounts do not have a "real" recoverable password —
  simply recreate the account from the Emulator UI and re-run `npm run set-admin`.
