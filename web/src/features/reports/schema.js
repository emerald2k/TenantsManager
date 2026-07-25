import { z } from 'zod'

/**
 * Validation + initial-values logic for the monthly report DRAFT form
 * (FR-REP-01…05/11/14, SRS §6). Sub-stage 1 of M4 — draft only, no
 * finalTotal/rounding (sub-stage 2), no attachments (sub-stage 3), no
 * signing/lock (sub-stage 4).
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

const costLineSchema = z.object({
  amount: amountField(),
  notes: optionalText(),
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
  dueDate: required(),
})

/** The form's shell before the real data (property/tenancy/existing report)
 * has loaded — every field controlled from the start, replaced by `reset()`
 * once `buildInitialValues` has something real to populate. */
export const reportFormDefaults = {
  rent: { amount: 0, notes: '' },
  maintenance: { amount: 0, notes: '' },
  serviceCosts: [],
  otherExpenses: [],
  previousMonthArrears: 0,
  previousMonthCredit: 0,
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
    }
  })

  if (existingReport) {
    return {
      rent: {
        amount: existingReport.rent?.amount ?? 0,
        notes: existingReport.rent?.notes ?? '',
      },
      maintenance: {
        amount: existingReport.maintenance?.amount ?? 0,
        notes: existingReport.maintenance?.notes ?? '',
      },
      serviceCosts,
      otherExpenses: (existingReport.otherExpenses ?? []).map((line) => ({
        description: line.description ?? '',
        amount: line.amount ?? 0,
        notes: line.notes ?? '',
      })),
      previousMonthArrears: existingReport.previousMonthArrears ?? 0,
      previousMonthCredit: existingReport.previousMonthCredit ?? 0,
      dueDate:
        existingReport.dueDate ??
        buildDueDate(year, month, tenancy?.dueDay ?? 1),
    }
  }

  return {
    rent: { amount: tenancy?.monthlyRent ?? 0, notes: '' },
    maintenance: { amount: 0, notes: '' },
    serviceCosts,
    otherExpenses: [],
    previousMonthArrears: 0,
    previousMonthCredit: 0,
    dueDate: buildDueDate(year, month, tenancy?.dueDay ?? 1),
  }
}
