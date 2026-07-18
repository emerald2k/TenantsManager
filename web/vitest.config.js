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
  },
})
