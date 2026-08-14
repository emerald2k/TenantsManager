import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'

/**
 * The "Retry" half of SRS §5.5's `error (message+"Retry")`. Deliberately
 * dumb: it renders next to whatever message a page already shows and calls
 * `onRetry` — it owns neither the message, its color, nor its layout.
 * `disabled` covers the retry itself being in flight, so a second click
 * can't fire a second refetch/write while the first hasn't resolved yet.
 */
export function RetryButton({ onRetry, disabled = false }) {
  const { t } = useTranslation()
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={onRetry}
      disabled={disabled}
    >
      {t('common.retry')}
    </Button>
  )
}
