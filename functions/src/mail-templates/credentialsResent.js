/**
 * Template A9 — credentials resent (SRS Appendix A, FR-AUTH-04). Sent by
 * `resetTenantPassword`, ONLY when the administrator explicitly resets a
 * tenant's password — never automatically, and never on a schedule.
 *
 * Without this template the product has no recovery path from a failed A1:
 * `resetTenantPassword` returns the new password to the administrator only,
 * and FR-NLOG-06 forbids re-sending from the notification log. Model:
 * credentials.js (A1) — same shape, same fields, minus the "here's where
 * you'll find your reports" onboarding framing A1 opens with, since this is
 * a resend to an account that already exists.
 */

const TEMPLATES = {
  ro: {
    subject: 'Datele tale de autentificare',
    body: ({ name, email, password, property, url }) =>
      `Bună, ${name},\n` +
      `Îți trimitem din nou datele de acces pentru platforma de administrare a chiriei, pentru ${property}.\n` +
      `Date de autentificare: Email: ${email} / Parolă: ${password}\n` +
      `Accesează platforma la: ${url}`,
  },
  en: {
    subject: 'Your login details',
    body: ({ name, email, password, property, url }) =>
      `Hi ${name},\n` +
      `Here are your login details for the rental management platform, for ${property}.\n` +
      `Login details: Email: ${email} / Password: ${password}\n` +
      `Access the platform at: ${url}`,
  },
}

/**
 * Builds the `mail` document for the credentials-resent email (SRS §5.7
 * shape). Falls back to English if the language is not one of ro/en, same
 * convention as buildCredentialsEmail. `type`/`audience` are fixed here,
 * one place per template. `relatedId`/`ownerId` come from the caller:
 * `resetTenantPassword` knows the tenancy's ID and the admin's own uid.
 *
 * @param language  'ro' | 'en' — the tenant's preferred language
 * @param fields    { name, email, password, property, url, relatedId,
 *                    ownerId }
 */
function buildCredentialsResentEmail(language, fields) {
  const template = TEMPLATES[language] ?? TEMPLATES.en
  return {
    to: [fields.email],
    message: {
      subject: template.subject,
      text: template.body(fields),
    },
    type: 'credentials-resent',
    audience: 'tenant',
    relatedId: fields.relatedId ?? null,
    ownerId: fields.ownerId ?? null,
    // FR-NLOG-09: carries the same generated {password} as A1, so it self-marks
    // for post-delivery redaction the same way — `onMailWrite` acts on the
    // flag, never on the `type`.
    redactAfterDelivery: true,
  }
}

module.exports = { buildCredentialsResentEmail }
