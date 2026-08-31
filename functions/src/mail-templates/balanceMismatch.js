/**
 * Template A13 — balance mismatch (SRS Appendix A, FR-SYS-05). Sent by
 * `reconcileBalances`, weekly, ONLY when a mismatch is actually found —
 * the opposite of A12: here silence is the good news.
 *
 * Read-only by design: this template exists to REPORT a divergence, never
 * to repair it. `arrearsAmount` is the RECOMPUTED balance (from the
 * tenancy's own chain of signed reports), not the difference between the
 * two figures — decided explicitly (Bogdan, M8 stage 7) after the SRS's own
 * wording used `{arrearsAmount}` two ways in the same template (the subject
 * calls it "diferență", the body clearly means the recomputed value: "dă
 * {arrearsAmount} lei"). The body is unambiguous and is what the admin
 * actually needs to act on — the two raw numbers, side by side, so they can
 * judge the divergence themselves rather than trust a computed delta.
 *
 * To the ADMIN, Romanian exclusively (NFR-LOC-04) — same as A5/A6/A12.
 */

const SUBJECT = ({ name, arrearsAmount }) =>
  `Verificare solduri: ${name} — diferență ${arrearsAmount} lei`

const BODY = ({ name, property, total, arrearsAmount, url }) =>
  `Soldul stocat pentru ${name} (${property}) este ${total} lei, dar recalcularea din rapoartele semnate dă ${arrearsAmount} lei.\n` +
  `Nu s-a modificat nimic automat. Deschide contractul: ${url}`

/** "1.500,00" — no currency suffix: both lines above append " lei"
 * themselves, same convention as arrearsReminder.js's formatAmount. */
function formatAmount(amount) {
  return new Intl.NumberFormat('ro-RO', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(amount) || 0)
}

/**
 * Builds the `mail` document for the balance-mismatch report (SRS §5.7
 * shape). Always Romanian.
 *
 * `type`/`audience` (FR-NLOG-03/04) are fixed here, one place per template.
 * `relatedId` is the tenancy's ID: unlike the heartbeat, this template
 * always names ONE specific tenancy (`reconcileBalances` sends one email
 * per mismatch found, in its per-tenancy loop) — a real referent, not a
 * run-level summary. `ownerId` comes from that same tenancy's own
 * `ownerId` field (the single admin's uid), since there is no caller uid
 * to copy on a scheduled function.
 *
 * @param fields  { email, name, property, total, arrearsAmount, url,
 *                  relatedId, ownerId } — `email` is ADMIN_EMAIL; `name` is
 *                the tenant's name; `total` is the STORED `currentBalance`;
 *                `arrearsAmount` is the RECOMPUTED balance — both RAW,
 *                formatted here.
 */
function buildBalanceMismatchEmail(fields) {
  const values = {
    name: fields.name,
    property: fields.property,
    total: formatAmount(fields.total),
    arrearsAmount: formatAmount(fields.arrearsAmount),
    url: fields.url,
  }
  return {
    to: [fields.email],
    message: {
      subject: SUBJECT(values),
      text: BODY(values),
    },
    type: 'balance-mismatch',
    audience: 'admin',
    relatedId: fields.relatedId ?? null,
    ownerId: fields.ownerId ?? null,
  }
}

module.exports = { buildBalanceMismatchEmail }
