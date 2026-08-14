import { NavLink, Outlet } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { LanguageSwitcher } from '@/components/shared/LanguageSwitcher'
import { useAuth } from '@/features/auth/useAuth'
import { useMyTenancy } from '@/features/tenantApp/hooks'
import { formatFullDate } from '@/lib/formatDate'
import { cn } from '@/lib/utils'

const NAV_ITEMS = [
  { to: '/app', label: 'nav.home', end: true },
  { to: '/app/history', label: 'nav.history' },
  { to: '/app/contract', label: 'nav.contract' },
]

/**
 * `TenantLayout` calls `useMyTenancy(user.uid)` itself (M5 sub-stage 9
 * plan) — the SAME hook, SAME `queryKey`, every tenant page already calls
 * independently. TanStack Query de-dupes by key, so this is NOT a second
 * network fetch — it reads the same cached result. Deliberately not an
 * `Outlet` context/prop-drilling refactor: that would touch all four
 * tenant pages for zero functional gain over the cache hit already free.
 */
export function TenantLayout() {
  const { t, i18n } = useTranslation()
  const { user, logout } = useAuth()
  const tenancyQuery = useMyTenancy(user.uid)
  const tenancy = tenancyQuery.data
  const showEndedBanner = Boolean(
    tenancy?.status === 'ended' && tenancy.endedAt,
  )

  return (
    <div className="flex min-h-svh flex-col">
      <header className="flex items-center justify-between border-b border-border p-4">
        <nav className="flex gap-1">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cn(
                  'rounded-md px-3 py-2 text-sm font-medium hover:bg-muted',
                  isActive && 'bg-muted text-foreground',
                )
              }
            >
              {t(item.label)}
            </NavLink>
          ))}
        </nav>

        <div className="flex items-center gap-3">
          <LanguageSwitcher />
          <Button type="button" variant="outline" size="sm" onClick={logout}>
            {t('common.logout')}
          </Button>
        </div>
      </header>

      {showEndedBanner && (
        <div
          role="status"
          className="border-b border-border bg-muted px-4 py-2 text-center text-sm text-foreground"
        >
          {t('tenantApp.endedBanner.message', {
            date: formatFullDate(tenancy.endedAt, i18n.language),
          })}
        </div>
      )}

      <main className="flex-1">
        <Outlet />
      </main>
    </div>
  )
}
