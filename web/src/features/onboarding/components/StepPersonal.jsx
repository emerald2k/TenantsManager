import { useState } from 'react'
import { useFormContext } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import {
  useCheckDuplicateCnp,
  useCheckExistingEmail,
} from '@/features/onboarding/hooks'

const SELECT_CLASS =
  'h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50'

/** A boolean select bound as `undefined` until chosen (FR-TEN-02): the empty first
 * option is the real, distinct "not chosen yet" state — never a default `false`. */
function yesNoAs(value) {
  return value === '' ? undefined : value === 'true'
}

function FieldError({ error, t }) {
  if (!error) return null
  return <p className="text-sm text-destructive">{t(error.message)}</p>
}

/**
 * Step 1 — personal data (FR-TEN-02, SRS §6). Reads the shared wizard form via
 * `useFormContext` — the fields live in the SAME RHF instance as the other steps,
 * not a form of their own, so nothing is lost switching steps before autosave fires.
 *
 * Two live checks fire on blur, deliberately different in kind:
 *  - email → existing account (FR-TEN-07): a VALID flow, confirmed via dialog, sets
 *    `existingUserId` on the draft and stops there (Sub-stage E finishes it).
 *  - cnp → duplicate person (FR-TEN-22): a CONFLICT, not a choice — an inline
 *    blocking warning, no dialog, Continue disabled via `onCnpConflictChange`. The
 *    server-side check in finalizeKyc (Sub-stage B) remains the final authority;
 *    this is early-warning UX only.
 */
