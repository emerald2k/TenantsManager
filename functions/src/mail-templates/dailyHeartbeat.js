/**
 * Template A12 — daily heartbeat (SRS Appendix A, FR-SYS-06). Sent by
 * `dailyScheduler` at the END of every completed run, regardless of whether
 * any reminder fired.
 *
 * Deliberately dull, and deliberately daily: the content is almost never
 * interesting, its ABSENCE is. A scheduler that has died sends nothing, and
 * a quiet month looks identical to one in which everybody paid — this is
 * the only signal that tells the two apart, since a missed run leaves no
 * row anywhere else (no `notifications` projection, nothing in `mail`).
 *
 * To the ADMIN, Romanian exclusively (NFR-LOC-04) — same as A5/A6. The
 * placeholders are the SHARED set, reused rather than three new ones
 * invented for a single template (SRS's own wording): `{name}` carries the
 * tenancy count here, `{total}` the emails-queued count, `{arrearsAmount}`
 * the errors-caught count — none of them money, unlike every other template
 * that uses these same three names. No formatting beyond a plain integer
 * coercion; these are counts, not currency.
 */

const SUBJECT = ({ monthYear }) => `Automatizări OK — ${monthYear}`

const BODY = ({ name, total, arrearsAmount }) =>
  `Rulare încheiată: ${name} contracte evaluate, ${total} emailuri trimise, ${arrearsAmount} erori.`

/** "august 2026" — labels WHICH run this is, coarse on purpose (the job
 * fires daily; the label is a month, not a day) — same
 * Intl.DateTimeFormat('ro-RO', {month:'long', year:'numeric'}) shape as
 * reportNotification.js's formatMonthYear, but built from `today`
 * ('YYYY-MM-DD') rather than a report's separate month/year fields. */
function formatMonthYear(today) {
  const [year, month] = today.split('-').map(Number)
  const date = new Date(year, month - 1, 1)
  return new Intl.DateTimeFormat('ro-RO', {
    month: 'long',
    year: 'numeric',
  }).format(date)
}

/**
 * Builds the `mail` document for the daily heartbeat (SRS §5.7 shape).
 * Always Romanian.
 *
 * `type`/`audience` (FR-NLOG-03/04) are fixed here, one place per template.
 * `relatedId` is always `null` — a run-level summary has no single
 * report/tenancy/user referent, unlike every other write site in
 * `dailyScheduler`. `ownerId` likewise has no caller uid to copy (no admin
 * request, no per-tenancy document to read one from); left `null`, same as
 * `relatedId` — consistent with the schema's own "not queried on in M8"
 * note (SRS §6).
 *
 * @param fields  { email, today, tenanciesEvaluated, emailsQueued, errors } —
 *                `email` is ADMIN_EMAIL; `today` is 'YYYY-MM-DD'
 *                (schedulerLogic.js's `todayInBucharest`); the three counts
 *                are plain integers.
 */
function buildDailyHeartbeatEmail(fields) {
  const values = {
    monthYear: formatMonthYear(fields.today),
    name: fields.tenanciesEvaluated,
    total: fields.emailsQueued,
    arrearsAmount: fields.errors,
  }
  return {
    to: [fields.email],
    message: {
      subject: SUBJECT(values),
      text: BODY(values),
    },
    type: 'daily-heartbeat',
    audience: 'admin',
    relatedId: null,
    ownerId: null,
  }
}

module.exports = { buildDailyHeartbeatEmail }
