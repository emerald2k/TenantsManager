import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { useSendPaymentConfirmation } from '@/features/reports/hooks'

/**
 * The A10 "payment recorded" email control (SRS §5.3, FR-PAY-01, Appendix
 * A10, M8 stage 14 commit B). Rendered by `PaymentSection` ONLY once a
 * payment exists on the report — the same `hasPayment` gate as the "Cancel
 * payment" button; there is nothing to confirm before then, and the
 * callable rejects that case anyway (`failed-precondition`, `no-payment`).
 *
 * The email is never sent behind the administrator's back (A10: "ONLY on
 * the administrator's explicit request"). A confirm dialog stands in front
 * of it because it reaches the tenant (SRS §5.5: "Confirmation for … those
 * affecting the tenant"). No template choice — A10 has one form, unlike
 * A2/A3's `SendReportNotificationControl`.
 */
export function SendPaymentConfirmationControl({ report }) {
  const { t } = useTranslation()
  const sendConfirmation = useSendPaymentConfirmation()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState(false)

  async function handleConfirm() {
    setError(false)
    try {
      await sendConfirmation.mutateAsync({ id: report.id })
      setSuccess(true)
      setConfirmOpen(false)
    } catch {
      setError(true)
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <Button
        type="button"
        variant="outline"
        onClick={() => {
          setSuccess(false)
          setError(false)
          setConfirmOpen(true)
        }}
      >
        {t('reports.payment.confirmButton')}
      </Button>

      {success && (
        <p role="status" className="text-sm text-muted-foreground">
          {t('reports.payment.confirmSuccess')}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {t('reports.payment.confirmError')}
        </p>
      )}

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        titleKey="reports.payment.confirmDialogTitle"
        descriptionKey="reports.payment.confirmDialogBody"
        confirmKey="reports.payment.confirmDialogButton"
        destructive={false}
        onConfirm={handleConfirm}
        isPending={sendConfirmation.isPending}
      />
    </div>
  )
}
