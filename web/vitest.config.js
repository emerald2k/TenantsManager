import path from 'node:path'
import { defineConfig, configDefaults } from 'vitest/config'
import react from '@vitejs/plugin-react'

// Banda RAPIDĂ de teste: componente/hook-uri în jsdom, cu granița spre backend
// mockată (nu atinge emulatorul). Aici stă grosul testelor de la sub-etapa B.
// Banda de REGULI (Firestore, pe emulator) rulează separat prin vitest.rules.config.js;
// o excludem aici pe tiparul `*.rules.test.js` ca cele două benzi să nu se suprapună.
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
