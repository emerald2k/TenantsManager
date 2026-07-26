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
 * Exactly one of `url` (already persisted — SRS §6's `{url,name,type}`) or
 * `file` (a raw `File`, picked but not yet uploaded) is populated at any
 * time; `uploadPendingAttachments` (`../attachments.js`) is what turns a
 * `file` entry into a `url` one at save time. Deliberately permissive (no
 * `.refine()` enforcing the "exactly one" invariant) — this is a transient
 * client shape, not the persisted document; NFR-VAL-01's spirit.
 */
const attachmentSchema = z.object({
  name: required(),
  type: z.enum(['image', 'pdf', 'doc'], { error: REQUIRED }),
  url: z.string().optional(),
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
 * `serviceCosts` is ALWAYS rebuilt from the property's CURRENT active
 * services, merging in any amount/notes already saved for a service that is
 * still active — new services show up with amount 0, removed ones drop out.
 * This is a LIVE snapshot, not the final one: the DEFINITIVE freeze of
 * name+cost (FR-PROP-08) happens at SIGNING (sub-stage 4), not while the
 * report is still a draft.
 */
export function buildInitialValues({
  tenancy,
  property,
  month,
  year,
  existingReport,
}) {
  const activeServices = property?.services ?? []
  const savedServiceCosts = existingReport?.serviceCosts ?? []
  const serviceCosts = activeServices.map((service) => {
    const saved = savedServiceCosts.find(
      (line) => line.serviceId === service.serviceId,
    )
    return {
      serviceId: service.serviceId,
      name: service.name,
      amount: saved?.amount ?? 0,
      notes: saved?.notes ?? '',
      // Attachments carry over with the amount/notes for a service that's
      // still active — same "live snapshot until signing" reasoning as those.
      attachments: saved?.attachments ?? [],
    }
  })

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
        previousMonthArrears: existingReport.previousMonthArrears ?? 0,
        previousMonthCredit: existingReport.previousMonthCredit ?? 0,
        dueDate:
          existingReport.dueDate ??
          buildDueDate(year, month, tenancy?.dueDay ?? 1),
      }
    : {
        rent: { amount: tenancy?.monthlyRent ?? 0, notes: '', attachments: [] },
        maintenance: { amount: 0, notes: '', attachments: [] },
        serviceCosts,
        otherExpenses: [],
        previousMonthArrears: 0,
        previousMonthCredit: 0,
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
