import { describe, expect, it } from 'vitest'
import {
  financialSectionSchema,
  guarantorSectionSchema,
  languageSectionSchema,
  personalSectionSchema,
  previousReferenceSectionSchema,
} from '@/features/tenants/profileSchema'

// The tenant Profile tab (M3-B, FR-TEN-09/11) edits KYC data section by section.
// These schemas REUSE the onboarding step schemas via .pick()/.omit() (recon
// decision: no new validation rules, just a different composition of the same
// ones) — so what is tested here is the COMPOSITION, not the underlying rules
// (those are already covered by onboarding.schema.test.js).

const validPersonal = {
  name: 'Ana Pop',
  dateOfBirth: '1990-01-01',
  cnp: '1234567890123',
  phone: '0712000111',
  email: 'ana@example.com',
  mailingAddress: '',
  previousAddress: 'Str. Veche 1',
  emergencyContact: { name: 'Ion Pop', phone: '0722000111' },
  occupantCount: 2,
  smoker: false,
  pets: { has: false, type: '' },
  vehicle: { has: false, make: '', plateNumber: '' },
}

describe('personalSectionSchema', () => {
  it('accepts a fully filled personal section (no preferredLanguage field)', () => {
    const result = personalSectionSchema.safeParse(validPersonal)
    expect(result.success).toBe(true)
    expect(result.data).not.toHaveProperty('preferredLanguage')
  })

  it('rejects a mandatory field left empty (presence-only, NFR-VAL-01)', () => {
    const result = personalSectionSchema.safeParse({
      ...validPersonal,
      name: '',
    })
    expect(result.success).toBe(false)
  })

  it('requires the pet type when pets.has is true (FR-TEN-02 conditional, reused via refineConditionals)', () => {
    const missing = personalSectionSchema.safeParse({
      ...validPersonal,
      pets: { has: true, type: '' },
    })
    expect(missing.success).toBe(false)

    const filled = personalSectionSchema.safeParse({
      ...validPersonal,
      pets: { has: true, type: 'Câine' },
    })
    expect(filled.success).toBe(true)
  })

  it('requires vehicle make + plate when vehicle.has is true', () => {
    const missing = personalSectionSchema.safeParse({
      ...validPersonal,
      vehicle: { has: true, make: '', plateNumber: '' },
    })
    expect(missing.success).toBe(false)

    const filled = personalSectionSchema.safeParse({
      ...validPersonal,
      vehicle: { has: true, make: 'Dacia', plateNumber: 'CJ01ABC' },
    })
    expect(filled.success).toBe(true)
  })
})

describe('languageSectionSchema', () => {
  it('accepts ro/en', () => {
    expect(
      languageSectionSchema.safeParse({ preferredLanguage: 'ro' }).success,
    ).toBe(true)
    expect(
      languageSectionSchema.safeParse({ preferredLanguage: 'en' }).success,
    ).toBe(true)
  })

  it('rejects an unrecognized language', () => {
    expect(
      languageSectionSchema.safeParse({ preferredLanguage: 'fr' }).success,
    ).toBe(false)
  })
})

describe('financialSectionSchema', () => {
  const valid = {
    employer: 'SC Exemplu SRL',
    occupation: 'Contabil',
    employmentDuration: 3,
    monthlyIncome: { source: 'Salariu', amount: 3000 },
  }

  it('accepts a fully filled financial section', () => {
    expect(financialSectionSchema.safeParse(valid).success).toBe(true)
  })

  it('rejects a mandatory field left empty', () => {
    expect(
      financialSectionSchema.safeParse({ ...valid, employer: '' }).success,
    ).toBe(false)
  })
})

describe('guarantorSectionSchema', () => {
  it('accepts a valid guarantor, with idDocumentPhotos optional', () => {
    const result = guarantorSectionSchema.safeParse({
      guarantor: { name: 'Maria Ionescu', cnp: '9876543210123', phone: '0733' },
    })
    expect(result.success).toBe(true)
  })

  it('rejects a missing mandatory guarantor field', () => {
    const result = guarantorSectionSchema.safeParse({
      guarantor: { name: '', cnp: '9876543210123', phone: '0733' },
    })
    expect(result.success).toBe(false)
  })
})

describe('previousReferenceSectionSchema', () => {
  it('accepts a valid previous reference', () => {
    const result = previousReferenceSectionSchema.safeParse({
      previousReference: { name: 'Vasile Pop', phone: '0744' },
    })
    expect(result.success).toBe(true)
  })

  it('rejects a missing mandatory field', () => {
    const result = previousReferenceSectionSchema.safeParse({
      previousReference: { name: '', phone: '0744' },
    })
    expect(result.success).toBe(false)
  })
})
