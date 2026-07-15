# TenantsManager

Platformă web de gestionare a chiriașilor pentru un administrator care închiriază
proprietăți (5–20 unități). Adminul ține evidența proprietăților și serviciilor,
face onboarding KYC pentru chiriași, emite rapoarte lunare de plată și urmărește
plățile; chiriașul are un portal propriu unde își vede contractul, rapoartele
semnate și facturile. Rezolvă înlocuirea evidenței pe hârtie/Excel cu un flux
digital unic, bilingv (RO/EN).

> **Specificația completă** (cerințe funcționale FR-xxx, non-funcționale NFR-xxx,
> model de date, UI pagină-cu-pagină, arhitectură, milestone-uri) se află în
> [`SRS-platforma-chiriasi.md`](./SRS-platforma-chiriasi.md). Acest README acoperă
> doar _cum pornești proiectul local_. SRS-ul este sursa de adevăr pentru _ce face_.

---

## Stack tehnic

| Zonă                     | Tehnologie                                                                          |
| ------------------------ | ----------------------------------------------------------------------------------- |
| **Frontend**             | JavaScript (nu TypeScript), Vite 8 + React 19 (SPA), React Router 7                 |
| **UI**                   | Tailwind CSS 4 + shadcn/ui (Radix UI), font Geist                                   |
| **Formulare**            | React Hook Form + Zod                                                               |
| **i18n**                 | react-i18next (RO/EN)                                                               |
| **Backend (BaaS)**       | Firebase — Firestore, Authentication, Storage, Cloud Functions (runtime Node.js 22) |
| **Tooling calitate cod** | ESLint 9, Prettier 3, Husky + lint-staged, commitlint, .editorconfig                |

Dezvoltarea (milestone-urile M0–M6) rulează **integral pe Firebase Emulator Suite**
— fără card, fără cloud, fără costuri. Trecerea pe plan Blaze + deploy real vine
abia la M7.

---

## Cerințe preliminare

Verifică fiecare instrument înainte de instalare. În paranteză, versiunea așteptată.

### Node.js 22 LTS

```bash
node --version   # așteptat: v22.x
```

**De ce exact 22:** Cloud Functions rulează pe runtime-ul `nodejs22` (vezi
`firebase.json` → `functions.runtime` și `functions/package.json` → `engines.node`).
Ținând Node-ul local aliniat cu runtime-ul de producție eviți clasa de bug-uri
„merge local, crapă deployat" cauzate de diferențe de API între versiuni de Node.

