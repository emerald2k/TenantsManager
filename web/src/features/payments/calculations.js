/**
 * Pure display-derivation functions for the payments ledger (FR-PAY-07/08/09,
 * FR-PROP-12, SRS §5.3/§6, M8 stage 12). No Firestore/React imports — every
 * function here takes already-fetched data and returns rows/numbers, the
 * same discipline as `dashboard/calculations.js`.
 */

import { billedForReport } from '@/features/reports/billing'
import { isPastDueDate } from '@/features/dashboard/calculations'

/**
 * Sorted most-recent-first by `paymentDate` — **in JS, never a Firestore
 * `orderBy`** (SRS §5.3/§6, line 816): an unpaid report has no `paymentDate`
 * field at all, and Firestore's `orderBy` silently OMITS documents lacking
 * the ordered field — exactly the rows this page exists to show. Rows with
 * no `paymentDate` sort LAST, after every dated row, ordered by period
 * (year/month, most recent first) among themselves for a stable, sensible
 * fallback — not left in arbitrary fetch order.
 */
export function sortLedgerRows(rows) {
  return [...rows].sort((a, b) => {
    if (a.paymentDate && b.paymentDate) {
      return b.paymentDate.localeCompare(a.paymentDate)
    }
    if (a.paymentDate) return -1
    if (b.paymentDate) return 1
    if (a.year !== b.year) return b.year - a.year
    return b.month - a.month
  })
}

/**
 * The ledger's own badge vocabulary (SRS §5.3, `/admin/payments` prose) —
 * DELIBERATELY its own derivation: every ledger row IS an existing report
 * (FR-PAY-07: "one row per report"), so there is no "not-entered" (no report
 * at all) base case here — only "not recorded" (the report exists, its
 * payment fields are simply absent, FR-TAPP-01's fourth neutral state).
 *
 * **A partial payment never becomes overdue, even past due** — a
 * product-wide precedent (it was also the rule in the dashboard's old
 * single-badge derivation, removed at stage 15a when the Current-month
 * table split Report and Payment into two columns; the new Payment column
 * tones a *late* partial destructive but keeps the label "partial", not
 * "overdue" — same precedent, just expressed as tone rather than label).
 */
export function derivePaymentBadge(report, referenceDate = new Date()) {
  const overdue = Boolean(
    report.dueDate && isPastDueDate(report.dueDate, referenceDate),
  )
  if (report.paymentStatus === 'paid') return 'paid'
  if (report.paymentStatus === 'partial') return 'partial'
  if (report.paymentStatus === 'unpaid') return overdue ? 'overdue' : 'unpaid'
  return overdue ? 'overdue' : 'not-recorded'
}

/**
 * The year-mode footer totals (FR-PROP-12). **Signed reports only** —
 * administrator's decision, 2026-08-24, now in FR-PROP-12 itself: a draft
 * is not yet a claim on anyone (still editable), and `Σ rent` specifically
 * leaves the product onto the owner's tax return, where a silently-included
 * draft would overstate declared income. `excludedCount` is the number of
 * reports in `reports` that were NOT signed — the page states it on screen
 * so the exclusion is never silent in the other direction either.
 *
 * All four totals are computed over the SAME signed subset, scoped by
 * whatever the caller already filtered `reports` to (the property filter,
 * per "a client-side aggregation over data the page already fetches") —
 * deliberately NOT re-filtered by the status filter, which is a per-row
 * display concern, not a property of "this year's totals".
 *
 * `stillOutstanding`/`creditOwed` are deduplicated by `tenancyId`:
 * `tenancies.currentBalance` is a TENANCY-level field, so summing it once
 * per report would double- (or triple-) count a tenancy with several signed
 * reports in the year. Split into two lines rather than one clamped
 * aggregate — same convention as FR-DASH-01/FR-DASH-12 keeping "Expected"
 * and "credit in advance" as separate, never-netted figures. Never
 * Σ(`finalTotal` − `amountPaid`), which double-counts every carried-forward
 * balance (SRS §6, line 821) — `currentBalance` is the only safe source.
 *
 * @param reports report docs already filtered to the selected year + property.
 * @param tenanciesById Map<tenancyId, tenancy> — from `useAllTenancies`,
 *   already fetched by the page for the property/renter-name join.
 */
export function computeYearFooterTotals(reports, tenanciesById) {
  const signed = reports.filter((report) => report.status === 'signed')
  const excludedCount = reports.length - signed.length

  const billed = signed.reduce(
    (sum, report) => sum + billedForReport(report),
    0,
  )
  const collected = signed.reduce(
    (sum, report) => sum + (report.amountPaid ?? 0),
    0,
  )
  const rentTotal = signed.reduce(
    (sum, report) => sum + (report.rent?.amount ?? 0),
    0,
  )

  const tenancyIds = [...new Set(signed.map((report) => report.tenancyId))]
  const stillOutstanding = tenancyIds.reduce((sum, id) => {
    const balance = tenanciesById.get(id)?.currentBalance ?? 0
    return sum + Math.max(balance, 0)
  }, 0)
  const creditOwed = tenancyIds.reduce((sum, id) => {
    const balance = tenanciesById.get(id)?.currentBalance ?? 0
    return sum + Math.max(-balance, 0)
  }, 0)

  return {
    billed,
    collected,
    stillOutstanding,
    creditOwed,
    rentTotal,
    excludedCount,
  }
}
