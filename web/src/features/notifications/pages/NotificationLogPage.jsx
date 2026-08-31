import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { PageHeader } from '@/components/shared/PageHeader'
import { RetryButton } from '@/components/shared/RetryButton'
import { Table } from '@/components/shared/Table'
import { useNotificationLog } from '@/features/notifications/hooks'
import {
  DELIVERY_LABEL_KEY,
  DELIVERY_TONE,
  NOTIFICATION_WINDOW_MONTHS,
  TYPE_LABEL_KEY,
  formatSentAt,
  sortBySentAtDesc,
  withinWindow,
} from '@/features/notifications/calculations'

function DeliveryBadge({ state }) {
  const { t } = useTranslation()
  const labelKey = DELIVERY_LABEL_KEY[state]
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
        DELIVERY_TONE[state] ?? 'bg-muted text-muted-foreground'
      }`}
    >
      {labelKey ? t(`notifications.delivery.${labelKey}`) : state}
    </span>
  )
}

/**
 * The sent-email log (SRS §5.3 `/admin/notifications`, FR-NLOG-01…08, M8
 * stage 14 commit B). Read-only — no re-send, no row action (FR-NLOG-06);
 * `Table` is rendered without `onRowClick`. Columns are exactly SRS §5.5's
 * six: sent-at, type, audience, subject, recipient, delivery state. Bodies
 * are never fetched, never shown (FR-NLOG-02).
 *
 * NFR-UX-08 — the four checks, answered in the stage report:
 *  - primary focus: the log table. The window notice and title are
 *    subordinate (smaller, muted).
 *  - hidden until needed: nothing is progressively disclosed — a log is a
 *    flat read. `deliveryError` text is the one conditional element: it
 *    appears only on an ERROR row, never as an empty labelled slot
 *    (rule 1).
 *  - clicks to the main action: this screen HAS no action (FR-NLOG-06). It
 *    is reached in one click from the sidebar.
 *  - missing vs zero: two distinct empty states (FR-NLOG-08) — a genuinely
 *    empty log ("starts empty on the day M8 deploys") reads differently
 *    from an empty 12-month window on a populated log ("nothing in the last
 *    12 months"). Neither is a zero; a log has no numeric total to be zero.
 */
export function NotificationLogPage() {
  const { t } = useTranslation()
  const log = useNotificationLog()

  const rows = useMemo(() => {
    const all = log.data?.rows ?? []
    return sortBySentAtDesc(withinWindow(all))
  }, [log.data])

  return (
    <div className="flex flex-col gap-4 p-6">
      <PageHeader title={t('notifications.title')} />

      <p className="text-sm text-muted-foreground">
        {t('notifications.windowNotice', {
          months: NOTIFICATION_WINDOW_MONTHS,
        })}
      </p>

      {log.isPending ? (
        <p className="text-sm text-muted-foreground">
          {t('notifications.loading')}
        </p>
      ) : log.isError ? (
        <div className="flex flex-col items-start gap-2">
          <p className="text-sm text-destructive">{t('notifications.error')}</p>
          <RetryButton
            onRetry={() => log.refetch()}
            disabled={log.isFetching}
          />
        </div>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {log.data?.anyExist
            ? t('notifications.emptyNoneInWindow')
            : t('notifications.emptyStartsEmpty')}
        </p>
      ) : (
        <Table
          columns={[
            {
              key: 'sentAt',
              header: t('notifications.columns.sentAt'),
              primary: true,
              render: (row) => formatSentAt(row.sentAt),
            },
            {
              key: 'type',
              header: t('notifications.columns.type'),
              render: (row) =>
                TYPE_LABEL_KEY[row.type]
                  ? t(`notifications.type.${TYPE_LABEL_KEY[row.type]}`)
                  : (row.type ?? '—'),
            },
            {
              key: 'audience',
              header: t('notifications.columns.audience'),
              render: (row) =>
                row.audience
                  ? t(`notifications.audience.${row.audience}`)
                  : '—',
            },
            {
              key: 'subject',
              header: t('notifications.columns.subject'),
              render: (row) => row.subject ?? '—',
            },
            {
              key: 'recipient',
              header: t('notifications.columns.recipient'),
              render: (row) =>
                Array.isArray(row.to) ? row.to.join(', ') : (row.to ?? '—'),
            },
            {
              key: 'deliveryState',
              header: t('notifications.columns.deliveryState'),
              render: (row) => (
                <span className="flex flex-col gap-1">
                  <DeliveryBadge state={row.deliveryState} />
                  {row.deliveryState === 'ERROR' && row.deliveryError && (
                    <span className="text-xs text-destructive">
                      {row.deliveryError}
                    </span>
                  )}
                </span>
              ),
            },
          ]}
          rows={rows}
          getRowKey={(row) => row.id}
        />
      )}
    </div>
  )
}
