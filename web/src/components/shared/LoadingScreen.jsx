import { useTranslation } from 'react-i18next'

export function LoadingScreen() {
  const { t } = useTranslation()

  return (
    <div className="flex min-h-svh items-center justify-center">
      <p className="animate-pulse text-sm text-muted-foreground">
        {t('common.loading')}
      </p>
    </div>
  )
}
