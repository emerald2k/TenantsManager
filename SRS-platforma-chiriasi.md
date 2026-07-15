# SRS — Software Requirements Specification
# Platformă Gestionare Chiriași

*Versiune 4.3 — FINALĂ, gata pentru generarea codebase-ului.*

***Corecții v4.3, rezultate din confruntarea specificației cu un raport lunar real folosit în practică:***
- *FR-REP-03 — inversat: toate serviciile active apar în raport, indiferent de sumă (inclusiv 0/negativ). Anterior se ascundeau — greșit.*
- *FR-REP-03a (nou) — observații + atașamente **per linie de cost** (factura justificativă lângă suma pe care o justifică), vizibile chiriașului.*
- *FR-REP-04a/04b/04c (nou) — totalul poate fi ajustat manual la publicare (rotunjire comercială pentru plata cash); sistemul sugerează rotunjirea în jos la multiplu de 5 lei, editabilă. `totalFinal` este singura sumă datorată — restanțele și creditele se calculează față de el, nu față de totalul exact; diferența de rotunjire nu reapare niciodată.*
- *FR-DOC-03a (nou) — atașarea globală la nivel de raport a fost eliminată; documentele se atașează exclusiv per linie.*
- *FR-REP-07/07a (revizuit) — "publicarea" devine **semnare**: lista se blochează la semnare; corecțiile necesită deblocare explicită + re-semnare (notificare "listă actualizată").*
- *FR-REP-07b/07c (nou) — export în **PDF**, **imagine PNG** (pentru WhatsApp) și **link partajabil fără login**. Linkul folosește token aleatoriu, nu expiră, e revocabil manual, și expune **exclusiv raportul lunii** — nu portalul, istoricul sau datele personale. Servit printr-o Cloud Function (`getSharedReport`), nu prin acces anonim la Firestore.*

*Include: model de securitate consolidat (users doar-admin, date denormalizate), tooling de calitate cod în fundație (ESLint, Prettier, Husky, lint-staged, commitlint, .editorconfig), gestiune `.env`, limba preferată per chiriaș, formula de total (întreținere = categorie separată de servicii), catalog servicii (electricitate/gaz/internet/TV/apă + custom), fără validare de format pe câmpuri, unicitate raport pe proprietate+lună+an, empty state la prima pornire, specificația tehnică de implementare (Cloud Functions, Security Rules, monorepo, medii), planul de milestone-uri și anexa cu template-urile de email.*

---

## 1. Introducere

### 1.1 Scop
Acest document specifică cerințele de produs, funcționale și non-funcționale pentru o platformă web care permite unui proprietar de imobile să gestioneze relația cu chiriașii săi: onboarding detaliat (KYC), asignare proprietăți, servicii și cheltuieli lunare, rapoarte, plăți și istoric.

### 1.2 Domeniul aplicației
Aplicația deservește un singur administrator (proprietar), gestionând 5-20 proprietăți (apartamente), fiecare cu maximum un chiriaș activ la un moment dat. Nu include facturare fiscală și nu procesează plăți online.

### 1.3 Definiții și acronime

| Termen | Definiție |
|---|---|
| Admin | Administratorul/proprietarul, utilizatorul cu acces complet la backoffice |
| Chiriaș | Utilizator cu acces limitat la propria tenanță |
| Tenanță | Relația contractuală dintre un chiriaș și o proprietate, într-un interval de timp |
| Garant | Persoană de co-semnătură/co-obligare la plată, fără cont propriu în sistem |
| Serviciu | Un cost lunar recurent asociat unei proprietăți (ex: electricitate, apă, gaz, internet, TV), cu sumă fixă introdusă lunar. Chiria și întreținerea NU sunt servicii — sunt categorii separate. |
| KYC | Know Your Customer — procesul obligatoriu de colectare a datelor chiriașului la onboarding |
| Denormalizare | Copierea unor date dintr-un document în altul, pentru acces securizat/rapid, cu sincronizare automată |
| BaaS | Backend-as-a-Service (Firebase) |
| FR / NFR | Cerință funcțională / non-funcțională |
| MVP | Minimum Viable Product — nucleul esențial, Faza 1 |
| Soft-delete | Arhivare/dezactivare care păstrează datele istorice, fără ștergere fizică |

### 1.4 Prezentare generală document
Secțiunea 2 — produsul: problemă, obiective, plan de lansare, riscuri. Secțiunea 3 — cerințe funcționale. Secțiunea 4 — cerințe non-funcționale. Secțiunea 5 — specificația UI (rute, pagini, stări) și interfețe. Secțiunea 6 — modelul de date și securitatea lui. Secțiunea 7 — arhitectura tehnică (stack, Cloud Functions, Security Rules, monorepo, medii). Secțiunea 8 — presupuneri și dependențe. Secțiunea 9 — planul de implementare (milestone-uri). Anexa A — template-urile de email.

---

## 2. Descriere generală

### 2.1 Problema și obiectivele
Gestionarea manuală a chiriilor și cheltuielilor pentru 5-20 proprietăți consumă timp, e predispusă la erori și poate genera neînțelegeri cu chiriașii din lipsă de transparență și istoric clar. Colectarea insuficientă de date la onboarding expune proprietarul la riscuri.

**Obiective:**
- Reducerea timpului petrecut lunar cu evidența cheltuielilor și chiriei.
- Transparență totală cu chiriașii (inclusiv acces la facturile furnizorilor atașate rapoartelor), pentru a reduce neînțelegerile.
- Un istoric complet, clar și ușor accesibil — inclusiv evoluția în timp a costurilor fiecărui serviciu, per proprietate.
- Colectarea unui profil complet și verificat al fiecărui chiriaș la onboarding (KYC), pentru siguranța juridică și financiară a proprietarului — reducând riscul de a închiria unei persoane cu intenții rău-voitoare — și pentru a avea la îndemână toate datele necesare la redactarea contractului de închiriere (redactat separat, în afara aplicației).

### 2.2 Metrică de succes
La 6 luni de utilizare: administratorul are întotdeauna acces la un istoric clar și complet (financiar și al chiriașilor), la care poate reveni oricând, fără efort de căutare sau reconstituire manuală.

### 2.3 Perspectiva produsului
Aplicație web de sine stătătoare (SPA), backend complet pe Firebase (BaaS). Două interfețe: backoffice administrator (inclusiv pe tabletă, pentru onboarding față-în-față) și dashboard chiriaș (mobile-first).

### 2.4 Funcții principale
- Onboarding KYC detaliat (wizard 4 pași, profil complet, poze acte capturate live) — singura cale de creare a unui cont de chiriaș.
- Gestionarea proprietăților și a serviciilor disponibile (catalog + custom).
- Introducerea lunară a costului fiecărui serviciu și generarea automată a rapoartelor.
- Istoric per proprietate: evoluția lunară a costului fiecărui serviciu + total.
- Marcarea plăților, gestionarea automată a restanțelor și creditelor.
- Acces al chiriașului la propriile rapoarte, documente și facturi atașate.
- Notificări automate prin email, în limba preferată a chiriașului.

### 2.5 Clase de utilizatori

| Clasă | Nivel tehnic | Frecvență |
|---|---|---|
| Administrator | Utilizator obișnuit web; tabletă la onboarding | Lunar (cheltuieli), ad-hoc (onboarding/offboarding) |
| Chiriaș | Utilizator obișnuit web/mobil | Lunar (vizualizare raport) |

