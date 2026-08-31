import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { formatCurrency } from '@/lib/formatCurrency'
import { useSignedReportsForTenancy } from '@/features/reports/hooks'
import { useRecalculateTenancyBalance } from '@/features/tenants/hooks'
import {
  computeBalanceFromReports,
  sortReportsChronologically,
} from '@/features/tenants/balanceRecalculation'

/**
 * The "Recalculate balance" control (FR-SYS-05a, M8 stage 7) — the
 * administrator's answer to a `reconcileBalances` mismatch email. Shows the
 * STORED value, the RECOMPUTED value (client-side preview, from the same
 * signed-report chain the server will use), and the chain itself — all
 * BEFORE confirming. Confirming calls `recalculateTenancyBalance` (a Cloud
 * Function; `NFR-SEC-12` pins this field against every client write, so
 * there is no other way to change it), which recomputes independently,
 * server-side, at the moment of the write — closing any staleness window
 * between this preview and the confirm click.
 *
 * "Nothing recalculates on its own" (FR-SYS-05): this control does nothing
 * unless the admin opens the dialog and confirms it.
 */
export function RecalculateBalanceControl({ tenancy, userId }) {
  const { t } = useTranslation()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [error, setError] = useState(false)
  const [lastResult, setLastResult] = useState(null)
  const reportsQuery = useSignedReportsForTenancy(tenancy.id)
  const recalculate = useRecalculateTenancyBalance()

  const stored = tenancy.currentBalance ?? 0
  const reports = reportsQuery.data ?? []
  const recomputed = computeBalanceFromReports(reports)
  const chain = sortReportsChronologically(reports)
  const mostRecentId = chain.length > 0 ? chain[chain.length - 1].id : null

  async function handleConfirm() {
    setError(false)
    try {
      const result = await recalculate.mutateAsync({
        tenancyId: tenancy.id,
        userId,
      })
      setLastResult(result)
      setConfirmOpen(false)
    } catch {
      setError(true)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">
          {t('tenants.detail.balance.stored')}
        </span>
        <span className="text-sm font-medium text-foreground">
          {formatCurrency(stored)}
        </span>
      </div>

      <div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            setError(false)
            setConfirmOpen(true)
          }}
        >
          {t('tenants.detail.balance.recalculateButton')}
        </Button>
      </div>

      {lastResult && (
        <p className="text-xs text-muted-foreground">
          {t('tenants.detail.balance.recalculatedNotice', {
            from: formatCurrency(lastResult.from),
            to: formatCurrency(lastResult.to),
          })}
        </p>
      )}

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {t('tenants.detail.balance.error')}
        </p>
      )}

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        titleKey="tenants.detail.balance.confirmTitle"
        descriptionKey="tenants.detail.balance.confirmBody"
        confirmKey="tenants.detail.balance.confirmButton"
        onConfirm={handleConfirm}
        destructive={false}
        isPending={recalculate.isPending}
      >
        <div className="flex flex-col gap-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">
              {t('tenants.detail.balance.stored')}
            </span>
            <span className="font-medium text-foreground">
              {formatCurrency(stored)}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">
              {t('tenants.detail.balance.recomputed')}
            </span>
            <span className="font-medium text-foreground">
              {formatCurrency(recomputed)}
            </span>
          </div>

          {chain.length > 0 && (
            <div className="flex flex-col gap-1 border-t border-border pt-2">
              <span className="text-xs text-muted-foreground">
                {t('tenants.detail.balance.reportChain')}
              </span>
              <ul className="flex flex-col gap-1">
                {chain.map((report) => (
                  <li
                    key={report.id}
                    className={`flex justify-between text-xs ${
                      report.id === mostRecentId
                        ? 'font-medium text-foreground'
                        : 'text-muted-foreground'
                    }`}
                  >
                    <span>
                      {report.month}/{report.year}
                    </span>
                    <span>{formatCurrency(report.finalTotal)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </ConfirmDialog>
    </div>
  )
}
