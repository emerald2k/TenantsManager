import {
  refineConditionals,
  step1Schema,
  step3Schema,
} from '@/features/onboarding/schema'

/**
 * Per-section validation for the tenant Profile tab's inline edit (M3-B,
 * FR-TEN-09/11, presence-only per NFR-VAL-01). These REUSE the onboarding step
 * schemas (`step1Schema`/`step3Schema`) via `.pick()`/`.omit()` — no new
 * validation rules, just a different grouping of the same ones, so the KYC
 * fields stay defined in exactly one place (schema.js). Composed here, not in
 * schema.js itself, because "which fields make up a Profile section" is a
 * tenant-detail UI concern, not a KYC field/rule — schema.js only had to
 * export `refineConditionals` for this file to reuse it (recon decision,
 * M3-B).
 *
 * The wizard's step grouping does not map 1:1 onto the Profile tab's sections
 * (step3 bundles financial + guarantor + previousReference into one step) — the
 * Profile tab splits those into three sections for editing, each independently
 * savable.
 */

/** Personal data — step1 minus `preferredLanguage`, which is its own section
 * (`languageSectionSchema`) per SRS §5.3 ("editable preferred language",
 * distinct from the rest of the KYC profile). The pets/vehicle conditional
 * (FR-TEN-02) is reused via `.superRefine`, not re-declared. */
export const personalSectionSchema = step1Schema
  .omit({ preferredLanguage: true })
  .superRefine(refineConditionals)

/** Preferred language (ro/en) — its own section for the same reason it is its
 * own line item in SRS §5.3. */
export const languageSectionSchema = step1Schema.pick({
  preferredLanguage: true,
})

/** Financial/professional data — the non-guarantor, non-reference part of
 * step3. */
export const financialSectionSchema = step3Schema.pick({
  employer: true,
  occupation: true,
  employmentDuration: true,
  monthlyIncome: true,
})

/** Guarantor — name/cnp/phone (mandatory) + idDocumentPhotos (optional,
 * FR-TEN-04/06); photos are managed by the gallery component, not this form,
 * but the field stays in the picked shape so `.pick()` yields the guarantor
 * object schema unchanged from `step3Schema`. */
export const guarantorSectionSchema = step3Schema.pick({ guarantor: true })

/** Previous reference — name + phone. */
export const previousReferenceSectionSchema = step3Schema.pick({
  previousReference: true,
})
