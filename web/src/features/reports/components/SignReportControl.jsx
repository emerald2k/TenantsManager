import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { useSignReport, useUnlockReport } from '@/features/reports/hooks'

/**
 * The Sign/Unlock control (SRS §5.3 sticky footer, FR-REP-07/07a). Renders
 * exactly ONE of the two buttons depending on `report.status` — never both.
 * Owns its own confirm dialog per action (`ConfirmDialog`, shared/) and its
 * own error line; the callable failure (e.g. a race where the report was
 * already signed elsewhere) surfaces here, not silently swallowed.
 */
export function SignReportControl({ report }) {
  const { t } = useTranslation()
  const signReport = useSignReport()
  const unlockReport = useUnlockReport()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [error, setError] = useState(null)

  const isSigned = report.status === 'signed'
  const mutation = isSigned ? unlockReport : signReport

  async function handleConfirm() {
    setError(null)
    try {
      await mutation.mutateAsync({ id: report.id })
      setConfirmOpen(false)
    } catch {
      setError(isSigned ? 'reports.unlock.error' : 'reports.sign.error')
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <Button
        type="button"
        variant={isSigned ? 'outline' : 'default'}
        onClick={() => {
          setError(null)
          setConfirmOpen(true)
        }}
      >
        {t(isSigned ? 'reports.unlock.button' : 'reports.sign.button')}
      </Button>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {t(error)}
        </p>
      )}

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        titleKey={
          isSigned ? 'reports.unlock.confirmTitle' : 'reports.sign.confirmTitle'
        }
        descriptionKey={
          isSigned ? 'reports.unlock.confirmBody' : 'reports.sign.confirmBody'
        }
        confirmKey={
          isSigned
            ? 'reports.unlock.confirmButton'
            : 'reports.sign.confirmButton'
        }
        onConfirm={handleConfirm}
        destructive={false}
        isPending={mutation.isPending}
      />
    </div>
  )
}
