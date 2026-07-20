import { describe, expect, it } from 'vitest'
import { fullDraftSchema } from '../src/draftValidation.js'

// Pure Zod schema — no emulator needed, but it runs fine under test:emulator too
// (the glob picks up every test/**/*.test.js file regardless).

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

describe('draftValidation — existingUserId (FR-TEN-07)', () => {
  it('accepts a complete draft with existingUserId set', () => {
    const withExistingUser = { ...COMPLETE, existingUserId: 'user-abc' }
    expect(fullDraftSchema.safeParse(withExistingUser).success).toBe(true)
  })

  it('accepts a complete draft with existingUserId absent (optional)', () => {
    expect(fullDraftSchema.safeParse(COMPLETE).success).toBe(true)
  })

  it('accepts existingUserId explicitly null', () => {
    const withNull = { ...COMPLETE, existingUserId: null }
    expect(fullDraftSchema.safeParse(withNull).success).toBe(true)
  })
})

describe('draftValidation — existingUserId branches full validation (Sub-stage E)', () => {
  // Mirrors web/tests/onboarding.schema.test.js — the SAME cases, both files
  // tested against them so drift surfaces as a failing test (CLAUDE.md §7).
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

  it('fails full validation with the SAME Step 4 data but existingUserId absent', () => {
    const { existingUserId, ...withoutExistingUserId } = STEP4_ONLY
    void existingUserId
    expect(fullDraftSchema.safeParse(withoutExistingUserId).success).toBe(false)
  })

  it('still requires every Step 4 field when existingUserId is set', () => {
    const { propertyId, ...missingProperty } = STEP4_ONLY
    void propertyId
    expect(fullDraftSchema.safeParse(missingProperty).success).toBe(false)
  })
})

describe('draftValidation — reportReminderDaysBefore (FR-CON-01)', () => {
  it('accepts a complete draft (reportReminderDaysBefore present)', () => {
    expect(fullDraftSchema.safeParse(COMPLETE).success).toBe(true)
  })

  it('rejects a complete draft missing reportReminderDaysBefore', () => {
    const { reportReminderDaysBefore, ...withoutIt } = COMPLETE
    void reportReminderDaysBefore
    expect(fullDraftSchema.safeParse(withoutIt).success).toBe(false)
  })

  it('rejects a non-number value', () => {
    expect(
      fullDraftSchema.safeParse({
        ...COMPLETE,
        reportReminderDaysBefore: '3',
      }).success,
    ).toBe(false)
  })
})

describe('draftValidation — numeric fields (Sub-stage E, type correction, mirrors web/tests/onboarding.schema.test.js)', () => {
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

  it('monthlyIncome.amount: rejects a non-numeric string, accepts a valid number >= 0', () => {
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

  it('monthlyIncome.amount: blank ("") and NaN are treated as absent — required, so validation still fails', () => {
    expect(
      fullDraftSchema.safeParse({
        ...COMPLETE,
        monthlyIncome: { ...COMPLETE.monthlyIncome, amount: '' },
      }).success,
    ).toBe(false)
    expect(
      fullDraftSchema.safeParse({
        ...COMPLETE,
        monthlyIncome: { ...COMPLETE.monthlyIncome, amount: NaN },
      }).success,
    ).toBe(false)
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

  it('securityDeposit: a real Firestore draft can carry "" (draftFormDefaults, untouched field) — treated as absent, not a type error', () => {
    // The web wizard NEVER omits a key on autosave — an untouched optional
    // numeric field is PRESENT as `''`, not absent. The server must tolerate
    // exactly what the client actually writes.
    expect(
      fullDraftSchema.safeParse({ ...COMPLETE, securityDeposit: '' }).success,
    ).toBe(true)
  })

  it('securityDeposit: NaN (what an untouched valueAsNumber input writes if ever autosaved as-is) is ALSO treated as absent', () => {
    expect(
      fullDraftSchema.safeParse({ ...COMPLETE, securityDeposit: NaN }).success,
    ).toBe(true)
  })
})
