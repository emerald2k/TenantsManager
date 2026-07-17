import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  propertyFormDefaults,
  propertySchema,
} from '@/features/properties/schema'

/**
 * The property form, shared by creation (FR-PROP-01) and editing (FR-PROP-04).
 *
 * Extracted from `CreatePropertyPage` at sub-stage D: the edit section needs the
 * SAME fields and the SAME schema. Duplicating the markup would mean every future
 * field has to be added twice — and would drift the moment someone forgets.
 *
 * It owns the RHF wiring and the submit error, NOT the mutation: the caller passes
 * `onSubmit` and decides what the save means (addDoc vs updateDoc). That keeps the
 * form unaware of Firestore.
 *
 * The validation comes from the schema in `../schema` (presence-only, NFR-VAL-01).
 * The schema hands back i18n KEYS as error messages; the translation happens here,
 * at display time, so the errors follow the active language.
 *
 * @param defaultValues  the initial values (empty on create, the property on edit)
 * @param onSubmit       async; throwing surfaces `errorKey` as an alert
 * @param submitLabelKey the label of the submit button
 * @param errorKey       the i18n key shown when `onSubmit` throws
 * @param isPending      disables submit while the mutation runs
 * @param onCancel       renders a Cancel button when provided (edit only)
 */

/** The address is a nested object in the schema, so RHF nests the errors too. The
 * optional chaining is load-bearing: `errors.address` is undefined whenever the
 * address is valid, and indexing into it would throw. */
function addressError(errors, field) {
  return errors.address?.[field]?.message
}

const ADDRESS_FIELDS = ['street', 'number', 'city', 'county']

export function PropertyForm({
  defaultValues = propertyFormDefaults,
  onSubmit,
  submitLabelKey,
  errorKey,
  isPending = false,
  onCancel,
}) {
  const { t } = useTranslation()
  const [submitError, setSubmitError] = useState(null)

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(propertySchema),
    defaultValues,
  })

  async function handleValid(values) {
    setSubmitError(null)
    try {
      await onSubmit(values)
    } catch {
      // The write can fail (rules, network). Without this the form would look
      // like it did nothing — the user would submit again and risk a duplicate.
      setSubmitError(errorKey)
    }
  }

  return (
    <form
      onSubmit={handleSubmit(handleValid)}
      noValidate
      className="flex flex-col gap-4"
    >
      <div className="flex flex-col gap-2">
        <Label htmlFor="name">{t('properties.fields.name')}</Label>
        <Input id="name" {...register('name')} />
        {errors.name && (
          <p className="text-sm text-destructive">{t(errors.name.message)}</p>
        )}
      </div>

      <fieldset className="flex flex-col gap-4 rounded-md border border-border p-4">
        <legend className="px-1 text-sm font-medium text-foreground">
          {t('properties.fields.address')}
        </legend>

        {ADDRESS_FIELDS.map((field) => (
          <div key={field} className="flex flex-col gap-2">
            <Label htmlFor={field}>{t(`properties.fields.${field}`)}</Label>
            <Input id={field} {...register(`address.${field}`)} />
            {addressError(errors, field) && (
              <p className="text-sm text-destructive">
                {t(addressError(errors, field))}
              </p>
            )}
          </div>
        ))}

        <div className="flex flex-col gap-2">
          <Label htmlFor="postalCode">
            {t('properties.fields.postalCode')}
            <span className="ml-1 font-normal text-muted-foreground">
              {t('properties.new.optional')}
            </span>
          </Label>
          <Input id="postalCode" {...register('address.postalCode')} />
        </div>
      </fieldset>

      <div className="flex flex-col gap-2">
        <Label htmlFor="area">
          {t('properties.fields.area')}
          <span className="ml-1 font-normal text-muted-foreground">
            {t('properties.new.optional')}
          </span>
        </Label>
        <Input id="area" {...register('area')} />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="roomCount">
          {t('properties.fields.roomCount')}
          <span className="ml-1 font-normal text-muted-foreground">
            {t('properties.new.optional')}
          </span>
        </Label>
        <Input id="roomCount" {...register('roomCount')} />
      </div>

      {submitError && (
        <p
          role="alert"
          className="rounded-md bg-destructive/10 p-3 text-sm text-destructive"
        >
          {t(submitError)}
        </p>
      )}

      <div className="flex gap-2">
        <Button type="submit" disabled={isPending}>
          {isPending ? t('common.loading') : t(submitLabelKey)}
        </Button>
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel}>
            {t('common.cancel')}
          </Button>
        )}
      </div>
    </form>
  )
}