### 2.6 Constrângeri
Fără facturare fiscală; fără plăți online; un singur admin; monedă exclusiv RON; web responsive, fără aplicație mobilă nativă.

### 2.7 Plan de lansare: MVP și Faza 2

**MVP (Faza 1)** — lansat direct pentru toate proprietățile: setup & autentificare; onboarding KYC complet (wizard, drafturi) + contracte + offboarding; proprietăți + servicii; costuri lunare + rapoarte; istoric costuri per serviciu (tabelar); plăți + restanțe/credite + remindere email; cont chiriaș (dashboard, istoric, contract, PDF); documente; bilingv RO/EN; dashboard admin + Luna curentă; gestionare erori simplă.

**Faza 2:** rapoarte agregate admin (FR-REP-09, FR-REP-10); grafic evoluție costuri per serviciu (completare FR-PROP-09); retry automat + jurnal erori (FR-SYS-01, FR-SYS-02).

**Explicit în afara scopului (orice fază):** facturare fiscală, plăți online, multi-admin, aplicație mobilă nativă, 2FA, notificări in-app, introducere cheltuieli în masă, export CSV/Excel general, dark mode, audit trail, migrare date istorice, verificare identitate garant, resetare/schimbare parolă self-service, generare automată contract, calcul pe index de contor.

**Tooling evitat conștient (nu bloat, dar supra-inginerie pentru acest proiect):** TypeScript (decizie asumată — JavaScript simplu), Storybook, CI/CD automat (deploy manual în MVP; posibil GitHub Actions în Faza 2), Docker, monitoring erori producție (Sentry — posibil Faza 2+). Aceste unelte sunt standard profesional, dar adaugă complexitate nejustificată la scara și contextul solo al acestui proiect.

### 2.8 Riscuri identificate

| Risc | Mitigare |
|---|---|
| Admin unic — pierderea accesului blochează gestionarea | Recuperare prin Firebase Console (documentată în README) |
| Livrare email fără retry în MVP | Verificare periodică manuală până la Faza 2 |
| Dependență Firebase | Free tier suficient pentru 5-20 proprietăți; monitorizare |
| Volum mare de date personale la KYC | `users` integral doar-admin (Security Rules), criptare implicită |
| Parole comunicate manual (fără self-service) | Parole generate aleatoriu, puternice (12+ caractere) |

---

## 3. Cerințe funcționale

### 3.1 Modul Autentificare & Setup (AUTH)

| ID | Cerință |
|---|---|
| FR-AUTH-01 | Contul de administrator este creat manual, o singură dată, direct din Firebase Console — fără ecran public de înregistrare. Rolul de admin e marcat printr-un custom claim (`admin: true`), setat printr-un script de setup rulat o singură dată. |
| FR-AUTH-02 | Ecran unic de autentificare, comun pentru toate rolurile. |
| FR-AUTH-03 | După autentificare, sistemul determină rolul (custom claim) și redirecționează corespunzător. |
| FR-AUTH-04 | **Fără resetare/schimbare de parolă self-service** — niciun link "am uitat parola", nicio opțiune de schimbare în contul chiriașului. Parola unui chiriaș se resetează doar de admin, din detaliul chiriașului: sistemul generează o parolă nouă și o afișează adminului, care o comunică chiriașului. Parola adminului se recuperează exclusiv prin Firebase Console. |
| FR-AUTH-05 | Sesiune activă până la delogare manuală — fără expirare din inactivitate. |
| FR-AUTH-06 | Parolă minimum 6 caractere; fără 2FA. Parolele generate de sistem: aleatorii, 12+ caractere. |
| FR-AUTH-07 | La finalizarea KYC, sistemul generează automat o parolă și trimite credențialele (email login + parolă) pe emailul chiriașului, în limba lui preferată. Nu se repetă la tenanțe ulterioare pe același cont. |

### 3.2 Modul Onboarding KYC & Gestionare Chiriași (TEN)

| ID | Cerință |
|---|---|
| FR-TEN-01 | Onboarding-ul este un **proces KYC obligatoriu**: wizard în 4 pași — (1) date personale, (2) poze acte identitate, (3) date financiare/profesionale, (4) date contract. Conceput pentru completare față-în-față, pe tabletă. |
| FR-TEN-02 | **Pasul 1** colectează: nume complet, data nașterii, CNP, telefon, email, **limba preferată (RO/EN)**, adresă corespondență (opțional), adresă domiciliu anterioară, contact de urgență (nume+telefon), număr persoane în proprietate, fumător/nefumător, animale companie (da/nu+tip), vehicul (da/nu; dacă da: marcă+număr). |
| FR-TEN-03 | **Pasul 2**: fotografiere directă cu camera nativă (buton captură, fără preview custom). Minimum o poză obligatorie. |
| FR-TEN-04 | **Pasul 3**: angajator, ocupație/funcție, vechime la locul de muncă, sursă+nivel venit lunar, garant (nume, CNP, telefon — obligatorii; poze act garant — **opțional, neblocant**), referință anterioară (nume, telefon). |
| FR-TEN-05 | **Pasul 4**: datele contractului (vezi 3.3). |
| FR-TEN-06 | Toate câmpurile din pașii 1 și 3 obligatorii, cu excepția: adresă corespondență, poze act garant. |
| FR-TEN-07 | Email existent la Pasul 1 → tenanță nouă legată de contul existent, salt direct la Pasul 4. |
| FR-TEN-08 | Email nou → contul se creează la finalizarea KYC (Cloud Function `finalizeKyc`). |
| FR-TEN-09 | **Toate** datele chiriașului (profil + KYC) sunt stocate în colecția `users`, cu acces **exclusiv admin** — chiriașul nu are acces de citire la propriul document. Aplicația chiriașului folosește exclusiv datele denormalizate din tenanță și rapoartele proprii. |
| FR-TEN-10 | Datele sensibile se păstrează permanent, fără ștergere automată. |
| FR-TEN-11 | Toate datele de profil sunt editabile exclusiv de admin. |
| FR-TEN-12 | Ștergerea unui chiriaș = soft-delete; istoricul financiar rămâne permanent. |
| FR-TEN-13 | Listă chiriași: nume, contact, proprietate curentă, sold restant, status; sortare alfabetică, căutare text. |
| FR-TEN-14 | Asignarea la o proprietate ocupată este blocată. |
| FR-TEN-15 | Un cont poate acumula istoric de mai multe tenanțe în timp, sub același login. |
| FR-TEN-16 | Finalizarea completă a KYC este **singura modalitate** de creare a unui cont de chiriaș. Contul + emailul cu credențiale se creează/trimit doar după completarea tuturor pașilor obligatorii. Nu există cont parțial și nicio altă cale de creare. |
| FR-TEN-17 | Onboarding-ul neterminat se salvează ca **draft**, reluabil de la pasul curent. Draftul nu generează cont. |
| FR-TEN-18 | La finalizarea KYC, datele draftului se transferă în `users`/`tenancies`, draftul se șterge automat. |
| FR-TEN-19 | Drafturile apar în lista de chiriași cu status "în curs de completare" + acțiuni "Continuă"/"Șterge draft". |
| FR-TEN-20 | Drafturile se șterg doar manual — fără expirare automată. |
| FR-TEN-21 | Drafturi multiple în paralel, fără limită. |
| FR-TEN-22 | La finalizare, verificare unicitate CNP: duplicat → finalizare **blocată** + afișare chiriaș în conflict. |
| FR-TEN-23 | Onboarding (draft) permis pentru proprietate ocupată; **finalizarea blocată** până la încheierea contractului curent. |
| FR-TEN-24 | Stările contului de chiriaș: `activ` / `inactiv-readonly` / `dezactivat` / `arhivat`. (Contul e activ imediat după creare — nu există stare "invitat".) |

