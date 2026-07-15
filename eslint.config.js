import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import prettier from 'eslint-config-prettier'

/**
 * Config ESLint unic pentru tot monorepo-ul (flat config).
 * Fiecare bloc se aplică doar fișierelor din `files`, pentru că web/ rulează
 * în browser (React), iar functions/ rulează în Node (CommonJS).
 */
export default [
  {
    ignores: [
      '**/node_modules/**',
      'web/dist/**',
      'functions/lib/**',
      '.firebase/**',
    ],
  },

  // web/ — React în browser
  {
    files: ['web/**/*.{js,jsx}'],
    ...js.configs.recommended,
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: globals.browser,
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...js.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],
      // Variabilele nefolosite sunt erori, cu excepția celor scrise intenționat
      // cu majusculă sau prefixate cu _ (ex. parametri ignorați).
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]' }],
    },
  },

  // functions/ — Cloud Functions în Node (CommonJS)
  {
    files: ['functions/**/*.js'],
    ...js.configs.recommended,
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: globals.node,
    },
  },

  // Fișierele de configurare (rădăcină + vite) — rulează în Node la build,
  // nu în browser, deci au nevoie de globalele Node (ex. __dirname).
  // Blocul vine DUPĂ cel pentru web/, ca să suprascrie globalele de browser.
  {
    files: ['*.config.js', 'eslint.config.js', 'web/vite.config.js'],
    ...js.configs.recommended,
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: globals.node,
    },
  },

  // ULTIMUL: dezactivează regulile ESLint de stil care s-ar bate cu Prettier.
  prettier,
]
