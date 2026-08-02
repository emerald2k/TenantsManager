import { useTranslation } from 'react-i18next'
import { PAYMENT_STATUS_KEY } from '@/components/shared/ReportSummaryView'

/**
 * Four-state payment badge (M5 sub-stage 3 plan, FR-TAPP-01 decision #3):
 * paid / partial / unpaid / a NEW neutral state when `paymentStatus` is
 * absent — never silently collapsed into `unpaid`, which is exactly the bug
 * this component exists to avoid (`ReportSummaryView`'s own payment row
 * still does that collapse, unchanged, for its three existing callers).
 *
 * Imports the three existing keys from `ReportSummaryView` (exported in
 * Task 0) and extends them with only the fourth — no copy of the three.
 *
 * Same pill shape as `StatusBadge` (tenants/pages/TenantsListPage.jsx) —
 * mirrored, not imported, since that one is keyed on `users.status`, a
 * different enum entirely.
 */

const PAYMENT_STATUS_KEY_WITH_NOT_RECORDED = {
  ...PAYMENT_STATUS_KEY,
  notRecorded: 'reports.payment.statusNotRecorded',
}

const PAYMENT_TONE = {
  paid: 'bg-primary/10 text-primary',
  partial: 'bg-accent text-accent-foreground',
  unpaid: 'bg-destructive/10 text-destructive',
  notRecorded: 'bg-secondary text-secondary-foreground',
}

export function PaymentStatusBadge({ paymentStatus }) {
  const { t } = useTranslation()
  const statusKey = paymentStatus ?? 'notRecorded'

  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${PAYMENT_TONE[statusKey]}`}
    >
      {t(PAYMENT_STATUS_KEY_WITH_NOT_RECORDED[statusKey])}
    </span>
  )
}
