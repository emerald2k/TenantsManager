import { NavLink, Outlet } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { LogOut } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { AdminConfigBanner } from '@/components/shared/AdminConfigBanner'
import { LanguageSwitcher } from '@/components/shared/LanguageSwitcher'
import { ThemeToggle } from '@/components/shared/ThemeToggle'
import { useAuth } from '@/features/auth/useAuth'
import { useMediaQuery } from '@/lib/useMediaQuery'
import { cn } from '@/lib/utils'
import { NAV_ITEMS } from '@/routes/adminNav'
import { AdminPhoneShell } from '@/routes/AdminPhoneShell'

/**
 * The admin shell. Two layouts, chosen by viewport width (NFR-UX-03):
 *
 * - **≥ 700 px** — the dark side rail below, unchanged since M8 stage 10.
 *   Below 880 px it collapses into a horizontal scroller (still the desktop
 *   shell, just narrower).
 * - **< 700 px** — `AdminPhoneShell`: a bottom tab bar of five, a title-bar
 *   bell + theme icon, and a "More" sheet. Built at M8 stage 15b.
 *
 * The switch is a JS media query, not a CSS `hidden` swap, so only one shell
 * is ever in the DOM — see `useMediaQuery`'s note. `<Outlet/>` renders exactly
 * once, inside whichever shell is active.
 */
export function AdminLayout() {
  const isPhone = useMediaQuery('(max-width: 699px)')
  return isPhone ? <AdminPhoneShell /> : <AdminDesktopShell />
}

/** One side-rail entry. Reads its icon off `item.Icon` as a JSX member
 * expression (`<item.Icon .../>`), never destructured into its own `Icon`
 * binding — this project's eslint config has no `eslint-plugin-react`, so
 * plain `no-unused-vars` cannot see a JSX tag as a "use" of a destructured
 * function parameter (only `varsIgnorePattern` exempts module-scope
 * bindings like a direct `import`, which covers every OTHER icon in this
 * file). A member expression introduces no such binding, so there is
 * nothing for the rule to falsely flag. */
function NavItem({ item }) {
  const { t } = useTranslation()
  return (
    <NavLink
      to={item.to}
      end={item.end}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium whitespace-nowrap text-sidebar-foreground',
          'hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
          'focus-visible:bg-sidebar-accent focus-visible:text-sidebar-accent-foreground focus-visible:outline-none',
          isActive &&
            'bg-sidebar-accent font-semibold text-sidebar-accent-foreground',
        )
      }
    >
      <item.Icon className="size-[18px] shrink-0" />
      {t(item.label)}
    </NavLink>
  )
}

function AdminDesktopShell() {
  const { t } = useTranslation()
  const { logout } = useAuth()

  return (
    <div className="flex min-h-svh flex-col">
      <AdminConfigBanner />

      <div className="flex flex-1 max-[880px]:flex-col">
        <aside className="sticky top-0 flex min-h-svh w-64 shrink-0 flex-col justify-between bg-sidebar text-sidebar-foreground max-[880px]:static max-[880px]:min-h-0 max-[880px]:w-full">
          <nav className="flex flex-col gap-1 p-3 max-[880px]:flex-row max-[880px]:gap-2 max-[880px]:overflow-x-auto">
            {NAV_ITEMS.map((item) => (
              <NavItem key={item.to} item={item} />
            ))}
          </nav>

          <div className="flex flex-col gap-3 border-t border-sidebar-border p-3 max-[880px]:flex-row max-[880px]:items-center max-[880px]:gap-4 max-[880px]:overflow-x-auto max-[880px]:border-t-0">
            {/* LanguageSwitcher renders its own "Limbă:" label in
                text-muted-foreground (an app-level token) and its own
                self-contained RO/EN button chips — the label override below
                is the only thing that needs the dark-rail's own foreground,
                the buttons already carry their own bg-background fill. */}
            <div className="[&_span]:text-sidebar-foreground">
              <LanguageSwitcher />
            </div>
            <div className="[&>button]:w-full [&>button]:justify-start [&>button]:gap-3 [&>button]:whitespace-nowrap [&>button]:border-0 [&>button]:bg-transparent [&>button]:px-3 [&>button]:py-2.5 [&>button]:text-sidebar-foreground [&>button]:hover:bg-sidebar-accent [&>button]:hover:text-sidebar-accent-foreground max-[880px]:[&>button]:w-auto">
              <ThemeToggle />
            </div>
            <Button
              type="button"
              variant="ghost"
              className="w-full justify-start gap-3 whitespace-nowrap px-3 py-2.5 text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground max-[880px]:w-auto"
              onClick={logout}
            >
              <LogOut className="size-[18px] shrink-0" />
              {t('common.logout')}
            </Button>
          </div>
        </aside>

        <main className="min-w-0 flex-1">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
