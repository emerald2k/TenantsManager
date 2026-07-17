import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  propertyFormDefaults,
  propertySchema,
} from '@/features/properties/schema'
import { useCreateProperty } from '@/features/properties/hooks'

/**
 * Property creation (FR-PROP-01, SRS §5.3).
 *
 * ONLY the property's own fields. The services are NOT here: they are added from
 * the property page, on an existing property (FR-PROP-02) — a service needs a
 * document to attach to, and that document does not exist until this form submits.
 *
 * The validation comes from the schema in `../schema` (presence-only, NFR-VAL-01).
 * The schema hands back i18n KEYS as error messages; the translation happens here,
 * at display time, so the errors follow the active language.
 */

/** The address is a nested object in the schema, so RHF nests the errors too. The
 * optional chaining is load-bearing: `errors.address` is undefined whenever the
 * address is valid, and indexing into it would throw. */
function addressError(errors, field) {
  return errors.address?.[field]?.message
}

export function CreatePropertyPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const createProperty = useCreateProperty()
  const [submitError, setSubmitError] = useState(null)

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(propertySchema),
    defaultValues: propertyFormDefaults,
  })

  async function onSubmit(values) {
    setSubmitError(null)
    try {
      // `mutateAsync` (not `mutate`): we need the new id to redirect, and the
      // mutation resolves with exactly that (the hook returns `ref.id`).
      const id = await createProperty.mutateAsync(values)
      navigate(`/admin/properties/${id}`)
    } catch {
      // The write can fail (rules, network). Without this the form would look
      // like it did nothing — the user would submit again and risk a duplicate.
      setSubmitError('properties.new.error')
    }
  }

  return (
    <div className="p-6">
      <form
        onSubmit={handleSubmit(onSubmit)}
        noValidate
        className="max-w-xl rounded-lg border border-border p-6 shadow-sm"
      >
        <h1 className="mb-6 text-xl font-semibold text-foreground">
          {t('properties.new.title')}
        </h1>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="name">{t('properties.fields.name')}</Label>
            <Input id="name" {...register('name')} />
            {errors.name && (
              <p className="text-sm text-destructive">
                {t(errors.name.message)}
              </p>
            )}
          </div>

          <fieldset className="flex flex-col gap-4 rounded-md border border-border p-4">
            <legend className="px-1 text-sm font-medium text-foreground">
              {t('properties.fields.address')}
            </legend>

            <div className="flex flex-col gap-2">
              <Label htmlFor="street">{t('properties.fields.street')}</Label>
              <Input id="street" {...register('address.street')} />
              {addressError(errors, 'street') && (
                <p className="text-sm text-destructive">
                  {t(addressError(errors, 'street'))}
                </p>
              )}
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="number">{t('properties.fields.number')}</Label>
              <Input id="number" {...register('address.number')} />
              {addressError(errors, 'number') && (
                <p className="text-sm text-destructive">
                  {t(addressError(errors, 'number'))}
                </p>
              )}
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="city">{t('properties.fields.city')}</Label>
              <Input id="city" {...register('address.city')} />
              {addressError(errors, 'city') && (
                <p className="text-sm text-destructive">
                  {t(addressError(errors, 'city'))}
                </p>
              )}
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="county">{t('properties.fields.county')}</Label>
              <Input id="county" {...register('address.county')} />
              {addressError(errors, 'county') && (
                <p className="text-sm text-destructive">
                  {t(addressError(errors, 'county'))}
                </p>
              )}
            </div>

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

          <Button type="submit" disabled={createProperty.isPending}>
            {createProperty.isPending
              ? t('common.loading')
              : t('properties.new.submit')}
          </Button>
        </div>
      </form>
    </div>
  )
}
