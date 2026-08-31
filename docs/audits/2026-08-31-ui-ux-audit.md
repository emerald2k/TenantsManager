# Audit UI/UX — sesiune de capturi, 31 august 2026

**Context.** Parcurgere completă a aplicației pe emulatoare locale
(`localhost:5173`, seed rulat), cu contul `admin@test.ro` și cu chiriașul
`chirias@test.ro` (Andrei Ionescu, `seed-tenant` / `seed-tenancy-occupied`,
istoric 2025–2026). Scopul principal a fost realizarea unei prezentări cu
capturi de ecran (`TenantsManager-Prezentare.pdf`, 25 pagini); problemele de mai
jos au ieșit la iveală pe parcurs și sunt propuse pentru următoarea fază de
development.

Nimic din ce urmează nu a fost reparat în această sesiune — este strict o listă
de constatări.

---

## P1 — de rezolvat înainte de următoarea demonstrație

### 1. „Istoric financiar" este gol în fișa chiriașului (admin)

- **Unde:** `/admin/tenants/seed-tenant` → tabul _Istoric financiar_.
- **Ce se vede:** „Niciun raport încă."
- **De ce este un bug:** aceleași rapoarte sunt vizibile în portalul chiriașului
  (`/app/history` listează august, iulie, mai, februarie, ianuarie 2026 și anul
  2025), fișa aceluiași chiriaș arată sold stocat 5.460,00 lei, iar dashboard-ul
  admin desenează grafic pe 12 luni de facturare. Datele există; doar acest ecran
  nu le găsește.
- **Ipoteză:** query-ul filtrează pe alt câmp decât cel populat de seed / de
  `finalizeKyc` — probabil `tenancyId` vs. `ownerId`/`userId`, sau se
  interoghează tenancy-ul curent în loc de toate tenancy-urile contului
  (FR-TEN-15 permite mai multe tenancy-uri pe același cont).
- **Impact:** administratorul nu are deloc vizibilitate asupra istoricului
  financiar din fișa chiriașului — singurul loc unde ar trebui să îl aibă
  consolidat.
- **De adăugat:** test care creează un raport semnat și verifică apariția lui în
  acest tab.

### 2. Imaginile din Storage nu se încarcă nicăieri în aplicație

- **Unde:** fișa chiriașului → _Poze act de identitate_ (`ci-front.jpg`); wizard
  KYC pasul 2 (`tenant-ci-front.jpg`, `tenant-ci-back.jpg`); pasul 3 → _Poze act
  garant_ (`guarantor-ci.jpg`).
- **Ce se vede:** doar textul alternativ, imagine ruptă, în toate cazurile.
- **Ipoteză:** emulatorul de Storage (9199) nu rula, sau URL-urile generate nu se
  rezolvă (semnare / path de download). De verificat dacă problema persistă cu
  emulatorul pornit — dacă da, e bug de aplicație, nu de mediu.
- **Impact:** KYC-ul este, prin definiție, un flux bazat pe fotografii. Un demo
  cu poze rupte nu poate fi arătat nimănui.
