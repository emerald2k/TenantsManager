import { NavLink, Outlet } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  Bell,
  Building2,
  CalendarDays,
  LayoutDashboard,
  LogOut,
  Users,
  Wallet,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { AdminConfigBanner } from '@/components/shared/AdminConfigBanner'
import { LanguageSwitcher } from '@/components/shared/LanguageSwitcher'
import { ThemeToggle } from '@/components/shared/ThemeToggle'
import { useAuth } from '@/features/auth/useAuth'
import { cn } from '@/lib/utils'

/**
 * The admin shell's sidebar (M8 stage 10, SRS §5.1/§5.3) — six items, in
 * the order SRS §5.1 lists them: Dashboard, Current month, Properties,
 * Renters, Payments, Notifications. Current month sits second, directly
 * under Dashboard — corrected in the SRS on 2026-08-25 to match the
 * administrator's own ordering decision made on the approved mockup
 * (comment `1d5e7bcd`), which the SRS text had not caught up with yet.
 * The first pass here followed the SRS's OLD order under the "SRS wins
 * where they disagree" rule — correctly applying the rule against a
 * source that itself hadn't been brought forward. The rule stands; this
 * commit just follows the corrected SRS instead of the stale one.
 * Payments and Notifications route to `PlaceholderPage` until stages 12
 * and 14 build their real pages — the sidebar is greenfield ahead of
 * both, by design (the plan's own stage 10 row says "sidebar (6 items)"),
 * not a dangling link.
 *
 * Not adopted: the mockup's badge pill on "Current month" (would need
 * this-month's unsigned-report count, a data feature this shell stage
 * does not own) and the sub-700px phone shell (bottom tab bar, bell,
 * "More" sheet, NFR-UX-03) — neither is named in the plan's stage 10 row;
 * the plan's stage 15b now names the phone shell explicitly, after stage
 * 15 (Dashboard), not started yet. What IS built here, because NFR-UX-03
 * names it directly: below 880px the dark rail collapses into a
 * horizontal scroller instead of a fixed side column, still above the
 * main content, not yet the phone shell.
 */
const NAV_ITEMS = [
  { to: '/admin', label: 'nav.dashboard', end: true, Icon: LayoutDashboard },
  {
    to: '/admin/current-month',
    label: 'nav.currentMonth',
    Icon: CalendarDays,
  },
  { to: '/admin/properties', label: 'nav.properties', Icon: Building2 },
  { to: '/admin/tenants', label: 'nav.tenants', Icon: Users },
  { to: '/admin/payments', label: 'nav.payments', Icon: Wallet },
  { to: '/admin/notifications', label: 'nav.notifications', Icon: Bell },
]

/** One sidebar entry. Reads its icon off `item.Icon` as a JSX member
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

export function AdminLayout() {
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
