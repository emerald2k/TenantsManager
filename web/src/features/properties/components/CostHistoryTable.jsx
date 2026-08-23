import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { formatCurrency } from '@/lib/formatCurrency'
import { formatMonthYearLabel } from '@/features/dashboard/calculations'
import { buildCostHistory } from '@/features/properties/costHistory'

const WINDOW_SIZE = 12

/**
 * The cost-history table on the property page (FR-PROP-09, SRS §5.3).
 * Columns: month | rent | maintenance | one per service | other | total
 * (`finalTotal`, FR-REP-04c — never `calculatedTotal`). Rows are the
 * property's SIGNED reports (`reports` — already fetched by the caller via
 * `useSignedReportsForProperty`), pivoted by `buildCostHistory` — one row
 * per CALENDAR MONTH, not per report: a mid-month hand-over (FR-REP-14) can
 * leave two signed reports in the same month, and `buildCostHistory` sums
 * them into a single row rather than rendering two.
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
  const { rows, services } = buildCostHistory(reports, {
    windowSize: showAll ? reports.length : WINDOW_SIZE,
  })

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
              <th className="px-4 py-2 text-right font-medium text-foreground">
                {t('reports.fields.finalTotal')}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={`${row.year}-${row.month}`}
                className="border-b border-border last:border-0"
              >
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
                <td className="px-4 py-2 text-right align-top font-medium tabular-nums text-foreground">
                  {formatCurrency(row.total)}
                </td>
              </tr>
            ))}
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
