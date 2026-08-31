import { Link, Navigate, useParams, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { RetryButton } from '@/components/shared/RetryButton'
import { useTenanciesCoveringPropertyMonth } from '@/features/properties/hooks'

/**
 * Resolves a PROPERTY-level report link into the tenancy-scoped route the
 * report form actually lives at since M8 (SRS §5.1/§5.3, FR-REP-14):
 * `monthlyReports` is keyed by tenancy, not property, because a mid-month
 * handover puts two tenancies on one property inside one calendar month and
 * both owe a part of it — a property alone can no longer say which report
 * to open.
 *
 * Zero matches: no tenancy ever covered this property in this month — a
 * genuine empty state, not an error. Exactly one: redirect straight through,
 * transparently. Two or more (the handover case this route exists for): ask,
 * rather than guessing which tenancy the report belongs to.
 */
export function PropertyReportRedirectPage() {
  const { t } = useTranslation()
  const { propertyId } = useParams()
  const [searchParams] = useSearchParams()

  const now = new Date()
  const month = Number(searchParams.get('month')) || now.getMonth() + 1
  const year = Number(searchParams.get('year')) || now.getFullYear()

  const {
    data: tenancies,
    isPending,
    isError,
    refetch,
  } = useTenanciesCoveringPropertyMonth(propertyId, month, year)

  if (isPending) {
    return (
      <p className="p-6 text-sm text-muted-foreground">{t('common.loading')}</p>
    )
  }

  if (isError) {
    return (
      <div className="flex flex-col items-start gap-2 p-6">
        <p className="text-sm text-muted-foreground">{t('reports.notFound')}</p>
        <RetryButton onRetry={refetch} />
      </div>
    )
  }

  if (tenancies.length === 0) {
    return (
      <p className="p-6 text-sm text-muted-foreground">
        {t('reports.noTenancyForMonth')}
      </p>
    )
  }

  if (tenancies.length === 1) {
    return (
      <Navigate
        to={`/admin/reports/${tenancies[0].id}?month=${month}&year=${year}`}
        replace
      />
    )
  }

  return (
    <div className="flex flex-col gap-4 p-6">
      <h1 className="text-lg font-semibold text-foreground">
        {t('reports.pickTenancy.title')}
      </h1>
      <p className="text-sm text-muted-foreground">
        {t('reports.pickTenancy.description')}
      </p>
      <ul className="flex flex-col gap-2">
        {tenancies.map((tenancy) => (
          <li key={tenancy.id}>
            <Link
              to={`/admin/reports/${tenancy.id}?month=${month}&year=${year}`}
              className="block rounded-md border border-border p-3 hover:bg-muted"
            >
              <span className="font-medium text-foreground">
                {tenancy.tenantName}
              </span>
              <span className="ml-2 text-sm text-muted-foreground">
                {tenancy.startDate} –{' '}
                {tenancy.endDate ?? t('reports.pickTenancy.ongoing')}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
