import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Bell, ChevronRight, LogOut, Moon, Sun } from 'lucide-react'
import { AdminConfigBanner } from '@/components/shared/AdminConfigBanner'
import { LanguageSwitcher } from '@/components/shared/LanguageSwitcher'
import { ThemeToggle } from '@/components/shared/ThemeToggle'
import { useAuth } from '@/features/auth/useAuth'
import { useTheme } from '@/features/theme/useTheme'
import { cn } from '@/lib/utils'
import { SHEET_ITEMS, TAB_ITEMS, sectionTitleKey } from '@/routes/adminNav'

/**
 * The admin shell below 700 px (NFR-UX-03, M8 stage 15b). A different shell,
 * not the desktop one compressed:
 *
 * - a sticky title bar: the section name, an icon-only bell linking to the
 *   notification log, and an icon-only theme toggle. Icon-only is fine HERE
 *   because the labelled routes live in the "More" sheet (NFR-UX-06 rule 3);
 *   the bell carries NO count — there is no read/unread state in the data
 *   model (owner decision 2026-08-30);
 * - a fixed bottom tab bar of five: four routes + "More";
 * - a "More" bottom sheet: Properties, Notifications, Language, Theme,
 *   Sign-out.
 *
 * Every tap target is ≥ 44 px; list/sheet rows 48–56 px (NFR-UX-03). Hover
 * rules are Tailwind `hover:` utilities, which Tailwind v4 auto-scopes to
 * `@media (hover:hover)` so they never latch on touch; press feedback is
 * `active:` (global) and the permanent `›` marker.
 */
export function AdminPhoneShell() {
  const { t } = useTranslation()
  const { logout } = useAuth()
  const { theme, toggleTheme } = useTheme()
  const { pathname } = useLocation()
  const [sheetOpen, setSheetOpen] = useState(false)

  const titleKey = sectionTitleKey(pathname)

  useEffect(() => {
    if (!sheetOpen) return undefined
    function onKey(event) {
      if (event.key === 'Escape') setSheetOpen(false)
    }
    document.addEventListener('keydown', onKey)
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = previousOverflow
    }
  }, [sheetOpen])

  return (
    <div className="flex min-h-svh flex-col">
      <AdminConfigBanner />

      <header className="sticky top-0 z-20 bg-background px-4 pt-2 pb-2.5 shadow-[0_8px_12px_-10px_rgba(15,23,42,0.28)]">
        <div className="flex items-center gap-3">
          <h1 className="flex-1 truncate text-2xl leading-tight font-bold tracking-tight text-foreground">
            {titleKey ? t(titleKey) : ''}
          </h1>
          <NavLink
            to="/admin/notifications"
            aria-label={t('nav.notifications')}
            className="grid size-11 shrink-0 place-items-center rounded-full border border-border bg-card text-muted-foreground transition-transform hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-90"
          >
            <Bell className="size-5" />
          </NavLink>
          <button
            type="button"
            onClick={toggleTheme}
            aria-label={t('theme.ariaLabel')}
            className="grid size-11 shrink-0 place-items-center rounded-full border border-border bg-card text-muted-foreground transition-transform hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-90"
          >
            {theme === 'dark' ? (
              <Moon className="size-5" />
            ) : (
              <Sun className="size-5" />
            )}
          </button>
        </div>
      </header>

      <main className="min-w-0 flex-1 pb-24">
        <Outlet />
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-sidebar-border bg-sidebar pb-[env(safe-area-inset-bottom)]">
        {TAB_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              cn(
                'relative flex min-h-[52px] flex-col items-center gap-1 px-1 py-2 text-[11px] font-semibold whitespace-nowrap text-sidebar-foreground',
                'focus-visible:outline-none focus-visible:bg-sidebar-accent/60',
                'active:bg-sidebar-accent/40',
                isActive &&
                  'text-sidebar-accent-foreground before:absolute before:top-0 before:left-1/2 before:h-[3px] before:w-6 before:-translate-x-1/2 before:rounded-b-sm before:bg-primary',
              )
            }
          >
            <item.Icon className="size-[21px] shrink-0" />
            {t(item.label)}
          </NavLink>
        ))}
        <button
          type="button"
          onClick={() => setSheetOpen(true)}
          aria-haspopup="dialog"
          aria-expanded={sheetOpen}
          className="relative flex min-h-[52px] flex-col items-center gap-1 px-1 py-2 text-[11px] font-semibold whitespace-nowrap text-sidebar-foreground focus-visible:bg-sidebar-accent/60 focus-visible:outline-none active:bg-sidebar-accent/40"
        >
          <MoreDotsIcon />
          {t('nav.more')}
        </button>
      </nav>

      {sheetOpen && (
        <>
          <button
            type="button"
            aria-label={t('common.close')}
            onClick={() => setSheetOpen(false)}
            className="fixed inset-0 z-40 bg-black/40 motion-safe:animate-in motion-safe:fade-in-0"
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label={t('nav.more')}
            className="fixed inset-x-0 bottom-0 z-50 rounded-t-2xl bg-card pt-2.5 pb-[calc(env(safe-area-inset-bottom)+1.5rem)] shadow-[0_-8px_40px_rgba(0,0,0,0.28)] motion-safe:animate-in motion-safe:slide-in-from-bottom"
          >
            <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-border" />
            <div className="px-5 pb-2 text-xs font-bold tracking-wider text-muted-foreground uppercase">
              {t('nav.more')}
            </div>

            {SHEET_ITEMS.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                onClick={() => setSheetOpen(false)}
                className="flex min-h-[56px] items-center gap-3.5 border-b border-border/60 px-5 py-4 text-base font-medium text-foreground hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none active:bg-muted/70"
              >
                <item.Icon className="size-5 shrink-0 text-muted-foreground" />
                <span className="flex-1">{t(item.label)}</span>
                <ChevronRight className="size-[19px] shrink-0 text-muted-foreground" />
              </NavLink>
            ))}

            {/* Upsize the shared chips to a 44 px tap target — they render
                at `size="sm"` (28 px) on the desktop rail, too small here
                (NFR-UX-03). */}
            <div className="flex min-h-[56px] items-center border-b border-border/60 px-5 py-3 [&_button]:min-h-11">
              <LanguageSwitcher />
            </div>
            <div className="flex min-h-[56px] items-center border-b border-border/60 px-5 py-3 [&_button]:min-h-11">
              <ThemeToggle />
            </div>
            <button
              type="button"
              onClick={() => {
                setSheetOpen(false)
                logout()
              }}
              className="flex min-h-[56px] w-full items-center gap-3.5 px-5 py-4 text-base font-medium text-destructive hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none active:bg-muted/70"
            >
              <LogOut className="size-5 shrink-0" />
              {t('common.logout')}
            </button>
          </div>
        </>
      )}
    </div>
  )
}

/** The three-dot "More" glyph — lucide's `Ellipsis` under an explicit name so
 * the file reads the same as the other icons (member-expression JSX, see
 * AdminLayout's NavItem note). */
function MoreDotsIcon() {
  return (
    <svg
      className="size-[21px] shrink-0"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <circle cx="5" cy="12" r="1.6" />
      <circle cx="12" cy="12" r="1.6" />
      <circle cx="19" cy="12" r="1.6" />
    </svg>
  )
}
