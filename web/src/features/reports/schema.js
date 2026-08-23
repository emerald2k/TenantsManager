import { z } from 'zod'

/**
 * Validation + initial-values logic for the monthly report DRAFT form
 * (FR-REP-01…05/11/14/04a/04b/04c/04d, FR-DOC-01…05, SRS §6).
 * `finalTotal` mirrors the exact `calculatedTotal` until the admin edits it
 * manually OR applies the rounding action (FR-REP-04a, reintroduced at M8 —
 * the "no rounding button" note this comment used to carry, from 5abb5bd,
 * was superseded by v4.6's reversal; MonthlyReportPage owns both the
 * dirty-flag orchestration AND the rounding action; this file only decides
 * the STARTING values and whether a reopened report counts as "already
 * diverged").
 *
 * `roundingSurplus` (FR-REP-04a/04c, SRS §6): set ONLY by the rounding
 * action, never by a manual edit of `finalTotal` (which clears it). A
 * SIGNED report's surplus is frozen exactly like `previousMonthArrears`/
 * `previousMonthCredit` below — it is a stored fact about how that report's
 * `finalTotal` was produced, not something this file re-derives.
 *
 * Cost-line `attachments[]` (sub-stage 3): this file only decides the
 * STARTING values (existing refs carried over, resynced onto still-active
 * services) — the actual Storage upload/delete choreography lives in
 * `./attachments.js` and `./hooks.js`.
 *
 * Amount fields use a DIFFERENT coercion than onboarding's `numberField`
 * (blank -> undefined -> fails `required()`): here blank/NaN coerces to 0 and
 * stays valid. Decision (sub-stage 1 plan): an untouched amount line (e.g. a
 * service nobody billed this month) must not force the admin to type "0" on
 * every row before the total can compute or the draft can save.
 */

const REQUIRED = 'reports.errors.required'

const required = () =>
  z.string({ error: REQUIRED }).trim().min(1, { error: REQUIRED })

const optionalText = () => z.string().trim().optional()

const blankToZero = (value) =>
  value === '' || (typeof value === 'number' && Number.isNaN(value)) ? 0 : value
const amountField = () => z.preprocess(blankToZero, z.number())

/**
 * One cost-line attachment, in FORM state (M4 sub-stage 3, FR-DOC-01…05).
 * Exactly one of `path` (already persisted — SRS §6's `{path,name,type}`, a
 * bucket-relative Storage path, never a download URL — debt #5) or `file` (a
 * raw `File`, picked but not yet uploaded) is populated at any time;
 * `uploadPendingAttachments` (`../attachments.js`) is what turns a `file`
 * entry into a `path` one at save time. Deliberately permissive (no
 * `.refine()` enforcing the "exactly one" invariant) — this is a transient
 * client shape, not the persisted document; NFR-VAL-01's spirit.
 */
const attachmentSchema = z.object({
  name: required(),
  type: z.enum(['image', 'pdf', 'doc'], { error: REQUIRED }),
  path: z.string().optional(),
  file: z.instanceof(File).optional(),
})

const costLineSchema = z.object({
  amount: amountField(),
  notes: optionalText(),
  attachments: z.array(attachmentSchema).optional(),
})

const serviceCostSchema = costLineSchema.extend({
  serviceId: required(),
  name: required(),
})

const otherExpenseSchema = costLineSchema.extend({
  description: required(),
})

export const reportSchema = z.object({
  rent: costLineSchema,
  maintenance: costLineSchema,
  serviceCosts: z.array(serviceCostSchema),
  otherExpenses: z.array(otherExpenseSchema),
  previousMonthArrears: amountField(),
  previousMonthCredit: amountField(),
  finalTotal: amountField(),
  roundingSurplus: amountField(),
  dueDate: required(),
})

/** The form's shell before the real data (property/tenancy/existing report)
 * has loaded — every field controlled from the start, replaced by `reset()`
 * once `buildInitialValues` has something real to populate. */
