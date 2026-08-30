import { useTranslation } from 'react-i18next'
import { Table } from '@/components/shared/Table'
import { MoneyAmount } from '@/components/shared/MoneyAmount'
import { formatCurrency } from '@/lib/formatCurrency'
import { formatFullDate } from '@/lib/formatDate'
import { formatMonthNameLabel } from '@/features/dashboard/calculations'

/**
 * The Current-month list, seven columns (FR-DASH-02b), rendered identically
 * on the dashboard's inline section and `/admin/current-month` from the same
 * `buildCurrentMonthRows` output (FR-DASH-02a). This component only paints
 * the row objects; every derivation lives in `../calculations`.
 *
 * Property · Renter · Report · Payment · Total due · Remaining to collect ·
 * Due date. Total due is the month's own bill; Remaining is
 * `balanceAsOf(tenancy, M)` — the two are different questions and a row can
 * legitimately show "—" for one and a figure for the other.
 */

const REPORT_TONE = {
  signed: 'bg-primary/10 text-primary',
  draft: 'bg-warning/10 text-warning',
  'not-entered': 'bg-warning/10 text-warning',
}

const PAYMENT_TONE = {
  ok: 'bg-primary text-primary-foreground',
  neutral: 'bg-secondary text-secondary-foreground',
  muted: 'bg-muted text-muted-foreground',
  destructive: 'bg-destructive/10 text-destructive',
}

function Badge({ tone, children }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${tone}`}
    >
      {children}
    </span>
  )
}

function ReportCell({ state }) {
  const { t } = useTranslation()
  const key = { signed: 'signed', draft: 'draft', 'not-entered': 'notEntered' }[
    state
  ]
  return (
    <Badge tone={REPORT_TONE[state]}>
      {t(`dashboard.currentMonth.report.${key}`)}
    </Badge>
  )
}

function PaymentCell({ payment, language }) {
  const { t } = useTranslation()
  const label =
    payment.kind === 'arrears'
      ? t('dashboard.currentMonth.payment.arrears', {
          month: formatMonthNameLabel(
            payment.arrearsMonth.month,
            payment.arrearsMonth.year,
            language,
          ),
        })
      : payment.kind === 'none'
        ? '—'
        : t(`dashboard.currentMonth.payment.${payment.kind}`)
  if (payment.kind === 'none') {
    return <span className="text-muted-foreground">—</span>
  }
  return <Badge tone={PAYMENT_TONE[payment.tone]}>{label}</Badge>
}

function RemainingCell({ row }) {
  if (!row.remainingShown) {
    return <span className="text-muted-foreground">—</span>
  }
  return (
    <span
      className={
        row.isOverdue ? 'text-destructive tabular-nums' : 'tabular-nums'
      }
    >
      {formatCurrency(row.remaining)}
    </span>
  )
}

function DueDateCell({ row, language }) {
  const { t } = useTranslation()
  const consequence =
    row.dueConsequence === 'late' || row.dueConsequence === 'upcoming'
      ? t(`dashboard.currentMonth.due.${row.dueConsequence}`, {
          count: row.dueDayCount,
        })
      : t(`dashboard.currentMonth.due.${row.dueConsequence}`)
  return (
    <span className="flex flex-col">
      <span>{formatFullDate(row.dueDate, language)}</span>
      <span
        className={`text-xs ${
          row.dueConsequence === 'late'
            ? 'text-destructive'
            : 'text-muted-foreground'
        }`}
      >
        {consequence}
      </span>
    </span>
  )
}

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
          render: (row) => <ReportCell state={row.reportState} />,
        },
        {
          key: 'payment',
          header: t('dashboard.currentMonth.columns.payment'),
          render: (row) => (
            <PaymentCell payment={row.payment} language={i18n.language} />
          ),
        },
        {
          key: 'totalDue',
          header: t('dashboard.currentMonth.columns.totalDue'),
          align: 'right',
          render: (row) =>
            row.totalDue === null ? (
              <span className="text-muted-foreground">—</span>
            ) : (
              <span
                className={row.totalDueMuted ? 'text-muted-foreground' : ''}
              >
                <MoneyAmount value={row.totalDue} emphasizePositive={false} />
              </span>
            ),
        },
        {
          key: 'remaining',
          header: t('dashboard.currentMonth.columns.remaining'),
          align: 'right',
          render: (row) => <RemainingCell row={row} />,
        },
        {
          key: 'dueDate',
          header: t('dashboard.currentMonth.columns.dueDate'),
          render: (row) => <DueDateCell row={row} language={i18n.language} />,
        },
      ]}
      rows={rows}
      getRowKey={(row) => row.propertyId}
      onRowClick={onRowClick}
    />
  )
}
