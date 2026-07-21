const { z } = require('zod')

/**
 * Server-side validation of the complete onboarding draft, for finalizeKyc.
 *
 * WHY THIS IS RE-IMPLEMENTED (not imported from web/): the Zod schema lives in
 * `web/src/features/onboarding/schema.js`, but Firebase deploys ONLY the
 * `functions/` directory with its own dependencies. A cross-directory import
 * (`require('../../web/src/...')`) would work in the emulator and then break at the
 * M7 production deploy, where `web/` is not uploaded — the worst kind of bug. A
 * shared `file:` package is the "proper" fix but is disproportionate infra for one
 * schema. So this mirrors the web full-draft contract instead.
 *
 * DIVERGENCE MITIGATION: the field names and rules come from SRS §6 + the FRs, which
 * BOTH this file and the web schema cite as the single source of truth. The contract
 * is small and stable (presence-only + two conditionals + at least one ID photo).
 * Both sides are tested against the same cases, so any drift surfaces as a test diff.
 * If web↔functions sharing grows beyond this, promote to a shared package (a decision
 * for Bogdan, flagged in the report).
 *
 * PRESENCE-ONLY (NFR-VAL-01): mandatory means non-empty; no format checks — cnp,
 * phone, email accept any non-empty string.
 *
 * EXCEPTION (Sub-stage E, type correction): dueDay, monthlyRent, securityDeposit,
 * occupantCount, employmentDuration are genuinely numeric — arithmetic input for
 * M4's report totals / FR-PROP-11's countdown / FR-CON-01's contract terms, not
 * free text that happens to look like a number. Mirrors
 * web/src/features/onboarding/schema.js exactly.
 */

const required = () => z.string().trim().min(1)
const optional = () => z.string().trim().optional()

// `numberField` preprocesses "untouched" → `undefined` before the real check
// runs — a real Firestore draft (autosaved by the web wizard) NEVER omits a key;
// an untouched numeric field is PRESENT, either as `''` (the raw
// draftFormDefaults value) or `NaN` (what a `valueAsNumber`-registered input
// actually reads for an empty field — see the matching note in
// web/src/features/onboarding/schema.js). Without this, the OPTIONAL
// securityDeposit would wrongly fail type-checking against either shape instead
// of being treated as absent. A required numeric field still correctly fails
// either way.
const blankToUndefined = (value) =>
  value === '' || (typeof value === 'number' && Number.isNaN(value))
    ? undefined
    : value
const numberField = (inner) => z.preprocess(blankToUndefined, inner)

const storageReference = z.object({
  url: required(),
  name: required(),
  type: z.enum(['image', 'pdf', 'doc']),
})

const emergencyContact = z.object({ name: required(), phone: required() })
// `amount` (Sub-stage E, type correction): a real number, same as
// dueDay/monthlyRent/securityDeposit/occupantCount/employmentDuration — the UI
// was already `type="number"` here, the schema was the inconsistency. Mirrors
// web/src/features/onboarding/schema.js's `monthlyIncome`.
const monthlyIncome = z.object({
  source: required(),
  amount: numberField(z.number().min(0)),
})
const previousReference = z.object({ name: required(), phone: required() })
const pets = z.object({ has: z.boolean(), type: optional() })
const vehicle = z.object({
  has: z.boolean(),
  make: optional(),
  plateNumber: optional(),
})
const guarantor = z.object({
  name: required(),
  cnp: required(),
  phone: required(),
  idDocumentPhotos: z.array(storageReference).optional(),
})

// Step 4 — contract data (FR-TEN-05, FR-CON-01). `reportReminderDaysBefore` is a
// real number (arithmetic input for `dailyScheduler`, M6), required with the same
// strictness as `dueDay` — the "default 3 days" (SRS §3.3/§6) is a web form
// default (draftFormDefaults), not a schema default. Mirrors
// web/src/features/onboarding/schema.js's `step4Schema`.
const step4Schema = z.object({
  propertyId: required(),
  startDate: required(),
  endDate: required(),
  monthlyRent: numberField(z.number().min(0)),
  securityDeposit: numberField(z.number().min(0).optional()),
  dueDay: numberField(z.number().min(1).max(31)),
  reportReminderDaysBefore: z.number(),
})

