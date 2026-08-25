import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { RetryButton } from '@/components/shared/RetryButton'
import { PageHeader } from '@/components/shared/PageHeader'
import { Table } from '@/components/shared/Table'
import { MoneyAmount } from '@/components/shared/MoneyAmount'
import { formatCurrency } from '@/lib/formatCurrency'
import { useProperties } from '@/features/properties/hooks'
import { useAllTenancies } from '@/features/tenants/hooks'
import { useReportsForMonth, useReportsForYear } from '@/features/reports/hooks'
import { formatMonthYearLabel } from '@/features/dashboard/calculations'
import {
  computeYearFooterTotals,
  derivePaymentBadge,
  sortLedgerRows,
} from '@/features/payments/calculations'

const BADGE_TONE = {
  paid: 'bg-primary text-primary-foreground',
  partial: 'bg-primary/10 text-primary',
  unpaid: 'bg-muted text-muted-foreground',
  'not-recorded': 'bg-muted text-muted-foreground',
  overdue: 'bg-destructive/10 text-destructive',
}

const BADGE_LABEL_KEY = {
  paid: 'paid',
  partial: 'partial',
  unpaid: 'unpaid',
  'not-recorded': 'notRecorded',
  overdue: 'overdue',
}

function StatusBadge({ status }) {
  const { t } = useTranslation()
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${BADGE_TONE[status]}`}
    >
      {t(`payments.badge.${BADGE_LABEL_KEY[status]}`)}
    </span>
  )
}

/** Adds `delta` months to `{ month, year }`, rolling the year at the edges —
 * identical to `CurrentMonthPage`'s own helper; not extracted (two call
 * sites, CLAUDE.md's own "no premature abstraction" rule). */
function shiftMonth({ month, year }, delta) {
  const zeroBased = month - 1 + delta
  return {
    month: (((zeroBased % 12) + 12) % 12) + 1,
    year: year + Math.floor(zeroBased / 12),
  }
}

/**
 * The cross-property payments ledger (FR-PAY-07/08/09, FR-PROP-12, SRS §5.3,
 * M8 stage 12). One row per report — REPORT-driven, not tenancy-driven like
 * `CurrentMonthPage`: a ledger row can belong to an ENDED tenancy (a report
 * signed before termination does not stop existing), so the property/renter
 * name join goes through `useAllTenancies` (any status), never
 * `useActiveTenancies`.
 *
 * Sorted in JS (`sortLedgerRows`), never a Firestore `orderBy` — an unpaid
 * report has no `paymentDate` field at all, and `orderBy` would silently
 * omit exactly the rows this page exists to show (SRS §6, line 816).
 *
 * Both `useReportsForMonth` and `useReportsForYear` are called
 * unconditionally (not just the active mode's) — a second background fetch
 * on mode switch is cheap at this scale (NFR-PERF-01) and keeps both hooks'
 * existing no-`enabled`-param signatures untouched.
 *
 * Year-mode footer totals (`computeYearFooterTotals`) are computed from the
 * PROPERTY-filtered set only, never re-filtered by the status filter — the
 * annual totals answer "what did this property/these properties bill this
 * year", not "what do the currently-visible badge rows sum to".
 */
export function PaymentsLedgerPage() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()

  const now = new Date()
  const [mode, setMode] = useState('month')
  const [period, setPeriod] = useState({
    month: now.getMonth() + 1,
    year: now.getFullYear(),
  })
  const [propertyFilter, setPropertyFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')

  const properties = useProperties({ includeArchived: true })
  const tenancies = useAllTenancies()
  const monthReports = useReportsForMonth(period.month, period.year)
  const yearReports = useReportsForYear(period.year)
  const activeReports = mode === 'year' ? yearReports : monthReports

  const isPending =
    activeReports.isPending || tenancies.isPending || properties.isPending
  const isError =
    activeReports.isError || tenancies.isError || properties.isError

  const tenanciesById = useMemo(
    () =>
      new Map((tenancies.data ?? []).map((tenancy) => [tenancy.id, tenancy])),
    [tenancies.data],
  )

  const propertyFilteredReports = useMemo(() => {
    const reports = activeReports.data ?? []
    return propertyFilter === 'all'
      ? reports
      : reports.filter((report) => report.propertyId === propertyFilter)
  }, [activeReports.data, propertyFilter])

  const rows = useMemo(() => {
    const withJoins = propertyFilteredReports.map((report) => {
      const tenancy = tenanciesById.get(report.tenancyId)
      return {
        ...report,
        propertyName: tenancy?.property?.name ?? '',
        tenantName: tenancy?.tenantName ?? '',
        badge: derivePaymentBadge(report),
      }
    })
    const filtered =
      statusFilter === 'all'
        ? withJoins
        : withJoins.filter((row) => row.badge === statusFilter)
    return sortLedgerRows(filtered)
  }, [propertyFilteredReports, tenanciesById, statusFilter])

  const footerTotals = useMemo(
    () =>
      mode === 'year'
        ? computeYearFooterTotals(propertyFilteredReports, tenanciesById)
        : null,
    [mode, propertyFilteredReports, tenanciesById],
  )

  function goToReport(row) {
    navigate(
      `/admin/reports/${row.tenancyId}?month=${row.month}&year=${row.year}`,
    )
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <PageHeader
        title={t('payments.title')}
        actions={
          <>
            <select
              aria-label={t('payments.periodMode')}
              className="h-9 rounded-lg border border-input bg-transparent px-2.5 text-sm"
              value={mode}
              onChange={(event) => setMode(event.target.value)}
            >
              <option value="month">{t('payments.modeMonth')}</option>
              <option value="year">{t('payments.modeYear')}</option>
            </select>

            {mode === 'month' ? (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="h-9 rounded-lg border border-input px-3 text-sm"
                  onClick={() => setPeriod((prev) => shiftMonth(prev, -1))}
                >
                  {t('payments.previousMonth')}
                </button>
                <span className="min-w-32 text-center text-sm font-medium text-foreground">
                  {formatMonthYearLabel(
                    period.month,
                    period.year,
                    i18n.language,
                  )}
                </span>
                <button
                  type="button"
                  className="h-9 rounded-lg border border-input px-3 text-sm"
                  onClick={() => setPeriod((prev) => shiftMonth(prev, 1))}
                >
                  {t('payments.nextMonth')}
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="h-9 rounded-lg border border-input px-3 text-sm"
                  onClick={() =>
                    setPeriod((prev) => ({ ...prev, year: prev.year - 1 }))
                  }
                >
                  {t('payments.previousYear')}
                </button>
                <span className="min-w-16 text-center text-sm font-medium text-foreground">
                  {period.year}
                </span>
                <button
                  type="button"
                  className="h-9 rounded-lg border border-input px-3 text-sm"
                  onClick={() =>
                    setPeriod((prev) => ({ ...prev, year: prev.year + 1 }))
                  }
                >
                  {t('payments.nextYear')}
                </button>
              </div>
            )}

            <select
              aria-label={t('payments.columns.property')}
              className="h-9 rounded-lg border border-input bg-transparent px-2.5 text-sm"
              value={propertyFilter}
              onChange={(event) => setPropertyFilter(event.target.value)}
            >
              <option value="all">{t('payments.allProperties')}</option>
              {(properties.data ?? []).map((property) => (
                <option key={property.id} value={property.id}>
                  {property.name}
                </option>
              ))}
            </select>

            <select
              aria-label={t('payments.columns.status')}
              className="h-9 rounded-lg border border-input bg-transparent px-2.5 text-sm"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
            >
              <option value="all">{t('payments.allStatuses')}</option>
              <option value="paid">{t('payments.badge.paid')}</option>
              <option value="partial">{t('payments.badge.partial')}</option>
              <option value="unpaid">{t('payments.badge.unpaid')}</option>
              <option value="not-recorded">
                {t('payments.badge.notRecorded')}
              </option>
              <option value="overdue">{t('payments.badge.overdue')}</option>
            </select>
          </>
        }
      />

      {isPending ? (
        <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
      ) : isError ? (
        <div className="flex flex-col items-start gap-2">
          <p className="text-sm text-destructive">{t('payments.error')}</p>
          <RetryButton
            onRetry={() => {
              activeReports.refetch()
              tenancies.refetch()
              properties.refetch()
            }}
            disabled={
              activeReports.isFetching ||
              tenancies.isFetching ||
              properties.isFetching
            }
          />
        </div>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('payments.empty')}</p>
      ) : (
        <Table
          columns={[
            {
              key: 'property',
              header: t('payments.columns.property'),
              primary: true,
              render: (row) => row.propertyName,
            },
            {
              key: 'tenant',
              header: t('payments.columns.tenant'),
              render: (row) => row.tenantName,
            },
            {
              key: 'period',
              header: t('payments.columns.period'),
              render: (row) =>
                formatMonthYearLabel(row.month, row.year, i18n.language),
            },
            {
              key: 'amountDue',
              header: t('payments.columns.amountDue'),
              align: 'right',
              render: (row) => (
                <MoneyAmount value={row.finalTotal} emphasizePositive={false} />
              ),
            },
            {
              key: 'amountPaid',
              header: t('payments.columns.amountPaid'),
              align: 'right',
              render: (row) =>
                row.amountPaid == null ? '—' : formatCurrency(row.amountPaid),
            },
            {
              key: 'paymentDate',
              header: t('payments.columns.paymentDate'),
              render: (row) => row.paymentDate ?? '—',
            },
            {
              key: 'status',
              header: t('payments.columns.status'),
              render: (row) => <StatusBadge status={row.badge} />,
            },
          ]}
          rows={rows}
          getRowKey={(row) => row.id}
          onRowClick={goToReport}
        />
      )}

      {footerTotals && (
        <div className="flex flex-col gap-3 rounded-lg border border-border p-4">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div>
              <p className="text-xs text-muted-foreground">
                {t('payments.footer.billed')}
              </p>
              <p className="text-sm font-medium text-foreground">
                {formatCurrency(footerTotals.billed)}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">
                {t('payments.footer.collected')}
              </p>
              <p className="text-sm font-medium text-foreground">
                {formatCurrency(footerTotals.collected)}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">
                {t('payments.footer.stillOutstanding')}
              </p>
              <p className="text-sm font-medium text-foreground">
                {formatCurrency(footerTotals.stillOutstanding)}
              </p>
            </div>
            {footerTotals.creditOwed > 0 && (
              <div>
                <p className="text-xs text-muted-foreground">
                  {t('payments.footer.creditOwed')}
                </p>
                <p className="text-sm font-medium text-foreground">
                  {formatCurrency(footerTotals.creditOwed)}
                </p>
              </div>
            )}
            <div>
              <p className="text-xs text-muted-foreground">
                {t('payments.footer.rentTotal', { year: period.year })}
              </p>
              <p className="text-sm font-medium text-foreground">
                {formatCurrency(footerTotals.rentTotal)}
              </p>
            </div>
          </div>
          {footerTotals.excludedCount > 0 && (
            <p className="text-xs text-muted-foreground">
              {t('payments.footer.excludedNotice', {
                count: footerTotals.excludedCount,
                year: period.year,
              })}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