### 3.3 Modul Contracte / Tenanțe (CON)

| ID | Cerință |
|---|---|
| FR-CON-01 | Contract: proprietate, dată început, dată sfârșit (obligatorie), chirie lunară, garanție (opțional), ziua scadentă. |
| FR-CON-02 | Un cont — maximum o tenanță activă simultan. |
| FR-CON-03 | Încheiere manuală oricând, inclusiv anticipat. |
| FR-CON-04 | Încheiere blocată dacă există restanțe neachitate. |
| FR-CON-05 | La încheiere: proprietatea devine "liberă", contul trece în "inactiv-readonly". |
| FR-CON-06 | Prelungire = editarea datei de sfârșit pe aceeași tenanță. |
| FR-CON-07 | Contractul semnat atașat e vizibil/descărcabil de chiriaș. |
| FR-CON-08 | Trecerea datei de sfârșit nu declanșează nimic automat — contractul rămâne "activ" până la încheierea manuală. |
| FR-CON-09 | Remindere email către admin cu **90, 60 și 30 de zile** înainte de expirare (trimise la 09:00, Europe/Bucharest). |

### 3.4 Modul Proprietăți & Servicii (PROP)

| ID | Cerință |
|---|---|
| FR-PROP-01 | Proprietate: nume, stradă, număr, oraș, județ (obligatorii), cod poștal, suprafață, camere (opționale). |
| FR-PROP-02 | Fiecare proprietate are o **listă de servicii** gestionată de admin (adăugare/eliminare) din pagina proprietății: **catalog predefinit** (electricitate, gaz, abonament internet, abonament TV, apă) + **servicii custom** (nume liber). Întreținerea NU este serviciu — este o categorie separată, alături de chirie (FR-REP-01a). |
| FR-PROP-03 | Toate serviciile au **sumă fixă lunară**, introdusă manual în raportul lunii — fără calcul pe index. |
| FR-PROP-04 | Datele proprietății și serviciile sunt editabile oricând, indiferent de ocupare. |
| FR-PROP-05 | Status (liber/ocupat) calculat automat din tenanțele active. |
| FR-PROP-06 | Ștergerea unei proprietăți cu istoric = soft-delete. |
| FR-PROP-07 | Listă proprietăți: nume, adresă, status, sold restant; sortare alfabetică, căutare. |
| FR-PROP-08 | Eliminarea unui serviciu nu afectează rapoartele publicate (nume+cost snapshot); serviciul dispare doar din rapoartele viitoare. |
| FR-PROP-09 | Pagina proprietății include **istoricul costurilor**: tabel luni × (chirie + întreținere + servicii + alte + total) — evoluția costului fiecărui serviciu în timp. *(Faza 2: grafic pe aceleași date.)* |
| FR-PROP-10 | Numele și adresa proprietății sunt denormalizate în tenanța activă și sincronizate automat (Cloud Function) la editarea proprietății. |

### 3.5 Modul Cheltuieli & Rapoarte lunare (REP)

| ID | Cerință |
|---|---|
| FR-REP-01 | Introducere lunară, per proprietate (individual): întreținere (câmp propriu) + costul fiecărui serviciu activ + "alte cheltuieli" (descriere+sumă, listă liberă). Chiria preluată din contract. |
| FR-REP-01a | Categoriile de cost sunt: **chirie** (din contract, editabilă punctual), **întreținere** (câmp propriu, separat de servicii), **servicii** (listă per proprietate), **alte cheltuieli** (punctuale, listă liberă). |
| FR-REP-02 | Chiria ajustabilă punctual pentru luna curentă, fără a modifica contractul. |
| FR-REP-03 | **Toate serviciile active** ale proprietății apar în raport, **indiferent de sumă** — inclusiv 0 sau valori negative (ajustări). Motivul: transparență — chiriașul vede că serviciul a fost luat în calcul, nu omis. La fel pentru chirie și întreținere. |
| FR-REP-03a | Fiecare linie de cost (chirie, întreținere, fiecare serviciu, alte cheltuieli) poate avea: un **câmp opțional de observații** (text liber, completat de admin la introducerea costului) și **atașamente opționale** (imagine/PDF/document — ex: factura furnizorului pentru acel serviciu). Ambele sunt **vizibile chiriașului** (transparență totală). |
| FR-REP-04 | Total calculat automat: **chirie + întreținere + costuri servicii + alte cheltuieli + restanță lună anterioară − credit lună anterioară**; restanța și creditul apar ca linii separate. |
| FR-REP-04a | La publicarea raportului, administratorul poate **ajusta manual totalul final** (ex: rotunjire comercială: 2382,17 → 2380). Suma ajustată devine **totalul final datorat** — diferența nu se reportează, nu generează restanță și nu se păstrează ca sold. Totalul calculat automat rămâne vizibil ca referință. |
| FR-REP-04b | Sistemul **sugerează automat** rotunjirea în jos la cel mai apropiat multiplu de 5 lei (ex: 2518,71 → sugestie 2515), pe baza practicii curente a administratorului — pentru a facilita plata în numerar. Sugestia e afișată ca valoare precompletată în câmpul de total final, dar rămâne **complet editabilă** — administratorul o poate accepta, modifica cu altă valoare, sau reveni la totalul calculat exact. Sugestia nu se aplică niciodată fără confirmarea publicării. |
| FR-REP-04c | **`totalFinal` este singura sumă datorată** și baza pentru toate calculele ulterioare de plată. Restanța și creditul se calculează exclusiv față de `totalFinal` (suma rotunjită), NU față de `totalCalculat`. Exemplu: totalCalculat 2518,71 → totalFinal rotunjit 2515,00 → chiriașul plătește 2000 → restanța este 515,00 (nu 518,71). Diferența de rotunjire nu reapare niciodată, sub nicio formă. |
| FR-REP-05 | Data scadentă preluată din contract (ziua scadentă), suprascriere manuală per lună posibilă. |
| FR-REP-06 | La **semnare** (finalizarea listei) → notificare email chiriașului (în limba lui), cu link către raport. |
| FR-REP-07 | **Semnarea** este actul prin care administratorul confirmă validitatea și finalitatea listei de plată. Stările unui raport: `ciornă` (în lucru, invizibil chiriașului) → `semnat` (finalizat, blocat, vizibil chiriașului). După semnare raportul este **blocat la editare**. |
| FR-REP-07a | Un raport semnat poate fi **deblocat** de administrator printr-o acțiune explicită (buton "Deblochează pentru corecție" + dialog de confirmare). După corecție și re-semnare, chiriașul primește automat notificare **"listă actualizată"**. Editarea nu e posibilă fără deblocare prealabilă — nu se poate modifica accidental un raport semnat. |
| FR-REP-07b | **Export raport semnat**, disponibil administratorului în trei forme: (a) **PDF** (arhivă/email), (b) **imagine PNG** (gata de trimis pe WhatsApp — reproduce tabelul cu liniile de cost și atașamentele), (c) **link partajabil** (vezi FR-REP-07c). |
| FR-REP-07c | **Link partajabil fără autentificare** — permite chiriașului să vadă raportul instant, fără login (ex: trimis pe WhatsApp). Reguli obligatorii: (1) conține un **token aleatoriu lung, imposibil de ghicit** (nu ID-uri secvențiale); (2) deschide **exclusiv raportul lunii respective** — NU portalul chiriașului, NU istoricul, NU contractul, NU datele personale; (3) **nu expiră**, dar poate fi **revocat manual** de administrator oricând (revocarea invalidează linkul permanent); (4) pentru istoric complet, contract și celelalte rapoarte, chiriașul trebuie să se autentifice în cont. |
| FR-REP-08 | Nu există publicare automată — raportul e vizibil chiriașului doar după semnare. Corecțiile se fac prin deblocare → editare → re-semnare (FR-REP-07a). |
| FR-REP-09 | *(Faza 2)* Listă globală filtrabilă a rapoartelor. |
| FR-REP-10 | *(Faza 2)* Raport anual agregat (totaluri generale), fără export. |
| FR-REP-11 | Rapoarte retroactive permise pentru orice lună din trecut. |
| FR-REP-12 | Recalculul restanțelor/creditelor (din rapoarte retroactive sau plăți anulate) se propagă **doar în rapoartele viitoare** — cele publicate rămân neatinse; corecțiile pe luni publicate se fac prin editare manuală. |
| FR-REP-13 | Prima lună a unui contract început în cursul lunii: chirie integrală; regularizarea pro-rata se face manual (FR-REP-02). |
| FR-REP-14 | Un raport este identificat unic prin combinația **proprietate + lună + an**. Nu pot exista două rapoarte pentru aceeași proprietate în aceeași lună — la încercarea de a crea un duplicat, sistemul deschide raportul existent pentru editare. |

