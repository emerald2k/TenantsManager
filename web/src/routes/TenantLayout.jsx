import { NavLink, Outlet } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { LanguageSwitcher } from '@/components/shared/LanguageSwitcher'
import { useAuth } from '@/features/auth/MockAuthContext'
import { cn } from '@/lib/utils'

const NAV_ITEMS = [
  { to: '/app', label: 'nav.home', end: true },
  { to: '/app/istoric', label: 'nav.history' },
  { to: '/app/contract', label: 'nav.contract' },
]

export function TenantLayout() {
  const { t } = useTranslation()
  const { logout } = useAuth()

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

      <main className="flex-1">
        <Outlet />
      </main>
    </div>
  )
}
