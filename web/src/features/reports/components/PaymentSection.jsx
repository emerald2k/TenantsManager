import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { paymentSchema } from '@/features/reports/schema'
import { useCancelPayment, useMarkPayment } from '@/features/reports/hooks'
import { SendPaymentConfirmationControl } from '@/features/reports/components/SendPaymentConfirmationControl'

/**
 * The payment section (SRS §5.3: "After publication — payment section:
 * amount, method, date, 'Mark payment', 'Cancel payment', credit indicator
 * on overpayment"). Rendered by MonthlyReportPage ONLY once the report is
 * signed (M4 sub-stage 5, plan Decision 5) — entirely separate from the
 * cost-line `isLocked`/`disabled` machinery of M4 sub-stage 4; this
 * component never receives or reads that prop.
 *
 * "Mark payment" is an upsert (plan Decision 6): the form is pre-filled from
 * whatever payment already exists (blank if none) and always overwrites —
 * FR-PAY-06's "corrected" is just re-marking with new values.
 */
export function PaymentSection({ report }) {
  const { t } = useTranslation()
  const markPayment = useMarkPayment()
  const cancelPayment = useCancelPayment()
  const [error, setError] = useState(null)
  const [confirmOpen, setConfirmOpen] = useState(false)

  const {
    register,
    handleSubmit,
    watch,
    reset,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(paymentSchema),
    defaultValues: {
      amountPaid: report.amountPaid ?? 0,
      paymentMethod: report.paymentMethod ?? 'cash',
      paymentDate: report.paymentDate ?? '',
    },
  })

  // `useForm`'s defaultValues are read ONCE, at mount — a payment mark/cancel
  // invalidates and refetches `report` (useMarkPayment/useCancelPayment),
  // but without this effect the inputs would keep showing whatever was there
  // before the mutation, even though report.paymentStatus (and the Cancel
  // button's visibility, below) already reflect the fresh data. Same
  // reset-on-external-change pattern as MonthlyReportPage's own effect.
  useEffect(() => {
    reset({
      amountPaid: report.amountPaid ?? 0,
      paymentMethod: report.paymentMethod ?? 'cash',
      paymentDate: report.paymentDate ?? '',
    })
  }, [report.amountPaid, report.paymentMethod, report.paymentDate, reset])

  const watchedAmountPaid = watch('amountPaid')
  const isOverpaid = Number(watchedAmountPaid) > Number(report.finalTotal)
  // A report that has never had a payment marked has no `paymentStatus`
  // field at all yet (it's written for the first time by useMarkPayment) —
  // `undefined !== 'unpaid'` would wrongly show Cancel on a never-paid
  // report, so this only counts an EXPLICIT partial/paid status.
  const hasPayment =
    report.paymentStatus === 'partial' || report.paymentStatus === 'paid'

  async function handleValid(values) {
    setError(null)
    try {
      await markPayment.mutateAsync({
        id: report.id,
        values,
        finalTotal: report.finalTotal,
      })
    } catch {
      setError('reports.payment.markError')
    }
  }

  async function handleCancel() {
    setError(null)
    try {
      await cancelPayment.mutateAsync({ id: report.id })
      setConfirmOpen(false)
    } catch {
      setError('reports.payment.cancelError')
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border p-4">
      <h2 className="text-sm font-semibold text-foreground">
        {t('reports.payment.title')}
      </h2>

      <form
        onSubmit={handleSubmit(handleValid)}
        noValidate
        className="flex flex-wrap items-end gap-4"
      >
        <div className="flex flex-col gap-1">
          <Label htmlFor="amountPaid">{t('reports.payment.amountPaid')}</Label>
          <Input
            id="amountPaid"
            type="number"
            step="any"
            className="w-32"
            {...register('amountPaid', { valueAsNumber: true })}
          />
          {errors.amountPaid && (
            <p className="text-xs text-destructive">
              {t(errors.amountPaid.message)}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="paymentMethod">{t('reports.payment.method')}</Label>
          <select
            id="paymentMethod"
            className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm"
            {...register('paymentMethod')}
          >
            <option value="cash">{t('reports.payment.methodCash')}</option>
            <option value="bank_transfer">
              {t('reports.payment.methodBankTransfer')}
            </option>
            <option value="other">{t('reports.payment.methodOther')}</option>
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="paymentDate">{t('reports.payment.date')}</Label>
          <Input id="paymentDate" type="date" {...register('paymentDate')} />
          {errors.paymentDate && (
            <p className="text-xs text-destructive">
              {t(errors.paymentDate.message)}
            </p>
          )}
        </div>

        <Button type="submit" disabled={markPayment.isPending}>
          {t('reports.payment.markButton')}
        </Button>

        {hasPayment && (
          <Button
            type="button"
            variant="outline"
            onClick={() => setConfirmOpen(true)}
          >
            {t('reports.payment.cancelButton')}
          </Button>
        )}
      </form>

      {hasPayment && <SendPaymentConfirmationControl report={report} />}

      {isOverpaid && (
        <p className="text-sm text-muted-foreground">
          {t('reports.payment.creditNotice', {
            amount: (
              Number(watchedAmountPaid) - Number(report.finalTotal)
            ).toFixed(2),
          })}
        </p>
      )}

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {t(error)}
        </p>
      )}

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        titleKey="reports.payment.cancelConfirmTitle"
        descriptionKey="reports.payment.cancelConfirmBody"
        confirmKey="reports.payment.cancelConfirmButton"
        onConfirm={handleCancel}
        isPending={cancelPayment.isPending}
      />
    </div>
  )
}
