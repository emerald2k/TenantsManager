import { describe, expect, it } from 'vitest'
import { buildAssignmentEmail } from '../src/mail-templates/assignment.js'

// Template A7 (SRS Appendix A) — sent instead of A1 when finalizeKyc's
// existing-tenant branch runs (FR-TEN-07): no password, since no Auth account is
// created on that branch. Same `mail` document shape as buildCredentialsEmail
// (SRS §5.7, the "Trigger Email" extension contract).

const FIELDS = {
  name: 'Ion Popescu',
  email: 'ion@example.com',
  property: 'Apartament Centru',
  url: 'http://localhost:5173',
}

describe('buildAssignmentEmail (A7)', () => {
  it('addresses the mail to the recipient email', () => {
    const mail = buildAssignmentEmail('ro', FIELDS)
    expect(mail.to).toEqual(['ion@example.com'])
  })

  it('builds the RO subject and body verbatim from SRS Appendix A7', () => {
    const mail = buildAssignmentEmail('ro', FIELDS)
    expect(mail.message.subject).toBe(
      'Ai o nouă locuință în platformă — Apartament Centru',
    )
    expect(mail.message.text).toContain('Bună, Ion Popescu,')
    expect(mail.message.text).toContain(
      'Rapoartele lunare pentru această locuință vor apărea în contul tău obișnuit.',
    )
    expect(mail.message.text).toContain(
      'Accesează platforma la: http://localhost:5173',
    )
  })

  it('builds the EN subject and body verbatim from SRS Appendix A7', () => {
    const mail = buildAssignmentEmail('en', FIELDS)
    expect(mail.message.subject).toBe(
      'You have a new tenancy — Apartament Centru',
    )
    expect(mail.message.text).toContain('Hi Ion Popescu,')
    expect(mail.message.text).toContain(
      'Monthly reports for this property will appear in your usual account.',
    )
    expect(mail.message.text).toContain(
      'Access the platform at: http://localhost:5173',
    )
  })

  it('has NO password anywhere in the body — no Auth account is created on this branch', () => {
    const ro = buildAssignmentEmail('ro', FIELDS)
    const en = buildAssignmentEmail('en', FIELDS)
    expect(ro.message.text.toLowerCase()).not.toContain('parolă')
    expect(en.message.text.toLowerCase()).not.toContain('password')
  })

  it('falls back to English for an unknown language', () => {
    const mail = buildAssignmentEmail('fr', FIELDS)
    expect(mail.message.subject).toBe(
      'You have a new tenancy — Apartament Centru',
    )
  })
})
