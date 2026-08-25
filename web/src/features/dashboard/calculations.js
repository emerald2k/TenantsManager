/**
 * Pure display-derivation functions for the admin dashboard (FR-DASH-01/02/03,
 * SRS §5.3) and the Current month list. No Firestore/React imports — every
 * function here takes already-fetched data and returns a number/string/enum.
 * The formulas are the M4 sub-stage 7 plan's pinned decisions, not
 * independent design choices — see the plan doc's "Decisions already pinned"
 * section for the full reasoning (especially why "on occupied properties"
 * can never silently drop a nonzero amount, given endTenancy's currentBalance
 * === 0 precondition).
 */

export function calculateOutstandingThisMonth(reports, occupiedPropertyIds) {
  const occupied = new Set(occupiedPropertyIds)
  return reports
    .filter(
      (report) => report.status === 'signed' && occupied.has(report.propertyId),
    )
    .reduce(
      (sum, report) => sum + (report.finalTotal - (report.amountPaid ?? 0)),
      0,
    )
}

export function calculateTotalArrears(activeTenancies) {
  return activeTenancies
    .filter((tenancy) => (tenancy.currentBalance ?? 0) > 0)
    .reduce((sum, tenancy) => sum + tenancy.currentBalance, 0)
}

/**
 * Badge precedence (pinned, do not reorder):
 * no signed report -> not-entered; paid -> paid; partial -> partial (even
 * past due); unpaid/absent + past due -> overdue; unpaid/absent + in term
 * -> signed. `paymentStatus` absent (report never had a payment marked)
 * falls through to the same branch as 'unpaid' by construction below.
 *
 * Found and fixed at M8 stage 10: this last branch used to return the
 * literal string `'published'` — the exact value CLAUDE.md §5.5 and SRS
 * §5.5 both name as the one status word never allowed to survive ("renamed
 * to 'signed' at v4.3"). It reached the admin as real badge text ("Publicat")
 * on `/admin/current-month`, not just an internal key name.
 */
export function deriveReportStatusBadge(report, referenceDate = new Date()) {
  if (!report || report.status !== 'signed') return 'not-entered'
  if (report.paymentStatus === 'paid') return 'paid'
  if (report.paymentStatus === 'partial') return 'partial'
  return isPastDueDate(report.dueDate, referenceDate) ? 'overdue' : 'signed'
}

/** ISO date string split into a LOCAL Date (not `new Date(isoString)`, which
 * parses as UTC and would misreport the day near midnight in Bucharest —
 * same reasoning as functions/src/mail-templates/reportNotification.js's
 * formatDueDate). Compares local midnight-to-midnight: the due date itself
 * is never "overdue" yet.
 *
 * Exported (M8 stage 12): the payments ledger's own overdue derivation
 * (`features/payments/calculations.js`) reuses this exact comparison rather
 * than re-implementing it — same reasoning as `billedForReport` being
 * shared rather than duplicated. */
export function isPastDueDate(dueDate, referenceDate) {
  const [year, month, day] = dueDate.split('-').map(Number)
  const due = new Date(year, month - 1, day)
  const today = new Date(
    referenceDate.getFullYear(),
    referenceDate.getMonth(),
    referenceDate.getDate(),
  )
  return today > due
}

/**
 * FR-DASH-03's "first launch": zero properties AND zero tenants. Sourced
 * from `useProperties()` (default, includeArchived: false — reaching first
 * launch requires never having archived a property either, since archiving
 * presupposes one existed) and `useUsers()` (every `users` doc IS a tenant
 * account — see tenants/hooks.js's own doc-comment on that collection).
 */
export function isFirstLaunch(properties, users) {
  return properties.length === 0 && users.length === 0
}

function localeFor(language) {
  return language === 'ro' ? 'ro-RO' : 'en-US'
}

/** "iulie 2026" / "July 2026" — same Intl approach as the server-side
 * formatMonthYear (functions/src/mail-templates/reportNotification.js),
 * resolved from react-i18next's current language client-side. */
export function formatMonthYearLabel(month, year, language) {
  const date = new Date(year, month - 1, 1)
  return new Intl.DateTimeFormat(localeFor(language), {
    month: 'long',
    year: 'numeric',
  }).format(date)
}
