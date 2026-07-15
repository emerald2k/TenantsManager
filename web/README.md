# web — frontend TenantsManager

SPA în **JavaScript** (nu TypeScript, vezi SRS §7), Vite + React + React Router,
Tailwind CSS + shadcn/ui, i18n RO/EN prin react-i18next.

## Comenzi

```bash
npm run dev      # server de dezvoltare (http://localhost:5173)
npm run build    # build de producție în dist/
npm run preview  # servește build-ul de producție local
```

## Calitate cod

Linting-ul și formatarea **nu** se configurează aici, ci în rădăcina monorepo-ului
(`../eslint.config.js`, `../.prettierrc.json`), fiindcă aceleași reguli acoperă și
`functions/`. Din rădăcină:

```bash
npm run lint     # ESLint pe tot monorepo-ul
npm run format   # Prettier pe tot monorepo-ul
```

La fiecare commit, Husky + lint-staged rulează automat ESLint și Prettier pe
fișierele aflate în stage.
