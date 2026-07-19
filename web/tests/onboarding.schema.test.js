import { describe, expect, it } from 'vitest'
import {
  fullDraftSchema,
  partialDraftSchema,
  step2Schema,
  storageReferenceSchema,
} from '@/features/onboarding/schema'

// A complete, valid draft — every mandatory field present, optionals omitted
// (mailingAddress, securityDeposit, guarantor.idDocumentPhotos). `pets`/`vehicle`
// are "no", so their conditional follow-ups are not required.
const COMPLETE = {
  name: 'Ion Popescu',
  dateOfBirth: '1990-01-01',
  cnp: '1900101123456',
  phone: '0712345678',
  email: 'ion@example.com',
  preferredLanguage: 'ro',
  previousAddress: 'Str. Veche 1',
  emergencyContact: { name: 'Maria', phone: '0700000000' },
  occupantCount: '2',
  smoker: false,
  pets: { has: false },
  vehicle: { has: false },
  idDocumentPhotos: [
    { url: 'gs://bucket/1.jpg', name: 'front.jpg', type: 'image' },
  ],
  employer: 'ACME SRL',
  occupation: 'Engineer',
  employmentDuration: '3 years',
  monthlyIncome: { source: 'salary', amount: '5000' },
  guarantor: { name: 'Gigi', cnp: '1800101123456', phone: '0722222222' },
  previousReference: { name: 'Vlad', phone: '0733333333' },
  propertyId: 'prop-1',
  startDate: '2026-08-01',
  endDate: '2027-08-01',
  monthlyRent: '2000',
  securityDeposit: '2000',
  dueDay: '5',
}

describe('onboarding schema — full validation (completion)', () => {
  it('accepts a complete draft', () => {
    expect(fullDraftSchema.safeParse(COMPLETE).success).toBe(true)
  })

  it('accepts a complete draft with the optionals absent', () => {
    const { mailingAddress, securityDeposit, ...rest } = COMPLETE
    void mailingAddress
    void securityDeposit
    // guarantor.idDocumentPhotos is already absent in COMPLETE
    expect(fullDraftSchema.safeParse(rest).success).toBe(true)
  })

  it('rejects a draft missing a mandatory field', () => {
    const { name, ...withoutName } = COMPLETE
    void name
    expect(fullDraftSchema.safeParse(withoutName).success).toBe(false)
  })

  it('requires the pet type when the tenant has pets (conditional)', () => {
    const withPets = { ...COMPLETE, pets: { has: true } }
    expect(fullDraftSchema.safeParse(withPets).success).toBe(false)
    const withType = { ...COMPLETE, pets: { has: true, type: 'cat' } }
    expect(fullDraftSchema.safeParse(withType).success).toBe(true)
  })

  it('requires make and plate when the tenant has a vehicle (conditional)', () => {
    const withVehicle = { ...COMPLETE, vehicle: { has: true } }
    expect(fullDraftSchema.safeParse(withVehicle).success).toBe(false)
    const complete = {
      ...COMPLETE,
      vehicle: { has: true, make: 'Dacia', plateNumber: 'CJ01ABC' },
    }
    expect(fullDraftSchema.safeParse(complete).success).toBe(true)
  })
})

describe('onboarding schema — required yes/no booleans (undefined-until-chosen)', () => {
  // KYC: an untouched field must stay distinguishable from a deliberate "no". So a
  // required yes/no boolean (smoker, pets.has, vehicle.has — FR-TEN-02, SRS §6) left
  // undefined FAILS full validation (a choice is required) yet PASSES partial (an
  // in-progress draft may not have reached it). An explicit `false` is a valid
  // choice and passes both. These bite if anyone adds `.default(false)`: the default
  // would make "untouched" look like a chosen "no".

  it('smoker: undefined passes partial but fails full', () => {
    const { smoker, ...undecided } = COMPLETE
    void smoker
    expect(partialDraftSchema.safeParse(undecided).success).toBe(true)
    expect(fullDraftSchema.safeParse(undecided).success).toBe(false)
  })

  it('smoker: an explicit false passes both', () => {
    const chosen = { ...COMPLETE, smoker: false }
    expect(partialDraftSchema.safeParse(chosen).success).toBe(true)
    expect(fullDraftSchema.safeParse(chosen).success).toBe(true)
  })

  it('pets.has: undefined passes partial but fails full', () => {
    const undecided = { ...COMPLETE, pets: {} }
    expect(partialDraftSchema.safeParse(undecided).success).toBe(true)
    expect(fullDraftSchema.safeParse(undecided).success).toBe(false)
  })

  it('pets.has: an explicit false passes both', () => {
    const chosen = { ...COMPLETE, pets: { has: false } }
    expect(partialDraftSchema.safeParse(chosen).success).toBe(true)
    expect(fullDraftSchema.safeParse(chosen).success).toBe(true)
  })

  it('vehicle.has: undefined passes partial but fails full', () => {
    const undecided = { ...COMPLETE, vehicle: {} }
    expect(partialDraftSchema.safeParse(undecided).success).toBe(true)
    expect(fullDraftSchema.safeParse(undecided).success).toBe(false)
  })

  it('vehicle.has: an explicit false passes both', () => {
    const chosen = { ...COMPLETE, vehicle: { has: false } }
    expect(partialDraftSchema.safeParse(chosen).success).toBe(true)
    expect(fullDraftSchema.safeParse(chosen).success).toBe(true)
  })
})

describe('onboarding schema — partial validation (autosave)', () => {
  it('accepts an incomplete draft (a subset of step-1 fields)', () => {
    const partial = { name: 'Ion', cnp: '123', preferredLanguage: 'ro' }
    expect(partialDraftSchema.safeParse(partial).success).toBe(true)
  })

  it('accepts a half-filled nested object (name typed, phone not yet)', () => {
    // Exactly what autosave-on-navigation produces mid-entry. A plain top-level
    // partial would reject this — the nested object must be partial too.
    const partial = { emergencyContact: { name: 'Maria' } }
    expect(partialDraftSchema.safeParse(partial).success).toBe(true)
  })

  it('accepts an empty draft', () => {
    expect(partialDraftSchema.safeParse({}).success).toBe(true)
  })

  it('a partial draft passes partial but fails full validation', () => {
    const partial = { name: 'Ion', cnp: '123' }
    expect(partialDraftSchema.safeParse(partial).success).toBe(true)
    expect(fullDraftSchema.safeParse(partial).success).toBe(false)
  })
})

describe('onboarding schema — photo reference shape', () => {
  it('accepts a well-formed reference', () => {
    const ref = { url: 'gs://bucket/x.jpg', name: 'x.jpg', type: 'image' }
    expect(storageReferenceSchema.safeParse(ref).success).toBe(true)
  })

  it('rejects a malformed reference (missing url)', () => {
    const ref = { name: 'x.jpg', type: 'image' }
    expect(storageReferenceSchema.safeParse(ref).success).toBe(false)
  })

  it('rejects a reference with an invalid type', () => {
    const ref = { url: 'gs://bucket/x.jpg', name: 'x.jpg', type: 'video' }
    expect(storageReferenceSchema.safeParse(ref).success).toBe(false)
  })

  it('requires at least one ID photo at step 2 (FR-TEN-03)', () => {
    expect(step2Schema.safeParse({ idDocumentPhotos: [] }).success).toBe(false)
    expect(
      step2Schema.safeParse({
        idDocumentPhotos: [
          { url: 'gs://bucket/1.jpg', name: '1.jpg', type: 'image' },
        ],
      }).success,
    ).toBe(true)
  })
})
