import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { useTheme } from '@/features/theme/useTheme'

/**
 * The theme toggle (NFR-UX-04) — a single button, labeled with the theme it
 * SWITCHES TO (not the current one), same convention `LanguageSwitcher`
 * doesn't need but a binary on/off control benefits from: the label is the
 * action, not a status readout.
 */
export function ThemeToggle() {
  const { t } = useTranslation()
  const { theme, toggleTheme } = useTheme()
  const isDark = theme === 'dark'

  return (
    <Button type="button" variant="outline" size="sm" onClick={toggleTheme}>
      {t(isDark ? 'theme.switchToLight' : 'theme.switchToDark')}
    </Button>
  )
}
