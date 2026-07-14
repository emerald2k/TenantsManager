import { NavLink, Outlet } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { LanguageSwitcher } from '@/components/shared/LanguageSwitcher'
import { useAuth } from '@/features/auth/useAuth'
import { cn } from '@/lib/utils'

const NAV_ITEMS = [
  { to: '/admin', label: 'nav.dashboard', end: true },
  { to: '/admin/luna-curenta', label: 'nav.currentMonth' },
  { to: '/admin/proprietati', label: 'nav.properties' },
  { to: '/admin/chiriasi', label: 'nav.tenants' },
]

export function AdminLayout() {
  const { t } = useTranslation()
  const { logout } = useAuth()

  return (
    <div className="flex min-h-svh">
      <aside className="flex w-56 shrink-0 flex-col justify-between border-r border-border p-4">
        <nav className="flex flex-col gap-1">
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

        <div className="flex flex-col gap-3">
          <LanguageSwitcher />
          <Button type="button" variant="outline" size="sm" onClick={logout}>
            {t('common.logout')}
          </Button>
        </div>
      </aside>

      <main className="flex-1">
        <Outlet />
      </main>
    </div>
  )
}
