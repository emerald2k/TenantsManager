/**
 * Template A1 — access credentials, sent on KYC completion (SRS Appendix A, FR-AUTH-07).
 *
 * The tenant's email always goes out in their preferred language (NFR-LOC-04): the
 * `language` argument comes from `users.preferredLanguage`. The Romanian body is
 * content shown to the tenant, not working language — kept verbatim from Appendix A;
 * the interpolated placeholders ({name}, {email}, {password}, {property}, {url}) are
 * English identifiers coming from code.
 */

const TEMPLATES = {
  ro: {
    subject: 'Contul tău de chiriaș a fost creat',
    body: ({ name, email, password, property, url }) =>
      `Bună, ${name},\n` +
      `Ți-a fost creat un cont în platforma de administrare a chiriei pentru proprietatea ${property}.\n` +
      `Date de autentificare: Email: ${email} / Parolă: ${password}\n` +
      `Accesează platforma la: ${url}\n` +
      `Aici vei găsi, lunar, raportul cu suma de plată, data scadentă și istoricul plăților tale.`,
  },
  en: {
    subject: 'Your tenant account has been created',
    body: ({ name, email, password, property, url }) =>
      `Hi ${name},\n` +
      `An account has been created for you on the rental management platform for ${property}.\n` +
      `Login details: Email: ${email} / Password: ${password}\n` +
      `Access the platform at: ${url}\n` +
      `Each month you'll find your payment report, due date, and payment history here.`,
  },
}

/**
 * Builds the `mail` document for the credentials email, in the shape the "Trigger
 * Email" extension consumes: `{ to, message: { subject, text } }` (SRS §5.7). Falls
 * back to English if the language is not one of ro/en.
 *
 * @param language  'ro' | 'en' — the tenant's preferred language
 * @param fields    { name, email, password, property, url }
 */
function buildCredentialsEmail(language, fields) {
  const template = TEMPLATES[language] ?? TEMPLATES.en
  return {
    to: [fields.email],
    message: {
      subject: template.subject,
      text: template.body(fields),
    },
  }
}

module.exports = { buildCredentialsEmail }
