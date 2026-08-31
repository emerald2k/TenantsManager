# M8 — Admin experience overhaul (v4.3 improvements)

**Shaping document — spec only. No code is written against this until the SRS
commit (sub-stage 1) lands and the administrator approves it.**

Per `CLAUDE.md` §1, `SRS.md` is the source of truth and this file is not. This
document exists to be _turned into_ an SRS commit; until that commit exists,
everything below is a discussion record, exactly like the "OPEN DESIGN
DECISIONS" block in `CURRENT_SPRINT.md`.

- Date: 2026-08-19 · **revision 2** (adds the §2.7 section definitions)
- Baseline: tag `srs-v4.3-single-owner`
- Decisions by: the administrator, in shaping (§2)

---

## 1. Baseline and branch

### 1.1 The tag resolves to `main`

`srs-v4.3-single-owner` is an **annotated** tag. Verified against the remote:

```
b7692a4de1dcbe23ee8438f43dd854d4ac98e586  refs/tags/srs-v4.3-single-owner
d2fe582b162ef594b20076157ecdab0d46c4ea7d  refs/tags/srs-v4.3-single-owner^{}
d2fe582b162ef594b20076157ecdab0d46c4ea7d  refs/heads/main
```

`b7692a4` is the tag _object_; it peels to `d2fe582`, which is today's `main`
tip — the M7 merge. **"From main" and "from tag v4.3" are the same commit**, so
branching from the tag loses nothing. Worth verifying rather than assuming: had
the tag pointed at an older commit, the branch would have silently dropped the
entire M7 merge.

### 1.2 Milestone renumbering

`milestone/m8-multi-tenant` exists at `0143f2e` with one commit
(`docs: open M8 with migration gates, decision record and stage plan`). That work
is **frozen** (§2.1). Two milestones cannot both be M8.

**This becomes M8; multi-tenant becomes M9.** The frozen branch is renamed, not
deleted — `0143f2e` is not reachable from `main` and holds real reasoning.

```bash
git branch -m milestone/m8-multi-tenant milestone/m9-multi-tenant
git checkout -b milestone/m8-admin-overhaul srs-v4.3-single-owner
git rev-parse HEAD main srs-v4.3-single-owner^{}   # all three: d2fe582…
```

The renamed branch's commit body still says "M8". Left alone — a commit message
is history, not documentation. `SRS.md` §9 is where numbering is authoritative.

**Consequence to accept deliberately:** `CLAUDE.md` §10 is titled _"Data
migration gates (M8 onwards)"_ and is written against the multi-tenant
milestone by number. It must be retitled to name the _kind_ of milestone, not
the number — "any milestone that transforms production data". M8 as redefined
here adds collections and fields and never rewrites an existing document, so §10
does not bind it. **That is a claim the audit must verify, not assume** (§8,
zone E) — and it stops being true the moment anyone proposes a backfill.

---

## 2. Decisions taken

