/**
 * Pure selection logic for `dailyScheduler` (SRS §7.2), split out from the
 * scheduled trigger itself (sub-stage 3, M6). Each reminder family is a
 * function of (today, current state) — no Firestore, no email, no clock
 * access beyond an injected `now`/`today`. That split is what makes the
 * exhaustive date-arithmetic edge cases (leap years, month-end clamping, the
 * 3-day arrears cycle) testable in the fast band instead of requiring the
 * Firestore/Auth emulator or, worse, waiting for a real 09:00 Europe/Bucharest
 * firing to observe a bug.
 *
 * DATE ARITHMETIC: no date library — none is in functions/package.json
 * (firebase-admin, firebase-functions, zod only) and SRS §2.7 keeps it that
 * way. All dates here are `'YYYY-MM-DD'` strings, compared via `daysBetween`,
 * which converts both sides through `Date.UTC` before subtracting. UTC has no
 * DST, so the difference is always an exact multiple of a day — a local-time
 * millisecond diff would land on 2.958 days across the one night a year
 * Europe/Bucharest's clocks change, silently skipping a day in the arrears
 * 3-day cycle.
 */

/** Today's date in Europe/Bucharest, as `'YYYY-MM-DD'`. `en-CA` is the
 * locale whose default date format already IS ISO (`YYYY-MM-DD`), so no
 * manual reassembly of the formatter's parts is needed. */
function todayInBucharest(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Bucharest',
  }).format(now)
}

/** Whole days from ISO date `isoA` to ISO date `isoB` (negative if `isoB` is
 * earlier). Both sides are converted via `Date.UTC` — never `new Date(iso)`
 * parsed-as-local — so the result is always an exact integer, immune to
 * Europe/Bucharest's DST transitions (see file header). */
function daysBetween(isoA, isoB) {
  const [ay, am, ad] = isoA.split('-').map(Number)
  const [by, bm, bd] = isoB.split('-').map(Number)
  const a = Date.UTC(ay, am - 1, ad)
  const b = Date.UTC(by, bm - 1, bd)
  return (b - a) / 86400000
}

/** Number of days in `year`/`month` (`month` is 1-based). `Date.UTC(year,
 * month, 0)` — passing the 1-based `month` as the (0-based) month argument —
 * lands one calendar month ahead of intent, so day 0 of it rolls back to the
 * last day of the INTENDED (1-based) month. Standard trick, not a bug. */
function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

function pad2(n) {
  return String(n).padStart(2, '0')
}

function toIso(year, month, day) {
  return `${year}-${pad2(month)}-${pad2(day)}`
}

/**
 * FAMILY 1 — arrears reminder (FR-PAY-04, template A4, to the tenant).
 * Fires every 3 days starting on day 3 after the due date, for as long as
 * arrears remain: elapsed 3, 6, 9, ... `currentBalance` must be strictly
 * positive — zero or negative (credit) means nothing is owed.
 */
function shouldSendArrearsReminder({ today, dueDate, currentBalance }) {
  if (!(currentBalance > 0)) return false
  const elapsed = daysBetween(dueDate, today)
  return elapsed >= 3 && elapsed % 3 === 0
}

/**
 * FAMILY 2 — contract expiry reminder (FR-CON-09, template A5, to the
 * admin). Fires on exactly 90, 60, or 30 days before `endDate`. Per
 * FR-CON-08, an already-passed `endDate` triggers nothing — `remaining` is
 * simply never one of the three exact values once it has gone negative.
 */
function shouldSendExpiryReminder({ today, endDate }) {
  const remaining = daysBetween(today, endDate)
  return remaining === 90 || remaining === 60 || remaining === 30
}

/**
 * FAMILY 3 — report preparation reminder (FR-REP-15, template A6, to the
 * admin). Fires `reportReminderDaysBefore` days before the NEXT occurrence
 * of `dueDay`: still ahead this month if `dueDay >= today`'s day-of-month,
 * otherwise next month. That current/next-month decision compares the RAW
 * `dueDay` against today's day-of-month — clamping (below) only applies once
 * the target month is already chosen, to build the actual calendar date.
 *
 * MONTH-END CLAMPING (implementation decision, not in the SRS — flagged
 * here deliberately): `dueDay` is a plain 1-31 integer (SRS §6), but not
 * every month has 31, 30, or even 29 days. A `dueDay` that doesn't exist in
 * the target month is clamped to that month's LAST day — `dueDay=31` in
 * April means April 30; `dueDay=29` in February means the 28th outside a
 * leap year, the 29th inside one.
 */
function shouldSendReportReminder({
  today,
  dueDay,
  reportReminderDaysBefore,
  hasSignedReportThisMonth,
}) {
  if (hasSignedReportThisMonth) return false

  const [year, month, day] = today.split('-').map(Number)

  let targetYear = year
  let targetMonth = month
  if (dueDay < day) {
    targetMonth += 1
    if (targetMonth > 12) {
      targetMonth = 1
      targetYear += 1
    }
  }

  const clampedDay = Math.min(dueDay, daysInMonth(targetYear, targetMonth))
  const nextOccurrence = toIso(targetYear, targetMonth, clampedDay)

  return daysBetween(today, nextOccurrence) === reportReminderDaysBefore
}

module.exports = {
  todayInBucharest,
  daysBetween,
  shouldSendArrearsReminder,
  shouldSendExpiryReminder,
  shouldSendReportReminder,
}
