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
const monthlyIncome = z.object({ source: required(), amount: required() })
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
  occupantCount: required(),
  smoker: z.boolean({ error: REQUIRED }),
  pets,
  vehicle,
})

/** Step 2 — ID document photos (FR-TEN-03): at least one mandatory. */
export const step2Schema = z.object({
  idDocumentPhotos: z.array(storageReferenceSchema).min(1, { error: REQUIRED }),
})

/** Step 3 — financial / professional data (FR-TEN-04). */
export const step3Schema = z.object({
  employer: required(),
  occupation: required(),
  employmentDuration: required(),
  monthlyIncome,
  guarantor,
  previousReference,
})

/** Step 4 — contract data (FR-TEN-05, FR-CON-01). `securityDeposit` optional. */
export const step4Schema = z.object({
  propertyId: required(),
  startDate: required(),
  endDate: required(),
  monthlyRent: required(),
  securityDeposit: optional(),
  dueDay: required(),
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

/** The complete draft: all four steps, all mandatory fields, the conditionals. */
export const fullDraftSchema = step1Schema
  .extend(step2Schema.shape)
  .extend(step3Schema.shape)
  .extend(step4Schema.shape)
  .superRefine(refineConditionals)

/**
 * The autosave schema: every field optional, and every nested object partial too,
 * so a half-filled `emergencyContact` (name typed, phone not yet) still validates.
 * A plain top-level `.partial()` would leave the nested objects validated in full
 * and break autosave the moment a nested object is touched but not finished.
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
  occupantCount: optional(),
  smoker: z.boolean().optional(),
  pets: pets.partial().optional(),
  vehicle: vehicle.partial().optional(),
  idDocumentPhotos: z.array(storageReferenceSchema).optional(),
  employer: optional(),
  occupation: optional(),
  employmentDuration: optional(),
  monthlyIncome: monthlyIncome.partial().optional(),
  guarantor: guarantor.partial().optional(),
  previousReference: previousReference.partial().optional(),
  propertyId: optional(),
  startDate: optional(),
  endDate: optional(),
  monthlyRent: optional(),
  securityDeposit: optional(),
  dueDay: optional(),
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
}