### 3.6 Modul Plăți & Restanțe (PAY)

| ID | Cerință |
|---|---|
| FR-PAY-01 | Plata se marchează manual de admin: sumă, metodă (cash/transfer bancar/altul), dată. |
| FR-PAY-02 | Plăți parțiale permise; diferența devine restanță. |
| FR-PAY-03 | Restanța se reportează automat în raportul următor ("Restanță lună anterioară"). |
| FR-PAY-04 | Reminder email la 3 zile după scadență, repetat la fiecare 3 zile până la achitare completă (trimis la 09:00, Europe/Bucharest). |
| FR-PAY-05 | Supraplata permisă; excedentul devine **credit**, aplicat automat în raportul următor ("Credit lună anterioară"). |
| FR-PAY-06 | Plățile pot fi anulate/corectate; raportul revine la statusul anterior. Efectele asupra lunilor viitoare urmează FR-REP-12. |

### 3.7 Modul Cont Chiriaș (TAPP)

| ID | Cerință |
|---|---|
| FR-TAPP-01 | Dashboard: total lună curentă (totalul final), dată scadentă, status plată, detaliere pe linii (chirie + întreținere + toate serviciile active + alte + restanță/credit), cu **observațiile și atașamentele fiecărei linii vizibile** (factura justificativă lângă suma ei). |
| FR-TAPP-02 | Istoric rapoarte (grupate pe ani), cu status și detaliere per serviciu + facturi atașate la deschidere. |
| FR-TAPP-03 | Date proprietate/contract + descărcare contract semnat. |
| FR-TAPP-04 | Descărcare PDF per raport lunar (client-side, în limba preferată). |
| FR-TAPP-05 | Chiriașul nu poate edita nimic din profil și nu își poate schimba parola. |
| FR-TAPP-06 | După încheierea contractului: acces read-only la istoricul propriu. |

### 3.8 Modul Dashboard Administrator (DASH)

| ID | Cerință |
|---|---|
| FR-DASH-01 | Dashboard: total de încasat luna curentă + total restanțe agregat. |
| FR-DASH-02 | Acces rapid la pagina "Luna curentă" — proprietăți ocupate cu statusul raportului lunii. |
| FR-DASH-03 | **Prima pornire** (zero proprietăți și zero chiriași): dashboard-ul afișează o stare goală (empty state) cu doar două acțiuni proeminente — "Adaugă proprietate" și "Înscrie chiriaș" (onboarding). Totalurile și "Luna curentă" apar abia după existența datelor. Ordinea logică sugerată: întâi proprietatea (cu serviciile ei), apoi chiriașul (KYC + contract). |

### 3.9 Modul Documente (DOC)

| ID | Cerință |
|---|---|
| FR-DOC-01 | Documente atașabile: poze acte identitate (chiriaș obligatoriu, garant opțional), contract semnat, și **facturi/documente justificative per linie de cost** în raportul lunar (FR-REP-03a). |
| FR-DOC-02 | Atașarea opțională, cu excepția pozelor actelor chiriașului (obligatorii la KYC). |
| FR-DOC-03 | Fișiere multiple per linie de cost / contract. Formate acceptate: imagine, PDF, document. |
| FR-DOC-03a | **Nu există atașare globală la nivel de raport** — documentele justificative se atașează exclusiv **per linie de cost** (fiecare factură lângă suma pe care o justifică), pentru claritate. |
| FR-DOC-04 | Vizibilitate: contract semnat + atașamentele per linie de cost — vizibile chiriașului (transparență totală); poze acte (chiriaș și garant) — exclusiv admin. |
| FR-DOC-05 | Upload maxim 10 MB/fișier; imaginile comprimate automat pe client (~2000px, ~80%). |

### 3.10 Modul Sistem & Erori (SYS)

| ID | Cerință |
|---|---|
| FR-SYS-01 | *(Faza 2)* Retry automat pentru operațiile eșuate. |
| FR-SYS-02 | *(Faza 2)* Jurnal de erori vizibil adminului. MVP: mesaje de eroare clare în interfață. |
| FR-SYS-03 | Fără notificări in-app — exclusiv email. |
| FR-SYS-04 | Toate joburile programate rulează la **09:00, fus orar Europe/Bucharest**. |

---

## 4. Cerințe non-funcționale

### 4.1 Securitate & GDPR

| ID | Cerință |
|---|---|
| NFR-SEC-01 | Security Rules: admin (custom claim) — acces complet; chiriaș — citire exclusiv pe propriile tenanțe și rapoarte semnate. Accesul anonim la Firestore rămâne complet interzis; rapoartele partajate se servesc exclusiv printr-o Cloud Function care validează tokenul (FR-REP-07c). |
| NFR-SEC-02 | Colecția `users` (profil + KYC), `onboardingDrafts`, `mail`, `errorLogs` — acces exclusiv admin. Date păstrate permanent. |
| NFR-SEC-03 | Autentificare email+parolă, min. 6 caractere; fără 2FA; parole generate: 12+ caractere aleatorii. |
| NFR-SEC-04 | Un singur cont admin, permanent. |
| NFR-SEC-05 | Fără deconectare automată. |
| NFR-SEC-06 | Fără audit trail pe rapoarte. |
| NFR-SEC-07 | Criptare at rest + TLS, implicite prin Firebase. |
| NFR-SEC-08 | Storage: poze acte — doar admin; contracte + facturi — admin + chiriașul tenanței respective. |
| NFR-SEC-09 | Autentificarea și autorizarea se bazează integral pe Firebase Authentication. Firebase gestionează automat token-urile de sesiune (ID token de tip JWT: emitere, semnare, reînnoire orară, atașare la cereri și verificare) — **aplicația nu creează, semnează sau validează manual token-uri**. Rolul de administrator este stocat ca **custom claim** (`admin: true`) în token, setat o singură dată la setup; Security Rules citesc `request.auth.uid` și `request.auth.token.admin` din token-ul deja validat de Firebase. Nu se implementează sesiuni server-side, cookie-uri de sesiune sau logică custom de token. |

