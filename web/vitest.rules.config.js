import { defineConfig } from 'vitest/config'

// The RULES band: tests firestore.rules directly against the Firestore emulator,
// through @firebase/rules-unit-testing. It runs in Node (not jsdom) — there is no
// DOM here, hence no jest-dom setup from the fast band either. It includes ONLY
// `*.rules.test.js`, exactly the inverse of the exclusion in vitest.config.js: the
// two bands do not overlap.
//
// It is run through `npm run test:rules`, which starts the emulator first
// (firebase emulators:exec). Run directly with vitest, the tests have nothing to
// connect to.
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/**/*.rules.test.js'],
    // The rules files run ONE AFTER ANOTHER, not in parallel.
    // Reason: `initializeTestEnvironment` loads the rules into the emulator per
    // project, and the emulator is on singleProjectMode (firebase.json) — so all
    // files share the same projectId. In parallel, the file that loads second
    // overwrites the first one's rules and makes its tests fail spuriously.
    // Sequentially, each file loads its rules and cleans them up at the end.
    fileParallelism: false,
    // The first connection to the emulator + loading the rules sometimes exceed
    // Vitest's default 5s timeout.
    testTimeout: 15000,
    hookTimeout: 30000,
  },
})
