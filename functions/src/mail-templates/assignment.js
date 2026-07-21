/**
 * Template A7 — new tenancy assigned to an EXISTING tenant (SRS Appendix A,
 * FR-TEN-07). Sent by finalizeKyc's existing-user branch instead of A1: no
 * password, since no new Auth account is created there — the tenant already has
 * one, from their previous tenancy.
 *
 * `language` comes from `users.preferredLanguage` of the EXISTING account, not
 * the draft (NFR-LOC-04) — the draft's Steps 1-3 are irrelevant on this branch and
 * do not carry a preferred language for a brand-new tenant.
 */

const TEMPLATES = {
  ro: {
    subject: ({ property }) => `Ai o nouă locuință în platformă — ${property}`,
    body: ({ name, url }) =>
      `Bună, ${name},\n` +
      `Rapoartele lunare pentru această locuință vor apărea în contul tău obișnuit.\n` +
      `Accesează platforma la: ${url}`,
  },
  en: {
    subject: ({ property }) => `You have a new tenancy — ${property}`,
    body: ({ name, url }) =>
      `Hi ${name},\n` +
      `Monthly reports for this property will appear in your usual account.\n` +
      `Access the platform at: ${url}`,
  },
}

/**
 * Builds the `mail` document for the assignment email, in the shape the "Trigger
 * Email" extension consumes (SRS §5.7). Falls back to English if the language is
 * not one of ro/en.
 *
 * @param language  'ro' | 'en' — the EXISTING tenant's preferred language
 * @param fields    { name, email, property, url }
 */
function buildAssignmentEmail(language, fields) {
  const template = TEMPLATES[language] ?? TEMPLATES.en
  return {
    to: [fields.email],
    message: {
      subject: template.subject(fields),
      text: template.body(fields),
    },
  }
}

module.exports = { buildAssignmentEmail }
