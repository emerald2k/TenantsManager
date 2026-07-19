# SRS — Software Requirements Specification
# Tenant Management Platform

*Version 4.3 — FINAL, ready for codebase generation.*

***v4.3 corrections, resulting from confronting the specification with a real monthly report used in practice:***
- *FR-REP-03 — inverted: all active services appear in the report, regardless of amount (including 0/negative). Previously they were hidden — wrong.*
- *FR-REP-03a (new) — notes + attachments **per cost line** (the supporting invoice next to the amount it justifies), visible to the tenant.*
- *FR-REP-04a/04b/04c (new) — the total can be adjusted manually at publication (commercial rounding for cash payment); the system suggests rounding down to a multiple of 5 RON, editable. `finalTotal` is the only amount owed — arrears and credits are computed against it, not against the exact total; the rounding difference never reappears.*
- *FR-DOC-03a (new) — global report-level attachment was removed; documents are attached exclusively per line.*
- *FR-REP-07/07a (revised) — "publishing" becomes **signing**: the list locks on signing; corrections require explicit unlocking + re-signing (notification "list updated").*
- *FR-REP-07b/07c (new) — export to **PDF**, **PNG image** (for WhatsApp) and **shareable link without login**. The link uses a random token, does not expire, is manually revocable, and exposes **only the month's report** — not the portal, the history, or personal data. Served through a Cloud Function (`getSharedReport`), not through anonymous Firestore access.*

*Includes: consolidated security model (admin-only users, denormalized data), code quality tooling in the foundation (ESLint, Prettier, Husky, lint-staged, commitlint, .editorconfig), `.env` management, preferred language per tenant, total formula (maintenance = category separate from services), service catalog (electricity/gas/internet/TV/water + custom), no format validation on fields, report uniqueness per property+month+year, empty state on first launch, the technical implementation specification (Cloud Functions, Security Rules, monorepo, environments), the milestone plan, and the appendix with email templates.*

---

## 1. Introduction

### 1.1 Purpose
This document specifies the product, functional and non-functional requirements for a web platform that allows a property owner to manage the relationship with their tenants: detailed onboarding (KYC), property assignment, services and monthly expenses, reports, payments and history.

### 1.2 Application scope
The application serves a single administrator (owner), managing 5-20 properties (apartments), each with at most one active tenant at a time. It does not include fiscal invoicing and does not process online payments.

### 1.3 Definitions and acronyms

| Term | Definition |
|---|---|
| Admin | The administrator/owner, the user with full access to the backoffice |
| Tenant | User with limited access to their own tenancy |
| Tenancy | The contractual relationship between a tenant and a property, over a period of time |
| Guarantor | Person co-signing/co-obligated for payment, without their own account in the system |
| Service | A recurring monthly cost associated with a property (e.g. electricity, water, gas, internet, TV), with a fixed amount entered monthly. Rent and maintenance are NOT services — they are separate categories. |
| KYC | Know Your Customer — the mandatory process of collecting tenant data at onboarding |
| Denormalization | Copying data from one document into another, for secure/fast access, with automatic synchronization |
| BaaS | Backend-as-a-Service (Firebase) |
| FR / NFR | Functional / non-functional requirement |
| MVP | Minimum Viable Product — the essential core, Phase 1 |
| Soft-delete | Archiving/deactivation that preserves historical data, without physical deletion |

### 1.4 Document overview
Section 2 — the product: problem, objectives, release plan, risks. Section 3 — functional requirements. Section 4 — non-functional requirements. Section 5 — the UI specification (routes, pages, states) and interfaces. Section 6 — the data model and its security. Section 7 — technical architecture (stack, Cloud Functions, Security Rules, monorepo, environments). Section 8 — assumptions and dependencies. Section 9 — the implementation plan (milestones). Appendix A — the email templates.

---

## 2. General description

### 2.1 Problem and objectives
Manually managing rents and expenses for 5-20 properties consumes time, is error-prone, and can generate misunderstandings with tenants due to a lack of transparency and clear history. Insufficient data collection at onboarding exposes the owner to risks.

**Objectives:**
- Reducing the time spent monthly on tracking expenses and rent.
- Full transparency with tenants (including access to supplier invoices attached to reports), to reduce misunderstandings.
- A complete, clear and easily accessible history — including the evolution over time of each service's cost, per property.
- Collecting a complete and verified profile of each tenant at onboarding (KYC), for the owner's legal and financial safety — reducing the risk of renting to a person with malicious intent — and to have at hand all the data needed when drafting the rental contract (drafted separately, outside the application).

### 2.2 Success metric
After 6 months of use: the administrator always has access to a clear and complete history (financial and tenant-related), which they can return to at any time, without effort of searching or manual reconstruction.

### 2.3 Product perspective
Standalone web application (SPA), backend entirely on Firebase (BaaS). Two interfaces: administrator backoffice (including on tablet, for face-to-face onboarding) and tenant dashboard (mobile-first).

### 2.4 Main functions
- Detailed KYC onboarding (4-step wizard, complete profile, ID photos captured live) — the only way to create a tenant account.
- Managing properties and available services (catalog + custom).
- Monthly entry of each service's cost and automatic report generation.
- History per property: monthly evolution of each service's cost + total.
- Marking payments, automatic handling of arrears and credits.
- Tenant access to their own reports, documents and attached invoices.
- Automatic email notifications, in the tenant's preferred language.

### 2.5 User classes

| Class | Technical level | Frequency |
|---|---|---|
| Administrator | Ordinary web user; tablet at onboarding | Monthly (expenses), ad-hoc (onboarding/offboarding) |
| Tenant | Ordinary web/mobile user | Monthly (viewing the report) |

### 2.6 Constraints
No fiscal invoicing; no online payments; a single admin; currency exclusively RON; responsive web, no native mobile application.

### 2.7 Release plan: MVP and Phase 2

**MVP (Phase 1)** — launched directly for all properties: setup & authentication; complete KYC onboarding (wizard, drafts) + contracts + offboarding; properties + services; monthly costs + reports; cost history per service (tabular); payments + arrears/credits + email reminders; tenant account (dashboard, history, contract, PDF); documents; bilingual RO/EN; admin dashboard + Current month; simple error handling.

**Phase 2:** aggregated admin reports (FR-REP-09, FR-REP-10); chart of cost evolution per service (completing FR-PROP-09); automatic retry + error log (FR-SYS-01, FR-SYS-02).

