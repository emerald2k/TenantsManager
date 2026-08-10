import { z } from 'zod'

/**
 * Validation + initial-values logic for the monthly report DRAFT form
 * (FR-REP-01…05/11/14/04a/04b/04c, FR-DOC-01…05, SRS §6). Sub-stage 1+2+3 of
 * M4 — draft only, no signing/lock (sub-stage 4). No rounding
 * suggestion/button exists (dropped from the SRS at 5abb5bd) — `finalTotal`
 * only mirrors the exact `calculatedTotal` until the admin edits it manually
 * (MonthlyReportPage owns that dirty-flag orchestration; this file only
 * decides the STARTING values and whether a reopened report counts as
 * "already diverged").
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
 * money math, not an exact-equality domain. */
const FINAL_TOTAL_EPSILON = 0.005

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
