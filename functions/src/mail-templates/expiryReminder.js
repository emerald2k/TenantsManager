/**
 * Template A5 — contract expiry reminder (SRS Appendix A, FR-CON-09). Sent
 * by `dailyScheduler` at exactly 90/60/30 days before a tenancy's `endDate`
 * (selection logic: `shouldSendExpiryReminder`, schedulerLogic.js).
 *
 * To the ADMIN, Romanian EXCLUSIVELY (NFR-LOC-04, documented at cf3b238) —
 * unlike A4 (tenant-facing, bilingual). No language switch, no TEMPLATES
 * object keyed by language: there is only one language here. Model:
 * credentials.js, minus the bilingual branching.
 *
 * `name` is the TENANT's name (it appears in the body, identifying whose
 * contract is expiring); `email` is `ADMIN_EMAIL` (§7.5) — the recipient,
 * not the tenant's own address.
 */

const SUBJECT = ({ property, endDate }) =>
  `Contract în expirare: ${property} — ${endDate}`

const BODY = ({ name, property, endDate, url }) =>
  `Contractul chiriașului ${name} pentru proprietatea ${property} expiră la ${endDate}.\n` +
  `Acțiuni posibile: prelungește contractul (editează data de sfârșit) sau planifică încheierea și offboarding-ul.\n` +
  `Deschide tenanța: ${url}`

/** "31.10.2026" — endDate is a plain ISO string ("2026-10-31"); an email
 * body has no <input type="date"> to localize it for free, so it must be
 * formatted here explicitly, same treatment as reportNotification.js's
 * formatDueDate. */
function formatEndDate(isoDate) {
  const [year, month, day] = isoDate.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  return new Intl.DateTimeFormat('ro-RO', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date)
}

/**
 * Builds the `mail` document for the contract expiry reminder (SRS §5.7
 * shape). Always Romanian — no `language` parameter, unlike every
 * tenant-facing template in this directory.
 *
 * `type`/`audience` (FR-NLOG-03/04) are fixed here, one place per template.
 * `relatedId`/`ownerId` come from the caller: `dailyScheduler` knows the
 * tenancy's ID and its `ownerId` (the single admin's uid).
 *
 * @param fields  { name, email, property, endDate, url, relatedId, ownerId }
 *                — RAW, unformatted; `email` is ADMIN_EMAIL, `name` is the
 *                tenant's name.
 */
function buildExpiryReminderEmail(fields) {
  const values = {
    name: fields.name,
    property: fields.property,
    endDate: formatEndDate(fields.endDate),
    url: fields.url,
  }
  return {
    to: [fields.email],
    message: {
      subject: SUBJECT(values),
      text: BODY(values),
    },
    type: 'contract-expiry',
    audience: 'admin',
    relatedId: fields.relatedId ?? null,
    ownerId: fields.ownerId ?? null,
  }
}

module.exports = { buildExpiryReminderEmail }
