import { useState } from 'react'
import { FormProvider, useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { PhotoGallery } from '@/features/tenants/components/PhotoGallery'
import { useUpdateUser } from '@/features/tenants/hooks'
import {
  financialSectionSchema,
  guarantorSectionSchema,
  languageSectionSchema,
  personalSectionSchema,
  previousReferenceSectionSchema,
} from '@/features/tenants/profileSchema'

/**
 * The tenant detail page's Profile tab (M3-B, FR-TEN-09/11, SRS §5.3): KYC data
 * by section, each independently editable in place, plus the ID-photo galleries.
 *
 * Section ORDER mirrors the wizard, per the sub-stage spec: personal data, ID
 * photos, financial/professional, guarantor, previous reference, preferred
 * language (language last — its own line item in SRS §5.3, not folded into
 * "personal").
 */

const SELECT_CLASS =
  'h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50'

function yesNoAs(value) {
  return value === '' ? undefined : value === 'true'
}

function yesNoLabel(value, t) {
  if (value === true) return t('onboarding.options.yes')
  if (value === false) return t('onboarding.options.no')
  return '—'
}

function FieldError({ error, t }) {
  if (!error) return null
  return <p className="text-sm text-destructive">{t(error.message)}</p>
}

function Section({ title, action, children }) {
  return (
    <section className="rounded-lg border border-border p-6 shadow-sm">
      <div className="mb-4 flex items-center justify-between gap-4">
        <h2 className="text-base font-semibold text-foreground">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  )
}

function Field({ label, value }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm text-foreground">{value || '—'}</span>
    </div>
  )
}

/**
 * The Edit/Save/Cancel chrome shared by every text section: RHF + the section's
 * Zod schema, validated manually (same pattern as `OnboardingWizardPage`'s
 * `validateStep` — `schema.safeParse` + `setError` per issue, not RHF's
 * `resolver` option, to stay consistent with the rest of the codebase).
 *
 * `onSave(values)` receives the PARSED, valid data and decides the Firestore
 * write shape — most sections write it as-is, but the guarantor section
 * transforms it into dot-path keys (see `GuarantorSection` below) so its save
 * never touches `guarantor.idDocumentPhotos`, owned by a separate gallery.
 *
 * Cancel discards in-progress edits by simply dropping edit mode — the form is
 * reset from `defaultValues` again on the next Edit click, nothing is persisted
 * until Save succeeds.
 */
function EditableSection({
  titleKey,
  schema,
  defaultValues,
  onSave,
  renderView,
  renderFields,
}) {
  const { t } = useTranslation()
  const [isEditing, setIsEditing] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const methods = useForm({ defaultValues })
  const {
    register,
    watch,
    getValues,
    setError,
    clearErrors,
    reset,
    formState: { errors },
  } = methods

  function startEdit() {
    reset(defaultValues)
    setIsEditing(true)
  }

  async function handleSave() {
    clearErrors()
    const result = schema.safeParse(getValues())
    if (!result.success) {
      for (const issue of result.error.issues) {
        setError(issue.path.join('.'), {
          type: 'manual',
          message: issue.message,
        })
      }
      return
    }
    setIsSaving(true)
    try {
      await onSave(result.data)
      setIsEditing(false)
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Section
      title={t(titleKey)}
      action={
        !isEditing && (
          <Button type="button" variant="outline" onClick={startEdit}>
            {t('tenants.detail.edit')}
          </Button>
        )
      }
    >
      {isEditing ? (
        <FormProvider {...methods}>
          <div className="flex flex-col gap-4">
            {renderFields({ register, errors, watch, t })}
            <div className="flex gap-2">
              <Button type="button" onClick={handleSave} disabled={isSaving}>
                {isSaving ? t('common.loading') : t('tenants.detail.save')}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsEditing(false)}
              >
                {t('common.cancel')}
              </Button>
            </div>
          </div>
        </FormProvider>
      ) : (
        renderView()
      )}
    </Section>
  )
}

