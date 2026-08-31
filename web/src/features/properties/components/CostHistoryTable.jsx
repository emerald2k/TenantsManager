import { Fragment, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { formatCurrency } from '@/lib/formatCurrency'
import { formatMonthYearLabel } from '@/features/dashboard/calculations'
import { buildCostHistory } from '@/features/properties/costHistory'

const WINDOW_SIZE = 12

/**
 * The cost-history table on the property page (FR-PROP-09, SRS §5.3).
 * Columns: month | rent | maintenance | one per service | other | rounding
 * (conditional) | billed. **`billed` is `buildCostHistory`'s `total`**
 * (`billedForReport`, summed per sibling — FR-DASH-09's formula, `../../
 * reports/billing.js`), never `finalTotal` (FR-PROP-09, corrected at M8
 * stage 5): `finalTotal` already contains the carried-forward balance, which
 * is not a cost of the property. Rows are the property's SIGNED reports
 * (`reports` — already fetched by the caller via `useSignedReportsForProperty`),
 * pivoted by `buildCostHistory` — one row per CALENDAR MONTH, not per report:
 * a mid-month hand-over (FR-REP-14) can leave two signed reports in the same
 * month, and `buildCostHistory` sums them into a single row rather than
 * rendering two.
 *
 * The rounding column (FR-REP-04d: "appears in its own column") only renders
 * when at least one row actually has a non-zero `rounding` — most properties
 * never see a manual rounding action, and an always-empty column would be
 * noise.
 *
 * A year-total row (FR-PROP-09/12) closes each calendar year present in the
 * table, summed the same way as the monthly rows.
 *
 * Defaults to the most recent 12 months; "Show all" (only rendered when
 * there IS more) re-pivots against the full `reports` array — a service
 * that only ever appeared before the 12-month window gains its column back
 * once expanded, same as any other row outside the window.
 *
 * A `null` cell (service did not exist that month) renders as "—"; a `0`
 * cell (service existed, billed at zero — FR-REP-03) renders as a real
 * amount. `<table>` markup follows the same raw-HTML + Tailwind pattern as
 * `ReportSummaryView.jsx` — there is no shared table component in this
 * project (`components/ui/` has no `table.jsx`).
 */
export function CostHistoryTable({ reports, isPending }) {
  const { t, i18n } = useTranslation()
  const [showAll, setShowAll] = useState(false)

  if (isPending) {
    return (
      <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
    )
  }

  if (!reports || reports.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        {t('properties.detail.historyEmpty')}
      </p>
    )
  }

  const hasMore = reports.length > WINDOW_SIZE
  const { rows, services, yearTotals } = buildCostHistory(reports, {
    windowSize: showAll ? reports.length : WINDOW_SIZE,
  })
  const showRounding = rows.some((row) => row.rounding !== 0)
  const yearTotalByYear = new Map(yearTotals.map((yt) => [yt.year, yt]))
  // A year's totals row renders right after that year's LAST row in the
  // (ascending) table — the last row seen for a given year is exactly when
  // to close it out.
  const isLastRowOfYear = (row, index) =>
    index === rows.length - 1 || rows[index + 1].year !== row.year

  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="px-4 py-2 font-medium text-muted-foreground">
                {t('properties.detail.historyMonth')}
              </th>
              <th className="px-4 py-2 text-right font-medium text-muted-foreground">
                {t('reports.sections.rent')}
              </th>
              <th className="px-4 py-2 text-right font-medium text-muted-foreground">
                {t('reports.sections.maintenance')}
              </th>
              {services.map((service) => (
                <th
                  key={service.serviceId}
                  className="px-4 py-2 text-right font-medium text-muted-foreground"
                >
                  {service.name}
                </th>
              ))}
              <th className="px-4 py-2 text-right font-medium text-muted-foreground">
                {t('reports.sections.otherExpenses')}
              </th>
              {showRounding && (
                <th className="px-4 py-2 text-right font-medium text-muted-foreground">
                  {t('properties.detail.historyRounding')}
                </th>
              )}
              <th className="px-4 py-2 text-right font-medium text-foreground">
                {t('properties.detail.historyBilled')}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => {
              const yearTotal = isLastRowOfYear(row, index)
                ? yearTotalByYear.get(row.year)
                : null
              return (
                <Fragment key={`${row.year}-${row.month}`}>
                  <tr className="border-b border-border last:border-0">
                    <td className="px-4 py-2 align-top text-foreground">
                      {formatMonthYearLabel(row.month, row.year, i18n.language)}
                    </td>
                    <td className="px-4 py-2 text-right align-top tabular-nums">
                      {formatCurrency(row.rent)}
                    </td>
                    <td className="px-4 py-2 text-right align-top tabular-nums">
                      {formatCurrency(row.maintenance)}
                    </td>
                    {services.map((service) => {
                      const amount = row.services[service.serviceId]
                      return (
                        <td
                          key={service.serviceId}
                          className="px-4 py-2 text-right align-top tabular-nums"
                        >
                          {amount === null ? '—' : formatCurrency(amount)}
                        </td>
                      )
                    })}
                    <td className="px-4 py-2 text-right align-top tabular-nums">
                      {formatCurrency(row.other)}
                    </td>
                    {showRounding && (
                      <td className="px-4 py-2 text-right align-top tabular-nums">
                        {row.rounding === 0
                          ? '—'
                          : formatCurrency(row.rounding)}
                      </td>
                    )}
                    <td className="px-4 py-2 text-right align-top font-medium tabular-nums text-foreground">
                      {formatCurrency(row.total)}
                    </td>
                  </tr>
                  {yearTotal && (
                    <tr className="border-b border-border bg-muted/50 font-medium last:border-0">
                      <td className="px-4 py-2 align-top text-foreground">
                        {t('properties.detail.historyYearTotal', {
                          year: yearTotal.year,
                        })}
                      </td>
                      <td className="px-4 py-2 text-right align-top tabular-nums">
                        {formatCurrency(yearTotal.rent)}
                      </td>
                      <td className="px-4 py-2 text-right align-top tabular-nums">
                        {formatCurrency(yearTotal.maintenance)}
                      </td>
                      {services.map((service) => {
                        const amount = yearTotal.services[service.serviceId]
                        return (
                          <td
                            key={service.serviceId}
                            className="px-4 py-2 text-right align-top tabular-nums"
                          >
                            {amount === null ? '—' : formatCurrency(amount)}
                          </td>
                        )
                      })}
                      <td className="px-4 py-2 text-right align-top tabular-nums">
                        {formatCurrency(yearTotal.other)}
                      </td>
                      {showRounding && (
                        <td className="px-4 py-2 text-right align-top tabular-nums">
                          {yearTotal.rounding === 0
                            ? '—'
                            : formatCurrency(yearTotal.rounding)}
                        </td>
                      )}
                      <td className="px-4 py-2 text-right align-top tabular-nums text-foreground">
                        {formatCurrency(yearTotal.total)}
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>

      {hasMore && !showAll && (
        <div>
          <Button
            type="button"
            variant="outline"
            onClick={() => setShowAll(true)}
          >
            {t('properties.detail.historyShowAll')}
          </Button>
        </div>
      )}
    </div>
  )
}
