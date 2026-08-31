import {
  Bell,
  Building2,
  CalendarDays,
  LayoutDashboard,
  Users,
  Wallet,
} from 'lucide-react'

/**
 * The admin shell's navigation model, shared by the desktop side rail
 * (`AdminLayout`) and the phone bottom tab bar + "More" sheet
 * (`AdminPhoneShell`, M8 stage 15b).
 *
 * `NAV_ITEMS` is the full set in SRS §5.1 order (Dashboard, Current month,
 * Properties, Renters, Payments, Notifications) — the side rail shows all six.
 *
 * On the phone NFR-UX-03 caps the bottom bar at five: four destinations plus a
 * "More" tab. `TAB_ITEMS` is those four, in the approved mockup's order
 * (Panou · Luna · Plăți · Chiriași); `SHEET_ITEMS` is what the "More" sheet
 * holds that is a route (Properties, Notifications). Language, Theme and
 * Sign-out are also in the sheet but are their own controls, not routes.
 */
export const NAV_ITEMS = [
  { to: '/admin', label: 'nav.dashboard', end: true, Icon: LayoutDashboard },
  { to: '/admin/current-month', label: 'nav.currentMonth', Icon: CalendarDays },
  { to: '/admin/properties', label: 'nav.properties', Icon: Building2 },
  { to: '/admin/tenants', label: 'nav.tenants', Icon: Users },
  { to: '/admin/payments', label: 'nav.payments', Icon: Wallet },
  { to: '/admin/notifications', label: 'nav.notifications', Icon: Bell },
]

/** The four route tabs on the phone bottom bar, in mockup order. `label` is
 * the SHORT form ("Luna", not "Luna curentă") — a wide label makes a five-cell
 * bar too narrow to hit (NFR-UX-03). */
export const TAB_ITEMS = [
  {
    to: '/admin',
    label: 'nav.tab.dashboard',
    end: true,
    Icon: LayoutDashboard,
  },
  {
    to: '/admin/current-month',
    label: 'nav.tab.currentMonth',
    Icon: CalendarDays,
  },
  { to: '/admin/payments', label: 'nav.tab.payments', Icon: Wallet },
  { to: '/admin/tenants', label: 'nav.tab.tenants', Icon: Users },
]

/** The routes that live in the "More" sheet rather than on a tab. */
export const SHEET_ITEMS = [
  { to: '/admin/properties', label: 'nav.properties', Icon: Building2 },
  { to: '/admin/notifications', label: 'nav.notifications', Icon: Bell },
]

/** The full-length section title for the phone title bar: the label of the
 * NAV_ITEMS entry whose path is the longest prefix of the current pathname
 * (so `/admin/properties/new` still reads "Proprietăți"). `null` when nothing
 * matches — the title bar then shows no heading. */
export function sectionTitleKey(pathname) {
  let best = null
  for (const item of NAV_ITEMS) {
    const isMatch =
      item.to === pathname || (!item.end && pathname.startsWith(`${item.to}/`))
    if (isMatch && (!best || item.to.length > best.to.length)) {
      best = item
    }
  }
  return best?.label ?? null
}
