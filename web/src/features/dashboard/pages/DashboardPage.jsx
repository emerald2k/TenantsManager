import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { RetryButton } from '@/components/shared/RetryButton'
import { useProperties } from '@/features/properties/hooks'
import { useUsers, useActiveTenancies } from '@/features/tenants/hooks'
import { useReportsForMonth } from '@/features/reports/hooks'
import { useCreateDraft } from '@/features/onboarding/hooks'
import { formatCurrency } from '@/lib/formatCurrency'
import {
  calculateOutstandingThisMonth,
  calculateTotalArrears,
  isFirstLaunch,
} from '@/features/dashboard/calculations'

/**
 * The admin dashboard (FR-DASH-01/03, SRS §5.3). Fixed to the current
 * calendar month by design (M4 sub-stage 7 plan) — no selector here; the
 * selector lives on /admin/current-month.
 *
 * "Zero tenants" for the empty state (FR-DASH-03) is read from `useUsers()`
 * — every `users` document IS a tenant account (tenants/hooks.js), so this
 * is the collection that actually answers "has anyone been onboarded yet,"
 * independent of whether they currently hold an active tenancy.
 */
export function DashboardPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const createDraft = useCreateDraft()

  const now = new Date()
  const month = now.getMonth() + 1
  const year = now.getFullYear()

  const properties = useProperties()
  const users = useUsers()
  const tenancies = useActiveTenancies()
  const reports = useReportsForMonth(month, year)

  const isPending =
    properties.isPending ||
    users.isPending ||
    tenancies.isPending ||
    reports.isPending
  const isError =
    properties.isError || users.isError || tenancies.isError || reports.isError

  const occupiedPropertyIds = useMemo(
    () => (tenancies.data ?? []).map((tenancy) => tenancy.propertyId),
    [tenancies.data],
  )

  const outstandingThisMonth = useMemo(
    () =>
      calculateOutstandingThisMonth(reports.data ?? [], occupiedPropertyIds),
    [reports.data, occupiedPropertyIds],
  )
  const totalArrears = useMemo(
    () => calculateTotalArrears(tenancies.data ?? []),
    [tenancies.data],
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
          onRetry={() => {
            properties.refetch()
            users.refetch()
            tenancies.refetch()
            reports.refetch()
          }}
          disabled={
            properties.isFetching ||
            users.isFetching ||
            tenancies.isFetching ||
            reports.isFetching
          }
        />
      </div>
    )
  }

  if (isFirstLaunch(properties.data, users.data)) {
    return (
      <div className="flex flex-col items-start gap-4 p-6">
        <h1 className="text-xl font-semibold text-foreground">
          {t('dashboard.emptyState.title')}
        </h1>
        <div className="flex gap-3">
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

  return (
    <div className="flex flex-col gap-6 p-6">
      <h1 className="text-xl font-semibold text-foreground">
        {t('dashboard.title')}
      </h1>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <button
          type="button"
          onClick={() => navigate('/admin/current-month')}
          className="flex flex-col items-start gap-2 rounded-lg border border-border p-6 text-left hover:bg-muted/50"
        >
          <span className="text-sm text-muted-foreground">
            {t('dashboard.outstandingThisMonth')}
          </span>
          <span className="text-2xl font-semibold text-foreground tabular-nums">
            {formatCurrency(outstandingThisMonth)}
          </span>
        </button>
        <button
          type="button"
          onClick={() => navigate('/admin/current-month')}
          className="flex flex-col items-start gap-2 rounded-lg border border-border p-6 text-left hover:bg-muted/50"
        >
          <span className="text-sm text-muted-foreground">
            {t('dashboard.totalArrears')}
          </span>
          <span
            className={`text-2xl font-semibold tabular-nums ${
              totalArrears > 0 ? 'text-destructive' : 'text-foreground'
            }`}
          >
            {formatCurrency(totalArrears)}
          </span>
        </button>
      </div>
    </div>
  )
}
