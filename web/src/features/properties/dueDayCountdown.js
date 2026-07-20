/** The number of days in `monthIndex` (0-based, JS convention) of `year`. */
function daysInMonth(year, monthIndex) {
  return new Date(year, monthIndex + 1, 0).getDate()
}

/** Midnight of `year`/`monthIndex`/`day`, `day` CLAMPED to that month's length —
 * `dueDay`'s own valid range is 1-31 (schema.js), wider than some months, so 31
 * in February lands on Feb's last day instead of overflowing into March. */
function clampedDateFor(year, monthIndex, day) {
  const clampedDay = Math.min(day, daysInMonth(year, monthIndex))
  return new Date(year, monthIndex, clampedDay)
}

/**
 * Days remaining until the NEXT occurrence of `dueDay` (FR-PROP-11) — a pure
 * calendar calculation, independent of monthly reports. `dueDay` is the
 * tenancy's own field — a real NUMBER (Sub-stage E, type correction; previously
 * a presence-only string, coerced here via `parseInt`). `today` defaults to now,
 * overridable for tests.
 *
 * Returns `null` for anything that is not a positive integer (wrong type, zero,
 * negative) — the countdown is hidden rather than showing a wrong number. This
 * still guards against bad/stale data reaching the function; it just no longer
 * COERCES a numeric-looking string, since the source is a number everywhere now.
 * Returns `0` when today IS the due day (not a full cycle away).
 */
export function computeDaysUntilDueDay(dueDay, today = new Date()) {
  if (!Number.isInteger(dueDay) || dueDay < 1) return null

  const startOfToday = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  )

  let candidate = clampedDateFor(
    startOfToday.getFullYear(),
    startOfToday.getMonth(),
    dueDay,
  )
  if (candidate < startOfToday) {
    // `monthIndex + 1` overflowing past 11 rolls the Date into January of the
    // next year automatically — no manual year-boundary handling needed.
    candidate = clampedDateFor(
      startOfToday.getFullYear(),
      startOfToday.getMonth() + 1,
      dueDay,
    )
  }

  const MS_PER_DAY = 1000 * 60 * 60 * 24
  return Math.round((candidate - startOfToday) / MS_PER_DAY)
}
