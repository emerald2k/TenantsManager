# SRS — Software Requirements Specification
# Tenant Management Platform

*Version 4.6 — M8 folded in, plus two waves of correction: the financial model, then the deposit, rounding and bad-debt decisions.*

***v4.6 changes (third wave — deposit, rounding, bad debt):***
- *`FR-CON-04` **reversed**: termination is no longer blocked by arrears. The debt survives, stays visible (`FR-DASH-13`) and keeps being chased (`FR-PAY-04`). `FR-PAY-12` records that no write-off exists.*
- *`FR-CON-10/11/12` — deposit settlement at termination: restoration line items with documents, deducted from the deposit, ending in the amount to return. Arrears are deliberately NOT settled from it.*
- *`FR-REP-04a/04f` — **reversal**: rounding is UPWARD to a multiple of 10 and the surplus becomes the tenant's credit, where the pre-M8 rule said the difference "never reappears". New `roundingSurplus` field; the balance derivation and the Billed formula each gain a term.*

***v4.5 changes (second wave — financial correctness):*** *report key becomes tenancy+month+year (`FR-REP-14`); chronological signing enforced (`FR-REP-11/11a`); Overdue becomes the aged portion (`FR-DASH-06`); former tenants' balances surfaced (`FR-DASH-13/14`); arrears-reminder preconditions defined (`FR-PAY-04`); detection added (`FR-SYS-05/06/07`); A9, A10, A11; personal-data requirements (`FR-TEN-25/26/27`); yearly totals (`FR-PROP-12`).*

