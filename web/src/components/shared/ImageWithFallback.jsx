import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ImageOff } from 'lucide-react'

/**
 * An `<img>` that shows an explicit, chosen state when the image fails to
 * load or decode — instead of the browser's broken-image icon and the bare
 * `alt` text, which is the absence of a state, not one the product picked
 * (2026-08-31 UI/UX audit, finding #2).
 *
 * For a `src` that is ALREADY resolved. The "still resolving" and
 * "`getDownloadURL` rejected" states stay with each caller's
 * `useAttachmentUrl` branch, untouched — this component owns exactly the
 * third failure: a good URL whose bytes are not a usable image (a corrupt
 * upload, a deleted object, a non-image body).
 *
 * The failure state is the whole box turned into a Retry control — a marker
 * icon plus the message, which clips gracefully at a 32 px cost-line
 * thumbnail and reads in full at a ~180 px ID-photo tile. Clicking it forces
 * a fresh `<img>` element (new `key`) so the browser refetches. `className`
 * styles the `<img>` and that box alike, so the layout cell keeps its size.
 * `onClick` (the lightbox) is only wired while a real image is showing.
 */
export function ImageWithFallback({ src, alt, className, onClick }) {
  const { t } = useTranslation()
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)

  if (failed) {
    return (
      <button
        type="button"
        title={t('common.attachmentImageError')}
        aria-label={`${t('common.attachmentImageError')} — ${t('common.retry')}`}
        onClick={() => {
          setFailed(false)
          setAttempt((n) => n + 1)
        }}
        className={`flex flex-col items-center justify-center gap-1 overflow-hidden rounded-md border border-border bg-muted p-1 text-center text-[0.65rem] leading-tight text-muted-foreground ${className ?? ''}`}
      >
        <ImageOff aria-hidden="true" className="size-4 shrink-0" />
        <span>{t('common.attachmentImageError')}</span>
      </button>
    )
  }

  return (
    <img
      key={attempt}
      src={src}
      alt={alt}
      className={className}
      onClick={onClick}
      onError={() => setFailed(true)}
    />
  )
}
