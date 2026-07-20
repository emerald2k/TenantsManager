import { z } from 'zod'

/**
 * Validation schema for the onboarding draft (FR-TEN-01…08, FR-CON-01, SRS §6).
 *
 * PRESENCE-ONLY (NFR-VAL-01): a mandatory field means strictly "it is not empty".
 * No regex, no masks — `cnp`, `phone`, `email` accept any non-empty string. The
 * numeric-looking fields (occupantCount, monthlyRent, dueDay, income amount) stay
 * strings for the same reason M1 kept `area`/`roomCount` as strings: coercing to a
 * number would reject "abc", which is exactly the format validation NFR-VAL-01
 * forbids.
 *
 * The field names come VERBATIM from SRS §6 (the `users` + tenancy model), so the
 * eventual finalizeKyc transfer (draft → users/tenancies) is a straight copy. The
 * draft shape is FLAT — the step-4 contract fields sit alongside the step-1 fields;
 * the only nesting is what §6 itself nests (emergencyContact, pets, vehicle,
 * monthlyIncome, guarantor, previousReference). `name` is the full name, per §6 —
 * not `fullName`; the three `name`s never collide, each lives in its own object.
 *
 * TWO MODES:
 *  - `partialDraftSchema` — for autosave between steps (FR-TEN-17): an incomplete
 *    draft is valid, including a half-filled nested object, which is exactly what
 *    autosave-on-navigation produces.
 *  - `fullDraftSchema` — for completion (FR-TEN-16): every mandatory field present.
 *
 * The error messages are i18n KEYS, not text (NFR-LOC-01); the component translates
 * them at display time so the error follows the active language.
 */

const REQUIRED = 'onboarding.errors.required'

// `.trim()` does double duty: "   " does not pass as filled, and the value that
// reaches Firestore is already normalized.
const required = () =>
  z.string({ error: REQUIRED }).trim().min(1, { error: REQUIRED })

const optional = () => z.string().trim().optional()

// Genuinely numeric fields (Sub-stage E, type correction — dueDay, monthlyRent,
// securityDeposit, occupantCount, employmentDuration): unlike the rest of this
// file, these are NOT presence-only text — they are arithmetic inputs (M4's
// report totals, FR-PROP-11's countdown, FR-CON-01's contract terms), so a real
// type check belongs here. Still no upper-bound format policing beyond what the
// field's own domain requires (dueDay: a calendar day 1-31).
//
// `numberField` preprocesses "untouched" → `undefined` before the real check
// runs. "Untouched" has TWO possible shapes reaching here, both needing the same
// treatment:
//  - `''` — the raw `draftFormDefaults` value (Firestore-safety: autosave would
//    crash writing a literal `undefined`, see the note on `draftFormDefaults`).
//  - `NaN` — what `getValues()` ACTUALLY returns once the field is registered
//    with `valueAsNumber: true` (StepContract/StepPersonal/StepFinancial):  RHF
//    reads the DOM's `valueAsNumber` property for such fields, which is `NaN`
//    (not `''`) for an empty `<input type="number">`, per the HTML spec.
// Without this, an untouched OPTIONAL numeric field (`securityDeposit`) would
// wrongly FAIL type-checking instead of being treated as absent. A REQUIRED
// numeric field fails validation either way — the point here is only that it
// fails with OUR `REQUIRED` i18n message, not Zod's raw untranslated one.
const blankToUndefined = (value) =>
  value === '' || (typeof value === 'number' && Number.isNaN(value))
    ? undefined
    : value
const numberField = (inner) => z.preprocess(blankToUndefined, inner)

/**
 * A photo reference (Step 2 / guarantor). The SAME shape as the SRS §6 attachments
 * — `{ url, name, type }`, a Storage reference, NOT a file. The photos are uploaded
 * to /drafts/{draftId}/ as they are taken (Sub-stage D); the draft only ever holds
 * these references. The schema validates the reference's shape.
 */
export const storageReferenceSchema = z.object({
  url: required(),
  name: required(),
  type: z.enum(['image', 'pdf', 'doc'], { error: REQUIRED }),
})

// The objects §6 nests. Defined once so the partial mode can reuse them via
// `.partial()`, instead of re-declaring a looser copy.
const emergencyContact = z.object({ name: required(), phone: required() })
// `amount` (Sub-stage E, type correction): a real number, same as
// dueDay/monthlyRent/securityDeposit/occupantCount/employmentDuration — the UI
// was already `type="number"` here, the schema was the inconsistency.
const monthlyIncome = z.object({
  source: required(),
  amount: numberField(
    z.number({ error: REQUIRED }).min(0, { error: REQUIRED }),
  ),
})
const previousReference = z.object({ name: required(), phone: required() })