// Steps 1-4 combined, all mandatory — the "brand-new tenant" full contract.
const newTenantFullSchema = z.object({
  // Step 1 — personal data (FR-TEN-02)
  name: required(),
  dateOfBirth: required(),
  cnp: required(),
  phone: required(),
  email: required(),
  preferredLanguage: z.enum(['ro', 'en']),
  mailingAddress: optional(),
  previousAddress: required(),
  emergencyContact,
  occupantCount: numberField(z.number().min(1)),
  smoker: z.boolean(),
  pets,
  vehicle,
  // Step 2 — ID document photos (FR-TEN-03): at least one
  idDocumentPhotos: z.array(storageReference).min(1),
  // Step 3 — financial / professional data (FR-TEN-04)
  employer: required(),
  occupation: required(),
  // employmentDuration (Sub-stage E, semantic change): PURE YEARS as a number.
  employmentDuration: numberField(z.number().min(0)),
  monthlyIncome,
  guarantor,
  previousReference,
  // Step 4 — contract data
  ...step4Schema.shape,
})

// Conditionals (FR-TEN-02): pet type required if has pets; make + plate required
// if has a vehicle. Only relevant to the new-tenant branch (Steps 1-3 apply).
function refineConditionals(data, ctx) {
  if (data.pets?.has && !data.pets.type?.trim()) {
    ctx.addIssue({
      code: 'custom',
      message: 'required',
      path: ['pets', 'type'],
    })
  }
  if (data.vehicle?.has) {
    if (!data.vehicle.make?.trim()) {
      ctx.addIssue({
        code: 'custom',
        message: 'required',
        path: ['vehicle', 'make'],
      })
    }
    if (!data.vehicle.plateNumber?.trim()) {
      ctx.addIssue({
        code: 'custom',
        message: 'required',
        path: ['vehicle', 'plateNumber'],
      })
    }
  }
}

function mergeIssues(ctx, zodError) {
  for (const issue of zodError.issues) {
    ctx.addIssue({ code: 'custom', message: issue.message, path: issue.path })
  }
}

/**
 * The complete draft, for completion (FR-TEN-16) — BRANCHES on `existingUserId`
 * (FR-TEN-07, Sub-stage E), exactly mirroring
 * web/src/features/onboarding/schema.js's `fullDraftSchema`.
 *
 * Built on `z.any()`, NOT a `.partial()`-based loose object: the draft as actually
 * autosaved by the web wizard NEVER omits a key — `draftFormDefaults` pre-fills
 * every field (including nested ones) with `''`, so even on the existingUserId
 * branch a Firestore draft typically HAS `emergencyContact: {name:'', phone:''}`
 * etc. (present, just empty) the moment the admin autosaves from Step 1. A
 * `.partial()` wrapper only allows a field to be ABSENT — a PRESENT empty string
 * still fails the nested `required()`, which would wrongly reject this branch. All
 * real validation lives in `superRefine` instead, dispatched per branch:
 *
 *  - SET → new tenancy on an EXISTING account: only Step 4 is validated.
 *  - ABSENT → unchanged: all of Steps 1-4 mandatory, plus the conditionals.
 */
const fullDraftSchema = z.any().superRefine((data, ctx) => {
  if (data?.existingUserId) {
    const result = step4Schema.safeParse(data)
    if (!result.success) mergeIssues(ctx, result.error)
    return
  }
  const result = newTenantFullSchema.safeParse(data)
  if (!result.success) mergeIssues(ctx, result.error)
  refineConditionals(data, ctx)
})

/**
 * Validates a draft for completion. Returns `{ valid: true, data }` on success, or
 * `{ valid: false, issues }` with the failing field paths, so finalizeKyc can reject
 * with a clear message before touching Auth or Firestore.
 */
function validateFullDraft(draft) {
  const result = fullDraftSchema.safeParse(draft)
  if (result.success) {
    return { valid: true, data: result.data }
  }
  const issues = result.error.issues.map((i) => i.path.join('.') || '(root)')
  return { valid: false, issues }
}

module.exports = { fullDraftSchema, validateFullDraft }
