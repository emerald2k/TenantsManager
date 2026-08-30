import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { RetryButton } from '@/components/shared/RetryButton'
import { PageHeader } from '@/components/shared/PageHeader'
import { useActiveTenancies } from '@/features/tenants/hooks'
import { useReportsForMonth, useReportsForYear } from '@/features/reports/hooks'
import {
  buildCurrentMonthRows,
  earliestSelectableMonth,
  formatMonthYearLabel,
  isMonthBefore,
  shiftMonth,
} from '@/features/dashboard/calculations'
import { CurrentMonthTable } from '@/features/dashboard/components/CurrentMonthTable'

/**
 * The standalone Current-month page (FR-DASH-02, SRS §5.3). Since M8 stage
 * 15a it is the SAME seven-column list, from the SAME component
 * (`CurrentMonthTable`) and the SAME data (`buildCurrentMonthRows`) as the
 * dashboard's inline section — FR-DASH-02a / FR-DASH-02b: "both render the
 * same rows … not a reduced variant". That data now includes the tenancy's
 * signed-report history (for `balanceAsOf` and the oldest-unsettled due
 * date), so this page fetches the two year queries the dashboard does and
 * bounds its selector to the same window — stepping past it would make
 * "Remaining to collect" silently read 0, the failure FR-DASH-02b exists to
 * prevent.
 */
export function CurrentMonthPage() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()

  const now = new Date()
  const current = { month: now.getMonth() + 1, year: now.getFullYear() }
  const [selected, setSelected] = useState(current)
  const isAtCurrentMonth =
    selected.month === current.month && selected.year === current.year
  const earliest = earliestSelectableMonth(current.year)
  const isAtEarliest =
    isMonthBefore(selected, earliest) ||
    (selected.month === earliest.month && selected.year === earliest.year)

  const tenancies = useActiveTenancies()
  const monthReports = useReportsForMonth(selected.month, selected.year)
  const yearReports = useReportsForYear(current.year)
  const priorYearReports = useReportsForYear(current.year - 1)

  const sources = [tenancies, monthReports, yearReports, priorYearReports]
  const isPending = sources.some((s) => s.isPending)
  const isError = sources.some((s) => s.isError)

  const rows = useMemo(() => {
    const signed = [
      ...(yearReports.data ?? []),
      ...(priorYearReports.data ?? []),
    ].filter((r) => r.status === 'signed')
    const signedByTenancy = new Map()
    for (const r of signed) {
      const list = signedByTenancy.get(r.tenancyId) ?? []
      list.push(r)
      signedByTenancy.set(r.tenancyId, list)
    }
    return buildCurrentMonthRows(
      tenancies.data ?? [],
      monthReports.data ?? [],
      signedByTenancy,
      selected,
      now,
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    tenancies.data,
    monthReports.data,
    yearReports.data,
    priorYearReports.data,
    selected,
  ])

  return (
    <div className="flex flex-col gap-6 p-6">
      <PageHeader
        title={t('dashboard.currentMonth.title')}
        actions={
          <>
            <Button
              type="button"
              variant="outline"
              disabled={isAtEarliest}
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
            onRetry={() => sources.forEach((s) => s.refetch())}
            disabled={sources.some((s) => s.isFetching)}
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