// `has` is a boolean with no default: undefined-until-chosen, so full validation
// forces an explicit yes/no rather than silently assuming "no". `type` / `make` /
// `plateNumber` are conditionally required — enforced by the refinement below, not
// here, so the base object stays reusable for the partial mode.
const pets = z.object({ has: z.boolean({ error: REQUIRED }), type: optional() })
const vehicle = z.object({
  has: z.boolean({ error: REQUIRED }),
  make: optional(),
  plateNumber: optional(),
})

const guarantor = z.object({
  name: required(),
  cnp: required(),
  phone: required(),
  // Guarantor ID photos are optional, non-blocking (FR-TEN-04, FR-TEN-06).
  idDocumentPhotos: z.array(storageReferenceSchema).optional(),
})

// ── Per-step FULL schemas (the building blocks that compose the full draft) ──

/** Step 1 — personal data (FR-TEN-02). `mailingAddress` optional (FR-TEN-06). */
export const step1Schema = z.object({
  name: required(),
  dateOfBirth: required(),
  cnp: required(),
  phone: required(),
  email: required(),
  preferredLanguage: z.enum(['ro', 'en'], { error: REQUIRED }),
  mailingAddress: optional(),
  previousAddress: required(),
  emergencyContact,
  occupantCount: numberField(
    z.number({ error: REQUIRED }).min(1, { error: REQUIRED }),
  ),
  smoker: z.boolean({ error: REQUIRED }),
  pets,
  vehicle,
})

/** Step 2 — ID document photos (FR-TEN-03): at least one mandatory. */
export const step2Schema = z.object({
  idDocumentPhotos: z.array(storageReferenceSchema).min(1, { error: REQUIRED }),
})

/**
 * Step 3 — financial / professional data (FR-TEN-04).
 *
 * `employmentDuration` (Sub-stage E, semantic change): PURE YEARS of seniority as
 * a number, not free text ("3 years") — the UI label changes to "Vechime (ani)"
 * to match.
 */
export const step3Schema = z.object({
  employer: required(),
  occupation: required(),
  employmentDuration: numberField(
    z.number({ error: REQUIRED }).min(0, { error: REQUIRED }),
  ),
  monthlyIncome,
  guarantor,
  previousReference,
})

/**
 * Step 4 — contract data (FR-TEN-05, FR-CON-01). `securityDeposit` optional.
 *
 * `reportReminderDaysBefore` is a REAL number, not presence-only text like the
 * rest of this file (NFR-VAL-01 exempts nothing else): it is arithmetic input for
 * `dailyScheduler` (M6), not free text that happens to look numeric. Required with
 * the same strictness as `dueDay` — the "default 3 days" from SRS §3.3/§6 is a
 * FORM default (`draftFormDefaults`, below), not a schema default: the wizard
 * pre-fills the field with 3, editable, so it is never actually empty in practice.
 */
export const step4Schema = z.object({
  propertyId: required(),
  startDate: required(),
  endDate: required(),
  monthlyRent: numberField(
    z.number({ error: REQUIRED }).min(0, { error: REQUIRED }),
  ),
  securityDeposit: numberField(
    z.number().min(0, { error: REQUIRED }).optional(),
  ),
  dueDay: numberField(
    z
      .number({ error: REQUIRED })
      .min(1, { error: REQUIRED })
      .max(31, { error: REQUIRED }),
  ),
  reportReminderDaysBefore: z.number({ error: REQUIRED }),
})

/**
 * The conditional rules that a flat object shape cannot express on its own: if the
 * tenant HAS pets, the type is required; if they HAVE a vehicle, the make and plate
 * are required (FR-TEN-02). Applied only to the full schema — a draft mid-entry is
 * allowed to have `has: true` without the follow-up yet.
 */
function refineConditionals(data, ctx) {
  if (data.pets?.has && !data.pets.type?.trim()) {
    ctx.addIssue({
      code: 'custom',
      message: REQUIRED,
      path: ['pets', 'type'],
    })
  }
  if (data.vehicle?.has) {
    if (!data.vehicle.make?.trim()) {
      ctx.addIssue({
        code: 'custom',
        message: REQUIRED,
        path: ['vehicle', 'make'],
      })
    }
    if (!data.vehicle.plateNumber?.trim()) {
      ctx.addIssue({
        code: 'custom',
        message: REQUIRED,
        path: ['vehicle', 'plateNumber'],
      })
    }
  }
}

/**
 * `existingUserId` (FR-TEN-07): set when the draft represents a NEW TENANCY ON AN
 * EXISTING ACCOUNT (matched by email at Step 1), instead of a brand-new tenant.
 * `null` is the "not applicable" default — NOT the same as `undefined` (absent):
 * Firestore stores `null` explicitly, so a draft always carries the field once
 * created, and its presence is unambiguous from the very first read.
 */
const existingUserIdField = z.string().nullable().optional()