**Explicitly out of scope (any phase):** fiscal invoicing, online payments, multi-admin, native mobile application, 2FA, in-app notifications, bulk expense entry, general CSV/Excel export, dark mode, audit trail, historical data migration, guarantor identity verification, self-service password reset/change, automatic contract generation, meter-index-based calculation.

**Tooling consciously avoided (not bloat, but over-engineering for this project):** TypeScript (assumed decision — plain JavaScript), Storybook, automatic CI/CD (manual deploy in MVP; possibly GitHub Actions in Phase 2), Docker, production error monitoring (Sentry — possibly Phase 2+). These tools are professional standards, but add unjustified complexity at the scale and solo context of this project.

### 2.8 Identified risks

| Risk | Mitigation |
|---|---|
| Single admin — losing access blocks management | Recovery through Firebase Console (documented in README) |
| Email delivery without retry in MVP | Periodic manual check until Phase 2 |
| Firebase dependency | Free tier sufficient for 5-20 properties; monitoring |
| Large volume of personal data at KYC | `users` entirely admin-only (Security Rules), implicit encryption |
| Passwords communicated manually (no self-service) | Randomly generated, strong passwords (12+ characters) |

---

## 3. Functional requirements

### 3.1 Authentication & Setup module (AUTH)

| ID | Requirement |
|---|---|
| FR-AUTH-01 | The administrator account is created manually, once, directly from the Firebase Console — without a public registration screen. The admin role is marked through a custom claim (`admin: true`), set through a setup script run once. |
| FR-AUTH-02 | Single authentication screen, common to all roles. |
| FR-AUTH-03 | After authentication, the system determines the role (custom claim) and redirects accordingly. |
| FR-AUTH-04 | **No self-service password reset/change** — no "forgot password" link, no change option in the tenant's account. A tenant's password is reset only by the admin, from the tenant's detail page: the system generates a new password and displays it to the admin, who communicates it to the tenant. The admin's password is recovered exclusively through the Firebase Console. |
| FR-AUTH-05 | Session active until manual logout — no inactivity expiry. |
| FR-AUTH-06 | Password minimum 6 characters; no 2FA. System-generated passwords: random, 12+ characters. |
| FR-AUTH-07 | On KYC completion, the system automatically generates a password and sends the credentials (login email + password) to the tenant's email, in their preferred language. It is not repeated for subsequent tenancies on the same account. |

### 3.2 KYC Onboarding & Tenant Management module (TEN)

| ID | Requirement |
|---|---|
| FR-TEN-01 | Onboarding is a **mandatory KYC process**: a 4-step wizard — (1) personal data, (2) ID document photos, (3) financial/professional data, (4) contract data. Designed for face-to-face completion, on a tablet. |
| FR-TEN-02 | **Step 1** collects: full name, date of birth, CNP, phone, email, **preferred language (RO/EN)**, mailing address (optional), previous address, emergency contact (name+phone), number of occupants in the property, smoker/non-smoker, pets (yes/no+type), vehicle (yes/no; if yes: make+plate number). |
| FR-TEN-03 | **Step 2**: direct photography with the native camera (capture button, no custom preview). At least one photo mandatory. |
| FR-TEN-04 | **Step 3**: employer, occupation/role, employment duration, source+level of monthly income, guarantor (name, CNP, phone — mandatory; guarantor ID photos — **optional, non-blocking**), previous reference (name, phone). |
| FR-TEN-05 | **Step 4**: contract data (see 3.3). |
| FR-TEN-06 | All fields in steps 1 and 3 are mandatory, except: mailing address, guarantor ID photos. |
| FR-TEN-07 | Existing email at Step 1 → new tenancy linked to the existing account, jump directly to Step 4. |
| FR-TEN-08 | New email → the account is created on KYC completion (Cloud Function `finalizeKyc`). |
| FR-TEN-09 | **All** tenant data (profile + KYC) is stored in the `users` collection, with **admin-only** access — the tenant has no read access to their own document. The tenant application uses exclusively the denormalized data from the tenancy and their own reports. |
| FR-TEN-10 | Sensitive data is kept permanently, without automatic deletion. |
| FR-TEN-11 | All profile data is editable exclusively by the admin. |
| FR-TEN-12 | Deleting a tenant = soft-delete; the financial history remains permanently. |
| FR-TEN-13 | Tenant list: name, contact, current property, outstanding balance, status; alphabetical sorting, text search. |
| FR-TEN-14 | Assignment to an occupied property is blocked. |
| FR-TEN-15 | An account can accumulate a history of several tenancies over time, under the same login. |
| FR-TEN-16 | Full KYC completion is the **only way** to create a tenant account. The account + the credentials email are created/sent only after all mandatory steps are completed. There is no partial account and no other creation path. |
| FR-TEN-17 | Unfinished onboarding is saved as a **draft**, resumable from the current step. The draft does not generate an account. |
| FR-TEN-18 | On KYC completion, the draft data is transferred into `users`/`tenancies`, and the draft is deleted automatically. |
| FR-TEN-19 | Drafts appear in the tenant list with the status "in progress" + "Continue"/"Delete draft" actions. |
| FR-TEN-20 | Drafts are deleted only manually — no automatic expiry. |
| FR-TEN-21 | Multiple drafts in parallel, without limit. |
| FR-TEN-22 | On completion, CNP uniqueness check: duplicate → completion **blocked** + display of the conflicting tenant. |
| FR-TEN-23 | Onboarding (draft) allowed for an occupied property; **completion blocked** until the current contract ends. |
| FR-TEN-24 | Tenant account states: `active` / `inactive-readonly` / `disabled` / `archived`. (The account is active immediately after creation — there is no "invited" state.) |

### 3.3 Contracts / Tenancies module (CON)

| ID | Requirement |
|---|---|
| FR-CON-01 | Contract: property, start date, end date (mandatory), monthly rent, security deposit (optional), due day. |
| FR-CON-02 | One account — at most one active tenancy at a time. |
| FR-CON-03 | Manual termination at any time, including early. |
| FR-CON-04 | Termination blocked if there are unpaid arrears. |
| FR-CON-05 | On termination: the property becomes "free", the account moves to "inactive-readonly". |
| FR-CON-06 | Extension = editing the end date on the same tenancy. |
| FR-CON-07 | The attached signed contract is visible/downloadable by the tenant. |
| FR-CON-08 | Passing the end date does not trigger anything automatically — the contract remains "active" until manual termination. |
| FR-CON-09 | Email reminders to the admin **90, 60 and 30 days** before expiry (sent at 09:00, Europe/Bucharest). |

