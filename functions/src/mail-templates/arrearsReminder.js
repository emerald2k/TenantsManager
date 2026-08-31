/**
 * Template A4 — arrears reminder (SRS Appendix A, FR-PAY-04). Sent by
 * `dailyScheduler` every 3 days after the due date, for as long as arrears
 * remain (selection logic: `shouldSendArrearsReminder`, schedulerLogic.js).
 *
 * To the TENANT, so bilingual (NFR-LOC-04) — unlike A5/A6 (admin-only,
 * Romanian exclusively). Model: reportNotification.js, not credentials.js —
 * `{arrearsAmount}` and `{dueDate}` need LOCALIZED formatting (a formatted
 * amount, a formatted date), not just translated copy. Same conventions:
 * the language is resolved ONCE, with the same fallback-to-English as every
 * other template here, and every formatted value is derived from that SAME
 * resolved language, so nothing ends up half-Romanian, half-raw.
 */

const TEMPLATES = {
  ro: {
    subject: ({ arrearsAmount }) =>
      `Reamintire: plată restantă — ${arrearsAmount} lei`,
    body: ({ name, arrearsAmount, property, dueDate, url }) =>
      `Bună, ${name},\n` +
      `Îți reamintim că există o sumă restantă de ${arrearsAmount} lei pentru ${property}, scadentă la ${dueDate}.\n` +
      `Te rugăm să contactezi proprietarul pentru achitare.\n` +
      `Detalii: ${url}`,
  },
  en: {
    subject: ({ arrearsAmount }) =>
      `Reminder: overdue payment — ${arrearsAmount} RON`,
    body: ({ name, arrearsAmount, property, dueDate, url }) =>
      `Hi ${name},\n` +
      `This is a reminder that an overdue amount of ${arrearsAmount} RON is pending for ${property}, due on ${dueDate}.\n` +
      `Please contact the landlord to settle the payment.\n` +
      `Details: ${url}`,
  },
}

function localeFor(language) {
  return language === 'ro' ? 'ro-RO' : 'en-US'
}

/** "1.500,00" (ro) / "1,500.00" (en) — no currency suffix: both templates
 * already append " lei"/" RON" around {arrearsAmount} themselves. */
function formatAmount(amount, language) {
  return new Intl.NumberFormat(localeFor(language), {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(amount) || 0)
}

/** "05.07.2026" (ro) / "07/05/2026" (en) — dueDate is a plain ISO string
 * ("2026-07-05"); an email body has no <input type="date"> to localize it
 * for free, so it must be formatted here explicitly, same treatment as
 * reportNotification.js's formatDueDate. */
function formatDueDate(isoDate, language) {
  const [year, month, day] = isoDate.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  return new Intl.DateTimeFormat(localeFor(language), {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date)
}

/**
 * Builds the `mail` document for the arrears reminder (SRS §5.7 shape).
 * Falls back to English if `language` is not one of ro/en — same convention
 * as buildCredentialsEmail/buildAssignmentEmail/buildReportNotificationEmail.
 *
 * `type`/`audience` (FR-NLOG-03/04) are fixed here, one place per template.
 * `relatedId`/`ownerId` come from the caller: `dailyScheduler` knows the
 * tenancy's ID and its `ownerId` (the single admin's uid).
 *
 * @param language  'ro' | 'en' — the tenant's preferred language
 * @param fields    { name, email, arrearsAmount, property, dueDate, url,
 *                    relatedId, ownerId } — RAW, unformatted; this function
 *                  does all localization internally.
 */
function buildArrearsReminderEmail(language, fields) {
  const lang = TEMPLATES[language] ? language : 'en'
  const values = {
    name: fields.name,
    arrearsAmount: formatAmount(fields.arrearsAmount, lang),
    property: fields.property,
    dueDate: formatDueDate(fields.dueDate, lang),
    url: fields.url,
  }
  const tpl = TEMPLATES[lang]
  return {
    to: [fields.email],
    message: {
      subject: tpl.subject(values),
      text: tpl.body(values),
    },
    type: 'arrears-reminder',
    audience: 'tenant',
    relatedId: fields.relatedId ?? null,
    ownerId: fields.ownerId ?? null,
  }
}

module.exports = { buildArrearsReminderEmail }
