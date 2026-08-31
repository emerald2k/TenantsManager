/**
 * Pure display-derivation functions for the admin dashboard (FR-DASH-01,
 * 04…14, SRS §5.3) and the shared Current-month table. No Firestore/React
 * imports — every function here takes already-fetched data and returns a
 * number/string/enum/array.
 *
 * REWRITTEN WHOLESALE at M8 stage 15. The M4 sub-stage 7 originals
 * (`calculateOutstandingThisMonth`, `calculateTotalArrears`) summed
 * `finalTotal − amountPaid` across reports — which double-counts every
 * carried-forward balance (SRS §6: "three unpaid months at 2000 yields
 * 12000 against a real 6000"). The M8 model reads the denormalized
 * `tenancies.currentBalance` for the current month (FR-DASH-04a, NFR-PERF-05)
 * and, only when the selector steps back, the single most-recent signed
 * report per tenancy (`balanceAsOf`). The Billed history figure reuses
 * `billedForReport` (`../reports/billing.js`) — the same one-and-only
 * definition FR-PROP-09's cost history uses, never a raw `finalTotal`.
 */

import { billedForReport } from '@/features/reports/billing'
import { FINAL_TOTAL_EPSILON, buildDueDate } from '@/features/reports/schema'

const HISTORY_WINDOW_MONTHS = 12

/**
 * FR-DASH-03's "first launch": zero properties AND zero tenants. Sourced
 * from `useProperties()` (default, includeArchived: false — reaching first
 * launch requires never having archived a property either, since archiving
 * presupposes one existed) and `useUsers()` (every `users` doc IS a tenant
 * account — see tenants/hooks.js's own doc-comment on that collection).
 * FR-DASH-10: this state survives the redesign — it is NOT the same as
 * "a property exists but no report is signed yet", which renders real zeros.
 */
export function isFirstLaunch(properties, users) {
  return properties.length === 0 && users.length === 0
}

/** ISO date string split into a LOCAL Date (not `new Date(isoString)`, which
 * parses as UTC and would misreport the day near midnight in Bucharest —
 * same reasoning as functions/src/mail-templates/reportNotification.js's
 * formatDueDate). Compares local midnight-to-midnight: the due date itself
 * is never "overdue" yet.
 *
 * Exported: the payments ledger's own overdue derivation
 * (`features/payments/calculations.js`) reuses this exact comparison. */
