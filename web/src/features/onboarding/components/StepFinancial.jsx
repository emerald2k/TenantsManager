import { useFormContext } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

function FieldError({ error, t }) {
  if (!error) return null
  return <p className="text-sm text-destructive">{t(error.message)}</p>
}

/**
 * Step 3 — financial / professional data + guarantor (FR-TEN-04, SRS §6). Same
 * shared-form pattern as Step 1 (`useFormContext`, not its own `useForm`).
 *
 * `guarantor.idDocumentPhotos` stays a placeholder text — the upload widget is
 * Sub-stage D's job; the field itself is already optional in the schema (Sub-stage
 * A), so leaving it untouched here does not block partial or full validation.
 */
export function StepFinancial() {
  const { t } = useTranslation()
  const {
    register,
    formState: { errors },
  } = useFormContext()

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="employer">{t('onboarding.fields.employer')}</Label>
        <Input id="employer" {...register('employer')} />
        <FieldError error={errors.employer} t={t} />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="occupation">{t('onboarding.fields.occupation')}</Label>
        <Input id="occupation" {...register('occupation')} />
        <FieldError error={errors.occupation} t={t} />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="employmentDuration">
          {t('onboarding.fields.employmentDuration')}
        </Label>
        <Input id="employmentDuration" {...register('employmentDuration')} />
        <FieldError error={errors.employmentDuration} t={t} />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="monthlyIncome.source">
          {t('onboarding.fields.monthlyIncomeSource')}
        </Label>
        <Input
          id="monthlyIncome.source"
          {...register('monthlyIncome.source')}
        />
        <FieldError error={errors.monthlyIncome?.source} t={t} />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="monthlyIncome.amount">
          {t('onboarding.fields.monthlyIncomeAmount')}
        </Label>
        <Input
          id="monthlyIncome.amount"
          {...register('monthlyIncome.amount')}
        />
        <FieldError error={errors.monthlyIncome?.amount} t={t} />
      </div>

      <fieldset className="flex flex-col gap-4 rounded-md border border-border p-4">
        <legend className="px-1 text-sm font-medium text-foreground">
          {t('onboarding.fields.guarantorName')}
        </legend>
        <div className="flex flex-col gap-2">
          <Label htmlFor="guarantor.name">
            {t('onboarding.fields.guarantorName')}
          </Label>
          <Input id="guarantor.name" {...register('guarantor.name')} />
          <FieldError error={errors.guarantor?.name} t={t} />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="guarantor.cnp">
            {t('onboarding.fields.guarantorCnp')}
          </Label>
          <Input id="guarantor.cnp" {...register('guarantor.cnp')} />
          <FieldError error={errors.guarantor?.cnp} t={t} />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="guarantor.phone">
            {t('onboarding.fields.guarantorPhone')}
          </Label>
          <Input id="guarantor.phone" {...register('guarantor.phone')} />
          <FieldError error={errors.guarantor?.phone} t={t} />
        </div>
        <p className="text-sm text-muted-foreground">
          {t('onboarding.wizard.guarantorPhotosPlaceholder')}
        </p>
      </fieldset>

      <fieldset className="flex flex-col gap-4 rounded-md border border-border p-4">
        <legend className="px-1 text-sm font-medium text-foreground">
          {t('onboarding.fields.previousReferenceName')}
        </legend>
        <div className="flex flex-col gap-2">
          <Label htmlFor="previousReference.name">
            {t('onboarding.fields.previousReferenceName')}
          </Label>
          <Input
            id="previousReference.name"
            {...register('previousReference.name')}
          />
          <FieldError error={errors.previousReference?.name} t={t} />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="previousReference.phone">
            {t('onboarding.fields.previousReferencePhone')}
          </Label>
          <Input
            id="previousReference.phone"
            {...register('previousReference.phone')}
          />
          <FieldError error={errors.previousReference?.phone} t={t} />
        </div>
      </fieldset>
    </div>
  )
}
