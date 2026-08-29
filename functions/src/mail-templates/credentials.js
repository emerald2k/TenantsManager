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
 * `type`/`audience` (FR-NLOG-03/04) are fixed here, not at the call site —
 * one place per template, so a call site cannot forget them (SRS §7.2).
 * `relatedId`/`ownerId` come from the caller (`fields`): `finalizeKyc` knows
 * the new tenancy's ID and the admin's own uid; this builder just copies
 * them through.
 *
 * @param language  'ro' | 'en' — the tenant's preferred language
 * @param fields    { name, email, password, property, url, relatedId,
 *                    ownerId }
 */
function buildCredentialsEmail(language, fields) {
  const template = TEMPLATES[language] ?? TEMPLATES.en
  return {
    to: [fields.email],
    message: {
      subject: template.subject,
      text: template.body(fields),
    },
    type: 'credentials',
    audience: 'tenant',
    relatedId: fields.relatedId ?? null,
    ownerId: fields.ownerId ?? null,
    // FR-NLOG-09: the body interpolates {password} in clear text. The flag
    // sits on the same object as the secret — the one place the template
    // author is guaranteed to be looking — so `onMailWrite` can empty the
    // body once delivered WITHOUT deciding by `type` (a type list drifts the
    // moment a template is added). A9 (credentialsResent.js) sets it too.
    redactAfterDelivery: true,
  }
}

module.exports = { buildCredentialsEmail }
