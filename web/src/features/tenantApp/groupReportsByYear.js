/**
 * Groups an ALREADY-SORTED report array (newest year first, newest month
 * first within a year — `useMySignedReports`'s own contract, sub-stage 2)
 * into per-year buckets, in a single left-to-right pass. Because the input
 * is already grouped-adjacent by construction (the same year is never split
 * by a different year in between), this never re-sorts and never uses a
 * `Map` — it just starts a new bucket whenever `year` changes, preserving
 * the hook's order exactly (M5 sub-stage 5 plan, Task 2).
 *
 * @param reports the array `useMySignedReports` returns.
 * @returns [{ year, reports: [...] }] — one entry per distinct year, in the
 *   input's own order.
 */
export function groupReportsByYear(reports) {
  const groups = []
  let current = null

  for (const report of reports) {
    if (!current || current.year !== report.year) {
      current = { year: report.year, reports: [] }
      groups.push(current)
    }
    current.reports.push(report)
  }

  return groups
}
