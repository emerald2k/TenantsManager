/**
 * The Billed formula (SRS §5.3/§6, FR-DASH-09, FR-PROP-09) — "the same
 * formula" cited by both requirements, now written exactly once so the two
 * call sites can never drift apart the way `buildCostHistory`'s `total`
 * silently did before M8 stage 5 (it summed raw `finalTotal`, which already
 * contains the carry-forward, double-counting it once per report and twice
 * on a hand-over month).
 *
 * Billed for a report = what THAT report's own rent, maintenance, services
 * and other expenses actually billed — `finalTotal` minus the balance
 * carried IN from the previous month, plus any credit carried in (which
 * reduced the bill), minus any manual-rounding surplus (which inflated
 * `finalTotal` above what was actually owed, FR-REP-04a/04c). Never a plain
 * `finalTotal`, which already contains all three.
 *
 * Per-REPORT, not per-period: a hand-over month groups sibling reports
 * (`buildCostHistory`) by summing THIS function's result across them, never
 * by summing `finalTotal` first and subtracting once — each sibling has its
 * own, independent carry-forward.
 */
export function billedForReport(report) {
  return (
    (report.finalTotal ?? 0) -
    (report.previousMonthArrears ?? 0) +
    (report.previousMonthCredit ?? 0) -
    (report.roundingSurplus ?? 0)
  )
}
