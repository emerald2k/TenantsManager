# The financial model — every number the platform computes, and the ones it should

**2026-08-20 · analysis, not specification.** Written against `SRS.md` v4.4 and
the code at `d2fe582`. Where this document and the SRS disagree, the SRS wins
until a `docs:` commit says otherwise — but §11 lists the places where I think
the SRS is the one that needs to change.

> **Status:** every finding below has been acted on. The decisions taken from it
> are in `SRS.md` v4.5; the stages that implement them are in
> `2026-08-21-m8-execution-plan-rev5.md`. This file is kept for the reasoning —
> in particular §4's balance identity and §12's worked example, which are the
> shortest route to understanding why the aggregates are written the way they are.

---

## 1. What the words mean here

The request named _rent, revenue, profit, expenses, errands, bills, invoices,
totals, sums, differences_. Several of those are the same quantity under
different names, and two of them do not exist in this product at all. Pinning
the vocabulary first, because the recurring bug in this codebase is two names
for one number, or one name for two.

| Word asked about                              | What it maps to here                                                                                                                                                                                                   |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Rent**                                      | `rent.amount` on a report — one cost line among five categories. The only line that is genuinely the landlord's income.                                                                                                |
| **Bill value / report value / invoice value** | All three are `finalTotal`. There is no separate invoice object; the "bill" the tenant receives _is_ the signed monthly report. Fiscal invoicing is out of scope (§2.6).                                               |
| **Expenses**                                  | **Two opposite things.** (a) The four non-rent cost categories on a report — costs _recharged to the tenant_. (b) Costs the _owner_ bears. (b) **does not exist in the data model**; it is the deferred `OPEX` module. |
| **Errands**                                   | Reads as small ad-hoc costs. Today these land in `otherExpenses[]` if they are recharged to the tenant, and nowhere at all if the owner absorbs them.                                                                  |
| **Revenue**                                   | Not currently computed anywhere, under any name. §4 argues it is `Σ rent`, and that this is _not_ what the M8 dashboard's "Billed" tile shows.                                                                         |
| **Profit**                                    | Not computable. Exactly one input is missing, and it is the whole of (b). §4.4.                                                                                                                                        |
| **Sums / differences / totals**               | §3 and §5 enumerate all of them.                                                                                                                                                                                       |

---

## 2. The atoms — every stored number

Everything else in this document is derived from these. Nothing else is stored.

**On `monthlyReports/{reportId}`**

| Field                    | Type                         | Note                                         |
| ------------------------ | ---------------------------- | -------------------------------------------- |
| `rent.amount`            | number                       | may be negative (FR-REP-03)                  |
| `maintenance.amount`     | number                       | separate category, _not_ a service           |
| `serviceCosts[].amount`  | number[]                     | one per active service; all appear even at 0 |
| `otherExpenses[].amount` | number[]                     | free list                                    |
| `previousMonthArrears`   | number ≥ 0                   | frozen at signing                            |
| `previousMonthCredit`    | number ≥ 0                   | frozen at signing                            |
| `calculatedTotal`        | number                       | the automatic sum, kept as reference         |
| `finalTotal`             | number                       | **the only amount owed** (FR-REP-04c)        |
| `amountPaid`             | number \| null \| **absent** | absence is a real state                      |
| `paymentDate`            | ISO string \| null \| `''`   | absence is a real state                      |
| `dueDate`                | ISO string                   | stored, overridable per month (FR-REP-05)    |
| `month`, `year`          | number                       | the report's _period_                        |
| `status`                 | `draft` \| `signed`          | only these two                               |

**On `tenancies/{tenancyId}`**

