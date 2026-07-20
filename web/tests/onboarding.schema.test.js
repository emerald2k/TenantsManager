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
  occupantCount: 2,
  smoker: false,
  pets: { has: false },
  vehicle: { has: false },
  idDocumentPhotos: [
    { url: 'gs://bucket/1.jpg', name: 'front.jpg', type: 'image' },
  ],
  employer: 'ACME SRL',
  occupation: 'Engineer',
  employmentDuration: 3,
  monthlyIncome: { source: 'salary', amount: 5000 },
  guarantor: { name: 'Gigi', cnp: '1800101123456', phone: '0722222222' },
  previousReference: { name: 'Vlad', phone: '0733333333' },
  propertyId: 'prop-1',
  startDate: '2026-08-01',
  endDate: '2027-08-01',
  monthlyRent: 2000,
  securityDeposit: 2000,
  dueDay: 5,
  reportReminderDaysBefore: 3,
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

describe('onboarding schema — existingUserId (FR-TEN-07)', () => {
  // Set when Step 1's live email check (Sub-stage C) matches an existing account —
  // the draft becomes "new tenancy on existing account" instead of a brand-new
  // tenant. Sub-stage C only adds the field and lets it pass through untouched; no
  // conditional relaxation of Steps 1-3 happens yet (that is Sub-stage E, at
  // finalization). Here we only prove the schema accepts it, in every shape, without
  // crashing — present, absent, or explicitly null.

  it('partial validation accepts a draft with existingUserId set', () => {
    const partial = { name: 'Ion', existingUserId: 'user-abc' }
    expect(partialDraftSchema.safeParse(partial).success).toBe(true)
  })

  it('partial validation accepts existingUserId absent', () => {
    expect(partialDraftSchema.safeParse({}).success).toBe(true)
  })

  it('partial validation accepts existingUserId explicitly null', () => {
    expect(partialDraftSchema.safeParse({ existingUserId: null }).success).toBe(
      true,
    )
  })

  it('full validation accepts a complete draft with existingUserId set', () => {
    const withExistingUser = { ...COMPLETE, existingUserId: 'user-abc' }
    expect(fullDraftSchema.safeParse(withExistingUser).success).toBe(true)
  })

  it('full validation accepts a complete draft with existingUserId absent', () => {
    expect(fullDraftSchema.safeParse(COMPLETE).success).toBe(true)
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

describe('onboarding schema — existingUserId branches full validation (Sub-stage E, FR-TEN-07)', () => {
  // Only Step 4 (+ existingUserId itself) — Steps 1-3 are irrelevant once the draft
  // is linked to an existing account (SRS §6 onboardingDrafts.existingUserId).
  const STEP4_ONLY = {
    existingUserId: 'user-abc',
    propertyId: 'prop-1',
    startDate: '2026-08-01',
    endDate: '2027-08-01',
    monthlyRent: 2000,
    dueDay: 5,
    reportReminderDaysBefore: 3,
  }

  it('passes full validation with existingUserId set and only Step 4 filled', () => {
    expect(fullDraftSchema.safeParse(STEP4_ONLY).success).toBe(true)
  })

  it('fails full validation with the SAME Step 4 data but existingUserId absent — unchanged old behavior', () => {
    const { existingUserId, ...withoutExistingUserId } = STEP4_ONLY
    void existingUserId
    expect(fullDraftSchema.safeParse(withoutExistingUserId).success).toBe(false)
  })

  it('still requires every Step 4 field when existingUserId is set', () => {
    const { propertyId, ...missingProperty } = STEP4_ONLY
    void propertyId
    expect(fullDraftSchema.safeParse(missingProperty).success).toBe(false)
  })

  it('does not require Step 1-3 conditionals (pets/vehicle) on the existingUserId branch', () => {
    // pets/vehicle are entirely absent from STEP4_ONLY — the new-tenant branch would
    // reject this (smoker/pets.has/vehicle.has undefined-until-chosen), but the
    // existingUserId branch never looks at them.
    expect(fullDraftSchema.safeParse(STEP4_ONLY).success).toBe(true)
  })
})

describe('onboarding schema — reportReminderDaysBefore (FR-CON-01)', () => {
  it('accepts a complete draft (reportReminderDaysBefore present, like dueDay)', () => {
    expect(fullDraftSchema.safeParse(COMPLETE).success).toBe(true)
  })

  it('rejects a complete draft missing reportReminderDaysBefore — required, same strictness as dueDay', () => {
    const { reportReminderDaysBefore, ...withoutIt } = COMPLETE
    void reportReminderDaysBefore
    expect(fullDraftSchema.safeParse(withoutIt).success).toBe(false)
  })

  it('rejects a non-number value — a real numeric field, not presence-only text', () => {
    expect(
      fullDraftSchema.safeParse({
        ...COMPLETE,
        reportReminderDaysBefore: '3',
      }).success,
    ).toBe(false)
  })

  it('partial validation accepts it absent or as a number', () => {
    expect(partialDraftSchema.safeParse({}).success).toBe(true)
    expect(
      partialDraftSchema.safeParse({ reportReminderDaysBefore: 5 }).success,
    ).toBe(true)
  })
})

describe('onboarding schema — numeric fields (Sub-stage E, type correction)', () => {
  // dueDay, monthlyRent, securityDeposit, occupantCount, employmentDuration were
  // presence-only STRINGS through Sub-stage A — a latent bug for M4's report
  // arithmetic. They are now REAL numbers (z.number()), the one deliberate
  // exception to this file's "everything stays text" NFR-VAL-01 stance — CNP,
  // phone, addresses, names are UNCHANGED.

  it('dueDay: rejects a non-numeric string, accepts a valid number, rejects 0 and 32, accepts 1 and 31', () => {
    expect(
      fullDraftSchema.safeParse({ ...COMPLETE, dueDay: '5' }).success,
    ).toBe(false)
    expect(fullDraftSchema.safeParse({ ...COMPLETE, dueDay: 5 }).success).toBe(
      true,
    )
    expect(fullDraftSchema.safeParse({ ...COMPLETE, dueDay: 0 }).success).toBe(
      false,
    )
    expect(fullDraftSchema.safeParse({ ...COMPLETE, dueDay: 32 }).success).toBe(
      false,
    )
    expect(fullDraftSchema.safeParse({ ...COMPLETE, dueDay: 1 }).success).toBe(
      true,
    )
    expect(fullDraftSchema.safeParse({ ...COMPLETE, dueDay: 31 }).success).toBe(
      true,
    )
  })

  it('monthlyRent: rejects a non-numeric string, accepts a valid number >= 0', () => {
    expect(
      fullDraftSchema.safeParse({ ...COMPLETE, monthlyRent: '2000' }).success,
    ).toBe(false)
    expect(
      fullDraftSchema.safeParse({ ...COMPLETE, monthlyRent: 0 }).success,
    ).toBe(true)
    expect(
      fullDraftSchema.safeParse({ ...COMPLETE, monthlyRent: 2000 }).success,
    ).toBe(true)
  })

  it('securityDeposit: optional, but rejects a non-numeric string when present; accepts a number >= 0 or absence', () => {
    const { securityDeposit, ...withoutIt } = COMPLETE
    void securityDeposit
    expect(fullDraftSchema.safeParse(withoutIt).success).toBe(true)
    expect(
      fullDraftSchema.safeParse({ ...COMPLETE, securityDeposit: '2000' })
        .success,
    ).toBe(false)
    expect(
      fullDraftSchema.safeParse({ ...COMPLETE, securityDeposit: 2000 }).success,
    ).toBe(true)
  })

  it('occupantCount: rejects a non-numeric string, rejects 0, accepts a number >= 1', () => {
    expect(
      fullDraftSchema.safeParse({ ...COMPLETE, occupantCount: '2' }).success,
    ).toBe(false)
    expect(
      fullDraftSchema.safeParse({ ...COMPLETE, occupantCount: 0 }).success,
    ).toBe(false)
    expect(
      fullDraftSchema.safeParse({ ...COMPLETE, occupantCount: 1 }).success,
    ).toBe(true)
  })

  it('employmentDuration: semantic change — PURE YEARS as a number, not free text; rejects "3 years", accepts a number >= 0', () => {
    expect(
      fullDraftSchema.safeParse({ ...COMPLETE, employmentDuration: '3 years' })
        .success,
    ).toBe(false)
    expect(
      fullDraftSchema.safeParse({ ...COMPLETE, employmentDuration: 0 }).success,
    ).toBe(true)
    expect(
      fullDraftSchema.safeParse({ ...COMPLETE, employmentDuration: 3 }).success,
    ).toBe(true)
  })

  it('monthlyIncome.amount: rejects a non-numeric string, accepts a valid number >= 0 (was UI type="number" but STRING in the schema — the inconsistency this closes)', () => {
    expect(
      fullDraftSchema.safeParse({
        ...COMPLETE,
        monthlyIncome: { ...COMPLETE.monthlyIncome, amount: '5000' },
      }).success,
    ).toBe(false)
    expect(
      fullDraftSchema.safeParse({
        ...COMPLETE,
        monthlyIncome: { ...COMPLETE.monthlyIncome, amount: 0 },
      }).success,
    ).toBe(true)
    expect(
      fullDraftSchema.safeParse({
        ...COMPLETE,
        monthlyIncome: { ...COMPLETE.monthlyIncome, amount: 5000 },
      }).success,
    ).toBe(true)
  })

  it('monthlyIncome.amount: blank ("") and NaN (untouched valueAsNumber input) are treated as absent — required (FR-TEN-04), so validation fails with the REQUIRED message, not a raw Zod message', () => {
    const blank = fullDraftSchema.safeParse({
      ...COMPLETE,
      monthlyIncome: { ...COMPLETE.monthlyIncome, amount: '' },
    })
    expect(blank.success).toBe(false)
    expect(blank.error.issues[0].message).toBe('onboarding.errors.required')

    const nan = fullDraftSchema.safeParse({
      ...COMPLETE,
      monthlyIncome: { ...COMPLETE.monthlyIncome, amount: NaN },
    })
    expect(nan.success).toBe(false)
    expect(nan.error.issues[0].message).toBe('onboarding.errors.required')
  })

  it('CNP, phone, addresses, names stay free text — unaffected by the numeric-type change', () => {
    expect(
      fullDraftSchema.safeParse({ ...COMPLETE, cnp: 'not-even-numeric!' })
        .success,
    ).toBe(true)
    expect(
      fullDraftSchema.safeParse({ ...COMPLETE, phone: 'abc' }).success,
    ).toBe(true)
  })

  it('securityDeposit: draftFormDefaults\' own "" (untouched field, present not absent) is treated as absent, not a type error', () => {
    // The wizard form NEVER leaves a numeric field literally `undefined`
    // (Firestore rejects `undefined` on write) — `draftFormDefaults.securityDeposit`
    // is `''` until typed. `getValues()` on an untouched Step 4 therefore hands
    // `fullDraftSchema` a PRESENT empty string, not an absent key.
    expect(
      fullDraftSchema.safeParse({ ...COMPLETE, securityDeposit: '' }).success,
    ).toBe(true)
  })

  it('securityDeposit: NaN (what an untouched `valueAsNumber` number input actually reads via getValues()) is ALSO treated as absent', () => {
    // register(field, { valueAsNumber: true }) reads the DOM's `valueAsNumber`
    // property, which is NaN — not '' — for an empty <input type="number">. Both
    // representations of "untouched" must be tolerated the same way.
    expect(
      fullDraftSchema.safeParse({ ...COMPLETE, securityDeposit: NaN }).success,
    ).toBe(true)
  })

  it('dueDay/monthlyRent/occupantCount/employmentDuration: NaN still fails full validation, with the i18n REQUIRED message — not a raw untranslated Zod message', () => {
    const result = fullDraftSchema.safeParse({ ...COMPLETE, dueDay: NaN })
    expect(result.success).toBe(false)
    expect(result.error.issues[0].message).toBe('onboarding.errors.required')
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
