import path from 'node:path'
import { defineConfig, configDefaults } from 'vitest/config'
import react from '@vitejs/plugin-react'

// The FAST test band: components/hooks in jsdom, with the boundary to the backend
// mocked (it does not touch the emulator). This is where the bulk of the tests sit.
// The RULES band (Firestore, on the emulator) runs separately through
// vitest.rules.config.js; we exclude it here on the `*.rules.test.js` pattern so
// that the two bands do not overlap.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.js'],
    exclude: [...configDefaults.exclude, 'tests/**/*.rules.test.js'],
    // Vitest runs in mode 'test', which has no `.env.test` file of its own —
    // `.env*` is gitignored on purpose (real prod/dev config), and Vite only
    // loads `.env.[mode]` for the CURRENT mode, never `.env.development` or
    // `.env.production` here. Without these, any test file that does NOT mock
    // `@/lib/firebase` throws at import ("Incomplete Firebase configuration")
    // the moment it's touched — these are fictitious values, committed here
    // (not a real .env file) precisely so the suite runs anywhere without
    // manual setup. Do NOT delete this thinking it's leftover — it is load-
    // bearing for every test that imports the real firebase.js.
    env: {
      VITE_USE_FIREBASE_EMULATORS: 'false',
      VITE_FIREBASE_PROJECT_ID: 'tenants-manager-2026',
      VITE_FIREBASE_API_KEY: 'demo-api-key',
      VITE_FIREBASE_AUTH_DOMAIN: 'tenants-manager-2026.firebaseapp.com',
      // MUST match functions/src/kyc.js's STORAGE_BUCKET fallback exactly
      // (CLAUDE.md §7 — the bucket name is referenced explicitly and
      // identically everywhere, never inferred).
      VITE_FIREBASE_STORAGE_BUCKET: 'tenants-manager-2026.firebasestorage.app',
      VITE_FIREBASE_MESSAGING_SENDER_ID: '000000000000',
      VITE_FIREBASE_APP_ID: '1:000000000000:web:0000000000000000000000',
    },
  },
})
