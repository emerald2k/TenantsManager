/**
 * The client-side half of the balance-recalculation formula (M8 stage 7,
 * FR-SYS-05a) — the SAME identity `computeBalanceFromSignedReports`
 * (functions/src/reports.js) computes server-side: the most recent signed
 * report's `finalTotal − amountPaid − roundingSurplus`, never a sum across
 * reports. Duplicated deliberately, not imported — `functions/` deploys
 * without `web/`, the same cross-package reason CLAUDE.md §7 already
 * documents for `FINAL_TOTAL_EPSILON` and the DST date arithmetic.
 *
 * This is a PREVIEW only — what the "Recalculate balance" control shows the
 * admin before they confirm. The actual write always recomputes
 * independently, server-side, at confirm time (`recalculateTenancyBalance`),
 * so a report signed in the gap between this preview and the confirm click
 * is still picked up correctly; this function existing twice can never make
 * the WRITE wrong, only the preview briefly stale, which the confirm dialog
 * itself closes by recomputing again server-side.
 */
export function computeBalanceFromReports(reports) {
  if (!reports || reports.length === 0) return 0

  const mostRecent = [...reports].sort(
    (a, b) => b.year - a.year || b.month - a.month,
  )[0]

  return (
    (mostRecent.finalTotal ?? 0) -
    (mostRecent.amountPaid ?? 0) -
    (mostRecent.roundingSurplus ?? 0)
  )
}

/** The same chain, oldest first — what the confirm dialog lists under the
 * two totals, so the admin can see WHICH reports the recomputation is
 * actually built from, not just trust the final number. */
export function sortReportsChronologically(reports) {
  return [...(reports ?? [])].sort(
    (a, b) => a.year - b.year || a.month - b.month,
  )
}
