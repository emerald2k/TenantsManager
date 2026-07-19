import { defineConfig } from 'vitest/config'

// Functions tests run in Node (no DOM) against the Auth + Firestore emulators. They
// are started through `npm run test:emulator` (firebase emulators:exec), which sets
// FIRESTORE_EMULATOR_HOST / FIREBASE_AUTH_EMULATOR_HOST + the project id for the
// Admin SDK. Run directly with vitest, they have nothing to connect to.
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['test/**/*.test.js'],
    // Each test seeds and clears shared emulator state; run files sequentially so
    // they do not race on the same collections.
    fileParallelism: false,
    testTimeout: 20000,
    hookTimeout: 30000,
  },
})
