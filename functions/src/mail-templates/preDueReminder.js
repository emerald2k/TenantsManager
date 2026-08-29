/**
 * Template A8 — pre-due payment reminder (SRS Appendix A, FR-PAY-10). Sent
 * by `dailyScheduler` once per day for every day in `[dueDate -
 * paymentReminderDaysBefore, dueDate]`, inclusive of the due date itself
 * (selection logic: `shouldSendPreDueReminder`, schedulerLogic.js).
 *
 * To the TENANT, so bilingual (NFR-LOC-04) — same model as
 * arrearsReminder.js/reportNotification.js: the language is resolved ONCE,
 * and `monthYear`/`total`/`dueDate` are all formatted from that SAME
 * resolved language, never mixed.
 *
 * `{total}` is `finalTotal` — the report's actual bill, never a remainder
 * (same vocabulary as A2/A3's `{total}` in reportNotification.js). The
 * copy deliberately states the due date rather than a countdown (SRS
 * Appendix A note above A9): the identical body is sent on every day of
 * the run-up, including the due date itself, so "in 3 days" would be wrong
 * on the last send.
 */

const TEMPLATES = {
  ro: {
    subject: ({ monthYear, dueDate }) =>
      `Reamintire: plata pentru ${monthYear} — scadentă la ${dueDate}`,
    body: ({ name, property, monthYear, dueDate, total, url }) =>
      `Bună, ${name},\n` +
      `Îți reamintim că plata pentru ${property}, aferentă lunii ${monthYear}, este scadentă la ${dueDate}.\n` +
      `Total de plată: ${total} lei\n` +
      `Detalii: ${url}`,
  },
  en: {
    subject: ({ monthYear, dueDate }) =>
      `Reminder: your ${monthYear} payment is due on ${dueDate}`,
    body: ({ name, property, monthYear, dueDate, total, url }) =>
      `Hi ${name},\n` +
      `This is a reminder that your payment for ${property}, for ${monthYear}, is due on ${dueDate}.\n` +
      `Total due: ${total} RON\n` +
      `Details: ${url}`,
  },
}

function localeFor(language) {
  return language === 'ro' ? 'ro-RO' : 'en-US'
}

/** "iulie 2026" / "July 2026" — same approach as reportNotification.js's
 * formatMonthYear, duplicated rather than imported (no cross-file sharing
 * between mail-templates, same convention every file in this directory
 * follows — see reportPrepReminder.js's own duplicated formatDueDate). */
function formatMonthYear(month, year, language) {
  const date = new Date(year, month - 1, 1)
  return new Intl.DateTimeFormat(localeFor(language), {
    month: 'long',
    year: 'numeric',
  }).format(date)
}

/** "1.500,00" (ro) / "1,500.00" (en) — no currency suffix: both templates
 * already append " lei"/" RON" around {total} themselves. */
function formatAmount(amount, language) {
  return new Intl.NumberFormat(localeFor(language), {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(amount) || 0)
}

/** "05.07.2026" (ro) / "07/05/2026" (en) — dueDate is a plain ISO string
 * ("2026-07-05"); same treatment as arrearsReminder.js's formatDueDate. */
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
 * Builds the `mail` document for the pre-due payment reminder (SRS §5.7
 * shape). Falls back to English if `language` is not one of ro/en — same
 * convention as every other bilingual template in this directory.
 *
 * `type`/`audience` (FR-NLOG-03/04) are fixed here, one place per template.
 * `relatedId`/`ownerId` come from the caller: `dailyScheduler` anchors this
 * reminder on a specific report, so `relatedId` is the report's ID, not the
 * tenancy's — matching FAMILY 4's own "anchor on the report" rule
 * (FR-PAY-10a).
 *
 * @param language  'ro' | 'en' — the tenant's preferred language
 * @param fields    { name, email, property, month, year, dueDate,
 *                    finalTotal, url, relatedId, ownerId } — RAW,
 *                    unformatted; this function does all localization
 *                    internally.
 */
function buildPreDueReminderEmail(language, fields) {
  const lang = TEMPLATES[language] ? language : 'en'
  const values = {
    name: fields.name,
    property: fields.property,
    monthYear: formatMonthYear(fields.month, fields.year, lang),
    dueDate: formatDueDate(fields.dueDate, lang),
    total: formatAmount(fields.finalTotal, lang),
    url: fields.url,
  }
  const tpl = TEMPLATES[lang]
  return {
    to: [fields.email],
    message: {
      subject: tpl.subject(values),
      text: tpl.body(values),
    },
    type: 'payment-upcoming',
    audience: 'tenant',
    relatedId: fields.relatedId ?? null,
    ownerId: fields.ownerId ?? null,
  }
}

module.exports = { buildPreDueReminderEmail }
