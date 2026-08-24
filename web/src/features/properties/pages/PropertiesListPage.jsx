import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { RetryButton } from '@/components/shared/RetryButton'
import { PageHeader } from '@/components/shared/PageHeader'
import { Table } from '@/components/shared/Table'
import { MoneyAmount } from '@/components/shared/MoneyAmount'
import { filterByText } from '@/lib/filterByText'
import { useProperties } from '@/features/properties/hooks'
import { useActiveTenancies } from '@/features/tenants/hooks'

/**
 * The property list (FR-PROP-07, SRS §5.3), also surfacing the status (FR-PROP-05).
 *
 * Reads through `useProperties` from sub-stage B — a SINGLE fetch (getDocs, not a
 * live subscription). Everything the admin toggles here is client-side:
 *  - the alphabetical sort happens in memory (at 5–20 properties, NFR-PERF-01, no
 *    Firestore index is worth its cost);
 *  - "Show archived" flips B's `includeArchived`, which decides the WHERE clause of
 *    that fetch — the filtering lives in the hook, not duplicated here.
 *  - the search (FR-PROP-07) is client-side too, over the already-fetched list, via
 *    the shared `filterByText` (the same util the tenant list uses). It was deferred
 *    past M1 and landed in M3 alongside the tenant list.
 *
 * The balance column (M8 stage 10) joins `useActiveTenancies` by `propertyId` —
 * the same source and the same join shape `TenantsListPage` already uses by
 * `userId`. Until this stage it was a hardcoded `0` (a stale M4 TODO):
 * `currentBalance` has carried the real figure since M4, this column was
 * simply never wired to it. A free property (no active tenancy) shows "—",
 * not a misleading `0`.
 */

/** Address as one line: "street number, city" (SRS §6 address shape). The optional
 * chaining guards a document written before the address existed. */
function formatAddress(address) {
  if (!address) return '—'
  return `${address.street} ${address.number}, ${address.city}`
}

/**
 * The status badge. An archived property keeps `status: 'free'` (separate axes,
 * SRS §6), so "archived" wins the label — same precedence as the detail page.
 * Otherwise an archived row would read "Free", which is the wrong fact.
 */
function StatusBadge({ property }) {
  const { t } = useTranslation()
  const key = property.archived ? 'archived' : property.status
  const tone = property.archived
    ? 'bg-muted text-muted-foreground'
    : property.status === 'occupied'
      ? 'bg-primary/10 text-primary'
      : 'bg-secondary text-secondary-foreground'

  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${tone}`}
    >
      {t(`properties.status.${key}`)}
    </span>
  )
}

export function PropertiesListPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [showArchived, setShowArchived] = useState(false)
  const [search, setSearch] = useState('')

  // The boolean is passed unconditionally, so the query key changes with the
  // toggle and B refetches with the right WHERE clause.
  const {
    data: properties,
    isPending: isPropertiesPending,
    isError: isPropertiesError,
    isFetching: isPropertiesFetching,
    refetch: refetchProperties,
  } = useProperties({ includeArchived: showArchived })
  const {
    data: tenancies,
    isPending: isTenanciesPending,
    isError: isTenanciesError,
    isFetching: isTenanciesFetching,
    refetch: refetchTenancies,
  } = useActiveTenancies()

  const isPending = isPropertiesPending || isTenanciesPending
  const isError = isPropertiesError || isTenanciesError
  const isFetching = isPropertiesFetching || isTenanciesFetching

  function refetch() {
    refetchProperties()
    refetchTenancies()
  }

  const balanceByProperty = useMemo(
    () =>
      new Map(
        (tenancies ?? []).map((tenancy) => [
          tenancy.propertyId,
          tenancy.currentBalance ?? 0,
        ]),
      ),
    [tenancies],
  )

  // A COPY before sorting: `sort` mutates in place, and the array belongs to the
  // react-query cache — sorting it directly would mutate cached state.
  const sorted = useMemo(
    () =>
      [...(properties ?? [])].sort((a, b) =>
        (a.name ?? '').localeCompare(b.name ?? ''),
      ),
    [properties],
  )

  // The search runs over the sorted list, matching name + the one-line address
  // (FR-PROP-07). Same shared util as the tenant list.
  const filtered = useMemo(
    () =>
      filterByText(sorted, search, (property) => [
        property.name,
        formatAddress(property.address),
      ]),
    [sorted, search],
  )

  function goToProperty(id) {
    navigate(`/admin/properties/${id}`)
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <PageHeader
        title={t('properties.list.title')}
        actions={
          <>
            <Input
              type="search"
              aria-label={t('properties.list.search')}
              placeholder={t('properties.list.search')}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="w-56"
            />
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <input
                type="checkbox"
                checked={showArchived}
                onChange={(event) => setShowArchived(event.target.checked)}
              />
              {t('properties.list.showArchived')}
            </label>
            <Button
              type="button"
              onClick={() => navigate('/admin/properties/new')}
            >
              {t('properties.list.add')}
            </Button>
          </>
        }
      />

      {isPending ? (
        <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
      ) : isError ? (
        <div className="flex flex-col items-start gap-2">
          <p className="text-sm text-destructive">
            {t('properties.list.error')}
          </p>
          <RetryButton onRetry={refetch} disabled={isFetching} />
        </div>
      ) : sorted.length === 0 ? (
        <div className="flex flex-col items-start gap-4 rounded-lg border border-border p-8">
          <p className="text-sm text-muted-foreground">
            {t('properties.list.empty')}
          </p>
          <Button
            type="button"
            onClick={() => navigate('/admin/properties/new')}
          >
            {t('properties.list.add')}
          </Button>
        </div>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t('properties.list.noMatches')}
        </p>
      ) : (
        <Table
          columns={[
            {
              key: 'name',
              header: t('properties.fields.name'),
              primary: true,
              render: (property) => property.name,
            },
            {
              key: 'address',
              header: t('properties.fields.address'),
              render: (property) => formatAddress(property.address),
            },
            {
              key: 'status',
              header: t('properties.fields.status'),
              render: (property) => <StatusBadge property={property} />,
            },
            {
              key: 'balance',
              header: t('properties.fields.balance'),
              align: 'right',
              render: (property) => (
                <MoneyAmount
                  value={balanceByProperty.get(property.id) ?? null}
                />
              ),
            },
          ]}
          rows={filtered}
          getRowKey={(property) => property.id}
          onRowClick={(property) => goToProperty(property.id)}
          rowClassName={(property) =>
            property.archived ? 'opacity-60' : undefined
          }
        />
      )}
    </div>
  )
}