### 3.4 Properties & Services module (PROP)

| ID | Requirement |
|---|---|
| FR-PROP-01 | Property: name, street, number, city, county (mandatory), postal code, area, rooms (optional). |
| FR-PROP-02 | Each property has a **service list** managed by the admin (add/remove) from the property page: **predefined catalog** (electricity, gas, internet subscription, TV subscription, water) + **custom services** (free-form name). Maintenance is NOT a service — it is a separate category, alongside rent (FR-REP-01a). |
| FR-PROP-03 | All services have a **fixed monthly amount**, entered manually in the month's report — no meter-index calculation. |
| FR-PROP-04 | Property data and services are editable at any time, regardless of occupancy. |
| FR-PROP-05 | Status (free/occupied) computed automatically from active tenancies. |
| FR-PROP-06 | Deleting a property with history = soft-delete. |
| FR-PROP-07 | Property list: name, address, status, outstanding balance; alphabetical sorting, search. |
| FR-PROP-08 | Removing a service does not affect published reports (name+cost snapshot); the service disappears only from future reports. |
| FR-PROP-09 | The property page includes the **cost history**: table of months × (rent + maintenance + services + other + total) — the evolution of each service's cost over time. *(Phase 2: chart on the same data.)* |
| FR-PROP-10 | The property's name and address are denormalized into the active tenancy and synchronized automatically (Cloud Function) when the property is edited. |

### 3.5 Expenses & Monthly Reports module (REP)

