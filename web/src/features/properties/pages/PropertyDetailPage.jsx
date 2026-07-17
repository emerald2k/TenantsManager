import { useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useProperty } from '@/features/properties/hooks'

/**
 * PLACEHOLDER (sub-stage C) — deliberately minimal.
 *
 * It exists so the redirect after creation (FR-PROP-01) lands on something real
 * that proves the write reached Firestore: it reads the property back by id and
 * shows its name.
 *
 * Sub-stage D replaces this with the full detail page from SRS §5.3 (data,
 * services, tenancy, actions). Do NOT grow it here.
 */
export function PropertyDetailPage() {
  const { t } = useTranslation()
  const { id } = useParams()
  const { data: property, isPending, isError } = useProperty(id)

  if (isPending) {
    return (
      <p className="p-6 text-sm text-muted-foreground">{t('common.loading')}</p>
    )
  }

  if (isError || !property) {
    return (
      <p className="p-6 text-sm text-muted-foreground">
        {t('properties.detail.notFound')}
      </p>
    )
  }

  return (
    <div className="p-6">
      <h1 className="text-xl font-semibold text-foreground">{property.name}</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {t('properties.detail.created')}
      </p>
    </div>
  )
}
