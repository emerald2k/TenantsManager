import { useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

/** Pagină schelet — folosită temporar pentru toate rutele din sub-etapa C,
 * până sunt implementate paginile reale în milestone-urile următoare. */
export function PlaceholderPage({ titleKey }) {
  const { t } = useTranslation()
  const params = useParams()
  const hasParams = Object.keys(params).length > 0

  return (
    <div className="p-6">
      <h1 className="text-xl font-semibold text-foreground">{t(titleKey)}</h1>
      {hasParams && (
        <p className="mt-1 text-sm text-muted-foreground">
          {Object.entries(params)
            .map(([key, value]) => `${key}: ${value}`)
            .join(' · ')}
        </p>
      )}
    </div>
  )
}