export const reportFormDefaults = {
  rent: { amount: 0, notes: '', attachments: [] },
  maintenance: { amount: 0, notes: '', attachments: [] },
  serviceCosts: [],
  otherExpenses: [],
  previousMonthArrears: 0,
  previousMonthCredit: 0,
  finalTotal: 0,
  roundingSurplus: 0,
  dueDate: '',
}

/**
 * The automatic total (FR-REP-04): rent + maintenance + Σservices + Σother +
 * previousMonthArrears − previousMonthCredit. Defensive against blank/NaN
 * amounts on purpose — this also powers the LIVE footer total while the admin
 * is still mid-edit, before the Zod resolver has coerced anything.
 */
export function calculateTotal(values) {
  const serviceSum = (values.serviceCosts ?? []).reduce(
    (sum, line) => sum + (Number(line.amount) || 0),
    0,
  )
  const otherSum = (values.otherExpenses ?? []).reduce(
    (sum, line) => sum + (Number(line.amount) || 0),
    0,
  )
  return (
    (Number(values.rent?.amount) || 0) +
    (Number(values.maintenance?.amount) || 0) +
    serviceSum +
    otherSum +
    (Number(values.previousMonthArrears) || 0) -
    (Number(values.previousMonthCredit) || 0)
  )
}

/**
 * The rounding action (FR-REP-04a): rounds `calculatedTotal` UPWARD to the
 * next multiple of 10. Only meaningful for `calculatedTotal > 0` — the
 * caller (MonthlyReportPage) gates the button itself on that, per FR-REP-04a
 * ("unavailable when calculatedTotal ≤ 0" — rounding a credit "up" moves it
 * toward zero, quietly shrinking money the product owes the tenant).
 */
export function computeRoundedTotal(calculatedTotal) {
  return Math.ceil(calculatedTotal / 10) * 10
}

/**
 * paymentStatus (FR-PAY-01/02/05, SRS §6): a pure function of finalTotal vs.
 * amountPaid, computed client-side before every payment write — 'paid'
 * covers BOTH an exact match and an overpayment (the excess becomes credit
 * via currentBalance going negative — FR-PAY-05 — it is not a distinct
 * paymentStatus of its own).
 */
export function derivePaymentStatus(finalTotal, amountPaid) {
  const paid = Number(amountPaid) || 0
  const total = Number(finalTotal) || 0
  if (paid >= total) return 'paid'
  if (paid > 0) return 'partial'
  return 'unpaid'
}

/**
 * The payment mini-form's schema (FR-PAY-01). Presence-only (NFR-VAL-01) —
 * no minimum-amount or date-format validation.
 */
export const paymentSchema = z.object({
  amountPaid: amountField(),
  paymentMethod: z.enum(['cash', 'bank_transfer', 'other'], {
    error: REQUIRED,
  }),
  paymentDate: required(),
})

/** Combines year+month+dueDay into an ISO date string ("YYYY-MM-DD"), same
 * plain-string convention as tenancy.startDate/endDate — no Firestore
 * Timestamp involved (FR-REP-05: pre-filled, editable). Clamped to the
 * month's actual last day so a dueDay of 31 doesn't leak into March when the
 * selected month is February. */
