import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { LanguageSwitcher } from '@/components/shared/LanguageSwitcher'
import { useAuth } from '@/features/auth/MockAuthContext'

export function LoginPage() {
  const { t } = useTranslation()
  const { login } = useAuth()

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 p-4">
      <div className="w-full max-w-sm rounded-lg border border-border p-6 shadow-sm">
        <h1 className="mb-1 text-xl font-semibold text-foreground">
          {t('login.title')}
        </h1>
        <p className="mb-6 text-sm text-muted-foreground">
          {t('login.mockNotice')}
        </p>

        <div className="flex flex-col gap-2">
          <Button type="button" onClick={() => login('admin')}>
            {t('login.mockAdmin')}
          </Button>
          <Button type="button" variant="outline" onClick={() => login('tenant')}>
            {t('login.mockTenant')}
          </Button>
        </div>
      </div>

      <LanguageSwitcher />
    </div>
  )
}
