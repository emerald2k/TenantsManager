import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { RetryButton } from '@/components/shared/RetryButton'
import { PageHeader } from '@/components/shared/PageHeader'
import { Table } from '@/components/shared/Table'
import { MoneyAmount } from '@/components/shared/MoneyAmount'
import { useActiveTenancies } from '@/features/tenants/hooks'
import { useReportsForMonth } from '@/features/reports/hooks'
import {
  deriveReportStatusBadge,
  formatMonthYearLabel,
} from '@/features/dashboard/calculations'

const BADGE_TONE = {
  'not-entered': 'bg-muted text-muted-foreground',
  signed: 'bg-secondary text-secondary-foreground',
  partial: 'bg-primary/10 text-primary',
  paid: 'bg-primary text-primary-foreground',
  overdue: 'bg-destructive/10 text-destructive',
}

const BADGE_LABEL_KEY = {
  'not-entered': 'notEntered',
  signed: 'signed',
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
          tenancyId: tenancy.id,
          propertyName: tenancy.property?.name ?? '',
          tenantName: tenancy.tenantName,
          badge: deriveReportStatusBadge(report),
          total: report ? report.finalTotal : null,
        }
      })
      .sort((a, b) => a.propertyName.localeCompare(b.propertyName))
  }, [tenancies.data, reports.data])

  // Links straight to the tenancy-scoped report route (FR-REP-14) — this
  // list is already built from ACTIVE tenancies (FR-CON-02: at most one per
  // property), so which tenancy a row means is never ambiguous here. No
  // property->tenancy resolution needed, unlike a bare property-level link.
  function goToReport(tenancyId) {
    navigate(
      `/admin/reports/${tenancyId}?month=${selected.month}&year=${selected.year}`,
    )
  }

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
        <Table
          columns={[
            {
              key: 'property',
              header: t('dashboard.currentMonth.columns.property'),
              primary: true,
              render: (row) => row.propertyName,
            },
            {
              key: 'tenant',
              header: t('dashboard.currentMonth.columns.tenant'),
              render: (row) => row.tenantName,
            },
            {
              key: 'status',
              header: t('dashboard.currentMonth.columns.status'),
              render: (row) => <StatusBadge status={row.badge} />,
            },
            {
              key: 'total',
              header: t('dashboard.currentMonth.columns.total'),
              align: 'right',
              // A positive finalTotal is just this month's ordinary bill,
              // not arrears — emphasizePositive={false} keeps it from
              // rendering in the destructive colour the balance columns use.
              render: (row) => (
                <MoneyAmount value={row.total} emphasizePositive={false} />
              ),
            },
          ]}
          rows={rows}
          getRowKey={(row) => row.propertyId}
          onRowClick={(row) => goToReport(row.tenancyId)}
        />
      )}
    </div>
  )
}
