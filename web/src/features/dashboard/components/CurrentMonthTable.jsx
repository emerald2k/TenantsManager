import { useTranslation } from 'react-i18next'
import { Table } from '@/components/shared/Table'
import {
  DueDateLine,
  PaymentBadge,
  RemainingValue,
  ReportBadge,
  TotalDueValue,
} from '@/features/dashboard/components/currentMonthCells'

/**
 * The Current-month list, seven columns (FR-DASH-02b), rendered on the
 * dashboard's inline section and `/admin/current-month` from the same
 * `buildCurrentMonthRows` output (FR-DASH-02a). This is the wide layout;
 * `CurrentMonthList` swaps in `CurrentMonthCards` below ~1100 px (the owner's
 * 2026-08-30 NFR-UX-03 exception — seven columns cannot stay legible at tablet
 * width without hiding the money column behind a scroller). Every cell is a
 * shared renderer from `./currentMonthCells`, so the two layouts can never
 * disagree.
 *
 * Property · Renter · Report · Payment · Total due · Remaining to collect ·
 * Due date. Total due is the month's own bill; Remaining is
 * `balanceAsOf(tenancy, M)` — the two are different questions and a row can
 * legitimately show "—" for one and a figure for the other.
 */
export function CurrentMonthTable({ rows, onRowClick }) {
  const { t, i18n } = useTranslation()

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
          key: 'report',
          header: t('dashboard.currentMonth.columns.report'),
          render: (row) => <ReportBadge state={row.reportState} />,
        },
        {
          key: 'payment',
          header: t('dashboard.currentMonth.columns.payment'),
          render: (row) => (
            <PaymentBadge payment={row.payment} language={i18n.language} />
          ),
        },
        {
          key: 'totalDue',
          header: t('dashboard.currentMonth.columns.totalDue'),
          align: 'right',
          render: (row) => <TotalDueValue row={row} />,
        },
        {
          key: 'remaining',
          header: t('dashboard.currentMonth.columns.remaining'),
          align: 'right',
          render: (row) => <RemainingValue row={row} />,
        },
        {
          key: 'dueDate',
          header: t('dashboard.currentMonth.columns.dueDate'),
          render: (row) => <DueDateLine row={row} language={i18n.language} />,
        },
      ]}
      rows={rows}
      getRowKey={(row) => row.propertyId}
      onRowClick={onRowClick}
    />
  )
}
