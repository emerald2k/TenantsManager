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
 * phone, email accept any non-empty string. Numeric-looking fields stay strings.
 */

const required = () => z.string().trim().min(1)
const optional = () => z.string().trim().optional()

const storageReference = z.object({
  url: required(),
  name: required(),
  type: z.enum(['image', 'pdf', 'doc']),
})

const emergencyContact = z.object({ name: required(), phone: required() })
const monthlyIncome = z.object({ source: required(), amount: required() })
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

// The four steps, flat (SRS §6). `name` is the full name, per §6.
const fullDraftSchema = z
  .object({
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
    occupantCount: required(),
    smoker: z.boolean(),
    pets,
    vehicle,
    // Step 2 — ID document photos (FR-TEN-03): at least one
    idDocumentPhotos: z.array(storageReference).min(1),
    // Step 3 — financial / professional data (FR-TEN-04)
    employer: required(),
    occupation: required(),
    employmentDuration: required(),
    monthlyIncome,
    guarantor,
    previousReference,
    // Step 4 — contract data (FR-TEN-05, FR-CON-01)
    propertyId: required(),
    startDate: required(),
    endDate: required(),
    monthlyRent: required(),
    securityDeposit: optional(),
    dueDay: required(),
    // existingUserId (FR-TEN-07): set when the draft is a new tenancy on an existing
    // account (matched by email at Step 1, web Sub-stage C), instead of a brand-new
    // tenant. Mirrors web/src/features/onboarding/schema.js — field only, no
    // business logic yet: the conditional handling (skip re-KYC, jump to Step 4) is
    // Sub-stage E's job, at finalization.
    existingUserId: z.string().nullable().optional(),
  })
  .superRefine((data, ctx) => {
    // Conditionals (FR-TEN-02): pet type required if has pets; make + plate required
    // if has a vehicle.
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
