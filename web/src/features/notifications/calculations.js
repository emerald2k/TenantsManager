/**
 * Pure helpers for the notification log (SRS §5.3 `/admin/notifications`,
 * FR-NLOG-01…08, M8 stage 14 commit B). No Firestore, no React — everything
 * here is unit-tested directly in the fast band.
 *
 * The page reads the `notifications` projection (SRS §6), never `mail`:
 * bodies are never exposed to the client (FR-NLOG-02), which is why there is
 * no `body`/`message` field anywhere below.
 */

/** FR-NLOG-07: the log shows a rolling 12-month window, stated on screen. */
export const NOTIFICATION_WINDOW_MONTHS = 12

/**
 * The oldest `sentAt` still inside the window, as a `Date`. `from` is
 * injectable so tests are not clock-dependent; production passes nothing and
 * gets "now".
 */
export function windowCutoff(from = new Date()) {
  const cutoff = new Date(from)
  cutoff.setMonth(cutoff.getMonth() - NOTIFICATION_WINDOW_MONTHS)
  return cutoff
}

/**
 * A Firestore `Timestamp` (`.toDate()`), a `Date`, an ISO string or millis —
 * all normalised to a `Date`. Returns `null` for a missing value: a
 * `notifications` row written a tick before its `serverTimestamp()` resolves
 * has no `sentAt` yet, and that must not crash the table.
 */
export function toDate(value) {
  if (value == null) return null
  if (typeof value.toDate === 'function') return value.toDate()
  const d = value instanceof Date ? value : new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

/**
 * ISO date + time, admin-facing (SRS §5.5: "admin surfaces … display ISO
 * dates, and timestamps additionally show the time"). `YYYY-MM-DD HH:mm` in
 * local time. A row with no resolved `sentAt` yet renders an em dash — the
 * one place a dash is allowed here, and only because it is inside an
 * aligned table column (NFR-UX-08 rule 1's stated exception).
 */
export function formatSentAt(value) {
  const d = toDate(value)
  if (!d) return '—'
  const pad = (n) => String(n).padStart(2, '0')
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}`
  )
}

/** Most recent first. Rows with no `sentAt` yet sort to the top (they are the
 * newest — just written). Pure sort on a copy; never a Firestore `orderBy`,
 * which would silently drop any row missing the ordered field (SRS §6). */
export function sortBySentAtDesc(rows) {
  return [...rows].sort((a, b) => {
    const da = toDate(a.sentAt)
    const dbb = toDate(b.sentAt)
    if (!da && !dbb) return 0
    if (!da) return -1
    if (!dbb) return 1
    return dbb.getTime() - da.getTime()
  })
}

/** Keep only rows whose `sentAt` is within the window; a row with no
 * `sentAt` yet is in-window (it was just written). */
export function withinWindow(rows, from = new Date()) {
  const cutoff = windowCutoff(from).getTime()
  return rows.filter((row) => {
    const d = toDate(row.sentAt)
    return !d || d.getTime() >= cutoff
  })
}

/**
 * FR-NLOG-03's `type` → i18n key. Keyed on the exact stored string the
 * sending function wrote; an unknown value (a template added without a
 * label) falls back to the raw string rather than a blank cell.
 */
export const TYPE_LABEL_KEY = {
  credentials: 'credentials',
  'credentials-resent': 'credentialsResent',
  'report-new': 'reportNew',
  'report-updated': 'reportUpdated',
  'arrears-reminder': 'arrearsReminder',
  'contract-expiry': 'contractExpiry',
  'report-preparation': 'reportPreparation',
  'tenancy-assigned': 'tenancyAssigned',
  'payment-upcoming': 'paymentUpcoming',
  'payment-recorded': 'paymentRecorded',
  'contract-expired': 'contractExpired',
  'daily-heartbeat': 'dailyHeartbeat',
  'balance-mismatch': 'balanceMismatch',
}

/** FR-NLOG-05's `deliveryState` → i18n key. The extension emits all five. */
export const DELIVERY_LABEL_KEY = {
  PENDING: 'pending',
  PROCESSING: 'processing',
  SUCCESS: 'success',
  ERROR: 'error',
  RETRY: 'retry',
}

/** Badge tone per delivery state. No state is conveyed by colour alone
 * (SRS §5.5) — the badge always carries its word; the tone only reinforces
 * it. ERROR is the only one that needs to catch the eye. */
export const DELIVERY_TONE = {
  PENDING: 'bg-muted text-muted-foreground',
  PROCESSING: 'bg-muted text-muted-foreground',
  SUCCESS: 'bg-primary/10 text-primary',
  ERROR: 'bg-destructive/10 text-destructive',
  RETRY: 'bg-muted text-muted-foreground',
}
