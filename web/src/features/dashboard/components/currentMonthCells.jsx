import { useTranslation } from 'react-i18next'
import { MoneyAmount } from '@/components/shared/MoneyAmount'
import { formatCurrency } from '@/lib/formatCurrency'
import { formatFullDate } from '@/lib/formatDate'
import { formatMonthNameLabel } from '@/features/dashboard/calculations'

/**
 * The four cell renderers of the Current-month list, factored out so the
 * seven-column table (`CurrentMonthTable`, ≥ ~1100 px) and the phone/tablet
 * cards (`CurrentMonthCards`, ≤ ~1100 px — the owner's 2026-08-30 exception in
 * NFR-UX-03) render every badge, amount and due-date line identically.
 * FR-DASH-02a forbids the two surfaces diverging; sharing the renderers makes
 * that structural rather than a thing to keep in sync by hand.
 *
 * Every derivation already lives in `../calculations` (`buildCurrentMonthRows`);
 * these only paint the row object.
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

export function ReportBadge({ state }) {
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

export function PaymentBadge({ payment, language }) {
  const { t } = useTranslation()
  if (payment.kind === 'none') {
    return <span className="text-muted-foreground">—</span>
  }
  const label =
    payment.kind === 'arrears'
      ? t('dashboard.currentMonth.payment.arrears', {
          month: formatMonthNameLabel(
            payment.arrearsMonth.month,
            payment.arrearsMonth.year,
            language,
          ),
        })
      : t(`dashboard.currentMonth.payment.${payment.kind}`)
  return <Badge tone={PAYMENT_TONE[payment.tone]}>{label}</Badge>
}

/** The month's own bill (`finalTotal`), muted while the report is a draft, "—"
 * when no report exists this month. Never shown on the phone card — NFR-UX-03
 * drops the Total-due column there — so this is table-only today. */
export function TotalDueValue({ row }) {
  if (row.totalDue === null) {
    return <span className="text-muted-foreground">—</span>
  }
  return (
    <span className={row.totalDueMuted ? 'text-muted-foreground' : ''}>
      <MoneyAmount value={row.totalDue} emphasizePositive={false} />
    </span>
  )
}

/** `balanceAsOf(tenancy, M)` — everything still owed, "—" at zero or below
 * (FR-DASH-02b). Red when the obligation is past its due date. */
export function RemainingValue({ row }) {
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

/** The oldest unsettled obligation's due date, with the small consequence line
 * beneath it (paid on time · n days late · due in n days · after signing). */
export function DueDateLine({ row, language }) {
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
