import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { formatCurrency } from '@/lib/formatCurrency'
import { useSignReport, useUnlockReport } from '@/features/reports/hooks'
import { isMaterialFinalTotalOverride } from '@/features/reports/schema'

/**
 * The Sign/Unlock control (SRS §5.3 sticky footer, FR-REP-07/07a/04e).
 * Renders exactly ONE of the two buttons depending on `report.status` —
 * never both. Owns its own confirm dialog per action (`ConfirmDialog`,
 * shared/) and its own error line; the callable failure (e.g. a race where
 * the report was already signed elsewhere, OR the server-side chronological
 * guard FR-REP-11 rejecting an out-of-order sign) surfaces here, not
 * silently swallowed.
 *
 * FR-REP-04e (second confirmation + written reason): gated on the SAVED
 * report's own `finalTotal`/`calculatedTotal`/`roundingSurplus` — signing
 * acts on the persisted draft, not in-progress unsaved form edits, so this
 * reads `report` (the same prop MonthlyReportPage already passes), never
 * live form state. Only relevant while signing (never unlocking).
 */
export function SignReportControl({ report }) {
  const { t } = useTranslation()
  const signReport = useSignReport()
  const unlockReport = useUnlockReport()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [error, setError] = useState(null)
  const [overrideReason, setOverrideReason] = useState('')

  const isSigned = report.status === 'signed'
  const mutation = isSigned ? unlockReport : signReport

  const needsOverrideReason =
    !isSigned &&
    isMaterialFinalTotalOverride(
      report.finalTotal,
      report.calculatedTotal,
      report.roundingSurplus,
    )
  const difference = (report.finalTotal ?? 0) - (report.calculatedTotal ?? 0)

  async function handleConfirm() {
    setError(null)
    try {
      await mutation.mutateAsync({
        id: report.id,
        ...(needsOverrideReason
          ? { overrideReason: overrideReason.trim() }
          : {}),
      })
      setConfirmOpen(false)
    } catch (mutationError) {
      setError(
        mutationError?.details?.reason === 'chronological-order'
          ? 'reports.sign.chronologicalOrderError'
          : isSigned
            ? 'reports.unlock.error'
            : 'reports.sign.error',
      )
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <Button
        type="button"
        variant={isSigned ? 'outline' : 'default'}
        onClick={() => {
          setError(null)
          setOverrideReason('')
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
        confirmDisabled={needsOverrideReason && overrideReason.trim() === ''}
      >
        {needsOverrideReason && (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-destructive">
              {t('reports.sign.overrideWarning', {
                value: formatCurrency(difference),
              })}
            </p>
            <label className="flex flex-col gap-1 text-sm">
              {t('reports.sign.overrideReasonLabel')}
              <textarea
                className="min-h-20 w-full rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                value={overrideReason}
                onChange={(event) => setOverrideReason(event.target.value)}
              />
            </label>
          </div>
        )}
      </ConfirmDialog>
    </div>
  )
}