### 4.2 Performanță & Disponibilitate
NFR-PERF-01: suport confortabil 5-20 proprietăți, fără optimizări speciale. NFR-PERF-02: fără backup suplimentar plătit. NFR-PERF-03: fără export CSV/Excel. NFR-PERF-04: soldul restant curent e stocat pe tenanță și actualizat automat (Cloud Function) la orice modificare de raport/plată — listele se încarcă dintr-o singură citire.

### 4.3 UX & Design
NFR-UX-01: interfață simplă, fără branding custom. NFR-UX-02: doar light mode. NFR-UX-03: responsive; wizard KYC optimizat tabletă; interfața chiriașului mobile-first.

### 4.4 Compatibilitate
NFR-COMPAT-01: browsere/dispozitive moderne (Chrome, Safari recente), inclusiv tablete; fără legacy.

### 4.5 Localizare
NFR-LOC-01: interfață bilingvă RO/EN (i18n); validări în limba selectată. NFR-LOC-02: monedă exclusiv RON, format românesc (1.234,56 lei). NFR-LOC-03: fără migrare de date. NFR-LOC-04: emailurile automate și PDF-urile se generează în **limba preferată a chiriașului** (câmp setat de admin la KYC, editabil ulterior); emailurile către admin — în română.

### 4.6 Validare date
NFR-VAL-01: câmpurile obligatorii sunt verificate doar pentru prezență (completat/necompletat), **fără validare de format** — CNP, telefon, email, număr înmatriculare etc. acceptă orice text. Nu se implementează algoritmi de control (ex: validare CNP), reguli de format sau măști de input. (Decizie asumată: adminul introduce datele personal, față-în-față, deci corectitudinea e asigurată uman.)

---

## 5. Specificație UI — rute, pagini și interfețe

### 5.1 Harta rutelor

```
PUBLIC
  /login                          — ecran unic de autentificare
  /r/:shareToken                  — raport partajat, FĂRĂ autentificare (FR-REP-07c)
                                    expune EXCLUSIV raportul acelei luni; nimic altceva

ADMIN (layout cu sidebar; colapsabil pe tabletă)
  /admin                          — dashboard (totaluri)
  /admin/luna-curenta             — status introducere rapoarte, luna selectată
  /admin/proprietati              — listă proprietăți
  /admin/proprietati/noua         — creare proprietate
  /admin/proprietati/:id          — detaliu (date, servicii, istoric costuri)
  /admin/chiriasi                 — listă chiriași (incl. drafturi KYC)
  /admin/onboarding/:draftId      — wizard KYC, 4 pași
  /admin/chiriasi/:id             — detaliu chiriaș (tab-uri)
  /admin/rapoarte/:propertyId     — formular raport lunar (?luna=&an=)
  /admin/rapoarte                 — (Faza 2) listă globală
  /admin/raport-anual             — (Faza 2) raport anual

CHIRIAȘ (navbar sus; mobile-first)
  /app                            — dashboard
  /app/istoric                    — istoric rapoarte pe ani
  /app/contract                   — date proprietate + contract
```

Route guards: neautentificat → `/login`; chiriaș pe `/admin/*` → `/app`; admin pe `/app/*` → `/admin`.

### 5.2 Zona publică
**`/login`** — card centrat: titlu, email, parolă, "Autentificare", selector RO/EN. **Fără "am uitat parola"**. Stări: loading pe buton; eroare generică "Email sau parolă incorectă"; cont dezactivat/arhivat → "Cont dezactivat. Contactați proprietarul." Autentificat deja → redirect pe rol.

### 5.3 Zona administrator

**Navigație:** sidebar (Dashboard, Luna curentă, Proprietăți, Chiriași; + Rapoarte, Raport anual în Faza 2); jos: limbă, logout. Colapsabil pe tabletă.

**`/admin`** — 2 carduri: "Total de încasat luna curentă", "Total restanțe" (roșu dacă >0); card-buton → Luna curentă. Skeleton la încărcare; 0 afișat normal.

**`/admin/luna-curenta`** — selector lună/an (implicit curentă, navigabil înapoi); listă proprietăți ocupate: nume, chiriaș, badge status (neintrodus/publicat/plătit/parțial/restant), total; click → formularul raportului. Proprietățile libere nu apar.

**`/admin/proprietati`** — tabel: nume, adresă, status, sold restant (roșu); căutare, sortare alfabetică, "+ Adaugă proprietate"; arhivate ascunse implicit, comutator "Arată arhivate".

**`/admin/proprietati/noua`** — formular date proprietate; la salvare → detaliu (unde se configurează serviciile).

**`/admin/proprietati/:id`** — 3 secțiuni: (1) **Date** — editare, "Arhivează" (blocat dacă ocupată), link chiriaș curent; (2) **Servicii** — lista activă cu eliminare (+confirmare), "+ Adaugă serviciu" → dialog catalog (electricitate, gaz, internet, TV, apă) + custom; (3) **Istoric costuri** — tabel luni × (chirie + întreținere + servicii + alte + total), celule goale unde serviciul nu exista; sub tabel: istoric tenanțe. *(Faza 2: grafic.)*

**`/admin/chiriasi`** — tabel: nume, telefon, email, proprietate, sold restant, badge status (activ / **în curs de completare** / inactiv / dezactivat); drafturi cu "Continuă"/"Șterge draft" inline; căutare; "+ Onboarding chiriaș nou" → creează draft, deschide wizard.

**`/admin/onboarding/:draftId`** — wizard tabletă: câmpuri mari, un pas/ecran, progres 1-4, "Înapoi"/"Continuă", salvare automată draft la navigare + "Salvează și închide".
- Pas 1: câmpurile FR-TEN-02 (inclusiv **limba preferată**); email existent la blur → dialog "Chiriaș existent — tenanță nouă" → salt Pas 4.
- Pas 2: buton mare "Fotografiază act" (capture), grilă miniaturi + ștergere, min. 1.
- Pas 3: câmpurile FR-TEN-04; poze garant marcate "opțional".
- Pas 4: dropdown proprietăți (ocupate dezactivate + mențiune), contract, ziua scadentă.
- Finalizare: validare completă; CNP duplicat → dialog blocant cu link; succes → "Cont creat, credențiale trimise pe email" + link profil.

**`/admin/chiriasi/:id`** — tab-uri: (1) **Profil** — date KYC pe secțiuni, editare per secțiune, galerie poze (lightbox), limbă preferată editabilă; (2) **Tenanță & contract** — contract activ/ultimul, documente, "Prelungește", "Încheie contract" (blocat la restanțe, cu mesaj); (3) **Istoric financiar** — toate rapoartele, status + link; (4) **Cont** — status; "Resetează parola" (dialog cu parola generată + copiere), "Dezactivează/Reactivează", "Arhivează". 

**`/admin/rapoarte/:propertyId?luna=&an=`** — header: proprietate + chiriaș + luna + badge.