export function buildDueDate(year, month, dueDay) {
  const lastDayOfMonth = new Date(year, month, 0).getDate()
  const day = Math.min(dueDay, lastDayOfMonth)
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/**
 * Builds the form's initial values, whether creating a fresh draft or
 * reopening an existing one (FR-REP-14: the deterministic id decides which).
 *
 * `serviceCosts` is rebuilt from the property's CURRENT active services,
 * merging in any amount/notes already saved for a service that is still
 * active — new services show up with amount 0, removed ones drop out. This is
 * a LIVE snapshot while the report is still a draft. Once SIGNED, it FREEZES
 * (FR-PROP-08): the property's services may keep changing after signing, but
 * a signed report must keep showing exactly the name+cost snapshot the tenant
 * already saw, so a signed report's `serviceCosts` is used AS SAVED, with no
 * resync against `property.services` at all. Rent/maintenance/otherExpenses
 * never resync from an external live source in the first place, so they need
 * no equivalent gate — this is the only place a signed report could
 * otherwise silently drift from what it was signed with.
 */
export function buildInitialValues({
  tenancy,
  property,
  month,
  year,
  existingReport,
}) {
  // Hoisted once, reused for BOTH serviceCosts (FR-PROP-08) and the
  // previousMonthArrears/Credit carry-forward below — a single
  // `=== 'signed'` check for the whole function, so the two FREEZE gates
  // can never drift apart.
  const isSignedSnapshot = existingReport?.status === 'signed'
  const activeServices = property?.services ?? []
  const savedServiceCosts = existingReport?.serviceCosts ?? []
  const serviceCosts = isSignedSnapshot
    ? savedServiceCosts.map((line) => ({
        serviceId: line.serviceId,
        name: line.name,
        amount: line.amount ?? 0,
        notes: line.notes ?? '',
        attachments: line.attachments ?? [],
      }))
    : activeServices.map((service) => {
        const saved = savedServiceCosts.find(
          (line) => line.serviceId === service.serviceId,
        )
        return {
          serviceId: service.serviceId,
          name: service.name,
          amount: saved?.amount ?? 0,
          notes: saved?.notes ?? '',
          // Attachments carry over with the amount/notes for a service
          // that's still active — same "live snapshot until signing"
          // reasoning as those.
          attachments: saved?.attachments ?? [],
        }
      })

  const currentBalance = tenancy?.currentBalance ?? 0
  // FREEZE (SRS §6, pinned at e8ca367): a SIGNED report's carry-forward
  // values are locked at whatever they were when it was signed — they must
  // NOT react to the tenancy's currentBalance moving on afterward. A DRAFT
  // mirrors currentBalance LIVE: positive → arrears, negative → credit
  // (never both at once). Same snapshot-at-signing discipline as
  // `serviceCosts` above (FR-PROP-08). Computed BEFORE `base` and kept ON
  // `base` (not spread in afterward) so `calculateTotal(base)` below still
  // sees them — finalTotal must include the carried-forward arrears, not
  // just display them.
  const previousMonthArrears = isSignedSnapshot
    ? (existingReport.previousMonthArrears ?? 0)
    : Math.max(currentBalance, 0)
  const previousMonthCredit = isSignedSnapshot
    ? (existingReport.previousMonthCredit ?? 0)
    : Math.max(-currentBalance, 0)

  const base = existingReport
    ? {
        rent: {
          amount: existingReport.rent?.amount ?? 0,
          notes: existingReport.rent?.notes ?? '',
          attachments: existingReport.rent?.attachments ?? [],
        },
        maintenance: {
          amount: existingReport.maintenance?.amount ?? 0,
          notes: existingReport.maintenance?.notes ?? '',
          attachments: existingReport.maintenance?.attachments ?? [],
        },
        serviceCosts,
        otherExpenses: (existingReport.otherExpenses ?? []).map((line) => ({
          description: line.description ?? '',
          amount: line.amount ?? 0,
          notes: line.notes ?? '',
          attachments: line.attachments ?? [],
        })),
        previousMonthArrears,
        previousMonthCredit,
        // FR-REP-04a/04c: a stored fact about how THIS report's finalTotal
        // was produced (rounding action or none) — carried over on every
        // reopen exactly like the cost lines above, never re-derived here.
        roundingSurplus: existingReport.roundingSurplus ?? 0,
        dueDate:
          existingReport.dueDate ??
          buildDueDate(year, month, tenancy?.dueDay ?? 1),
      }
    : {
        rent: { amount: tenancy?.monthlyRent ?? 0, notes: '', attachments: [] },
        maintenance: { amount: 0, notes: '', attachments: [] },
        serviceCosts,
        otherExpenses: [],
        previousMonthArrears,
        previousMonthCredit,
        roundingSurplus: 0,
        dueDate: buildDueDate(year, month, tenancy?.dueDay ?? 1),
      }

  // Fresh report: mirrors the total just built. Reopened report: the SAVED
  // finalTotal — except an M4 sub-stage 1 draft (saved before finalTotal
  // existed) falls back to the same computation, from these exact `base`
  // values, so it mirrors going forward instead of freezing at `undefined`.
  const finalTotal = existingReport?.finalTotal ?? calculateTotal(base)

  return { ...base, finalTotal }
}

/** Epsilon for the finalTotal/calculatedTotal comparison below — floating-point
 * money math, not an exact-equality domain (NFR-VAL-03: money is never
 * compared exactly). Exported — MonthlyReportPage's live "Adjustment" line
 * (FR-REP-04d) needs the same tolerance, not a re-declared one. */
export const FINAL_TOTAL_EPSILON = 0.005

/**
 * FR-REP-04e: whether a report's `finalTotal` diverges MATERIALLY from its
 * `calculatedTotal` — `|finalTotal − calculatedTotal| > max(5, 1% of
 * |calculatedTotal|)` — and therefore requires the second confirmation +
 * written reason at signing.
 *
 * **The rounding action is exempt, but ONLY for as much of the divergence as
 * it actually explains.** A report is exempt when `finalTotal −
 * calculatedTotal` still EQUALS the stored `roundingSurplus` (within
 * epsilon) — the ordinary case, where nothing has changed since the
 * rounding action ran. If a cost line is edited AFTER rounding (finalTotal
 * stays frozen at the rounded value — the mirror effect only runs while
 * `!isFinalTotalDirty`, and rounding sets that dirty — while `calculatedTotal`
 * keeps moving), the two drift apart: the divergence is no longer fully
 * accounted for by the surplus, and the EXCESS is exactly the kind of
 * unexplained gap FR-REP-04e exists to catch. A blanket "roundingSurplus > 0
 * -> always exempt" would open a loophole where any edit made after a
 * rounding action, however large, sails past the guard silently — this
 * checks that the surplus still explains the WHOLE gap, not merely that one
 * was ever set.
 */
export function isMaterialFinalTotalOverride(
  finalTotal,
  calculatedTotal,
  roundingSurplus,
) {
  const divergence = (finalTotal ?? 0) - (calculatedTotal ?? 0)
  const explainedByRounding =
    Math.abs(divergence - (roundingSurplus ?? 0)) < FINAL_TOTAL_EPSILON
  if (explainedByRounding) return false
  const threshold = Math.max(5, Math.abs(calculatedTotal ?? 0) * 0.01)
  return Math.abs(divergence) > threshold
}

/**
 * Decides whether a REOPENED report's `finalTotal` was manually diverged from
 * its `calculatedTotal` at save time (sub-stage 2 plan: "freeze only if YOU
 * edited finalTotal"). `false` (not diverged, i.e. still mirroring) covers
 * THREE cases on purpose:
 *  - a brand new report (no `existingReport` yet)
 *  - a reopened report whose `finalTotal` equals its `calculatedTotal` —
 *    it was mirroring when saved, so it keeps mirroring now
 *  - an M4 sub-stage 1 draft with no `finalTotal` saved at all
 * Only a REAL divergence (admin typed a different value) freezes the field.
 */
export function isFinalTotalDiverged(existingReport) {
  if (!existingReport || existingReport.finalTotal == null) return false
  const calculated = existingReport.calculatedTotal ?? 0
  return Math.abs(existingReport.finalTotal - calculated) >= FINAL_TOTAL_EPSILON
}
