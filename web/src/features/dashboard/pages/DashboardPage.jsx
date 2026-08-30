import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { RetryButton } from '@/components/shared/RetryButton'
import { PageHeader } from '@/components/shared/PageHeader'
import { formatCurrency } from '@/lib/formatCurrency'
import { useProperties } from '@/features/properties/hooks'
import { useUsers, useAllTenancies } from '@/features/tenants/hooks'
import { useReportsForMonth, useReportsForYear } from '@/features/reports/hooks'
import { useCreateDraft } from '@/features/onboarding/hooks'
import { useNotificationLog } from '@/features/notifications/hooks'
import {
  DELIVERY_LABEL_KEY,
  DELIVERY_TONE,
  TYPE_LABEL_KEY,
  formatSentAt,
  sortBySentAtDesc,
  withinWindow,
} from '@/features/notifications/calculations'
import {
  billedHistory,
  buildCurrentMonthRows,
  collectedForMonth,
  creditInAdvance,
  earliestSelectableMonth,
  expectedForMonth,
  formatMonthYearLabel,
  formerRenterBalances,
  isFirstLaunch,
  isMonthBefore,
  overdueForMonth,
  propertyCounts,
  shiftMonth,
  unsignedReportStats,
} from '@/features/dashboard/calculations'
import { CurrentMonthTable } from '@/features/dashboard/components/CurrentMonthTable'
import { BilledHistoryChart } from '@/features/dashboard/components/BilledHistoryChart'

const DASHBOARD_NOTIFICATION_LIMIT = 6

/**
 * The admin dashboard — FR-DASH-01, 04…14, SRS §5.3, rebuilt at M8 stage 15
 * on the corrected financial model (`4c7a99e`) and the approved design
 * (`docs/design/dashboard-desktop.html`).
 *
 * NFR-UX-08 — ONE primary focus: the money card (Total de încasat, with Din
 * care restant contained inside it). It is the largest, heaviest element and
 * the only one with an accent rule; every other block — the two small
 * cards, the strip, the current-month section, the chart, the notification
 * list — steps down in size and weight, in that order, and none competes
 * with it. The administrator settled this on 2026-08-26.
 *
 * The month selector (FR-DASH-02a, defaults to now) moves Expected, Overdue
 * and the Current-month section. It does NOT move Properties (occupancy is a
 * live field with no history) or the history chart (always the trailing 12
 * months). Its reach back is bounded to the data the page actually fetched —
 * the current calendar year and the one before it.
 */
