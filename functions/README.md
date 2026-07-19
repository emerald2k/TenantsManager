# functions — TenantsManager Cloud Functions

Cloud Functions (Firebase, Node.js 22, JavaScript). Runs on the **Firebase Emulator
Suite** in development (M0–M6) — no cloud, no costs; a real deploy only happens at M7
(see the root README).

## Structure

```
functions/
├── index.js                       # exports the callable/trigger functions
├── src/
│   ├── kyc.js                     # finalizeKyc (SRS §7.2)
│   ├── draftValidation.js         # server-side Zod validation of the KYC draft
│   └── mail-templates/
│       └── credentials.js         # Appendix A template A1 — access credentials email
├── test/
│   └── kyc.test.js                # finalizeKyc, against the Auth + Firestore emulators
├── scripts/
│   ├── setAdminClaim.js           # setup script: grants the admin role
│   └── seed.js                    # setup script: admin + demo data (emulator)
└── vitest.config.js
```

More functions are planned per SRS §7.2 as later milestones land
(`resetTenantPassword`, `setTenantAccountStatus`, `onReportWrite`,
`onPropertyUpdate`, `dailyScheduler`, `getSharedReport`) — only `finalizeKyc` exists
today.

## Commands

```bash
npm run set-admin -- <email>   # grants the admin custom claim to an existing account
npm run seed                   # writes deterministic demo data (admin + properties)
npm run test:emulator          # starts an emulator, runs the functions tests, shuts it down
npm test                       # runs the tests directly, no emulator started
```

- **`set-admin`** and **`seed`** are one-off setup scripts, run manually against a
  running emulator (see the root README, "Creating the administrator account").
- **`test:emulator`** is the one to use normally: it starts its own Auth + Firestore
  emulator (`firebase emulators:exec`), runs `test/kyc.test.js` against it, and shuts
  it down — so **port 8080 must be free**, exactly like `test:rules` in `web/`. If a
  dev emulator (`firebase emulators:start`) is already running in another terminal,
  stop it first or the command fails on a port conflict.
- **`test`** runs `vitest run` directly, with no emulator lifecycle — only useful if
  `FIRESTORE_EMULATOR_HOST` / `FIREBASE_AUTH_EMULATOR_HOST` are already set in your
  shell (e.g. a dev emulator is already running). Without them, the Admin SDK has
  nothing to connect to.

## Schema duplication

`draftValidation.js` intentionally mirrors
`web/src/features/onboarding/schema.js` — `functions/` deploys without `web/`, so a
cross-package import would break at deploy. See **CLAUDE.md §7** for the full
reasoning and the rule: on any change to the KYC fields or validation rules, update
both files.

## Setup, emulators, `.env`

Not covered here — see the root [`README.md`](../README.md) for prerequisites,
installing dependencies, starting the emulators, and configuring `.env`.
