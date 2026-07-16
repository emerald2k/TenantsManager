import { describe, expect, it } from 'vitest'
import {
  propertyFormDefaults,
  propertySchema,
} from '@/features/properties/schema'

// Pure unit tests: the schema touches neither the DOM nor Firestore.
// Covers FR-PROP-01 (what is mandatory) and NFR-VAL-01 (presence only).

const VALID_PROPERTY = {
  name: 'Downtown Apartment',
  address: {
    street: 'Mihai Viteazu',
    number: '10',
    city: 'Cluj-Napoca',
    county: 'Cluj',
  },
}

/** The i18n error keys, by field — e.g. { 'address.city': 'properties.errors.required' } */
function errors(result) {
  return Object.fromEntries(
    result.error.issues.map((issue) => [issue.path.join('.'), issue.message]),
  )
}

const REQUIRED_FIELDS = [
  'name',
  'address.street',
  'address.number',
  'address.city',
  'address.county',
]

function without(fieldPath) {
  const copy = structuredClone(VALID_PROPERTY)
  const [parent, child] = fieldPath.split('.')
  if (child) delete copy[parent][child]
  else delete copy[parent]
  return copy
}

describe('propertySchema — mandatory fields (FR-PROP-01)', () => {
  it('accepts a complete property', () => {
    const result = propertySchema.safeParse(VALID_PROPERTY)

    expect(result.success).toBe(true)
  })

  it.each(REQUIRED_FIELDS)('rejects a missing %s', (fieldPath) => {
    const result = propertySchema.safeParse(without(fieldPath))

    expect(result.success).toBe(false)
    expect(errors(result)[fieldPath]).toBe('properties.errors.required')
  })

  it.each(REQUIRED_FIELDS)('rejects an empty %s', (fieldPath) => {
    const copy = structuredClone(VALID_PROPERTY)
    const [parent, child] = fieldPath.split('.')
    if (child) copy[parent][child] = ''
    else copy[parent] = ''

    const result = propertySchema.safeParse(copy)

    expect(result.success).toBe(false)
    expect(errors(result)[fieldPath]).toBe('properties.errors.required')
  })

  it('rejects a field filled with whitespace only', () => {
    const result = propertySchema.safeParse({
      ...VALID_PROPERTY,
      name: '   ',
    })

    expect(result.success).toBe(false)
    expect(errors(result).name).toBe('properties.errors.required')
  })
})

describe('propertySchema — optional fields (FR-PROP-01)', () => {
  it.each(['postalCode', 'area', 'roomCount'])('accepts a missing %s', () => {
    // VALID_PROPERTY contains none of the three.
    expect(propertySchema.safeParse(VALID_PROPERTY).success).toBe(true)
  })

  it('accepts the optional fields filled in', () => {
    const result = propertySchema.safeParse({
      ...VALID_PROPERTY,
      address: { ...VALID_PROPERTY.address, postalCode: '400001' },
      area: '65',
      roomCount: '3',
    })

    expect(result.success).toBe(true)
  })
})

describe('propertySchema — presence only, no format (NFR-VAL-01)', () => {
  // Each case would fail if someone added a regex/min/max on content.
  it.each([
    ['a non-numeric area', { area: 'abc' }],
    ['a non-numeric room count', { roomCount: 'three' }],
    [
      'a postal code of any shape',
      { address: { ...VALID_PROPERTY.address, postalCode: 'xyz' } },
    ],
    ['a single-character name', { name: 'A' }],
    [
      'a street number with letters',
      { address: { ...VALID_PROPERTY.address, number: '10-bis/A' } },
    ],
  ])('accepts %s', (_description, override) => {
    const result = propertySchema.safeParse({
      ...VALID_PROPERTY,
      ...override,
    })

    expect(result.success).toBe(true)
  })
})

describe('propertySchema — messages as i18n keys (NFR-LOC-01)', () => {
  it('produces i18n keys, not translated text', () => {
    const result = propertySchema.safeParse({})

    // If the schema returned "Câmp obligatoriu", the error would be frozen in RO.
    for (const message of Object.values(errors(result))) {
      expect(message).toBe('properties.errors.required')
    }
  })
})

describe('propertyFormDefaults', () => {
  it('does not pass validation — these are starting values, not valid data', () => {
    expect(propertySchema.safeParse(propertyFormDefaults).success).toBe(false)
  })

  it('covers every field of the schema, so the inputs are controlled from the start', () => {
    expect(propertyFormDefaults).toEqual({
      name: '',
      address: { street: '', number: '', city: '', county: '', postalCode: '' },
      area: '',
      roomCount: '',
    })
  })
})
