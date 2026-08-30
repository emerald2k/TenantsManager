import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { RetryButton } from '@/components/shared/RetryButton'
import { PageHeader } from '@/components/shared/PageHeader'
import { useActiveTenancies } from '@/features/tenants/hooks'
import { useReportsForMonth } from '@/features/reports/hooks'
import {
  buildCurrentMonthRows,
  formatMonthYearLabel,
  shiftMonth,
} from '@/features/dashboard/calculations'
import { CurrentMonthTable } from '@/features/dashboard/components/CurrentMonthTable'

/**
 * The standalone Current-month page (FR-DASH-02, SRS §5.3). Since M8 stage 15
 * it is the SAME list, from the SAME data and the SAME component
 * (`CurrentMonthTable`, `buildCurrentMonthRows`) as the dashboard's inline
 * section — FR-DASH-02a: "both render the same rows … not a reduced variant
 * with different columns". Rows come straight from `useActiveTenancies` (an
 * active tenancy denormalizes `property.name`/`tenantName`), so free
 * properties never appear and no separate `properties` read is needed.
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

  const rows = useMemo(
    () => buildCurrentMonthRows(tenancies.data ?? [], reports.data ?? [], now),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tenancies.data, reports.data],
  )

  return (
    <div className="flex flex-col gap-6 p-6">
      <PageHeader
        title={t('dashboard.currentMonth.title')}
        actions={
          <>
            <Button
              type="button"
              variant="outline"
              onClick={() => setSelected((prev) => shiftMonth(prev, -1))}
            >
              {t('dashboard.currentMonth.previousMonth')}
            </Button>
            <span className="min-w-32 text-center text-sm font-medium text-foreground">
              {formatMonthYearLabel(
                selected.month,
                selected.year,
                i18n.language,
              )}
            </span>
            <Button
              type="button"
              variant="outline"
              disabled={isAtCurrentMonth}
              onClick={() => setSelected((prev) => shiftMonth(prev, 1))}
            >
              {t('dashboard.currentMonth.nextMonth')}
            </Button>
          </>
        }
      />

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
        <CurrentMonthTable
          rows={rows}
          onRowClick={(row) =>
            navigate(
              `/admin/reports/${row.tenancyId}?month=${selected.month}&year=${selected.year}`,
            )
          }
        />
      )}
    </div>
  )
}