`monthlyRent` (the contract figure, seeds a new report's rent line),
`securityDeposit`, `dueDay`, `startDate`, `endDate`, `currentBalance`.

**Never stored, always derived:** the rounding adjustment, the per-report
outstanding amount, "newly billed", overdue-ness, every portfolio aggregate,
and every historical series.

---

## 3. Layer 1 — arithmetic inside one report

### 3.1 The category sums

```
servicesTotal = Σ serviceCosts[i].amount
otherTotal    = Σ otherExpenses[i].amount
```

Both may include negative members — a service line carrying an adjustment
(FR-REP-03). Neither is stored; both are recomputed on every render.

### 3.2 The calculated total

```
calculatedTotal = rent.amount
                + maintenance.amount
                + servicesTotal
                + otherTotal
                + previousMonthArrears
                − previousMonthCredit
```

**This is the formula's single most consequential property: `calculatedTotal`
already contains the carry-forward.** It is not "this month's costs". Everything
that goes wrong downstream goes wrong by forgetting that.

### 3.3 The final total and the rounding adjustment

```
finalTotal = calculatedTotal, unless the admin overrides it (FR-REP-04a/04b)
```

The override exists for commercial rounding on cash payment — 2382.17 → 2380.
`finalTotal` is then the only amount owed; arrears are computed against it, and
the rounding difference never reappears (FR-REP-04c).

```
roundingAdjustment = finalTotal − calculatedTotal        ← DERIVED, NEVER SHOWN
```

**Gap 1.** The SRS says the calculated total "remains visible as a reference",
but the _difference_ between the two is never named, never labelled and never
displayed. A tenant looking at a report where the lines sum to 2382.17 and the
total says 2380 sees an unexplained 2.17 discrepancy — in a product whose stated
objective is "full transparency with tenants … to reduce misunderstandings"
(§2.1). One derived field and one label closes it. See §11.

### 3.4 Newly billed — the quantity that was missing until M8

```
newlyBilled = finalTotal − previousMonthArrears + previousMonthCredit
```

Equivalently: this month's own five categories, plus whatever rounding the admin
applied. This is the number that belongs on a chart, in an annual total, and in
any sentence beginning "this month you billed…".

Note it is **not** recoverable from `calculatedTotal` either — that field carries
the carry-forward too. Neither stored total is usable directly. This was settled
during M8 by reading `schema.js`; it is the reason `FR-DASH-04` is written the
way it is.

### 3.5 Payment arithmetic

```
outstanding      = finalTotal − (amountPaid ?? 0)
overpaymentCredit = max((amountPaid ?? 0) − finalTotal, 0)

paymentStatus = amountPaid == null        → absent   (a fourth neutral state)
              | amountPaid ≥ finalTotal   → 'paid'   (covers exact and over)
              | amountPaid > 0            → 'partial'
              | otherwise                 → 'unpaid'
```

The `?? 0` is load-bearing, not defensive style: a just-signed report has **no
`amountPaid` field at all**, and `finalTotal − undefined` is `NaN`, which would
silently corrupt `currentBalance` the instant a report is signed
(`reports.js:122-125`).

**Gap 2 — the negative-total edge case.** If a month nets negative (a large
credit plus small charges), `finalTotal < 0`, and with `amountPaid` absent the
derivation returns `'paid'` — technically consistent, semantically odd, and
undefined anywhere. Negative amounts are explicitly allowed, so this state is
reachable.

### 3.6 Overdue

```
isOverdue = dueDate < today AND outstanding > 0
```

Derived at render time from the **report's** `dueDate` — never stored. Note the
platform now has two independent notions of "due": the report's `dueDate`
(overridable per month) and the tenancy's `dueDay` (a calendar recurrence).
`FR-DASH-06` and `FR-PAY-10` use the report's; `FR-PAY-04` uses the tenancy's.
They diverge the moment an override is used, and that divergence is documented
rather than resolved.

---

## 4. Layer 2 — the balance chain, and the identity nobody wrote down

### 4.1 The recursion

Let, for the _n_-th signed report on a tenancy:

- **Bₙ** = newly billed (§3.4)
- **Fₙ** = `finalTotal`
- **Pₙ** = `amountPaid ?? 0`
- **balₙ** = `currentBalance` after that report

The carry-forward rule is `previousMonthArrears = max(balₙ₋₁, 0)` and
`previousMonthCredit = max(−balₙ₋₁, 0)`, so their signed difference is exactly
`balₙ₋₁`. Therefore:

```
Fₙ   = Bₙ + balₙ₋₁
balₙ = Fₙ − Pₙ
```

Substituting gives the recurrence `balₙ = balₙ₋₁ + Bₙ − Pₙ`, and unrolling it
from `bal₀ = 0`:

> ### The fundamental identity
>
> ```
> balₙ = Σⁿᵢ₌₁ (Bᵢ − Pᵢ)
> ```
>
> **The current balance equals everything ever newly billed minus everything
> ever paid.** Nothing else. It is not a snapshot of one month; it is the whole
> history, compressed into one number by the carry-forward.

This is why `recomputeCurrentBalance` reads **one** report and never sums —
that single `Fₙ − Pₙ` already _is_ the running total. The code says so
(`reports.js:111`); the algebra explains why it is true rather than merely
asserted.

### 4.2 The corollary that kills naive aggregation

```
Σ Fᵢ = Σ Bᵢ + Σ balᵢ₋₁    ≠    Σ Bᵢ
```

Summing `finalTotal` across months adds every unpaid balance once more for each
month it persists. Three months unpaid at 2000/month yields Σ F = 12000 against
a real Σ B = 6000. This is the arithmetic error the M8 audit caught in two
dashboard requirements, and it is not a subtle one — it is off by a factor that
grows with how badly a tenant is paying, which is precisely when the number
matters.

**Two safe aggregations, one forbidden one:**

| Want                  | Correct formula                                           |
| --------------------- | --------------------------------------------------------- |
| Billed over a period  | `Σ Bᵢ` over signed reports in that period                 |
| Outstanding right now | `currentBalance` — read it, never recompute it by summing |
| ~~Total owed~~        | ~~`Σ (Fᵢ − Pᵢ)`~~ — **never**; this is the double-count   |

### 4.3 Where the identity breaks — retroactive entry

`recomputeCurrentBalance` selects the most recent signed report by sorting on
`(year, month)` in memory (`reports.js:146-148`) — by the report's **period**,
not by when it was signed.

Now apply FR-REP-11 (retroactive reports allowed for any past month) together
with FR-REP-12 (recalculation propagates only into _future_ reports; published
ones remain untouched):

1. March is entered, signed, paid. `bal = 0`.
2. The admin realises February was never entered. They create it retroactively
   and sign it, with `newlyBilled = 2400`.
3. `onReportWrite` fires and recomputes. The most recent signed report by
   `(year, month)` is still **March**. `bal = March.finalTotal − March.amountPaid = 0`.
4. March's own `previousMonthArrears` froze at signing and does not move.

**The 2400 billed in February enters no balance, appears in no arrears figure,
and is never carried forward.** The tenant is never asked for it by the system.
The identity `balₙ = Σ(Bᵢ − Pᵢ)` fails by exactly the retroactive amount.

**Gap 3 — and it is the most serious one in this document.** The identity holds
**only when reports are signed in chronological order**. Nothing enforces that,
nothing detects the violation, and the failure is silent and invisible: every
screen keeps showing internally consistent numbers. FR-REP-11 and FR-REP-12 each
make sense alone; together they open this hole, and neither mentions the other.

The same mechanism, less severely, affects unlock: unlocking the most recent
signed report drops it out of the query, and the balance falls back to an older
report — whose `finalTotal − amountPaid` ignores any payment recorded against
the now-unlocked one.

Remedies, cheapest first, in §11.

---

## 5. Layer 3 — what the tenant pays

The tenant's numbers are a strict subset, and all of them already exist.

| Number                | Formula                                                                  | Where                 |
| --------------------- | ------------------------------------------------------------------------ | --------------------- |
| Amount due this month | `finalTotal`                                                             | `/app` card           |
| Breakdown             | each `costLine.amount`, labelled                                         | `/app`, report detail |
| Brought forward       | `previousMonthArrears` / `previousMonthCredit`, shown as their own lines | report body           |
| Paid                  | `amountPaid`                                                             | history row           |
| Still owed            | `finalTotal − (amountPaid ?? 0)`                                         | badge                 |
| Due date              | `dueDate`                                                                | card                  |

**Gap 4.** The tenant's history (`/app/history`) shows month, total, paid,
status per row — but **no running balance column**. The tenant can see that
March was underpaid by 500 and that April's total is higher, but nothing states
"you currently owe X" as a single figure, even though `currentBalance` exists and
is denormalized onto their tenancy for exactly this kind of read. This is the
one number a tenant most wants and the portal does not show it.

**Gap 5 — the deposit.** `securityDeposit` is stored on the tenancy and
participates in **no** calculation anywhere. That is correct — a deposit is held,
not earned, and must never enter a total. But it means end-of-tenancy settlement
(deposit offset against final arrears, or return) is entirely manual and
unmodelled, while FR-CON-04 blocks termination whenever `currentBalance > 0` —
so the one moment the deposit exists to cover is the one moment the system
refuses to proceed.

---

## 6. Layer 4 — what the landlord actually earns

This is where the request's words and the product's data diverge most.

### 6.1 "Billed" is not revenue

`newlyBilled` = rent + maintenance + services + other. Of those, **only rent is
income**. The utility lines are money the landlord collects from the tenant and
forwards to a supplier; the supplier's invoice is literally attached to the line
(FR-REP-03a). Maintenance is usually the same. So:

```
grossRentalIncome (period) = Σ rent.amount        over signed reports in the period
passThrough       (period) = Σ (maintenance + services + other)
newlyBilled       (period) = grossRentalIncome + passThrough
```

Pass-through nets to zero **provided the recharged amount equals the invoice
amount** — which the model assumes and never verifies (Gap 7).

**Gap 6.** `Σ rent` is trivially computable from data that has existed since M4,
is the single most meaningful figure for a landlord, and **is displayed nowhere**.
The M8 dashboard's headline "Billed" tile is dominated by utilities the landlord
does not keep. For a 2000-lei rent with 500 in utilities, "Billed 2500" overstates
income by 25% — and the error moves with the weather.

The fix is one extra tile or one sub-label, on data already fetched. See §11.

### 6.2 What profit needs

```
netProfit (period) = grossRentalIncome − ownerExpenses − tax
```

- **`grossRentalIncome`** — available today, uncomputed (§6.1).
- **`ownerExpenses`** — insurance, property tax, repairs, management fees,
  HOA/_asociație_, notary and legal. **Not recorded anywhere.** This is the whole
  of the deferred `OPEX` module.
- **`tax`** — Romanian tax on rental income. Not modelled, and it is a category of
  owner expense rather than a separate mechanism. Rates and deduction rules
  change and are not something this document should assert; what matters
  architecturally is that it is an _input_, entered like any other owner cost,
  not a formula the platform should hardcode.

**So: the single missing input for profit is the owner-expense ledger.** Every
other operand already exists. That is worth stating plainly, because it means
"profit" is not a large modelling problem — it is one collection plus one
subtraction, gated behind a category-definition decision that was deferred.

`FR-DASH-11`'s ban on displaying a "Net income" figure in M8 is the right call
given that: with `ownerExpenses` structurally absent, any net figure would be
gross revenue wearing a profit label.

### 6.3 Pass-through and margin

If a landlord ever recharges more than the supplier invoiced (a service fee, a
rounding-up policy), the surplus is income and the pass-through-nets-to-zero
assumption fails. Nothing in the model records intent, so this would be
invisible. Not a problem today — worth a sentence in the SRS so that when `OPEX`
lands, "recharged 210, invoice 200" is a decided case rather than a discovered
one.

---

## 7. Layer 5 — portfolio aggregates

All are client-side aggregations over a bounded window (NFR-PERF-05).

| Figure              | Formula                                                                             | Basis    | Status          |
| ------------------- | ----------------------------------------------------------------------------------- | -------- | --------------- |
| Billed (month)      | `Σ Bᵢ` over signed reports with matching `month`/`year`                             | accrual  | M8, FR-DASH-04  |
| Collected (month)   | `Σ amountPaid` where `paymentDate` in month                                         | **cash** | M8, FR-DASH-05  |
| Overdue             | `Σ currentBalance` over active tenancies where `> 0` and last signed `dueDate` past | —        | M8, FR-DASH-06  |
| Total arrears       | `Σ max(currentBalance, 0)` over active tenancies                                    | —        | exists          |
| Total credit        | `Σ max(−currentBalance, 0)`                                                         | —        | **never shown** |
| Occupied / free     | counts on `properties.status`                                                       | —        | M8, FR-DASH-07  |
| Gross rental income | `Σ rent.amount`                                                                     | accrual  | **Gap 6**       |
| Pass-through        | `Σ (maintenance + services + other)`                                                | accrual  | not computed    |

**Billed and Collected are on different bases and cover different documents.** A
January report paid on 4 February contributes to January's Billed and February's
Collected. They cannot share a query, they will rarely be equal, and their
difference in any single month is not a meaningful quantity — which is why
`FR-DASH-08` forbids blending them.

**Gap 8 — credit is invisible at portfolio level.** Arrears are aggregated and
shown in red; credit (tenants in advance) is aggregated nowhere. It is a real
liability — money held against future months — and it is the mirror of a figure
already on screen.

---

## 8. Layer 6 — historical series

### 8.1 What exists

- **Per property** (FR-PROP-09): months × (rent, maintenance, services, other, total).
- **Per tenant** (FR-TAPP-02): one summary row per report — month, total, paid, status.
- **Portfolio** (FR-DASH-09, M8): Billed per month, rolling 12 months.

### 8.2 The cost-history table does not add up, and here is why

`CURRENT_SPRINT.md` carries an open observation that the per-property cost
history's "rows appear not to add up". The algebra explains it exactly.

The row shows the four categories and a **total**. The categories sum to
`newlyBilled − roundingAdjustment`. If the total column is `finalTotal`, then:

```
total − Σcategories = previousMonthArrears − previousMonthCredit + roundingAdjustment
                    = balₙ₋₁ + roundingAdjustment
```

**The row is off by exactly the carried-forward balance, plus any rounding.** It
adds up only in months where the tenant was square and no rounding was applied —
which is why it looks _mostly_ right and occasionally wrong, the hardest kind of
bug to characterise from observation.

Two clean fixes: show `newlyBilled` as the total (the row then adds up, and the
column means "billed for this month"), or add explicit arrears/credit/rounding
columns so the arithmetic is visible. The first is better for a cost-history
table, whose purpose is per-service evolution over time; carry-forward is not a
cost of the property.

### 8.3 Series worth adding, all from existing data

- **Collected per month** — pairs with Billed; the gap between the two curves
  _is_ the collection problem, visible at a glance.
- **Balance over time per tenancy** — the running `Σ(Bᵢ − Pᵢ)`. Answers "is this
  tenant drifting?" which no current screen answers.
- **Per-service trend** — already promised as FR-PROP-09's Phase-2 chart, and no
  longer blocked now that Recharts is in the stack.
- **Arrears ageing** — how much is 0-30 / 31-60 / 61-90 / 90+ days overdue.
  Needs only `dueDate` and today.

---

## 9. Metrics a landlord wants that nothing computes

None of these need new stored data. All are derivable today.

| Metric                           | Formula                                         | Inputs                                                                |
| -------------------------------- | ----------------------------------------------- | --------------------------------------------------------------------- |
| **Collection rate**              | `Collected / Billed` over a trailing window     | exists                                                                |
| **Arrears ratio**                | `totalArrears / Billed(trailing 12m)`           | exists                                                                |
| **Average days to pay**          | `mean(paymentDate − dueDate)` over paid reports | exists                                                                |
| **Occupancy rate**               | `occupiedDays / availableDays` over a period    | `tenancy.startDate`/`endDate`                                         |
| **Annualised rent per property** | `Σ rent` over trailing 12 months, per property  | exists                                                                |
| **Vacancy cost**                 | `vacantDays × (monthlyRent / daysInMonth)`      | exists                                                                |
| **Effective yield**              | `(Σ rent − ownerExpenses) / propertyValue`      | needs `OPEX` **and** a property valuation field, which does not exist |

The first six are pure derivations over data already fetched for other screens.
The last is the only one needing new inputs, and it needs two.

**Division-by-zero:** collection rate and arrears ratio are undefined when the
denominator is zero — a real state in month one, and after any month with no
signed reports. They must render as "—", not as `NaN`, `0%` or `∞`.

---

## 10. Numerical hygiene

**Floating point.** Money is stored as JavaScript numbers, i.e. binary doubles.
`0.1 + 0.2 !== 0.3`. Today the exposure is small — most sums are over a handful
of two-decimal values — and the codebase already acknowledges it with
`FINAL_TOTAL_EPSILON = 0.005` when comparing `finalTotal` to `calculatedTotal`.

M8 raises the exposure: a 12-month chart sums ~240 values per bar-set, and
annual totals sum more. Two workable positions:

1. **Round at defined boundaries** — every displayed figure rounded to 2 decimals
   at the display layer, never in storage; comparisons always via epsilon. Cheap,
   consistent with what exists.
2. **Integer bani** — store and compute in ×100 integers, format at the edge.
   Correct by construction, but it is a data migration over every report.

At 5-20 properties (1) is sufficient. It should be _written down_ as the choice,
because right now it is a habit in one file rather than a rule.

**Never compare money with `===`.** Use the epsilon. This already bit the
`isFinalTotalDiverged` logic and is why the constant exists.

**Absent versus zero.** `amountPaid` absent, `null`, `0` and `''` are four
distinct states in the current data, and they mean different things: never paid,
payment cancelled, paid nothing, and a form artefact. Aggregations must use
`?? 0`; _filters_ must not treat them alike — a payments ledger that filters on
`amountPaid > 0` silently hides cancelled payments.

**Negative amounts are legal** (FR-REP-03) and must render legibly rather than as
an error, including inside sums, chart bars and the RON formatter.

**Formatting** stays `1.234,56 lei` (NFR-LOC-02) everywhere including chart axes,
which are explicitly not abbreviated. Rounding is a display concern only.

---

## 11. Gap register

Ordered by consequence, not by effort.

| #       | Gap                                                          | Consequence                                                                                           | Fix                                                                                                                                                                                                                                                              |
| ------- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **3**   | Retroactive signing breaks the balance chain (§4.3)          | **Money billed is silently never collected.** No screen reveals it                                    | Cheapest: block signing a report for a period earlier than the most recent signed one, or warn loudly. Correct: recompute the chain forward from the earliest changed month — which contradicts FR-REP-12 as written and therefore needs a decision, not a patch |
| **6**   | `Σ rent` computed nowhere (§6.1)                             | The landlord has no figure for what they actually earn; "Billed" overstates it by the utility share   | One tile or sub-label on data already fetched                                                                                                                                                                                                                    |
| **8.2** | Cost-history rows do not add up                              | A visible arithmetic error on a tenant-adjacent table; already observed, not yet explained            | Use `newlyBilled` as the total, or add explicit carry-forward columns                                                                                                                                                                                            |
| **4**   | Tenant portal shows no running balance                       | The tenant's single most important number is absent, though it is denormalized onto their own tenancy | One field, one label                                                                                                                                                                                                                                             |
| **1**   | Rounding adjustment never labelled                           | An unexplained discrepancy on a document whose purpose is transparency                                | One derived field, one row                                                                                                                                                                                                                                       |
| **8**   | Portfolio credit never aggregated                            | A real liability is invisible; the mirror of a figure already shown                                   | One aggregation                                                                                                                                                                                                                                                  |
| **5**   | Deposit unmodelled at settlement                             | The one moment it exists for is the one moment termination is blocked                                 | Needs a decision, not just code                                                                                                                                                                                                                                  |
| **2**   | Negative `finalTotal` derives `'paid'`                       | Reachable, undefined                                                                                  | One sentence in the SRS                                                                                                                                                                                                                                          |
| **7**   | Nothing checks recharged amount against the attached invoice | A typo in a cost line is undetectable                                                                 | Out of scope to automate; worth naming                                                                                                                                                                                                                           |
| **10**  | Float-rounding policy is a habit, not a rule                 | Drift grows with the length of the series M8 introduces                                               | Write the rule down                                                                                                                                                                                                                                              |

**What is genuinely missing from the data model, as opposed to merely
uncomputed:** owner expenses (blocks profit, tax, yield) and a property
valuation (blocks yield alone). Everything else in this document is derivable
from what is already stored.

---

## 12. Worked example

One tenancy, four months, exercising partial payment, rounding, overpayment and
the aggregation trap. Rent 2000 throughout.

**January** — maintenance 150, electricity 180, gas 120, water 60, other 0

```
B₁ = 2000+150+180+120+60 = 2510      bal₀ = 0  →  A₁ = 0, C₁ = 0
calculatedTotal = 2510 · finalTotal = 2510 (no rounding)
Paid 2000 on 05.01 → outstanding 510 → 'partial'
bal₁ = 2510 − 2000 = 510
```

**February** — maintenance 150, electricity 210, gas 140, water 55

```
own categories = 2555                 A₂ = 510, C₂ = 0
calculatedTotal = 2555 + 510 = 3065
admin rounds finalTotal → 3060        roundingAdjustment = −5
B₂ = 3060 − 510 + 0 = 2550            (the −5 lands in February, per FR-REP-04c)
Paid 3060 on 04.02 → 'paid'
bal₂ = 3060 − 3060 = 0
```

**March** — maintenance 150, electricity 90, gas 40, water 60

```
B₃ = 2340    A₃ = 0, C₃ = 0    finalTotal = 2340
Paid 2400 on 03.03 → overpayment 60 → 'paid'
bal₃ = 2340 − 2400 = −60          (a credit)
```

**April** — the credit carries: `A₄ = 0, C₄ = 60`, so April's own 2400 of
categories yields `calculatedTotal = 2400 − 60 = 2340`.

**Checking the identity (§4.1):**

```
Σ(Bᵢ − Pᵢ) = (2510−2000) + (2550−3060) + (2340−2400)
           =    510      +   (−510)    +   (−60)      = −60  =  bal₃   ✓
```

**Checking the trap (§4.2):**

```
Σ Fᵢ = 2510 + 3060 + 2340 = 7910
Σ Bᵢ = 2510 + 2550 + 2340 = 7400
difference = 510 — January's arrears, counted a second time in February
```

**What the landlord actually earned, Jan-Mar:**

```
grossRentalIncome = 3 × 2000 = 6000
passThrough       = 7400 − 6000 = 1400      (maintenance + utilities, forwarded)
netProfit         = 6000 − ownerExpenses    ← ownerExpenses is not recorded
```

The M8 dashboard would show **Billed 7400** and **Collected 7460**. Neither is
what the landlord earned; the earned figure, 6000, appears on no screen.

---

## 13. What I would change in the SRS

Not proposed as edits — these need decisions first, and three of them are
reversals or scope changes rather than clarifications.

1. **Resolve FR-REP-11 against FR-REP-12** (Gap 3). This is the only item here
   that loses money. Either constrain retroactive signing, or define
   forward-recomputation and accept that it rewrites signed reports.
2. **Add `grossRentalIncome` as a first-class figure** (Gap 6) — `Σ rent`, on
   the dashboard and in the per-property view, labelled as distinct from Billed.
3. **Define the total column in FR-PROP-09** as `newlyBilled` (Gap 8.2), which
   makes the table internally consistent and matches what a cost history is for.
4. **Add a running-balance column to FR-TAPP-02** (Gap 4).
5. **Name the rounding adjustment** in FR-REP-04a and show it (Gap 1).
6. **Write the float-rounding rule** into §4.6 or `CLAUDE.md` §7 (Gap 10).
7. **Record the pass-through assumption** — recharged equals invoiced — so
   `OPEX` inherits it as a decided case (§6.3).
8. **Carry the profit formula into the deferred-`OPEX` note** in §2.7, so
   whoever specifies that module knows it exists to complete
   `netProfit = Σrent − ownerExpenses − tax` and not merely to file receipts.

Items 2-6 are small, use data that already exists, and would each fix a number
that is currently absent or wrong. Item 1 is the one that should not wait.