Corpul e un **tabel de linii de cost**, fiecare linie având aceeași structură (inspirat din tabelul folosit în practică): **denumire | sumă | observații + atașamente**.
- (1) **Chirie** — precompletată din contract, editabilă ("valabil doar luna curentă")
- (2) **Întreținere** — câmp sumă propriu
- (3) **Servicii** — câte o linie pentru **fiecare serviciu activ** al proprietății; apar TOATE, chiar dacă suma e 0 sau negativă (FR-REP-03)
- (4) **Alte cheltuieli** — listă dinamică (descriere + sumă)
- Pe **fiecare linie**: câmp opțional de **observații** (text liber, ex: "Ajustare după transmitere index") + zonă de **atașamente** (imagine/PDF/doc — ex: factura furnizorului). Ambele vizibile chiriașului (FR-REP-03a, FR-DOC-03a).
- (5) **Restanță/credit anterior** — readonly (roșu/verde)
- (6) **Data scadentă** — precompletată, editabilă

Footer sticky: **total calculat** (automat, readonly, ca referință) + câmp **total final** (editabil, precompletat cu **sugestia de rotunjire în jos la multiplu de 5** — FR-REP-04b; adminul o acceptă, o modifică, sau revine la totalul exact) + **"Semnează lista"** (dialog de confirmare: "Lista devine finală și blocată; chiriașul primește notificare"). După semnare: raportul e **blocat** — apare butonul **"Deblochează pentru corecție"** (confirmare; la re-semnare chiriașul primește "listă actualizată"), plus zona de **export**: descărcare **PDF**, descărcare **imagine PNG** (pentru WhatsApp), și **copiere link partajabil** (cu buton de **revocare**).

După publicare — secțiune **plată**: sumă, metodă, dată, "Marchează plata", "Anulează plata", indicator credit la supraplată.

### 5.4 Zona chiriaș
**Navigație:** navbar — Acasă, Istoric, Contract + limbă + logout. Mobile-first.
**`/app`** — card central: total + scadență + badge status; detaliere completă; facturi atașate (vizualizare/descărcare); "Descarcă PDF". Fără raport → "Raportul lunii nu a fost încă publicat."
**`/app/istoric`** — accordion pe ani: lună, total, plătit, status; click → detaliere per serviciu + facturi; PDF per raport.
**`/app/contract`** — date proprietate (denormalizate din tenanță), perioadă, chirie, garanție, ziua scadentă; descărcare contract semnat.

### 5.5 Reguli transversale UI
Stări: loading (skeleton), gol (mesaj+acțiune), eroare (mesaj+"Reîncearcă"). Confirmare pentru acțiuni distructive sau cu efect asupra chiriașului. Validare inline Zod, în limba selectată. Sume în RON, format românesc.

### 5.6 Interfețe hardware
Captură foto: input file cu atribut capture (camera nativă) — fără UI de cameră custom.

### 5.7 Interfețe software
Firebase: Authentication, Firestore, Storage, Cloud Functions, Extension "Trigger Email" (SendGrid/Mailgun). Emailurile: funcțiile scriu în colecția `mail`, extensia livrează.

### 5.8 Interfețe de comunicare
HTTPS/TLS prin SDK-urile Firebase.

---

## 6. Model de date & securitate

```
users/{userId}                        [ACCES: exclusiv admin]
  - nume, dataNasterii, email, telefon, limbaPreferata: 'ro' | 'en'
  - cnp, pozeActeIdentitate[]
  - adresaCorespondenta (opt), adresaDomiciliuAnterioara
  - contactUrgenta { nume, telefon }
  - numarPersoaneLocuinta, fumator, animaleCompanie { are, tip },
    vehicul { are, marca, numarInmatriculare }
  - angajator, ocupatie, vechimeLocMunca, venitLunar { sursa, suma }
  - garant { nume, cnp, telefon, pozeActe[] (opt) }
  - referintaAnterioara { nume, telefon }
  - status: activ | inactiv-readonly | dezactivat | arhivat

onboardingDrafts/{draftId}            [ACCES: exclusiv admin]
  - campurile pasilor 1-4 (partiale), pasCurent (1-4),
    dataCreare, dataUltimeiModificari, status: 'in_progress'
  // sters automat la finalizarea KYC (FR-TEN-18)

tenancies/{tenancyId}                 [ACCES: admin total; chiriasul citeste unde userId == auth.uid]
  - userId, ownerId, propertyId
  - numeChirias (denormalizat din users, la creare)
  - proprietate { nume, adresa } (denormalizat, sincronizat de onPropertyUpdate)
  - dataStart, dataSfarsit, chirieLunara, garantie (opt), ziuaScadenta
  - soldCurent: number (actualizat automat de onReportWrite — NFR-PERF-04)
  - status: activ | incheiat
  - documenteAtasate[] (contract semnat — vizibil chiriasului)

properties/{propertyId}               [ACCES: exclusiv admin]
  - ownerId, nume, adresa { strada, numar, oras, judet, codPostal }
  - suprafata (opt), numarCamere (opt)
  - servicii: [ { serviceId, nume, sursa: 'catalog' | 'custom' } ]
  - status: liber | ocupat (calculat automat)

serviceCatalog (constanta hardcodata in aplicatie — seed, nu colectie Firestore):
  electricitate | gaz | internet | tv | apa
  // intretinerea NU e in catalog — e camp propriu in raport (FR-REP-01a)
  // serviciile custom se adauga cu nume liber, sursa: 'custom'

monthlyReports/{reportId}             [ACCES: admin total; chiriasul citeste unde userId == auth.uid si status == 'semnat';
                                       public (fara auth) doar prin shareToken valid si nerevocat]
  - ownerId, propertyId, tenancyId, userId, luna, an
  - id compus/unic garantat pe (propertyId + luna + an) — FR-REP-14

  // Fiecare linie de cost are aceeasi forma: suma + observatii + atasamente (FR-REP-03a)
  // "linieCost" = { suma, observatii (optional), atasamente[] (optional) }
  //   atasamente[]: [ { url (Storage ref), nume, tip: 'image'|'pdf'|'doc' } ]
  //   observatiile SI atasamentele sunt vizibile chiriasului (FR-DOC-04)

  - chirie:      linieCost
  - intretinere: linieCost
  - costuriServicii: [ { serviceId, nume (snapshot), ...linieCost } ]
       // TOATE serviciile active apar, inclusiv cu suma 0 sau negativa (FR-REP-03)
  - alteCheltuieli:  [ { descriere, ...linieCost } ]

  - restantaLunaAnterioara, creditLunaAnterioara
  - totalCalculat: number    // suma automata (referinta, ramane vizibila)
  - totalFinal:    number    // totalCalculat sau valoarea ajustata manual de admin (FR-REP-04a/04b)
                             // SINGURA suma datorata — restantele/creditele se calculeaza fata de
                             // totalFinal, NU fata de totalCalculat (FR-REP-04c)
                             // diferenta de rotunjire nu se reporteaza niciodata

  - dataScadenta, statusPlata: platit | partial | neplatit
  - sumaPlatita, metodaPlata: cash | transfer_bancar | altul, dataPlata

  // Semnare / blocare (FR-REP-07, 07a)
  - status: 'ciorna' | 'semnat'    // ciorna = invizibil chiriasului; semnat = blocat + vizibil
  - dataSemnare, dataUltimeiActualizari

  // Link partajabil fara autentificare (FR-REP-07c)
  - shareToken: string             // token aleatoriu lung (min. 32 caractere), imposibil de ghicit
  - shareTokenRevocat: boolean     // revocare manuala de catre admin; invalideaza linkul permanent
  // ATENTIE: ruta publica /r/{shareToken} expune EXCLUSIV acest raport.
  // NU expune: istoricul, contractul, datele personale, alte rapoarte, portalul chiriasului.
  // fara documenteAtasate global — atasamentele sunt exclusiv per linie (FR-DOC-03a)

mail/{mailId}                         [ACCES: doar Cloud Functions — fara acces client]
errorLogs/{logId}                     [Faza 2; ACCES: exclusiv admin]
```

