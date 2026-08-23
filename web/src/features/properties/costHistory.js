const DEFAULT_WINDOW_SIZE = 12

/**
 * Pivots a property's SIGNED reports into the cost-history table shape
 * (FR-PROP-09). Pure — no React, no Firestore, testable in isolation like
 * `dueDayCountdown.js`.
 *
 * ROWS ARE MONTHS, NOT REPORTS (M8, FR-REP-14). Since the re-keying,
 * `monthlyReports` is keyed by tenancy, not property, so a mid-month
 * hand-over can leave TWO signed reports for the same property in the same
 * calendar month — one per tenancy. Reports are grouped by (year, month)
 * FIRST; every sum below (rent, maintenance, each service, other, total) is
 * a sum ACROSS the group's sibling reports, so a hand-over month occupies
 * exactly one row and one slot in the 12-month window, not two. The common
 * case — one report per month — is a group of size one, so every existing
 * behaviour is unchanged for it.
 *
 * COLUMNS (`services`): the union of `serviceId` across every report in the
 * reports actually included in the result, in first-seen order. A service
 * removed from the property still gets a column for the months it existed
 * in (FR-PROP-08) — the caller decides which reports to pass in, this
 * function never filters by the property's CURRENT service list. The
 * column's displayed `name` is whichever report's snapshot is seen LAST
 * while scanning in ascending chronological order — i.e. the most recent
 * snapshot of that service.
 *
 * ROWS: one per (year, month), ascending chronological order (oldest on
 * top, SRS §5.3) — regardless of `windowSize`, which only decides which
 * periods survive, not how the survivors are ordered afterward.
 *
 * `windowSize` (default 12): keeps the most RECENT `windowSize` PERIODS —
 * not reports, so a hand-over month's two reports still count as one slot.
 * "Most recent" is decided BEFORE the ascending sort — the window always
 * anchors to the newest period, never to whatever happens to sort first.
 * Pass `reports.length` (or `Infinity`) for the unwindowed "Show all" view.
 *
 * Each row's per-service cell is the SUM of that `serviceId`'s `amount`
 * across every sibling report that has it, or `null` if NONE of the
 * group's reports has it — `null` (absence) is deliberately distinct from
 * `0` (FR-REP-03: a service billed at zero still appears in the report, so
 * `0` is a real recorded value, not a gap). `other` is the SUM of
 * `otherExpenses[].amount` across every sibling report — a single column,
 * not one per expense (no stable key to pivot on, unlike services). `total`
 * is the SUM of `finalTotal` across the group's siblings (FR-REP-04c —
 * `calculatedTotal` never appears here). **`total` is still the pre-stage-5
 * formula** (a plain sum of `finalTotal`, not the billed-amount formula
 * SRS §5.3 eventually specifies) — the corrected formula is stage 5's
 * change, not this one's; this function only owns the sibling GROUPING that
 * the re-key requires.
 */
export function buildCostHistory(
  reports,
  { windowSize = DEFAULT_WINDOW_SIZE } = {},
) {
  const byPeriod = new Map()
  for (const report of reports) {
    const key = `${report.year}-${String(report.month).padStart(2, '0')}`
    const group = byPeriod.get(key) ?? []
    group.push(report)
    byPeriod.set(key, group)
  }
  const periods = Array.from(byPeriod.values())

  const descending = [...periods].sort((a, b) =>
    a[0].year !== b[0].year ? b[0].year - a[0].year : b[0].month - a[0].month,
  )
  const windowed = descending.slice(0, windowSize)
  const ascending = [...windowed].sort((a, b) =>
    a[0].year !== b[0].year ? a[0].year - b[0].year : a[0].month - b[0].month,
  )

  const serviceNameById = new Map()
  for (const group of ascending) {
    for (const report of group) {
      for (const line of report.serviceCosts ?? []) {
        serviceNameById.set(line.serviceId, line.name)
      }
    }
  }
  const services = Array.from(serviceNameById, ([serviceId, name]) => ({
    serviceId,
    name,
  }))

  const rows = ascending.map((group) => {
    const serviceAmounts = {}
    for (const { serviceId } of services) {
      const linesForService = group
        .map((report) =>
          (report.serviceCosts ?? []).find(
            (candidate) => candidate.serviceId === serviceId,
          ),
        )
        .filter(Boolean)
      serviceAmounts[serviceId] =
        linesForService.length === 0
          ? null
          : linesForService.reduce((sum, line) => sum + (line.amount ?? 0), 0)
    }
    const rent = group.reduce((sum, r) => sum + (r.rent?.amount ?? 0), 0)
    const maintenance = group.reduce(
      (sum, r) => sum + (r.maintenance?.amount ?? 0),
      0,
    )
    const other = group.reduce(
      (sum, r) =>
        sum +
        (r.otherExpenses ?? []).reduce(
          (lineSum, line) => lineSum + (Number(line.amount) || 0),
          0,
        ),
      0,
    )
    const total = group.reduce((sum, r) => sum + (r.finalTotal ?? 0), 0)

    return {
      reportIds: group.map((r) => r.id),
      month: group[0].month,
      year: group[0].year,
      rent,
      maintenance,
      services: serviceAmounts,
      other,
      total,
    }
  })

  return { rows, services }
}
