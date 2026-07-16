import { z } from 'zod'

/**
 * Validation schema for the property form (FR-PROP-01).
 *
 * PRESENCE-ONLY (NFR-VAL-01): a mandatory field means strictly "it is not empty".
 * No regex, no min/max on content, no masks. The decision is assumed in the SRS:
 * the admin enters the data personally, face-to-face.
 *
 * `area` and `roomCount` stay strings, not numbers: coercing to a number would
 * reject "abc" — which is exactly the format validation NFR-VAL-01 forbids.
 *
 * The error messages are i18n KEYS, not text (NFR-LOC-01). Translation happens in
 * the component, at display time, so the error follows the active language — text
 * translated here would freeze the language at schema-definition time.
 */

const REQUIRED = 'properties.errors.required'

// `.trim()` does double duty: "   " does not pass as a filled-in value, and the
// value that reaches Firestore is already normalized.
const required = () =>
  z.string({ error: REQUIRED }).trim().min(1, { error: REQUIRED })

const optional = () => z.string().trim().optional()

export const propertySchema = z.object({
  name: required(),
  address: z.object(
    {
      street: required(),
      number: required(),
      city: required(),
      county: required(),
      postalCode: optional(),
    },
    { error: REQUIRED },
  ),
  area: optional(),
  roomCount: optional(),
})

/** The form's initial values (C). All fields controlled from the start, so that
 * React does not flip the inputs from uncontrolled to controlled. */
export const propertyFormDefaults = {
  name: '',
  address: { street: '', number: '', city: '', county: '', postalCode: '' },
  area: '',
  roomCount: '',
}