Each is an administrator decision in shaping, not an inference. Reversals of
written SRS text are marked, per `CLAUDE.md` §7 ("reversing a written spec
decision needs the reason on record").

### 2.1 M8 multi-tenant is frozen

The single-admin product is what gets improved now. Multi-tenant is parked, not
abandoned. **Not a spec reversal** — the multi-tenant design answers were never
in `SRS.md`; they live only in `CURRENT_SPRINT.md`'s "OPEN DESIGN DECISIONS"
block, which is explicitly not a source of truth.

**Consequence:** those four answers stay open. Nothing in M8 may be designed
around them or quietly pre-empt them. The one place this bites is `ownerId` on
the new collections — §5.1.

### 2.2 Four sections are added; nothing is removed

```
Dashboard · Properties · Renters · Current month · Payments · Expenses · Notifications
```

The mockup shows six and drops "Current month". **Decision: keep it.** The
monthly report form is the app's core work surface and "Current month" is its
only month-centric entry point. Removing it to match a mockup would cost a
workflow for a cosmetic gain.

### 2.3 Expenses means _both_ things, clearly separated

The mockup's Expenses rows are _Insurance, Taxes, Maintenance, Management fee_ —
**the owner's own operating costs**. The existing `monthlyReports` cost lines are
the opposite: amounts **recharged to the tenant**. Near-homonyms that must never
be conflated in code, in the UI, or in a total.

- **A — Owner expenses** (new collection). Costs the owner bears. Never billed,
  never tenant-visible. This is what makes `Net income` computable.
- **B — Billed cost lines** (view only). Cross-property, cross-month flattening
  of `monthlyReports`. No new storage.

**View B partially delivers Phase-2 `FR-REP-09`.** Worth noticing rather than
re-inventing — §2.7 already promised it. _(Open point §9.4: the administrator's
section-by-section description covered only view A, so B may be droppable.)_

### 2.4 Redesign covers every surface; dark mode does not

Full redesign incl. dark mode, across admin, tenant portal, and the public
`/r/:shareToken` page.

**Dark mode affects the web app UI only. Generated artefacts — PDF, PNG, anything
rasterized — are always light.** (Administrator, 2026-08-19.)

The highest-risk item in the milestone; §6 is devoted to it.

**Reversal on record — in two places, not one.** `SRS.md` excludes dark mode
**twice**: §2.7 lists it under "Explicitly out of scope (any phase)", and
`NFR-UX-02` states flatly _"light mode only"_. Both are reversed and **both must
be rewritten**; editing one and missing the other is the §9-zone-D failure this
repo has already had once (M1: deferred in §5.3, unmarked in §9).

Reason for the record: the exclusion was made when the product was a
single-admin MVP racing to launch, and `index.css` already ships a complete
`.dark` token block (§6.1) — the cost that justified it has largely been paid
since.

A third reversal rides along: **`NFR-UX-01`, "simple interface, without custom
branding"** — see §4.6 and open point §9.3.

### 2.5 Rename Tenants → Renters

Visible labels only. Honestly scoped:

- **English locale** — real change: "Tenants" → "Renters".
- **Romanian locale** — mostly unchanged: _chiriaș_ is natural either way. The RO
  strings are the ones actually read daily.
- **Code identifiers, collection names, FR IDs, Security Rules** — **unchanged.**
  `users`, `tenancies`, `FR-TEN-*`, `TenantsListPage` all stay. Renaming them
  would be a large, risky, zero-user-value diff.

**The SRS must state this explicitly**, or a future reader sees `users` in the
model and "Renters" in the UI and reasonably concludes the rename was abandoned
half-done.

### 2.6 No rebrand

"Portico" is a prototyping artefact. No product name adopted. See §9.3 — the new
sidebar has a wordmark slot that will otherwise sit empty.

### 2.7 Section definitions — settled 2026-08-19

Taken one by one with the administrator. Three of the four ran into the existing
model; what follows is what was decided, with the reasoning that drove it.

**(a) Dashboard — income counts SIGNED reports only.**
The initial description said _"signed and sent"_. **"Sent" is not knowable by
design**: §7.2 says of `sendReportNotification` — _"no tracking field on
`monthlyReports` for 'already notified' — the choice is made fresh on each send,
never inferred"_ — and `FR-REP-06` makes emailing explicitly optional. Income
defined on "sent" would **fall when the administrator hands a report over on
WhatsApp instead of emailing it**: it would measure emailing habits, not revenue.
Signing is the act that makes an amount owed real (`FR-REP-07`). Decided:
**income = signed**.

**(b) Dashboard — collected sums `amountPaid`, not fully-paid reports.**
Otherwise a report paid 90% contributes zero and the figure understates cash
badly. `FR-PAY-02` makes partial payment a first-class state; the dashboard must
reflect it.

**(c) Dashboard — income and collected are on different bases, and say so.**
Income is **accrual**, attributed to the report's month. Collected is **cash**,
attributed to `paymentDate`'s month. Both shown, both labelled. This settles the
former open point "cash or accrual" — the answer is _both, never blended into
one number_.

**(d) Payments — the model does not change.**
`monthlyReports` stores payment as **flat fields** — `amountPaid`,
`paymentMethod`, `paymentDate`, one set per report, not an array. A tenant
paying twice yields **one row with the cumulative total**, not two. Decided:
**accept it**; the ledger is one row per report. A true transaction ledger would
mean a `payments` subcollection, changes to `onReportWrite`'s balance logic, and
a backfill of existing reports — a data migration, which would drag `CLAUDE.md`
§10's gates into this milestone. Not worth it now. **The SRS must record this
limitation in the FR itself**, so "Payments" is never mistaken for a transaction
log later.

**(e) Recent Activity — a full event log.** See §4.7 and §5.3. **This reverses
`SRS.md` §2.7, which excludes "audit trail" outright.**

Reason on record: the alternative — deriving the feed from five collections at
read time — cannot represent events that carry no timestamp today. A property
archive is a bare `archived: boolean`; an unlock leaves nothing behind at all.
The derived version would silently omit exactly the events worth seeing. The
exclusion in §2.7 was aimed at a compliance-grade immutable trail for a
multi-admin product; this is a single-admin activity feed. **But structurally it
is an audit trail, and the SRS should say so plainly rather than reclassify it
to dodge its own exclusion.**

**(f) Notifications — add the missing pre-due reminder, and surface admin-facing
emails too.** The described types included _"upcoming rent"_ and _"rent
deadline"_. Neither exists: `FR-PAY-04` fires **three days _after_** the due
date, and the only pre-due reminder in the system (`FR-REP-15`, A6) goes to the
**administrator**, about preparing the report. The mockup's _"Rent Due in 3
Days"_ row describes an email the product never sends. Decided: **add it**
(`FR-PAY-10`, Appendix A8, a fourth `dailyScheduler` job) and display
admin-facing notifications in the log alongside tenant-facing ones.

---

## 3. Explicitly NOT in scope

Naming these stops them arriving later as "obviously implied":

- **Maintenance management.** The mockup's _"Maintenance Update / Maintenance
  Scheduled"_ rows have no feature behind them and none is being added. An owner
  expense categorised `maintenance` is a bookkeeping row, not a work-order
  system.
- **Multi-currency.** The mockup shows `$`; the product is RON-only (§2.6).
- **In-app / push notifications.** Still excluded per §2.7. The Notifications
  section is a **log of emails**, a record rather than a channel — so it is _not_
  a §2.7 reversal, and the SRS should say so, because the section's name makes it
  look like one.
- **Online payments, invoicing, CSV/Excel export** — still excluded per §2.7.
  The Payments section records the same manual payments `FR-PAY-01` already
  describes; it does not move money.
- **A transaction-level payment ledger** — §2.7(d).
- **Multi-owner anything** — M9.

> **Correction against revision 1:** "audit trail" appeared in this list. It no
> longer belongs — decision §2.7(e) brings it _into_ scope. Left visible rather
> than silently deleted, because the whole point of §2.7(e) is that it is a
> reversal.

---

## 4. SRS delta — functional requirements

New module IDs avoid collision with `§3.5 Expenses & Monthly Reports (REP)`.
**`OPEX`, not `EXP`** — a reader scanning for "the expenses module" must not land
on the wrong one.

### 4.1 New — §3.11 Owner Expenses module (OPEX)

| ID         | Requirement                                                                                                                                                                                                                                                                                                                   |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FR-OPEX-01 | The administrator records costs **they themselves bear**: date incurred, amount (RON), category, description, optional property, optional attachments.                                                                                                                                                                        |
| FR-OPEX-02 | An owner expense is **never** billed to a tenant, **never** appears in a `monthlyReport`, and is **never** readable by a tenant. Admin-only at the Security Rules level.                                                                                                                                                      |
| FR-OPEX-03 | Categories: `insurance`, `taxes`, `maintenance`, `management`, `utilities`, `other`. Hardcoded constant like `serviceCatalog` (§6). _(Open point §9.1.)_                                                                                                                                                                      |
| FR-OPEX-04 | An expense may attach to a property (`propertyId`) or be portfolio-level (`propertyId: null`, e.g. an accountant's fee). Both first-class; neither a fallback.                                                                                                                                                                |
| FR-OPEX-05 | **Date incurred** is distinct from the creation timestamp. Retroactive entry for any past month allowed, mirroring `FR-REP-11`.                                                                                                                                                                                               |
| FR-OPEX-06 | Amount may be **negative** (refund, correction), mirroring `FR-REP-03`. Lists and totals must render negatives legibly, not as an error.                                                                                                                                                                                      |
| FR-OPEX-07 | Full CRUD including **hard delete**. Unlike a signed report, an owner expense has no counterparty and no signing act — soft-delete would be cargo-culted from `properties.archived` without the reason that motivated it (preserving tenant-visible history). Deletion emits an event (§4.7), which is where the trace lives. |
| FR-OPEX-08 | Attachments use the existing `{ path, name, type }` shape and the **no-persisted-download-URL** rule of §6, without exception.                                                                                                                                                                                                |
| FR-OPEX-09 | List ordered **most recent first** by date incurred; filter by period, category, property. Presence-only validation per `NFR-VAL-01`, beyond amount being a number.                                                                                                                                                           |

### 4.2 New — §3.12 Notification Log module (NLOG)

| ID         | Requirement                                                                                                                                                                                                                                                                        |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FR-NLOG-01 | The administrator sees every email the system has sent: type, audience, subject, recipient, sent-at, delivery state — **most recent first**, as a timeline.                                                                                                                        |
| FR-NLOG-02 | **Metadata only. Email bodies are never exposed to the client.** A security requirement, not a UI simplification — see §5.4.                                                                                                                                                       |
| FR-NLOG-03 | `type` is one of the Appendix A templates (`credentials`, `report-new`, `report-updated`, `arrears-reminder`, `payment-upcoming`, `contract-expiry`, `report-preparation`, `tenancy-assigned`) — written at send time by the sending function, never inferred from a subject line. |
| FR-NLOG-04 | `audience` distinguishes `tenant` from `admin`. Admin-facing notifications (`contract-expiry`, `report-preparation`) appear in the log alongside tenant-facing ones — today they exist only in the administrator's inbox (§2.7(f)).                                                |
| FR-NLOG-05 | Delivery state is projected from the Trigger Email extension's `delivery.state` (`PENDING`/`SUCCESS`/`ERROR`), so a failed send is visible rather than silent.                                                                                                                     |
| FR-NLOG-06 | Read-only. No re-send in M8 — re-sending a report notification already exists as an explicit action on the report (`sendReportNotification`), and a second path to it is a second place to get the new/updated choice wrong.                                                       |

**FR-NLOG-05 closes a real open item.** `CURRENT_SPRINT.md` carries an unverified
follow-up: confirm `mail` delivery works under the rotated Gmail app password by
checking a fresh document reaches `delivery.state: SUCCESS`. Today that needs the
Firebase Console. After M8 it is a page in the app.

### 4.3 New — §3.13 Activity Log module (ACT)

| ID        | Requirement                                                                                                                                                                                                    |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FR-ACT-01 | The system records an **event** for every material action on the administrator's portfolio: type, timestamp, actor, the property/tenancy/renter it concerns, and a small denormalized payload for rendering.   |
| FR-ACT-02 | Events are written **server-side only** — by Cloud Functions callables and Firestore triggers, never by the client. A log the client can write is only as honest as the client.                                |
| FR-ACT-03 | Events are **immutable and append-only**: no client write, no update, no delete, enforced in Security Rules.                                                                                                   |
| FR-ACT-04 | The dashboard renders a **reverse-chronological timeline** over a bounded recent window, each row carrying its own timestamp.                                                                                  |
| FR-ACT-05 | An event carries enough denormalized context to render without further reads. Rendering 50 rows must not cost 150 document reads.                                                                              |
| FR-ACT-06 | Event emission is **best-effort and never blocks the action it describes.** A failure to log must not fail a signature, a payment or an onboarding. The log is observability, not a transactional participant. |

`FR-ACT-06` is the load-bearing one. The opposite choice — logging inside the
transaction — would mean a bug in the activity feed can refuse a signature.

### 4.4 Amended — §3.8 Administrator Dashboard (DASH)

`FR-DASH-01`…`-03` stand. Added:

| ID         | Requirement                                                                                                                                                                                                                          |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| FR-DASH-04 | KPI row: **Income (current month)**, **Rent collected**, **Properties** (total + occupied/vacant), **Overdue** (red when > 0).                                                                                                       |
| FR-DASH-05 | **Income** = sum of `finalTotal` over reports with `status == 'signed'` whose month/year is the selected period. Accrual basis. Independent of whether any email was sent (§2.7(a)).                                                 |
| FR-DASH-06 | **Rent collected** = sum of `amountPaid` over reports whose `paymentDate` falls in the period. Cash basis. Includes partial payments (§2.7(b)).                                                                                      |
| FR-DASH-07 | Income and Rent collected are **displayed as two distinct figures on different bases**, never blended into one "revenue" number (§2.7(c)).                                                                                           |
| FR-DASH-08 | **Overdue** = unpaid portion (`finalTotal − amountPaid`) of signed reports whose `dueDate` is in the past. Distinct from `FR-DASH-01`'s aggregated arrears: a report signed today and due in ten days is unpaid but **not** overdue. |
| FR-DASH-09 | **History timeline**: income per past month over a rolling window, with owner expenses as a second series. Recharts, already named in the stack (`CLAUDE.md` §4).                                                                    |
| FR-DASH-10 | **Recent activity**: reverse-chronological event timeline with timestamps, from the `events` collection (§4.3).                                                                                                                      |
| FR-DASH-11 | `FR-DASH-03`'s first-launch empty state survives the redesign. Zero properties and zero tenants still yields the two-action empty state — not a wall of zeroed KPIs and an empty chart.                                              |

**`FR-DASH-08` is where a dashboard starts lying if you let it.** Two numbers
with similar names and different definitions is worse than one.

**`FR-DASH-11` exists because this is exactly what a redesign breaks.** The empty
state is the least-exercised path and the product's first impression.

### 4.5 Amended — §3.6 Payments & Arrears (PAY)

| ID        | Requirement                                                                                                                                                                                                                                                                                                                                                                                                                           |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FR-PAY-07 | Cross-property payment ledger, **most recent first** by `paymentDate`: property, renter, period, amount due (`finalTotal`), amount paid, payment date, status badge. Filter by period, property, status.                                                                                                                                                                                                                              |
| FR-PAY-08 | **One row per report, not per transaction.** `monthlyReports` stores a single cumulative `amountPaid` with one `paymentMethod`/`paymentDate`; a renter paying twice in a month produces one row carrying the total. Recorded here so the ledger is never mistaken for a transaction log (§2.7(d)).                                                                                                                                    |
| FR-PAY-09 | The ledger is a **view**. Recording, correcting and cancelling stay on the report form (`FR-PAY-01`, `FR-PAY-06`); a row links there. _(Open point §9.2.)_                                                                                                                                                                                                                                                                            |
| FR-PAY-10 | **Pre-due payment reminder to the tenant**, `paymentReminderDaysBefore` days _before_ the tenancy's `dueDay`, sent by `dailyScheduler` at 09:00 Europe/Bucharest in the tenant's preferred language (Appendix A8). Sent **only if** the current month's report is signed and not fully paid — a reminder to pay a bill the tenant has not received would be worse than none. Complements `FR-PAY-04` (after-due), which is unchanged. |

`FR-PAY-10` inherits `FR-PAY-04`'s month-boundary behaviour and the `Date.UTC`
day-count rule (`CLAUDE.md` §7, `functions/src/schedulerLogic.js`). For a high
`dueDay` the pre-due window can fall in the previous calendar month — the same
clamping question `FR-PAY-04` already documents, and it must be answered in the
SRS rather than discovered in production.

### 4.6 Amended — §3.5 Expenses & Monthly Reports (REP)

| ID        | Requirement                                                                                                                                                                                               |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FR-REP-16 | Cross-property, cross-month view of **billed** cost lines (rent, maintenance, services, other), filterable by period, property, category. Read-only. Partially delivers `FR-REP-09`. _(Open point §9.4.)_ |

`FR-REP-09` is **not** marked done: it promises a filterable list of _reports_;
`FR-REP-16` delivers a filterable list of _cost lines_. Related, not identical.
Saying so now stops a future audit ticking a box that was never filled — the
`CLAUDE.md` §9 zone A failure mode exactly.

### 4.7 Amended — non-functional

| ID         | Requirement                                                                                                                                   |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| NFR-UX-04  | Light and dark themes across the web application. Persisted per browser; initial value from `prefers-color-scheme`. **Replaces `NFR-UX-02`.** |
| NFR-UX-05  | **Generated artefacts are always light.** PDF, PNG and any rasterized output render in the light theme regardless of interface theme. See §6. |
| NFR-LOC-05 | Every string added by M8 exists in both `ro.json` and `en.json`. Locale parity is an audit gate (§9 zone E), not a best effort.               |
| NFR-SEC-10 | The `events` and `notifications` collections are **admin-read, server-write, append-only**. No client write path exists to either.            |

**Three existing requirements are reversed and must be rewritten in place, not
left to contradict the new ones:**

- **`NFR-UX-02`, "light mode only"** — reversed by `NFR-UX-04`. This is the
  _direct_ statement of the exclusion; §2.7's dark-mode entry is the second,
  weaker one. **Both** need editing.
- **`NFR-UX-01`, "simple interface, without custom branding"** — a navy-and-
  emerald identity is custom branding. See §9.3.
- **§2.7's "audit trail" exclusion** — reversed by §2.7(e)/§4.3.

---

## 5. SRS delta — data model, rules, functions

### 5.1 New collection — `expenses`

```
expenses/{expenseId}                  [ACCESS: admin only — never the tenant]
  - ownerId
  - date                       // the date the cost was INCURRED, not createdAt
  - amount: number             // RON; may be negative (FR-OPEX-06)
  - category: 'insurance' | 'taxes' | 'maintenance' | 'management'
            | 'utilities' | 'other'          // hardcoded constant, like serviceCatalog
  - description: string        // presence-only validation (NFR-VAL-01)
  - propertyId: string | null  // null = portfolio-level (FR-OPEX-04)
  - attachments[]              // [ { path, name, type: 'image'|'pdf'|'doc' } ]
                               // same shape as costLine.attachments[]; NEVER a URL
  - createdAt, updatedAt
```

**This collection is NEVER read by a tenant and NEVER feeds a `monthlyReport`.**
That sentence belongs verbatim in §6 beside the block. "Expenses" already means
the opposite thing a few lines away in the same document, and `CLAUDE.md` §7's
own lesson — _"when a spec says one thing and the field name suggests another,
the field name wins in practice"_ — was learned expensively on `url`/`path`.

**On `ownerId`:** written, because every sibling collection writes it and M9 will
need it. But `CLAUDE.md` §7 records it as currently _written everywhere and read
nowhere_ — an M7 audit finding. M8 must not deepen that silently. Settle at
sub-stage 8: either query on it from day one (accepting the index work in §5.5),
or write it, don't query it, and **add one SRS line saying so**. Option two is
smaller and matches reality. What is unacceptable is leaving a reader to guess.

**Storage:** `/expenses/{expenseId}/*` — admin only, added to `storage.rules`
alongside the four existing paths.

### 5.2 New collection — `events`

```
events/{eventId}      [ACCESS: admin read; Functions write only; append-only]
  - type          // 'report.signed' | 'report.unlocked' | 'payment.recorded'
                  // | 'payment.cancelled' | 'expense.created' | 'expense.updated'
                  // | 'expense.deleted' | 'tenancy.started' | 'tenancy.ended'
                  // | 'renter.onboarded' | 'renter.status-changed'
                  // | 'property.created' | 'property.updated' | 'property.archived'
  - at            // server timestamp
  - actor: 'admin' | 'system'        // + uid where applicable
  - propertyId | tenancyId | userId  // null where not applicable
  - refId         // the document the event is about
  - summary       // small denormalized payload for rendering (FR-ACT-05)
```

**How events are emitted — two mechanisms, chosen per event, not one blanket
rule:**

- **Callables emit their own events directly.** `signReport`, `unlockReport`,
  `endTenancy`, `finalizeKyc`, `setTenantAccountStatus` each _know exactly what
  they did_. An event written by the callable is precise by construction.
- **Firestore triggers cover what has no callable** — expense CRUD and payment
  recording are direct admin client writes. Those triggers must **diff
  before/after** to decide what happened (`payment.recorded` vs
  `payment.cancelled` is a diff on `amountPaid`/`paymentDate`, not a fact stated
  anywhere in the document).

Inferring everything from triggers would be simpler to build and worse: a
trigger cannot distinguish an unlock from an edit without reconstructing intent
that the callable already had in hand.

**Two hazards to write into the SRS, not discover:**

1. **A trigger must never write into the collection it watches.** `events` is
   written _from_ triggers on other collections and is watched by none.
2. **`onReportWrite` already exists** and recomputes `currentBalance`. Extending
   it to emit events keeps one trigger per collection rather than two competing
   ones — but its existing behaviour is load-bearing for balances and must not
   regress. Its tests are already known-fragile (`CURRENT_SPRINT.md`: the
   "services-only" test cannot be made to fail).

**Retention:** none in M8. At 5–20 properties the volume is trivial. The
dashboard queries a **bounded window** (`at` range), never the whole collection —
so growth cannot silently turn into an unbounded read.

### 5.3 New collection — `notifications`, and why not `mail`

The obvious cheap route is to open `mail` to admin reads. **Do not.**

`mail` holds fully rendered email bodies. Appendix A1 interpolates `{password}` —
the tenant's generated password, in clear text. `mail` is currently
`[ACCESS: Cloud Functions only — no client access]` and that is load-bearing.
Opening it makes **every password ever generated permanently readable from the
browser** by anyone holding an admin session. M7 rotated a Gmail app password
over a single screenshot leak; this would be a considerably larger hole, opened
deliberately, to render a table.

```
notifications/{notificationId}  [ACCESS: admin read; Functions write only]
  - type            // FR-NLOG-03
  - audience: 'tenant' | 'admin'      // FR-NLOG-04
  - subject         // subject line only — NEVER the body (FR-NLOG-02)
  - to
  - sentAt
  - deliveryState: 'PENDING' | 'SUCCESS' | 'ERROR'
  - deliveryError: string | null
  - relatedId: string | null          // reportId / tenancyId / userId
  - mailId                            // the mail/{mailId} it projects, for debugging
```

A new Firestore trigger, **`onMailWrite`**, projects each `mail` document into
`notifications`. A trigger rather than a same-batch write in each sending
function, for one reason worth the extra function: **`delivery.state` is written
by the extension asynchronously, after the send.** A same-batch write captures
the _intent_ to send and can never capture whether it worked — which is
`FR-NLOG-05`, which is the requirement that closes the open Gmail-rotation
question. It would look correct and quietly not do the one thing the feature
exists for.

`type` cannot be recovered from a `mail` document — nothing in it distinguishes
templates reliably. **Each sending function must write `type` and `audience` onto
the `mail` document** for the trigger to read. A small edit in `finalizeKyc`,
`sendReportNotification` and `dailyScheduler`, and a prerequisite for the
section, not a nicety. The extension ignores unknown fields.

### 5.4 Amended — `tenancies`

```
  - paymentReminderDaysBefore: number  // default 3; admin-editable at assignment
                                       // or later, same step as dueDay
```

Mirrors the existing `reportReminderDaysBefore` precedent exactly — same
placement in the UI, same editability. A second reminder cadence deserves a
second field rather than overloading the first, which is admin-facing and about
report preparation, not payment.

### 5.5 Indexes — the trap the emulator will not show you

`firestore.indexes.json` is **empty**, and `CURRENT_SPRINT.md` carries a standing
rule: _no `orderBy` in queries — sort and filter in JS_. `CLAUDE.md` §7 says why
this matters: **the Firestore emulator does not enforce composite indexes.**
Every query below runs green locally and fails in production.

| Query                                                 | Composite index?        |
| ----------------------------------------------------- | ----------------------- |
| `expenses` where `date` in range                      | No — single-field range |
| `expenses` where `ownerId ==` **and** `date` in range | **Yes**                 |
| `expenses` where `propertyId ==` and `date` in range  | **Yes**                 |
| `events` where `at` in range                          | No                      |
| `events` where `propertyId ==` and `at` in range      | **Yes**                 |
| `notifications` ordered by `sentAt`                   | No                      |

At this scale, fetching by date range and filtering the rest in JS needs no index
at all. **Recommended: keep the rule, add no indexes, write the reason into the
SRS** — so M9, where the `ownerId` filter stops being optional, inherits a
decision rather than an accident.

### 5.6 Cloud Functions

| Function                                                                            | Change                                                                                                                 |
| ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `onMailWrite`                                                                       | **New** trigger — projects `mail` → `notifications` (§5.3)                                                             |
| `dailyScheduler`                                                                    | **Fourth job** — the `FR-PAY-10` pre-due reminder                                                                      |
| `finalizeKyc`, `sendReportNotification`, `dailyScheduler`                           | Write `type` + `audience` onto each `mail` document                                                                    |
| `signReport`, `unlockReport`, `endTenancy`, `finalizeKyc`, `setTenantAccountStatus` | Emit their own events (§5.2), best-effort, outside the transaction (`FR-ACT-06`)                                       |
| `onReportWrite`                                                                     | Extended to emit `payment.recorded` / `payment.cancelled` by diffing. **Existing balance behaviour must not regress.** |
| _(new triggers)_                                                                    | On `expenses` and `properties` for the CRUD events with no callable                                                    |

Every dashboard figure remains a **client-side aggregation over a bounded
window**. At this scale that is correct, cheaper than a callable, and keeps the
functions surface to the changes above.

### 5.7 Appendix A8 — pre-due payment reminder (RO / EN)

New template, tenant-facing, therefore in the tenant's preferred language
(`NFR-LOC-04`). Placeholders from the existing set: `{name}`, `{monthYear}`,
`{total}`, `{dueDate}`, `{property}`.

---

## 6. Dark mode and rasterized exports

Confirmed (§2.4): **dark mode affects the web app UI only; generated PDFs, PNGs
and images are always light.** This section specifies enforcement, because the
current code's default behaviour is the opposite.

### 6.1 What already exists

- Tailwind v4 + shadcn. `index.css` defines `@custom-variant dark (&:is(.dark *))`
  and a **complete `.dark` token block** — every `--background`, `--card`,
  `--sidebar`, `--chart-*` already has a dark value.
- The app is **fully token-driven**: components consume `bg-background`,
  `text-foreground`, `border-border`.
- The palette is **fully achromatic** — every token is `oklch(x 0 0)`, and
  `--chart-1..5` are five greys, unusable for `FR-DASH-09`'s chart.
- `html2canvas-pro` is already in use, chosen because the original `html2canvas`
  could not parse `oklch()`. **The M4 oklch incident is closed.**

**Two consequences.** Dark mode is _unwired, not unbuilt_ — the expensive part is
done. And matching the mockups' identity is a focused edit to token values in one
file, not a component rewrite, precisely because nothing hardcodes a colour.

### 6.2 The defect this would otherwise ship

`useReportSummaryCapture` mounts its capture node **inside the live React tree**
(`absolute -left-[9999px]`, deliberately not `display:none`, which
`html2canvas-pro` cannot rasterize). With the theme class on `<html>`, that node
is a descendant of `.dark`. **Every exported PDF and PNG would come out dark** —
white text on near-black, sent to a tenant over WhatsApp.

And quietly worse: `@custom-variant dark (&:is(.dark *))` matches **any**
ancestor. Wrapping the capture node in a `.light` class does **not** undo it.

### 6.3 The rule

1. The theme class is applied to `<html>`.
2. `index.css` gains **`.force-light`**, which **re-declares every light token
   value** — not merely a class name that looks like it should.
3. The capture wrapper in `useReportSummaryCapture` carries `.force-light`.
4. **`ReportSummaryView` and its entire subtree use tokens only — zero `dark:`
   utilities.** Not style guidance: a `dark:` utility still matches through the
   ancestor `.dark` regardless of re-declared variables, so one
   `dark:bg-slate-900` defeats the whole mechanism.
5. The public `/r/:shareToken` **page chrome** may be themed; the **report card
   stays light-only**, being the same component that gets rasterized. This is how
   "redesign everything" and "exports always light" are both satisfied without
   one quietly breaking the other.

### 6.4 The gate

**The fast band cannot prove any of this** — it mocks `html2canvas-pro` at module
level. `CLAUDE.md` §9 zone A records the cost: the M4 audit declared
`FR-REP-07b` delivered while the export had never produced a valid file, because
a mock-total test proves wiring and cannot detect a real library
incompatibility.

Three gates, all required:

- **Structural, automated, non-vacuous:** a test asserting `ReportSummaryView.jsx`
  and its imported children contain **no `dark:` class token** in source. It fails
  the moment someone adds one — exactly and only what it claims to check.
- **Manual browser validation, recorded in the audit:** switch to dark, export a
  PDF _and_ a PNG, **open both files**, confirm white background and legible
  text. Not "the button did not throw".
- **Anti-vacuity, run not asserted** (`CLAUDE.md` §7): remove `.force-light`,
  confirm the export actually comes out dark, restore it. If breaking the
  mechanism changes nothing, the mechanism was not what made it work.

---

## 7. Design system

- **Tokens only.** All identity changes land in `index.css` token values; no
  component hardcodes a colour. Already true, must stay true — it is what makes
  dark mode and the palette change cheap.
- **Palette.** Dark navy sidebar, emerald accent, per the mockups. Replaces the
  greyscale values **including `--chart-1..5`**, which are five greys today.
- **Contrast is a requirement, not a preference.** Emerald on white and emerald
  on navy both need checking at text sizes, in both themes. A palette that reads
  well in a mockup screenshot can fail on a real screen at 13px.
- **Shell.** Sidebar with §2.2's seven items, collapsible on tablet (already
  required by §5.3), a consistent page-header component, and a **shared table
  component** — the mockups are mostly tables and the app builds each one by hand
  today.
- **Components to add:** `table`, `select`, `tabs`, `dropdown-menu`, `badge`,
  `skeleton`, `toast`. All shadcn, all in-stack. Recharts is the only new
  dependency, and it is already named for Phase 2 in `CLAUDE.md` §4.

---

## 8. Sub-stage plan

Each sub-stage is a gate: verified, reported, **awaiting explicit approval before
the commit** (`CLAUDE.md` §2). New code comes with tests (§7).

| #   | Sub-stage                                                                                  | Why here                                                                                                       |
| --- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| 1   | `docs:` SRS commit — the whole §4/§5 delta, no code                                        | `CLAUDE.md` §1: no code before the SRS says so                                                                 |
| 2   | `feat:` theme provider, dark-mode toggle, new token values                                 | Prove the palette swap across existing pages _before_ new pages exist to hide regressions                      |
| 3   | `fix:` exports stay light — `.force-light`, structural guard, §6.4's three gates           | Immediately after 2, because 2 is what introduces the hazard                                                   |
| 4   | `feat:` admin shell — sidebar, page header, shared table, **`ErrorBoundary`**              | Everything after this consumes it                                                                              |
| 5   | `refactor:` Tenants → Renters in the locales                                               | Small, isolated, no logic                                                                                      |
| 6   | `feat:` Payments ledger (`FR-PAY-07..09`)                                                  | First new section; pure read over existing data, so it exercises the new shell cheaply                         |
| 7   | `feat:` pre-due reminder — `FR-PAY-10`, A8, `paymentReminderDaysBefore`, 4th scheduler job | Functions-band work, independent of the new collections; done before them so the scheduler isn't touched twice |
| 8   | `feat:` owner expenses — model, rules, storage, CRUD, list (`FR-OPEX-*`)                   | Largest item; the only one with a new collection _and_ new Security Rules                                      |
| 9   | `feat:` Expenses view B — billed cost lines (`FR-REP-16`)                                  | Completes the section _(skip if §9.4 drops it)_                                                                |
| 10  | `feat:` `notifications` + `onMailWrite` + `type`/`audience` on send (`FR-NLOG-*`)          | Second server-write collection; reuses the rules shape from 8                                                  |
| 11  | `feat:` `events` — collection, rules, callable emitters, triggers (`FR-ACT-*`)             | The broadest server change; deliberately after 8 and 10, whose events it must also capture                     |
| 12  | `feat:` dashboard — KPIs, chart, activity timeline (`FR-DASH-04..11`)                      | **Last of the features by necessity**: it consumes expenses (8) and events (11)                                |
| 13  | `feat:` tenant portal + shared-report chrome onto the new system                           | After the admin side is settled                                                                                |
| 14  | Five-zone audit (`CLAUDE.md` §9) → merge                                                   | All four bands run, not inferred                                                                               |

Order rationale worth keeping: **the hazard fix sits at 3, adjacent to what
creates it**, rather than at the end competing with launch pressure. The
dashboard sits at 12 not by preference but because `FR-DASH-05`/`-10` are
undefined until 8 and 11 exist.

**Debts to fold in rather than carry past M8** — `CURRENT_SPRINT.md` lists these
open, and sub-stages 2–4 rewrite the exact surfaces they live on:

- **No `ErrorBoundary` anywhere** — an uncaught render error is a blank white
  screen. Folded into sub-stage 4.
- **`MonthlyReportPage` reads `isError` from 1 of 3 queries;
  `OnboardingWizardPage` never destructures it** — silent failures, cheapest to
  fix while touching those pages.
- **The vacuous-test / cross-render-state-leak audit over the existing 680
  tests.** **Not** folded in — real work of unknown scope. Named so it is not
  lost, and so nobody assumes the redesign covered it.

---

## 9. Open points — settle before the sub-stage that needs them

1. **Are the six expense categories right?** (`FR-OPEX-03`, sub-stage 8.) They are
   the mockup's, plus `utilities`. Romanian rental practice may want _impozit_,
   _asociație de proprietari_, _reparații_, _notar/avocat_. Fixed constant or
   admin-editable list?
2. **Does the Payments ledger record payments, or only link to the report form?**
   (`FR-PAY-09`, sub-stage 6.) Recording from the ledger is the better workflow
   and the larger change — `FR-PAY-06`'s cancellation semantics and
   `onReportWrite`'s balance recomputation would both gain a second entry point.
3. **Branding: how far?** (`NFR-UX-01`, sub-stage 4.) The SRS requires a _"simple
   interface, without custom branding"_; the new sidebar has a wordmark slot and
   the palette is an identity. One decision covers both: leave the slot empty and
   treat this as palette-and-layout only, or amend `NFR-UX-01` and adopt a name.
   The administrator declined a product name in shaping, so the default is **leave
   it empty, amend `NFR-UX-01` minimally** — but a slot sized for a wordmark and
   left blank looks unfinished.
4. **Does Expenses view B survive?** (`FR-REP-16`, sub-stage 9.) §2.7's
   section-by-section description covered only owner expenses. View B is still in
   from the earlier "both, clearly separated" decision — confirm or drop.
5. **Recurring expenses.** (Sub-stage 8.) The mockup shows a management fee
   repeating monthly. Manual entry each month, or a "duplicate" action?
   Recommendation: manual with duplicate — real recurrence is a scheduler feature
   and would pull `dailyScheduler` into this milestone twice.
6. **`paymentReminderDaysBefore`: repeat or fire once?** (`FR-PAY-10`, sub-stage
   7.) `FR-PAY-04` repeats every 3 days after the due date. Does the pre-due
   reminder fire once, or daily in the run-up?
7. **`ownerId`: queried or forward-looking?** (§5.1, sub-stage 8.) Either is
   defensible; leaving it unstated is not.

---

## 10. Risks

| Risk                                                                 | Mitigation                                                                                                                                                   |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Dark exports reach a tenant over WhatsApp                            | §6's three gates, incl. opening the actual files. The fast band structurally cannot catch this.                                                              |
| "Expenses" conflated with billed cost lines, in code or in a total   | Distinct module ID (`OPEX`), distinct collection, the never-billed sentence verbatim in §6 of the SRS, separate labelled views                               |
| Event emission breaks a signature or a payment                       | `FR-ACT-06`: best-effort, outside the transaction, never a transactional participant                                                                         |
| `onReportWrite` regresses balance logic while gaining event emission | Its `currentBalance` behaviour is load-bearing and its tests are already known-fragile — treat as a separate verification, not a side effect of sub-stage 11 |
| Emulator hides a missing composite index                             | §5.5 — keep the no-`orderBy` rule; if it is broken, the index ships with the query                                                                           |
| `mail` opened to the client, exposing generated passwords            | §5.3 — projected `notifications`, metadata only; `mail` stays closed                                                                                         |
| Redesign silently breaks the first-launch empty state                | `FR-DASH-11` makes it a requirement; audit zone A verifies execution, not existence                                                                          |
| Pre-due reminder misfires near month end                             | `FR-PAY-10` inherits `FR-PAY-04`'s documented month-boundary behaviour and the `Date.UTC` rule — answered in the SRS, not discovered in production           |
| 14 sub-stages is a long branch; `main` drifts                        | `main` is frozen apart from this branch — M9 is parked (§2.1)                                                                                                |
| Scope creep from the mockups (maintenance, multi-currency)           | §3 names them out of scope now, not later                                                                                                                    |

---

## 11. What happens next

1. Settle **§9.1** (expense categories) at minimum — sub-stage 1 cannot be written
   without it. §9.4 and §9.6 are also cheap to answer now.
2. Rename the frozen branch, cut the new one (§1.2).
3. Write sub-stage 1: the SRS commit. **No product code before it lands and is
   approved.**
