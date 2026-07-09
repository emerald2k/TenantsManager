# CLAUDE.md — Ghid de lucru pentru acest proiect

Acest fișier este citit automat de Claude Code la fiecare sesiune. Conține contextul și regulile de lucru pentru proiectul **TenantsManager** (platformă de gestionare chiriași).

---

## 1. Sursa de adevăr

**`SRS-platforma-chiriasi.md`** (în rădăcina proiectului) este **specificația completă și definitivă**. Este rezultatul unei faze extinse de planificare și conține: cerințe funcționale numerotate (FR-xxx), cerințe non-funcționale (NFR-xxx), model de date, specificație UI pagină cu pagină, arhitectură tehnică, plan de milestone-uri și template-uri de email.

**Reguli absolute:**
- Citește SRS-ul înainte de a genera orice cod. Este referința pentru fiecare decizie.
- **Nu improviza** funcționalități, câmpuri, reguli sau tehnologii care nu sunt în SRS. Dacă ceva pare neclar sau lipsește, **întreabă** — nu presupune.
- Când implementezi ceva, referențiază cerințele relevante (ex: „implementez FR-TEN-01…FR-TEN-24").
- Dacă apare o contradicție sau o scăpare în SRS, semnaleaz-o și cere clarificare înainte de a continua.

---

## 2. Mod de lucru: milestone cu milestone

Proiectul se construiește pe **milestone-uri** (secțiunea 9 din SRS: M0–M7). 

**Reguli:**
- Lucrează la **un singur milestone o dată**, în ordine (M0 întâi).
- **Nu trece la milestone-ul următor fără confirmarea explicită** a utilizatorului.
- La începutul fiecărui milestone: rezumă pe scurt ce vei face și ce cerințe FR/NFR acoperă.
- La finalul fiecărui milestone: verifică criteriul de „gata" definit în SRS și raportează starea.
- Preferă pași mici și verificabili în locul generării masive dintr-o dată. Utilizatorul învață pe parcurs — explică deciziile pe măsură ce le iei.

---

## 3. Stack tehnic (fix — vezi secțiunea 7 din SRS)

- **Frontend:** JavaScript (NU TypeScript), Vite + React (SPA), React Router
- **UI:** Tailwind CSS + shadcn/ui
- **Formulare:** React Hook Form + Zod
- **Data:** TanStack Query
- **Grafice:** Recharts (doar Faza 2)
- **Backend (BaaS):** Firebase — Firestore, Authentication, Storage, Cloud Functions, extensia „Trigger Email"
- **i18n:** react-i18next (RO/EN)
- **Teste:** Vitest + React Testing Library
- **Calitate cod:** ESLint, Prettier, Husky + lint-staged, commitlint, .editorconfig
- **Config:** variabile de mediu prin `.env` (Vite); cheile Firebase NU se hardcodează; `.env` în `.gitignore`
- **Structură:** monorepo — `web/` (frontend) și `functions/` (Cloud Functions) în foldere separate
- **Deploy:** manual, Firebase CLI

**Nu introduce** tehnologii în afara acestei liste fără a întreba (vezi „tooling evitat conștient" în SRS: fără TypeScript, Storybook, Docker, CI/CD automat, Sentry în MVP).

---

## 4. Dezvoltare locală

- Dezvoltarea (M0–M6) se face pe **Firebase Emulator Suite** (Auth, Firestore, Storage, Functions) + planul gratuit Spark. **Fără card, fără cloud, fără costuri.**
- Trecerea pe planul Blaze + deploy în producție se face abia la **M7**.
- Proiect Firebase: `tenants-manager-2026`.

---

## 5. Git & convenții

**Branching model:**
- `main` — mereu stabil și funcțional. Nu comite aici cod pe jumătate.
- `milestone/mX-nume` — un branch per milestone (ex: `milestone/m0-fundatie`). Se unește în `main` când milestone-ul e gata și verificat.

**Commits:** respectă **Conventional Commits** — `<tip>: <descriere imperativ, literă mică>`.
- Tipuri: `feat`, `fix`, `docs`, `chore`, `test`, `refactor`, `style`, `build`, `ci`.
- Exemple: `feat: add property list page`, `chore: configure eslint and prettier`, `docs: update SRS`.
- Commit-uri mici și frecvente, fiecare cu un scop clar.

---

## 6. Principii de calitate

- **Cod curat de la prima linie:** tot codul respectă regulile ESLint/Prettier configurate în M0.
- **Securitate:** datele KYC (CNP, poze acte, date financiare, garant) sunt STRICT acces-admin (vezi NFR-SEC-01…09 și modelul de date din SRS §6). Chiriașul accesează doar date denormalizate în `tenancies` și propriile `monthlyReports` publicate. Verifică Security Rules la fiecare funcționalitate care atinge date sensibile.
- **Fără validare de format** pe câmpuri (NFR-VAL-01): câmpurile sunt obligatorii doar ca prezență, fără verificare de format (CNP, telefon etc. acceptă orice). Nu adăuga validări de format decât dacă SRS le cere explicit.
- **Localizare:** tot textul vizibil trece prin i18n (RO/EN) de la început, nu hardcodat.
- **Explică deciziile:** utilizatorul învață. Când iei o decizie de implementare non-trivială, explică pe scurt raționamentul.

---

## 7. Când să te oprești și să întrebi

Oprește-te și cere clarificare dacă:
- O cerință din SRS pare ambiguă, contradictorie sau lipsă.
- Ai nevoie de o tehnologie sau un pattern care nu e în stack.
- O decizie ar afecta modelul de date, securitatea sau un flux deja definit.
- Ești pe cale să treci la milestone-ul următor.

Mai bine o întrebare în plus decât o presupunere greșită. Principiul proiectului: **măsoară de zece ori, taie o dată.**
