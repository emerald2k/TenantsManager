import { useTranslation } from 'react-i18next'
import { formatMonthYearLabel } from '@/features/dashboard/calculations'
import { formatCurrency } from '@/lib/formatCurrency'
import { PaymentStatusBadge } from '@/features/tenantApp/components/PaymentStatusBadge'

/**
 * One summary row per signed report (FR-TAPP-02, `/app/history`, M5
 * sub-stage 5 plan Task 3): month, final total, amount paid, status badge —
 * nothing else. Never reads `rent`/`maintenance`/`serviceCosts`/
 * `otherExpenses`/notes/attachments off `report` at all, structurally
 * enforcing "no breakdown inline" rather than merely omitting a call to
 * render them.
 *
 * `formatCurrency(report.amountPaid)` renders "0,00 lei" identically
 * whether `amountPaid` is explicitly `null` (the `useCancelPayment` shape)
 * or the key is absent entirely (a never-touched, just-signed report) —
 * both real shapes the app itself produces (M5 sub-stage 4 seed).
 *
 * Deliberately NOT interactive this sub-stage (no `onClick`, no `<Link>`,
 * no `role="button"`) — the click-through to `/app/reports/:reportId` is
 * sub-stage 6, which does not exist yet.
 */
export function ReportHistoryRow({ report }) {
  const { i18n } = useTranslation()

  return (
    <tr className="border-b border-border last:border-0">
      <td className="px-4 py-2 align-middle font-medium text-foreground">
        {formatMonthYearLabel(report.month, report.year, i18n.language)}
      </td>
      <td className="px-4 py-2 text-right align-middle tabular-nums">
        {formatCurrency(report.finalTotal)}
      </td>
      <td className="px-4 py-2 text-right align-middle tabular-nums">
        {formatCurrency(report.amountPaid)}
      </td>
      <td className="px-4 py-2 align-middle">
        <PaymentStatusBadge paymentStatus={report.paymentStatus ?? null} />
      </td>
    </tr>
  )
}
