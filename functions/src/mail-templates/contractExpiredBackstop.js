/**
 * Template A11 — contract expired, still active (SRS Appendix A, FR-CON-08).
 * Sent by `dailyScheduler`'s FAMILY 5, weekly, for as long as a tenancy
 * stays `active` past its own `endDate` — the backstop for having missed
 * all three of A5's 90/60/30-day advance warnings (FR-CON-09). Deliberately
 * does NOT terminate anything: FR-CON-08's manual-only rule stands.
 *
 * To the ADMIN, Romanian exclusively (NFR-LOC-04) — same as A5/A6/A12/A13.
 * No language switch, no TEMPLATES object keyed by language. Model:
 * expiryReminder.js, minus the bilingual branching (both are admin-only).
 */

const SUBJECT = ({ property, endDate }) =>
  `Contract expirat, încă activ: ${property} — ${endDate}`

const BODY = ({ name, property, endDate, url }) =>
  `Contractul chiriașului ${name} pentru proprietatea ${property} a expirat la ${endDate} și este încă marcat ca activ.\n` +
  `Cât timp rămâne activ: se cer rapoarte lunare, pleacă remindere de plată către chiriaș, iar proprietatea rămâne ocupată — nu poți finaliza onboardingul altui chiriaș pe ea.\n` +
  `Încheie contractul sau prelungește-i data de sfârșit: ${url}`

/** "31.10.2026" — endDate is a plain ISO string ("2026-10-31"), same
 * treatment as expiryReminder.js's formatEndDate. */
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
 * Builds the `mail` document for the contract-expired backstop (SRS §5.7
 * shape). Always Romanian. `type`/`audience` are fixed here, one place per
 * template. `relatedId`/`ownerId` come from the caller: `dailyScheduler`
 * knows the tenancy's ID and its own `ownerId` (the single admin's uid).
 *
 * @param fields  { name, email, property, endDate, url, relatedId, ownerId }
 *                — RAW, unformatted; `email` is ADMIN_EMAIL, `name` is the
 *                tenant's name.
 */
function buildContractExpiredBackstopEmail(fields) {
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
    type: 'contract-expired',
    audience: 'admin',
    relatedId: fields.relatedId ?? null,
    ownerId: fields.ownerId ?? null,
  }
}

module.exports = { buildContractExpiredBackstopEmail }
