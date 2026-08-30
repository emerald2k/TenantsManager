import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
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
 * Navigable to `/app/reports/:reportId` (M5 sub-stage 6 plan, Task 1) — the
 * EXACT `onClick`/`onKeyDown`/`tabIndex` mechanism `TenantsListPage.jsx`
 * already uses for its own clickable rows (no `role="button"`, matching
 * that precedent exactly). `useNavigate` lives HERE rather than in
 * `TenantHistoryPage` because an `<a>`/`<Link>` cannot legally wrap a `<tr>`
 * inside a `<table>` — same constraint `TenantsListPage` works around the
 * same way. Keeping navigation internal to this component also means its
 * prop signature stays exactly `{ report }`, unchanged from sub-stage 5.
 */
export function ReportHistoryRow({ report }) {
  const { i18n } = useTranslation()
  const navigate = useNavigate()

  function goToDetail() {
    navigate(`/app/reports/${report.id}`)
  }

  return (
    <tr
      onClick={goToDetail}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          goToDetail()
        }
      }}
      tabIndex={0}
      className="cursor-pointer border-b border-border last:border-0 hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none"
    >
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
      {/* NFR-UX-06 rule 3 — a permanent static mark so a touch user sees the
          row is actionable before pressing it. */}
      <td className="w-6 px-2 py-2 text-right align-middle">
        <ChevronRight
          className="inline size-4 text-muted-foreground"
          aria-hidden="true"
        />
      </td>
    </tr>
  )
}