export function isPastDueDate(dueDate, referenceDate) {
  if (!dueDate) return false
  const [year, month, day] = dueDate.split('-').map(Number)
  const due = new Date(year, month - 1, day)
  const today = new Date(
    referenceDate.getFullYear(),
    referenceDate.getMonth(),
    referenceDate.getDate(),
  )
  return today > due
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

/** Short month label for the history chart's x-axis ("sep", "oct", …). */
export function formatShortMonthLabel(month, year, language) {
  const date = new Date(year, month - 1, 1)
  return new Intl.DateTimeFormat(localeFor(language), {
    month: 'short',
  }).format(date)
}

/** Month name alone — "iulie" / "July", no year. The Payment column's
 * "Restanță din {month}" reading (FR-DASH-02c) names the month the debt is
 * from; the approved mockup row is month-only ("Restanță din iulie"). */
export function formatMonthNameLabel(month, year, language) {
  const date = new Date(year, month - 1, 1)
  return new Intl.DateTimeFormat(localeFor(language), { month: 'long' }).format(
    date,
  )
}

/** `{ month, year }` shifted by `delta` whole months, year rolled at the
 * edges. Shared by both the dashboard selector and `/admin/current-month`
 * (FR-DASH-02a: same selector on both). */
export function shiftMonth({ month, year }, delta) {
  const zeroBased = month - 1 + delta
  return {
    month: (((zeroBased % 12) + 12) % 12) + 1,
    year: year + Math.floor(zeroBased / 12),
  }
}

/** True when a is strictly before b (both `{ month, year }`). */
function isBefore(a, b) {
  return a.year !== b.year ? a.year < b.year : a.month < b.month
}

/** True when a is the same (month, year) as, or before, b. */
function isOnOrBefore(a, b) {
  return !isBefore(b, a)
}

/**
 * FR-DASH-04 — one tenancy's balance AS OF the end of month `M`: its single
 * MOST RECENT signed report whose (year, month) ≤ M, then
 * `finalTotal − amountPaid − (roundingSurplus ?? 0)`. Never a sum across
 * reports — that report's `finalTotal` already contains every earlier
 * month's carry-forward (FR-REP-04), so summing would count each unpaid
 * balance once per month it survived.
 *
 * `signedReports` is THIS tenancy's signed reports only (the caller groups
 * by `tenancyId`). No report on or before M -> 0. `amountPaid` is read at
 * its CURRENT value, not reconstructed as-of-M: stepping back to January
 * and seeing a January report that has since been paid reads as paid,
 * deliberately — the tile answers "what is still owed for that month,
 * given everything known now", not "what did the ledger look like then".
 *
 * Identical to `tenancies.currentBalance` when M is the current month (the
 * most-recent-signed-≤-now report IS the most-recent-signed report). The
 * page uses `currentBalance` directly there (NFR-PERF-05); this function is
 * the general form, and a calculations test pins the two equal.
 */
export function balanceAsOf(signedReports, M) {
  const eligible = signedReports.filter((r) => isOnOrBefore(r, M))
  if (eligible.length === 0) return 0
  const mostRecent = eligible.sort((a, b) =>
    a.year !== b.year ? b.year - a.year : b.month - a.month,
  )[0]
  return (
    (mostRecent.finalTotal ?? 0) -
    (mostRecent.amountPaid ?? 0) -
    (mostRecent.roundingSurplus ?? 0)
  )
}

/**
 * FR-DASH-04 — Expected (to collect) as of month M: `Σ max(0, balanceAsOf)`
 * over active tenancies. `signedReportsByTenancy` is `Map<tenancyId, [...]>`.
 * Arrears from earlier months are already inside each figure, never added
 * separately — that is exactly what makes this "how much should land in my
 * account".
 */
export function expectedForMonth(activeTenancies, signedReportsByTenancy, M) {
  return activeTenancies.reduce(
    (sum, t) =>
      sum + Math.max(0, balanceAsOf(signedReportsByTenancy.get(t.id) ?? [], M)),
    0,
  )
}

/**
 * The reference instant FR-DASH-06 ages against: "the past, relative to the
 * end of the selected month", computed as `min(today, endOfMonth(M))`. For
 * the CURRENT month that is `today` (a report due later this month is not
 * overdue yet — the parenthetical in FR-DASH-06). For a PAST month it is the
 * last day of that month (`today` is already beyond it). The selector's
 * forward control is disabled at the current month, so M is not normally a
 * future month; if it ever were (a session left open across a month
 * boundary), the `min` degrades safely to `today` rather than counting a
 * not-yet-due report as overdue.
 */
export function overdueReferenceDate(M, today = new Date()) {
  const endOfMonth = new Date(M.year, M.month, 0) // day 0 of next month
  return today < endOfMonth ? today : endOfMonth
}

/**
 * FR-DASH-06 — Overdue, the AGED portion of what is owed, per tenancy:
 * `min( cap, Σ over that tenancy's signed reports whose dueDate is past
 * `overdueReferenceDate(M)` of (billedForReport(r) − amountPaid) )`, floored
 * at 0, summed over active tenancies, floored at 0.
 *
 * The `cap` is `tenancies.currentBalance` when M is the current month — the
 * denormalized field FR-DASH-06 names literally and NFR-PERF-05 requires
 * ("reads the denormalized `currentBalance` rather than recomputing it") —
 * and `balanceAsOf(reports, M)` (the as-of-M balance) when the selector has
 * stepped back. `isCurrentMonth` decides which.
 *
 * `billedForReport(r) − (amountPaid ?? 0)` is FR-DASH-06's
 * `finalTotal − amountPaid − previousMonthArrears + previousMonthCredit −
 * roundingSurplus` written with the shared helper — the unpaid part of that
 * month's OWN bill, not counting the balance it carried in. A strict subset
 * of Expected, shown as containment ("Expected X · of which overdue Y"),
 * never an independent total.
 */
export function overdueForMonth(
  activeTenancies,
  signedReportsByTenancy,
  M,
  { today = new Date(), isCurrentMonth = false } = {},
) {
  const ref = overdueReferenceDate(M, today)
  const total = activeTenancies.reduce((sum, t) => {
    const reports = signedReportsByTenancy.get(t.id) ?? []
    const aged = reports
      .filter((r) => isPastDueDate(r.dueDate, ref))
      .reduce((s, r) => s + (billedForReport(r) - (r.amountPaid ?? 0)), 0)
    const cap = isCurrentMonth
      ? (t.currentBalance ?? 0)
      : balanceAsOf(reports, M)
    return sum + Math.max(0, Math.min(cap, aged))
  }, 0)
  return Math.max(0, total)
}

/**
 * FR-DASH-05 — Collected in month M: `Σ amountPaid` over reports whose
 * `paymentDate` (not their own month/year) falls in M. Cash basis — a
 * January report paid on 4 February counts to FEBRUARY. `reports` is the
 * whole fetched set (any status: a payment can be recorded then the report
 * unlocked, and the cash still moved).
 */
export function collectedForMonth(reports, M) {
  const prefix = `${M.year}-${String(M.month).padStart(2, '0')}`
  return reports
    .filter(
      (r) =>
        typeof r.paymentDate === 'string' && r.paymentDate.startsWith(prefix),
    )
    .reduce((sum, r) => sum + (r.amountPaid ?? 0), 0)
}

/**
 * FR-DASH-07 — Properties: total with occupied/free split, read from the
 * transactionally-maintained `properties.status` field, never a tenancy
 * query. `properties` is already archived-excluded (`useProperties()`
 * default). NOT scoped by the selector — occupancy has no per-month
 * history — and the label says so.
 */
export function propertyCounts(properties) {
  const occupied = properties.filter((p) => p.status === 'occupied').length
  return {
    total: properties.length,
    occupied,
    free: properties.length - occupied,
  }
}

/**
 * FR-DASH-12 — tenant credit in advance: `Σ max(0, −currentBalance)` over
 * ACTIVE tenancies. The mirror of Overdue; never netted against it (SRS
 * §5.3: opposite positions held by different people).
 */
export function creditInAdvance(activeTenancies) {
  return activeTenancies.reduce(
    (sum, t) => sum + Math.max(0, -(t.currentBalance ?? 0)),
    0,
  )
}

/**
 * FR-DASH-13 / FR-DASH-14 — the only place a departed renter's balance
 * stays visible (automated reminders stop at termination, FR-PAY-04).
 * `owedByFormer` = `Σ max(0, currentBalance)` and `owedToFormer` =
 * `Σ max(0, −currentBalance)` over ENDED tenancies. Each shown only when
 * non-zero; never inside Expected.
 */
export function formerRenterBalances(endedTenancies) {
  return endedTenancies.reduce(
    (acc, t) => {
      const b = t.currentBalance ?? 0
      acc.owedByFormer += Math.max(0, b)
      acc.owedToFormer += Math.max(0, -b)
      return acc
    },
    { owedByFormer: 0, owedToFormer: 0 },
  )
}

/**
 * FR-DASH-09 — Billed per month over the trailing `HISTORY_WINDOW_MONTHS`
 * ending at `{ month, year }` (the CURRENT month; the chart does NOT follow
 * the selector, SRS §5.3). Each month's value is `Σ billedForReport(r)`
 * over that month's SIGNED reports — the one Billed definition, never a raw
 * `finalTotal` (which still contains the carry-forward). A month with no
 * signed report is a real 0, not a gap (FR-DASH-09a: bars are not stable
 * over time). Returns oldest-first, one entry per month even when empty, so
 * the x-axis is continuous.
 */
export function billedHistory(signedReports, endMonth, endYear, language) {
  const months = []
  let cursor = { month: endMonth, year: endYear }
  for (let i = 0; i < HISTORY_WINDOW_MONTHS; i += 1) {
    months.unshift(cursor)
    cursor = shiftMonth(cursor, -1)
  }
  const billedByKey = new Map()
  for (const r of signedReports) {
    const key = `${r.year}-${r.month}`
    billedByKey.set(key, (billedByKey.get(key) ?? 0) + billedForReport(r))
  }
  return months.map(({ month, year }) => ({
    month,
    year,
    label: formatShortMonthLabel(month, year, language),
    billed: billedByKey.get(`${year}-${month}`) ?? 0,
    isCurrent: month === endMonth && year === endYear,
  }))
}

/** Whole days from ISO date `fromIso` to ISO date `toIso`, negative if
 * `toIso` is earlier. Both are read as (year, month, day) and put through
 * `Date.UTC` before subtracting — never a raw local-`Date` diff — so the
 * result is an exact integer, immune to Europe/Bucharest's DST transitions
 * (CLAUDE.md §7; same technique as `dueDayCountdown.js`'s own
 * `daysBetweenLocalDates`, re-implemented rather than shared for the same
 * cross-package reason). */
function daysBetweenIso(fromIso, toIso) {
  const [fy, fm, fd] = fromIso.split('-').map(Number)
  const [ty, tm, td] = toIso.split('-').map(Number)
  return (Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86400000
}

/** A `Date` rendered as a local ISO date string ("YYYY-MM-DD"), for feeding
 * `daysBetweenIso` a reference instant on the same footing as a report's
 * stored `dueDate`. */
function toIsoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`
}

/**
 * FR-DASH-02b — the OLDEST unsettled obligation: the first month of the
 * CURRENT unbroken run of debt ending at `M`. Defined through `balanceAsOf`,
 * not a per-report subtraction, so it can never disagree with "Remaining to
 * collect": walk the tenancy's signed reports newest-first and, for each,
 * ask what the as-of-that-month balance was; stop at the first month the
 * balance had already returned to zero. The oldest report still inside that
 * run is the answer. A partial payment in an early month that a later
 * full payment then cleared does NOT count — the balance went back to zero
 * in between, breaking the run. Returns `null` when the balance is settled
 * as of `M` (the caller then uses the selected month's due date).
 */
export function oldestUnsettledReport(signedReports, M) {
  const eligible = (signedReports ?? [])
    .filter((r) => Boolean(r.dueDate) && isOnOrBefore(r, M))
    .sort((a, b) => (a.year !== b.year ? a.year - b.year : a.month - b.month))

  let oldest = null
  for (let i = eligible.length - 1; i >= 0; i -= 1) {
    const asOfHere = balanceAsOf(eligible, {
      month: eligible[i].month,
      year: eligible[i].year,
    })
    if (asOfHere <= FINAL_TOTAL_EPSILON) break
    oldest = eligible[i]
  }
  return oldest
}

/**
 * FR-DASH-02b / FR-DASH-02c — the Current-month list rows, seven columns,
 * rendered identically on the dashboard's inline section and the standalone
 * `/admin/current-month` page from THIS one builder and the same data
 * (FR-DASH-02a). One row per ACTIVE tenancy (a free property has no active
 * tenancy, so it never appears). Sorted by property name.
 *
 * **`totalDue` and `remaining` answer different questions and must not be
 * conflated.** `totalDue` is the selected month's own bill — `finalTotal` of
 * the month's report, or `null` when there is no report for the month.
 * `remaining` is `balanceAsOf(tenancy, M)` — everything the tenancy still
 * owes as of the end of `M`, which for a property with no report this month
 * is still whatever the renter carried in from an earlier month. That is why
 * the "no report" row can show `totalDue` "—" and `remaining` "890" at the
 * same time: no bill was raised this month, but 890 is still owed from July.
 * `remaining` is NEVER `finalTotal − amountPaid` on the row — `finalTotal`
 * already contains `previousMonthArrears` (the double count fixed at stage
 * 5), a draft's `finalTotal` is not part of the settled balance at all, and
 * a "no report" row has no `finalTotal` to subtract from.
 *
 * @param monthReports the reports for month `M` (any status), joined to
 *   tenancies BY `tenancyId` — not `propertyId`: a mid-month hand-over
 *   (FR-REP-14) leaves two reports on one property for one month, one per
 *   tenancy, and the propertyId join could pick the wrong one.
 * @param signedReportsByTenancy `Map<tenancyId, signedReport[]>` — the same
 *   map the KPI tiles use, for `balanceAsOf` and `oldestUnsettledReport`.
 * @param M `{ month, year }` the selector is on.
 */
export function buildCurrentMonthRows(
  activeTenancies,
  monthReports,
  signedReportsByTenancy,
  M,
  referenceDate = new Date(),
) {
  const reportByTenancy = new Map(
    (monthReports ?? []).map((r) => [r.tenancyId, r]),
  )
  const byTenancy = signedReportsByTenancy ?? new Map()
  const refIso = toIsoDate(overdueReferenceDate(M, referenceDate))

  return (activeTenancies ?? [])
    .map((t) => {
      const monthReport = reportByTenancy.get(t.id) ?? null
      const reportState = !monthReport
        ? 'not-entered'
        : monthReport.status === 'signed'
          ? 'signed'
          : 'draft'

      const remaining = balanceAsOf(byTenancy.get(t.id) ?? [], M)
      const owes = remaining > FINAL_TOTAL_EPSILON
      const oldest = owes
        ? oldestUnsettledReport(byTenancy.get(t.id) ?? [], M)
        : null

      // The due date shown, and the small consequence line beneath it.
      let dueDate
      let dueConsequence
      let dueDayCount = 0
      if (owes) {
        dueDate =
          oldest?.dueDate ?? buildDueDate(M.year, M.month, t.dueDay ?? 1)
        const delta = daysBetweenIso(refIso, dueDate)
        if (delta < 0) {
          dueConsequence = 'late'
          dueDayCount = -delta
        } else {
          dueConsequence = 'upcoming'
          dueDayCount = delta
        }
      } else if (reportState === 'draft') {
        dueDate = buildDueDate(M.year, M.month, t.dueDay ?? 1)
        dueConsequence = 'after-signing'
      } else if (reportState === 'signed') {
        dueDate = monthReport.dueDate
        dueConsequence = 'on-time'
      } else {
        dueDate = buildDueDate(M.year, M.month, t.dueDay ?? 1)
        const delta = daysBetweenIso(refIso, dueDate)
        dueConsequence = delta < 0 ? 'nothing-due' : 'upcoming'
        dueDayCount = Math.max(0, delta)
      }
      const isOverdue = dueConsequence === 'late'

      // The Payment column (FR-DASH-02c). No new stored status — every
      // reading here is derived from data the row already holds.
      let payment
      if (!monthReport) {
        payment = owes
          ? { kind: 'arrears', arrearsMonth: oldest, tone: 'destructive' }
          : { kind: 'none', tone: 'muted' }
      } else if (reportState === 'draft') {
        payment = { kind: 'cannot-record', tone: 'muted' }
      } else if (monthReport.paymentStatus === 'paid') {
        payment = { kind: 'paid', tone: 'ok' }
      } else if (monthReport.paymentStatus === 'partial') {
        payment = {
          kind: 'partial',
          tone: isOverdue ? 'destructive' : 'neutral',
        }
      } else {
        payment = { kind: 'unpaid', tone: isOverdue ? 'destructive' : 'muted' }
      }

      return {
        propertyId: t.propertyId,
        tenancyId: t.id,
        propertyName: t.property?.name ?? '',
        tenantName: t.tenantName,
        reportState,
        totalDue: monthReport ? (monthReport.finalTotal ?? null) : null,
        totalDueMuted: reportState !== 'signed',
        remaining,
        remainingShown: owes,
        isOverdue,
        dueDate,
        dueConsequence,
        dueDayCount,
        payment,
      }
    })
    .sort((a, b) => a.propertyName.localeCompare(b.propertyName))
}

/** How many current-month rows have NO signed report yet — a draft counts as
 * unsigned (the strip's "N of M", design's third strip item; NFR-UX-08 rule
 * 2 gates the "N of M" form on M > 0). */
export function unsignedReportStats(rows) {
  const total = rows.length
  const unsigned = rows.filter((r) => r.reportState !== 'signed').length
  return { unsigned, total }
}

/** The earliest month the selector may reach, given the data window the
 * page fetched (the current calendar year and the one before it). Stepping
 * back further would silently return a SMALLER Expected — reports the
 * lookup never saw — so the "previous" control is disabled here instead. */
export function earliestSelectableMonth(currentYear) {
  return { month: 1, year: currentYear - 1 }
}

export { isBefore as isMonthBefore }
