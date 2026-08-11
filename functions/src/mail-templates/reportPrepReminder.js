/**
 * Template A6 — report preparation reminder (SRS Appendix A, FR-REP-15).
 * Sent by `dailyScheduler` `reportReminderDaysBefore` days before the
 * tenancy's due day, only if no signed report exists yet for the current
 * month (selection logic: `shouldSendReportReminder`, schedulerLogic.js).
 *
 * To the ADMIN, Romanian exclusively (NFR-LOC-04) — same as A5. The
 * simplest template in this directory: a single-line body, no {url} — SRS
 * Appendix A6 does not include one (the admin is expected to open the app
 * and navigate to the property themselves), so none is invented here.
 */

const SUBJECT = ({ property }) => `Pregătește lista de plată — ${property}`

const BODY = ({ property, dueDate }) =>
  `Contul pentru ${property} are scadența pe ${dueDate}. ` +
  `Raportul lunii încă nu e semnat — pregătește costurile și emite lista.`

/** "05.08.2026" — dueDate is a plain ISO string ("2026-08-05"); same
 * treatment as expiryReminder.js's formatEndDate. */
function formatDueDate(isoDate) {
  const [year, month, day] = isoDate.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  return new Intl.DateTimeFormat('ro-RO', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date)
}

/**
 * Builds the `mail` document for the report preparation reminder (SRS §5.7
 * shape). Always Romanian.
 *
 * @param fields  { email, property, dueDate } — RAW, unformatted; `email`
 *                is ADMIN_EMAIL.
 */
function buildReportPrepReminderEmail(fields) {
  const values = {
    property: fields.property,
    dueDate: formatDueDate(fields.dueDate),
  }
  return {
    to: [fields.email],
    message: {
      subject: SUBJECT(values),
      text: BODY(values),
    },
  }
}

module.exports = { buildReportPrepReminderEmail }
