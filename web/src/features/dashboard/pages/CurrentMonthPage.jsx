import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { RetryButton } from '@/components/shared/RetryButton'
import { useActiveTenancies } from '@/features/tenants/hooks'
import { useReportsForMonth } from '@/features/reports/hooks'
import { formatCurrency } from '@/lib/formatCurrency'
import {
  deriveReportStatusBadge,
  formatMonthYearLabel,
} from '@/features/dashboard/calculations'

const BADGE_TONE = {
  'not-entered': 'bg-muted text-muted-foreground',
  published: 'bg-secondary text-secondary-foreground',
  partial: 'bg-primary/10 text-primary',
  paid: 'bg-primary text-primary-foreground',
  overdue: 'bg-destructive/10 text-destructive',
}

const BADGE_LABEL_KEY = {
  'not-entered': 'notEntered',
  published: 'published',
  paid: 'paid',
  partial: 'partial',
  overdue: 'overdue',
}

function StatusBadge({ status }) {
  const { t } = useTranslation()

  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${BADGE_TONE[status]}`}
    >
      {t(`dashboard.currentMonth.badge.${BADGE_LABEL_KEY[status]}`)}
    </span>
  )
}

/** Adds `delta` months to `{ month, year }`, rolling the year at the edges. */
function shiftMonth({ month, year }, delta) {
  const zeroBased = month - 1 + delta
  return {
    month: (((zeroBased % 12) + 12) % 12) + 1,
    year: year + Math.floor(zeroBased / 12),
  }
}

/**
 * The Current month list (FR-DASH-02, SRS §5.3). Rows are sourced directly
 * from `useActiveTenancies` — an active tenancy already denormalizes
 * `property.name`/`tenantName` (SRS §6), so occupied-property rows need no
 * separate `properties` read/join here. Free properties never appear
 * because they have no active tenancy. Reports for the selected month are
 * fetched once (`useReportsForMonth`, reports/hooks.js) and matched by
 * `propertyId`.
 */
export function CurrentMonthPage() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()

  const now = new Date()
  const current = { month: now.getMonth() + 1, year: now.getFullYear() }
  const [selected, setSelected] = useState(current)
  const isAtCurrentMonth =
    selected.month === current.month && selected.year === current.year

  const tenancies = useActiveTenancies()
  const reports = useReportsForMonth(selected.month, selected.year)

  const isPending = tenancies.isPending || reports.isPending
  const isError = tenancies.isError || reports.isError

  const rows = useMemo(() => {
    const reportsByProperty = new Map(
      (reports.data ?? []).map((report) => [report.propertyId, report]),
    )
    return (tenancies.data ?? [])
      .map((tenancy) => {
        const report = reportsByProperty.get(tenancy.propertyId) ?? null
        return {
          propertyId: tenancy.propertyId,
          propertyName: tenancy.property?.name ?? '',
          tenantName: tenancy.tenantName,
          badge: deriveReportStatusBadge(report),
          total: report ? report.finalTotal : null,
        }
      })
      .sort((a, b) => a.propertyName.localeCompare(b.propertyName))
  }, [tenancies.data, reports.data])

  function goToReport(propertyId) {
    navigate(
      `/admin/reports/${propertyId}?month=${selected.month}&year=${selected.year}`,
    )
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-xl font-semibold text-foreground">
          {t('dashboard.currentMonth.title')}
        </h1>
        <div className="flex items-center gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={() => setSelected((prev) => shiftMonth(prev, -1))}
          >
            {t('dashboard.currentMonth.previousMonth')}
          </Button>
          <span className="min-w-32 text-center text-sm font-medium text-foreground">
            {formatMonthYearLabel(selected.month, selected.year, i18n.language)}
          </span>
          <Button
            type="button"
            variant="outline"
            disabled={isAtCurrentMonth}
            onClick={() => setSelected((prev) => shiftMonth(prev, 1))}
          >
            {t('dashboard.currentMonth.nextMonth')}
          </Button>
        </div>
      </div>

      {isPending ? (
        <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
      ) : isError ? (
        <div className="flex flex-col items-start gap-2">
          <p className="text-sm text-destructive">
            {t('dashboard.currentMonth.error')}
          </p>
          <RetryButton
            onRetry={() => {
              tenancies.refetch()
              reports.refetch()
            }}
            disabled={tenancies.isFetching || reports.isFetching}
          />
        </div>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t('dashboard.currentMonth.noOccupiedProperties')}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border bg-muted/50">
              <tr className="text-xs text-muted-foreground">
                <th className="px-4 py-2 font-medium">
                  {t('dashboard.currentMonth.columns.property')}
                </th>
                <th className="px-4 py-2 font-medium">
                  {t('dashboard.currentMonth.columns.tenant')}
                </th>
                <th className="px-4 py-2 font-medium">
                  {t('dashboard.currentMonth.columns.status')}
                </th>
                <th className="px-4 py-2 text-right font-medium">
                  {t('dashboard.currentMonth.columns.total')}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.propertyId}
                  onClick={() => goToReport(row.propertyId)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      goToReport(row.propertyId)
                    }
                  }}
                  tabIndex={0}
                  className="cursor-pointer border-b border-border last:border-0 hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none"
                >
                  <td className="px-4 py-3 font-medium text-foreground">
                    {row.propertyName}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {row.tenantName}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={row.badge} />
                  </td>
                  <td className="px-4 py-3 text-right text-muted-foreground tabular-nums">
                    {row.total === null ? '—' : formatCurrency(row.total)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
