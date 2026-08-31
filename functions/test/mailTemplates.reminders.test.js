import { describe, expect, it } from 'vitest'
import { buildArrearsReminderEmail } from '../src/mail-templates/arrearsReminder.js'
import { buildExpiryReminderEmail } from '../src/mail-templates/expiryReminder.js'
import { buildReportPrepReminderEmail } from '../src/mail-templates/reportPrepReminder.js'
import { buildPreDueReminderEmail } from '../src/mail-templates/preDueReminder.js'

// Pure-function tests — no emulator, no Firestore, no I/O. Sub-stage 3a of
// M6: templates only, wired to dailyScheduler in a later sub-stage.

describe('buildArrearsReminderEmail (A4, to the tenant, bilingual — NFR-LOC-04)', () => {
  const fields = {
    name: 'Ion Popescu',
    email: 'ion@example.com',
    arrearsAmount: 1500,
    property: 'Apartament Centru',
    dueDate: '2026-07-05',
    url: 'http://localhost:5173',
  }

  it('builds the Romanian email with the amount and date formatted the Romanian way', () => {
    const result = buildArrearsReminderEmail('ro', fields)

    expect(result.message.subject).toBe(
      'Reamintire: plată restantă — 1.500,00 lei',
    )
    expect(result.message.text).toBe(
      'Bună, Ion Popescu,\n' +
        'Îți reamintim că există o sumă restantă de 1.500,00 lei pentru Apartament Centru, scadentă la 05.07.2026.\n' +
        'Te rugăm să contactezi proprietarul pentru achitare.\n' +
        'Detalii: http://localhost:5173',
    )
  })

  it('builds the English email with the amount and date formatted the English way', () => {
    const result = buildArrearsReminderEmail('en', fields)

    expect(result.message.subject).toBe(
      'Reminder: overdue payment — 1,500.00 RON',
    )
    expect(result.message.text).toBe(
      'Hi Ion Popescu,\n' +
        'This is a reminder that an overdue amount of 1,500.00 RON is pending for Apartament Centru, due on 07/05/2026.\n' +
        'Please contact the landlord to settle the payment.\n' +
        'Details: http://localhost:5173',
    )
  })

  it('the RO and EN amounts/dates are genuinely formatted differently, not just copy-translated', () => {
    const ro = buildArrearsReminderEmail('ro', fields)
    const en = buildArrearsReminderEmail('en', fields)

    expect(ro.message.text).toContain('1.500,00')
    expect(ro.message.text).not.toContain('1,500.00')
    expect(en.message.text).toContain('1,500.00')
    expect(en.message.text).not.toContain('1.500,00')

    expect(ro.message.text).toContain('05.07.2026')
    expect(en.message.text).toContain('07/05/2026')
  })

  it('falls back to English for an unknown language, same convention as the other templates', () => {
    const unknown = buildArrearsReminderEmail('de', fields)
    const en = buildArrearsReminderEmail('en', fields)

    expect(unknown).toEqual(en)
  })

  it('has the { to: [email], message: { subject, text } } shape, with `to` an ARRAY', () => {
    const result = buildArrearsReminderEmail('ro', fields)

    expect(Array.isArray(result.to)).toBe(true)
    expect(result.to).toEqual(['ion@example.com'])
    expect(typeof result.message.subject).toBe('string')
    expect(typeof result.message.text).toBe('string')
  })
})

describe('buildExpiryReminderEmail (A5, to ADMIN_EMAIL, Romanian only — NFR-LOC-04)', () => {
  const fields = {
    name: 'Ion Popescu',
    email: 'admin@example.com',
    property: 'Apartament Centru',
    endDate: '2026-10-31',
    url: 'http://localhost:5173',
  }

  it('builds the subject and body verbatim from SRS Appendix A5, with endDate in ro-RO format', () => {
    const result = buildExpiryReminderEmail(fields)

    expect(result.message.subject).toBe(
      'Contract în expirare: Apartament Centru — 31.10.2026',
    )
    expect(result.message.text).toBe(
      'Contractul chiriașului Ion Popescu pentru proprietatea Apartament Centru expiră la 31.10.2026.\n' +
        'Acțiuni posibile: prelungește contractul (editează data de sfârșit) sau planifică încheierea și offboarding-ul.\n' +
        'Deschide tenanța: http://localhost:5173',
    )
  })

  it('sends to ADMIN_EMAIL (fields.email), NOT the tenant — `to` is an ARRAY', () => {
    const result = buildExpiryReminderEmail(fields)

    expect(Array.isArray(result.to)).toBe(true)
    expect(result.to).toEqual(['admin@example.com'])
  })
})

