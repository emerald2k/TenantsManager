import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { LanguageSwitcher } from '@/components/shared/LanguageSwitcher'
import { useAuth } from '@/features/auth/useAuth'

/** PRESENCE only, without format checking (NFR-VAL-01: "mandatory fields are
 * checked only for presence, without format validation"). That is why we do NOT
 * use z.string().email() — the email format is not validated on the client;
 * Firebase rejects wrong credentials anyway. */
const loginSchema = z.object({
  email: z.string().min(1, 'login.errors.required'),
  password: z.string().min(1, 'login.errors.required'),
})

/** Maps the Firebase error code to the message key (§5.2).
 * The specification asks for exactly two visible states: generic error and
 * disabled account. We do not disclose whether the email exists in the system —
 * that is why "user-not-found", "wrong-password" and "invalid-credential" all
 * lead to the same generic message. */
function messageKeyForError(error) {
  switch (error?.code) {
    case 'auth/user-disabled':
      return 'login.errors.accountDisabled'
    case 'auth/network-request-failed':
      return 'login.errors.network'
    default:
      return 'login.errors.invalidCredentials'
  }
}

export function LoginPage() {
  const { t } = useTranslation()
  const { login } = useAuth()
  const [formError, setFormError] = useState(null)

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  })

  async function onSubmit(values) {
    setFormError(null)
    try {
      await login(values.email, values.password)
      // No explicit navigation: AuthProvider receives the new token, the guards
      // react, and GuestRoute redirects to the role's dashboard.
    } catch (error) {
      setFormError(messageKeyForError(error))
    }
  }

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 p-4">
      <form
        onSubmit={handleSubmit(onSubmit)}
        noValidate
        className="w-full max-w-sm rounded-lg border border-border p-6 shadow-sm"
      >
        <h1 className="mb-6 text-xl font-semibold text-foreground">
          {t('login.title')}
        </h1>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="email">{t('login.email')}</Label>
            <Input id="email" autoComplete="username" {...register('email')} />
            {errors.email && (
              <p className="text-sm text-destructive">
                {t(errors.email.message)}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="password">{t('login.password')}</Label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              {...register('password')}
            />
            {errors.password && (
              <p className="text-sm text-destructive">
                {t(errors.password.message)}
              </p>
            )}
          </div>

          {formError && (
            <p
              role="alert"
              className="rounded-md bg-destructive/10 p-3 text-sm text-destructive"
            >
              {t(formError)}
            </p>
          )}

          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? t('common.loading') : t('login.submit')}
          </Button>
        </div>

        {/* No "forgot password" — explicitly forbidden by FR-AUTH-04. */}
      </form>

      <LanguageSwitcher />
    </div>
  )
}
