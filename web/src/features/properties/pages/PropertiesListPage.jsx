import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { useProperties } from '@/features/properties/hooks'

/**
 * The property list (FR-PROP-07, SRS §5.3), also surfacing the status (FR-PROP-05).
 *
 * Reads through `useProperties` from sub-stage B — a SINGLE fetch (getDocs, not a
 * live subscription). Everything the admin toggles here is client-side:
 *  - the alphabetical sort happens in memory (at 5–20 properties, NFR-PERF-01, no
 *    Firestore index is worth its cost);
 *  - "Show archived" flips B's `includeArchived`, which decides the WHERE clause of
 *    that fetch — the filtering lives in the hook, not duplicated here.
 *
 * Search (SRS §5.3) is deliberately NOT here: deferred by the administrator's
 * decision for M1. No search input is rendered.
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

  // The boolean is passed unconditionally, so the query key changes with the
  // toggle and B refetches with the right WHERE clause.
  const {
    data: properties,
    isPending,
    isError,
  } = useProperties({ includeArchived: showArchived })

  // A COPY before sorting: `sort` mutates in place, and the array belongs to the
  // react-query cache — sorting it directly would mutate cached state.
  const sorted = useMemo(
    () =>
      [...(properties ?? [])].sort((a, b) =>
        (a.name ?? '').localeCompare(b.name ?? ''),
      ),
    [properties],
  )

  function goToProperty(id) {
    navigate(`/admin/properties/${id}`)
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-xl font-semibold text-foreground">
          {t('properties.list.title')}
        </h1>
        <div className="flex items-center gap-4">
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
        </div>
      </div>

      {isPending ? (
        <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
      ) : isError ? (
        <p className="text-sm text-destructive">{t('properties.list.error')}</p>
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
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border bg-muted/50">
              <tr className="text-xs text-muted-foreground">
                <th className="px-4 py-2 font-medium">
                  {t('properties.fields.name')}
                </th>
                <th className="px-4 py-2 font-medium">
                  {t('properties.fields.address')}
                </th>
                <th className="px-4 py-2 font-medium">
                  {t('properties.fields.status')}
                </th>
                <th className="px-4 py-2 text-right font-medium">
                  {t('properties.fields.balance')}
                </th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((property) => (
                <tr
                  key={property.id}
                  onClick={() => goToProperty(property.id)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      goToProperty(property.id)
                    }
                  }}
                  tabIndex={0}
                  className={`cursor-pointer border-b border-border last:border-0 hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none ${
                    property.archived ? 'opacity-60' : ''
                  }`}
                >
                  <td className="px-4 py-3 font-medium text-foreground">
                    {property.name}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {formatAddress(property.address)}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge property={property} />
                  </td>
                  {/* TODO M4: the real outstanding balance comes from the tenancy's
                      currentBalance (FR-PROP-05). Until then a neutral 0 — the red
                      "in arrears" styling activates at M4 with real data. */}
                  <td className="px-4 py-3 text-right text-muted-foreground tabular-nums">
                    0
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