| ID | Requirement |
|---|---|
| FR-REP-01 | Monthly entry, per property (individually): maintenance (own field) + the cost of each active service + "other expenses" (description+amount, free list). Rent taken from the contract. |
| FR-REP-01a | The cost categories are: **rent** (from the contract, editable on a per-month basis), **maintenance** (own field, separate from services), **services** (list per property), **other expenses** (one-off, free list). |
| FR-REP-02 | Rent adjustable on a per-month basis for the current month, without modifying the contract. |
| FR-REP-03 | **All active services** of the property appear in the report, **regardless of amount** — including 0 or negative values (adjustments). The reason: transparency — the tenant sees that the service was taken into account, not omitted. The same for rent and maintenance. |
| FR-REP-03a | Each cost line (rent, maintenance, each service, other expenses) can have: an **optional notes field** (free text, filled in by the admin when entering the cost) and **optional attachments** (image/PDF/document — e.g. the supplier's invoice for that service). Both are **visible to the tenant** (full transparency). |
| FR-REP-04 | Total computed automatically: **rent + maintenance + service costs + other expenses + previous month's arrears − previous month's credit**; arrears and credit appear as separate lines. |
| FR-REP-04a | When publishing the report, the administrator can **manually adjust the final total** (e.g. commercial rounding: 2382.17 → 2380). The adjusted amount becomes the **final total owed** — the difference is not carried forward, does not generate arrears and is not kept as a balance. The automatically computed total remains visible as a reference. |
| FR-REP-04b | The system **automatically suggests** rounding down to the nearest multiple of 5 RON (e.g. 2518.71 → suggestion 2515), based on the administrator's current practice — to facilitate cash payment. The suggestion is displayed as a pre-filled value in the final total field, but remains **fully editable** — the administrator can accept it, change it to another value, or return to the exact computed total. The suggestion is never applied without confirming publication. |
| FR-REP-04c | **`finalTotal` is the only amount owed** and the basis for all subsequent payment calculations. Arrears and credit are computed exclusively against `finalTotal` (the rounded amount), NOT against `calculatedTotal`. Example: calculatedTotal 2518.71 → finalTotal rounded 2515.00 → the tenant pays 2000 → the arrears are 515.00 (not 518.71). The rounding difference never reappears, in any form. |
| FR-REP-05 | Due date taken from the contract (due day), manual override per month possible. |
| FR-REP-06 | On **signing** (finalizing the list) → email notification to the tenant (in their language), with a link to the report. |
| FR-REP-07 | **Signing** is the act by which the administrator confirms the validity and finality of the payment list. Report states: `draft` (in progress, invisible to the tenant) → `signed` (finalized, locked, visible to the tenant). After signing, the report is **locked for editing**. |
| FR-REP-07a | A signed report can be **unlocked** by the administrator through an explicit action (button "Unlock for correction" + confirmation dialog). After correction and re-signing, the tenant automatically receives a **"list updated"** notification. Editing is not possible without prior unlocking — a signed report cannot be modified accidentally. |
| FR-REP-07b | **Signed report export**, available to the administrator in three forms: (a) **PDF** (archive/email), (b) **PNG image** (ready to send on WhatsApp — reproduces the table with the cost lines and attachments), (c) **shareable link** (see FR-REP-07c). |
| FR-REP-07c | **Shareable link without authentication** — allows the tenant to see the report instantly, without login (e.g. sent on WhatsApp). Mandatory rules: (1) it contains a **long random token, impossible to guess** (not sequential IDs); (2) it opens **only that month's report** — NOT the tenant portal, NOT the history, NOT the contract, NOT personal data; (3) it **does not expire**, but can be **manually revoked** by the administrator at any time (revocation invalidates the link permanently); (4) for the complete history, contract and other reports, the tenant must authenticate into their account. |
| FR-REP-08 | There is no automatic publication — the report is visible to the tenant only after signing. Corrections are made through unlock → edit → re-sign (FR-REP-07a). |
| FR-REP-09 | *(Phase 2)* Global filterable list of reports. |
| FR-REP-10 | *(Phase 2)* Aggregated annual report (general totals), without export. |
| FR-REP-11 | Retroactive reports allowed for any past month. |
| FR-REP-12 | Recalculation of arrears/credits (from retroactive reports or cancelled payments) propagates **only into future reports** — published ones remain untouched; corrections on published months are made through manual editing. |
| FR-REP-13 | The first month of a contract started mid-month: full rent; pro-rata adjustment is done manually (FR-REP-02). |
| FR-REP-14 | A report is uniquely identified by the combination **property + month + year**. There cannot be two reports for the same property in the same month — when attempting to create a duplicate, the system opens the existing report for editing. |

### 3.6 Payments & Arrears module (PAY)

| ID | Requirement |
|---|---|
| FR-PAY-01 | Payment is marked manually by the admin: amount, method (cash/bank transfer/other), date. |
| FR-PAY-02 | Partial payments allowed; the difference becomes arrears. |
| FR-PAY-03 | Arrears are carried forward automatically into the next report ("Previous month's arrears"). |
| FR-PAY-04 | Email reminder 3 days after the due date, repeated every 3 days until full settlement (sent at 09:00, Europe/Bucharest). |
| FR-PAY-05 | Overpayment allowed; the excess becomes **credit**, applied automatically in the next report ("Previous month's credit"). |
| FR-PAY-06 | Payments can be cancelled/corrected; the report returns to the previous status. The effects on future months follow FR-REP-12. |

### 3.7 Tenant Account module (TAPP)

| ID | Requirement |
|---|---|
| FR-TAPP-01 | Dashboard: current month total (the final total), due date, payment status, breakdown by lines (rent + maintenance + all active services + other + arrears/credit), with **each line's notes and attachments visible** (the supporting invoice next to its amount). |
| FR-TAPP-02 | Report history (grouped by years), with status and breakdown per service + invoices attached on opening. |
| FR-TAPP-03 | Property/contract data + download of the signed contract. |
| FR-TAPP-04 | PDF download per monthly report (client-side, in the preferred language). |
| FR-TAPP-05 | The tenant cannot edit anything in their profile and cannot change their password. |
| FR-TAPP-06 | After the contract ends: read-only access to their own history. |

### 3.8 Administrator Dashboard module (DASH)

| ID | Requirement |
|---|---|
| FR-DASH-01 | Dashboard: total to collect for the current month + aggregated total arrears. |
| FR-DASH-02 | Quick access to the "Current month" page — occupied properties with the status of the month's report. |
| FR-DASH-03 | **First launch** (zero properties and zero tenants): the dashboard displays an empty state with only two prominent actions — "Add property" and "Enroll tenant" (onboarding). Totals and "Current month" appear only once data exists. The suggested logical order: first the property (with its services), then the tenant (KYC + contract). |

### 3.9 Documents module (DOC)

| ID | Requirement |
|---|---|
| FR-DOC-01 | Attachable documents: ID document photos (tenant mandatory, guarantor optional), signed contract, and **invoices/supporting documents per cost line** in the monthly report (FR-REP-03a). |
| FR-DOC-02 | Attachment is optional, except for the tenant's ID photos (mandatory at KYC). |
| FR-DOC-03 | Multiple files per cost line / contract. Accepted formats: image, PDF, document. |
| FR-DOC-03a | **There is no global report-level attachment** — supporting documents are attached exclusively **per cost line** (each invoice next to the amount it justifies), for clarity. |
| FR-DOC-04 | Visibility: signed contract + per-cost-line attachments — visible to the tenant (full transparency); ID photos (tenant and guarantor) — admin only. |
| FR-DOC-05 | Upload maximum 10 MB/file; images compressed automatically on the client (~2000px, ~80%). |

### 3.10 System & Errors module (SYS)

| ID | Requirement |
|---|---|
| FR-SYS-01 | *(Phase 2)* Automatic retry for failed operations. |
| FR-SYS-02 | *(Phase 2)* Error log visible to the admin. MVP: clear error messages in the interface. |
| FR-SYS-03 | No in-app notifications — email exclusively. |
| FR-SYS-04 | All scheduled jobs run at **09:00, Europe/Bucharest time zone**. |

---

## 4. Non-functional requirements

### 4.1 Security & GDPR

| ID | Requirement |
|---|---|
| NFR-SEC-01 | Security Rules: admin (custom claim) — full access; tenant — read exclusively on their own tenancies and signed reports. Anonymous access to Firestore remains entirely forbidden; shared reports are served exclusively through a Cloud Function that validates the token (FR-REP-07c). |
| NFR-SEC-02 | The `users` (profile + KYC), `onboardingDrafts`, `mail`, `errorLogs` collections — admin-only access. Data kept permanently. |
| NFR-SEC-03 | Email+password authentication, min. 6 characters; no 2FA; generated passwords: 12+ random characters. |
| NFR-SEC-04 | A single admin account, permanent. |
| NFR-SEC-05 | No automatic logout. |
| NFR-SEC-06 | No audit trail on reports. |
| NFR-SEC-07 | Encryption at rest + TLS, implicit through Firebase. |
| NFR-SEC-08 | Storage: ID photos — admin only; contracts + invoices — admin + the tenant of the respective tenancy. |
| NFR-SEC-09 | Authentication and authorization rely entirely on Firebase Authentication. Firebase automatically manages session tokens (JWT-type ID token: issuing, signing, hourly renewal, attaching to requests and verification) — **the application does not create, sign or manually validate tokens**. The administrator role is stored as a **custom claim** (`admin: true`) in the token, set once at setup; Security Rules read `request.auth.uid` and `request.auth.token.admin` from the token already validated by Firebase. No server-side sessions, session cookies or custom token logic are implemented. |

### 4.2 Performance & Availability
NFR-PERF-01: comfortable support for 5-20 properties, without special optimizations. NFR-PERF-02: no additional paid backup. NFR-PERF-03: no CSV/Excel export. NFR-PERF-04: the current outstanding balance is stored on the tenancy and updated automatically (Cloud Function) on any report/payment change — lists load from a single read.

### 4.3 UX & Design
NFR-UX-01: simple interface, without custom branding. NFR-UX-02: light mode only. NFR-UX-03: responsive; KYC wizard optimized for tablet; the tenant interface mobile-first.

### 4.4 Compatibility
NFR-COMPAT-01: modern browsers/devices (recent Chrome, Safari), including tablets; no legacy.

### 4.5 Localization
NFR-LOC-01: bilingual RO/EN interface (i18n); validations in the selected language. NFR-LOC-02: currency exclusively RON, Romanian format (1.234,56 lei). NFR-LOC-03: no data migration. NFR-LOC-04: automatic emails and PDFs are generated in the **tenant's preferred language** (field set by the admin at KYC, editable later); emails to the admin — in Romanian.

### 4.6 Data validation
NFR-VAL-01: mandatory fields are checked only for presence (filled in/not filled in), **without format validation** — CNP, phone, email, plate number etc. accept any text. No check algorithms (e.g. CNP validation), format rules or input masks are implemented. (Assumed decision: the admin enters the data personally, face-to-face, so correctness is ensured by a human.)

---

## 5. UI specification — routes, pages and interfaces

### 5.1 Route map

```
PUBLIC
  /login                          — single authentication screen
  /r/:shareToken                  — shared report, WITHOUT authentication (FR-REP-07c)
                                    exposes ONLY that month's report; nothing else

ADMIN (layout with sidebar; collapsible on tablet)
  /admin                          — dashboard (totals)
  /admin/current-month            — report entry status, selected month
  /admin/properties               — property list
  /admin/properties/new           — property creation
  /admin/properties/:id           — detail (data, services, cost history)
  /admin/tenants                  — tenant list (incl. KYC drafts)
  /admin/onboarding/:draftId      — KYC wizard, 4 steps
  /admin/tenants/:id              — tenant detail (tabs)
  /admin/reports/:propertyId      — monthly report form (?month=&year=)
  /admin/reports                  — (Phase 2) global list
  /admin/annual-report            — (Phase 2) annual report

TENANT (top navbar; mobile-first)
  /app                            — dashboard
  /app/history                    — report history by year
  /app/contract                   — property data + contract
```

Route guards: unauthenticated → `/login`; tenant on `/admin/*` → `/app`; admin on `/app/*` → `/admin`.

### 5.2 Public area
**`/login`** — centered card: title, email, password, "Sign in", RO/EN selector. **No "forgot password"**. States: loading on the button; generic error "Incorrect email or password"; disabled/archived account → "Account disabled. Contact the owner." Already authenticated → redirect by role.

### 5.3 Administrator area

**Navigation:** sidebar (Dashboard, Current month, Properties, Tenants; + Reports, Annual report in Phase 2); at the bottom: language, logout. Collapsible on tablet.

**`/admin`** — 2 cards: "Total to collect this month", "Total arrears" (red if >0); card-button → Current month. Skeleton while loading; 0 displayed normally.

**`/admin/current-month`** — month/year selector (current by default, navigable backwards); list of occupied properties: name, tenant, status badge (not entered/published/paid/partial/overdue), total; click → the report form. Free properties do not appear.

**`/admin/properties`** — table: name, address, status, outstanding balance (red); search *(deferred past M1 — still required, rescheduled)*, alphabetical sorting, "+ Add property"; archived hidden by default, "Show archived" toggle.

**`/admin/properties/new`** — property data form; on save → detail (where the services are configured).

**`/admin/properties/:id`** — 4 sections: (1) **Data** — the fields read-only, "Edit" opens the same form as creation; link to the current tenant *(deferred to M2: there are no tenancies before it)*; (2) **Services** — the active list with removal (+confirmation), "+ Add service" → catalog dialog (electricity, gas, internet, TV, water) + custom; (3) **Archiving** — its own section, not inside Data: "Archive" (+confirmation), blocked while the property is occupied, with an explanatory message; (4) **Cost history** — table of months × (rent + maintenance + services + other + total), empty cells where the service did not exist; below the table: tenancy history. *(Phase 2: chart.)*

**`/admin/tenants`** — table: name, phone, email, property, outstanding balance, status badge (active / **in progress** / inactive / disabled); drafts with "Continue"/"Delete draft" inline; search; "+ New tenant onboarding" → creates a draft, opens the wizard.

**`/admin/onboarding/:draftId`** — tablet wizard: large fields, one step/screen, progress 1-4, "Back"/"Continue", automatic draft saving on navigation + "Save and close".
- Step 1: the FR-TEN-02 fields (including **preferred language**); existing email on blur → dialog "Existing tenant — new tenancy" → jump to Step 4.
- Step 2: large button "Photograph document" (capture), thumbnail grid + deletion, min. 1.
- Step 3: the FR-TEN-04 fields; guarantor photos marked "optional".
- Step 4: property dropdown (occupied ones disabled + note), contract, due day.
- Completion: full validation; duplicate CNP → blocking dialog with link; success → "Account created, credentials sent by email" + profile link.

**`/admin/tenants/:id`** — tabs: (1) **Profile** — KYC data by section, editing per section, photo gallery (lightbox), editable preferred language; (2) **Tenancy & contract** — active/last contract, documents, "Extend", "End contract" (blocked on arrears, with a message); (3) **Financial history** — all reports, status + link; (4) **Account** — status; "Reset password" (dialog with the generated password + copy), "Disable/Re-enable", "Archive".

**`/admin/reports/:propertyId?month=&year=`** — header: property + tenant + month + badge.

The body is a **table of cost lines**, each line having the same structure (inspired by the table used in practice): **name | amount | notes + attachments**.
- (1) **Rent** — pre-filled from the contract, editable ("valid only for the current month")
- (2) **Maintenance** — own amount field
- (3) **Services** — one line for **each active service** of the property; ALL appear, even if the amount is 0 or negative (FR-REP-03)
- (4) **Other expenses** — dynamic list (description + amount)
- On **each line**: optional **notes** field (free text, e.g. "Adjustment after index submission") + **attachments** area (image/PDF/doc — e.g. the supplier's invoice). Both visible to the tenant (FR-REP-03a, FR-DOC-03a).
- (5) **Previous arrears/credit** — readonly (red/green)
- (6) **Due date** — pre-filled, editable

Sticky footer: **calculated total** (automatic, readonly, as a reference) + **final total** field (editable, pre-filled with the **suggestion of rounding down to a multiple of 5** — FR-REP-04b; the admin accepts it, changes it, or returns to the exact total) + **"Sign the list"** (confirmation dialog: "The list becomes final and locked; the tenant receives a notification"). After signing: the report is **locked** — the **"Unlock for correction"** button appears (confirmation; on re-signing the tenant receives "list updated"), plus the **export** area: download **PDF**, download **PNG image** (for WhatsApp), and **copy shareable link** (with a **revoke** button).

After publication — **payment** section: amount, method, date, "Mark payment", "Cancel payment", credit indicator on overpayment.

### 5.4 Tenant area
**Navigation:** navbar — Home, History, Contract + language + logout. Mobile-first.
**`/app`** — central card: total + due date + status badge; full breakdown; attached invoices (view/download); "Download PDF". No report → "This month's report has not been published yet."
**`/app/history`** — accordion by year: month, total, paid, status; click → breakdown per service + invoices; PDF per report.
**`/app/contract`** — property data (denormalized from the tenancy), period, rent, security deposit, due day; download of the signed contract.

### 5.5 Cross-cutting UI rules
States: loading (skeleton), empty (message+action), error (message+"Retry"). Confirmation for destructive actions or those affecting the tenant. Inline Zod validation, in the selected language. Amounts in RON, Romanian format.

### 5.6 Hardware interfaces
Photo capture: file input with the capture attribute (native camera) — without a custom camera UI.

### 5.7 Software interfaces
Firebase: Authentication, Firestore, Storage, Cloud Functions, "Trigger Email" Extension (SendGrid/Mailgun). Emails: the functions write into the `mail` collection, the extension delivers.

### 5.8 Communication interfaces
HTTPS/TLS through the Firebase SDKs.

---

## 6. Data model & security

```
users/{userId}                        [ACCESS: admin only]
  - name, dateOfBirth, email, phone, preferredLanguage: 'ro' | 'en'
  - cnp, idDocumentPhotos[]
  - mailingAddress (opt), previousAddress
  - emergencyContact { name, phone }
  - occupantCount, smoker, pets { has, type },
    vehicle { has, make, plateNumber }
  - employer, occupation, employmentDuration, monthlyIncome { source, amount }
  - guarantor { name, cnp, phone, idDocumentPhotos[] (opt) }
  - previousReference { name, phone }
  - status: active | inactive-readonly | disabled | archived
  // `cnp` keeps its Romanian name deliberately: it is a Romanian domain term
  // (the national identification number), like IBAN — it has no exact English equivalent.

onboardingDrafts/{draftId}            [ACCESS: admin only]
  - the fields of steps 1-4 (partial), currentStep (1-4),
    createdAt, updatedAt, status: 'in_progress'
  // deleted automatically on KYC completion (FR-TEN-18)

tenancies/{tenancyId}                 [ACCESS: admin full; the tenant reads where userId == auth.uid]
  - userId, ownerId, propertyId
  - tenantName (denormalized from users, at creation)
  - property { name, address } (denormalized, synchronized by onPropertyUpdate)
  - startDate, endDate, monthlyRent, securityDeposit (opt), dueDay
  - currentBalance: number (updated automatically by onReportWrite — NFR-PERF-04)
  - status: active | ended
  - attachedDocuments[] (signed contract — visible to the tenant)

properties/{propertyId}               [ACCESS: admin only]
  - ownerId, name, address { street, number, city, county, postalCode }
  - area (opt), roomCount (opt)
  - services: [ { serviceId, name, source: 'catalog' | 'custom' } ]
                               // serviceId: for 'catalog' it is the catalog key (electricity, gas…);
                               // for 'custom' it is a generated UUID (crypto.randomUUID) — a custom
                               // service has no natural key, and a UUID keeps two services with the
                               // same name distinct.
  - status: free | occupied (computed automatically)
  - archived: boolean          // soft-delete (FR-PROP-06); set explicitly to false at creation.
                               // Separate axis from `status`: `status` is occupancy (computed
                               // from tenancies), `archived` is the admin's decision to retire
                               // the property while keeping its history.

serviceCatalog (constant hardcoded in the application — seed, not a Firestore collection):
  electricity | gas | internet | tv | water
  // maintenance is NOT in the catalog — it is its own field in the report (FR-REP-01a)
  // custom services are added with a free-form name, source: 'custom'

monthlyReports/{reportId}             [ACCESS: admin full; the tenant reads where userId == auth.uid and status == 'signed';
                                       public (without auth) only through a valid, non-revoked shareToken]
  - ownerId, propertyId, tenancyId, userId, month, year
  - composite/unique id guaranteed on (propertyId + month + year) — FR-REP-14

  // Every cost line has the same shape: amount + notes + attachments (FR-REP-03a)
  // "costLine" = { amount, notes (optional), attachments[] (optional) }
  //   attachments[]: [ { url (Storage ref), name, type: 'image'|'pdf'|'doc' } ]
  //   the notes AND the attachments are visible to the tenant (FR-DOC-04)

  - rent:        costLine
  - maintenance: costLine
  - serviceCosts: [ { serviceId, name (snapshot), ...costLine } ]
       // ALL active services appear, including with amount 0 or negative (FR-REP-03)
  - otherExpenses:  [ { description, ...costLine } ]

  - previousMonthArrears, previousMonthCredit
  - calculatedTotal: number  // the automatic sum (reference, stays visible)
  - finalTotal:      number  // calculatedTotal or the value adjusted manually by the admin (FR-REP-04a/04b)
                             // THE ONLY amount owed — arrears/credits are computed against
                             // finalTotal, NOT against calculatedTotal (FR-REP-04c)
                             // the rounding difference is never carried forward

  - dueDate, paymentStatus: paid | partial | unpaid
  - amountPaid, paymentMethod: cash | bank_transfer | other, paymentDate

  // Signing / locking (FR-REP-07, 07a)
  - status: 'draft' | 'signed'     // draft = invisible to the tenant; signed = locked + visible
  - signedAt, updatedAt

  // Shareable link without authentication (FR-REP-07c)
  - shareToken: string             // long random token (min. 32 characters), impossible to guess
  - shareTokenRevoked: boolean     // manual revocation by the admin; invalidates the link permanently
  // NOTE: the public route /r/{shareToken} exposes EXCLUSIVELY this report.
  // It does NOT expose: the history, the contract, personal data, other reports, the tenant portal.
  // no global attachedDocuments — attachments are exclusively per line (FR-DOC-03a)

mail/{mailId}                         [ACCESS: Cloud Functions only — no client access]
errorLogs/{logId}                     [Phase 2; ACCESS: admin only]
```

**Storage (paths + rules):**
- `/users/{userId}/documents/*` and `/users/{userId}/guarantor/*` — admin only
- `/tenancies/{tenancyId}/contract/*` — admin + the tenant of the tenancy
- `/reports/{reportId}/invoices/*` — admin + the tenant of the report
- `/drafts/{draftId}/*` — admin only

**Notes:** `serviceCosts[].name` = snapshot (FR-PROP-08); the `utilityReadings` collection does not exist (no index); the denormalizations (tenantName, property) eliminate any need for the tenant to access `users`/`properties`.

---

## 7. Technical architecture

### 7.1 Stack

| Category | Choice |
|---|---|
| Backend | Firebase: Firestore, Authentication, Storage, Cloud Functions, "Trigger Email" Ext. |
| Frontend language | JavaScript |
| Framework | Vite + React (SPA), React Router |
| UI | Tailwind CSS + shadcn/ui |
| Forms | React Hook Form + Zod |
| Data | TanStack Query |
| Charts | Recharts *(Phase 2)* |
| PDF | Client-side |
| Photo | input capture (native camera); client compression (~2000px, ~80%) |
| i18n | react-i18next (RO/EN) |
| Tests | Vitest + React Testing Library + jsdom *(foundation installed at M1; tests written continuously, from M1 onwards)* |
| Code quality | ESLint (analysis), Prettier (formatting), Husky + lint-staged (git hooks: lint+format on commit), commitlint (Conventional Commits), .editorconfig |
| Config & secrets | Environment variables through `.env` (Vite); the Firebase keys are not hardcoded; `.env` in `.gitignore` |
| Deploy | Manual, Firebase CLI |
| Structure | Monorepo |

### 7.2 Cloud Functions

| Function | Type | Role |
|---|---|---|
| `finalizeKyc` | callable (admin) | Validates the complete draft, checks for duplicate CNP + free property, creates the Auth account + `users` + `tenancies` (with denormalizations), generates the password (12+ chars), writes the credentials email into `mail`, deletes the draft, and **returns the credentials (email + password) to the admin** in the response. Atomic. |
| `resetTenantPassword` | callable (admin) | Generates a new password, sets it on the account, returns it to the admin. |
| `setTenantAccountStatus` | callable (admin) | Disables / re-enables a tenant's account. Sets `disabled: true/false` on the Firebase Auth account (requires the Admin SDK — the client cannot) and synchronizes `users.status` in Firestore. On **disabling** it also revokes the active tokens (`revokeRefreshTokens`), so that an open session dies immediately, not at the next login. Backs the "Disable/Re-enable" button in §5.3 (**Account** tab) and the states in FR-TEN-24. |
| `onReportWrite` | Firestore trigger | Recomputes `currentBalance` on the tenancy; writes the new/updated report email into `mail`. |
| `onPropertyUpdate` | Firestore trigger | Synchronizes `property { name, address }` in the active tenancy. |
| `dailyScheduler` | scheduled 09:00 Europe/Bucharest | Arrears reminders (3-day cycle from the due date, until settlement) + contract expiry reminders (90/60/30, to the admin). |
| `getSharedReport` | callable (public, no auth) | Serves a shared report based on the `shareToken`. Validates the token, checks `shareTokenRevoked == false` and `status == 'signed'`, returns **only** the report's fields. The only path of anonymous access to data; the collection stays closed in Security Rules (FR-REP-07c). |
| `setAdminClaim` | setup script (once) | Sets the custom claim `admin: true` on the account created in the Console. |

**Note — `finalizeKyc` returns the credentials to the admin:** onboarding is completed face-to-face on a tablet, with the tenant present, so the admin can communicate the password directly instead of waiting for the email to arrive. The `mail` email stays the durable record channel; the callable response is only for immediate confirmation at the desk. This is consistent with `resetTenantPassword`, which already returns the generated password to the admin.

### 7.3 Security Rules — principles
- Admin = custom claim `admin == true` → full access everywhere.
- `users`, `onboardingDrafts`, `properties`, `mail`, `errorLogs` → admin only (client); `mail` — Functions only.
- `tenancies` → tenant: read where `resource.data.userId == request.auth.uid`.
- `monthlyReports` → tenant: read where `userId == auth.uid && status == 'signed'`.
- `monthlyReports` → **public access through shareToken**: reading a shared report is NOT done directly from the client with Firestore rules (that would expose the collection), but through a **dedicated Cloud Function** (`getSharedReport`) which: receives the token, looks up the report, checks `shareTokenRevoked == false` and `status == 'signed'`, and returns **only** the report's fields (cost lines, notes, attachments, total, due date, payment status). It never returns personal data, history or other reports. The collection remains inaccessible anonymously in Security Rules.
- No write operation from the client for the tenant, anywhere.
- Storage according to section 6.

### 7.4 Monorepo structure

```
/
├── firebase.json, .firebaserc, firestore.rules, firestore.indexes.json, storage.rules
├── functions/                    — Cloud Functions (JavaScript)
│   ├── index.js
│   └── src/ (kyc.js, reports.js, scheduler.js, mail-templates/)
└── web/                          — Vite + React
    ├── src/
    │   ├── components/ui/        — shadcn/ui
    │   ├── components/shared/    — common (skeleton, empty, confirm-dialog…)
    │   ├── features/             — auth/, properties/, tenants/, onboarding/, reports/, tenant-app/
    │   ├── lib/                  — firebase.js, queryClient.js, i18n/ (ro.json, en.json), pdf/
    │   └── routes/               — page definitions + guards
    └── tests/
```

### 7.5 Environments
A single Firebase project (production) + the **Firebase Emulator Suite** for local development (Auth, Firestore, Storage, Functions). Manual deploy: `firebase deploy`.

**Firebase plan strategy (assumed decision):** development (M0-M6) is done entirely on the **free Spark plan + local emulators** — no card attached, no costs. The emulators include Storage and Functions in full, so all flows (photo/document upload, backend functions) are developable and testable locally. Moving to the **Blaze** plan (pay-as-you-go, card required) becomes mandatory only at **production deploy (M7)**, because from 2026 Cloud Storage and Cloud Functions deployment require Blaze. At this project's volume (5-20 properties) usage will almost certainly remain within the free quotas included in Blaze (1 GiB storage, 10 GB egress/month, 2M function invocations/month) → estimated bill ~0. **Mandatory mitigation when activating Blaze:** a Cloud Billing budget alert (e.g. threshold 5 RON/month) to be notified of any unexpected consumption.

---

## 8. Assumptions and dependencies
- The admin has access to the Firebase Console (setup, recovery of their own password).
- The transactional email provider (SendGrid/Mailgun via Extension) is configured.
- Tablet with camera + internet for KYC.
- No fiscal requirements. Small volume (5-20 properties).
- The tenant consents to the collection of KYC data (direct, face-to-face relationship).
- The admin communicates reset passwords personally.

---

## 9. Implementation plan (milestones)

| # | Milestone | Content | "Done" criterion |
|---|---|---|---|
| M0 | Foundation | Firebase project, monorepo, emulators, Vite+React+Tailwind+shadcn, i18n skeleton, routing + guards, `setAdminClaim`, **code quality tooling (ESLint + Prettier + Husky + lint-staged + commitlint + .editorconfig), `.env` management**, **README.md (local setup: emulators, `.env`, `setAdminClaim`; recovering admin access through the Firebase Console — see §2.8)** | The application starts locally; login redirects correctly by role; the commit automatically runs lint+format |
| M1 | Properties & services | Property CRUD, catalog + custom, archiving, list *(search deferred past M1 — still required, rescheduled)*, **testing foundation (Vitest + React Testing Library + jsdom + config + `test` script); the first tests written together with the property CRUD** | Create/edit/archive properties with services; the test suite runs green |
| M2 | KYC Onboarding | Drafts, 4-step wizard, photo capture + compression, `finalizeKyc`, credentials email, CNP check | End-to-end onboarding functional, credentials received |
| M3 | Tenant management | Detail (4 tabs), profile editing, password reset, contract extension/termination | Complete tenant lifecycle |
| M4 | Reports & payments | Monthly form, publication/editing + notifications, payments (marking/cancelling), arrears/credits, automatic balance, Current month, dashboard | The complete monthly cycle, with emails |
| M5 | The tenant application | Dashboard, history, contract, visible invoices, PDF | The tenant sees and downloads everything |
| M6 | Automations & history | `dailyScheduler` (reminders), cost history per service | The reminders go out correctly; the history is visible |
| M7 | Polish & launch | Empty/error states, complete i18n, **end-to-end tests on the critical flows (final regression coverage — testing has been running continuously since M1, it does not start here)**, final Security Rules, **bundle optimization (code splitting — see the note below the table)**, **move to the Blaze plan + Cloud Billing budget alert**, deploy | Live, tested application |

**M7 note — bundle optimization (code splitting):** lazy loading achieved with the native React mechanism (`React.lazy` + `Suspense`), applied at two granularities:
1. **At route level** — each major area (the admin portal, the tenant portal, the public `/r/` route) becomes a separate chunk of JavaScript, loaded on demand. Priority: the public route `/r/:shareToken` must load **without the admin area's code** — a minimal bundle for the anonymous visitor opening a shared report.
2. **At the level of an individual heavy component** — expensive but rarely used components (the PDF generator, the image/document viewer, the Phase 2 Recharts charts) are loaded lazily even inside an already-loaded page, where bundle measurement shows it is worth it.

The principle: optimization is applied **after measurement, not prematurely** — which is why it is placed at M7, not earlier.

**Note — the testing strategy (continuous, from M1):** automated testing is not a final phase, but a continuous practice. The testing foundation (**Vitest + React Testing Library + jsdom + config**) is installed at **M1**, and from there on **every new feature comes with its own tests**, written together with the code — not retroactively. M7 only adds **end-to-end coverage on the critical flows**, as a final regression check before launch, not as the first moment of testing. The principle: **new code = tested code**. (M0 remains without tests — the testing foundation lands at M1, together with the first product code.)

Each milestone: generation → local testing (emulators) → validation by the administrator → the next milestone.

---

## Appendix A — Email templates (RO / EN)

All emails to the tenant are sent in their preferred language. Emails to the admin (A5) — Romanian only. Placeholders: {name}, {email}, {password}, {monthYear}, {total}, {dueDate}, {arrearsAmount}, {property}, {endDate}, {url}.

### A1 — Access credentials (on KYC completion)
**RO — Subject:** Contul tău de chiriaș a fost creat
> Bună, {name},
> Ți-a fost creat un cont în platforma de administrare a chiriei pentru proprietatea {property}.
> Date de autentificare: Email: {email} / Parolă: {password}
> Accesează platforma la: {url}
> Aici vei găsi, lunar, raportul cu suma de plată, data scadentă și istoricul plăților tale.

**EN — Subject:** Your tenant account has been created
> Hi {name},
> An account has been created for you on the rental management platform for {property}.
> Login details: Email: {email} / Password: {password}
> Access the platform at: {url}
> Each month you'll find your payment report, due date, and payment history here.

### A2 — New report published
**RO — Subject:** Raportul pentru {monthYear} este disponibil — {total} lei
> Bună, {name},
> Raportul lunar pentru {monthYear} a fost publicat.
> Total de plată: {total} lei / Data scadentă: {dueDate}
> Detaliile complete: {url}

**EN — Subject:** Your {monthYear} report is available — {total} RON
> Hi {name},
> Your monthly report for {monthYear} has been published.
> Total due: {total} RON / Due date: {dueDate}
> Full details: {url}

### A3 — Report updated
**RO — Subject:** Raportul pentru {monthYear} a fost actualizat
> Bună, {name},
> Raportul lunar pentru {monthYear} a fost actualizat de proprietar.
> Total de plată actualizat: {total} lei / Data scadentă: {dueDate}
> Verifică detaliile: {url}

**EN — Subject:** Your {monthYear} report has been updated
> Hi {name},
> Your monthly report for {monthYear} has been updated by the landlord.
> Updated total due: {total} RON / Due date: {dueDate}
> Check the details: {url}

### A4 — Arrears reminder (3 days after the due date, repeated every 3 days)
**RO — Subject:** Reamintire: plată restantă — {arrearsAmount} lei
> Bună, {name},
> Îți reamintim că există o sumă restantă de {arrearsAmount} lei pentru {property}, scadentă la {dueDate}.
> Te rugăm să contactezi proprietarul pentru achitare.
> Detalii: {url}

**EN — Subject:** Reminder: overdue payment — {arrearsAmount} RON
> Hi {name},
> This is a reminder that an overdue amount of {arrearsAmount} RON is pending for {property}, due on {dueDate}.
> Please contact the landlord to settle the payment.
> Details: {url}

### A5 — Contract expiry reminder (to the admin; 90/60/30 days; RO only)
**Subject:** Contract în expirare: {property} — {endDate}
> Contractul chiriașului {name} pentru proprietatea {property} expiră la {endDate}.
> Acțiuni posibile: prelungește contractul (editează data de sfârșit) sau planifică încheierea și offboarding-ul.
> Deschide tenanța: {url}
