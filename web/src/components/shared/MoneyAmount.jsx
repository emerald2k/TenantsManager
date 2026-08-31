import { useTranslation } from 'react-i18next'
import { formatCurrency } from '@/lib/formatCurrency'

/**
 * A signed currency figure, formatted (M8 stage 10) — found during this
 * stage's column audit rendering as a bare unformatted number on
 * `/admin/tenants` (`2730` instead of `2.730,00 lei`) and hardcoded to a
 * literal `0` on `/admin/properties` (a stale M4 TODO — `currentBalance`
 * has carried the real figure for tenancies since M4, that column was
 * simply never wired to it).
 *
 * Both `tenancies.currentBalance` and a report's own `finalTotal` are
 * signed the same way — positive is owed TO the owner, negative is credit
 * owed BY the owner (an overpaying tenant, FR-PAY-11) — so this component
 * serves either. §5.5: "no state is conveyed by colour alone" — a bare
 * `-500,00 lei` reads as a negative debt, not as credit.
 * `ReportSummaryView` already sets the precedent this follows: a credit
 * renders as a positive figure plus the word "Credit"
 * (`reports.fields.creditLabel`), reusing that exact key rather than
 * inventing new vocabulary for the same concept.
 *
 * @param value the signed amount, or `null`/`undefined` for "no figure yet".
 * @param emphasizePositive defaults `true` — a positive `currentBalance`
 *   is arrears and renders in the destructive colour (a balance column's
 *   whole point). `CurrentMonthPage`'s "Total" column passes `false`: a
 *   positive `finalTotal` is just this month's ordinary bill, not an
 *   alarm — only ITS negative case (a credit month) needs the same
 *   never-a-bare-negative-number treatment.
 */
export function MoneyAmount({ value, emphasizePositive = true }) {
  const { t } = useTranslation()

  if (value === null || value === undefined) return '—'

  if (value < 0) {
    return (
      <>
        {formatCurrency(-value)}{' '}
        <span className="text-xs text-muted-foreground">
          ({t('reports.fields.creditLabel')})
        </span>
      </>
    )
  }

  return (
    <span
      className={
        value > 0 && emphasizePositive ? 'text-destructive' : undefined
      }
    >
      {formatCurrency(value)}
    </span>
  )
}