- **De adăugat:** stare de eroare explicită („imaginea nu a putut fi încărcată")
  în loc de `alt` rupt, plus retry.

---

## P2 — corectitudine și consistență

### 3. Datele calendaristice se afișează în format american în interfața românească

- **Unde:** raport lunar → _Data scadentă_ `08/10/2026`; câmpul gol `mm/dd/yyyy`;
  wizard KYC pasul 1 → _Data nașterii_ `04/11/1992`.
- **Problema:** `08/10/2026` se citește în română ca 8 octombrie, dar înseamnă
  10 august. Este exact tipul de ambiguitate care produce o plată întârziată.
- **Notă:** în portalul chiriașului formatul este corect („10 august 2026") —
  inconsistența e doar în ecranele de administrare, unde se folosesc
  `input[type=date]` native, formatate după locale-ul browserului.
- **Propunere:** locale explicit `ro-RO` pe inputurile de dată, sau afișare
  textuală lângă câmp.

### 4. Numele serviciilor nu sunt localizate

- **Unde:** portalul chiriașului cu limba EN — „Rent" și „Maintenance" se traduc,
  dar „Electricitate" și „Gaz" rămân în română, în același tabel.
- **Cauză probabilă:** chiria și mentenanța sunt linii fixe cu chei de traducere,
  în timp ce serviciile vin din catalogul definit pe proprietate și se stochează
  ca text liber.
- **Propunere:** chei de traducere pentru serviciile din catalog (electricitate,
  gaz, apă, salubritate, internet, TV), cu text liber păstrat doar pentru
  serviciile definite manual de administrator.
- **Legătură cu SRS:** NFR-LOC — emailul către chiriaș pleacă în limba lui; dacă
  denumirile de servicii nu sunt traduse, nici raportul din email nu este complet
  bilingv.

### 5. Drafturile de onboarding fără date sunt neidentificabile în listă

- **Unde:** `/admin/tenants`, primul rând — toate coloanele „—", status „În
  lucru", cu acțiunile _Continuă_ / _Șterge draftul_.
- **Problema:** cu mai multe drafturi începute (FR-TEN-21 le permite explicit,
  fără limită), rândurile goale devin imposibil de distins între ele.
- **Propunere:** placeholder de forma „Draft nou · început la {dată}", eventual și
  proprietatea vizată dacă a fost deja aleasă.

---

## P3 — ergonomie

### 6. Bara laterală de administrare derulează odată cu pagina

- **Unde:** ecranele lungi — wizard KYC, fișa chiriașului, raport lunar.
- **Efect:** _Deconectare_, selectorul de limbă și comutatorul de temă ies din
  câmpul vizual; în wizard-ul KYC a fost nevoie de derulare până la capătul
  paginii pentru a ajunge la ele.
- **Propunere:** bară laterală fixă, cu zona proprie de scroll.

### 7. Stepperul KYC nu este navigabil

- **Unde:** wizard-ul de onboarding, antetul cu „1. Date personale … 4. Contract".
- **Comportament actual:** pașii sunt doar indicatori; navigarea se face exclusiv
  cu _Înapoi_ / _Continuă_.
- **Propunere:** pașii deja completați să fie clickabili, pentru revenire rapidă
  la o corecție — util mai ales în completarea față în față, pe tabletă, cu
  chiriașul de față.

### 8. Cardul raportului rămâne alb în tema închisă

- **Unde:** portalul chiriașului, _Acasă_ și detaliul raportului, cu tema închisă
  activă.
- **Observație:** poate fi intenționat — raportul citit ca „foaie de hârtie" —
  dar contrastul este puternic și merită o decizie explicită, consemnată, nu
  lăsată ca efect secundar al stilizării.

---

## P4 — mediu de dezvoltare

### 9. Gazda emulatoarelor este hardcodată pe `127.0.0.1`

- **Unde:** `web/src/lib/firebase.js` — `const host = "127.0.0.1"` pentru Auth,
  Firestore, Storage, Functions.
- **Problema constatată:** unelte care servesc aplicația prin `localhost`
  (browsere containerizate, panouri de preview, tuneluri) ajung la Vite pe 5173,
  dar nu și la emulatoare, pentru că portul este atins pe alt nume de gazdă.
  Aplicația se încarcă și eșuează abia la autentificare, cu „Conexiune
  indisponibilă" — simptom care seamănă cu o problemă de rețea, deși cauza e
  configurația.
- **Propunere:** `VITE_EMULATOR_HOST` cu implicit `127.0.0.1`, plus mesaj de
  eroare care distinge „emulatorul nu răspunde" de „credențiale greșite".

---

## Notă despre datele din seed

Nimic de reparat, doar de reținut la interpretarea capturilor: dashboard-ul arată
„De returnat foștilor chiriași: 3,00 lei" — o sumă simbolică, provenită din setul
de test, nu o eroare de calcul.