***v4.4 changes (M8 — admin experience overhaul):***
- *Dark mode reverses its exclusion (NFR-UX-04); generated artefacts stay light (NFR-UX-05).*
- *New module §3.11 Notification Log (NLOG) — a log of emails the system has sent, with delivery state. Metadata only; `mail` stays closed to every client.*
- *§3.6 gains the cross-property payments ledger (FR-PAY-07…09) and a pre-due payment reminder (FR-PAY-10, Appendix A8).*
- *§3.8 rewritten: FR-DASH-01 becomes a four-tile KPI row on explicit accrual/cash bases; the Billed history chart brings Recharts forward out of Phase 2.*
- *Tenants are labelled "Renters" in the English locale only — no code identifier, collection name or FR ID changes.*
- *NOT in M8: owner expenses (deferred — see §3.5); an activity/audit log (§2.7's exclusion and NFR-SEC-06 both stand unchanged).*

***v4.3 corrections, resulting from confronting the specification with a real monthly report used in practice:***
- *FR-REP-03 — inverted: all active services appear in the report, regardless of amount (including 0/negative). Previously they were hidden — wrong.*
- *FR-REP-03a (new) — notes + attachments **per cost line** (the supporting invoice next to the amount it justifies), visible to the tenant.*
- *FR-REP-04a/04b/04c (new) — the total can be adjusted manually at signing; the final total field pre-fills with the exact calculated total and stays fully editable. `finalTotal` is the only amount owed — arrears and credits are computed against it, not against the exact total.* **⚠ Superseded in part at M8:** *the "no automatic rounding suggestion" and "the rounding difference never reappears" clauses of this v4.3 entry are both reversed — see FR-REP-04a and FR-REP-04f. Rounding is now offered, upward, and the surplus returns to the tenant as credit.*
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
| Renter | The English-locale label for **Tenant**, introduced in M8. A presentation change only: the data model, collection names (`users`, `tenancies`), FR IDs (`FR-TEN-*`), route paths and code identifiers all keep "tenant". In Romanian both words are *chiriaș*, so `ro.json` is unchanged. |
| Notification log | The administrator-facing record of emails the system has sent — type, audience, subject, recipient, sent-at, delivery state. **Metadata only**; it never exposes an email body (§3.11). |
| Billed (for a month) | The amount billed for **that month's own** rent, maintenance, services and other expenses — `finalTotal` minus the balance carried in from the previous month and minus any `roundingSurplus`. Never a plain sum of `finalTotal`, which already contains that carry-forward (FR-DASH-04). |

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
- Automatic email notifications for account/payment/contract events, in the tenant's preferred language; monthly report notifications are sent on admin request.
- Payment reminders both **before** the due date (FR-PAY-10) and after it (FR-PAY-04).
- A cross-property payments ledger and a log of every email the system has sent — both administrator-facing and read-only.

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

*Two Phase-2 entries are affected by M8 without being delivered by it.* **Recharts**, previously scoped to Phase 2, arrives in M8 for FR-DASH-09 — so FR-PROP-09's chart is no longer blocked on a missing dependency, only on being scheduled. And `FR-NLOG-05` makes email **delivery** failures visible in the app; `FR-SYS-02`'s general error log stays Phase 2.

**Explicitly out of scope (any phase):** fiscal invoicing, online payments, multi-admin, native mobile application, 2FA, **in-app notifications**, bulk expense entry, general CSV/Excel export, **audit trail**, historical data migration, guarantor identity verification, self-service password reset/change, automatic contract generation, meter-index-based calculation.

*Dark mode was on this list and no longer is: M8 delivers it (NFR-UX-04, replacing NFR-UX-02). Reason on record — the exclusion was made when the product was a single-admin MVP racing to launch, and `index.css` already shipped a complete `.dark` token block, so most of the cost that justified the exclusion had already been paid.*

**Two entries above are load-bearing and are NOT reversed by M8**, despite M8 adding surfaces whose names suggest otherwise:

- **in-app notifications** — §3.11's Notification Log is a **record of emails already sent**, not a delivery channel. Nothing is ever delivered in-app. `FR-SYS-03` stands unchanged.
- **audit trail** — an activity/event log was designed for M8 and **cut before any implementation**. There is no `events` collection, no event emission, and no callable or trigger writes one. `NFR-SEC-06` stands unchanged.

**Deferred — owner expenses (module ID `OPEX` reserved, section number not).** Recording the costs the *owner* bears — insurance, taxes, repairs, management fees, professional services — was scoped for M8 and deferred: it needs a definition pass of its own, starting from Romanian rental practice (*impozit*, *asociație de proprietari*, *reparații*, *notar/avocat*), from whether the category list is a fixed constant or admin-editable, and from whether recurring costs are entered manually with a duplicate action or generated by a scheduler. **When it arrives it must not be conflated with §3.5** — see the warning at that module's heading. Until then the product has no notion of an owner-borne cost, and therefore no net-income figure anywhere (FR-DASH-11).

**What `OPEX` exists to complete, so that whoever specifies it knows the target:** `netProfit = Σ rent − ownerExpenses − tax`. Note the first operand is **`Σ rent` alone**, not any total the product currently shows — maintenance, services and other expenses are amounts the owner collects from the tenant and forwards to a supplier, whose invoice is attached to the very line that records them (FR-REP-03a). They are pass-through, not earnings. **Every operand of that formula except `ownerExpenses` already exists in the data**, which is the whole reason the deferral is cheap to reverse: `OPEX` is one collection and one subtraction, gated behind a category decision, not a modelling problem. Tax is a category of owner expense, entered like any other — the product must not hardcode rates or deduction rules.

**M8 — admin experience overhaul.** Full visual redesign of every surface (admin backoffice, tenant portal, public shared report) including dark mode; a new admin shell; the cross-property payments ledger; the pre-due payment reminder; the notification log; and the rebuilt dashboard. See §9.

**Tooling consciously avoided (not bloat, but over-engineering for this project):** TypeScript (assumed decision — plain JavaScript), Storybook, automatic CI/CD (manual deploy in MVP; possibly GitHub Actions in Phase 2), Docker, production error monitoring (Sentry — possibly Phase 2+). These tools are professional standards, but add unjustified complexity at the scale and solo context of this project.

### 2.8 Identified risks

| Risk | Mitigation |
|---|---|
| Single admin — losing access blocks management | Recovery through Firebase Console (documented in README) |
| Email delivery without retry in MVP | Delivery state is visible in the application from M8 (§3.11, FR-NLOG-05); automatic retry itself stays Phase 2 (FR-SYS-01) |
| Accidental deletion or silent corruption of financial data | **Accepted, mitigated only partially.** No automated backup: the administrator takes a manual export periodically and, per `CLAUDE.md` §10, always immediately before a migration. Detection rather than prevention is the real control here — FR-SYS-05 reconciles balances weekly and FR-SYS-06 makes a dead scheduler visible. Firestore has no undo and no version history, so an unnoticed deletion between two manual exports is unrecoverable |
| Loss of the single Google account owning the project | **Accepted.** §2.8's recovery route is the Firebase Console, which is reached only through that one account; if it is lost, the project, the data, the billing and the tenants' accounts go with it. No second owner is configured |
| A tenant receives too many reminder emails | FR-PAY-10's window is bounded by `paymentReminderDaysBefore`, itself bounded 1-10 (NFR-VAL-02); sends are deduplicated by a deterministic `mail` document ID (FR-PAY-10e) |
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
| FR-AUTH-04 | **No self-service password reset/change** — no "forgot password" link, no change option in the tenant's account. A tenant's password is reset only by the admin, from the tenant's detail page: the system generates a new password, displays it to the admin, who communicates it to the tenant, **and offers to email it to the tenant as well (A9)** — the only recovery path when the original credentials email failed to arrive, since the notification log is read-only by FR-NLOG-06. The admin's password is recovered exclusively through the Firebase Console. |
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
| FR-TEN-07 | Existing email at Step 1 → new tenancy linked to the existing account, jump directly to Step 4. On finalization, the tenant receives a short notification email (Anexa A7). |
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
| FR-TEN-25 | **Deleting an onboarding draft deletes its photographs.** "Delete draft" removes the document **and** the Storage prefix `/drafts/{draftId}/*` in one operation. Until M8 only `finalizeKyc` moved files out of that prefix, so every abandoned candidate left a full set of photographed identity documents in the bucket — unreferenced, invisible in the application, unreachable through any screen, and belonging to a person who never became a tenant. |
| FR-TEN-26 | **A tenant's own data can be exported on request.** An admin-only action produces a single bundle for one tenant — profile, KYC answers, every tenancy, every signed report, the payment history, and a manifest of the stored documents — which the administrator reviews before sending. Necessary because FR-TEN-09 deliberately denies the tenant read access to their own `users` document, so "log in and look" is not an available answer, and NFR-PERF-03 removes the generic export. This is a narrow, per-subject export and does **not** reverse NFR-PERF-03. **Two clarifications, 2026-08-31, after stage 17 shipped the callable without a screen.** (a) **The action is a control in the administrator's interface, not only a callable.** The requirement says *action*; a callable reachable exclusively from the Firebase Console is a mechanism, not a delivered requirement, and "the administrator reviews it before sending" describes a person at a screen. *(The stage 17 plan wrote "admin-only callable" and the stage narrowed from there — a requirement narrowed by the instruction that was supposed to carry it.)* (b) **The bundle contains third-party personal data and must show it as such.** A tenant's KYC record carries a **guarantor** (name, CNP, phone, photo manifest), an **emergency contact** and a **previous reference** (names and phones) — people who supplied nothing themselves and, in the guarantor's case, whose lawful basis is one of §4.1's open obligations. **They are included, in a section labelled as third-party data** *(owner decision, 2026-08-31)*. The label encodes no policy and answers no legal question: it exists so the reviewer sees at a glance what is about someone other than the requester, at the tenth request as clearly as at the first, instead of having to find it in the JSON. Whether any of it is redacted before a particular bundle leaves is the administrator's decision **per request**, and it stays that way until §4.1 item 3 is answered. |
| FR-TEN-27 | **A tenancy is never attached to an account that cannot be used.** `finalizeKyc`'s existing-account branch rejects a `disabled` or `archived` account, naming the reason; for `disabled` it offers re-enabling inline. Otherwise a returning tenant whose old account was archived — a terminal state — would get a live contract, payment reminders and an A7 email saying reports will appear in their usual account, while being permanently unable to log in and with no admin action able to change that. |
| FR-TEN-24 | Tenant account states: `active` / `inactive-readonly` / `disabled` / `archived`. (The account is active immediately after creation — there is no "invited" state.) |

### 3.3 Contracts / Tenancies module (CON)

| ID | Requirement |
|---|---|
| FR-CON-01 | Contract: property, start date, end date (mandatory), monthly rent, security deposit (optional), due day, report-preparation reminder lead time (`reportReminderDaysBefore`, default 3 days). |
| FR-CON-02 | One account — at most one active tenancy at a time. |
| FR-CON-03 | Manual termination at any time, including early. |
| FR-CON-04 | Termination is **not blocked** by an unpaid balance. The screen states the closing balance plainly and requires an explicit acknowledgement, then proceeds. *(Reversed at M8. The block was the only thing standing between a departed non-payer and a permanently unlettable flat: the property stayed `occupied`, so no successor could be onboarded, and the only way past was to record a payment that never happened. Blocking the owner does not collect the debt — it only hides the flat.)* **The debt survives termination**: it stays on the tenancy, and appears permanently under "owed by former renters" (FR-DASH-13). **Automated reminders stop** (FR-PAY-04): the debt stays visible to the owner, but the product does not pursue a departed tenant by email. A closing balance in the tenant's favour is surfaced the same way (FR-DASH-14). |
| FR-CON-05 | On termination: the property becomes "free", the account moves to "inactive-readonly". |
| FR-CON-10 | **Deposit settlement, once a tenancy has ended.** A settlement against `securityDeposit`: the administrator adds any number of **restoration line items** — description, amount, optional attachments (invoice, photograph) — covering the work needed to return the property to the condition it was let in. The screen shows the deposit held, the sum of the deductions, and **the amount remaining to return**. If the deductions exceed the deposit, the excess is displayed as such and is **not** converted into a debt on the tenancy: it is a cost the owner bears, and the product has no owner-cost ledger yet (§2.7, deferred `OPEX`). *(Flow decided at M8 stage 6, Bogdan's explicit call: a SEPARATE action from ending the contract, not chained into the same screen — the administrator rarely has inspected the property for restoration damage in the same click as ending the tenancy. It appears on the ended tenancy, fillable whenever. The settlement stays editable afterward — a correction to a restoration line is a typo fix, not a new settlement; the original `settledAt` is preserved across a correction. Reconfirmed at stage 7, 2026-08-24, after this text was briefly overwritten back to the pre-stage-6 "chained" wording by an unrelated planning-session edit — the decision itself never changed.)* |
| FR-CON-11 | **The settlement covers restoration work only — never the rent arrears.** An unpaid balance stays a debt, visible and chased (FR-CON-04, FR-PAY-04), and is settled by payment or not at all. *(Decided deliberately: the deposit settlement does not touch the payment ledger, so a deduction that silently cleared `currentBalance` would leave the reminders chasing money already taken. Keeping the two apart means every figure keeps meaning one thing.)* If the administrator does in fact apply the deposit against arrears outside the application, they record it as an ordinary payment (FR-PAY-01) — a deliberate act, not a side effect. |
| FR-CON-12 | **The settlement is visible to the tenant, with its documents.** Each restoration line — description, amount and any attachment — appears in the tenant's portal exactly as a monthly report's cost lines do (FR-REP-03a), together with the deposit held and the amount to be returned. It is the tenant's money; and a dispute is far cheaper to answer with the invoice already attached than to reconstruct afterwards. |
| FR-CON-06 | Extension = editing the end date on the same tenancy. **Editing the rent warns first.** `monthlyRent` is a single value with no effective date, so changing it also changes what `/app/contract` shows the tenant about the past and what a retroactively entered report pre-fills. The edit dialog states this plainly before saving. Reports already signed are unaffected — their amounts froze at signing. *(An effective-dated amendment history was considered and declined: in practice the rent changes at renewal, when a new contract is created anyway.)* |
| FR-CON-07 | The attached signed contract is visible/downloadable by the tenant. |
| FR-CON-08 | Passing the end date **changes nothing about the tenancy** — it remains `active` until manual termination; nothing is ended, freed or archived automatically. It does trigger a **reminder** to the administrator (A11, weekly while the state persists), which is the backstop for having missed all three of FR-CON-09's advance warnings: an expired-but-active contract keeps demanding reports, keeps sending payment reminders, and keeps the property occupied against the next onboarding. |
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
| FR-PROP-08 | Removing a service does not affect **signed** reports (name+cost snapshot); the service disappears only from future reports. |
| FR-PROP-09 | The property page includes the **cost history**: table of months × (rent + maintenance + services + other + total). **The total column is the month's own billed amount** — `finalTotal − previousMonthArrears + previousMonthCredit − (roundingSurplus ?? 0)`, the same formula as FR-DASH-09 — **not `finalTotal`**, so each row's categories sum exactly to its total. *(Corrected at M8. With `finalTotal` the rows did not add up, off by precisely the carried-forward balance plus any rounding, which is why the discrepancy looked intermittent: it vanished in months where the tenant was square. A cost history is about the evolution of the property's costs; a balance carried in from the tenant's previous month is not a cost of the property.)* Where a manual rounding was applied it appears in its own column (FR-REP-04d). **A year total row closes the table**, with per-service year totals per column, so the annual question — what did this property bill in 2026 — is answered where the monthly detail already is. *(Phase 2: chart on the same data.)* |
| FR-PROP-12 | **Yearly totals, in the screens that already exist.** No annual report page and no export (NFR-PERF-03 stands). The payments ledger (FR-PAY-07) gains a year filter with footer totals, each computed by its own correct rule (§6): **billed** by FR-DASH-09's formula, **collected** as Σ`amountPaid`, and **still outstanding** from `tenancies.currentBalance` — never as Σ(`finalTotal` − `amountPaid`), which double-counts every carried balance. And, stated separately, **`Σ rent` for the year**, which is the operand for the owner's rental-income declaration and the only figure among them that is actually earnings rather than pass-through (§2.7). **It counts SIGNED reports only, and says on screen how many reports of that year it left out** *(administrator's decision, 2026-08-24, taken at stage 12 because neither this requirement nor the plan had settled it — on seeded 2026 data the two readings differ by 2.500 lei)*. The reasoning is that a draft is not yet a claim on anyone: it can still be edited, and the figure leaves the product to be copied into a tax return. Silently including drafts would overstate declared income; silently excluding them would understate it with no trace — hence the count on screen, which is the whole point of the decision. It is not a footnote: it is what stops the number being wrong in the one direction nobody checks. Every one of these is a client-side aggregation over data the page already fetches. |
| FR-PROP-10 | The property's name and address are denormalized into the active tenancy and synchronized automatically (Cloud Function) when the property is edited. |
| FR-PROP-11 | For an occupied property, the property detail page displays the active tenancy's due day (`dueDay`) and a countdown of days remaining until its next occurrence — a calendar calculation, independent of whether a monthly report exists yet for the current month. |

### 3.5 Expenses & Monthly Reports module (REP)

> **"Expenses" here means costs RECHARGED TO THE TENANT — never costs the owner bears.**
> Every cost line in this module (rent, maintenance, services, other expenses) is an
> amount the tenant owes. The opposite notion — insurance, taxes, repairs, management
> fees, the owner's own outgoings — has **no representation anywhere in this product**
> and is deferred under the reserved module ID `OPEX` (§2.7). The two are near-homonyms
> and must never be conflated in code, in the UI, or inside a total. When `OPEX` is
> eventually specified it takes its own section, its own collection and its own module
> ID; it does not extend this one. Recorded here rather than only in §2.7 because this
> heading is where a reader meets the word "expenses" first.

| ID | Requirement |
|---|---|
| FR-REP-01 | Monthly entry, per property (individually): maintenance (own field) + the cost of each active service + "other expenses" (description+amount, free list). Rent taken from the contract. |
| FR-REP-01a | The cost categories are: **rent** (from the contract, editable on a per-month basis), **maintenance** (own field, separate from services), **services** (list per property), **other expenses** (one-off, free list). |
| FR-REP-02 | Rent adjustable on a per-month basis for the current month, without modifying the contract. |
| FR-REP-03 | **All active services** of the property appear in the report, **regardless of amount** — including 0 or negative values (adjustments). The reason: transparency — the tenant sees that the service was taken into account, not omitted. The same for rent and maintenance. |
| FR-REP-03a | Each cost line (rent, maintenance, each service, other expenses) can have: an **optional notes field** (free text, filled in by the admin when entering the cost) and **optional attachments** (image/PDF/document — e.g. the supplier's invoice for that service). Both are **visible to the tenant** (full transparency). |
| FR-REP-04 | Total computed automatically: **rent + maintenance + service costs + other expenses + previous month's arrears − previous month's credit**; arrears and credit appear as separate lines. |
| FR-REP-04a | **Rounding is UPWARD, to a multiple of 10 lei, and the surplus becomes the tenant's credit.** Offered as an action next to the total — `ceil(calculatedTotal / 10) × 10` — which the administrator applies or ignores per report; it is never automatic. **The action is unavailable when `calculatedTotal ≤ 0`**: rounding a credit month "up" moves it toward zero, which would quietly shrink money the product owes the tenant (−152 would become −150). Rounding exists to make a cash payment convenient; there is no cash payment to round when nothing is owed (FR-PAY-11), because a bank transfer has no reason to be round while cash does. The difference is stored as **`roundingSurplus`** (always ≥ 0) and is **carried forward as credit into the following month**. Example: lines total 2.382,17 → rounded 2.390 → surplus 7,83 → next month opens with 7,83 credit. Over two months the tenant has paid exactly what they owed. |
| FR-REP-04f | **The reversal, on record.** This reverses the pre-M8 rule, which said the rounding difference "never reappears, in any form".** Reason on record: the old rule only worked downward, because rounding *up* while discarding the difference means charging more than the invoice shows — indefensible on a document whose stated purpose is transparency (§2.1). Carrying the surplus makes upward rounding honest: the owner collects a round figure, the tenant loses nothing, and the arithmetic closes over two months instead of one. |
| FR-REP-04b | The **final total field** is pre-filled with the exact calculated total (`calculatedTotal`) and remains **fully editable** — the administrator can adjust it manually (e.g. commercial rounding for cash payment, per FR-REP-04a). **Amended at M8:** the system offers one rounded value — upward, to a multiple of 10 (FR-REP-04a) — as an action the administrator applies or ignores per report. It is still never applied automatically, and the field remains freely editable for anything else. |
| FR-REP-04c | **`finalTotal` is the only amount owed** and the basis for all subsequent payment calculations. Arrears and credit are computed exclusively against `finalTotal` (the rounded amount), NOT against `calculatedTotal`. **Amended at M8:** `finalTotal` remains the only amount owed, but where it was produced by the rounding action, `roundingSurplus` is subtracted when the balance is derived (§6) — so the tenant is asked for the round figure and credited the difference. A **manual** edit of the total (a negotiated reduction, say) is a different act: it changes what is owed, creates no surplus, and clears any surplus previously set by the rounding action. The two must never be conflated — one is a payment convenience, the other is a change to the debt. |
| FR-REP-04e | **A final total that diverges materially from the calculated total requires a second confirmation and a written reason.** At signing, if `\|finalTotal − calculatedTotal\| > max(5 lei, 1% of calculatedTotal)`, the dialog states the difference in plain words ("you are adjusting by −4.500 lei") and requires both an explicit second confirmation and a short free-text reason, stored on the report as `finalTotalOverrideReason` together with the timestamp. **The rounding action of FR-REP-04a is exempt** — it is bounded to under 10 lei by construction and carries its surplus back to the tenant, so it can never be the vector this guard exists to catch. The guard applies only to a manual edit. **This is the only guard on the field the entire balance chain hangs from**: `finalTotal` is the sole amount owed (FR-REP-04c), it is fully editable by design, and a slipped keystroke — 500 for 5000 on a report carrying 3.000 of arrears — erases 4.500 of real debt permanently, with no reminder, no discrepancy and, since there is no audit trail (NFR-SEC-06), no record that the figure was ever edited. The stored reason is the only trace the product will ever have. |
| FR-REP-04d | **The difference between the calculated total and the final total is shown as its own labelled line**, wherever the report is rendered — admin form, tenant portal, PDF, PNG and the shared link — so that the visible lines add up to the visible total. **Two distinct cases, worded differently because they mean opposite things.** When the rounding action produced it, the line reads *"Rounding up: +7,83 lei — carried as credit to next month"*, and the amount is the **stored** `roundingSurplus` (§6). When the administrator edited the total by hand, the line reads *"Adjustment: −40,00 lei"*, the amount is derived at render as `finalTotal − calculatedTotal`, **nothing is stored, and no credit is carried** (FR-REP-04c). Never present both: a manual edit clears any surplus. Without this line the tenant sees a set of lines that does not sum to the amount demanded, with no explanation, on a document whose stated purpose is transparency (§2.1). |
| FR-REP-05 | Due date taken from the contract (due day), manual override per month possible. |
| FR-REP-06 | On **signing** (finalizing the list), the report becomes visible to the tenant in their portal immediately. Sending the email notification is a **separate, optional action** — the administrator triggers it via a "Send by email" button whenever they choose; it is never automatic. |
| FR-REP-07 | **Signing** is the act by which the administrator confirms the validity and finality of the payment list. Report states: `draft` (in progress, invisible to the tenant) → `signed` (finalized, locked, visible to the tenant). After signing, the report is **locked for editing**. |
| FR-REP-07a | A signed report can be **unlocked** by the administrator through an explicit action (button "Unlock for correction" + confirmation dialog). Unlocking sets the report's `status` back to `'draft'` — it becomes editable again and drops out of the tenant's visibility until it is re-signed. After correction and re-signing, the administrator can **optionally** notify the tenant via email ("list updated") using the same button — not automatic. Editing is not possible without prior unlocking — a signed report cannot be modified accidentally. |
| FR-REP-07b | **Signed report export**, available to the administrator in three forms: (a) **PDF** (archive/email), (b) **PNG image** (ready to send on WhatsApp — reproduces the table with the cost lines and attachments), (c) **shareable link** (see FR-REP-07c). |
| FR-REP-07c | **Shareable link without authentication** — allows the tenant to see the report instantly, without login (e.g. sent on WhatsApp). Mandatory rules: (1) it contains a **long random token, impossible to guess** (not sequential IDs); (2) it opens **only that month's report** — NOT the tenant portal, NOT the history, NOT the contract, NOT personal data; (3) it **does not expire**, but can be **manually revoked** by the administrator at any time (revocation invalidates the link permanently); (4) for the complete history, contract and other reports, the tenant must authenticate into their account. |
| FR-REP-08 | There is no automatic release — the report is visible to the tenant only after signing. Corrections are made through unlock → edit → re-sign (FR-REP-07a). |
| FR-REP-09 | *(Phase 2)* Global filterable list of reports. |
| FR-REP-10 | *(Phase 2)* Aggregated annual report (general totals), without export. |
| FR-REP-11 | Retroactive reports may be **created and edited** for any past month. **Signing is constrained: `signReport` rejects a report whose (year, month) is earlier than that of any already-signed report on the same tenancy**, with an explicit message naming the blocking month and pointing at FR-REP-11a. |
| FR-REP-11a | **Why the constraint exists, and how to insert a forgotten month.** `currentBalance` is derived from the single most recent signed report by (year, month), and each signed report froze its own carry-forward at signing (§6). Signing an *earlier* month after a later one therefore has **no effect on any balance whatsoever**: the amount is billed, appears on the tenant's report, and is never carried forward, never chased by a reminder, and never visible in any total. The money is silently lost. **The supported procedure is: unlock every signed report later than the gap (FR-REP-07a), create and sign the missing month, then re-sign the unlocked months in ascending order.** This works by construction — an unlocked report reverts to `draft`, and a draft mirrors `currentBalance` live, so the chain rebuilds itself as each month is re-signed. **Order is not optional**: re-signing out of sequence reproduces the original defect. The tenant temporarily loses sight of the unlocked months and may receive "report updated" notifications on re-signing, both of which are existing, documented behaviour of FR-REP-07a. |
| FR-REP-12 | Recalculation of arrears/credits (from retroactive reports or cancelled payments) propagates **only into future reports** — **signed** ones remain untouched; corrections on signed months are made through unlock, edit and re-sign (FR-REP-07a). **FR-REP-11a is the deliberate exception**: unlocking a signed report makes it a draft again, at which point it resumes mirroring the balance live. That is not automatic rewriting of a signed report — it is an explicit administrator action with its own confirmation, which is exactly the distinction this requirement draws. |
| FR-REP-13 | The first month of a contract started mid-month: full rent; pro-rata adjustment is done manually (FR-REP-02). |
| FR-REP-14 | A report is uniquely identified by the combination **tenancy + month + year**. There cannot be two reports for the same tenancy in the same month — attempting to create a duplicate opens the existing report for editing. *(Changed at M8 from `property + month + year`. Reason: a mid-month handover puts two tenancies on one property inside one calendar month, and both owe a part of it. Under the old key only one of them could be billed at all, and the report form — routed by property — could not tell which tenancy an older month belonged to. **This is a document-ID change on live data and therefore a real migration**, not an additive one: `CLAUDE.md` §10 applies in full, including a verified export taken immediately beforehand.)* A property's cost history (FR-PROP-09) sums the sibling reports of a month where more than one exists. |
| FR-REP-15 | The system sends the administrator a preparation reminder `reportReminderDaysBefore` days before the tenancy's due day — only if the property is occupied and no signed report exists yet for the current month. Sent by `dailyScheduler`, 09:00 Europe/Bucharest, Romanian only (admin-facing). |

### 3.6 Payments & Arrears module (PAY)

| ID | Requirement |
|---|---|
| FR-PAY-01 | Payment is marked manually by the admin: amount, method (cash/bank transfer/other), date. After recording one, the administrator may **optionally** send the tenant a written confirmation (A10) — never automatic, the same discipline as FR-REP-06's report notification. |
| FR-PAY-02 | Partial payments allowed; the difference becomes arrears. |
| FR-PAY-03 | Arrears are carried forward automatically into the next report ("Previous month's arrears"). |
| FR-PAY-04 | Email reminder 3 days after the due date, repeated every 3 days until full settlement (sent at 09:00, Europe/Bucharest). The due date is the tenancy's `dueDay` for the CURRENT calendar month — not the due date of the most recently signed report — clamped to the last day of a shorter month. Anchored to the current month, the cycle pauses at the month boundary: days 1-4 of a new month yield a negative distance to that month's due date, so nothing fires until the new due date arrives, and for a high `dueDay` the usable window before month-end is only a few days. **Preconditions and figures, defined at M8** (they were absent, while FR-PAY-10c's were explicit): sent only while the tenancy is `active`, at least one signed report exists, and `currentBalance > FINAL_TOTAL_EPSILON`. **Automated reminders stop at termination.** *(Settled deliberately, having first been decided the other way. The debt itself survives — it stays on the tenancy and stays visible under FR-DASH-13 — but the product stops emailing about it. Recovery from a former tenant is a personal matter: an automated message every three days, indefinitely, to someone who has already moved out stops being pressure and becomes harassment, and the product should not be the one applying it.)* Both reminder families therefore share the active-tenancy precondition (FR-PAY-10c). `{arrearsAmount}` is **`currentBalance`** — everything the tenant owes, not one month's remainder, so the email never names a smaller figure than the debt and cannot be paid in the belief that it settles the account. `{dueDate}` is the **most recent signed report's `dueDate`**, the same anchor FR-PAY-10a uses. "Repeated every 3 days until settlement" is, in practice, "with monthly gaps". **The DUE-DAY anchoring below differs deliberately from FR-PAY-10a**, which anchors on the report's own `dueDate`; the divergence is documented at FR-PAY-10a and is not an inconsistency to be "fixed" by aligning one to the other without deciding which is right for both. |
| FR-PAY-05 | Overpayment allowed; the excess becomes **credit**, applied automatically in the next report ("Previous month's credit"). |
| FR-PAY-06 | Payments can be cancelled/corrected; the report returns to the previous status. The effects on future months follow FR-REP-12. |
| FR-PAY-07 | **Cross-property payments ledger** (`/admin/payments`): one row per report — property, renter, period, amount due (`finalTotal`), amount paid, payment date, status badge. Filterable by period, property and status. Default filter: the current month. |
| FR-PAY-08 | **One row per report, not per transaction.** `monthlyReports` stores a single cumulative `amountPaid` with one `paymentMethod`/`paymentDate`, so a renter paying twice in a month produces **one row carrying the total**, and a correction (FR-PAY-06) **overwrites in place** — the ledger can never show that a payment was corrected or cancelled. Recorded in the requirement itself so the ledger is never mistaken for a transaction log. A true transaction ledger would need a `payments` subcollection, changes to `onReportWrite`'s balance logic and a backfill of every existing report; deliberately not done. |
| FR-PAY-09 | The ledger is a **view**. Recording, correcting and cancelling payments stay on the report form (FR-PAY-01, FR-PAY-06); a ledger row links there. There is exactly **one** write path into `onReportWrite`'s balance recomputation. |
| FR-PAY-10 | **Pre-due payment reminder to the tenant.** Sent by `dailyScheduler` at 09:00 Europe/Bucharest (FR-SYS-04), in the tenant's preferred language (NFR-LOC-04, Appendix A8). Complements FR-PAY-04, which is unchanged. |
| FR-PAY-10a | **Anchor — the report's own `dueDate`, not the tenancy's `dueDay`.** The job looks up the tenancy's most recent **signed** report and reads its stored `dueDate`. This deliberately differs from FR-PAY-04: FR-REP-05 makes `dueDate` a per-month manual override, so anchoring on the tenancy's `dueDay` would let the email name a date the tenant's own report contradicts. Anchoring on the report also removes the month-boundary problem entirely — there is no calendar arithmetic to clamp, and no ambiguity about which month's report the precondition refers to, because it is the same document the anchor came from. |
| FR-PAY-10b | **Window.** Fires once per day for every day in `[dueDate − paymentReminderDaysBefore, dueDate]`, **inclusive of the due date itself** — the last message reads "due today". Nothing fires after `dueDate`; FR-PAY-04 takes over from `dueDate + 3`. The two-day silence at `+1` and `+2` is deliberate and accepted. |
| FR-PAY-10c | **Preconditions.** Sent only if the report is `status == 'signed'` **and** `finalTotal − (amountPaid ?? 0) > FINAL_TOTAL_EPSILON` (NFR-VAL-03: money is never compared exactly) **and** the tenancy is `status == 'active'`. Signed, because a reminder to pay a bill the tenant has not received is worse than none. Active, because otherwise a terminated tenancy with an unpaid final report would generate reminders indefinitely. The unpaid test is arithmetic on `finalTotal`/`amountPaid`, never on `paymentStatus`, which may be absent on a just-signed report and diverges from the arithmetic on overpayment (FR-PAY-05). |
| FR-PAY-10d | **Day counts** use the `Date.UTC` / 86400000 convention, identically to `schedulerLogic.js` — never a local-`Date` millisecond subtraction, which lands on a fractional day across a DST transition. |
| FR-PAY-12 | **There is no write-off, and none is planned.** An uncollectable balance is never erased, marked settled, or hidden. *(Considered at M8 and rejected. It had been proposed to release FR-CON-04's termination block; that block is gone instead, so the reason evaporated. And a debt exists to be visible: to the tenant, who should feel it, and to the owner, who should know the property carries one. A ledger that looks clean because the losses were deleted is worth less than one that shows them.)* |
| FR-PAY-11 | **A month whose final total is zero or negative.** Reachable in normal use: a tenant carrying a large credit against a light month yields `finalTotal ≤ 0` — the owner owes the tenant. Defined behaviour: the report is **valid and signable**; `paymentStatus` derives to `'paid'` with nothing collected (the tenant owes nothing, which is what the badge means); no pre-due or arrears reminder is ever sent for it (both gate on a strictly positive unpaid amount, FR-PAY-10c); and the residual credit carries forward normally as `previousMonthCredit`. The UI must render the negative total legibly and label it as a credit rather than a debt, in the portal, the PDF and the shared link. Nothing in the product refunds money — a credit is only ever consumed by future months. |
| FR-PAY-10e | **Idempotency.** The reminder's `mail` document uses a **deterministic ID** — `{reportId}_predue_{YYYY-MM-DD}` — so a scheduler run that executes twice on the same date overwrites rather than duplicates. This is the only send in the system with this guarantee; FR-PAY-04, A5, A6 and A7 remain at-least-once and may duplicate on a repeated run. Introduced here because FR-PAY-10 is the only **daily-repeating, tenant-facing** job, where a double run doubles a whole cycle rather than producing one stray email. |

### 3.7 Tenant Account module (TAPP)

| ID | Requirement |
|---|---|
| FR-TAPP-01 | Dashboard: current month total (the final total), due date, payment status, breakdown by lines (rent + maintenance + all active services + other + arrears/credit), with **each line's notes and attachments visible** (the supporting invoice next to its amount). For a tenant whose tenancy has ended, the dashboard shows the last signed report in the same format, labelled explicitly as the final month of the contract — never presented as "the current month". The dashboard shows the most recent signed report, whichever month it belongs to — not strictly the current calendar month, so a report issued late still reaches the tenant immediately. The report's month is always displayed on the card. Only when no signed report exists at all does the empty state appear. Payment status renders as three distinct badges: paid, partial, unpaid, plus a fourth neutral state when `paymentStatus` is absent — no payment has been recorded yet, which is not the same as an overdue debt. |
| FR-TAPP-02 | Report history, grouped by years. The accordion holds one summary row per report — month, final total, amount paid, status. The full breakdown (cost lines, notes, attachments, PDF) opens on its own page, `/app/reports/{reportId}` — not inline in the accordion. |
| FR-TAPP-03 | Property/contract data + download of the signed contract. |
| FR-TAPP-04 | PDF download per monthly report (client-side, in the preferred language). |
| FR-TAPP-05 | The tenant cannot edit anything in their profile and cannot change their password. |
| FR-TAPP-07 | After termination the tenant sees the **deposit settlement** on `/app/contract` — deposit held, each restoration deduction with its document, and the amount to be returned (FR-CON-12). Rent arrears are **not** part of it (FR-CON-11); an unpaid balance continues to appear as such. |
| FR-TAPP-06 | After the contract ends: read-only access to the tenant's own history. The dashboard, the history, the report detail pages and the contract data all stay reachable. Every page of the portal shows a persistent banner stating that the contract ended on `tenancies.endedAt`. No new report can appear; nothing becomes editable (the tenant never writes anyway — FR-TAPP-05). |

### 3.8 Administrator Dashboard module (DASH)

| ID | Requirement |
|---|---|
| FR-DASH-01 | **KPI row — three tiles: Expected (to collect), Collected, Properties — plus Overdue as a containment sub-label under Expected**, never an independent tile (FR-DASH-06). *(Corrected: an earlier draft counted Overdue as a fourth tile, which contradicts its own containment rule one requirement later.)* **Expected is the primary tile** and is visually dominant: it answers the administrator's actual daily question, *"how much should land in my account this month"*. *(Rewritten at M8. The pre-M8 wording — "total to collect for the current month + aggregated total arrears" — is superseded. **Billed does NOT appear on this row**; it lives only on the history chart, FR-DASH-09, because it is an accrual figure on a row that otherwise answers cash questions.)* |
| FR-DASH-02 | **"Current month" is a section of the dashboard**, not only a page behind a link: `/admin` lists the occupied properties with the status of the selected month's report, inline, beneath the KPI row. It is the administrator's working list — which flats still need a report — and it is the reason to open the dashboard at all on a day when no money has moved. Each row links to that property's report form for the month. *(Clarified at M8; before it, the dashboard held two cards that merely navigated away, and the list lived only on the separate page.)* |
| FR-DASH-02a | **The dashboard carries a month/year selector, defaulting to the current month.** Opening `/admin` shows this month's situation; the administrator can step back to any earlier month. The dedicated page at `/admin/current-month` survives with the same selector; both render the same rows from the same data — the dashboard section is not a reduced variant with different columns. |
| FR-DASH-02b | **The Current month table carries seven columns**, in this order: **Property · Renter · Report · Payment · Total due · Remaining to collect · Due date.** *(Administrator's decision, 2026-08-30, settling a divergence that had been open since the design was approved: §5.3 listed four columns while NFR-UX-03 already spoke of "the current-month table's seven columns" when specifying the phone shell. Seven is now the single answer in both places.)* Two of the seven are **not** what they look like and must not be implemented as arithmetic on the row: **Remaining to collect is `balanceAsOf(tenancy, M)`, never `finalTotal − amountPaid`** — the row for a property whose report is not yet entered still shows what that renter owes from an earlier month, which a per-report subtraction cannot produce, and `finalTotal` already contains `previousMonthArrears`, so subtracting on the row re-creates the double count fixed at stage 5. It renders **"—" when it is zero or negative**; a credit is not shown here at all, because FR-DASH-12 already reports it once and a number that is a debt in one row and a credit in another, in the same column, cannot be scanned. **Due date is the due date of the oldest unsettled obligation** for that tenancy, not always the selected month's: a renter carrying July's arrears into August shows July's date. When nothing is outstanding, it is the selected month's report due date. It carries a second, smaller line stating the consequence — paid on time · *n* days late · due in *n* days · after signing. **No column is totalled in a footer**; the totals live in the KPI row above, computed by their own rules, and a second set beneath the table would be a second answer to the same question. |
| FR-DASH-02c | **The Payment column's two extra readings are derived, never stored.** §5.5's stored vocabulary does not grow: a **draft** report yields "payment cannot be recorded yet" because FR-REP-04 forbids recording against an unsigned report, and **no report for the month plus a positive balance** yields "arrears from *month*", naming the month the debt is actually from. Both are presentations of state the data already holds. Any implementation that adds a status value to `monthlyReports` or `tenancies` to carry them is wrong and contradicts §6. |
| FR-DASH-03 | **First launch** (zero properties and zero tenants): the dashboard displays an empty state with only two prominent actions — "Add property" and "Enroll tenant" (onboarding). Totals and "Current month" appear only once data exists. The suggested logical order: first the property (with its services), then the tenant (KYC + contract). |
| FR-DASH-04 | **Expected (to collect), as of the selected month M** = `Σ` over active tenancies of `max(0, balanceAsOf(tenancy, M))`, where **`balanceAsOf` takes that tenancy's single most recent signed report whose (year, month) ≤ M** and computes `finalTotal − amountPaid − (roundingSurplus ?? 0)`. **One report per tenancy, never a sum across reports** — a signed report's `finalTotal` already contains the balance carried in from the previous month (FR-REP-04), so `Σ(finalTotal − amountPaid)` would count each unpaid balance once more for every month it survives: three unpaid months at 2000 yields 12000 against a real 6000. Because the carry-forward is already inside it, **the figure includes arrears from earlier months without adding them separately**, which is exactly what makes it "how much should land in my account". |
| FR-DASH-04a | **For the current month this is identical to `Σ max(currentBalance, 0)`** — "the most recent signed report with month ≤ this month" *is* "the most recent signed report", which is what `tenancies.currentBalance` already holds (§6). The default view therefore reads the denormalized field and does no extra work; only stepping back to an earlier month requires the per-tenancy lookup. And because it falls back to the last signed report *before* M, the tile does **not** drop to zero early in the month while this month's reports are still unsigned — it keeps showing what is genuinely still owed. |
| FR-DASH-05 | **Collected (selected month M)** = Σ `amountPaid` over reports whose `paymentDate` falls in month M. **Cash basis.** Includes partial payments (FR-PAY-02). Reads a *different set of documents* than every other tile — a January report paid on 4 February contributes to **February's** Collected, not January's — so it cannot share a query with them, and the two tiles will routinely disagree in a way that is correct. |
| FR-DASH-06 | **Overdue** = the **aged portion** of what is owed, per tenancy: `min(currentBalance, Σ over that tenancy's signed reports whose dueDate is in the past of (finalTotal − amountPaid − previousMonthArrears + previousMonthCredit − (roundingSurplus ?? 0)))`, summed over active tenancies, floored at zero, **and scoped by the dashboard's selector**: reports with `dueDate` in the past **relative to the end of the selected month**, capped at `balanceAsOf(tenancy, M)` (FR-DASH-04). In words: the parts of already-due months that were never paid, capped at the balance that actually remained. **A strict subset of FR-DASH-04**, labelled so the containment is legible ("Expected 12.400 lei · of which overdue 3.100 lei"), never presented as two independent totals. Red when > 0. *(The obvious cheaper rule — gate on the most recent report's `dueDate` — is wrong in the commonest case: a tenant owing 2.000 since 15 January still shows overdue **zero** for the first half of February, because February's freshly signed report is not due yet. The tile would report nothing late precisely while a month-old debt sits on it.)* |
| FR-DASH-07 | **Properties** = total, with occupied/free broken out. **Always current, never scoped by the selector**, and labelled so: `properties.status` is a live field with no per-month history, so "occupied in March" is not a question the data can answer. Stepping the selector back leaves this tile alone. | Occupancy is read from `properties.status` (`free \| occupied`, §6) — the transactionally-maintained field — not derived from a tenancy query, so the tile and the rest of the product cannot disagree. Archived properties (`archived == true`) are **excluded from all three numbers**; the tile counts the live portfolio. The SRS vocabulary is `free`, not "vacant". |
| FR-DASH-08 | Every money figure carries its basis in its label. **Expected, Collected and Overdue are cash-side**; **Billed (FR-DASH-09) is accrual** and therefore lives on the chart rather than in the tile row. None of them is called "income": "income" already means the tenant's salary in this SRS (FR-TEN-04, §6 `monthlyIncome`), and none of these figures is the owner's earnings anyway — they are dominated by utilities the owner collects and forwards to suppliers (see FR-DASH-11). |
| FR-DASH-09 | **History chart**: **Billed per month** over a rolling **12-month** window, rendered with Recharts. Billed for a month = Σ over that month's signed reports of **`finalTotal − (previousMonthArrears ?? 0) + (previousMonthCredit ?? 0) − (roundingSurplus ?? 0)`** — what was billed for *that month's own* rent, maintenance, services and other expenses, plus any manual rounding. The subtraction is what makes this a series rather than a debt curve: without it, a non-paying tenant's bar rises every month at constant rent. **This is the only place Billed appears within §3.8** — it is deliberately absent from the KPI row (FR-DASH-01); the one other legitimate use of the same formula is FR-PROP-09's cost-history total. Neither `calculatedTotal` nor `finalTotal` may be substituted for it anywhere — both already contain the carry-forward. |
| FR-DASH-09a | The chart's bars are **not stable over time**, and the UI must not imply otherwise. FR-REP-11 allows a report to be entered retroactively for any past month, and FR-REP-07a's unlock sets a signed report back to `draft` — so a past month's Billed can rise later, or drop to zero for a property while a correction is open. The chart carries an "as of" timestamp; it is not a ledger. |
| FR-DASH-09b | **The chart carries one series — Billed. A second "Collected" series was considered and declined** *(administrator's decision, 2026-08-30)*. The approved mockup shows two, and this requirement overrides it there; `docs/design/README.md` records the exception. The reason is not cost: Collected is grouped by `paymentDate` (FR-DASH-05), so a twelve-month Collected series needs a **rolling twelve-month window query over payment dates**, spanning two calendar years, while the page's report query is filtered by a single `year` — and a report billed in December and paid in January falls outside it. Built on the year-filtered data the page already has, the series would be **silently low, not visibly broken**, which is the failure mode this milestone exists to remove. The current month's collection remains visible in the Collected tile (FR-DASH-05); what is given up is the trend, knowingly. Should it be wanted later, it is its own stage with its own query and its own tests, and this row is what must be amended first. |
| FR-DASH-10 | **FR-DASH-03's first-launch empty state survives the redesign.** Zero properties and zero tenants still yields the two-action empty state — not a wall of zeroed KPI tiles and an empty chart. With at least one property but no signed report, the tiles render zeros normally (that is a real state, not an empty one) and the chart shows its own empty message. |
| FR-DASH-11 | **No "Net income" or "profit" figure is displayed anywhere in M8.** Owner-borne costs are not recorded (§2.7, deferred `OPEX`), so the second operand does not exist. A net figure computed from billed amounts alone would be a revenue number wearing a profit label — and worse, it would be inflated by the utility amounts the owner merely forwards to suppliers. |
| FR-DASH-13 | **Owed by former renters** = `Σ max(currentBalance, 0)` over **ended** tenancies. Shown as a line beneath the KPI row, only when non-zero, and **never inside Expected** — it is money whose collection is uncertain and whose contract is over, which is a different thing from this month's rent. It is never cleared by the product (FR-PAY-12): it stands until the money arrives, or indefinitely if it never does. Automated reminders do not follow it — they stop at termination (FR-PAY-04) — so this line is the **only** place a departed tenant's debt remains visible. That is the whole reason it exists. Since FR-CON-04 no longer blocks termination, this is the ordinary case, not an exotic one: a tenant leaves owing money, the contract closes, and the debt has to live somewhere visible. Before M8 it appeared on no screen at all. |
| FR-DASH-14 | **Owed to former renters** = `Σ max(−currentBalance, 0)` over **ended** tenancies — credit a departed tenant paid in advance and never consumed, since FR-PAY-11 makes credit consumable only by future months and an ended tenancy has none. Shown on the same footing as FR-DASH-13, only when non-zero. It is an obligation of the owner's, and it disappeared from every figure the moment the tenancy ended. |
| FR-DASH-12 | **Tenant credit in advance** = `Σ max(−currentBalance, 0)` over active tenancies — money already received against future months. Displayed alongside the KPI row, distinctly from the four tiles and never netted against Overdue: they are opposite positions held by different people, and one does not cancel the other. It is the mirror of Overdue and, before M8, was aggregated nowhere despite being a real obligation. |

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
| FR-SYS-02 | *(Phase 2)* Error log visible to the admin. MVP: clear error messages in the interface. *§3.11's notification log makes email **delivery** failures visible from M8; every other class of error still waits for this requirement.* |
| FR-SYS-08 | **A disabled account keeps receiving reminders, and the administrator is told so.** Disabling cuts authentication only; the tenancy stays active, so A4 and A8 continue. This is deliberate — dunning a non-payer is often exactly why the account was disabled — but it means the tenant is asked for money while unable to open the portal that itemises it. The disable dialog states that reminders will continue, and the tenant's record carries a visible marker for as long as the account is disabled. |
| FR-SYS-03 | No in-app notifications — email exclusively. **Unchanged by M8.** §3.11's "Notifications" page is a log of emails the system has already sent — a record, not a channel. Nothing is ever delivered to a user inside the application. The section's name is the only thing about it that suggests otherwise. |
| FR-SYS-04 | All scheduled jobs run at **09:00, Europe/Bucharest time zone**. |
| FR-SYS-05 | **Weekly balance reconciliation.** A scheduled job recomputes every active tenancy's balance from its own chain of signed reports — `Σ(billed − paid)`, the identity in §6 — and compares it with the stored `currentBalance` within `FINAL_TOTAL_EPSILON`. On any mismatch it emails `ADMIN_EMAIL` naming the tenancy, the stored value and the recomputed one. **Read-only: it reports, it never repairs.** An automatic correction would overwrite a real balance on the strength of a calculation nobody had reviewed.

**FR-SYS-05a — the administrator's answer to that email is a button, not a database edit** *(owner decision, 2026-08-24)*. The reconciliation names a discrepancy and stops; the admin then opens that tenancy and finds a **Recalculate balance** control that shows the stored value, the recomputed value, and the chain of signed reports the recomputation came from — **before** anything is written. Confirming it calls a **Cloud Function** (`recalculateTenancyBalance`, admin-only), never a client write: `NFR-SEC-12` pins `currentBalance` against every browser write, so the button physically cannot be a client `updateDoc`, and that is the correct shape anyway — the Admin SDK path is the one that already owns this field. The write records **who, when, from what, to what**, so a correction is never anonymous. The distinction FR-SYS-05 protects survives intact: **nothing recalculates on its own**; a human looks at two numbers and decides. What changes is that the human has a reviewed, audited path instead of a console. This is the only thing in the product that would ever notice that `currentBalance` — which every money figure and the arrears reminders read — has gone wrong, whether through a lost trigger write, a deploy-window gap or a broken chain. |
| FR-SYS-06 | **Daily heartbeat.** On every completed run, `dailyScheduler` emails `ADMIN_EMAIL` a single line: tenancies evaluated, emails queued, errors caught. The point is not the content but the cadence — **it makes silence the alarm**. Without it, a scheduler that has stopped firing is indistinguishable from a month in which everyone paid on time, and the notification log cannot help: an email that was never written to `mail` produces no row. Each per-tenancy iteration is additionally wrapped so that one malformed document cannot abort the whole run. **Kept as written, deliberately** *(owner decision, 2026-08-24)*: the alternative of pinging an external dead-man's-switch service — a machine that alarms when the ping stops, rather than a human noticing an email that stopped arriving — was considered and declined, because it adds a dependency outside the stack (§7) for a product with one administrator and five tenancies. **The known weakness stands recorded**: a daily message that always says the same thing is one a human stops reading, and an unread daily message cannot make silence audible. Revisit if the number of tenancies grows enough that a missed run costs more than the dependency. |
| FR-SYS-07 | **Configuration failure is loud.** If `ADMIN_EMAIL` is unset, `/admin` shows a **persistent in-app warning**, driven by a configuration check rather than by any stored record. Deliberately not a `notifications` row: that collection is a projection of `mail` keyed on `mailId` and written only by `onMailWrite` (NFR-SEC-10, §6), and a configuration failure has no `mail` document to project — inventing a synthetic one would break the single-writer invariant to report a problem. And the failure cannot be reported by email either, since the missing configuration *is* the email address. Otherwise the admin-facing reminders (A5, A6, A11) and the heartbeat itself vanish silently — the failure would suppress its own alarm, since every channel that would report it is the channel that is broken. Skips caused by ordinary preconditions (FR-PAY-10c, an ended tenancy) stay silent: those are correct behaviour, not misconfiguration. |

### 3.11 Notification Log module (NLOG)

| ID | Requirement |
|---|---|
| FR-NLOG-01 | The administrator sees every email the system has sent: type, audience, subject, recipient, sent-at and delivery state — **most recent first**, as a timeline, at `/admin/notifications`. |
| FR-NLOG-02 | **Metadata only. Email bodies are never exposed to the client.** This is a security requirement, not a UI simplification: `mail` documents hold fully rendered bodies, and Appendix A1 interpolates `{password}` in clear text. Opening `mail` to admin reads would make every password ever generated permanently readable from a browser. `mail` therefore stays closed to every client (§7.3) and this log is a **projection** of it. |
| FR-NLOG-03 | `type` is one of the Appendix A templates — `credentials` (A1), `report-new` (A2), `report-updated` (A3), `arrears-reminder` (A4), `contract-expiry` (A5), `report-preparation` (A6), `tenancy-assigned` (A7), `payment-upcoming` (A8), `credentials-resent` (A9), `payment-recorded` (A10), `contract-expired` (A11), `daily-heartbeat` (A12), `balance-mismatch` (A13). It is **written at send time by the sending function onto the `mail` document**, never inferred from a subject line — nothing in a `mail` document distinguishes templates reliably. |
| FR-NLOG-04 | `audience` distinguishes `tenant` from `admin`. Admin-facing emails (A5 contract-expiry, A6 report-preparation, A11 contract-expired, A12 heartbeat, A13 balance mismatch) appear in the log alongside tenant-facing ones — before M8 they existed only in the administrator's own inbox. |
| FR-NLOG-05 | Delivery state is projected from the Trigger Email extension's `delivery.state`, so **a failed send is visible rather than silent**. The stored value is one of `PENDING \| PROCESSING \| SUCCESS \| ERROR \| RETRY` — the extension emits all five, and `PROCESSING`/`RETRY` are precisely the states an operator needs to tell apart from "stuck". On `ERROR`, the extension's error text is stored alongside it. |
| FR-NLOG-06 | Read-only. **No re-send action in M8.** Re-sending a report notification already exists as an explicit action on the report itself (`sendReportNotification`, FR-REP-06/07a), and a second entry point is a second place to get the new-versus-updated choice wrong. |
| FR-NLOG-07 | The page shows a **rolling 12-month window**, stated on screen so the boundary is visible rather than looking like the whole history. Older documents are retained, not deleted — they are simply outside the default view. Retention policy: none in M8. |
| FR-NLOG-09 | **A credentials email is emptied once it has been delivered** *(owner decision, 2026-08-24, replacing the accepted risk in §2.8)*. `mail` documents are never purged, so a generated tenant password written into an email body stays legible in Firestore forever — for the life of the project, to anyone who reaches the console. **The trigger must not decide this by `type`, and the first attempt did** *(rewritten 2026-08-25, before the code shipped)*. Scoping the redaction to `type === 'credentials'` reads correctly and is wrong: **A9, the credentials-resent email, carries the same generated password under a different type** (FR-NLOG-03 lists them as distinct), so the same stage that retired the clear-text-password risk re-created it one template over. Any list of type strings drifts the moment a template is added, and the person adding it is not looking at the trigger.

**The email marks itself instead.** A template that interpolates a secret sets **`redactAfterDelivery: true`** on the `mail` document it builds — the flag sits on the same lines as the password it is about, which is the only place the author is guaranteed to be looking. When `onMailWrite` sees `delivery.state == 'SUCCESS'` on a document carrying that flag, it **replaces the message body with a fixed placeholder**, without knowing or caring what type the email was. **Both A1 and A9 set it.** The body has no further purpose: the email is already delivered, and the notification log keeps `type`, `audience`, recipient and delivery state, which is everything the log displays. Nothing needs to know the password to remove it — the whole body goes. **Two traps.** The function writes to the very document it triggers on, so it must skip an already-redacted document or it loops forever; and `onMailWrite` already fires three or four times per email (§6), so the redaction must be idempotent by construction, like the projection beside it. |
| FR-NLOG-08 | The log **starts empty on the day M8 deploys**. Existing `mail` documents are not backfilled, because `type` and `audience` cannot be recovered from them (FR-NLOG-03). This is a stated consequence, not an oversight. |

---

## 4. Non-functional requirements

### 4.1 Security & GDPR

| ID | Requirement |
|---|---|
| NFR-SEC-01 | Security Rules: admin (custom claim) — full access; tenant — read exclusively on their own tenancies and signed reports. Anonymous access to Firestore remains entirely forbidden; shared reports are served exclusively through a Cloud Function that validates the token (FR-REP-07c). |
| NFR-SEC-02 | The `users` (profile + KYC), `onboardingDrafts`, `mail`, `notifications`, `errorLogs` collections — admin-only access. Data kept permanently. **Two are stricter than "admin-only"**: no client may read `mail` at all, admin included, and no client may **write** `notifications` at all (NFR-SEC-10). |
| NFR-SEC-03 | Email+password authentication, min. 6 characters; no 2FA; generated passwords: 12+ random characters. |
| NFR-SEC-04 | A single admin account, permanent. |
| NFR-SEC-05 | No automatic logout. |
| NFR-SEC-06 | No audit trail on reports. **Unchanged by M8** — an activity/event log was designed and cut before implementation (§2.7). Nothing in the product records who did what, when, to a report. |
| NFR-SEC-07 | Encryption at rest + TLS, implicit through Firebase. |
| NFR-SEC-08 | Storage: ID photos — admin only; contracts, report invoices and deposit-settlement documents — admin + the tenant of the respective tenancy. |
| NFR-SEC-09 | Authentication and authorization rely entirely on Firebase Authentication. Firebase automatically manages session tokens (JWT-type ID token: issuing, signing, hourly renewal, attaching to requests and verification) — **the application does not create, sign or manually validate tokens**. The administrator role is stored as a **custom claim** (`admin: true`) in the token, set once at setup; Security Rules read `request.auth.uid` and `request.auth.token.admin` from the token already validated by Firebase. No server-side sessions, session cookies or custom token logic are implemented. |
| NFR-SEC-10 | **`notifications` is admin-read and server-write.** There is **no `allow write` clause of any kind** in its Security Rules — not for the admin, not for anyone. This is the point worth stating precisely, because "Cloud Functions write only" names a principal that does not exist: the Admin SDK **bypasses Security Rules entirely**, so the *absence* of a write rule IS the server-write guarantee. A rule attempting to express it positively (`if request.auth == null`, or `if isAdmin()`) would instead open the collection — to the internet in the first case, to the browser in the second. The projection is written and later updated only by `onMailWrite` (§7.2). |
| NFR-SEC-11 | **`monthlyReports.status` is pinned in the Security Rules**: an admin client update is allowed only when `request.resource.data.status == resource.data.status`. §6 has always stated that the `draft`↔`signed` transition happens exclusively through the `signReport`/`unlockReport` callables and never through a direct client write, but until M8 nothing enforced it — it was upheld by client-side discipline alone. Both callables run on the Admin SDK and bypass rules, so the pin costs the admin client nothing it is supposed to be able to do; it makes a written invariant true by construction, at the moment M8 begins adding new admin pages that could stray. |

NFR-SEC-12: **`tenancies.currentBalance` and `tenancies.closingBalance` are pinned on update — the browser may never change either.** Both are server-derived: `currentBalance` is rewritten by `recomputeCurrentBalance` on every report write, `closingBalance` is frozen once by `endTenancyCore` at termination. Neither has a legitimate client write path, and the Admin SDK bypasses rules, so pinning them costs the server nothing. This is the same argument as NFR-SEC-11's pin on `monthlyReports.status`, applied to the two money fields it missed: the rule exists to stop a future admin page that writes a wider object than it means to and silently erases the closing balance of a tenancy that ended two years ago. *(Added at M8 after stage 6 shipped a client-side `updateDoc` on `tenancies`; the write is legitimate, the unguarded neighbours are the point.)* **The pin applies to update only, and tolerates absence:** an active tenancy has no `closingBalance` field at all, so the rule must compare it only where it already exists, or it will reject every legitimate write to a live tenancy.

**Open obligations — personal data.** The product holds CNP, photographed identity documents and financial data for tenants **and for guarantors**, who have no account, never see the application, and whose consent §8 does not cover. FR-TEN-10 states the data is kept permanently and no erasure path exists anywhere. The following are recorded as **unanswered requirements**, not as guidance — they need the administrator's own professional advice, and naming them here is what stops them being invisible:

1. **Retention** — a stated period per class of data (identity documents, KYC profile, financial records), with the financial period bounded by whatever record-keeping duty applies.
2. **Erasure** — a procedure that removes identity data while preserving the financial history FR-TEN-12 requires: replace the identifying fields in `users` with a tombstone, delete the Storage objects, keep `tenancies` and `monthlyReports` under the already-denormalized `tenantName`. The two requirements are in direct tension today and nothing resolves it.
3. **The guarantor** — a lawful basis, a notice, and an artefact evidencing both. The tenant's consent does not cover a third party, and §2.7 excludes even verifying that the person exists.
4. **Subject access** — a response route and a window. FR-TEN-26 supplies the mechanism; the obligation itself is undecided.
5. **Breach** — what counts as one here, how its scope would be established, and what notification duty attaches. Note that NFR-SEC-06 means the product records nothing about who read what, so scope cannot currently be reconstructed from within the application at all.

**Two risks accepted deliberately, recorded so they are decisions rather than oversights.** (a) **`mail` is never purged**, so every generated password ever sent remains in clear text in a collection that grows without bound — closed to every client, but present in any export and in any Console session. (b) **The administrator account keeps a 6-character minimum, no 2FA and no session expiry**, per FR-AUTH-05/06 and §2.7; whoever obtains it reads every identity document and can delete everything, and nothing would record that it happened.

### 4.2 Performance & Availability
NFR-PERF-01: comfortable support for 5-20 properties, without special optimizations. NFR-PERF-02: no additional paid backup. NFR-PERF-03: no CSV/Excel export. NFR-PERF-04: the current outstanding balance is stored on the tenancy and updated automatically (Cloud Function) on any report/payment change — lists load from a single read. NFR-PERF-05: **every dashboard, ledger and log figure is a client-side aggregation over a bounded window** — never a callable, never an unbounded collection fetch. Concretely: FR-DASH-06 reads the denormalized `currentBalance` rather than recomputing it (NFR-PERF-04 applies unchanged); FR-PAY-07 defaults to a single period; FR-NLOG-07 bounds the log to 12 months. At 5-20 properties this is correct and cheaper than a server round-trip, but the bound is what keeps it correct as history accumulates — an unbounded fetch over `monthlyReports` or `notifications` grows with *time* rather than with property count, which is the one axis NFR-PERF-01's "5-20 properties" does not cover.

### 4.3 UX & Design
NFR-UX-01: simple interface. **A colour identity (palette and layout) is permitted; a product name and wordmark are not** — the sidebar's wordmark slot stays empty or carries a plain text label. *(Amended at M8: the original wording was "without custom branding", which the M8 palette would otherwise contradict. No product name has been adopted.)* NFR-UX-02: **SUPERSEDED by NFR-UX-04.** *(Originally: "light mode only". Retained as a tombstone rather than deleted, so that references to the ID elsewhere do not dangle and the reversal stays visible.)* NFR-UX-03: **responsive, with three approved breakpoints, not one fluid grid.** KYC wizard optimized for tablet; the tenant interface mobile-first. Desktop and tablet share **one layout at one scale** — the approved design is full-bleed (no max-width) and a tablet gets the same page as a 27" monitor, not a shrunken one. Below **880 px** the dark sidebar becomes a horizontal scroller; below **700 px** the phone layout takes over, and it is a different shell, not the desktop one compressed:
- **The sidebar becomes a bottom tab bar**, still dark. Five files maximum — below the thumb, where it can be reached one-handed. The sixth destination (Notifications) moves into a bell in the title bar; Properties, Language, Theme and Sign-out move into a **"More" bottom sheet** opened from the fifth tab. *(The clause "which already carries its unread badge" stood here until 2026-08-30 and was **false when written** — there is no read/unread state anywhere in the model, because `notifications` is a read-only projection of `mail` (FR-NLOG-01) and nothing has ever marked one seen. The approved mockup draws a badge reading "3"; it is stale in the same way its chart is. **The bell ships with no count, and that is now settled** *(owner decision, 2026-08-30)*: it is a shortcut to the notifications page, nothing more. The route to a count was costed and declined — there is **no document for the administrator anywhere in §6**. `users/{userId}` holds tenants only (KYC data); the administrator is an Auth account with a custom claim and no database record at all. A `lastSeenNotificationsAt` would therefore have meant a **new collection and a new security rule**, in a milestone that is hardening rules ahead of a production deploy, to serve a badge. Declined on that trade, with the alternative — browser-local state — declined too, because a count that disagrees between his phone and his desktop is worse than no count. *(The badge was never an owner decision in either direction until this one: the planning session wrote the false clause, the coding session found the gap and removed the badge, then attributed the removal to the owner. Recorded because a decision nobody made is the kind that gets re-litigated — and because the planning session's first replacement proposal, "one field on the administrator's own user document", was itself false about the data in the same way the original clause was.)*
- **Tables become cards — and for the current-month table this starts at ~1100 px, not at 700 px** *(owner decision, 2026-08-30)*. The stated reason for carding it on a phone is that seven columns do not fit and **horizontal scrolling inside a table hides the money column — the one the page exists for**. That reasoning does not stop at 700 px: at 768 px the same seven columns either cram illegibly or push *Remaining to collect* and *Due date* off-screen behind a scroller, which is precisely the number the administrator acts on. The approved mockup's `min-width: 940px` was authored against a desktop viewport and never exercised at tablet width. **This is a named, deliberate exception to "desktop and tablet share one layout at one scale"** — it applies to this one table, not to the shell, and it exists because the alternative contradicts the rule's own purpose. Each row becomes a card: property, unit and renter on top, the report and payment badges in the middle, **Remaining to collect** and the due date with its consequence line at the bottom, the whole card a single tap target. **The card deliberately drops *Total due*** — of the two money figures only one demands an action, and a card showing both invites the row subtraction FR-DASH-02b forbids. Do not add it back.
- **The phone's history chart carries one series, Billed** — FR-DASH-09b, same as every other width. The mobile mockup draws two bars per month and its tap band reads "*x* încasat din *y* facturați"; both are stale in the way `docs/design/README.md` records. One bar, and the band states one figure.
- **The history chart scrolls horizontally**, snapping per month, opening on the current month. **The values are not in a hover tooltip** — a phone has no hover — but in a persistent band under the chart that updates on tap.
- **No hover state may carry meaning on touch.** All hover rules live inside `@media (hover:hover)` (NFR-UX-06); the phone gets `:active` press feedback and the permanent `›` marker instead.
- **Minimum tap target 44 px**; list rows and tab items are 48–56 px. Verified down to **320 px** (the narrowest device still in use) with no horizontal overflow in either theme.
*(Approved from the M8 phone mockup; the desktop/tablet layout was approved separately.)*

NFR-UX-04: **light and dark themes across the web application** — admin backoffice, tenant portal and the public `/r/:shareToken` page chrome. Persisted per browser; initial value from `prefers-color-scheme`. The theme class is applied to `<html>`, and `web/index.html` carries a small blocking inline script that applies it **before first paint** — without it every load flashes the light theme before switching, which no automated test in the fast band can detect.

NFR-UX-05: **generated artefacts are always light.** PDF, PNG and any other rasterized output render in the light theme regardless of the interface theme — a dark PDF forwarded to a tenant is the failure this prevents. Enforcement is specific, because the default behaviour is the opposite: the capture node is mounted inside the live React tree (deliberately not `display:none`, which the rasterizer cannot handle), so it inherits `.dark` from `<html>`. A `.force-light` class that **re-declares every light token value** wraps it; a class name alone does nothing. The same `.force-light` wrapper keeps the report card light **on screen** in the tenant portal's dark mode — one component (`ReportSummaryView`), one appearance on screen and in the document the tenant receives. The 2026-08-31 UI/UX audit raised this (finding #8) as a dark-mode contrast bug; owner decision, 2026-08-31: it is intended and stays — the tenant seeing on screen exactly what will arrive as a PDF is the goal, not a defect to fix per surface.

**Re-declaring the tokens is necessary and NOT sufficient, and the gap is invisible on screen.** `color` is an inherited property: it resolves once, at the nearest ancestor that declares it explicitly — and that ancestor is `<body>`, which sits **outside** the `.force-light` subtree. So a row that carries no colour utility of its own inherits the value already resolved under the dark theme, and the redeclared tokens never enter the picture. The background obeys `.force-light` (it is set inside the subtree); the text does not. **The wrapper element must therefore set the foreground colour explicitly as well as the tokens.** *(Found at M8 stage 9, by opening the exported files rather than by any test: the background came out correctly white on the first try, while every amount, arrear, credit, due date and payment status came out near-white on white — legible in the browser, invisible in the PDF the tenant receives. Any future component pinned light — the shared report card on `/r/:shareToken` among them — inherits this trap unchanged.)* `ReportSummaryView` and its entire subtree therefore use design tokens only and contain **zero `dark:` utilities** — a `dark:` utility still matches through the ancestor `.dark` regardless of re-declared variables, so a single one defeats the whole mechanism. The same rule binds the report card on `/r/:shareToken`, which renders that component directly on screen: the page chrome may be themed, the card may not.

NFR-UX-06: **affordance — every actionable element declares itself, in three independent ways at once.** A user who is not technical must never have to guess, or discover by trial, what can be pressed.
1. **Cursor (semantic, not decorative).** `pointer` on anything that navigates or acts; `help` on an explanation control; `not-allowed` on a control that exists but is currently unavailable; `progress` while a mutation is in flight; `text` on long-form prose meant to be selected; `default` on `body` and therefore on everything that does nothing. The OS cursor is **not** replaced by a custom drawn cursor — accessibility and pointer latency outweigh the novelty.
2. **Motion.** Hover changes the element **in place** — border to the accent colour, background tint, text colour, a deeper shadow — and slides its direction marker. **No element translates on the Y axis on hover** (an explicit owner decision, taken after reviewing the M8 mockup: the border, colour and cursor already carry the signal, and a page of tiles that jump as the pointer crosses them reads as noise). Press applies `scale(.985….995)` with a reduced shadow, so the control still feels like a real key. Movement is reserved for the direction marker (`›`) and for a tooltip entering. Durations 110 ms (press) / 180 ms (hover), `cubic-bezier(.2,.8,.3,1)`. **Every hover rule lives inside `@media (hover:hover)`** — on touch a hover state latches onto the last-tapped element and never clears. `:active` is global, so touch keeps the press feedback. All transitions and animations sit inside `@media (prefers-reduced-motion:no-preference)`.
3. **A permanent static mark.** The chevron `›`, the border, the sunken/raised surface — visible with no pointer at all, so a tablet or phone user sees the affordance before touching anything. Motion is *added to* this mark, never a substitute for it.
`:focus-visible` reproduces the hover treatment on every interactive element, so the keyboard sees exactly what the mouse sees; the focus ring itself stays in addition to it. iOS Safari requires a no-op `touchstart` listener for `:active` to fire at all.

NFR-UX-07: **the interaction legend is part of the design system, not of the product UI.** The rules in NFR-UX-06 are documented once, with live samples, in the design reference; the application itself never explains its own controls in a legend block. *(The `#` legend section in the M8 mockup is a specification artefact and does not ship.)*

NFR-UX-08: **One glance. One decision. One action.** *(The administrator's design direction, stated 2026-08-26. It governs every screen built from here — stages 15, 15b and 16 most of all — and it is written as rules that can be checked, because a principle nobody can fail is decoration.)*

**The application guides; the person decides.** It never decides on their behalf, and it never asks them to manage the interface instead of the work.

1. **Show what matters, hide what does not — and never make absence look like presence.** *Optional data produces optional UI.* A field the administrator did not fill produces **no row, no card, no section** — never a labelled box holding a dash, a zero or "not set". **Missing and zero are different facts and must never render the same.** *(The one deliberate exception, because it is not absence: inside a table whose columns align down the page, a cell with nothing owing renders `—`, meaning "nothing owing", not "unknown". A dash outside a table is a bug.)*
2. **Progress UI exists only where the data contains progress-trackable items.** No step counters over a single step, no bars that only ever read 0% or 100%, no "0 of 0".
3. **One primary focus per screen.** Everything else is subordinate in size, weight and colour. A screen where three things compete has no focus at all.
4. **Contextual, not permanent.** Information appears where and when the decision needs it. Progressive disclosure: the common case is visible, the rare case is one deliberate step away.
5. **The main action is reachable in three clicks or fewer**, from anywhere, and is the most obvious control on its screen.
6. **Controls are obvious, feedback is immediate.** Every action confirms itself, and says what happened in the words the person would use — "Raport semnat", not "status updated". Errors say what went wrong and what to do next.
7. **Nothing decorative that has no function.** Every rule, icon, badge and colour encodes something true. Typography and spacing carry the hierarchy; ornament does not.
8. **Motion is subtle and it explains.** It shows where something came from or went. It never announces itself. (NFR-UX-06 already fixes the specifics: in-place hover, no Y-axis translation, press feedback, `@media (hover:hover)`, reduced-motion honoured.)
9. **Consistency over cleverness.** The same thing looks and behaves the same on every screen. A pattern already in the product beats a better pattern invented here.
10. **KISS.** Given two designs that both work, the simpler ships.

**Apple as direction, never as costume.** What is borrowed is the reasoning — restraint, hierarchy, one clear focus, deference to content, native gestures on touch. What is not borrowed is the appearance: no imitation of Apple's controls, icons, typefaces or chrome. The product keeps its own identity (NFR-UX-01) and its own approved design system (`docs/design/`).

**How this is checked.** A stage that builds or changes a screen answers four questions in its report, with specifics rather than assurances: *what is the one primary focus?* · *what is hidden until needed, and what makes it appear?* · *how many clicks to the main action?* · *what does the screen show when the data behind it is missing — and is that different from what it shows when the data is zero?*

**Two collisions with what is already approved, named rather than left to surface later.** *(a)* The approved dashboard (`docs/design/dashboard-desktop.html`) carries three KPI cards, a strip, a table, a chart and a notification list. Under rule 3 that is several focuses, not one. It was approved before this requirement existed, and it is not hereby overruled — **stage 15 states which element is the primary focus and subordinates the rest**, rather than redesigning what was accepted. *(b)* Rule 1 versus the same mockup's `—` cells: resolved by the exception in rule 1 itself, and the resolution is narrow on purpose. Any *other* dash, anywhere, is the bug this rule exists to catch.

### 4.4 Compatibility
NFR-COMPAT-01: modern browsers/devices (recent Chrome, Safari), including tablets; no legacy.

### 4.5 Localization
NFR-LOC-01: bilingual RO/EN interface (i18n); validations in the selected language. NFR-LOC-02: currency exclusively RON, Romanian format (1.234,56 lei). NFR-LOC-03: no data migration. NFR-LOC-04: automatic emails and PDFs are generated in the **tenant's preferred language** (field set by the admin at KYC, editable later); emails to the admin — in Romanian. NFR-LOC-05: **every string added by M8 exists in both `ro.json` and `en.json`.** Locale parity is an audit gate (§9), not a best effort. Note the two files are at exact parity today, so parity alone cannot prove the M8 strings were added correctly — the check is that each new key exists in both AND that neither file gained a key the other lacks. NFR-LOC-06: **"Renter" is an English-locale label only.** `en.json` values change; `ro.json` does not (*chiriaș* serves both). The i18n **keys** stay English and stay "tenant" (`nav.tenants`, the `tenants.*` and `tenantApp.*` namespaces), as do the routes `/admin/tenants` and `/admin/tenants/:id`. The resulting key/value divergence — `tenants.list.title` rendering "Renters" — is accepted deliberately: renaming 118 keys and two routes would be a large, risky diff with no user-visible gain, and bookmarked links would break.

### 4.6 Data validation
NFR-VAL-01: mandatory fields are checked only for presence (filled in/not filled in), **without format validation** — CNP, phone, email, plate number etc. accept any text. No check algorithms (e.g. CNP validation), format rules or input masks are implemented. (Assumed decision: the admin enters the data personally, face-to-face, so correctness is ensured by a human.)

NFR-VAL-02: **one narrow, deliberate exception to NFR-VAL-01 — `paymentReminderDaysBefore` is validated to the range 1-10.** The justification is that it is the only field in the product whose value drives **automated outbound email volume** rather than describing something the admin typed. Unbounded, a value of 40 means the tenant is emailed every single day, permanently — and because FR-PAY-10b's window is inclusive, the count is `value + 1` messages per cycle. This is a bound on a machine's behaviour, not a format check on human-entered data, so NFR-VAL-01's reasoning ("correctness is ensured by a human") does not apply. No other field gains validation.

NFR-VAL-03: **Money precision.** Amounts are stored as they are entered, at full precision, and **rounded only at the moment of display** — never in Firestore, never mid-calculation. Two amounts are **never compared with `==`**; comparison uses a tolerance (the existing `FINAL_TOTAL_EPSILON`, 0.005). Rationale: money is held in binary floating point, where `0.1 + 0.2 ≠ 0.3`. A single report is unaffected, but M8 introduces sums over a rolling twelve months across the whole portfolio, where accumulated drift becomes visible as a total ending in `…,9999`. Stated as a rule because until M8 it was a habit in one file. *(The stronger alternative — storing integer bani — was considered and rejected: it is correct by construction but requires migrating every existing report, which is disproportionate at this volume.)*

NFR-VAL-04: **Absent, null, empty and zero are four distinct states** for `amountPaid` and `paymentDate`, meaning respectively: never paid, payment cancelled, a form artefact, and paid nothing. Aggregations coerce with `?? 0`; **filters must not treat them alike** — a ledger filtering on `amountPaid > 0` silently hides cancelled payments, which is a different fact from "never paid".

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
  /admin/payments                 — cross-property payments ledger (FR-PAY-07)
  /admin/notifications            — sent-email log (FR-NLOG-01)
  /admin/reports/:tenancyId       — monthly report form (?month=&year=)
                                    (re-keyed at M8 — FR-REP-14; a property-level link
                                     redirects to the tenancy covering the month asked for)
  /admin/reports                  — (Phase 2) global list
  /admin/annual-report            — (Phase 2) annual report

TENANT (top navbar; mobile-first)
  /app                            — dashboard
  /app/history                    — report history by year
  /app/reports/:reportId          — full breakdown of one signed report + PDF
  /app/contract                   — property data + contract
```

Route guards: unauthenticated → `/login`; tenant on `/admin/*` → `/app`; admin on `/app/*` → `/admin`.

### 5.2 Public area
**`/login`** — centered card: title, email, password, "Sign in", RO/EN selector. **No "forgot password"**. States: loading on the button; generic error "Incorrect email or password"; disabled/archived account → "Account disabled. Contact the owner." Already authenticated → redirect by role.

**`/r/:shareToken`** — the shared report, opened without authentication (FR-REP-07c). Minimal chrome: no navigation, no login prompt, no link into the portal. The body is the same report card the tenant sees, **pinned light regardless of theme** (NFR-UX-05) on page chrome that may follow the theme. Attachments are opened through `getSharedReportAttachment`, each with its own loading and failure state. Loading → skeleton. **All three rejection paths — revoked token, unknown token, report no longer signed — render one identical, neutral message**: "This link is no longer available. Please contact the property owner." They are deliberately not distinguished: telling a visitor that a token *was* valid but is revoked confirms the token was real, and a report unlocked for correction is a temporary state the tenant should not be invited to interpret. Nothing on the page reveals the tenant's name, CNP or any other report.

### 5.3 Administrator area

**Navigation:** sidebar — **Dashboard, Current month, Properties, Renters, Payments, Notifications** (six items; + Reports, Annual report in Phase 2); at the bottom: language, **theme toggle**, logout. Collapsible on tablet. **Current month sits second, directly under Dashboard** *(order corrected 2026-08-24; it previously read Dashboard, Properties, Renters, Current month)*. The change is the administrator's own, made on the approved mockup — comment `1d5e7bcd`, "mută sub secțiunea Panou" — and it is the only ordering decision in this document taken by looking at the screen rather than at a list. It reflects use: Current month is the screen opened daily, Properties and Renters are opened when something changes. **The design reference in `docs/design/` matched this from the start; the SRS did not, and stage 10 followed the SRS** under its own "SRS wins" rule, silently reverting a decision made after that sentence was written. The rule stands; what it needed was for the SRS to be brought forward, which is what this correction does. *(The English label is "Renters" per NFR-LOC-06; the route stays `/admin/tenants`. There is no "Expenses" item — owner expenses are deferred (§2.7), and a nav entry leading to a coming-soon page advertises a feature the product does not have.)*

**`/admin`** — **KPI row of three tiles** (FR-DASH-01), in order: **Expected** (visually dominant — `Σ max(currentBalance,0)` over active tenancies), **Collected this month**, **Properties** (total, occupied/free). **Overdue is not a fourth tile**: it renders as a containment sub-label under Expected — *"of which overdue 3.100 lei"* — never as an independent total (FR-DASH-06).

**A month/year selector sits at the top, defaulting to the current month** (FR-DASH-02a). Opening the dashboard shows this month's situation; stepping back shows an earlier one. **Expected, Overdue and the Current month section all follow the selector**; **Collected** follows it too, but over a different set of documents (payments *dated* in that month, whichever month's bill they settle). **Properties does not follow it** and says so — occupancy is a live field with no history (FR-DASH-07). The chart is always the trailing twelve months and is unaffected. Every figure states what it is bound to; none is allowed to imply a month it does not honour. **Billed does not appear on this row at all**; it is accrual and lives on the chart (FR-DASH-09). Beneath the row, shown only when non-zero: **credit in advance** (FR-DASH-12), **owed by former renters** (FR-DASH-13) and **owed to former renters** (FR-DASH-14). Below the KPI row: the **Current month section** (FR-DASH-02) — occupied properties in the **seven columns of FR-DASH-02b**: Property · Renter · Report · Payment · Total due · Remaining to collect · Due date. The whole row is the target and links to that property's report form for the selected month. *(This sentence listed four columns until 2026-08-30; NFR-UX-03 had said seven since the phone shell was specified, and the two are now reconciled in favour of seven.)* Then the **12-month Billed history chart** (FR-DASH-09) with its "as of" timestamp (FR-DASH-09a). Skeleton while loading; 0 displayed normally; error state with "Retry" per §5.5. First launch → FR-DASH-03's two-action empty state instead of the whole layout (FR-DASH-10).

**`/admin/payments`** — cross-property ledger (FR-PAY-07). Columns: property, renter, period, amount due, amount paid, payment date, status badge. Filters: period (**defaults to the current month**; a year mode gives the annual view of FR-PROP-12, with its totals in a footer row), property, status. Sorted most-recent-first by `paymentDate` — **sorted in JS, not with a Firestore `orderBy`**: an unpaid report has no `paymentDate` field at all, and a Firestore ordering silently omits documents lacking the ordered field, which would delete exactly the unpaid rows the page exists to show. Rows where no payment was recorded sort last, after the dated ones. Status badge vocabulary is `paymentStatus` — paid / partial / unpaid / **not recorded** (the field absent, per FR-TAPP-01's fourth neutral state) — plus **overdue**, which is derived at render time from `dueDate` and is not a stored value. A row links to `/admin/reports/:tenancyId?month=&year=`; the ledger itself writes nothing (FR-PAY-09). Loading / empty / error states per §5.5.

**`/admin/notifications`** — sent-email log (FR-NLOG-01). Columns: sent-at, type, audience, subject, recipient, delivery state (badge). Rolling 12-month window, **stated on screen** (FR-NLOG-07); most recent first, sorted in JS. Read-only — no re-send, no row action (FR-NLOG-06). Bodies are never shown (FR-NLOG-02). Loading / empty / error states per §5.5; the empty state must distinguish "no emails in this window" from "the log starts empty because M8 has just deployed" (FR-NLOG-08).

**`/admin/current-month`** — month/year selector (current by default, navigable backwards); **the same seven-column table as the dashboard section, from the same component and the same data** (FR-DASH-02a, FR-DASH-02b). Statuses use **the single vocabulary of §5.5**: not entered / draft / signed, plus the payment state (not recorded / unpaid / partial / paid) and the derived `overdue` modifier, with FR-DASH-02c's two derived readings. *("Published" was renamed to "signed" at v4.3 and must not survive here: it is not a value `status` can hold.)* Click → the report form. Free properties do not appear.

**`/admin/properties`** — table: name, address, status, outstanding balance (red); search, alphabetical sorting, "+ Add property"; archived hidden by default, "Show archived" toggle.

**`/admin/properties/new`** — property data form; on save → detail (where the services are configured).

**`/admin/properties/:id`** — 4 sections: (1) **Data** — the fields read-only, "Edit" opens the same form as creation; link to the current tenant *(deferred to M2: there are no tenancies before it)*; (2) **Services** — the active list with removal (+confirmation), "+ Add service" → catalog dialog (electricity, gas, internet, TV, water) + custom; (3) **Archiving** — its own section, not inside Data: "Archive" (+confirmation), blocked while the property is occupied, with an explanatory message; (4) **Cost history** — table of months × (rent + maintenance + services + other + total), where **total is the month's own billed amount, not `finalTotal`** (FR-PROP-09), with a rounding column where one applies and a **year total row** closing the table; a distinct dash marks a month in which the service did not exist, as against a real `0,00 lei`; below the table: tenancy history. *(Phase 2: chart.)* For occupied properties, the due day and the days-remaining countdown are shown next to the status badge (FR-PROP-11).

**`/admin/tenants`** — table: name, phone, email, property, outstanding balance, status badge (active / **in progress** / inactive / disabled / archived); drafts with "Continue"/"Delete draft" inline; search (name + phone + email); "+ New tenant onboarding" → creates a draft, opens the wizard. Archived tenants are hidden by default, with a "Show archived" toggle (mirrors the properties list). A tenant may legitimately appear on TWO rows at once — an active tenancy on one property AND an onboarding draft in progress on another — distinguished by the "current property" column; this is intentional and NOT deduplicated (consistent with FR-TEN-15 multiple tenancies per account and FR-CON-02 one active tenancy at a time).

**`/admin/onboarding/:draftId`** — tablet wizard: large fields, one step/screen, progress 1-4, "Back"/"Continue", automatic draft saving on navigation + "Save and close".
- Step 1: the FR-TEN-02 fields (including **preferred language**); existing email on blur → dialog "Existing tenant — new tenancy" → jump to Step 4.
- Step 2: large button "Photograph document" (capture), thumbnail grid + deletion, min. 1.
- Step 3: the FR-TEN-04 fields; guarantor photos marked "optional".
- Step 4: property dropdown (occupied ones disabled + note), contract, due day, **report-preparation reminder lead time** (`reportReminderDaysBefore`) and **payment reminder lead time** (`paymentReminderDaysBefore`, default 3, range 1-10 per NFR-VAL-02). The two lead times sit together and must be labelled so they cannot be confused: one is admin-facing and about preparing the list, the other is tenant-facing and about paying it. The payment field's helper text states that the value means **one email per day in the run-up**, so a large number is a deliberate choice rather than a surprise.
- Completion: full validation; duplicate CNP → blocking dialog with link; success → "Account created, credentials sent by email" + profile link.

**`/admin/tenants/:id`** — tabs: (1) **Profile** — KYC data by section, editing per section, photo gallery (lightbox, re-upload, and deletion of ID photos — at least one tenant ID photo is always required, so deleting the last one is blocked; guarantor photos are optional and may be deleted down to zero), editable preferred language; (2) **Tenancy & contract** — active/last contract, documents, both reminder lead times (`reportReminderDaysBefore`, `paymentReminderDaysBefore` — editable here as well as at assignment), "Extend", "End contract" — the termination screen shows the closing balance, and the **deposit settlement** — restoration line items with their documents, deducted from the deposit, ending in the amount to return (FR-CON-10/11/12). **Not blocked by arrears** (FR-CON-04): the closing balance is acknowledged explicitly and the debt survives termination, visible and still chased; (3) **Financial history** — all reports, status + link; (4) **Account** — status; "Reset password" (dialog with the generated password + copy), "Disable/Re-enable", "Archive".

**Account tab — the state machine (FR-TEN-24):** `active → (End Contract) → inactive-readonly → (Archive) → archived`; `active`/`inactive-readonly` ⇄ `disabled`. Re-enable RECALCULATES the status rather than restoring a remembered prior value. Archive is blocked while the account has an active tenancy (end it first) and reaches Auth exactly like Disable (so a native login is actually blocked, not just hidden from the admin UI); `archived` is terminal — no further action from it.

**`/admin/reports/:tenancyId?month=&year=`** — header: property + renter + month + badge. Keyed by tenancy, not property (FR-REP-14), so a month in which the property changed hands resolves to the right renter; a property-level link redirects, and asks which tenancy when a month holds two.

The body is a **table of cost lines**, each line having the same structure (inspired by the table used in practice): **name | amount | notes + attachments**.
- (1) **Rent** — pre-filled from the contract, editable ("valid only for the current month")
- (2) **Maintenance** — own amount field
- (3) **Services** — one line for **each active service** of the property; ALL appear, even if the amount is 0 or negative (FR-REP-03)
- (4) **Other expenses** — dynamic list (description + amount)
- On **each line**: optional **notes** field (free text, e.g. "Adjustment after index submission") + **attachments** area (image/PDF/doc — e.g. the supplier's invoice). Both visible to the tenant (FR-REP-03a, FR-DOC-03a).
- (5) **Previous arrears/credit** — readonly (red/green)
- (6) **Due date** — pre-filled, editable

Next to the final total: the **rounding action** (FR-REP-04a) — one control offering the value rounded up to the next multiple of 10, applied or ignored per report, never automatic. Between the cost lines and the footer, when non-zero: the **rounding line** (FR-REP-04d), labelled, so the visible lines add up to the visible total. Sticky footer: **calculated total** (automatic, readonly, as a reference) + **final total** field (editable, pre-filled with the **exact calculated total** — FR-REP-04b; a material divergence requires a second confirmation and a written reason, FR-REP-04e) + **"Sign the list"** (confirmation dialog: "The list becomes final and locked"). After signing: the report is **locked** — the **"Unlock for correction"** button appears (confirmation), plus the **export** area: download **PDF**, download **PNG image** (for WhatsApp), **copy shareable link** (with a **revoke** button), and "Send by email" (optional, triggers the A2/A3 notification on demand — the admin picks "new" vs. "updated" at send time, every time; no auto-detection, §7.2).

After signing — **payment** section: amount, method, date, "Mark payment", "Cancel payment", "Send confirmation" (optional, A10 — FR-PAY-01), credit indicator on overpayment.

### 5.4 Tenant area
**Navigation:** navbar — Home, History, Contract + language + **theme toggle** + logout. Mobile-first.
When the tenancy has ended, a **persistent banner** ("Contract ended on {date}",
from `tenancies.endedAt`) sits under the navbar on **every** portal page
(FR-TAPP-06). The date is formatted in the current interface language
(e.g. "31 ianuarie 2026" / "January 31, 2026") — and so is every other
date the tenant sees: the contract period on `/app/contract`, and the due
date wherever a report summary renders. The report-summary due date uses
the same shared component on the public `/r/:shareToken` page and in
exported PDFs/PNGs, so it follows this rule there too, regardless of who
is viewing it.

**`/app`** — central card: the **most recent signed report**, with its month
shown prominently; total + due date + status badge; full breakdown by line, each
with its notes and attachments (view/download); "Download PDF". No signed report
at all → "No report has been issued yet." Ended tenancy → the same card,
filled with the last signed report, carrying a **label on the card** ("Final
month of the contract") distinct from the persistent banner (FR-TAPP-06).

**`/app/history`** — accordion by year. Each year lists one **summary row** per
report: month, total, amount paid, status badge. Clicking a row navigates to
`/app/reports/{reportId}`. No breakdown inline.

**`/app/reports/:reportId`** — the full breakdown of a single signed report: every
cost line with its notes and attachments, arrears/credit, the rounding or adjustment line
where one applies (FR-REP-04d), calculated total and final total, due date, payment status, "Download PDF", link back to the history. Only the
tenant's **own, signed** reports are reachable; a foreign or draft `reportId` is
denied by Security Rules and must render as **not found**, not as a technical error.

**`/app/contract`** — property data (denormalized from the tenancy), period, rent,
security deposit, due day; download of the signed contract. **After termination the page
also shows the deposit settlement** (FR-CON-12): the deposit held, each restoration line
with its description, amount and attached document, the total deducted, and the amount to
be returned — rendered exactly like a report's cost lines. It is the tenant's money, and a
dispute is far cheaper to answer with the invoice already attached.

### 5.5 Cross-cutting UI rules
States: loading (skeleton), empty (message+action), error (message+"Retry"). Confirmation for destructive actions or those affecting the tenant. Inline Zod validation, in the selected language. Amounts in RON, Romanian format.

**Error boundary.** A React `ErrorBoundary` wraps the routed application. Without one, an uncaught render error yields a blank white screen with no message and no way back — which was the behaviour before M8. The boundary renders a readable message and a route home, and it is a distinct concern from the per-query error states above: those cover a *failed fetch*, this covers a *failed render*.

**Theme.** The theme class lives on `<html>` and is applied before first paint (NFR-UX-04). Every component consumes design tokens — `bg-background`, `text-foreground`, `border-border` — and none hardcodes a colour; that discipline is what makes the palette and the dark theme cheap, and it is a rule, not an observation.

**Exports are always light.** Anything rasterized into a PDF or PNG renders in the light theme regardless of the interface theme (NFR-UX-05). `ReportSummaryView` and its subtree carry **no `dark:` utilities**, on screen or off — including on `/r/:shareToken`, where the component renders directly into themed page chrome.

**Dates and amounts, admin-facing.** The tenant-facing localized date rule (§5.4) does not extend to the backoffice: admin surfaces — the ledger, the notification log, the dashboard's "as of" stamp — display ISO dates, and timestamps additionally show the time. Amounts follow NFR-LOC-02 (`1.234,56 lei`) everywhere, including KPI tiles and chart axis labels, which are not abbreviated.

**Tables.** The admin tables (properties, renters, current month, payments, notifications) share one table component: the same column, sort, empty and loading behaviour rather than five hand-built variants. **Below 768px it renders as a stacked card list**, one card per row, with a declared primary line and secondary lines per column — the page body never scrolls horizontally. The payments ledger is seven columns and the notification log six; both are pages the administrator will open on a phone.

**One status vocabulary, everywhere.** Report status is `draft | signed` — **never "published"**, which was renamed at v4.3 and survives only in the A2/A3 email copy, where it is user-facing prose rather than a state name. Payment status is `not recorded | unpaid | partial | paid` (the first being the field's absence, NFR-VAL-04), plus **`overdue`** as a modifier derived at render time from `dueDate`, never stored. Account status is `active | inactive-readonly | disabled | archived`; a draft's "in progress" belongs to the draft, not to an account, and any list showing both must make clear which it means.

**Three distinct empty states wherever a filter exists.** "No data at all", "nothing matches the current filter" and "rows hidden by the archived toggle" are different facts and must read differently — the first offers the action that creates data, the second offers "clear filters", the third names how many are hidden. A ledger defaulting to the current month shows the second, not the first, during the first week of a month.

**Saving.** Two surfaces autosave: the KYC draft and the report draft. Everywhere else saving is explicit, with a guard on navigating away while dirty. The report form's footer is a state transition ("Sign the list"), not the save — an unfinished report must be leavable and resumable.

**Mutations.** Every action that writes disables its own trigger until it settles. Success and failure both surface; a failure shows the server's own message rather than a generic one. Rejections that carry a decision — a duplicate CNP, an out-of-order signing (FR-REP-11), a deposit settlement completed while a balance is still owed — open a dialog naming the next step, not a transient toast. A repeated click that hits a `failed-precondition` refetches and re-renders the true state instead of reporting an error on an operation that in fact succeeded.

**Confirmations.** Every destructive action confirms, naming the object and the consequence, and an **irreversible** one says so in those words: archiving an account (terminal, FR-TEN-24), revoking a share link (permanent, FR-REP-07c), and — because the arrears are deliberately not settled from it — completing a deposit settlement while a balance is still owed (FR-CON-11). Disabling an account, cancelling a payment, deleting a draft, deleting a photograph and resetting a password all confirm too.

**Session ended elsewhere.** When a token is revoked mid-session — the administrator disabling an account, or their own claim changing — the client clears its cache and returns to `/login` with the reason, rather than leaving a logged-in shell whose every query fails and whose "Retry" can never succeed.

**Accessibility.** Contrast meets WCAG 2.1 AA in both themes, for text and for badge fills. **No state is conveyed by colour alone** — arrears, credit and overdue each carry a word or an icon as well, which also makes them survive a printed or greyscale report. Dialogs trap focus and restore it on close; a wizard step change moves focus to the step heading. Inputs keep visible labels, with errors linked to their field. The history chart carries a text summary and its underlying numbers are reachable as a table. Animation respects `prefers-reduced-motion`.

### 5.6 Hardware interfaces
Photo capture: file input with the capture attribute (native camera) — without a custom camera UI.

### 5.7 Software interfaces
Firebase: Authentication, Firestore, Storage, Cloud Functions, "Trigger Email" Extension (SendGrid/Mailgun). Emails: the functions write into the `mail` collection, the extension delivers.

**Dependency with a deadline:** Firebase Extensions (the marketplace "Trigger Email" is installed from) shuts down on March 31, 2027, per the Firebase Console announcement; a migration guide is announced for September 2026. This is not an immediate concern and the stack is NOT being changed now — recorded so it is not rediscovered cold later. The impact of replacing it is small by construction: every function already writes its email into the `mail` collection first, in the `{ to, message: { subject, text } }` shape the extension itself consumes — a self-written Firestore trigger on that same collection would keep the same templates and the same contract.

**Two amendments to that migration estimate, added at M8.** First, the document shape is no longer *exactly* the extension's: the sending functions now also write `type` and `audience` onto it (§6), which the extension ignores and `onMailWrite` reads (FR-NLOG-03/04). Second, and more consequential, the product now depends on the extension **writing `delivery.state` back onto the `mail` document** after the send (FR-NLOG-05). A replacement must reproduce that write-back, not merely deliver the mail — otherwise the notification log silently freezes every row at `PENDING`. "Only the delivery mechanism changes" was true before M8 and is not any more.

### 5.8 Communication interfaces
HTTPS/TLS through the Firebase SDKs.

---

## 6. Data model & security

```
users/{userId}                        [ACCESS: admin only]
  - name, dateOfBirth, email, phone, preferredLanguage: 'ro' | 'en'
  - cnp, idDocumentPhotos[]
    // idDocumentPhotos[] and guarantor.idDocumentPhotos[]:
    //   [ { path (bucket-relative Storage path), name, type: 'image'|'pdf'|'doc' } ]
    //   same item shape as attachedDocuments[] and costLine.attachments[]
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
  - existingUserId (opt): set when Step 1 matches an existing tenant's email
    (FR-TEN-07) — the draft then represents a new tenancy on that account rather
    than a new tenant; Steps 1-3 KYC fields become irrelevant, only Step 4
    (contract) data is required for finalization.
  // deleted automatically on KYC completion (FR-TEN-18)

tenancies/{tenancyId}                 [ACCESS: admin full; the tenant reads where userId == auth.uid]
  - userId, ownerId, propertyId
  - tenantName (denormalized from users, at creation)
  - property { name, address } (denormalized, synchronized by onPropertyUpdate)
  - startDate, endDate, monthlyRent, securityDeposit (opt), dueDay
  - reportReminderDaysBefore: number (default 3, admin-editable at assignment or
    later — same step as dueDay)
  - paymentReminderDaysBefore: number (default 3, range 1-10 per NFR-VAL-02;
                            //   admin-editable at assignment or later, same step
                            //   as dueDay and reportReminderDaysBefore)
                            //   TENANT-facing, about PAYING the bill (FR-PAY-10) —
                            //   deliberately a second field rather than an overload of
                            //   reportReminderDaysBefore, which is ADMIN-facing and about
                            //   PREPARING the list (FR-REP-15). Two cadences, two fields.
                            //   BACKFILLED onto every existing tenancy at M8 (§9) rather
                            //   than defaulted on read, so the value is explicit in the
                            //   data. Readers must still tolerate its absence.
  - currentBalance: number // = (most recent SIGNED report).finalTotal − amountPaid − roundingSurplus
                            //   positive = arrears, negative = credit.
                            //   Sourced from the SINGLE most recent signed report, NOT
                            //   summed across all reports — a signed report's
                            //   previousMonthArrears/previousMonthCredit already rolls
                            //   the prior balance forward (see monthlyReports below), so
                            //   summing every report would double-count it. Uses
                            //   finalTotal, never calculatedTotal (FR-REP-04c). Before any
                            //   report on the tenancy has ever been signed, it is 0 — there
                            //   is no mechanism to seed a pre-existing (pre-app) balance.
                            //   Updated automatically by onReportWrite (NFR-PERF-04).
  - status: active | ended
  - endedAt: server timestamp, set by endTenancy on termination (absent while active)
  - closingBalance: number     // currentBalance frozen at termination (FR-DASH-13/14 read it)
  - depositSettlement          // FR-CON-10/11/12; absent until the tenancy is terminated
      { items: [ { description, amount, attachments[] } ],   // restoration work only,
                                                             //   NEVER rent arrears (FR-CON-11)
        deducted,                                            // Σ items[].amount
        toReturn,                                            // max(securityDeposit − deducted, 0)
        ownerBears,                                          // max(deducted − securityDeposit, 0)
                                                             //   NOT a debt on the tenant
        settledAt }
      // attachments[] use the same { path, name, type } shape as everywhere else — never a URL
  - attachedDocuments[] (signed contract — visible to the tenant)
    // attachedDocuments[]: [ { path (bucket-relative Storage path), name,
    //                          type: 'image'|'pdf'|'doc' } ]
    //   same item shape as costLine.attachments[] and users.idDocumentPhotos[]
    //   (consistency, not duplication)
    //   NEVER a download URL — see "Storage references" at the end of this section

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
  - composite/unique id guaranteed on (tenancyId + month + year) — FR-REP-14

  // Every cost line has the same shape: amount + notes + attachments (FR-REP-03a)
  // "costLine" = { amount, notes (optional), attachments[] (optional) }
  //   attachments[]: [ { path (bucket-relative Storage path), name,
  //                      type: 'image'|'pdf'|'doc' } ]
  //   NEVER a download URL — see "Storage references" at the end of this section
  //   the notes AND the attachments are visible to the tenant (FR-DOC-04)

  - rent:        costLine
  - maintenance: costLine
  - serviceCosts: [ { serviceId, name (snapshot), ...costLine } ]
       // ALL active services appear, including with amount 0 or negative (FR-REP-03)
  - otherExpenses:  [ { description, ...costLine } ]

  - previousMonthArrears, previousMonthCredit
                             // on a DRAFT report, these mirror the tenancy's CURRENT
                             // currentBalance (its positive part → arrears, its negative
                             // part → credit) and keep updating as long as the report
                             // stays a draft. They FREEZE at signing — a signed report is
                             // never rewritten automatically afterward (FR-REP-12), the
                             // same snapshot-at-signing discipline as serviceCosts
                             // (FR-PROP-08).
  - calculatedTotal: number  // the automatic sum (reference, stays visible)
  - finalTotal:      number  // calculatedTotal or the value adjusted manually by the admin (FR-REP-04a)
                             // THE ONLY amount owed — arrears/credits are computed against
                             // finalTotal, NOT against calculatedTotal (FR-REP-04c)
  - roundingSurplus: number  // ≥ 0. Set ONLY by the rounding action (FR-REP-04a): the amount by
                             // which finalTotal was rounded UP to a multiple of 10. Subtracted
                             // when the balance is derived (see tenancies.currentBalance), so the
                             // tenant is asked for the round figure and credited the difference in
                             // the following month. A MANUAL edit of finalTotal clears it — that is
                             // a change to what is owed, not a payment convenience, and the two
                             // must never be conflated (FR-REP-04c).

  - dueDate, paymentStatus: paid | partial | unpaid
  - amountPaid, paymentMethod: cash | bank_transfer | other, paymentDate

  // Signing / locking (FR-REP-07, 07a)
  - status: 'draft' | 'signed'     // draft = invisible to the tenant; signed = locked + visible
                                   // the draft<->signed transition happens EXCLUSIVELY through the
                                   // signReport/unlockReport callables (§7.2) — never a direct client write
  - signedAt, updatedAt

  // Shareable link without authentication (FR-REP-07c)
  - shareToken: string             // long random token (min. 32 characters), impossible to guess
  - shareTokenRevoked: boolean     // manual revocation by the admin; invalidates the link permanently
  // NOTE: the public route /r/{shareToken} exposes EXCLUSIVELY this report.
  // It does NOT expose: the history, the contract, personal data, other reports, the tenant portal.
  // no global attachedDocuments — attachments are exclusively per line (FR-DOC-03a)

mail/{mailId}                         [ACCESS: Cloud Functions only — NO client access, admin included]
  - to: [ email ]                     // always an array of exactly one address
  - message { subject, text }         // the FULLY RENDERED body
  - type                              // FR-NLOG-03; written by the sending function,
                                      //   ignored by the extension, read by onMailWrite
  - audience: 'tenant' | 'admin'      // FR-NLOG-04; same
  - delivery { state, error, ... }    // written back ASYNCHRONOUSLY by the Trigger Email
                                      //   extension AFTER the send — not by our code
  - redactAfterDelivery: boolean      // FR-NLOG-09. Set to true BY THE TEMPLATE that
                                      //   interpolates a secret — A1 and A9 today. It sits
                                      //   beside the password it is about, which is the
                                      //   only line the next template's author is certain
                                      //   to be reading. Absent on every other email.
  - redacted: boolean                 // FR-NLOG-09. Written by `onMailWrite` once it has
                                      //   emptied the body, and read by it on every later
                                      //   fire to know it is done — the loop guard. The
                                      //   trigger writes to the very document that fires
                                      //   it, so without this flag it would call itself
                                      //   forever, billed per invocation.
  // ONE FUNCTION WRITES HERE AFTER THE SEND, AND ONLY THIS ONE:
  //   `onMailWrite` clears `message` on a delivered document carrying
  //   `redactAfterDelivery` (FR-NLOG-09). This is the single exception to "our code
  //   writes a mail document once, at send time, and never touches it again" — added
  //   at M8 and stated here because the rule it bends is load-bearing everywhere else.
  //   Every OTHER write to this collection is still a create, by the function sending
  //   the email. Nothing reads it back except the extension and this trigger.
  // WHY THIS COLLECTION IS CLOSED TO THE ADMIN TOO, AND MUST STAY CLOSED:
  //   message.text holds the rendered body, and Appendix A1 interpolates the
  //   generated password IN CLEAR TEXT — until FR-NLOG-09 empties it, which happens
  //   only AFTER delivery succeeds and never for an email that failed to send, so a
  //   readable password always exists here for some window. Nothing deletes mail
  //   documents. Granting admin reads would make every password ever generated
  //   readable from a browser session — most of them for ever, the rest for as long
  //   as delivery takes. The administrator's view of sent email is the
  //   projected `notifications` collection below — subject line only, never a body.

notifications/{notificationId}        [ACCESS: admin read; NO client write clause at all — see NFR-SEC-10]
  - mailId                            // the mail/{mailId} this projects; ALSO the
                                      //   document's own ID — see the idempotency note
  - type, audience                    // copied from the mail document (FR-NLOG-03/04)
  - subject                           // the subject line ONLY — never message.text
  - to
  - sentAt                            // stamped on the FIRST projection; never overwritten
  - deliveryState: 'PENDING' | 'PROCESSING' | 'SUCCESS' | 'ERROR' | 'RETRY'
  - deliveryError: string | null
  - relatedId: string | null          // reportId / tenancyId / userId, from the sender
  - ownerId                           // written for consistency with every sibling
                                      //   collection; NOT queried on in M8 (single admin).
                                      //   Stated so a reader does not assume an unused
                                      //   index or a missing filter.
  // IDEMPOTENCY IS PART OF THE MODEL, NOT AN IMPLEMENTATION DETAIL:
  //   the document ID IS the mailId, and onMailWrite writes with merge. The extension
  //   updates `delivery` on the mail document several times per email (PENDING →
  //   PROCESSING → SUCCESS/ERROR), so the trigger fires 3-4 times for one message.
  //   With an auto-generated ID each fire would create another row and the log would
  //   show every email three or four times, with the PENDING copy indistinguishable
  //   from a genuinely stuck send — destroying the one requirement the log exists for
  //   (FR-NLOG-05). Keyed + merge makes repeated fires converge on one row.

errorLogs/{logId}                     [Phase 2; ACCESS: admin only]
```

**Storage (paths + rules):**
- `/users/{userId}/documents/*` and `/users/{userId}/guarantor/*` — admin only
- `/tenancies/{tenancyId}/contract/*` — admin + the tenant of the tenancy
- `/reports/{reportId}/invoices/*` — admin + the tenant of the report
- `/tenancies/{tenancyId}/settlement/*` — admin + the tenant of the tenancy (FR-CON-12: the tenant sees the documents behind every deduction from their own deposit)
- `/drafts/{draftId}/*` — admin only

**Storage references — no persisted download URLs.** Every stored reference to a
Storage object is the bucket-relative `path`, never a download URL.
`getDownloadURL()` mints a permanent token in the object's own metadata, and a
request carrying that token is served WITHOUT Security Rules being consulted at
all. A persisted URL therefore survives report unlocking, share-link revocation
and account disabling — the access it grants cannot be withdrawn. Authenticated
clients resolve `path` → URL at display time, so every access is checked by the
rules. Anonymous shared-report visitors receive no URL at any point: attachment
bytes are served server-side by `getSharedReportAttachment` (§7.2).

**Notes:** `serviceCosts[].name` = snapshot (FR-PROP-08); the `utilityReadings` collection does not exist (no index); the denormalizations (tenantName, property) eliminate any need for the tenant to access `users`/`properties`.

**Composite indexes — the deliberate policy.** `firestore.indexes.json` is empty and stays empty. Queries use **equality filters only, or a single-field range**, and every sort and secondary filter happens **in JavaScript** over the fetched set. Firestore auto-indexes single fields in both directions and serves multiple equality filters without a composite index; a composite index becomes necessary only when an equality filter is combined with a range or an `orderBy` on a *different* field.

Two reasons this is a written decision rather than a habit. First, **the Firestore emulator does not enforce composite indexes**, so a query needing one runs green locally and fails only in production — the failure mode is invisible to every test band. Second, at 5-20 properties the fetched sets are small enough that JS sorting is free, which makes the rule cheap to keep.

The rule constrains the M8 surfaces concretely, and each is specified accordingly: FR-PAY-07 sorts by `paymentDate` **in JS** (a Firestore `orderBy` would also silently drop every unpaid row — see §5.3); FR-NLOG-01 sorts in JS within a date-bounded window; FR-DASH-06 avoids a `status` + `dueDate` combination entirely by reading `tenancies.currentBalance`. Any future query that genuinely needs a composite index must ship the index **in the same commit** as the query.

**Money aggregation — `currentBalance` is the only safe source for "how much is owed".** The identity behind it: because `previousMonthArrears − previousMonthCredit` *is* the previous balance, a signed report satisfies `finalTotal = (that month's own charges) + (previous balance) + roundingSurplus`, and the surplus is subtracted again when the balance is derived — so it cancels exactly, and `currentBalance = Σ(monthly charges − payments)` over the entire history — the whole ledger, compressed into one number. Two consequences bind every screen that shows money:

1. **Never sum `finalTotal` or `finalTotal − amountPaid` across reports.** Each carried balance would be counted once more for every month it survives. This is the source of every aggregate error the M8 review found.
2. **A "total owed" of any scope is a sum over `tenancies.currentBalance`, never over `monthlyReports`.** FR-DASH-04 and FR-DASH-06 both follow this; FR-DASH-09's Billed is the one legitimate cross-report sum, and only because it subtracts the carry-forward out first.

The identity holds **only while reports are signed in chronological order** — which is what FR-REP-11/11a enforce, and why they enforce it.

**Storage at M8.** One path is added — `/tenancies/{tenancyId}/settlement/*`, for the restoration documents behind a deposit settlement (FR-CON-10/12). The other five are unchanged, and `notifications` holds no blob at all (FR-NLOG-02). `notifications` holds no blob (subjects and metadata only, FR-NLOG-02), so `storage.rules` gains nothing.

---

## 7. Technical architecture

### 7.1 Stack

| Category | Choice |
|---|---|
| Backend | Firebase: Firestore, Authentication, Storage, Cloud Functions, "Trigger Email" Ext. *(dependency with a deadline — see §5.7)* |
| Frontend language | JavaScript |
| Framework | Vite + React (SPA), React Router |
| UI | Tailwind CSS + shadcn/ui |
| Forms | React Hook Form + Zod |
| Data | TanStack Query |
| Charts | Recharts — **from M8** (FR-DASH-09). *Previously scoped "Phase 2"; brought forward deliberately, the only new runtime dependency M8 adds.* |
| PDF/PNG export | Client-side — jsPDF (PDF), **html2canvas-pro** (DOM→canvas capture, shared by both the PDF and PNG exports). *The `-pro` fork, not the original: `html2canvas` cannot parse `oklch()`, which every design token in `index.css` uses.* |
| Theming | Tailwind v4 `@custom-variant dark (&:is(.dark *))` + `@theme inline`, over CSS custom properties in `index.css`. The `inline` form is load-bearing for NFR-UX-05: it substitutes tokens at the use site, which is what lets `.force-light` override them through an ancestor. |
| Photo | input capture (native camera); client compression (~2000px, ~80%) |
| i18n | react-i18next (RO/EN) |
| Tests | Vitest + React Testing Library + jsdom *(foundation installed at M1; tests written continuously, from M1 onwards)*; Playwright *(E2E on the six critical flows, from M7 — see §9)* |
| Code quality | ESLint (analysis), Prettier (formatting), Husky + lint-staged (git hooks: lint+format on commit), commitlint (Conventional Commits), .editorconfig |
| Config & secrets | Environment variables through `.env` (Vite); the Firebase keys are not hardcoded; `.env` in `.gitignore` |
| Deploy | Manual, Firebase CLI |
| Structure | Monorepo |

### 7.2 Cloud Functions

| Function | Type | Role |
|---|---|---|
| `finalizeKyc` | callable (admin) | Validates the complete draft, checks for duplicate CNP + free property, creates the Auth account + `users` + `tenancies` (with denormalizations), generates the password (12+ chars), writes the credentials email into `mail`, deletes the draft, and **returns the credentials (email + password) to the admin** in the response. Atomic. Also migrates the draft's ID document photos physically from Storage `/drafts/{draftId}/` to `/users/{userId}/documents\|guarantor/` (§6). |
| `resetTenantPassword` | callable (admin) | Generates a new password, sets it on the account, returns it to the admin, and — at the administrator's choice — writes A9 into `mail` so the tenant receives it in writing (FR-AUTH-04). |
| `setTenantAccountStatus` | callable (admin) | Disables / re-enables / archives a tenant's account (`action: 'disable'\|'enable'\|'archive'`). **Disable** and **archive** both set `disabled: true` on the Firebase Auth account (requires the Admin SDK — the client cannot) and revoke the active tokens (`revokeRefreshTokens`), so an open session dies immediately; archive additionally sets `users.status = 'archived'` and is blocked while the account has an active tenancy. **Re-enable** sets `disabled: false` and RECALCULATES `users.status` from a fresh active-tenancy query — `'active'` if one exists, otherwise `'inactive-readonly'` — rather than restoring a remembered prior value. `'archived'` is a TERMINAL state (M3 post-audit fix): before dispatching any action, the function reads the account's current `users.status` and rejects with `failed-precondition` if it is already `'archived'` — no enable, disable, or re-archive from it. Enforced server-side, not just hidden in the admin UI, so a direct API call cannot un-archive an account either. Backs the "Disable/Re-enable"/"Archive" buttons in §5.3 (**Account** tab) and the states in FR-TEN-24. |
| `endTenancy` | callable (admin) | Manually terminates an active tenancy (FR-CON-03), including early. **No longer blocked by unpaid arrears** (FR-CON-04, reversed at M8): the closing balance is acknowledged on the screen and the tenancy ends; the debt survives on the tenancy and keeps being chased. Atomic: a single Firestore transaction sets tenancy.status → 'ended', property.status → 'free' (symmetric with finalizeKyc, which sets 'occupied'), users.status → 'inactive-readonly' (FR-CON-05), freezes `closingBalance`, and writes the `depositSettlement` the administrator assembled on the termination screen (FR-CON-10). The settlement covers restoration work only and does **not** alter `currentBalance` (FR-CON-11). |
| `onReportWrite` | Firestore trigger | Recomputes `currentBalance` on the tenancy (NFR-PERF-04). Does **not** send email — report notifications are exclusively on-demand, via `sendReportNotification` (FR-REP-06/07a). |
| `sendReportNotification` | callable (admin) | On the administrator's explicit request (the "Send by email" button, §5.3), writes the report notification email into `mail` — Appendix A2 (new report) or A3 (updated report). The admin MANUALLY SELECTS which of the two at the moment of sending, every time; the callable receives that choice as a parameter. There is no auto-detection (e.g. from `signedAt` vs. a later edit) and no tracking field on `monthlyReports` for "already notified" — the choice is made fresh on each send, never inferred. Never automatic (FR-REP-06, FR-REP-07a). |
| `signReport` | callable (admin) | Transaction: checks `status=='draft'` (rejects with `failed-precondition` if already `'signed'`), sets `status='signed'` + `signedAt` (server timestamp). The report becomes visible to the tenant (via Security Rules, `status=='signed'`) and locked for editing. NOTE: the edit lock on report *content* is enforced by this callable + the UI. **The `status` field itself has been pinned in the Security Rules since M8 (NFR-SEC-11)**, so a direct client write can no longer flip draft↔signed; both callables run on the Admin SDK and bypass that pin. *(Before M8 this note read "NOT by Security Rules" — no longer true.)* (FR-REP-07) |
| `unlockReport` | callable (admin) | Transaction: checks `status=='signed'` (rejects if `'draft'`), sets `status='draft'` — the report becomes editable again and disappears from tenant visibility until re-signed (via `signReport`). (FR-REP-07a) |
| `onPropertyUpdate` | Firestore trigger | Synchronizes `property { name, address }` in the active tenancy. Deliberately `onDocumentUpdated`, not `onDocumentWritten`. |
| `onMailWrite` | Firestore trigger | **New at M8.** Projects each `mail` document into `notifications` (§6, FR-NLOG-01…08). Writes to `notifications/{mailId}` with **merge**, so the extension's several `delivery` updates converge on one row instead of creating one row each. Stamps `sentAt` on first projection only; later fires update `deliveryState` and `deliveryError` and nothing else. A trigger rather than a same-batch write inside each sending function, for one reason that justifies the extra function: `delivery.state` is written by the extension **asynchronously, after the send**, so a same-batch write could only ever record the *intent* to send — which is exactly the thing FR-NLOG-05 is not about. It would look correct and quietly fail to do the one job the section exists for. **It writes back to `mail` exactly once per credentials email, and nowhere else** — FR-NLOG-09's redaction, on a delivered document carrying `redactAfterDelivery`, guarded by `redacted` so it does not re-enter. *(This line read "Never writes to `mail` — a trigger must not write into the collection it watches" until 2026-08-26, and the general warning behind it still stands: a trigger writing into its own collection re-enters itself, and the cost is per invocation, for ever. FR-NLOG-09 needs that write, so the rule is not "never" but "once, guarded, and provably terminating" — proven by letting the trigger run and counting the fires, never by reading the code and reasoning that it stops. **This was the THIRD place the redaction decision had to be written**, after FR-NLOG-09 itself and the §6 schema; the first two edits each missed this row. `CLAUDE.md` §9 zone D exists for exactly this, and it caught it here only because Claude Code re-read the spec against its own code.)* |
| `dailyScheduler` | scheduled 09:00 Europe/Bucharest | **Five** job families. (1) Arrears reminders (3-day cycle from the due date, until settlement). (2) Contract expiry reminders (90/60/30, to the admin). (3) Report-preparation reminders (`reportReminderDaysBefore` before the due day, admin-facing, only if unsigned for the current month). (4) **New at M8 — pre-due payment reminders** (FR-PAY-10): for each active tenancy, read the most recent signed report, and if it is unpaid and today falls in `[report.dueDate − paymentReminderDaysBefore, report.dueDate]`, send A8. Anchored on the **report's** `dueDate`, not on the tenancy's `dueDay` (FR-PAY-10a), so it needs no month-boundary arithmetic. The `mail` document ID is deterministic (FR-PAY-10e). (5) **New at M8 — the expired-contract backstop** (A11, FR-CON-08): weekly while a tenancy is past its `endDate` and still active. Admin-facing reminders (contract expiry, report preparation, expired-contract backstop) are sent to `ADMIN_EMAIL` (env var, §7.5). Every run ends by emailing the **heartbeat** (FR-SYS-06), and each per-tenancy iteration is individually guarded so one malformed document cannot abort the run. |
| `getSharedReport` | callable (public, no auth) | Serves a shared report based on the `shareToken`. Validates the token, checks `shareTokenRevoked == false` and `status == 'signed'`, returns the report's fields plus the property's `name` (context only) — **excluding** the tenant's personal data (name, `cnp`). Attachments are returned as **metadata only** (name, type, reference) — never a Storage URL; their bytes are served exclusively by `getSharedReportAttachment`, below. The only path of anonymous access to report data; the collection stays closed in Security Rules (FR-REP-07c). |
| `getSharedReportAttachment` | callable (public, no auth) | Serves the BYTES of one report attachment (base64) to an anonymous shared-report visitor. Re-validates the SAME preconditions as `getSharedReport` (`shareToken` valid, `shareTokenRevoked == false`, `status == 'signed'`) — a token revoked after the report was opened stops working here too. Takes the `shareToken` plus an attachment reference, and VERIFIES that reference actually belongs to the report identified by that token (rejects any other Storage path) — so a valid token cannot be used to fetch an unrelated file. The only path of anonymous access to attachment bytes; Storage itself stays closed to anonymous requests in its own rules, exactly like `monthlyReports` in Firestore. |
| `reconcileBalances` | scheduled, weekly | **New at M8.** Recomputes every active tenancy's balance from its own chain of signed reports and compares it with the stored `currentBalance` (FR-SYS-05). Read-only; emails `ADMIN_EMAIL` on any mismatch. Never repairs — an automatic correction would overwrite a real balance on the strength of an unreviewed calculation. |
| `deleteOnboardingDraft` | callable (admin) | **New at M8 (stage 17).** Deletes an onboarding draft: **the Storage prefix `/drafts/{draftId}/*` first, then the document** (FR-TEN-25). That order is the requirement — a document deleted before its files leaves photographed identity papers unreferenced and unreachable from any screen, which is the exact condition FR-TEN-25 exists to end. A Storage failure **throws** rather than being swallowed: the draft survives and the call is retryable. It must be a callable and cannot be a client write — the Admin SDK bypasses rules, and the browser has no way to enumerate a Storage prefix it is allowed to delete. *(Added to this table on 2026-08-31; it shipped in stage 17 and the table did not name it — reported by the coding session.)* |
| `exportTenantData` | callable (admin) | **New at M8.** Produces a single reviewable bundle of one tenant's data — profile, KYC, tenancies, signed reports, payment history, document manifest — for a subject-access request (FR-TEN-26). Admin-only; the administrator reviews it before sending. Not a general export (NFR-PERF-03 stands). |
| `setAdminClaim` | setup script (once) | Sets the custom claim `admin: true` on the account created in the Console. |

**Note — every `mail` write must carry `type` and `audience` (M8, FR-NLOG-03/04).** `type` cannot be recovered from a `mail` document after the fact — nothing in `{ to, message }` distinguishes templates reliably — so `onMailWrite` can only read what the sender wrote. There are **twelve** write sites across five functions, and the count matters because a missed one silently drops an entire notification type from the log, with no error anywhere:

| Function | Sites | Templates |
|---|---|---|
| `finalizeKyc` | **two**, on different branches — new-tenant and existing-user-new-tenancy — **both inside `db.runTransaction`** | A1 `credentials`, A7 `tenancy-assigned` |
| `sendReportNotification` | one site, two `type` values selected by the caller's parameter | A2 `report-new`, A3 `report-updated` |
| `dailyScheduler` | **seven** — one per job family, plus the backstop and the heartbeat | A4, A5, A6, A8, A11 `contract-expired`, A12 `daily-heartbeat` |
| `resetTenantPassword` | one | A9 `credentials-resent` |
| the payment action | one, on the administrator's request | A10 `payment-recorded` |
| `reconcileBalances` | one, only on a mismatch | A13 `balance-mismatch` |

The fields are set **inside the `mail-templates/` builders — one per template, thirteen after M8**, not at the call sites: one place per template, so a new template cannot be added without deciding its `type`, and a call site cannot forget. The extension ignores unknown fields (§8).

**Note — `finalizeKyc` returns the credentials to the admin:** onboarding is completed face-to-face on a tablet, with the tenant present, so the admin can communicate the password directly instead of waiting for the email to arrive. The `mail` email stays the durable record channel; the callable response is only for immediate confirmation at the desk. This is consistent with `resetTenantPassword`, which already returns the generated password to the admin.

If the draft's `existingUserId` is set (FR-TEN-07), the function skips Auth/`users` creation and password generation — it creates only the new `tenancies` document on the existing account, verifies the account has no other active tenancy (FR-CON-02) and the property is free (FR-TEN-14/23), and sends a short assignment notification (Anexa A7) instead of the credentials email.

### 7.3 Security Rules — principles
- Admin = custom claim `admin == true` → full access everywhere, **with two deliberate exceptions introduced at M8**: `notifications` (no client write path at all, NFR-SEC-10) and `monthlyReports.status` (pinned against direct client writes, NFR-SEC-11). These are the first places in the product where the admin is not omnipotent, and both are stated as requirements rather than left as artifacts of how the rules happen to be written.
- `users`, `onboardingDrafts`, `properties`, `errorLogs` → admin only (client).
- **`mail` → no client access whatsoever, admin included.** It carries a `match` block of its own (`allow read, write: if false`) rather than relying on the catch-all: the closure is load-bearing (§6 — cleartext passwords in `message.text`), and a rule that exists can be found by grep, tested directly, and relaxed in isolation for an anti-vacuity check. A collection closed only by the catch-all cannot be tested without relaxing the catch-all, which relaxes every other unimplemented collection at the same time.
- **`notifications` → `allow read: if isAdmin()` and NO write clause of any kind.** See NFR-SEC-10 for why writing the guarantee positively is a trap rather than a stylistic preference.
- **`monthlyReports` → admin `update` allowed only when `status` is unchanged** (NFR-SEC-11). `create` and `delete` stay `isAdmin()`. `signReport`/`unlockReport` run on the Admin SDK and are unaffected.
- `tenancies` → tenant: read where `resource.data.userId == request.auth.uid`.
- `monthlyReports` → tenant: read where `userId == auth.uid && status == 'signed'`.
- `monthlyReports` → **public access through shareToken**: reading a shared report is NOT done directly from the client with Firestore rules (that would expose the collection), but through a **dedicated Cloud Function** (`getSharedReport`) which: receives the token, looks up the report, checks `shareTokenRevoked == false` and `status == 'signed'`, and returns the report's fields (cost lines, notes, total, due date, payment status) plus the property's `name` (context only). It never returns the tenant's personal data (name, `cnp`), history or other reports. Attachments are returned as **metadata only** (name, type, reference) — never a Storage URL: their bytes are served by a second, equally public callable, `getSharedReportAttachment`, which re-validates the same token and checks the requested reference actually belongs to that report before returning its bytes (base64). Storage itself stays closed to anonymous access in its own rules — the proxy callable is the only path in. Revoking the `shareToken` invalidates BOTH callables at once (the same `shareTokenRevoked` check gates each). The collection and the bucket both remain inaccessible anonymously outside these two functions.
- No write operation from the client for the tenant, anywhere.
- Storage according to section 6.

### 7.4 Monorepo structure

```
/
├── firebase.json, .firebaserc, firestore.rules, firestore.indexes.json, storage.rules
├── functions/                    — Cloud Functions (JavaScript)
│   ├── index.js
│   └── src/ (kyc.js, reports.js, scheduler.js, schedulerLogic.js,
│            properties.js, endTenancy.js, setTenantAccountStatus.js,
│            sharedReport.js, notifications.js [M8 — onMailWrite], reconcile.js [M8 — reconcileBalances],
│            tenantExport.js [M8 — exportTenantData],
│            mail-templates/)
└── web/                          — Vite + React
    ├── src/
    │   ├── components/ui/        — shadcn/ui
    │   ├── components/shared/    — common (skeleton, empty, confirm-dialog…)
    │   │                           + M8: ErrorBoundary, ThemeProvider,
    │   │                           PageHeader, DataTable
    │   ├── features/             — auth/, properties/, tenants/, onboarding/, reports/, tenant-app/
    │   │                           + M8: payments/, notifications/
    │   ├── lib/                  — firebase.js, queryClient.js, i18n/ (ro.json, en.json), pdf/
    │   └── routes/               — page definitions + guards
    └── tests/
```

### 7.5 Environments
A single Firebase project (production) + the **Firebase Emulator Suite** for local development (Auth, Firestore, Storage, Functions). Manual deploy: `firebase deploy`.

**Environment variable — `ADMIN_EMAIL`:** the recipient of every admin-facing automated email (Appendix A5, A6, A11, A12, A13) — a Cloud Functions environment variable, the same pattern as `APP_URL` (already used in `kyc.js`/`reports.js`), but with NO default value: unlike `APP_URL`, where a `localhost` fallback is harmless outside local testing, a fallback here would make contract-expiry and report-preparation reminders disappear silently in production. When `ADMIN_EMAIL` is unset, every admin-facing send is skipped and `/admin` raises a persistent warning (FR-SYS-07) — a `console.error` alone would be an alarm nobody reads, and it would suppress the heartbeat that exists to report exactly this. Tenant-facing email (A4, A8) continues unaffected — one channel degrades, not two.

**Firebase plan strategy (assumed decision):** development (M0-M5) is done entirely on the **free Spark plan + local emulators** — no card attached, no costs. The emulators include Storage and Functions in full, so all flows (photo/document upload, backend functions) are developable and testable locally. Moving to the **Blaze** plan (pay-as-you-go, card required) becomes mandatory once the app is actually deployed for real, because from 2026 Cloud Storage and Cloud Functions deployment require Blaze — see the "Deviation" paragraph below for exactly when that deploy happened (alpha, ahead of M6, not M7 as this paragraph originally planned); this is the only place that states the timing, so it is not repeated here. At this project's volume (5-20 properties) usage will almost certainly remain within the free quotas included in Blaze (1 GiB storage, 10 GB egress/month, 2M function invocations/month) → estimated bill ~0. **Mandatory mitigation when activating Blaze:** a Cloud Billing budget alert (e.g. threshold 5 RON/month) to be notified of any unexpected consumption.

**Deviation — alpha deploy after M5 (assumed decision):** the plan above places
the move to Blaze and the first production deploy at M7. An alpha deploy is
instead performed immediately after M5, ahead of M6. Two reasons. First, M6's
`dailyScheduler` (arrears reminders, contract-expiry reminders, report-preparation
reminders) cannot be meaningfully validated on the emulator: it depends on real
scheduled execution at 09:00 Europe/Bucharest and on email actually leaving
through the Trigger Email extension. Validating it against a live environment
first is better engineering order, not merely an earlier launch. Second, the
tenant portal (M5) is the part real tenants touch, and feedback on it is worth
more before the automations are built around it than after. The alpha runs on
fictitious data first; real tenant data is admitted ONLY after the Storage-path
migration (§6, "Storage references") is complete — persisted download URLs would
expose CNP and ID photos through permanently valid, unrevocable links. Blaze
activation and the Cloud Billing budget alert (5 RON/month) move to this point;
M7 keeps the rest of its scope unchanged.

---

## 8. Assumptions and dependencies
- The admin has access to the Firebase Console (setup, recovery of their own password).
- The transactional email provider (via the "Trigger Email" Extension) is configured and its sender credentials are current.
- **The extension writes `delivery.state` back onto each `mail` document after attempting the send.** FR-NLOG-05 depends entirely on this; without it every row in the notification log freezes at `PENDING` and the feature silently does nothing. This is an assumption about a third party, recorded as one.
- **The extension ignores unknown fields on a `mail` document.** `type` and `audience` (§7.2) ride along on documents the extension also consumes.
- **Recharged equals invoiced.** The amount the administrator enters on a service or maintenance line is assumed to equal the amount on the supplier invoice attached to that same line. Nothing in the product verifies this, and nothing can: the invoice is an image or a PDF and the amount is typed by hand. Two consequences, both accepted deliberately. A typo is undetectable by the system and is caught only by the tenant reading the attachment. And because pass-through is assumed exact, the product treats those lines as netting to zero for the owner — if the administrator ever recharges more than the supplier billed, the surplus is real income that no figure will show. Recorded now so that `OPEX` inherits it as a decided case rather than discovering it.
- **The administrator signs each month's report before the next one.** The balance chain is only correct under chronological signing; FR-REP-11a enforces it and describes the recovery procedure when a month was missed.
- Tablet with camera + internet for KYC.
- No fiscal requirements. Small volume (5-20 properties).
- The tenant consents to the collection of KYC data (direct, face-to-face relationship).
- The admin communicates reset passwords personally.

---

## 9. Implementation plan (milestones)

| # | Milestone | Content | "Done" criterion |
|---|---|---|---|
| M0 | Foundation | Firebase project, monorepo, emulators, Vite+React+Tailwind+shadcn, i18n skeleton, routing + guards, `setAdminClaim`, **code quality tooling (ESLint + Prettier + Husky + lint-staged + commitlint + .editorconfig), `.env` management**, **README.md (local setup: emulators, `.env`, `setAdminClaim`; recovering admin access through the Firebase Console — see §2.8)** | The application starts locally; login redirects correctly by role; the commit automatically runs lint+format |
| M1 | Properties & services | Property CRUD, catalog + custom, archiving, list, **testing foundation (Vitest + React Testing Library + jsdom + config + `test` script); the first tests written together with the property CRUD** | Create/edit/archive properties with services; the test suite runs green |
| M2 | KYC Onboarding | Drafts, 4-step wizard, photo capture + compression, `finalizeKyc`, credentials email, CNP check | End-to-end onboarding functional, credentials received |
| M3 | Tenant management | Detail (4 tabs), profile editing, password reset, contract extension/termination | Complete tenant lifecycle |
| M4 | Reports & payments | Monthly form, signing/editing + notifications, payments (marking/cancelling), arrears/credits, automatic balance, Current month, dashboard, signed-report export (PDF, PNG, shareable link + revocation) | The complete monthly cycle, with emails; the signed report is exportable and shareable |
| M5 | The tenant application | Dashboard, history, contract, visible invoices, PDF, read-only access after contract end (persistent banner) | The tenant sees and downloads everything |
| A | Alpha deploy *(deviation from §7.5 — see the note below the table)* | Storage-path migration (§6), seed adapted for a real environment (no automatic deletion, generated passwords, wrong-project guard), Blaze + Cloud Billing budget alert, "Trigger Email" extension (SendGrid/Mailgun), `firebase deploy`, post-deploy validation | The application runs in production; a fictitious tenant completes the full flow end to end — receives the credentials email, logs in, sees the report, downloads an attachment and the PDF |
| M6 | Automations & history | `dailyScheduler` (reminders), cost history per service | The reminders go out correctly; the history is visible |
| M7 | Polish & launch *(PARTIAL — see the note below the table)* | Reactive-auth test coverage, the Playwright E2E scaffold, targeted quality fixes, final Security Rules, deploy (Blaze already active since stage A) | The application runs in production with reviewed Security Rules; reactive-auth coverage, the E2E scaffold, and the targeted quality fixes are delivered and verified. |

| M8 | Admin experience overhaul | Full visual redesign of every surface incl. **dark mode** (NFR-UX-04) with exports pinned light (NFR-UX-05); `monthlyReports.status` pinned in the rules (NFR-SEC-11); new admin shell (six-item sidebar, page header, shared table, **ErrorBoundary**); Tenants→Renters in the English locale; cross-property **payments ledger** (FR-PAY-07…09); **pre-due payment reminder** (FR-PAY-10, Appendix A8, `paymentReminderDaysBefore` + its backfill, 4th and 5th `dailyScheduler` jobs); **notification log** (`notifications`, `onMailWrite`, FR-NLOG-*); rebuilt **dashboard** (FR-DASH-01, 04…14) with the Recharts history chart; **deposit settlement at termination** (FR-CON-10/11/12) and the removal of the arrears block on termination (FR-CON-04); **upward rounding with the surplus carried as tenant credit** (FR-REP-04a/04d/04f, the new `roundingSurplus` field, and its consequent term in the balance and Billed formulas) | Both themes render correctly across admin, tenant portal and `/r/:shareToken`; a PDF **and** a PNG exported while in dark mode are **opened and confirmed light**; the ledger and the log each show correct data with their stated bounds; a pre-due reminder fires for a real signed unpaid report and does not fire for an ended tenancy; the notification log shows one row per email with its delivery state; all four bands green; five-zone audit passed; **deployed to production and validated in a browser** — a pre-migration invoice still opens for the tenant, the first heartbeat arrives, and the notification log shows a real send reaching `SUCCESS` |

**M8 note — the second wave (financial correctness).** After the milestone was first specified, a full sweep of the money path found defects that changed its scope. Folded in: the balance chain can be broken by out-of-order signing (FR-REP-11/11a) and by the report key, which becomes **tenancy + month + year** so that a mid-month handover can bill both tenants (FR-REP-14 — **a real data migration**, `CLAUDE.md` §10 in full); Overdue becomes the aged portion rather than a test on the newest report's due date (FR-DASH-06); the termination block is removed so a departed non-payer no longer freezes the flat, while the debt itself survives, stays visible and keeps being chased (FR-CON-04, FR-PAY-12); the final total gains a divergence guard with a written reason (FR-REP-04e); former tenants' balances stop vanishing from every screen (FR-DASH-13/14); the arrears reminder gets the preconditions it never had (FR-PAY-04); three missing emails are added (A9, A10, A11); and the product gains its first two mechanisms whose only job is to notice that something has gone wrong — a weekly balance reconciliation and a daily heartbeat (FR-SYS-05/06/07).

**M8 note — the six critical E2E flows stay deferred, by decision.** *(Owner decision, 2026-08-31.)* §9 names six critical flows for the Playwright band. M8 raised it from one test to four — `login`, `darkModeExport` and `paymentsLedger` ×2 — and the remaining flows were considered at the point where the milestone was otherwise complete and **declined**, not overlooked. **Correction, same day, from the stage 18 audit:** `login.spec.js` asserted only that the login page renders — no login, no role redirect — so flow 1 was **not** partially covered, it was uncovered, by a test whose name claimed otherwise. Stage 18b makes that one flow real (login + role redirect, admin and tenant), leaving the other five deferred. The band therefore closes M8 at **one of six flows covered**, and that is the number to state. The consequence is named rather than left implicit: **the stage-20 migration's risk is carried by the fast, rules and functions bands and by manual browser checks, not by an automated flow through the tenant portal after re-keying.** Two things follow. The milestone audit's zone C must report the E2E band **by its flow count**, never as "green" — a band reported only as passing hides exactly this. **The number is one of six**, per the correction above; it was written here as "four of six" before the stage 18 audit found that `login.spec.js` covered nothing, and that wording was wrong for the two days it stood. And the deploy gains a compensating manual check: **after the migration runs on production, log in as a real tenant and open a pre-migration invoice**, which is the single thing an automated portal flow would have proven.

**M8 note — risks accepted rather than solved.** Recorded so they are decisions and not oversights: there is **no automated backup** (a manual export, plus the mandatory one immediately before the FR-REP-14 re-keying, which is the milestone's genuine migration — the `paymentReminderDaysBefore` backfill is the additive, low-risk one); the administrator account keeps its 6-character minimum, no 2FA and no session expiry; `mail` is never purged, so every generated password persists in clear text; and no second Google account owns the project, so losing the primary account loses the project, the data and the billing with it. FR-SYS-05 and FR-SYS-06 are the compensating controls — detection rather than prevention.

**M8 note — what M8 is NOT.** Two features were designed for this milestone and cut before implementation, and the SRS reflects the cut rather than the design: **owner expenses** (deferred, module ID `OPEX` reserved — §2.7, §3.5) and an **activity/event log** (cut entirely; §2.7's audit-trail exclusion and `NFR-SEC-06` both stand unchanged, and there is no `events` collection). Anyone reading an M8 planning document that mentions `FR-OPEX-*`, `FR-ACT-*`, an `events` collection or a "Net income" figure is reading a superseded draft.

**M8 note — the seed and the fixtures are part of the re-keying, not an afterthought.** `functions/scripts/seed.js` builds report IDs by property, replicating the production convention deliberately; `e2e/global-setup.js` runs the seed as part of the E2E band's own definition. So the re-keying breaks the seed, and the broken seed breaks a whole test band. The same migration must update the seed, the ~14 test files that construct report IDs or route by property, and — while that file is open — the pre-existing gap that the seed writes no `reportReminderDaysBefore`, leaving M6's report-preparation reminder untestable against seeded data. The seed should also gain what M8 introduces: `paymentReminderDaysBefore`, a `roundingSurplus`, a terminated tenancy carrying a `depositSettlement` and a `closingBalance`, and **a month in which a property changed hands** — the case the re-keying exists for. `notifications` stays unseeded (FR-NLOG-08).

**M8 note — the report re-keying is the milestone's dangerous operation, and it is TWO migrations, not one.** `FR-REP-14` changes every `monthlyReports` document ID from `propertyId_YYYY-MM` to `tenancyId_YYYY-MM`. Firestore cannot rename a document, so this is create-new-then-delete-old. **And it drags Storage with it**: attachments live at `/reports/{reportId}/invoices/*`, and `storage.rules` resolves access by doing `firestore.get(monthlyReports/$(reportId))` on the id **taken from the Storage path**. Leave the objects where they are and every historical invoice becomes unreadable to the tenant the moment the old document disappears — silently, as a permission denial, and invisibly to every test band, because an emulator seeded after the migration is internally consistent.

**The ordered procedure. Each step is reversible until the last two.**

1. **Verified export first** (`CLAUDE.md` §10). Not negotiable: there is no automated backup.
2. **Run with the application closed.** Between step 4 and step 6 both the old and the new documents exist, and a tenant loading their history would see every report twice. This is a maintenance operation, not a live one — at this volume it is minutes.
3. **Copy** every `/reports/{oldId}/invoices/*` object to `/reports/{newId}/invoices/*`. Copy, never move: the `CLAUDE.md` §7 copy-first/delete-after rule exists precisely because a failure mid-flight must leave the originals intact.
4. **Create** each new document under its `tenancyId_YYYY-MM` id, with every `attachments[].path` rewritten to the new prefix. The old documents are still there and still authoritative.
5. **Verify** — same document count; every new document's `path` values resolve to an object that exists; every report reachable from its tenancy. Stop here if anything disagrees; nothing has been destroyed yet.
6. **Delete** the old documents, then the old Storage prefixes. Only now is the operation irreversible.

**Idempotent by construction:** re-running skips any document whose new id already exists. A report whose `tenancyId` is missing or dangling is **not migrated and is reported** — never guessed at from `propertyId`, since the whole point of the change is that a property can have had more than one tenancy.

**M8 note — the backfill is a data migration.** `paymentReminderDaysBefore` is written onto every existing `tenancies` document by a one-off script. It is additive — it creates one numeric field and rewrites nothing — but it is still the first time production data is touched by a migration, so **a verified, restorable export of production Firestore is taken first, as its own gate**, before the script runs. Re-running the script is idempotent.

**M8 note — Recharts moves out of Phase 2.** §7.1's stack table and the code-splitting note below both said "Phase 2"; FR-DASH-09 needs it in M8. It is the only new runtime dependency M8 adds. The bundle was ~1.96 MB before M8 and code splitting remains deferred (see the M7 note), so M8 grows a bundle whose optimisation is parked — recorded deliberately rather than discovered.

**M8 note — the E2E band gains two flows.** Before M8 the Playwright band contained a single login smoke test, so "the E2E band is green" was not a statement about coverage. M8 adds two: (1) **dark-mode export** — switch to dark, export a PDF and a PNG, assert the output is light; this is the milestone's headline risk and the fast band structurally cannot catch it, because it mocks the rasterizer at module level. (2) **payments ledger** — load it, filter it, follow a row through to the report form. The other six flows deferred at M7 stay deferred.

**M7 note — targeted quality fixes:** `dueDayCountdown` DST-safe day-count
arithmetic (parity with `functions/`'s `Date.UTC` pattern, CLAUDE.md §7),
the "Retry" button on error states (SRS §5.5), a date-formatting helper
(everything the tenant sees is ISO except the persistent banner), and
naming residue cleanup (`collectAttachmentUrls`, `newUrls`,
`deleteAttachmentBestEffort` — named "url", carry paths).

**M7 note — scope becomes partial:** M7 ships only its cheap, structural
sub-stages now, so Phase 2 work can start sooner; the rest is deferred to a
post-launch polish pass, revisited once real usage on production data
shows which of these items actually matter — not folded into Phase 2's own
feature scope (§2.7), which is unrelated in kind. Deferred: the six
Playwright E2E flows (the band itself is installed and wired; the flows
are not written), a complete empty/error-state inventory across all pages,
exhaustive i18n coverage, and bundle optimization (code splitting).

**M7 note — bundle optimization (code splitting):** lazy loading achieved with the native React mechanism (`React.lazy` + `Suspense`), applied at two granularities:
1. **At route level** — each major area (the admin portal, the tenant portal, the public `/r/` route) becomes a separate chunk of JavaScript, loaded on demand. Priority: the public route `/r/:shareToken` must load **without the admin area's code** — a minimal bundle for the anonymous visitor opening a shared report.
2. **At the level of an individual heavy component** — expensive but rarely used components (the PDF generator, the image/document viewer, **the Recharts dashboard chart — M8, no longer "Phase 2"**) are loaded lazily even inside an already-loaded page, where bundle measurement shows it is worth it.

The principle: optimization is applied **after measurement, not prematurely** — which is why it is placed at M7, not earlier.

**Note — the alpha deploy (stage A):** placed deliberately between M5 and M6,
deviating from §7.5's original "Blaze only at M7". The full reasoning is in §7.5,
"Deviation — alpha deploy after M5". Stage A is not a milestone in the M0–M8
sense: it adds no product scope and no new FR — it moves an existing M7 activity
earlier and gates it on one piece of technical debt. Real tenant data is admitted
only after the Storage-path migration is complete; until then the alpha runs on
fictitious data.

**Note — the testing strategy (continuous, from M1):** automated testing is not a final phase, but a continuous practice. The testing foundation (**Vitest + React Testing Library + jsdom + config**) is installed at **M1**, and from there on **every new feature comes with its own tests**, written together with the code — not retroactively. M7 only adds **end-to-end coverage on the critical flows**, as a final regression check before launch, not as the first moment of testing. The principle: **new code = tested code**. (M0 remains without tests — the testing foundation lands at M1, together with the first product code.)

**M7 note — Playwright end-to-end flows:** the six critical flows covered are:
1. Login + role redirect (admin vs tenant).
2. Full KYC onboarding → account created → credentials returned.
3. Monthly report: draft → sign → visible in the tenant portal.
4. Tenant portal: dashboard → history → report detail → PDF downloaded.
5. Shared link `/r/:shareToken` opened anonymously, then revoked and re-checked.
6. `endTenancy`: property returns to free, account becomes inactive-readonly.

Flows 4 and 5 exist specifically to close a gap the M4 audit found: it
declared FR-REP-07b delivered while the export had never produced a valid
file in a real browser, because `html2canvas` was mocked at module level in
the unit tests (CLAUDE.md §9 zone A). Playwright runs against the real
export/share pipeline, not a mocked one.

Each milestone: generation → local testing (emulators) → validation by the administrator → the next milestone.

---

## Appendix A — Email templates (RO / EN)

All emails to the tenant (A1, A2, A3, A4, A7, A8, A9, A10) are sent in their preferred language. Emails to the admin (**A5, A6, A11, A12, A13**) — Romanian only, per NFR-LOC-04. Placeholders: {name}, {email}, {password}, {monthYear}, {total}, {dueDate}, {arrearsAmount}, {property}, {endDate}, {url}.

**Template ↔ `type` ↔ audience map** (FR-NLOG-03/04 — the `type` value each builder writes onto its `mail` document):

| Template | `type` | `audience` | Sent by |
|---|---|---|---|
| A1 | `credentials` | tenant | `finalizeKyc` (new-tenant branch) |
| A2 | `report-new` | tenant | `sendReportNotification` |
| A3 | `report-updated` | tenant | `sendReportNotification` |
| A4 | `arrears-reminder` | tenant | `dailyScheduler` |
| A5 | `contract-expiry` | admin | `dailyScheduler` |
| A6 | `report-preparation` | admin | `dailyScheduler` |
| A7 | `tenancy-assigned` | tenant | `finalizeKyc` (existing-user branch) |
| A8 | `payment-upcoming` | tenant | `dailyScheduler` |
| A9 | `credentials-resent` | tenant | `resetTenantPassword` |
| A10 | `payment-recorded` | tenant | the payment action, on request |
| A11 | `contract-expired` | admin | `dailyScheduler` |
| A12 | `daily-heartbeat` | admin | `dailyScheduler` (FR-SYS-06) |
| A13 | `balance-mismatch` | admin | `reconcileBalances` (FR-SYS-05) |

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

### A5 — Contract expiry reminder (to `ADMIN_EMAIL`; 90/60/30 days; RO only — NFR-LOC-04)
**Subject:** Contract în expirare: {property} — {endDate}
> Contractul chiriașului {name} pentru proprietatea {property} expiră la {endDate}.
> Acțiuni posibile: prelungește contractul (editează data de sfârșit) sau planifică încheierea și offboarding-ul.
> Deschide tenanța: {url}

### A6 — Report preparation reminder (to `ADMIN_EMAIL`; RO only — NFR-LOC-04)
**Subject:** Pregătește lista de plată — {property}
> Contul pentru {property} are scadența pe {dueDate}. Raportul lunii încă nu e semnat — pregătește costurile și emite lista.

### A7 — New tenancy assigned (to an existing tenant)
**RO — Subject:** Ai o nouă locuință în platformă — {property}
> Bună, {name},
> Rapoartele lunare pentru această locuință vor apărea în contul tău obișnuit.
> Accesează platforma la: {url}

**EN — Subject:** You have a new tenancy — {property}
> Hi {name},
> Monthly reports for this property will appear in your usual account.
> Access the platform at: {url}

### A8 — Pre-due payment reminder (to the tenant; daily through the run-up, inclusive of the due date — FR-PAY-10)
**RO — Subject:** Reamintire: plata pentru {monthYear} — scadentă la {dueDate}
> Bună, {name},
> Îți reamintim că plata pentru {property}, aferentă lunii {monthYear}, este scadentă la {dueDate}.
> Total de plată: {total} lei
> Detalii: {url}

**EN — Subject:** Reminder: your {monthYear} payment is due on {dueDate}
> Hi {name},
> This is a reminder that your payment for {property}, for {monthYear}, is due on {dueDate}.
> Total due: {total} RON
> Details: {url}

### A12 — Daily heartbeat (to `ADMIN_EMAIL`; every completed run; RO only — FR-SYS-06)
**Subiect:** Automatizări OK — {monthYear}
> Rulare încheiată: {name} contracte evaluate, {total} emailuri trimise, {arrearsAmount} erori.

*Deliberately dull, and deliberately daily.* Its content is almost never interesting; its **absence** is. A scheduler that has died sends nothing, and a month in which nobody is reminded looks exactly like a month in which everybody paid. This is the only signal that distinguishes them. The placeholders are reused from the shared set rather than introducing three new ones for a single template.

### A13 — Balance mismatch (to `ADMIN_EMAIL`; only when one is found; RO only — FR-SYS-05)
**Subiect:** Verificare solduri: {name} — diferență {arrearsAmount} lei
> Soldul stocat pentru {name} ({property}) este {total} lei, dar recalcularea din rapoartele semnate dă {arrearsAmount} lei.
> Nu s-a modificat nimic automat. Deschide contractul: {url}

*Sent only on a mismatch* — this one is the opposite of A12: silence is the good news. Read-only by design (FR-SYS-05): the job reports the divergence and never repairs it, because an automatic correction would overwrite a real balance on the strength of a calculation nobody had reviewed.

**Note — the copy deliberately states the due date rather than a countdown.** The same body is sent on every day of the window, including the due date itself (FR-PAY-10b), so wording like "in 3 days" would be wrong on the last send and would require a placeholder that does not exist in the shared set. Stating `{dueDate}` is correct on every day of the run-up.

### A9 — Credentials resent (to the tenant; on the administrator's action — FR-AUTH-04)
**RO — Subiect:** Datele tale de autentificare
> Bună, {name},
> Îți trimitem din nou datele de acces pentru platforma de administrare a chiriei, pentru {property}.
> Date de autentificare: Email: {email} / Parolă: {password}
> Accesează platforma la: {url}

**EN — Subject:** Your login details
> Hi {name},
> Here are your login details for the rental management platform, for {property}.
> Login details: Email: {email} / Password: {password}
> Access the platform at: {url}

**Why this template exists.** Without it the product has no recovery path from a failed A1: `resetTenantPassword` returns the new password to the administrator only, and FR-NLOG-06 forbids re-sending from the notification log. The administrator would see `credentials — ERROR` in the log and have no way to act on it except to read the password aloud over the telephone. Sent only when the administrator explicitly resets the password; never automatically.

### A10 — Payment recorded (to the tenant; optional, on the administrator's action — FR-PAY-01)
**RO — Subiect:** Am înregistrat plata ta pentru {monthYear}
> Bună, {name},
> Am înregistrat plata pentru {property}, aferentă lunii {monthYear}.
> Sumă înregistrată: {total} lei / Data: {dueDate}
> Detalii și situația la zi: {url}

**EN — Subject:** Your {monthYear} payment has been recorded
> Hi {name},
> We have recorded your payment for {property}, for {monthYear}.
> Amount recorded: {total} RON / Date: {dueDate}
> Details and current balance: {url}

**Not automatic.** A confirmation is sent only when the administrator chooses to send it, from the payment section — the same discipline as A2/A3 (FR-REP-06): the product never emails the tenant behind the administrator's back. It exists because a tenant handing over cash currently receives nothing in writing, which is precisely the misunderstanding §2.1 says the product exists to prevent. `{total}` carries the amount recorded, and the body links to the report where the remaining balance is visible.

### A11 — Contract expired (to `ADMIN_EMAIL`; weekly after the end date; RO only — NFR-LOC-04)
**Subiect:** Contract expirat, încă activ: {property} — {endDate}
> Contractul chiriașului {name} pentru proprietatea {property} a expirat la {endDate} și este încă marcat ca activ.
> Cât timp rămâne activ: se cer rapoarte lunare, pleacă remindere de plată către chiriaș, iar proprietatea rămâne ocupată — nu poți finaliza onboardingul altui chiriaș pe ea.
> Încheie contractul sau prelungește-i data de sfârșit: {url}

**Why weekly, and why it does not act.** A5 fires at 90, 60 and 30 days before expiry and then stops; if all three are missed, FR-CON-08 keeps the tenancy active indefinitely and every consequence above follows silently from one forgotten manual action. A11 is the backstop. It repeats weekly while the state persists, and it deliberately does **not** terminate anything — FR-CON-08's manual-only rule stands.

**Note — A8 versus A4.** A8 stops at `dueDate`; A4 starts at `dueDate + 3`. They therefore never fire on the same day for the same report, and the two-day silence at `+1`/`+2` is intended. A8 is the only template whose `mail` document has a deterministic ID (FR-PAY-10e).
