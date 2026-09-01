import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { RetryButton } from '@/components/shared/RetryButton'
import { PageHeader } from '@/components/shared/PageHeader'
import { Table } from '@/components/shared/Table'
import { MoneyAmount } from '@/components/shared/MoneyAmount'
import { filterByText } from '@/lib/filterByText'
import { formatFullDate } from '@/lib/formatDate'
import { useActiveTenancies, useUsers } from '@/features/tenants/hooks'
import { useProperties } from '@/features/properties/hooks'
import {
  useCreateDraft,
  useDeleteDraft,
  useDraftsList,
} from '@/features/onboarding/hooks'

/**
 * The tenant list (FR-TEN-13, SRS §5.3). It merges TWO sources into one table:
 *  - `onboardingDrafts` (in progress) → rows with an "in progress" badge and
 *    inline Continue / Delete-draft actions (reusing the M2 draft mechanisms);
 *  - `users` (the tenants themselves) → rows badged from `users.status`, their
 *    current property + outstanding balance joined from the ACTIVE tenancy.
 *
 * All the toggling/searching/sorting is client-side (a handful to a few dozen
 * rows, NFR-PERF-01): a single read per source, everything else in memory.
 *
 * "+ New tenant onboarding" creates an empty draft (FR-TEN-17) and opens the
 * wizard — the same entry point this page had before the full list existed.
 */

/** `users.status` (the SRS §6 enum) → the badge key. `inactive-readonly`
 * collapses to a plain "inactive" label; the read-only nuance is an app concern,
 * not something the list column needs to spell out.
 *
 * Exported (M3-B): the tenant detail page's header badge reuses this mapping —
 * a single source keeps the list and the detail page from drifting apart. */
export function mapUserStatus(status) {
  switch (status) {
    case 'active':
      return 'active'
    case 'disabled':
      return 'disabled'
    case 'archived':
      return 'archived'
    case 'inactive-readonly':
    default:
      return 'inactive'
  }
}

const STATUS_TONE = {
  active: 'bg-primary/10 text-primary',
  inactive: 'bg-secondary text-secondary-foreground',
  disabled: 'bg-destructive/10 text-destructive',
  archived: 'bg-muted text-muted-foreground',
  inProgress: 'bg-accent text-accent-foreground',
}

/** Exported alongside `mapUserStatus` for the same reason — the detail page's
 * header badge renders identically to a list row's badge. */
