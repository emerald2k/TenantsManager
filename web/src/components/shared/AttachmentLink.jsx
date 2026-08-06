import { useAttachmentUrl } from '@/lib/useAttachmentUrl'
import { useTranslation } from 'react-i18next'

/**
 * A single downloadable attachment reference (`{ path, name, type }`, SRS §6,
 * debt #5), resolved to a real download URL at render time via
 * `useAttachmentUrl`. Shared by the three tenant-portal surfaces that render
 * this exact shape as a plain download link — `TenantContractPage`,
 * `TenantDashboardPage`, `TenantReportDetailPage` — extracted once a third
 * near-identical copy appeared (same precedent as `web/src/lib/fileUpload.js`,
 * M4 sub-stage 3).
 *
 * While the URL is resolving, or if it fails to resolve (Security Rules
 * denied it, the object no longer exists), this renders inert text instead
 * of a link — never a clickable `<a href={undefined}>`.
 *
 * @param attachment    `{ path, name, type }`
 * @param downloadLabel the translated `aria-label` prefix — each caller owns
 *                       its own i18n key for this (the three pages each use a
 *                       different one), so it is passed in already resolved
 *                       rather than this component picking one on its own.
 */
export function AttachmentLink({ attachment, downloadLabel }) {
  const { t } = useTranslation()
  const { url, isLoading, isError } = useAttachmentUrl(attachment.path)

  if (isLoading) {
    return (
      <span className="text-sm text-muted-foreground">{attachment.name}</span>
    )
  }

  if (isError || !url) {
    return (
      <span className="text-sm text-muted-foreground">
        {attachment.name} ({t('common.attachmentUnavailable')})
      </span>
    )
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      aria-label={`${downloadLabel}: ${attachment.name}`}
      className="text-sm text-foreground underline"
    >
      {attachment.name} ({attachment.type})
    </a>
  )
}