function PersonalSection({ user, userId }) {
  const { t } = useTranslation()
  const updateUser = useUpdateUser()

  const defaultValues = {
    name: user.name ?? '',
    dateOfBirth: user.dateOfBirth ?? '',
    cnp: user.cnp ?? '',
    phone: user.phone ?? '',
    email: user.email ?? '',
    mailingAddress: user.mailingAddress ?? '',
    previousAddress: user.previousAddress ?? '',
    emergencyContact: {
      name: user.emergencyContact?.name ?? '',
      phone: user.emergencyContact?.phone ?? '',
    },
    occupantCount: user.occupantCount ?? '',
    smoker: user.smoker,
    pets: { has: user.pets?.has, type: user.pets?.type ?? '' },
    vehicle: {
      has: user.vehicle?.has,
      make: user.vehicle?.make ?? '',
      plateNumber: user.vehicle?.plateNumber ?? '',
    },
  }

  return (
    <EditableSection
      titleKey="tenants.detail.sections.personal"
      schema={personalSectionSchema}
      defaultValues={defaultValues}
      onSave={(values) => updateUser.mutateAsync({ id: userId, values })}
      renderView={() => (
        <div className="grid grid-cols-2 gap-4">
          <Field label={t('onboarding.fields.name')} value={user.name} />
          <Field
            label={t('onboarding.fields.dateOfBirth')}
            value={user.dateOfBirth}
          />
          <Field label={t('onboarding.fields.cnp')} value={user.cnp} />
          <Field label={t('onboarding.fields.phone')} value={user.phone} />
          <Field label={t('onboarding.fields.email')} value={user.email} />
          <Field
            label={t('onboarding.fields.mailingAddress')}
            value={user.mailingAddress}
          />
          <Field
            label={t('onboarding.fields.previousAddress')}
            value={user.previousAddress}
          />
          <Field
            label={t('onboarding.fields.emergencyContactName')}
            value={user.emergencyContact?.name}
          />
          <Field
            label={t('onboarding.fields.emergencyContactPhone')}
            value={user.emergencyContact?.phone}
          />
          <Field
            label={t('onboarding.fields.occupantCount')}
            value={user.occupantCount}
          />
          <Field
            label={t('onboarding.fields.smoker')}
            value={yesNoLabel(user.smoker, t)}
          />
          <Field
            label={t('onboarding.fields.petsHas')}
            value={yesNoLabel(user.pets?.has, t)}
          />
          {user.pets?.has && (
            <Field
              label={t('onboarding.fields.petsType')}
              value={user.pets?.type}
            />
          )}
          <Field
            label={t('onboarding.fields.vehicleHas')}
            value={yesNoLabel(user.vehicle?.has, t)}
          />
          {user.vehicle?.has && (
            <>
              <Field
                label={t('onboarding.fields.vehicleMake')}
                value={user.vehicle?.make}
              />
              <Field
                label={t('onboarding.fields.vehiclePlateNumber')}
                value={user.vehicle?.plateNumber}
              />
            </>
          )}
        </div>
      )}
      renderFields={({ register, errors, watch, t }) => {
        const petsHas = watch('pets.has')
        const vehicleHas = watch('vehicle.has')
        return (
          <>
            <div className="flex flex-col gap-2">
              <Label htmlFor="name">{t('onboarding.fields.name')}</Label>
              <Input id="name" {...register('name')} />
              <FieldError error={errors.name} t={t} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="dateOfBirth">
                {t('onboarding.fields.dateOfBirth')}
              </Label>
              <Input
                id="dateOfBirth"
                type="date"
                {...register('dateOfBirth')}
              />
              <FieldError error={errors.dateOfBirth} t={t} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="cnp">{t('onboarding.fields.cnp')}</Label>
              <Input id="cnp" {...register('cnp')} />
              <FieldError error={errors.cnp} t={t} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="phone">{t('onboarding.fields.phone')}</Label>
              <Input id="phone" {...register('phone')} />
              <FieldError error={errors.phone} t={t} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="email">{t('onboarding.fields.email')}</Label>
              <Input id="email" {...register('email')} />
              <FieldError error={errors.email} t={t} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="mailingAddress">
                {t('onboarding.fields.mailingAddress')}
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
              <Input
                id="occupantCount"
                type="number"
                min="1"
                {...register('occupantCount', { valueAsNumber: true })}
              />
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
                <Label htmlFor="pets.type">
                  {t('onboarding.fields.petsType')}
                </Label>
                <Input id="pets.type" {...register('pets.type')} />
                <FieldError error={errors.pets?.type} t={t} />
              </div>
            )}
            <div className="flex flex-col gap-2">
              <Label htmlFor="vehicle.has">
                {t('onboarding.fields.vehicleHas')}
              </Label>
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
          </>
        )
      }}
    />
  )
}

function FinancialSection({ user, userId }) {
  const { t } = useTranslation()
  const updateUser = useUpdateUser()

  const defaultValues = {
    employer: user.employer ?? '',
    occupation: user.occupation ?? '',
    employmentDuration: user.employmentDuration ?? '',
    monthlyIncome: {
      source: user.monthlyIncome?.source ?? '',
      amount: user.monthlyIncome?.amount ?? '',
    },
  }

  return (
    <EditableSection
      titleKey="tenants.detail.sections.financial"
      schema={financialSectionSchema}
      defaultValues={defaultValues}
      onSave={(values) => updateUser.mutateAsync({ id: userId, values })}
      renderView={() => (
        <div className="grid grid-cols-2 gap-4">
          <Field
            label={t('onboarding.fields.employer')}
            value={user.employer}
          />
          <Field
            label={t('onboarding.fields.occupation')}
            value={user.occupation}
          />
          <Field
            label={t('onboarding.fields.employmentDuration')}
            value={user.employmentDuration}
          />
          <Field
            label={t('onboarding.fields.monthlyIncomeSource')}
            value={user.monthlyIncome?.source}
          />
          <Field
            label={t('onboarding.fields.monthlyIncomeAmount')}
            value={user.monthlyIncome?.amount}
          />
        </div>
      )}
      renderFields={({ register, errors, t }) => (
        <>
          <div className="flex flex-col gap-2">
            <Label htmlFor="employer">{t('onboarding.fields.employer')}</Label>
            <Input id="employer" {...register('employer')} />
            <FieldError error={errors.employer} t={t} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="occupation">
              {t('onboarding.fields.occupation')}
            </Label>
            <Input id="occupation" {...register('occupation')} />
            <FieldError error={errors.occupation} t={t} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="employmentDuration">
              {t('onboarding.fields.employmentDuration')}
            </Label>
            <Input
              id="employmentDuration"
              type="number"
              min="0"
              {...register('employmentDuration', { valueAsNumber: true })}
            />
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
              type="number"
              min="0"
              {...register('monthlyIncome.amount', { valueAsNumber: true })}
            />
            <FieldError error={errors.monthlyIncome?.amount} t={t} />
          </div>
        </>
      )}
    />
  )
}

