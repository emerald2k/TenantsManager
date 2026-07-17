import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { PropertyForm } from '@/features/properties/components/PropertyForm'
import { useCreateProperty } from '@/features/properties/hooks'

/**
 * Property creation (FR-PROP-01, SRS §5.3).
 *
 * ONLY the property's own fields. The services are NOT here: they are added from
 * the property page, on an existing property (FR-PROP-02) — a service needs a
 * document to attach to, and that document does not exist until this form submits.
 *
 * The fields and the validation live in `../components/PropertyForm`, shared with
 * the edit section of the detail page (sub-stage D).
 */
export function CreatePropertyPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const createProperty = useCreateProperty()

  async function handleSubmit(values) {
    // `mutateAsync` (not `mutate`): we need the new id to redirect, and the
    // mutation resolves with exactly that (the hook returns `ref.id`). Errors
    // propagate to PropertyForm, which surfaces `errorKey`.
    const id = await createProperty.mutateAsync(values)
    navigate(`/admin/properties/${id}`)
  }

  return (
    <div className="p-6">
      <div className="max-w-xl rounded-lg border border-border p-6 shadow-sm">
        <h1 className="mb-6 text-xl font-semibold text-foreground">
          {t('properties.new.title')}
        </h1>
        <PropertyForm
          onSubmit={handleSubmit}
          submitLabelKey="properties.new.submit"
          errorKey="properties.new.error"
          isPending={createProperty.isPending}
        />
      </div>
    </div>
  )
}
