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
