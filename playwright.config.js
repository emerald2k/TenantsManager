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
