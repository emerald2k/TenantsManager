import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { useTheme } from '@/features/theme/useTheme'

/**
 * The theme toggle (NFR-UX-04) — a single button, labeled with the CURRENT
 * theme, same convention every other control on the sidebar's bottom rail
 * uses (a status readout, not the action a click performs). Two states
 * only: the approved mockup shows a three-way Sistem/Deschisă/Închisă
 * cycle, but the M8 stage 8 provider deliberately has no persisted
 * "system" state — `resolveInitialTheme` reads `prefers-color-scheme`
 * once, at first load, and never subscribes to it afterward (NFR-UX-04:
 * "initial value from", not "always follows"). Building a real system
 * state would reopen that decision; this stays a plain light/dark toggle,
 * just relabeled to read as a state instead of a command — the plan's own
 * stage 10 alternative to adopting the mockup's third state.
 */
export function ThemeToggle() {
  const { t } = useTranslation()
  const { theme, toggleTheme } = useTheme()
  const isDark = theme === 'dark'

  return (
    <Button type="button" variant="outline" size="sm" onClick={toggleTheme}>
      {t(isDark ? 'theme.stateDark' : 'theme.stateLight')}
    </Button>
  )
}