export function StatusBadge({ statusKey }) {
  const { t } = useTranslation()
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_TONE[statusKey]}`}
    >
      {t(`tenants.status.${statusKey}`)}
    </span>
  )
}

/** A cell value or an em-dash when it is empty/absent — keeps empty cells from
 * rendering as a confusing blank. */
function cellOrDash(value) {
  return value === null || value === undefined || value === '' ? '—' : value
}

/** The name cell for a draft that has no name yet (audit #5): "Draft nou",
 * plus "· început la {date}" once `createdAt` is a real Firestore Timestamp,
 * plus "· {property}" once step 4 has pointed the draft at one. With several
 * unnamed drafts in the list (FR-TEN-21 allows any number), the date is what
 * tells them apart. */
function draftNameCell(row, t, language) {
  const parts = [t('tenants.list.draftNew')]
  if (row.createdAt && typeof row.createdAt.toDate === 'function') {
    parts.push(
      t('tenants.list.draftStartedOn', {
        date: formatFullDate(row.createdAt, language),
      }),
    )
  }
  if (row.draftProperty) parts.push(row.draftProperty)
  return <span className="text-muted-foreground">{parts.join(' · ')}</span>
}

export function TenantsListPage() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()

  const [search, setSearch] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [createFailed, setCreateFailed] = useState(false)

  const users = useUsers()
  const tenancies = useActiveTenancies()
  const drafts = useDraftsList()
  // For the draft-row label (audit #5): the name of a property a draft has
  // already been pointed at. Archived included — a draft can name one.
  const properties = useProperties({ includeArchived: true })
  const createDraft = useCreateDraft()
  const deleteDraft = useDeleteDraft()

  // The reads load in parallel; the table waits for all of them so it
  // never renders half-populated (a user row with a missing property because
  // the tenancies query has not resolved yet).
  const isPending =
    users.isPending ||
    tenancies.isPending ||
    drafts.isPending ||
    properties.isPending
  const isError = users.isError || tenancies.isError || drafts.isError

  // One row model for both sources, so sort/search/render treat them uniformly.
  const rows = useMemo(() => {
    const tenancyByUser = new Map(
      (tenancies.data ?? []).map((tenancy) => [tenancy.userId, tenancy]),
    )
    const propertyById = new Map(
      (properties.data ?? []).map((property) => [property.id, property]),
    )
    const draftRows = (drafts.data ?? []).map((draft) => ({
      kind: 'draft',
      id: draft.id,
      name: draft.name ?? '',
      phone: draft.phone ?? null,
      email: draft.email ?? null,
      // A draft only gains a propertyId at step 4; before that it is null and
      // the row shows just "Draft nou · început la {date}" (audit #5).
      createdAt: draft.createdAt ?? null,
      draftProperty: draft.propertyId
        ? (propertyById.get(draft.propertyId)?.name ?? null)
        : null,
      property: null,
      balance: null,
      statusKey: 'inProgress',
      isArchived: false,
    }))
    const userRows = (users.data ?? []).map((user) => {
      // FR-CON-02 guarantees at most one active tenancy per account, so the
      // userId → tenancy lookup is unambiguous.
      const tenancy = tenancyByUser.get(user.id)
      return {
        kind: 'user',
        id: user.id,
        name: user.name ?? '',
        phone: user.phone ?? null,
        email: user.email ?? null,
        property: tenancy?.property?.name ?? null,
        // No active tenancy → no balance to show (null → "—"); with one, the
        // balance is 0 until M4 fills it in (red only when > 0).
        balance: tenancy ? (tenancy.currentBalance ?? 0) : null,
        statusKey: mapUserStatus(user.status),
        isArchived: user.status === 'archived',
      }
    })
    return [...draftRows, ...userRows]
  }, [users.data, tenancies.data, drafts.data, properties.data])

  // Archived hidden by default (mirrors the Properties "Show archived" UX); the
  // sort is alphabetical by name. An unnamed draft (name '') sorts first and
  // renders "—" — graceful, deterministic, no crash.
  const visibleRows = useMemo(() => {
    const base = showArchived ? rows : rows.filter((row) => !row.isArchived)
    return [...base].sort((a, b) => a.name.localeCompare(b.name))
  }, [rows, showArchived])

  const filteredRows = useMemo(
    () =>
      filterByText(visibleRows, search, (row) => [
        row.name,
        row.phone,
        row.email,
      ]),
    [visibleRows, search],
  )

  async function startOnboarding() {
    setCreateFailed(false)
    try {
      const draftId = await createDraft.mutateAsync()
      navigate(`/admin/onboarding/${draftId}`)
    } catch {
      setCreateFailed(true)
    }
  }

  async function confirmDelete() {
    try {
      await deleteDraft.mutateAsync(deleteTarget)
      setDeleteTarget(null)
    } catch {
      // FR-TEN-25: `deleteOnboardingDraft` now surfaces a Storage failure
      // instead of swallowing it. Keep the dialog open and let
      // `deleteDraft.isError` show the message below — the admin can retry.
    }
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <PageHeader
        title={t('tenants.list.title')}
        actions={
          <>
            <Input
              type="search"
              aria-label={t('tenants.list.search')}
              placeholder={t('tenants.list.search')}
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
              {t('tenants.list.showArchived')}
            </label>
            <Button
              type="button"
              onClick={startOnboarding}
              disabled={createDraft.isPending}
            >
              {createDraft.isPending
                ? t('common.loading')
                : t('tenants.list.add')}
            </Button>
          </>
        }
      />

      {createFailed && (
        <div className="flex items-center gap-2">
          <p role="alert" className="text-sm text-destructive">
            {t('tenants.list.error')}
          </p>
          <RetryButton
            onRetry={startOnboarding}
            disabled={createDraft.isPending}
          />
        </div>
      )}

      {isPending ? (
        <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
      ) : isError ? (
        <div className="flex flex-col items-start gap-2">
          <p className="text-sm text-destructive">
            {t('tenants.list.loadError')}
          </p>
          <RetryButton
            onRetry={() => {
              users.refetch()
              tenancies.refetch()
              drafts.refetch()
            }}
            disabled={
              users.isFetching || tenancies.isFetching || drafts.isFetching
            }
          />
        </div>
      ) : visibleRows.length === 0 ? (
        <div className="flex flex-col items-start gap-4 rounded-lg border border-border p-8">
          <p className="text-sm text-muted-foreground">
            {t('tenants.list.empty')}
          </p>
          <Button
            type="button"
            onClick={startOnboarding}
            disabled={createDraft.isPending}
          >
            {t('tenants.list.add')}
          </Button>
        </div>
      ) : filteredRows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t('tenants.list.noMatches')}
        </p>
      ) : (
        <Table
          columns={[
            {
              key: 'name',
              header: t('tenants.fields.name'),
              primary: true,
              render: (row) =>
                row.kind === 'draft' && !row.name
                  ? draftNameCell(row, t, i18n.language)
                  : cellOrDash(row.name),
            },
            {
              key: 'phone',
              header: t('tenants.fields.phone'),
              render: (row) => cellOrDash(row.phone),
            },
            {
              key: 'email',
              header: t('tenants.fields.email'),
              render: (row) => cellOrDash(row.email),
            },
            {
              key: 'property',
              header: t('tenants.fields.property'),
              render: (row) => cellOrDash(row.property),
            },
            {
              key: 'balance',
              header: t('tenants.fields.balance'),
              align: 'right',
              render: (row) => <MoneyAmount value={row.balance} />,
            },
            {
              key: 'status',
              header: t('tenants.fields.status'),
              render: (row) => <StatusBadge statusKey={row.statusKey} />,
            },
            {
              key: 'actions',
              header: '',
              align: 'right',
              render: (row) =>
                row.kind === 'draft' ? (
                  <div className="flex justify-end gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => navigate(`/admin/onboarding/${row.id}`)}
                    >
                      {t('tenants.list.continue')}
                    </Button>
                    <Button
                      type="button"
                      variant="destructive"
                      onClick={() => setDeleteTarget(row.id)}
                    >
                      {t('tenants.list.deleteDraft')}
                    </Button>
                  </div>
                ) : null,
            },
          ]}
          rows={filteredRows}
          getRowKey={(row) => `${row.kind}-${row.id}`}
          onRowClick={(row) => navigate(`/admin/tenants/${row.id}`)}
          isRowClickable={(row) => row.kind === 'user'}
          rowClassName={(row) => (row.isArchived ? 'opacity-60' : undefined)}
        />
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteTarget(null)
            deleteDraft.reset()
          }
        }}
        titleKey="tenants.list.deleteDraftTitle"
        descriptionKey="tenants.list.deleteDraftDescription"
        confirmKey="tenants.list.deleteDraftConfirm"
        onConfirm={confirmDelete}
        isPending={deleteDraft.isPending}
      >
        {deleteDraft.isError && (
          <p role="alert" className="text-sm text-destructive">
            {t('tenants.list.deleteDraftError')}
          </p>
        )}
      </ConfirmDialog>
    </div>
  )
}
