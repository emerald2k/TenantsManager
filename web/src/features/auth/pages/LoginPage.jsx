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

/** Doar PREZENȚĂ, fără verificare de format (NFR-VAL-01: „câmpurile obligatorii
 * sunt verificate doar pentru prezență, fără verificare de format"). De aceea
 * NU folosim z.string().email() — formatul emailului nu se validează pe client;
 * Firebase respinge oricum credențialele greșite. */
const loginSchema = z.object({
  email: z.string().min(1, 'login.errors.required'),
  password: z.string().min(1, 'login.errors.required'),
})

/** Traduce codul de eroare Firebase în cheia de mesaj (§5.2).
 * Specificația cere exact două stări vizibile: eroare generică și cont
 * dezactivat. Nu divulgăm dacă emailul există în sistem — de aceea
 * „user-not-found", „wrong-password" și „invalid-credential" duc toate la
 * același mesaj generic. */
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
      // Fără navigare explicită: AuthProvider primește noul token, guard-urile
      // reacționează, iar GuestRoute redirecționează pe dashboard-ul rolului.
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

        {/* Fără „am uitat parola" — interzis explicit de FR-AUTH-04. */}
      </form>

      <LanguageSwitcher />
    </div>
  )
}