/**
 * The autosave schema: every field optional, and every nested object partial too,
 * so a half-filled `emergencyContact` (name typed, phone not yet) still validates.
 * A plain top-level `.partial()` would leave the nested objects validated in full
 * and break autosave the moment a nested object is touched but not finished.
 *
 * NOTE: `.partial()` only makes a nested field ABSENT-able — a PRESENT value still
 * has to satisfy its own validator (`required()` = non-empty after trim). That is
 * exactly right for autosave (Firestore omits untouched fields entirely), but it
 * is why `fullDraftSchema` (below) is NOT built on top of this schema: the live
 * wizard form's `getValues()` never omits a key — `draftFormDefaults` pre-fills
 * every field, including nested ones, with `''`, which is PRESENT-but-empty and
 * would fail here even on the existingUserId branch where Steps 1-3 do not matter.
 */
export const partialDraftSchema = z.object({
  name: optional(),
  dateOfBirth: optional(),
  cnp: optional(),
  phone: optional(),
  email: optional(),
  preferredLanguage: z.enum(['ro', 'en']).optional(),
  mailingAddress: optional(),
  previousAddress: optional(),
  emergencyContact: emergencyContact.partial().optional(),
  occupantCount: numberField(z.number().optional()),
  smoker: z.boolean().optional(),
  pets: pets.partial().optional(),
  vehicle: vehicle.partial().optional(),
  idDocumentPhotos: z.array(storageReferenceSchema).optional(),
  employer: optional(),
  occupation: optional(),
  employmentDuration: numberField(z.number().optional()),
  monthlyIncome: monthlyIncome.partial().optional(),
  guarantor: guarantor.partial().optional(),
  previousReference: previousReference.partial().optional(),
  propertyId: optional(),
  startDate: optional(),
  endDate: optional(),
  monthlyRent: numberField(z.number().optional()),
  securityDeposit: numberField(z.number().optional()),
  dueDay: numberField(z.number().optional()),
  reportReminderDaysBefore: z.number().optional(),
  existingUserId: existingUserIdField,
})

/** Steps 1-4 combined, all mandatory — the "brand-new tenant" full contract. */
const newTenantFullSchema = step1Schema
  .extend(step2Schema.shape)
  .extend(step3Schema.shape)
  .extend(step4Schema.shape)

// Re-emits a failed sub-schema's issues onto the outer `ctx`, as `code: 'custom'`
// — the same shape the hand-written conditional issues below already use, so
// `setError(issue.path.join('.'), ...)` in OnboardingWizardPage treats every
// error uniformly regardless of which branch produced it.
function mergeIssues(ctx, zodError) {
  for (const issue of zodError.issues) {
    ctx.addIssue({ code: 'custom', message: issue.message, path: issue.path })
  }
}

/**
 * The complete draft, for completion (FR-TEN-16) — BRANCHES on `existingUserId`
 * (FR-TEN-07, Sub-stage E):
 *
 *  - SET → the draft is a new tenancy on an EXISTING account: Steps 1-3 (the KYC
 *    fields) are irrelevant — re-entering them would duplicate data already on the
 *    account. Only Step 4 (contract) is validated.
 *  - ABSENT → unchanged from Sub-stage A: all of Steps 1-4 are mandatory, plus the
 *    pets/vehicle conditionals.
 *
 * Built on `z.any()` — NOT `partialDraftSchema` (see the note on it above) — so the
 * base parse imposes ZERO per-field constraints; ALL validation happens inside
 * `superRefine`, which re-runs the STRICT sub-schema for whichever branch applies
 * and folds its issues back in. This is what lets a single
 * `fullDraftSchema.safeParse(getValues())` call site work for BOTH branches
 * against the wizard's always-fully-keyed form values (OnboardingWizardPage's
 * `validateStep`, `StepContract`, `functions/kyc.js`'s mirror).
 */
export const fullDraftSchema = z.any().superRefine((data, ctx) => {
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
 * Initial values for the wizard form (Sub-stage C). Every field controlled from the
 * start so React does not flip inputs between uncontrolled and controlled. The
 * booleans start `undefined` (undefined-until-chosen), matching the full schema.
 */
export const draftFormDefaults = {
  name: '',
  dateOfBirth: '',
  cnp: '',
  phone: '',
  email: '',
  preferredLanguage: undefined,
  mailingAddress: '',
  previousAddress: '',
  emergencyContact: { name: '', phone: '' },
  occupantCount: '',
  smoker: undefined,
  pets: { has: undefined, type: '' },
  vehicle: { has: undefined, make: '', plateNumber: '' },
  idDocumentPhotos: [],
  employer: '',
  occupation: '',
  employmentDuration: '',
  monthlyIncome: { source: '', amount: '' },
  guarantor: { name: '', cnp: '', phone: '', idDocumentPhotos: [] },
  previousReference: { name: '', phone: '' },
  propertyId: '',
  startDate: '',
  endDate: '',
  monthlyRent: '',
  securityDeposit: '',
  dueDay: '',
  // The one field that starts NON-empty (SRS §3.3/§6: "default 3 days") — the
  // wizard pre-fills it, editable, rather than forcing the admin to type it.
  reportReminderDaysBefore: 3,
  existingUserId: null,
}
