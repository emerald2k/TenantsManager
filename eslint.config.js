import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import prettier from 'eslint-config-prettier'

/**
 * A single ESLint config for the whole monorepo (flat config).
 * Each block applies only to the files in `files`, because web/ runs in the
 * browser (React), while functions/ runs in Node (CommonJS).
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

  // web/ — React in the browser
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
      // Unused variables are errors, except those deliberately written in
      // uppercase or prefixed with _ (e.g. ignored parameters).
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]' }],
    },
  },

  // functions/ — Cloud Functions in Node (CommonJS)
  {
    files: ['functions/**/*.js'],
    ...js.configs.recommended,
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: globals.node,
    },
  },

  // The tests — the Vitest globals (`globals: true` in the config) do not exist
  // in the `globals` package (it ships the `jest` set), so we declare them
  // explicitly, otherwise no-undef reports every one of them. They also get the
  // Node globals, because the rules band runs in Node (process, __dirname).
  // The block comes AFTER the one for web/, so it completes its globals.
  {
    files: ['web/tests/**/*.{js,jsx}'],
    languageOptions: {
      globals: {
        ...globals.node,
        describe: 'readonly',
        it: 'readonly',
        test: 'readonly',
        expect: 'readonly',
        vi: 'readonly',
        beforeAll: 'readonly',
        afterAll: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
      },
    },
  },

  // The config files (root + vite) — they run in Node at build time, not in the
  // browser, so they need the Node globals (e.g. __dirname).
  // The block comes AFTER the one for web/, so it overrides the browser globals.
  {
    files: [
      '*.config.js',
      'eslint.config.js',
      'web/vite.config.js',
      'web/vitest.config.js',
      'web/vitest.rules.config.js',
    ],
    ...js.configs.recommended,
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: globals.node,
    },
  },

  // LAST: disables the stylistic ESLint rules that would clash with Prettier.
  prettier,
]