export function DashboardPage() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const createDraft = useCreateDraft()

  const now = useMemo(() => new Date(), [])
  const current = { month: now.getMonth() + 1, year: now.getFullYear() }
  const [selected, setSelected] = useState(current)

  const isAtCurrentMonth =
    selected.month === current.month && selected.year === current.year
  const earliest = earliestSelectableMonth(current.year)
  const isAtEarliest =
    isMonthBefore(selected, earliest) ||
    (selected.month === earliest.month && selected.year === earliest.year)

  const properties = useProperties()
  const users = useUsers()
  const tenancies = useAllTenancies()
  const monthReports = useReportsForMonth(selected.month, selected.year)
  const yearReports = useReportsForYear(current.year)
  const priorYearReports = useReportsForYear(current.year - 1)
  const notifications = useNotificationLog()

  const sources = [
    properties,
    users,
    tenancies,
    monthReports,
    yearReports,
    priorYearReports,
    notifications,
  ]
  const isPending = sources.some((s) => s.isPending)
  const isError = sources.some((s) => s.isError)

  const model = useMemo(() => {
    const allTenancies = tenancies.data ?? []
    const active = allTenancies.filter((tc) => tc.status === 'active')
    const ended = allTenancies.filter((tc) => tc.status === 'ended')

    const windowReports = [
      ...(yearReports.data ?? []),
      ...(priorYearReports.data ?? []),
    ]
    const signed = windowReports.filter((r) => r.status === 'signed')
    const signedByTenancy = new Map()
    for (const r of signed) {
      const list = signedByTenancy.get(r.tenancyId) ?? []
      list.push(r)
      signedByTenancy.set(r.tenancyId, list)
    }

    // FR-DASH-04a: for the current month, Expected IS Σ max(0, currentBalance)
    // — the denormalized field, no per-tenancy lookup. Stepping back uses the
    // general form. `balanceAsOf(reports, current)` equals `currentBalance` by
    // construction; `dashboard.calculations.test` pins that.
    const expected = isAtCurrentMonth
      ? active.reduce((sum, tc) => sum + Math.max(0, tc.currentBalance ?? 0), 0)
      : expectedForMonth(active, signedByTenancy, selected)
    const overdue = overdueForMonth(active, signedByTenancy, selected, {
      today: now,
      isCurrentMonth: isAtCurrentMonth,
    })

    const currentMonthRows = buildCurrentMonthRows(
      active,
      monthReports.data ?? [],
      signedByTenancy,
      selected,
      now,
    )

    return {
      expected,
      overdue,
      collected: collectedForMonth(windowReports, selected),
      counts: propertyCounts(properties.data ?? []),
      credit: creditInAdvance(active),
      former: formerRenterBalances(ended),
      currentMonthRows,
      unsigned: unsignedReportStats(currentMonthRows),
      history: billedHistory(
        signed,
        current.month,
        current.year,
        i18n.language,
      ),
      hasSignedReports: signed.length > 0,
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    tenancies.data,
    yearReports.data,
    priorYearReports.data,
    monthReports.data,
    properties.data,
    selected,
    isAtCurrentMonth,
    i18n.language,
  ])

  const notifRows = useMemo(
    () =>
      withinWindow(sortBySentAtDesc(notifications.data?.rows ?? [])).slice(
        0,
        DASHBOARD_NOTIFICATION_LIMIT,
      ),
    [notifications.data],
  )

  async function goToNewTenant() {
    const draftId = await createDraft.mutateAsync()
    navigate(`/admin/onboarding/${draftId}`)
  }

  if (isPending) {
    return (
      <div className="p-6">
        <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
      </div>
    )
  }

  if (isError) {
    return (
      <div className="flex flex-col items-start gap-2 p-6">
        <p className="text-sm text-destructive">{t('dashboard.error')}</p>
        <RetryButton
          onRetry={() => sources.forEach((s) => s.refetch())}
          disabled={sources.some((s) => s.isFetching)}
        />
      </div>
    )
  }

  // FR-DASH-03 / FR-DASH-10: zero properties AND zero tenants — the
  // two-action empty state, never a wall of zeroed tiles. A property with no
  // signed report is NOT this state; it renders real zeros below.
  if (isFirstLaunch(properties.data, users.data)) {
    return (
      <div className="flex flex-col items-start gap-4 p-6">
        <h1 className="text-xl font-semibold text-foreground">
          {t('dashboard.emptyState.title')}
        </h1>
        <p className="max-w-prose text-sm text-muted-foreground">
          {t('dashboard.emptyState.body')}
        </p>
        <div className="flex flex-wrap gap-3">
          <Button
            type="button"
            onClick={() => navigate('/admin/properties/new')}
          >
            {t('dashboard.emptyState.addProperty')}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={goToNewTenant}
            disabled={createDraft.isPending}
          >
            {t('dashboard.emptyState.enrollTenant')}
          </Button>
        </div>
      </div>
    )
  }

  const { former } = model

  return (
    <div className="flex flex-col gap-8 p-6">
      <PageHeader
        title={t('dashboard.title')}
        actions={
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isAtEarliest}
              onClick={() => setSelected((prev) => shiftMonth(prev, -1))}
            >
              {t('dashboard.selector.previous')}
            </Button>
            <span className="min-w-36 text-center text-sm font-medium text-foreground">
              {formatMonthYearLabel(
                selected.month,
                selected.year,
                i18n.language,
              )}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isAtCurrentMonth}
              onClick={() => setSelected((prev) => shiftMonth(prev, 1))}
            >
              {t('dashboard.selector.next')}
            </Button>
          </div>
        }
      />

      {/* PRIMARY FOCUS — the money card. Largest, heaviest, the only accented
          block. Overdue is contained inside it, never an independent total. */}
      <button
        type="button"
        onClick={() => navigate('/admin/payments')}
        className="flex flex-col items-start gap-3 rounded-xl border border-border border-l-4 border-l-primary bg-card p-6 text-left shadow-sm transition-colors hover:bg-muted/40 sm:p-8"
      >
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t('dashboard.expected.label')}
        </span>
        <span className="text-4xl font-bold tabular-nums text-foreground sm:text-5xl">
          {formatCurrency(model.expected)}
        </span>
        <span className="text-sm text-muted-foreground">
          {t('dashboard.expected.hint')}
        </span>
        <span
          className={`mt-1 text-sm font-medium ${
            model.overdue > 0 ? 'text-destructive' : 'text-muted-foreground'
          }`}
        >
          {t('dashboard.overdue.containment', {
            amount: formatCurrency(model.overdue),
          })}
        </span>
      </button>

      {/* SUBORDINATE — two small cards. Smaller type, lighter weight, no
          accent. Legible, not competing. */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <button
          type="button"
          onClick={() => navigate('/admin/payments')}
          className="flex flex-col items-start gap-1 rounded-lg border border-border bg-card p-4 text-left transition-colors hover:bg-muted/40"
        >
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t('dashboard.collected.label')}
          </span>
          <span className="text-xl font-semibold tabular-nums text-foreground">
            {formatCurrency(model.collected)}
          </span>
          <span className="text-xs text-muted-foreground">
            {t('dashboard.collected.hint')}
          </span>
        </button>
        <button
          type="button"
          onClick={() => navigate('/admin/properties')}
          className="flex flex-col items-start gap-1 rounded-lg border border-border bg-card p-4 text-left transition-colors hover:bg-muted/40"
        >
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t('dashboard.properties.label')}
          </span>
          <span className="text-xl font-semibold tabular-nums text-foreground">
            {model.counts.total}
          </span>
          <span className="text-xs text-muted-foreground">
            {t('dashboard.properties.hint', {
              occupied: model.counts.occupied,
              free: model.counts.free,
            })}
          </span>
        </button>
      </div>

      {/* SUBORDINATE — the strip. Each item appears ONLY when it has a value
          (NFR-UX-08 rule 1: absence produces no row). */}
      {(model.credit > 0 ||
        former.owedByFormer > 0 ||
        former.owedToFormer > 0 ||
        model.unsigned.total > 0) && (
        <div className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
          {model.credit > 0 && (
            <span className="text-muted-foreground">
              {t('dashboard.strip.creditInAdvance')}:{' '}
              <span className="font-medium tabular-nums text-foreground">
                {formatCurrency(model.credit)}
              </span>
            </span>
          )}
          {former.owedByFormer > 0 && (
            <span className="text-muted-foreground">
              {t('dashboard.strip.owedByFormer')}:{' '}
              <span className="font-medium tabular-nums text-foreground">
                {formatCurrency(former.owedByFormer)}
              </span>
            </span>
          )}
          {former.owedToFormer > 0 && (
            <span className="text-muted-foreground">
              {t('dashboard.strip.owedToFormer')}:{' '}
              <span className="font-medium tabular-nums text-foreground">
                {formatCurrency(former.owedToFormer)}
              </span>
            </span>
          )}
          {model.unsigned.total > 0 && (
            <span className="text-muted-foreground">
              {t('dashboard.strip.unsignedReports')}:{' '}
              <span className="font-medium tabular-nums text-foreground">
                {t('dashboard.strip.unsignedCount', {
                  count: model.unsigned.unsigned,
                  total: model.unsigned.total,
                })}
              </span>
            </span>
          )}
        </div>
      )}

      {/* SUBORDINATE — the Current-month section, inline (FR-DASH-02). Same
          rows and columns as /admin/current-month (FR-DASH-02a). */}
      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-foreground">
            {t('dashboard.currentMonth.sectionTitle', {
              month: formatMonthYearLabel(
                selected.month,
                selected.year,
                i18n.language,
              ),
            })}
          </h2>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => navigate('/admin/current-month')}
          >
            {t('dashboard.currentMonth.openFull')}
          </Button>
        </div>
        {model.currentMonthRows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t('dashboard.currentMonth.noOccupiedProperties')}
          </p>
        ) : (
          <CurrentMonthTable
            rows={model.currentMonthRows}
            onRowClick={(row) =>
              navigate(
                `/admin/reports/${row.tenancyId}?month=${selected.month}&year=${selected.year}`,
              )
            }
          />
        )}
      </section>

      {/* SUBORDINATE — the history chart. Always the trailing 12 months. */}
      <BilledHistoryChart
        data={model.history}
        hasSignedReports={model.hasSignedReports}
      />

      {/* SUBORDINATE — the notification list, last few sends. */}
      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-foreground">
            {t('dashboard.notifications.title')}
          </h2>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => navigate('/admin/notifications')}
          >
            {t('dashboard.notifications.viewAll')}
          </Button>
        </div>
        {notifRows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {notifications.data?.anyExist
              ? t('dashboard.notifications.emptyWindow')
              : t('dashboard.notifications.emptyLog')}
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-border rounded-lg border border-border bg-card">
            {notifRows.map((row) => (
              <li key={row.id}>
                <button
                  type="button"
                  onClick={() => navigate('/admin/notifications')}
                  className="flex w-full flex-wrap items-center justify-between gap-2 px-4 py-3 text-left text-sm transition-colors hover:bg-muted/40"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-foreground">
                      {row.subject ||
                        t(
                          `notifications.type.${
                            TYPE_LABEL_KEY[row.type] ?? 'unknown'
                          }`,
                          { defaultValue: row.type },
                        )}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {row.to}
                    </span>
                  </span>
                  <span className="flex items-center gap-3">
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                        DELIVERY_TONE[row.deliveryState] ??
                        'bg-muted text-muted-foreground'
                      }`}
                    >
                      {t(
                        `notifications.delivery.${
                          DELIVERY_LABEL_KEY[row.deliveryState] ?? 'pending'
                        }`,
                      )}
                    </span>
                    <span className="whitespace-nowrap text-xs tabular-nums text-muted-foreground">
                      {formatSentAt(row.sentAt)}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