/**
 * The one section that CANNOT save its text fields as a plain nested object:
 * `guarantor` also holds `idDocumentPhotos[]` (owned by the gallery below, not
 * this form). `onSave` transforms the parsed `{ guarantor: {name,cnp,phone} }`
 * into dot-path keys before calling `useUpdateUser` — see the hook's own
 * docstring (features/tenants/hooks.js) for why a plain nested write would
 * silently wipe the photos.
 */
function GuarantorSection({ user, userId }) {
  const { t } = useTranslation()
  const updateUser = useUpdateUser()

  const defaultValues = {
    guarantor: {
      name: user.guarantor?.name ?? '',
      cnp: user.guarantor?.cnp ?? '',
      phone: user.guarantor?.phone ?? '',
    },
  }

  return (
    <EditableSection
      titleKey="tenants.detail.sections.guarantor"
      schema={guarantorSectionSchema}
      defaultValues={defaultValues}
      onSave={({ guarantor }) =>
        updateUser.mutateAsync({
          id: userId,
          values: {
            'guarantor.name': guarantor.name,
            'guarantor.cnp': guarantor.cnp,
            'guarantor.phone': guarantor.phone,
          },
        })
      }
      renderView={() => (
        <div className="grid grid-cols-2 gap-4">
          <Field
            label={t('onboarding.fields.guarantorName')}
            value={user.guarantor?.name}
          />
          <Field
            label={t('onboarding.fields.guarantorCnp')}
            value={user.guarantor?.cnp}
          />
          <Field
            label={t('onboarding.fields.guarantorPhone')}
            value={user.guarantor?.phone}
          />
        </div>
      )}
      renderFields={({ register, errors, t }) => (
        <>
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
        </>
      )}
    />
  )
}

function PreviousReferenceSection({ user, userId }) {
  const { t } = useTranslation()
  const updateUser = useUpdateUser()

  const defaultValues = {
    previousReference: {
      name: user.previousReference?.name ?? '',
      phone: user.previousReference?.phone ?? '',
    },
  }

  return (
    <EditableSection
      titleKey="tenants.detail.sections.previousReference"
      schema={previousReferenceSectionSchema}
      defaultValues={defaultValues}
      onSave={(values) => updateUser.mutateAsync({ id: userId, values })}
      renderView={() => (
        <div className="grid grid-cols-2 gap-4">
          <Field
            label={t('onboarding.fields.previousReferenceName')}
            value={user.previousReference?.name}
          />
          <Field
            label={t('onboarding.fields.previousReferencePhone')}
            value={user.previousReference?.phone}
          />
        </div>
      )}
      renderFields={({ register, errors, t }) => (
        <>
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
        </>
      )}
    />
  )
}

function LanguageSection({ user, userId }) {
  const { t } = useTranslation()
  const updateUser = useUpdateUser()

  return (
    <EditableSection
      titleKey="tenants.detail.sections.language"
      schema={languageSectionSchema}
      defaultValues={{ preferredLanguage: user.preferredLanguage }}
      onSave={(values) => updateUser.mutateAsync({ id: userId, values })}
      renderView={() => (
        <Field
          label={t('onboarding.fields.preferredLanguage')}
          value={
            user.preferredLanguage
              ? t(`onboarding.languages.${user.preferredLanguage}`)
              : null
          }
        />
      )}
      renderFields={({ register, errors, t }) => (
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
      )}
    />
  )
}

export function ProfileTab({ user, userId }) {
  const { t } = useTranslation()

  return (
    <div className="flex flex-col gap-6">
      <PersonalSection user={user} userId={userId} />

      <Section title={t('tenants.detail.sections.idPhotos')}>
        <PhotoGallery
          userId={userId}
          photos={user.idDocumentPhotos ?? []}
          fieldPath="idDocumentPhotos"
          storageFolder="documents"
          minCount={1}
        />
      </Section>

      <FinancialSection user={user} userId={userId} />
      <GuarantorSection user={user} userId={userId} />

      <Section title={t('onboarding.fields.guarantorIdDocumentPhotos')}>
        <PhotoGallery
          userId={userId}
          photos={user.guarantor?.idDocumentPhotos ?? []}
          fieldPath="guarantor.idDocumentPhotos"
          storageFolder="guarantor"
          minCount={0}
        />
      </Section>

      <PreviousReferenceSection user={user} userId={userId} />
      <LanguageSection user={user} userId={userId} />
    </div>
  )
}
