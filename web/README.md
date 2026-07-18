# web — TenantsManager frontend

SPA in **JavaScript** (not TypeScript, see SRS §7), Vite + React + React Router,
Tailwind CSS + shadcn/ui, RO/EN i18n through react-i18next.

## Commands

```bash
npm run dev      # development server (http://localhost:5173)
npm run build    # production build into dist/
npm run preview  # serves the production build locally
```

## Tests

Two bands, deliberately separate (see the root README for the reasoning):

```bash
npm test          # fast band, watch mode
npm run test:run  # fast band, one run
npm run test:rules # rules band, against the Firestore emulator
```

`test:rules` starts its own Firestore emulator (`firebase emulators:exec`), so
port 8080 must be free — if you already have a dev emulator running, it clashes.

## Code quality

Linting and formatting are **not** configured here, but in the monorepo root
(`../eslint.config.js`, `../.prettierrc.json`), because the same rules also cover
`functions/`. From the root:

```bash
npm run lint     # ESLint over the whole monorepo
npm run format   # Prettier over the whole monorepo
```

On every commit, Husky + lint-staged automatically run ESLint and Prettier on the
staged files.
