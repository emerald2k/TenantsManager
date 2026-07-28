import { describe, expect, it } from 'vitest'
import { buildReportNotificationEmail } from '../src/mail-templates/reportNotification.js'

// Templates A2 (new report) / A3 (report updated) — SRS Appendix A. Same
// `mail` document shape as buildCredentialsEmail/buildAssignmentEmail (SRS
// §5.7). Unlike A1/A7, A2/A3 interpolate a formatted month/year, a formatted
// amount, and a formatted due date — all localized by the builder itself
// from the SAME resolved language.

const FIELDS = {
  name: 'Ion Popescu',
  email: 'ion@example.com',
  month: 7,
  year: 2026,
  finalTotal: 1500,
  dueDate: '2026-07-05',
  url: 'http://localhost:5173',
}

describe('buildReportNotificationEmail — A2 (new report)', () => {
  it('addresses the mail to the recipient email', () => {
    const mail = buildReportNotificationEmail('new', 'ro', FIELDS)
    expect(mail.to).toEqual(['ion@example.com'])
  })

  it('builds the RO subject and body verbatim from SRS Appendix A2, with formatted month/total/date', () => {
    const mail = buildReportNotificationEmail('new', 'ro', FIELDS)
    expect(mail.message.subject).toBe(
      'Raportul pentru iulie 2026 este disponibil — 1.500,00 lei',
    )
    expect(mail.message.text).toBe(
      'Bună, Ion Popescu,\n' +
        'Raportul lunar pentru iulie 2026 a fost publicat.\n' +
        'Total de plată: 1.500,00 lei / Data scadentă: 05.07.2026\n' +
        'Detaliile complete: http://localhost:5173',
    )
  })

  it('builds the EN subject and body verbatim from SRS Appendix A2, with formatted month/total/date', () => {
    const mail = buildReportNotificationEmail('new', 'en', FIELDS)
    expect(mail.message.subject).toBe(
      'Your July 2026 report is available — 1,500.00 RON',
    )
    expect(mail.message.text).toBe(
      'Hi Ion Popescu,\n' +
        'Your monthly report for July 2026 has been published.\n' +
        'Total due: 1,500.00 RON / Due date: 07/05/2026\n' +
        'Full details: http://localhost:5173',
    )
  })
})

describe('buildReportNotificationEmail — A3 (report updated)', () => {
  it('builds the RO subject and body verbatim from SRS Appendix A3', () => {
    const mail = buildReportNotificationEmail('updated', 'ro', FIELDS)
    expect(mail.message.subject).toBe(
      'Raportul pentru iulie 2026 a fost actualizat',
    )
    expect(mail.message.text).toBe(
      'Bună, Ion Popescu,\n' +
        'Raportul lunar pentru iulie 2026 a fost actualizat de proprietar.\n' +
        'Total de plată actualizat: 1.500,00 lei / Data scadentă: 05.07.2026\n' +
        'Verifică detaliile: http://localhost:5173',
    )
  })

  it('builds the EN subject and body verbatim from SRS Appendix A3', () => {
    const mail = buildReportNotificationEmail('updated', 'en', FIELDS)
    expect(mail.message.subject).toBe('Your July 2026 report has been updated')
    expect(mail.message.text).toBe(
      'Hi Ion Popescu,\n' +
        'Your monthly report for July 2026 has been updated by the landlord.\n' +
        'Updated total due: 1,500.00 RON / Due date: 07/05/2026\n' +
        'Check the details: http://localhost:5173',
    )
  })
})

describe('buildReportNotificationEmail — language fallback (NFR-LOC-04)', () => {
  it('falls back to English for an unknown/missing preferredLanguage', () => {
    const mail = buildReportNotificationEmail('new', 'fr', FIELDS)
    expect(mail.message.subject).toBe(
      'Your July 2026 report is available — 1,500.00 RON',
    )
  })

  it('falls back to English when preferredLanguage is undefined', () => {
    const mail = buildReportNotificationEmail('new', undefined, FIELDS)
    expect(mail.message.subject).toBe(
      'Your July 2026 report is available — 1,500.00 RON',
    )
  })
})

describe('buildReportNotificationEmail — anti-vacuity: A2 and A3 are actually different text', () => {
  it('the subject and body differ between templates for the SAME fields/language', () => {
    const a2 = buildReportNotificationEmail('new', 'ro', FIELDS)
    const a3 = buildReportNotificationEmail('updated', 'ro', FIELDS)
    expect(a2.message.subject).not.toBe(a3.message.subject)
    expect(a2.message.text).not.toBe(a3.message.text)
  })
})
