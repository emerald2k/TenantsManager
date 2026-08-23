import { useEffect, useRef, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { useForm, useFieldArray, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { RetryButton } from '@/components/shared/RetryButton'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { formatCurrency } from '@/lib/formatCurrency'
import { useTenancy } from '@/features/tenants/hooks'
import { useProperty } from '@/features/properties/hooks'
import {
  buildReportId,
  useMonthlyReport,
  useSaveReportDraft,
} from '@/features/reports/hooks'
import { collectAttachmentPaths } from '@/features/reports/attachments'
import {
  buildInitialValues,
  calculateTotal,
  isFinalTotalDiverged,
  reportFormDefaults,
  reportSchema,
} from '@/features/reports/schema'
import { CostLineRow } from '@/features/reports/components/CostLineRow'
import { OtherExpensesList } from '@/features/reports/components/OtherExpensesList'
import { SignReportControl } from '@/features/reports/components/SignReportControl'
import { PaymentSection } from '@/features/reports/components/PaymentSection'
import { SendReportNotificationControl } from '@/features/reports/components/SendReportNotificationControl'
import { ExportReportControls } from '@/features/reports/components/ExportReportControls'

/**
 * The monthly report form (SRS §5.3, `/admin/reports/:tenancyId?month=&year=`).
 * Re-keyed at M8 (FR-REP-14) from `:propertyId`: a mid-month handover puts two
 * tenancies on one property inside one calendar month, and both owe a part of
 * it, so a property alone can no longer say which report to open. A
 * property-level link resolves through `PropertyReportRedirectPage` instead.
 *
 * `tenancies/{tenancyId}` already carries everything the header and the save
 * payload need — denormalized `property`, `tenantName`, `userId`, `ownerId`
 * (SRS §6) — so this page reads exactly ONE document, not a property/tenancy
 * pair. Deliberately NOT restricted to an active tenancy: FR-REP-14 exists so
 * an ENDED tenancy (the outgoing side of a handover) can still be billed for
 * its last partial month — `useTenancy` matches any status, and "not found"
 * now means only "no such tenancy", not "no active one".
 *
 * `finalTotal` (FR-REP-04a/04b): mirrors `calculatedTotal` live until the
 * admin edits it manually — then it FREEZES (`isFinalTotalDirty`). There is
 * no rounding suggestion or "reset to exact" button (dropped from the SRS at
 * 5abb5bd) — the field simply starts at the exact total and stays editable.
 *
 * Attachments (FR-DOC-01…05): the actual Storage upload/delete happens
 * INSIDE `useSaveReportDraft`, not here — this page only supplies
 * `previousAttachmentPaths` (the snapshot the report was loaded WITH), so the
 * hook can diff it against what's left after saving to know what was removed.
 *
 * Signing/locking (M4 sub-stage 4, FR-REP-07/07a): `isLocked` is the SINGLE
 * source of truth for the read-only state, computed once below and threaded
 * to every input plus the Save/Sign/Unlock buttons — see its own comment.
 */
export function MonthlyReportPage() {
  const { t } = useTranslation()
  const { tenancyId } = useParams()
  const [searchParams] = useSearchParams()

  const now = new Date()
  const month = Number(searchParams.get('month')) || now.getMonth() + 1
  const year = Number(searchParams.get('year')) || now.getFullYear()

  const {
    data: tenancy,
    isPending: isTenancyPending,
    isError: isTenancyError,
    refetch: refetchTenancy,
  } = useTenancy(tenancyId)
  // Chained off the tenancy: `tenancies.property` only denormalizes
  // {name, address} (SRS §6), not `services` — a NEW report's cost lines need
  // the property's full service list (FR-REP-03), so this read stays.
  const {
    data: property,
    isPending: isPropertyPending,
    isError: isPropertyError,
    refetch: refetchProperty,
  } = useProperty(tenancy?.propertyId)
  const { data: existingReport, isPending: isReportPending } = useMonthlyReport(
    { tenancyId, month, year },
  )
  const saveDraft = useSaveReportDraft()
  const [saveError, setSaveError] = useState(null)
  // FR-REP-07: once signed, the report is READ-ONLY — every input disabled,
  // Save hidden, Sign replaced by Unlock. Computed ONCE here; every consumer
  // below (CostLineRow, OtherExpensesList, the dueDate/finalTotal inputs, the
  // Save button, handleValid's guard) reads this SAME boolean — no
  // re-derivation, no drift.
  const isLocked = existingReport?.status === 'signed'
  // FR-REP-04a/04b: mirrors calculatedTotal while false; frozen once true —
  // either the admin just typed into finalTotal, or a reopened report was
  // already manually diverged when it was last saved (isFinalTotalDiverged).
  const [isFinalTotalDirty, setIsFinalTotalDirty] = useState(false)
  // Guards against a real race: `reset()` writes RHF's internal state, but
  // `useWatch` (and therefore `total`, below) only catches up on the NEXT
  // render — it does not update synchronously within the same commit. If the
  // mirror effect ran in that SAME commit, it would read the stale pre-reset
  // `total` (and the stale pre-reset `isFinalTotalDirty`) and overwrite the
  // value `reset()` just set — e.g. clobbering a reopened, frozen finalTotal
  // with 0. This ref makes the mirror effect skip exactly once right after a
  // reset, waiting for the following render where both have caught up.
  const skipNextMirrorRef = useRef(false)

  const {
    register,
    control,
    handleSubmit,
    reset,
    setValue,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(reportSchema),
    defaultValues: reportFormDefaults,
  })

  const { fields: serviceFields } = useFieldArray({
    control,
    name: 'serviceCosts',
  })
  const {
    fields: otherExpenseFields,
    append: appendOtherExpense,
    remove: removeOtherExpense,
  } = useFieldArray({ control, name: 'otherExpenses' })

  // `isPropertyPending` only counts once a tenancy has actually resolved:
  // `useProperty` stays disabled (and therefore permanently "pending") while
  // `tenancy` is null, which would otherwise mask a genuinely missing
  // tenancy behind an infinite spinner instead of falling through to the
  // not-found state below.
  const isPending =
    isTenancyPending ||
    (Boolean(tenancy) && isPropertyPending) ||
    isReportPending

  // Rebuilds the form once property/tenancy/existingReport have loaded (or
  // when the admin navigates to a different month via the URL). Piggybacks
  // the finalTotal dirty-flag reset on the SAME trigger: a fresh report (or
  // one that was still mirroring when last saved) starts NOT dirty, so it
  // resumes mirroring; only a genuinely diverged reopened report freezes.
  useEffect(() => {
    if (isPending || !property) return
    skipNextMirrorRef.current = true
    reset(
      buildInitialValues({ tenancy, property, month, year, existingReport }),
    )
    setIsFinalTotalDirty(isFinalTotalDiverged(existingReport))
  }, [isPending, property, tenancy, existingReport, month, year, reset])

  const watchedValues = useWatch({ control })
  const total = calculateTotal(watchedValues)

  // Mirrors the live total into finalTotal while untouched. `setValue` does
  // NOT fire the `onChange` registered below (RHF doesn't simulate a DOM
  // event for it), so this can't itself flip `isFinalTotalDirty` — no loop.
  // `finalTotal` is deliberately NOT in the deps: this effect exists to WRITE
  // it, watching it too would just re-run on its own write.
  useEffect(() => {
    if (skipNextMirrorRef.current) {
      skipNextMirrorRef.current = false
      return
    }
    if (!isFinalTotalDirty) {
      setValue('finalTotal', total, { shouldValidate: false })
    }
  }, [total, isFinalTotalDirty, setValue])

  async function handleValid(values) {
    // Belt-and-suspenders (Save is already hidden + every input disabled
    // when locked): stops a stray submit from ever reaching the mutation.
    // The mutation itself is the real defense against clobbering a signed
    // report (useSaveReportDraft's re-save path never writes status/signedAt
    // at all) — this guard just avoids the pointless network round-trip.
    if (isLocked) return
    setSaveError(null)
    const id = buildReportId(tenancyId, year, month)
    // Recomputed fresh here (not read off `values.finalTotal`) so that, while
    // mirroring, finalTotal and calculatedTotal are written from the EXACT
    // same calculateTotal() call — no float drift between them that a future
    // reopen could misread as "manually diverged" (isFinalTotalDiverged).
    const calculatedTotal = calculateTotal(values)
    const finalTotal = isFinalTotalDirty ? values.finalTotal : calculatedTotal
    try {
      await saveDraft.mutateAsync({
        id,
        values: {
          ownerId: property.ownerId,
          propertyId: tenancy.propertyId,
          tenancyId: tenancy.id,
          userId: tenancy.userId,
          month,
          year,
          ...values,
          calculatedTotal,
          finalTotal,
        },
        previousAttachmentPaths: collectAttachmentPaths(existingReport),
        isNew: !existingReport,
      })
    } catch {
      // Same pattern as PropertyForm: keep the form open with the entered
      // values, so the admin does not lose what they typed.
      setSaveError('reports.errors.saveError')
    }
  }

  if (isPending) {
    return (
      <p className="p-6 text-sm text-muted-foreground">{t('common.loading')}</p>
    )
  }

  if (isTenancyError || !tenancy) {
    return (
      <div className="flex flex-col items-start gap-2 p-6">
        <p className="text-sm text-muted-foreground">{t('reports.notFound')}</p>
        <RetryButton onRetry={refetchTenancy} />
      </div>
    )
  }

  if (isPropertyError || !property) {
    return (
      <div className="flex flex-col items-start gap-2 p-6">
        <p className="text-sm text-muted-foreground">{t('reports.notFound')}</p>
        <RetryButton onRetry={refetchProperty} />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">
          {property.name}
        </h1>
        <p className="text-sm text-muted-foreground">
          {tenancy.tenantName} · {month}/{year}
        </p>
      </div>

      <form
        onSubmit={handleSubmit(handleValid)}
        noValidate
        className="flex flex-col gap-4"
      >
        <div className="rounded-lg border border-border p-4">
          <CostLineRow
            label={t('reports.sections.rent')}
            prefix="rent"
            register={register}
            control={control}
            error={errors.rent?.amount}
            t={t}
            disabled={isLocked}
          />
          <CostLineRow
            label={t('reports.sections.maintenance')}
            prefix="maintenance"
            register={register}
            control={control}
            error={errors.maintenance?.amount}
            t={t}
            disabled={isLocked}
          />
          {serviceFields.map((field, index) => (
            <CostLineRow
              key={field.id}
              label={field.name}
              prefix={`serviceCosts.${index}`}
              register={register}
              control={control}
              error={errors.serviceCosts?.[index]?.amount}
              t={t}
              disabled={isLocked}
            />
          ))}
        </div>

        <OtherExpensesList
          fields={otherExpenseFields}
          register={register}
          control={control}
          errors={errors.otherExpenses}
          onAdd={() =>
            appendOtherExpense({
              description: '',
              amount: 0,
              notes: '',
              attachments: [],
            })
          }
          onRemove={removeOtherExpense}
          t={t}
          disabled={isLocked}
        />

        <div className="flex flex-col gap-3 rounded-lg border border-border p-4">
          <div className="flex items-center justify-between gap-4">
            <Label>{t('reports.fields.previousArrears')}</Label>
            <Input
              type="number"
              readOnly
              className="w-32 text-right"
              {...register('previousMonthArrears', { valueAsNumber: true })}
            />
          </div>
          <div className="flex items-center justify-between gap-4">
            <Label>{t('reports.fields.previousCredit')}</Label>
            <Input
              type="number"
              readOnly
              className="w-32 text-right"
              {...register('previousMonthCredit', { valueAsNumber: true })}
            />
          </div>
          <div className="flex items-center justify-between gap-4">
            <Label htmlFor="dueDate">{t('reports.fields.dueDate')}</Label>
            <Input
              id="dueDate"
              type="date"
              className="w-40"
              disabled={isLocked}
              {...register('dueDate')}
            />
            {errors.dueDate && (
              <p className="text-xs text-destructive">
                {t(errors.dueDate.message)}
              </p>
            )}
          </div>
        </div>

        <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-4 rounded-lg border border-border bg-background p-4 shadow-sm">
          <div className="flex flex-col">
            <span className="text-xs text-muted-foreground">
              {t('reports.fields.calculatedTotal')}
            </span>
            <span className="text-base font-medium text-foreground">
              {formatCurrency(total)}
            </span>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="finalTotal">{t('reports.fields.finalTotal')}</Label>
            <Input
              id="finalTotal"
              type="number"
              step="any"
              className="w-32 text-right text-lg font-semibold"
              disabled={isLocked}
              {...register('finalTotal', {
                valueAsNumber: true,
                onChange: () => setIsFinalTotalDirty(true),
              })}
            />
          </div>
        </div>

        {saveError && (
          <p
            role="alert"
            className="rounded-md bg-destructive/10 p-3 text-sm text-destructive"
          >
            {t(saveError)}
          </p>
        )}

        <div className="flex items-center gap-3">
          {!isLocked && (
            <Button type="submit" disabled={saveDraft.isPending}>
              {saveDraft.isPending ? t('common.loading') : t('reports.save')}
            </Button>
          )}
          {existingReport && <SignReportControl report={existingReport} />}
          {isLocked && (
            <SendReportNotificationControl report={existingReport} />
          )}
          {isLocked && (
            <ExportReportControls report={existingReport} property={property} />
          )}
        </div>
      </form>

      {isLocked && <PaymentSection report={existingReport} />}
    </div>
  )
}