describe('buildReportPrepReminderEmail (A6, to ADMIN_EMAIL, Romanian only — NFR-LOC-04)', () => {
  const fields = {
    email: 'admin@example.com',
    property: 'Apartament Centru',
    dueDate: '2026-08-05',
  }

  it('builds the subject and body verbatim from SRS Appendix A6, with dueDate in ro-RO format', () => {
    const result = buildReportPrepReminderEmail(fields)

    expect(result.message.subject).toBe(
      'Pregătește lista de plată — Apartament Centru',
    )
    expect(result.message.text).toBe(
      'Contul pentru Apartament Centru are scadența pe 05.08.2026. ' +
        'Raportul lunii încă nu e semnat — pregătește costurile și emite lista.',
    )
  })

  it('does NOT contain a {url} — Appendix A6 has none, none is invented', () => {
    const result = buildReportPrepReminderEmail(fields)

    expect(result.message.text).not.toContain('http')
  })

  it('sends to ADMIN_EMAIL (fields.email) — `to` is an ARRAY', () => {
    const result = buildReportPrepReminderEmail(fields)

    expect(Array.isArray(result.to)).toBe(true)
    expect(result.to).toEqual(['admin@example.com'])
  })
})

describe('buildPreDueReminderEmail (A8, to the tenant, bilingual — NFR-LOC-04)', () => {
  const fields = {
    name: 'Ion Popescu',
    email: 'ion@example.com',
    property: 'Apartament Centru',
    month: 7,
    year: 2026,
    dueDate: '2026-07-05',
    finalTotal: 2500,
    url: 'http://localhost:5173',
  }

  it('builds the Romanian email verbatim from SRS Appendix A8', () => {
    const result = buildPreDueReminderEmail('ro', fields)

    expect(result.message.subject).toBe(
      'Reamintire: plata pentru iulie 2026 — scadentă la 05.07.2026',
    )
    expect(result.message.text).toBe(
      'Bună, Ion Popescu,\n' +
        'Îți reamintim că plata pentru Apartament Centru, aferentă lunii iulie 2026, este scadentă la 05.07.2026.\n' +
        'Total de plată: 2.500,00 lei\n' +
        'Detalii: http://localhost:5173',
    )
  })

  it('builds the English email verbatim from SRS Appendix A8', () => {
    const result = buildPreDueReminderEmail('en', fields)

    expect(result.message.subject).toBe(
      'Reminder: your July 2026 payment is due on 07/05/2026',
    )
    expect(result.message.text).toBe(
      'Hi Ion Popescu,\n' +
        'This is a reminder that your payment for Apartament Centru, for July 2026, is due on 07/05/2026.\n' +
        'Total due: 2,500.00 RON\n' +
        'Details: http://localhost:5173',
    )
  })

  it('{total} is finalTotal, not a remainder — same vocabulary as A2/A3, never the unpaid amount', () => {
    const result = buildPreDueReminderEmail('ro', {
      ...fields,
      finalTotal: 2500,
    })

    expect(result.message.text).toContain('2.500,00 lei')
  })

  it('the RO and EN month/amount/date are genuinely formatted differently, not just copy-translated', () => {
    const ro = buildPreDueReminderEmail('ro', fields)
    const en = buildPreDueReminderEmail('en', fields)

    expect(ro.message.text).toContain('iulie 2026')
    expect(en.message.text).toContain('July 2026')
    expect(ro.message.text).toContain('2.500,00')
    expect(en.message.text).toContain('2,500.00')
    expect(ro.message.text).toContain('05.07.2026')
    expect(en.message.text).toContain('07/05/2026')
  })

  it('falls back to English for an unknown language, same convention as the other templates', () => {
    const unknown = buildPreDueReminderEmail('de', fields)
    const en = buildPreDueReminderEmail('en', fields)

    expect(unknown).toEqual(en)
  })

  it('has the { to: [email], message: { subject, text } } shape, with `to` an ARRAY', () => {
    const result = buildPreDueReminderEmail('ro', fields)

    expect(Array.isArray(result.to)).toBe(true)
    expect(result.to).toEqual(['ion@example.com'])
    expect(typeof result.message.subject).toBe('string')
    expect(typeof result.message.text).toBe('string')
  })

  it('sends the SAME body regardless of how many days out it is (the copy states dueDate, never a countdown — SRS Appendix A note above A9)', () => {
    // buildPreDueReminderEmail has no "days remaining" input at all — this
    // documents WHY: the same fields produce the identical body whether
    // called for the first day of the window or the due date itself.
    const first = buildPreDueReminderEmail('ro', fields)
    const last = buildPreDueReminderEmail('ro', fields)
    expect(first).toEqual(last)
  })
})
