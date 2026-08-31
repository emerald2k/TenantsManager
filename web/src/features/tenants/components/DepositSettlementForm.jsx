import { useState } from 'react'
import { useFieldArray, useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { LineAttachments } from '@/features/reports/components/LineAttachments'
import { formatCurrency } from '@/lib/formatCurrency'
import { useSettleDeposit } from '@/features/tenants/hooks'
import {
  collectSettlementAttachmentPaths,
  computeDepositSettlement,
  depositSettlementSchema,
} from '@/features/tenants/depositSettlementSchema'

/**
 * The editable deposit-settlement form (FR-CON-10, M8 stage 6): the
 * administrator's own record of restoration line items against
 * `securityDeposit`. Reuses `LineAttachments` (reports/components/) — its
 * add/remove/display logic (a per-line `useFieldArray` on
 * `${prefix}.attachments`) has no report-specific coupling, so importing it
 * directly is the same call as reusing `ConfirmDialog`/`AttachmentLink`.
 *
 * Rendered by `TenancyTab` (Bogdan's chosen flow, decided explicitly rather
 * than assumed): the "End contract" confirm dialog stays exactly as Stage 5
 * built it — no arrears block, closing balance acknowledged, done. THIS form
 * is a completely separate action, appearing on the ended tenancy, fillable
 * whenever the administrator has actually inspected the property — which
 * rarely happens in the same click as ending the contract.
 *
 * Also decided explicitly: a settlement stays editable afterward (a typo in
 * a restoration line is a correction, not a new settlement) — so this same
 * component renders BOTH the first-time form and a later correction, keyed
 * off whether `tenancy.depositSettlement` already exists. `existingSettledAt`
 * is threaded through unchanged on a correction (see `useSettleDeposit`).
 */

function itemsFromTenancy(tenancy) {
  const items = tenancy.depositSettlement?.items ?? []
  if (items.length === 0) return []
  return items.map((item) => ({
    description: item.description ?? '',
    amount: item.amount ?? 0,
    attachments: item.attachments ?? [],
  }))
}

export function DepositSettlementForm({ tenancy, userId, onDone, onCancel }) {
  const { t } = useTranslation()
  const settleDeposit = useSettleDeposit()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [pendingItems, setPendingItems] = useState(null)
  const [error, setError] = useState(false)

  const previousAttachmentPaths = collectSettlementAttachmentPaths(
    tenancy.depositSettlement,
  )
  const currentBalance = tenancy.currentBalance ?? 0

  const {
    register,
    control,
    handleSubmit,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(depositSettlementSchema),
    defaultValues: { items: itemsFromTenancy(tenancy) },
  })
  const { fields, append, remove } = useFieldArray({ control, name: 'items' })
  const watchedItems = useWatch({ control, name: 'items' })
  const { deducted, toReturn, ownerBears } = computeDepositSettlement(
    watchedItems ?? [],
    tenancy.securityDeposit,
  )

  function openConfirm(values) {
    setError(false)
    setPendingItems(values.items)
    setConfirmOpen(true)
  }

  async function handleConfirm() {
    try {
      await settleDeposit.mutateAsync({
        tenancyId: tenancy.id,
        userId,
        items: pendingItems,
        securityDeposit: tenancy.securityDeposit,
        previousAttachmentPaths,
        existingSettledAt: tenancy.depositSettlement?.settledAt ?? null,
      })
      setConfirmOpen(false)
      onDone?.()
    } catch {
      setError(true)
    }
  }

  return (
    <form
      onSubmit={handleSubmit(openConfirm)}
      className="flex flex-col gap-4 rounded-lg border border-border p-4"
    >
      <h3 className="text-sm font-semibold text-foreground">
        {t('tenants.detail.tenancy.settlement.title')}
      </h3>
      <p className="text-sm text-muted-foreground">
        {t('tenants.detail.tenancy.settlement.depositHeld', {
          value: formatCurrency(tenancy.securityDeposit ?? 0),
        })}
      </p>

      {fields.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t('tenants.detail.tenancy.settlement.empty')}
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {fields.map((field, index) => (
            <div
              key={field.id}
              className="flex flex-col gap-2 rounded-lg border border-border p-3"
            >
              <div className="grid grid-cols-[1fr_140px_auto] items-start gap-3">
                <div className="flex flex-col gap-1">
                  <Input
                    placeholder={t('reports.fields.description')}
                    {...register(`items.${index}.description`)}
                  />
                  {errors?.items?.[index]?.description && (
                    <p className="text-xs text-destructive">
                      {t(errors.items[index].description.message)}
                    </p>
                  )}
                </div>
                <Input
                  type="number"
                  step="any"
                  aria-label={t('reports.fields.amount')}
                  {...register(`items.${index}.amount`, {
                    valueAsNumber: true,
                  })}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => remove(index)}
                >
                  {t('tenants.detail.tenancy.settlement.removeItem')}
                </Button>
              </div>
              <LineAttachments
                control={control}
                prefix={`items.${index}`}
                t={t}
              />
            </div>
          ))}
        </div>
      )}

      <div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() =>
            append({ description: '', amount: 0, attachments: [] })
          }
        >
          {t('tenants.detail.tenancy.settlement.addItem')}
        </Button>
      </div>

      <div className="flex flex-col gap-1 border-t border-border pt-3 text-sm">
        <div className="flex justify-between">
          <span className="text-muted-foreground">
            {t('tenants.detail.tenancy.settlement.deducted')}
          </span>
          <span className="font-medium text-foreground">
            {formatCurrency(deducted)}
          </span>
        </div>
        {ownerBears > 0 ? (
          <div className="flex justify-between">
            <span className="text-destructive">
              {t('tenants.detail.tenancy.settlement.ownerBears')}
            </span>
            <span className="font-medium text-destructive">
              {formatCurrency(ownerBears)}
            </span>
          </div>
        ) : (
          <div className="flex justify-between">
            <span className="text-muted-foreground">
              {t('tenants.detail.tenancy.settlement.toReturn')}
            </span>
            <span className="font-medium text-foreground">
              {formatCurrency(toReturn)}
            </span>
          </div>
        )}
      </div>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {t('tenants.detail.tenancy.settlement.saveError')}
        </p>
      )}

      <div className="flex gap-2">
        <Button type="submit">
          {t('tenants.detail.tenancy.settlement.completeButton')}
        </Button>
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel}>
            {t('common.cancel')}
          </Button>
        )}
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        titleKey="tenants.detail.tenancy.settlement.confirmTitle"
        descriptionKey={
          currentBalance !== 0
            ? 'tenants.detail.tenancy.settlement.confirmBodyArrears'
            : 'tenants.detail.tenancy.settlement.confirmBody'
        }
        descriptionValues={
          currentBalance !== 0
            ? { balance: formatCurrency(Math.abs(currentBalance)) }
            : undefined
        }
        confirmKey="tenants.detail.tenancy.settlement.confirmButton"
        onConfirm={handleConfirm}
        destructive={false}
        isPending={settleDeposit.isPending}
      />
    </form>
  )
}
