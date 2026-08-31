/**
 * Templates A2 (new report published) / A3 (report updated) — SRS Appendix
 * A, FR-REP-06/FR-REP-07a. Sent ON-DEMAND ONLY, via the `sendReportNotification`
 * callable (functions/src/reports.js) — the admin picks 'new' vs 'updated'
 * manually every send, pinned at f6d5c83; there is no auto-detection and no
 * tracking field anywhere.
 *
 * Unlike A1 (credentials.js) / A7 (assignment.js), every interpolated value
 * here needs LOCALIZED formatting, not just language-switched copy — a plain
 * ISO month/year, a raw number, and an ISO date string would all read wrong
 * to a human. This module resolves the language ONCE (with the same
 * fallback-to-English convention as credentials.js/assignment.js) and
 * formats month/year, amount, and due date from that SAME resolved
 * language, so nothing here can end up half-Romanian, half-raw.
 */

const TEMPLATES = {
  ro: {
    new: {
      subject: ({ monthYear, total }) =>
        `Raportul pentru ${monthYear} este disponibil — ${total} lei`,
      body: ({ name, monthYear, total, dueDate, url }) =>
        `Bună, ${name},\n` +
        `Raportul lunar pentru ${monthYear} a fost publicat.\n` +
        `Total de plată: ${total} lei / Data scadentă: ${dueDate}\n` +
        `Detaliile complete: ${url}`,
    },
    updated: {
      subject: ({ monthYear }) =>
        `Raportul pentru ${monthYear} a fost actualizat`,
      body: ({ name, monthYear, total, dueDate, url }) =>
        `Bună, ${name},\n` +
        `Raportul lunar pentru ${monthYear} a fost actualizat de proprietar.\n` +
        `Total de plată actualizat: ${total} lei / Data scadentă: ${dueDate}\n` +
        `Verifică detaliile: ${url}`,
    },
  },
  en: {
    new: {
      subject: ({ monthYear, total }) =>
        `Your ${monthYear} report is available — ${total} RON`,
      body: ({ name, monthYear, total, dueDate, url }) =>
        `Hi ${name},\n` +
        `Your monthly report for ${monthYear} has been published.\n` +
        `Total due: ${total} RON / Due date: ${dueDate}\n` +
        `Full details: ${url}`,
    },
    updated: {
      subject: ({ monthYear }) => `Your ${monthYear} report has been updated`,
      body: ({ name, monthYear, total, dueDate, url }) =>
        `Hi ${name},\n` +
        `Your monthly report for ${monthYear} has been updated by the landlord.\n` +
        `Updated total due: ${total} RON / Due date: ${dueDate}\n` +
        `Check the details: ${url}`,
    },
  },
}

function localeFor(language) {
  return language === 'ro' ? 'ro-RO' : 'en-US'
}

/** "iulie 2026" / "July 2026" — lowercase in Romanian is correct here, both
 * A2's subject and body use it mid-sentence. */
function formatMonthYear(month, year, language) {
  const date = new Date(year, month - 1, 1)
  return new Intl.DateTimeFormat(localeFor(language), {
    month: 'long',
    year: 'numeric',
  }).format(date)
}

/** "1.500,00" (ro) / "1,500.00" (en) — no currency suffix: every A2/A3
 * template already appends " lei"/" RON" around {total} itself. */
function formatAmount(amount, language) {
  return new Intl.NumberFormat(localeFor(language), {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(amount) || 0)
}

/** "05.07.2026" (ro) / "07/05/2026" (en) — dueDate is stored as a plain ISO
 * string ("2026-07-05"); an email body has no <input type="date"> layer to
 * localize it for free, unlike the admin UI, so it must be formatted here
 * explicitly. */
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
 * Builds the `mail` document for the report notification email (SRS §5.7
 * shape). Falls back to English if `language` is not one of ro/en — same
 * convention as buildCredentialsEmail/buildAssignmentEmail.
 *
 * `type` (FR-NLOG-03) is the one case in this directory where it is NOT a
 * single hardcoded constant: A2/A3 share one builder, and `type` follows
 * the same `template` parameter the admin already picks explicitly at every
 * send — never inferred separately. `relatedId`/`ownerId` come from the
 * caller: `sendReportNotification` knows the report's ID and the admin's
 * own uid.
 *
 * @param template  'new' | 'updated' — the admin's explicit choice (A2/A3)
 * @param language  'ro' | 'en' — the tenant's preferred language
 * @param fields    { name, email, month, year, finalTotal, dueDate, url,
 *                    relatedId, ownerId } — RAW, unformatted; this function
 *                  does all localization internally.
 */
function buildReportNotificationEmail(template, language, fields) {
  const lang = TEMPLATES[language] ? language : 'en'
  const values = {
    name: fields.name,
    monthYear: formatMonthYear(fields.month, fields.year, lang),
    total: formatAmount(fields.finalTotal, lang),
    dueDate: formatDueDate(fields.dueDate, lang),
    url: fields.url,
  }
  const tpl = TEMPLATES[lang][template]
  return {
    to: [fields.email],
    message: {
      subject: tpl.subject(values),
      text: tpl.body(values),
    },
    type: template === 'updated' ? 'report-updated' : 'report-new',
    audience: 'tenant',
    relatedId: fields.relatedId ?? null,
    ownerId: fields.ownerId ?? null,
  }
}

module.exports = { buildReportNotificationEmail }
