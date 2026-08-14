function localeFor(language) {
  return language === 'ro' ? 'ro-RO' : 'en-US'
}

/** A Firestore Timestamp (duck-typed via `.toDate`) or a plain 'YYYY-MM-DD'
 * string, coerced to a LOCAL-midnight Date. The string case is built from
 * its own year/month/day components — never `new Date(theString)`, which
 * parses as UTC midnight and is only safe here by coincidence (Bucharest is
 * always ahead of UTC), the same reasoning as `dueDayCountdown.js` (CLAUDE.md
 * §7). */
function toLocalDate(input) {
  if (typeof input?.toDate === 'function') return input.toDate()
  const [year, month, day] = input.split('-').map(Number)
  return new Date(year, month - 1, day)
}

/** "31 ianuarie 2026" / "January 31, 2026" (SRS §5.4). `language` is the
 * CURRENT interface language ('ro'/'en') — callers pass `i18n.language`,
 * never a stored preference. */
export function formatFullDate(input, language) {
  return new Intl.DateTimeFormat(localeFor(language), {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(toLocalDate(input))
}