**Storage (căi + reguli):**
- `/users/{userId}/acte/*` și `/users/{userId}/garant/*` — doar admin
- `/tenancies/{tenancyId}/contract/*` — admin + chiriașul tenanței
- `/reports/{reportId}/facturi/*` — admin + chiriașul raportului
- `/drafts/{draftId}/*` — doar admin

**Note:** `costuriServicii[].nume` = snapshot (FR-PROP-08); colecția `utilityReadings` nu există (fără index); denormalizările (numeChirias, proprietate) elimină nevoia oricărui acces al chiriașului la `users`/`properties`.

---

## 7. Arhitectură tehnică

### 7.1 Stack

| Categorie | Alegere |
|---|---|
| Backend | Firebase: Firestore, Authentication, Storage, Cloud Functions, Ext. "Trigger Email" |
| Limbaj frontend | JavaScript |
| Framework | Vite + React (SPA), React Router |
| UI | Tailwind CSS + shadcn/ui |
| Formulare | React Hook Form + Zod |
| Data | TanStack Query |
| Grafice | Recharts *(Faza 2)* |
| PDF | Client-side |
| Foto | input capture (cameră nativă); compresie client (~2000px, ~80%) |
| i18n | react-i18next (RO/EN) |
| Teste | Vitest + React Testing Library + jsdom *(fundație instalată la M1; teste scrise continuu, de la M1 încolo)* |
| Calitate cod | ESLint (analiză), Prettier (formatare), Husky + lint-staged (git hooks: lint+format la commit), commitlint (Conventional Commits), .editorconfig |
| Config & secrete | Variabile de mediu prin `.env` (Vite); cheile Firebase nu se hardcodează; `.env` în `.gitignore` |
| Deploy | Manual, Firebase CLI |
| Structură | Monorepo |

### 7.2 Cloud Functions

| Funcție | Tip | Rol |
|---|---|---|
| `finalizeKyc` | callable (admin) | Validează draftul complet, verifică CNP duplicat + proprietate liberă, creează cont Auth + `users` + `tenancies` (cu denormalizări), generează parola (12+ car.), scrie emailul de credențiale în `mail`, șterge draftul. Atomic. |
| `resetTenantPassword` | callable (admin) | Generează parolă nouă, o setează pe cont, o returnează adminului. |
| `setTenantAccountStatus` | callable (admin) | Dezactivează / reactivează contul unui chiriaș. Setează `disabled: true/false` pe contul Firebase Auth (necesită Admin SDK — clientul nu poate) și sincronizează `users.status` în Firestore. La **dezactivare** revocă și tokenurile active (`revokeRefreshTokens`), astfel încât o sesiune deschisă moare imediat, nu la următorul login. Susține butonul „Dezactivează/Reactivează" din §5.3 (tab **Cont**) și stările din FR-TEN-24. |
| `onReportWrite` | trigger Firestore | Recalculează `soldCurent` pe tenanță; scrie emailul de raport nou/actualizat în `mail`. |
| `onPropertyUpdate` | trigger Firestore | Sincronizează `proprietate { nume, adresa }` în tenanța activă. |
| `dailyScheduler` | programat 09:00 Europe/Bucharest | Remindere restanță (ciclu 3 zile de la scadență, până la achitare) + remindere expirare contract (90/60/30, către admin). |
| `getSharedReport` | callable (public, fără auth) | Servește un raport partajat pe baza `shareToken`. Validează tokenul, verifică `shareTokenRevocat == false` și `status == 'semnat'`, returnează **doar** câmpurile raportului. Singura cale de acces anonim la date; colecția rămâne închisă în Security Rules (FR-REP-07c). |
| `setAdminClaim` | script setup (o singură dată) | Setează custom claim `admin: true` pe contul creat în Console. |

### 7.3 Security Rules — principii
- Admin = custom claim `admin == true` → acces complet peste tot.
- `users`, `onboardingDrafts`, `properties`, `mail`, `errorLogs` → doar admin (client); `mail` — doar Functions.
- `tenancies` → chiriaș: read unde `resource.data.userId == request.auth.uid`.
- `monthlyReports` → chiriaș: read unde `userId == auth.uid && status == 'semnat'`.
- `monthlyReports` → **acces public prin shareToken**: citirea unui raport partajat NU se face direct din client cu reguli Firestore (ar expune colecția), ci printr-o **Cloud Function dedicată** (`getSharedReport`) care: primește tokenul, caută raportul, verifică `shareTokenRevocat == false` și `status == 'semnat'`, și returnează **doar** câmpurile raportului (linii de cost, observații, atașamente, total, scadență, status plată). Nu returnează niciodată date personale, istoric sau alte rapoarte. Colecția rămâne inaccesibilă anonim în Security Rules.
- Nicio operațiune de scriere din client pentru chiriaș, nicăieri.
- Storage conform secțiunii 6.

### 7.4 Structura monorepo

```
/
├── firebase.json, .firebaserc, firestore.rules, firestore.indexes.json, storage.rules
├── functions/                    — Cloud Functions (JavaScript)
│   ├── index.js
│   └── src/ (kyc.js, reports.js, scheduler.js, mail-templates/)
└── web/                          — Vite + React
    ├── src/
    │   ├── components/ui/        — shadcn/ui
    │   ├── components/shared/    — comune (skeleton, empty, confirm-dialog…)
    │   ├── features/             — auth/, properties/, tenants/, onboarding/, reports/, tenant-app/
    │   ├── lib/                  — firebase.js, queryClient.js, i18n/ (ro.json, en.json), pdf/
    │   └── routes/               — definițiile paginilor + guards
    └── tests/
```

### 7.5 Medii
Un singur proiect Firebase (producție) + **Firebase Emulator Suite** pentru dezvoltare locală (Auth, Firestore, Storage, Functions). Deploy manual: `firebase deploy`.

**Strategie plan Firebase (decizie asumată):** dezvoltarea (M0-M6) se face integral pe **planul gratuit Spark + emulatoare locale** — fără card atașat, fără costuri. Emulatoarele includ Storage și Functions complet, deci toate fluxurile (upload poze/documente, funcțiile de backend) sunt dezvoltabile și testabile local. Trecerea pe planul **Blaze** (pay-as-you-go, card necesar) devine obligatorie abia la **deploy în producție (M7)**, deoarece din 2026 Cloud Storage și deployarea Cloud Functions necesită Blaze. La volumul proiectului (5-20 proprietăți) utilizarea rămâne aproape sigur în cotele gratuite incluse în Blaze (1 GiB storage, 10 GB egress/lună, 2M invocări funcții/lună) → factură estimată ~0. **Mitigare obligatorie la activarea Blaze:** alertă de buget Cloud Billing (ex: prag 5 RON/lună) pentru a fi notificat de orice consum neașteptat.

---

## 8. Presupuneri și dependențe
- Adminul are acces la Firebase Console (setup, recuperare parolă proprie).
- Furnizorul email tranzacțional (SendGrid/Mailgun via Extension) configurat.
- Tabletă cu cameră + internet pentru KYC.
- Fără cerințe fiscale. Volum mic (5-20 proprietăți).
- Chiriașul consimte la colectarea datelor KYC (relație directă, față-în-față).
- Adminul comunică personal parolele resetate.