export function StepPersonal({ onCnpConflictChange }) {
  const { t } = useTranslation()
  const {
    register,
    watch,
    setValue,
    formState: { errors },
  } = useFormContext()
  const checkEmail = useCheckExistingEmail()
  const checkCnp = useCheckDuplicateCnp()

  const [candidate, setCandidate] = useState(null)
  const [linkedName, setLinkedName] = useState(null)
  const [cnpConflict, setCnpConflict] = useState(null)

  const existingUserId = watch('existingUserId')
  const petsHas = watch('pets.has')
  const vehicleHas = watch('vehicle.has')

  async function handleEmailBlur(event) {
    const email = event.target.value.trim()
    if (!email || existingUserId) return
    const match = await checkEmail.mutateAsync(email)
    if (match) setCandidate(match)
  }

  function confirmExistingTenant() {
    setValue('existingUserId', candidate.id)
    setLinkedName(candidate.name)
    setCandidate(null)
  }

  async function handleCnpBlur(event) {
    const cnp = event.target.value.trim()
    if (!cnp) {
      setCnpConflict(null)
      onCnpConflictChange(false)
      return
    }
    const match = await checkCnp.mutateAsync(cnp)
    setCnpConflict(match)
    onCnpConflictChange(Boolean(match))
  }

  function handleCnpChange() {
    if (cnpConflict) {
      setCnpConflict(null)
      onCnpConflictChange(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="name">{t('onboarding.fields.name')}</Label>
        <Input id="name" {...register('name')} />
        <FieldError error={errors.name} t={t} />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="dateOfBirth">
          {t('onboarding.fields.dateOfBirth')}
        </Label>
        <Input id="dateOfBirth" {...register('dateOfBirth')} />
        <FieldError error={errors.dateOfBirth} t={t} />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="cnp">{t('onboarding.fields.cnp')}</Label>
        <Input
          id="cnp"
          {...register('cnp', {
            onBlur: handleCnpBlur,
            onChange: handleCnpChange,
          })}
        />
        <FieldError error={errors.cnp} t={t} />
        {cnpConflict && (
          <p role="alert" className="text-sm text-destructive">
            {t('onboarding.wizard.cnpConflict', { name: cnpConflict.name })}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="phone">{t('onboarding.fields.phone')}</Label>
        <Input id="phone" {...register('phone')} />
        <FieldError error={errors.phone} t={t} />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="email">{t('onboarding.fields.email')}</Label>
        <Input id="email" {...register('email', { onBlur: handleEmailBlur })} />
        <FieldError error={errors.email} t={t} />
        {existingUserId && (
          <p className="text-sm text-muted-foreground">
            {t('onboarding.wizard.existingTenantLinked', { name: linkedName })}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="preferredLanguage">
          {t('onboarding.fields.preferredLanguage')}
        </Label>
        <select
          id="preferredLanguage"
          className={SELECT_CLASS}
          {...register('preferredLanguage')}
        >
          <option value="">—</option>
          <option value="ro">{t('onboarding.languages.ro')}</option>
          <option value="en">{t('onboarding.languages.en')}</option>
        </select>
        <FieldError error={errors.preferredLanguage} t={t} />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="mailingAddress">
          {t('onboarding.fields.mailingAddress')}
          <span className="ml-1 font-normal text-muted-foreground">
            {t('onboarding.optional')}
          </span>
        </Label>
        <Input id="mailingAddress" {...register('mailingAddress')} />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="previousAddress">
          {t('onboarding.fields.previousAddress')}
        </Label>
        <Input id="previousAddress" {...register('previousAddress')} />
        <FieldError error={errors.previousAddress} t={t} />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="emergencyContact.name">
          {t('onboarding.fields.emergencyContactName')}
        </Label>
        <Input
          id="emergencyContact.name"
          {...register('emergencyContact.name')}
        />
        <FieldError error={errors.emergencyContact?.name} t={t} />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="emergencyContact.phone">
          {t('onboarding.fields.emergencyContactPhone')}
        </Label>
        <Input
          id="emergencyContact.phone"
          {...register('emergencyContact.phone')}
        />
        <FieldError error={errors.emergencyContact?.phone} t={t} />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="occupantCount">
          {t('onboarding.fields.occupantCount')}
        </Label>
        <Input id="occupantCount" {...register('occupantCount')} />
        <FieldError error={errors.occupantCount} t={t} />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="smoker">{t('onboarding.fields.smoker')}</Label>
        <select
          id="smoker"
          className={SELECT_CLASS}
          {...register('smoker', { setValueAs: yesNoAs })}
        >
          <option value="">—</option>
          <option value="true">{t('onboarding.options.yes')}</option>
          <option value="false">{t('onboarding.options.no')}</option>
        </select>
        <FieldError error={errors.smoker} t={t} />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="pets.has">{t('onboarding.fields.petsHas')}</Label>
        <select
          id="pets.has"
          className={SELECT_CLASS}
          {...register('pets.has', { setValueAs: yesNoAs })}
        >
          <option value="">—</option>
          <option value="true">{t('onboarding.options.yes')}</option>
          <option value="false">{t('onboarding.options.no')}</option>
        </select>
        <FieldError error={errors.pets?.has} t={t} />
      </div>

      {petsHas === true && (
        <div className="flex flex-col gap-2">
          <Label htmlFor="pets.type">{t('onboarding.fields.petsType')}</Label>
          <Input id="pets.type" {...register('pets.type')} />
          <FieldError error={errors.pets?.type} t={t} />
        </div>
      )}

      <div className="flex flex-col gap-2">
        <Label htmlFor="vehicle.has">{t('onboarding.fields.vehicleHas')}</Label>
        <select
          id="vehicle.has"
          className={SELECT_CLASS}
          {...register('vehicle.has', { setValueAs: yesNoAs })}
        >
          <option value="">—</option>
          <option value="true">{t('onboarding.options.yes')}</option>
          <option value="false">{t('onboarding.options.no')}</option>
        </select>
        <FieldError error={errors.vehicle?.has} t={t} />
      </div>

      {vehicleHas === true && (
        <>
          <div className="flex flex-col gap-2">
            <Label htmlFor="vehicle.make">
              {t('onboarding.fields.vehicleMake')}
            </Label>
            <Input id="vehicle.make" {...register('vehicle.make')} />
            <FieldError error={errors.vehicle?.make} t={t} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="vehicle.plateNumber">
              {t('onboarding.fields.vehiclePlateNumber')}
            </Label>
            <Input
              id="vehicle.plateNumber"
              {...register('vehicle.plateNumber')}
            />
            <FieldError error={errors.vehicle?.plateNumber} t={t} />
          </div>
        </>
      )}

      <ConfirmDialog
        open={Boolean(candidate)}
        onOpenChange={(open) => !open && setCandidate(null)}
        titleKey="onboarding.wizard.existingTenantTitle"
        descriptionKey="onboarding.wizard.existingTenantDescription"
        descriptionValues={{ name: candidate?.name }}
        confirmKey="onboarding.wizard.existingTenantConfirm"
        onConfirm={confirmExistingTenant}
        destructive={false}
      />
    </div>
  )
}
