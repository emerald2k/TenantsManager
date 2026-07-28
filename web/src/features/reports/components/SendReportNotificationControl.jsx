import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useSendReportNotification } from '@/features/reports/hooks'

/**
 * The "Send by email" control (SRS §5.3, FR-REP-06/FR-REP-07a). A signed
 * report ONLY — rendered by MonthlyReportPage next to SignReportControl,
 * gated on the SAME `isLocked`, read-only (M4 sub-stage 6). The admin picks
 * A2 ("new report") vs A3 ("report updated") explicitly, every time — this
 * dialog IS that choice; there is no default or remembered selection.
 *
 * The error message renders INSIDE `DialogContent`, not in the outer
 * wrapper: on failure the dialog deliberately stays open, and Radix marks
 * everything OUTSIDE the open dialog `aria-hidden` + `pointer-events: none`
 * (the same subtree PaymentSection's tests surfaced in M4 sub-stage 5). An
 * error painted in the outer wrapper would be invisible/unreachable to the
 * admin even though `findByText`/`toBeVisible()` don't catch that — neither
 * checks `aria-hidden`. The success message stays in the outer wrapper on
 * purpose: the dialog is already closed by the time it renders.
 */
export function SendReportNotificationControl({ report }) {
  const { t } = useTranslation()
  const sendNotification = useSendReportNotification()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState(false)

  async function handleSend(template) {
    setError(false)
    try {
      await sendNotification.mutateAsync({ id: report.id, template })
      setSuccess(true)
      setDialogOpen(false)
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
          setDialogOpen(true)
        }}
      >
        {t('reports.notify.button')}
      </Button>

      {success && (
        <p role="status" className="text-sm text-muted-foreground">
          {t('reports.notify.success')}
        </p>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t('reports.notify.dialogTitle')}</DialogTitle>
            <DialogDescription>
              {t('reports.notify.dialogBody')}
            </DialogDescription>
          </DialogHeader>

          {error && (
            <p role="alert" className="text-sm text-destructive">
              {t('reports.notify.error')}
            </p>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setDialogOpen(false)}
            >
              {t('common.cancel')}
            </Button>
            <Button
              type="button"
              onClick={() => handleSend('new')}
              disabled={sendNotification.isPending}
            >
              {t('reports.notify.templateNew')}
            </Button>
            <Button
              type="button"
              onClick={() => handleSend('updated')}
              disabled={sendNotification.isPending}
            >
              {t('reports.notify.templateUpdated')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
