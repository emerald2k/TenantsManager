import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { filterByText } from '@/lib/filterByText'
import { useActiveTenancies, useUsers } from '@/features/tenants/hooks'
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

export function TenantsListPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()

  const [search, setSearch] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [createFailed, setCreateFailed] = useState(false)

  const users = useUsers()
  const tenancies = useActiveTenancies()
  const drafts = useDraftsList()
  const createDraft = useCreateDraft()
  const deleteDraft = useDeleteDraft()

  // The three reads load in parallel; the table waits for all of them so it
  // never renders half-populated (a user row with a missing property because
  // the tenancies query has not resolved yet).
  const isPending = users.isPending || tenancies.isPending || drafts.isPending
  const isError = users.isError || tenancies.isError || drafts.isError

  // One row model for both sources, so sort/search/render treat them uniformly.
  const rows = useMemo(() => {
    const tenancyByUser = new Map(
      (tenancies.data ?? []).map((tenancy) => [tenancy.userId, tenancy]),
    )
    const draftRows = (drafts.data ?? []).map((draft) => ({
      kind: 'draft',
      id: draft.id,
      name: draft.name ?? '',
      phone: draft.phone ?? null,
      email: draft.email ?? null,
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
  }, [users.data, tenancies.data, drafts.data])

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
    await deleteDraft.mutateAsync(deleteTarget)
    setDeleteTarget(null)
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-xl font-semibold text-foreground">
          {t('tenants.list.title')}
        </h1>
        <div className="flex flex-wrap items-center gap-4">
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
        </div>
      </div>

      {createFailed && (
        <p role="alert" className="text-sm text-destructive">
          {t('tenants.list.error')}
        </p>
      )}

      {isPending ? (
        <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
      ) : isError ? (
        <p className="text-sm text-destructive">
          {t('tenants.list.loadError')}
        </p>
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
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border bg-muted/50">
              <tr className="text-xs text-muted-foreground">
                <th className="px-4 py-2 font-medium">
                  {t('tenants.fields.name')}
                </th>
                <th className="px-4 py-2 font-medium">
                  {t('tenants.fields.phone')}
                </th>
                <th className="px-4 py-2 font-medium">
                  {t('tenants.fields.email')}
                </th>
                <th className="px-4 py-2 font-medium">
                  {t('tenants.fields.property')}
                </th>
                <th className="px-4 py-2 text-right font-medium">
                  {t('tenants.fields.balance')}
                </th>
                <th className="px-4 py-2 font-medium">
                  {t('tenants.fields.status')}
                </th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row) => {
                const isUser = row.kind === 'user'
                return (
                  <tr
                    key={`${row.kind}-${row.id}`}
                    onClick={
                      isUser
                        ? () => navigate(`/admin/tenants/${row.id}`)
                        : undefined
                    }
                    onKeyDown={
                      isUser
                        ? (event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault()
                              navigate(`/admin/tenants/${row.id}`)
                            }
                          }
                        : undefined
                    }
                    tabIndex={isUser ? 0 : undefined}
                    className={`border-b border-border last:border-0 ${
                      isUser
                        ? 'cursor-pointer hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none'
                        : ''
                    } ${row.isArchived ? 'opacity-60' : ''}`}
                  >
                    <td className="px-4 py-3 font-medium text-foreground">
                      {cellOrDash(row.name)}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {cellOrDash(row.phone)}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {cellOrDash(row.email)}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {cellOrDash(row.property)}
                    </td>
                    <td
                      className={`px-4 py-3 text-right tabular-nums ${
                        row.balance > 0
                          ? 'text-destructive'
                          : 'text-muted-foreground'
                      }`}
                    >
                      {row.balance === null ? '—' : row.balance}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge statusKey={row.statusKey} />
                    </td>
                    <td className="px-4 py-3 text-right">
                      {row.kind === 'draft' && (
                        <div className="flex justify-end gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() =>
                              navigate(`/admin/onboarding/${row.id}`)
                            }
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
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
        titleKey="tenants.list.deleteDraftTitle"
        descriptionKey="tenants.list.deleteDraftDescription"
        confirmKey="tenants.list.deleteDraftConfirm"
        onConfirm={confirmDelete}
        isPending={deleteDraft.isPending}
      />
    </div>
  )
}
