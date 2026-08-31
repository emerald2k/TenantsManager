import { useTranslation } from 'react-i18next'
import { formatFullDate } from '@/lib/formatDate'

/**
 * The resolved value of a native `<input type="date">`, spelled out beside
 * the control — "10 august 2026" — in the interface language.
 *
 * `input[type=date]` renders its own value in the BROWSER/OS locale and
 * ignores `lang` entirely; there is no attribute, CSS property or option
 * that changes it (2026-08-31 UI/UX audit, finding #3). In a Romanian
 * interface it shows `08/10/2026`, which a Romanian reads as 8 October and
 * which means 10 August — exactly the ambiguity that produces a late
 * payment. So the app states the date in words next to the input instead.
 *
 * Same formatter the tenant portal already uses (`formatFullDate`). An empty
 * or unparseable value renders NOTHING — no placeholder, no dash (NFR-UX-08:
 * missing data produces no UI).
 */
export function DateInWords({ value, className = '' }) {
  const { i18n } = useTranslation()

  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null

  return (
    <span className={`text-xs text-muted-foreground ${className}`}>
      {formatFullDate(value, i18n.language)}
    </span>
  )
}