---

## 9. Plan de implementare (milestone-uri)

| # | Milestone | Conținut | Criteriu de "gata" |
|---|---|---|---|
| M0 | Fundație | Proiect Firebase, monorepo, emulatoare, Vite+React+Tailwind+shadcn, i18n schelet, rutare + guards, `setAdminClaim`, **tooling calitate cod (ESLint + Prettier + Husky + lint-staged + commitlint + .editorconfig), gestiune `.env`**, **README.md (setup local: emulatoare, `.env`, `setAdminClaim`; recuperarea accesului admin prin Firebase Console — vezi §2.8)** | Aplicația pornește local; login redirecționează corect pe rol; commit-ul rulează automat lint+format |
| M1 | Proprietăți & servicii | CRUD proprietăți, catalog + custom, arhivare, listă cu căutare, **fundație testare (Vitest + React Testing Library + jsdom + config + script `test`); primele teste scrise odată cu CRUD proprietăți** | Creare/editare/arhivare proprietăți cu servicii; suita de teste rulează verde |
| M2 | Onboarding KYC | Drafturi, wizard 4 pași, captură foto + compresie, `finalizeKyc`, email credențiale, verificare CNP | Onboarding cap-coadă funcțional, credențiale primite |
| M3 | Gestiune chiriași | Detaliu (4 tab-uri), editare profil, resetare parolă, prelungire/încheiere contract | Ciclu de viață complet al chiriașului |
| M4 | Rapoarte & plăți | Formular lunar, publicare/editare + notificări, plăți (marcare/anulare), restanțe/credite, sold automat, Luna curentă, dashboard | Ciclul lunar complet, cu emailuri |
| M5 | Aplicația chiriașului | Dashboard, istoric, contract, facturi vizibile, PDF | Chiriașul vede și descarcă tot |
| M6 | Automatizări & istoric | `dailyScheduler` (remindere), istoric costuri per serviciu | Reminderele pleacă corect; istoricul vizibil |
| M7 | Finisare & lansare | Stări goale/eroare, i18n complet, **teste end-to-end pe fluxurile critice (acoperire finală de regresie — testarea rulează continuu încă din M1, nu începe aici)**, Security Rules finale, **optimizare bundle (code splitting — vezi nota de sub tabel)**, **trecere pe planul Blaze + alertă de buget Cloud Billing**, deploy | Aplicație live, testată |

**Notă M7 — optimizare bundle (code splitting):** lazy loading realizat cu mecanismul nativ React (`React.lazy` + `Suspense`), aplicat la două granularități:
1. **La nivel de rută** — fiecare zonă majoră (portalul admin, portalul chiriașului, ruta publică `/r/`) devine o bucată separată de JavaScript, încărcată la cerere. Prioritate: ruta publică `/r/:shareToken` trebuie să se încarce **fără codul zonei admin** — bundle minim pentru vizitatorul anonim care deschide un raport partajat.
2. **La nivel de componentă grea individuală** — componente scumpe dar rar folosite (generatorul de PDF, vizualizatorul de imagini/documente, graficele Recharts din Faza 2) se încarcă lazy chiar și în interiorul unei pagini deja încărcate, acolo unde măsurarea bundle-ului arată că merită.

Principiul: optimizarea se aplică **după măsurare, nu prematur** — de aceea este plasată la M7, nu mai devreme.

**Notă — strategia de testare (continuă, de la M1):** testarea automată nu este o fază finală, ci o practică continuă. Fundația de testare (**Vitest + React Testing Library + jsdom + config**) se instalează la **M1**, iar de acolo încolo **fiecare funcționalitate nouă vine cu testele ei**, scrise odată cu codul — nu retroactiv. M7 adaugă doar acoperirea **end-to-end pe fluxurile critice**, ca verificare finală de regresie înainte de lansare, nu ca prim moment de testare. Principiul: **cod nou = cod testat**. (M0 rămâne fără teste — fundația de testare intră la M1, odată cu primul cod de produs.)

Fiecare milestone: generare → testare locală (emulatoare) → validare de către administrator → milestone-ul următor.

---

## Anexa A — Template-uri email (RO / EN)

Toate emailurile către chiriaș se trimit în limba lui preferată. Emailurile către admin (A5) — doar română. Placeholder-e: {nume}, {email}, {parola}, {luna_an}, {total}, {data_scadenta}, {suma_restanta}, {proprietate}, {data_sfarsit}, {url}.

### A1 — Credențiale de acces (la finalizarea KYC)
**RO — Subiect:** Contul tău de chiriaș a fost creat
> Bună, {nume},
> Ți-a fost creat un cont în platforma de administrare a chiriei pentru proprietatea {proprietate}.
> Date de autentificare: Email: {email} / Parolă: {parola}
> Accesează platforma la: {url}
> Aici vei găsi, lunar, raportul cu suma de plată, data scadentă și istoricul plăților tale.

**EN — Subject:** Your tenant account has been created
> Hi {nume},
> An account has been created for you on the rental management platform for {proprietate}.
> Login details: Email: {email} / Password: {parola}
> Access the platform at: {url}
> Each month you'll find your payment report, due date, and payment history here.

### A2 — Raport nou publicat
**RO — Subiect:** Raportul pentru {luna_an} este disponibil — {total} lei
> Bună, {nume},
> Raportul lunar pentru {luna_an} a fost publicat.
> Total de plată: {total} lei / Data scadentă: {data_scadenta}
> Detaliile complete: {url}

**EN — Subject:** Your {luna_an} report is available — {total} RON
> Hi {nume},
> Your monthly report for {luna_an} has been published.
> Total due: {total} RON / Due date: {data_scadenta}
> Full details: {url}

### A3 — Raport actualizat
**RO — Subiect:** Raportul pentru {luna_an} a fost actualizat
> Bună, {nume},
> Raportul lunar pentru {luna_an} a fost actualizat de proprietar.
> Total de plată actualizat: {total} lei / Data scadentă: {data_scadenta}
> Verifică detaliile: {url}

**EN — Subject:** Your {luna_an} report has been updated
> Hi {nume},
> Your monthly report for {luna_an} has been updated by the landlord.
> Updated total due: {total} RON / Due date: {data_scadenta}
> Check the details: {url}

### A4 — Reminder restanță (la 3 zile după scadență, repetat la 3 zile)
**RO — Subiect:** Reamintire: plată restantă — {suma_restanta} lei
> Bună, {nume},
> Îți reamintim că există o sumă restantă de {suma_restanta} lei pentru {proprietate}, scadentă la {data_scadenta}.
> Te rugăm să contactezi proprietarul pentru achitare.
> Detalii: {url}

**EN — Subject:** Reminder: overdue payment — {suma_restanta} RON
> Hi {nume},
> This is a reminder that an overdue amount of {suma_restanta} RON is pending for {proprietate}, due on {data_scadenta}.
> Please contact the landlord to settle the payment.
> Details: {url}

### A5 — Reminder expirare contract (către admin; 90/60/30 zile; doar RO)
**Subiect:** Contract în expirare: {proprietate} — {data_sfarsit}
> Contractul chiriașului {nume} pentru proprietatea {proprietate} expiră la {data_sfarsit}.
> Acțiuni posibile: prelungește contractul (editează data de sfârșit) sau planifică încheierea și offboarding-ul.
> Deschide tenanța: {url}
