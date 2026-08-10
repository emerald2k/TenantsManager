const DEFAULT_WINDOW_SIZE = 12

/**
 * Pivots a property's SIGNED reports into the cost-history table shape
 * (FR-PROP-09). Pure — no React, no Firestore, testable in isolation like
 * `dueDayCountdown.js`.
 *
 * COLUMNS (`services`): the union of `serviceId` across the reports actually
 * included in the result, in first-seen order. A service removed from the
 * property still gets a column for the months it existed in (FR-PROP-08) —
 * the caller decides which reports to pass in, this function never filters
 * by the property's CURRENT service list. The column's displayed `name` is
 * whichever report's snapshot is seen LAST while scanning in ascending
 * chronological order — i.e. the most recent snapshot of that service.
 *
 * ROWS: one per report, ascending chronological order (oldest on top,
 * SRS §5.3) — regardless of `windowSize`, which only decides which reports
 * survive, not how the survivors are ordered afterward.
 *
 * `windowSize` (default 12): keeps the most RECENT `windowSize` reports.
 * "Most recent" is decided BEFORE the ascending sort — the window always
 * anchors to the newest report, never to whatever happens to sort first.
 * Pass `reports.length` (or `Infinity`) for the unwindowed "Show all" view.
 *
 * Each row's per-service cell is the line's `amount` if that `serviceId`
 * appears in that report's `serviceCosts`, or `null` if it does not — `null`
 * (absence) is deliberately distinct from `0` (FR-REP-03: a service billed
 * at zero still appears in the report, so `0` is a real recorded value, not
 * a gap). `other` is the SUM of `otherExpenses[].amount` for that report —
 * a single column, not one per expense (no stable key to pivot on, unlike
 * services). `total` is always `finalTotal` (FR-REP-04c) — `calculatedTotal`
 * never appears here.
 */
export function buildCostHistory(
  reports,
  { windowSize = DEFAULT_WINDOW_SIZE } = {},
) {
  const descending = [...reports].sort((a, b) =>
    a.year !== b.year ? b.year - a.year : b.month - a.month,
  )
  const windowed = descending.slice(0, windowSize)
  const ascending = [...windowed].sort((a, b) =>
    a.year !== b.year ? a.year - b.year : a.month - b.month,
  )

  const serviceNameById = new Map()
  for (const report of ascending) {
    for (const line of report.serviceCosts ?? []) {
      serviceNameById.set(line.serviceId, line.name)
    }
  }
  const services = Array.from(serviceNameById, ([serviceId, name]) => ({
    serviceId,
    name,
  }))

  const rows = ascending.map((report) => {
    const serviceAmounts = {}
    for (const { serviceId } of services) {
      const line = (report.serviceCosts ?? []).find(
        (candidate) => candidate.serviceId === serviceId,
      )
      serviceAmounts[serviceId] = line ? (line.amount ?? 0) : null
    }
    const other = (report.otherExpenses ?? []).reduce(
      (sum, line) => sum + (Number(line.amount) || 0),
      0,
    )

    return {
      reportId: report.id,
      month: report.month,
      year: report.year,
      rent: report.rent?.amount ?? 0,
      maintenance: report.maintenance?.amount ?? 0,
      services: serviceAmounts,
      other,
      total: report.finalTotal ?? 0,
    }
  })

  return { rows, services }
}
