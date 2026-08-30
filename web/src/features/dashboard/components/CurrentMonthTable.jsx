import { useTranslation } from 'react-i18next'
import { Table } from '@/components/shared/Table'
import { MoneyAmount } from '@/components/shared/MoneyAmount'

/**
 * The Current-month list, rendered identically wherever it appears — the
 * dashboard's inline section (FR-DASH-02) and the standalone
 * `/admin/current-month` page (FR-DASH-02a: "both render the same rows from
 * the same data … not a reduced variant with different columns"). Rows are
 * built by `buildCurrentMonthRows` (`../calculations`); this component only
 * paints them. Columns are exactly SRS §5.3's list — property, renter,
 * report-status badge, total — each row linking to that tenancy's report
 * form for the selected month.
 */

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

export function CurrentMonthTable({ rows, onRowClick }) {
  const { t } = useTranslation()

  return (
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
          // A positive finalTotal is this month's ordinary bill, not
          // arrears — emphasizePositive={false} keeps it out of the
          // destructive colour the balance figures use.
          render: (row) => (
            <MoneyAmount value={row.total} emphasizePositive={false} />
          ),
        },
      ]}
      rows={rows}
      getRowKey={(row) => row.propertyId}
      onRowClick={onRowClick}
    />
  )
}
