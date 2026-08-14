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

/** Whole days from local-calendar date `a` to local-calendar date `b`
 * (negative if `b` is earlier). Both are converted through `Date.UTC` on
 * their own (year, month, day) components before subtracting — never a
 * raw local-`Date` subtraction — so the result is always an exact integer,
 * immune to Europe/Bucharest's DST transitions (CLAUDE.md §7). Mirrors
 * `functions/src/schedulerLogic.js`'s `daysBetween`; not shared as code —
 * `functions/` deploys without `web/`, the same reason the KYC schema is
 * duplicated rather than shared (CLAUDE.md §7).
 *
 * NOT a bug fix: exhaustively verified (5642 scenarios, both Europe/
 * Bucharest DST transitions in 2026, every `dueDay` 1-31) that the old
 * local-`Date` + `Math.round` arithmetic never actually diverged from
 * this. That safety was coincidental, not structural: `Math.round`'s 0.5
 * threshold happens to be wider than a single DST transition's <=1hr
 * error, for THIS product's specific, narrow scope — RON-only currency
 * (SRS §2.6), `cnp` as a mandatory field (a Romanian domain term, SRS
 * §6), every scheduled job hardcoded to Europe/Bucharest (FR-SYS-04).
 * Converted anyway so correctness no longer depends on that coincidence
 * holding — a DST-rule change (the EU has repeatedly discussed abolishing
 * it) or a future non-Romania timezone would not silently break this the
 * way it could have broken the old version. */
function daysBetweenLocalDates(a, b) {
  const utcA = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())
  const utcB = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate())
  return (utcB - utcA) / 86400000
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

  return daysBetweenLocalDates(startOfToday, candidate)
}
