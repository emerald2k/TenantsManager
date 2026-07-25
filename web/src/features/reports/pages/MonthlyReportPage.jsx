import { useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { useForm, useFieldArray, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { formatCurrency } from '@/lib/formatCurrency'
import {
  useActiveTenancyForProperty,
  useProperty,
} from '@/features/properties/hooks'
import { useMonthlyReport, useSaveReportDraft } from '@/features/reports/hooks'
import {
  buildInitialValues,
  calculateTotal,
  reportFormDefaults,
  reportSchema,
} from '@/features/reports/schema'
import { CostLineRow } from '@/features/reports/components/CostLineRow'
import { OtherExpensesList } from '@/features/reports/components/OtherExpensesList'

/**
 * The monthly report form (SRS §5.3, `/admin/reports/:propertyId?month=&year=`).
 * Sub-stage 1 of M4 — DRAFT only: no finalTotal/rounding (2), no attachments
 * (3), no signing/lock (4). The "Current month" list page (§5.1) still links
 * nowhere here yet (sub-stage 7) — this route is reached directly by URL.
 *
 * Requires an ACTIVE tenancy on the property: a report always needs a
 * tenancyId/userId to save (SRS §6). A free property (or one whose tenancy has
 * since ended) shows an empty state instead of a blank form — building
 * support for editing an already-created draft after its tenancy ended is
 * left for a later sub-stage, since nothing can reach that state yet (no
 * signed reports exist to leave behind once endTenancy runs).
 */
export function MonthlyReportPage() {
  const { t } = useTranslation()
  const { propertyId } = useParams()
  const [searchParams] = useSearchParams()

  const now = new Date()
  const month = Number(searchParams.get('month')) || now.getMonth() + 1
  const year = Number(searchParams.get('year')) || now.getFullYear()

  const {
    data: property,
    isPending: isPropertyPending,
    isError: isPropertyError,
  } = useProperty(propertyId)
  const { data: tenancy, isPending: isTenancyPending } =
    useActiveTenancyForProperty(propertyId)
  const { data: existingReport, isPending: isReportPending } = useMonthlyReport(
    { propertyId, month, year },
  )
  const saveDraft = useSaveReportDraft()
  const [saveError, setSaveError] = useState(null)

  const {
    register,
    control,
    handleSubmit,
    reset,
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

  const isPending = isPropertyPending || isTenancyPending || isReportPending

  // Rebuilds the form once property/tenancy/existingReport have loaded (or
  // when the admin navigates to a different month via the URL).
  useEffect(() => {
    if (isPending || !property) return
    reset(
      buildInitialValues({ tenancy, property, month, year, existingReport }),
    )
  }, [isPending, property, tenancy, existingReport, month, year, reset])

  const watchedValues = useWatch({ control })
  const total = calculateTotal(watchedValues)

  async function handleValid(values) {
    setSaveError(null)
    const id = `${propertyId}_${year}-${String(month).padStart(2, '0')}`
    try {
      await saveDraft.mutateAsync({
        id,
        values: {
          ownerId: property.ownerId,
          propertyId,
          tenancyId: tenancy.id,
          userId: tenancy.userId,
          month,
          year,
          ...values,
          calculatedTotal: calculateTotal(values),
        },
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

  if (isPropertyError || !property) {
    return (
      <p className="p-6 text-sm text-muted-foreground">
        {t('reports.notFound')}
      </p>
    )
  }

  if (!tenancy) {
    return (
      <p className="p-6 text-sm text-muted-foreground">
        {t('reports.noActiveTenancy')}
      </p>
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
            error={errors.rent?.amount}
            t={t}
          />
          <CostLineRow
            label={t('reports.sections.maintenance')}
            prefix="maintenance"
            register={register}
            error={errors.maintenance?.amount}
            t={t}
          />
          {serviceFields.map((field, index) => (
            <CostLineRow
              key={field.id}
              label={field.name}
              prefix={`serviceCosts.${index}`}
              register={register}
              error={errors.serviceCosts?.[index]?.amount}
              t={t}
            />
          ))}
        </div>

        <OtherExpensesList
          fields={otherExpenseFields}
          register={register}
          errors={errors.otherExpenses}
          onAdd={() =>
            appendOtherExpense({ description: '', amount: 0, notes: '' })
          }
          onRemove={removeOtherExpense}
          t={t}
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
              {...register('dueDate')}
            />
            {errors.dueDate && (
              <p className="text-xs text-destructive">
                {t(errors.dueDate.message)}
              </p>
            )}
          </div>
        </div>

        <div className="sticky bottom-0 flex items-center justify-between rounded-lg border border-border bg-background p-4 shadow-sm">
          <span className="text-sm font-medium text-foreground">
            {t('reports.fields.calculatedTotal')}
          </span>
          <span className="text-lg font-semibold text-foreground">
            {formatCurrency(total)}
          </span>
        </div>

        {saveError && (
          <p
            role="alert"
            className="rounded-md bg-destructive/10 p-3 text-sm text-destructive"
          >
            {t(saveError)}
          </p>
        )}

        <div>
          <Button type="submit" disabled={saveDraft.isPending}>
            {saveDraft.isPending ? t('common.loading') : t('reports.save')}
          </Button>
        </div>
      </form>
    </div>
  )
}