Instalare recomandată: [nvm-windows](https://github.com/coreybutler/nvm-windows)
sau installer-ul oficial de pe [nodejs.org](https://nodejs.org).

### Java 21+ (JDK)

```bash
java -version    # așteptat: openjdk version "21" sau mai nou
```

**De ce e necesar:** emulatorul **Firestore** este o aplicație Java (rulează pe
JVM). Fără un JDK instalat, `firebase emulators:start` pornește Auth/Storage/Functions
dar eșuează la Firestore. Restul emulatoarelor nu au nevoie de Java.

Distribuție recomandată: **Eclipse Temurin (Adoptium)** — build OpenJDK gratuit,
fără complicații de licențiere — de pe [adoptium.net](https://adoptium.net).
Orice JDK 21 LTS sau mai nou funcționează.

### Firebase CLI

```bash
firebase --version   # așteptat: 13.x sau mai nou
```

Instalare globală prin npm (nu e dependință locală a proiectului):

```bash
npm install -g firebase-tools
```

**Autentificare** (o singură dată per mașină — necesară chiar și pentru emulatoare):

```bash
firebase login
```

### Git

```bash
git --version
```

### Cont Google

Necesar pentru `firebase login` și, ulterior (M7), pentru accesul la Firebase
Console al proiectului `tenants-manager-2026`. Pentru dezvoltarea locală pe
emulatoare **nu** ai nevoie de acces la proiectul cloud real.

---

## Instalare pas cu pas

### 1. Clonează repo-ul

```bash
git clone <url-repo> TenantsManager
cd TenantsManager
```

### 2. Instalează dependențele

Monorepo cu trei `package.json` (rădăcină pentru tooling, `web/` pentru frontend,
`functions/` pentru Cloud Functions). Instalează-le pe toate trei:

```bash
npm install                 # rădăcină — ESLint, Prettier, Husky, commitlint
npm install --prefix web    # frontend
npm install --prefix functions   # Cloud Functions + Admin SDK
```

`npm install` din rădăcină activează și hook-urile Husky (prin scriptul `prepare`),
deci de-acum fiecare commit rulează automat lint + format.

### 3. Configurează `.env`

Frontend-ul citește configurația Firebase exclusiv din variabile de mediu
(cheile nu se hardcodează niciodată în cod). Pornește de la șablonul comis în git:

```bash
cp web/.env.example web/.env
```

Pentru **dezvoltare pe emulatoare valorile implicite din șablon sunt suficiente** —
nu trebuie să schimbi nimic. Contează doar:

- `VITE_USE_FIREBASE_EMULATORS=true` — conectează aplicația la emulatoare, nu la cloud.
- `VITE_FIREBASE_PROJECT_ID=tenants-manager-2026` — trebuie să fie identic cu
  `default` din `.firebaserc`.

Restul cheilor (`API_KEY`, `APP_ID` etc.) pot rămâne fictive pentru emulator.
Notă de securitate: cheile Firebase de client **nu sunt secrete** — ajung oricum
în bundle-ul public și doar identifică proiectul. Securitatea reală stă în Security
Rules și custom claims. `web/.env` este în `.gitignore` și nu se comite.

---

## Rulare locală

Ai nevoie de **două terminale**: unul pentru emulatoare, unul pentru dev server.

### Terminal 1 — emulatoarele Firebase

Din **rădăcina** proiectului (acolo unde e `firebase.json`):

```bash
firebase emulators:start
```

Pornesc, pe porturile din `firebase.json`:

| Emulator                       | Port     |
| ------------------------------ | -------- |
| Emulator UI (panou de control) | **4000** |
| Authentication                 | 9099     |
| Firestore                      | 8080     |
| Functions                      | 5001     |
| Storage                        | 9199     |

**Verifică** deschizând Emulator UI: <http://127.0.0.1:4000>. Dacă se încarcă
panoul cu Auth / Firestore / Storage / Functions, totul e sus.

> Emulatoarele rulează **fără persistență pe disc** în configurația curentă:
> la oprire, conturile și datele se pierd. Pentru testare repetată, lasă-le
> pornite; pentru persistență între sesiuni se pot adăuga flagurile
> `--export-on-exit` / `--import` (nu e configurat implicit).

### Terminal 2 — dev server-ul frontend

```bash
npm run dev --prefix web
```

Aplicația pornește pe <http://localhost:5173>.

**Ordinea:** pornește emulatoarele **întâi** (sau în paralel). Aplicația se
conectează la Auth/Firestore la încărcare; dacă emulatoarele nu sunt sus,
autentificarea eșuează. Dev server-ul poate fi pornit oricând — Vite face
hot-reload — dar login-ul funcționează doar cu emulatoarele active.

---

## Crearea contului de administrator

Nu există înregistrare self-service: contul de admin se creează o singură dată,
manual. Pașii (identici cu cei folosiți la validarea autentificării):

### 1. Creează utilizatorul în emulatorul Auth

1. Deschide Emulator UI → **Authentication**: <http://127.0.0.1:4000/auth>
2. **Add user** → completează email (ex: `admin@test.ro`) și o parolă
   (minim 6 caractere, ex: `parola123`). Restul câmpurilor pot rămâne goale.

### 2. Acordă-i rolul de admin (custom claim)

Rolul de administrator vine **exclusiv** dintr-un custom claim `admin: true` din
token — nu dintr-un câmp în baza de date (colecția `users` e strict acces-admin,
deci un chiriaș nici nu și-ar putea citi rolul). Rulează scriptul de setup din
folderul `functions/`, cu emulatoarele pornite:

```bash
cd functions
npm run set-admin -- admin@test.ro
```

Așteptat:

```
✅ Custom claim "admin: true" setat pe admin@test.ro (uid: ...)
```

Scriptul țintește implicit emulatorul (setează singur `FIREBASE_AUTH_EMULATOR_HOST`),
deci nu atinge cloud-ul.

### 3. Verifică

Două căi:

- **În Emulator UI** → Authentication → rândul userului → coloana **Custom claims**
  trebuie să arate `{"admin":true}`.
- **În aplicație**: loghează-te la <http://localhost:5173> cu contul de admin →
  trebuie să aterizezi pe `/admin`. Aterizarea pe dashboard-ul de admin e posibilă
  _doar_ dacă claim-ul a ajuns efectiv în token.

> **Atenție la timing:** claim-ul intră în tokenul utilizatorului abia la
> reîmprospătarea acestuia. Dacă erai deja logat când ai rulat scriptul,
> fă delogare + login din nou.

Un cont fără acest claim este tratat automat drept **chiriaș** (aterizează pe `/app`).

---

## Structura proiectului

```
TenantsManager/
├── web/                      # Frontend Vite + React (SPA)
│   ├── src/
│   │   ├── components/       # ui/ (shadcn) + shared/ (componente comune)
│   │   ├── features/         # cod pe domenii: auth/, (properties/, tenants/… la M1+)
│   │   ├── lib/              # firebase.js, i18n/ (ro.json, en.json), utils
│   │   ├── routes/           # definițiile rutelor + guards pe rol
│   │   ├── App.jsx           # compoziția providerilor
│   │   └── main.jsx          # punctul de intrare
│   └── .env.example          # șablon config (se copiază în .env)
├── functions/                # Cloud Functions (Firebase)
│   ├── index.js              # funcțiile (se populează de la M2)
│   └── scripts/
│       └── setAdminClaim.js  # script de setup: acordă rolul de admin
├── firebase.json             # config emulatoare + runtime functions + rules
├── .firebaserc               # id-ul proiectului Firebase (tenants-manager-2026)
├── firestore.rules           # Security Rules Firestore
├── storage.rules             # Security Rules Storage
├── firestore.indexes.json    # indexuri Firestore
├── eslint.config.js          # reguli ESLint (flat config)
├── commitlint.config.js      # reguli Conventional Commits
├── package.json              # tooling calitate cod (comun web/ + functions/)
├── CLAUDE.md                 # ghid de lucru pentru asistentul AI
└── SRS-platforma-chiriasi.md # specificația completă (sursa de adevăr)
```

---

## Tooling de calitate cod

Codul respectă un set fix de reguli, aplicate automat la commit:

- **ESLint** — analiză statică (erori, anti-patternuri React).
- **Prettier** — formatare consistentă.
- **Husky + lint-staged** — la fiecare `git commit`, un hook `pre-commit` rulează
  ESLint (`--fix`) și Prettier **doar pe fișierele din stage**. Un commit cu erori
  de lint este blocat.
- **commitlint** — un hook `commit-msg` impune formatul
  [Conventional Commits](https://www.conventionalcommits.org)
  (`feat:`, `fix:`, `docs:`, `chore:`, `test:`, `refactor:`…).

Comenzi manuale (din rădăcină):

```bash
npm run lint          # verifică tot repo-ul
npm run lint:fix      # verifică și repară automat ce se poate
npm run format        # formatează tot cu Prettier
npm run format:check  # verifică formatarea fără să modifice
```

---

## Recuperarea accesului de administrator

Proiectul are un **singur administrator** și nu există flux self-service de
resetare a parolei — un risc asumat și mitigat prin recuperare din Firebase Console
(vezi SRS §2.8).

- **În producție (M7+):** dacă adminul își pierde parola, o resetează din
  [Firebase Console](https://console.firebase.google.com) → Authentication →
  utilizatorul respectiv → **Reset password**. Adminul are acces la Console în
  calitate de proprietar al proiectului.
- **Local (emulator):** conturile nu au parolă „reală" recuperabilă — pur și
  simplu recreează contul din Emulator UI și rerulează `npm run set-admin`.
