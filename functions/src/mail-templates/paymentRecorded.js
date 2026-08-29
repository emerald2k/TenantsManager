/**
 * Template A10 — payment recorded (SRS Appendix A, FR-PAY-01). Sent from the
 * payment section, ONLY on the administrator's explicit request — the same
 * discipline as A2/A3 (FR-REP-06): the product never emails the tenant
 * behind the administrator's back. Not tied to `useMarkPayment` itself,
 * which is a plain client `updateDoc` and cannot write to `mail` (closed to
 * every client, admin included — SRS §7.3); this template is built by a
 * separate callable ("the payment action").
 *
 * To the TENANT, so bilingual (NFR-LOC-04) — same model as
 * reportNotification.js. `{total}`/`{dueDate}` are the SHARED placeholder
 * names (SRS Appendix A note), reused here for the amount actually PAID and
 * the payment DATE — not the report's `finalTotal`/`dueDate` those same
 * names carry in A2/A3/A4/A8. Same reuse convention as A12's heartbeat.
 */

const TEMPLATES = {
  ro: {
    subject: ({ monthYear }) => `Am înregistrat plata ta pentru ${monthYear}`,
    body: ({ name, property, monthYear, total, dueDate, url }) =>
      `Bună, ${name},\n` +
      `Am înregistrat plata pentru ${property}, aferentă lunii ${monthYear}.\n` +
      `Sumă înregistrată: ${total} lei / Data: ${dueDate}\n` +
      `Detalii și situația la zi: ${url}`,
  },
  en: {
    subject: ({ monthYear }) => `Your ${monthYear} payment has been recorded`,
    body: ({ name, property, monthYear, total, dueDate, url }) =>
      `Hi ${name},\n` +
      `We have recorded your payment for ${property}, for ${monthYear}.\n` +
      `Amount recorded: ${total} RON / Date: ${dueDate}\n` +
      `Details and current balance: ${url}`,
  },
}

function localeFor(language) {
  return language === 'ro' ? 'ro-RO' : 'en-US'
}

/** Same approach as reportNotification.js's formatMonthYear, duplicated
 * rather than imported — no cross-file sharing within mail-templates/. */
function formatMonthYear(month, year, language) {
  const date = new Date(year, month - 1, 1)
  return new Intl.DateTimeFormat(localeFor(language), {
    month: 'long',
    year: 'numeric',
  }).format(date)
}

/** No currency suffix: both templates already append " lei"/" RON" around
 * {total} themselves, same convention as every other template here. */
function formatAmount(amount, language) {
  return new Intl.NumberFormat(localeFor(language), {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(amount) || 0)
}

/** `paymentDate` is a plain ISO string ("2026-07-05"), same treatment as
 * every other date field across this directory. */
function formatPaymentDate(isoDate, language) {
  const [year, month, day] = isoDate.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  return new Intl.DateTimeFormat(localeFor(language), {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date)
}

/**
 * Builds the `mail` document for the payment-recorded confirmation (SRS
 * §5.7 shape). Falls back to English if `language` is not one of ro/en.
 * `type`/`audience` are fixed here, one place per template. `relatedId`/
 * `ownerId` come from the caller: the payment action knows the report's ID
 * and the admin's own uid.
 *
 * @param language  'ro' | 'en' — the tenant's preferred language
 * @param fields    { name, email, property, month, year, amountPaid,
 *                    paymentDate, url, relatedId, ownerId } — RAW,
 *                    unformatted; this function does all localization
 *                    internally.
 */
function buildPaymentRecordedEmail(language, fields) {
  const lang = TEMPLATES[language] ? language : 'en'
  const values = {
    name: fields.name,
    property: fields.property,
    monthYear: formatMonthYear(fields.month, fields.year, lang),
    total: formatAmount(fields.amountPaid, lang),
    dueDate: formatPaymentDate(fields.paymentDate, lang),
    url: fields.url,
  }
  const tpl = TEMPLATES[lang]
  return {
    to: [fields.email],
    message: {
      subject: tpl.subject(values),
      text: tpl.body(values),
    },
    type: 'payment-recorded',
    audience: 'tenant',
    relatedId: fields.relatedId ?? null,
    ownerId: fields.ownerId ?? null,
  }
}

module.exports = { buildPaymentRecordedEmail }
