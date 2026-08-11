import { describe, expect, it } from 'vitest'
import {
  todayInBucharest,
  daysBetween,
  dueDateInMonth,
  nextOccurrenceOfDueDay,
  shouldSendArrearsReminder,
  shouldSendExpiryReminder,
  shouldSendReportReminder,
} from '../src/schedulerLogic.js'

// Pure-function tests — no emulator, no Firestore, no I/O. Sub-stage 2 of M6:
// the three reminder families are functions of (today, current state), wired
// up to Firestore + email only in sub-stage 3. This file runs fine under
// `npm run test:emulator` (the glob picks up every test/**/*.test.js file
// regardless), but also stands alone with plain `vitest run`.

describe('todayInBucharest', () => {
  it('returns the ISO date for a UTC instant that is still the same day in Bucharest', () => {
    // 10:00 UTC in summer (Bucharest = UTC+3) is 13:00 local — same day.
    expect(todayInBucharest(new Date('2026-07-14T10:00:00Z'))).toBe(
      '2026-07-14',
    )
  })

  it('rolls over to the NEXT day in Bucharest for a late-UTC summer instant (22:30 UTC -> 01:30 local)', () => {
    expect(todayInBucharest(new Date('2026-07-14T22:30:00Z'))).toBe(
      '2026-07-15',
    )
  })

  it('rolls over to the next day in winter too (Bucharest = UTC+2, 22:30 UTC -> 00:30 local)', () => {
    expect(todayInBucharest(new Date('2026-01-14T22:30:00Z'))).toBe(
      '2026-01-15',
    )
  })
})

describe('daysBetween', () => {
  it('counts whole days between two ISO dates', () => {
    expect(daysBetween('2026-08-01', '2026-08-04')).toBe(3)
  })

  it('is zero for the same date', () => {
    expect(daysBetween('2026-08-01', '2026-08-01')).toBe(0)
  })

  it('is negative when the second date is earlier', () => {
    expect(daysBetween('2026-08-04', '2026-08-01')).toBe(-3)
  })

  it('is an exact integer across the Bucharest spring-forward DST change (last Sunday of March)', () => {
    // 2026-03-29 is the last Sunday of March 2026 — clocks jump forward.
    expect(daysBetween('2026-03-27', '2026-03-31')).toBe(4)
  })

  it('is an exact integer across the Bucharest fall-back DST change (last Sunday of October)', () => {
    // 2026-10-25 is the last Sunday of October 2026 — clocks jump back.
    expect(daysBetween('2026-10-23', '2026-10-27')).toBe(4)
  })

  it('handles a month boundary correctly', () => {
    expect(daysBetween('2026-01-30', '2026-02-02')).toBe(3)
  })

  it('handles a leap-year February correctly', () => {
    expect(daysBetween('2028-02-28', '2028-03-01')).toBe(2) // 2028 is a leap year
    expect(daysBetween('2026-02-28', '2026-03-01')).toBe(1) // 2026 is not
  })
})

describe('dueDateInMonth', () => {
  it('returns the exact date for a valid dueDay in a normal month', () => {
    expect(dueDateInMonth(2026, 6, 15)).toBe('2026-06-15')
  })

  it('clamps dueDay=31 to April 30 (April has 30 days)', () => {
    expect(dueDateInMonth(2026, 4, 31)).toBe('2026-04-30')
  })

  it('clamps dueDay=31 to Feb 28 in a NON-leap year', () => {
    expect(dueDateInMonth(2026, 2, 31)).toBe('2026-02-28')
  })

  it('clamps dueDay=29 to Feb 29 in a LEAP year — 29 is valid there, no clamp needed', () => {
    expect(dueDateInMonth(2028, 2, 29)).toBe('2028-02-29')
  })

  it('handles dueDay=1 — the first day of the month', () => {
    expect(dueDateInMonth(2026, 7, 1)).toBe('2026-07-01')
  })
})

describe('nextOccurrenceOfDueDay', () => {
  it("returns THIS month's date when dueDay is still ahead of today", () => {
    expect(nextOccurrenceOfDueDay('2026-08-10', 15)).toBe('2026-08-15')
  })

  it('rolls over to NEXT month when dueDay has already passed', () => {
    expect(nextOccurrenceOfDueDay('2026-08-10', 5)).toBe('2026-09-05')
  })

  // Documents the CURRENT behavior, not a requirement pulled from the SRS:
  // `dueDay < day` is false when they're equal, so the current-month branch
  // is taken and the function returns TODAY itself, not next month's date.
  // If this choice ever changes, this test is what will catch it.
  it('when today IS the dueDay, resolves to TODAY (current-month branch, not next month)', () => {
    expect(nextOccurrenceOfDueDay('2026-08-15', 15)).toBe('2026-08-15')
  })

  it('rolls over the YEAR boundary — December to January of the next year', () => {
    expect(nextOccurrenceOfDueDay('2026-12-20', 5)).toBe('2027-01-05')
  })
})

describe('shouldSendArrearsReminder (FR-PAY-04, A4, to the tenant)', () => {
  const dueDate = '2026-08-01'

  it.each([
    [0, false],
    [1, false],
    [2, false],
    [3, true],
    [4, false],
    [5, false],
    [6, true],
  ])('elapsed=%i days after due date -> %s', (elapsedDays, expected) => {
    const today = addDays(dueDate, elapsedDays)
    expect(
      shouldSendArrearsReminder({ today, dueDate, currentBalance: 100 }),
    ).toBe(expected)
  })

  it('is false when currentBalance is negative (credit)', () => {
    expect(
      shouldSendArrearsReminder({
        today: addDays(dueDate, 3),
        dueDate,
        currentBalance: -50,
      }),
    ).toBe(false)
  })

  it('is false when currentBalance is exactly zero', () => {
    expect(
      shouldSendArrearsReminder({
        today: addDays(dueDate, 3),
        dueDate,
        currentBalance: 0,
      }),
    ).toBe(false)
  })

  it('is false when the due date is still in the future', () => {
    expect(
      shouldSendArrearsReminder({
        today: addDays(dueDate, -5),
        dueDate,
        currentBalance: 100,
      }),
    ).toBe(false)
  })
})

describe('shouldSendExpiryReminder (FR-CON-09, A5, to the admin)', () => {
  const today = '2026-08-01'

  it.each([
    [90, true],
    [89, false],
    [91, false],
    [60, true],
    [61, false],
    [59, false],
    [30, true],
    [31, false],
    [29, false],
  ])('remaining=%i days -> %s', (remainingDays, expected) => {
    const endDate = addDays(today, remainingDays)
    expect(shouldSendExpiryReminder({ today, endDate })).toBe(expected)
  })

  it('is false when the contract already expired (FR-CON-08: passing endDate triggers nothing)', () => {
    expect(
      shouldSendExpiryReminder({ today, endDate: addDays(today, -10) }),
    ).toBe(false)
  })
})

describe('shouldSendReportReminder (FR-REP-15, A6, to the admin)', () => {
  it('is false whenever a signed report already exists this month, regardless of everything else', () => {
    expect(
      shouldSendReportReminder({
        today: '2026-08-01',
        dueDay: 1,
        reportReminderDaysBefore: 3,
        hasSignedReportThisMonth: true,
      }),
    ).toBe(false)
  })

  it('fires reportReminderDaysBefore days before a dueDay still ahead in the CURRENT month', () => {
    // dueDay=15, today=2026-08-12 -> next occurrence 2026-08-15, 3 days away.
    expect(
      shouldSendReportReminder({
        today: '2026-08-12',
        dueDay: 15,
        reportReminderDaysBefore: 3,
        hasSignedReportThisMonth: false,
      }),
    ).toBe(true)
  })

  it('does NOT fire on a day that is not exactly reportReminderDaysBefore away', () => {
    expect(
      shouldSendReportReminder({
        today: '2026-08-10',
        dueDay: 15,
        reportReminderDaysBefore: 3,
        hasSignedReportThisMonth: false,
      }),
    ).toBe(false)
  })

  it('rolls over to NEXT month when dueDay has already passed this month', () => {
    // dueDay=5, today=2026-08-10 -> 10 > 5, already past for August, so the
    // next occurrence is 2026-09-05, NOT anything reachable within August.
    // Aug 10 -> Sep 5 is 26 days (21 remaining in August + 5 into September).
    expect(
      shouldSendReportReminder({
        today: '2026-08-10',
        dueDay: 5,
        reportReminderDaysBefore: 26,
        hasSignedReportThisMonth: false,
      }),
    ).toBe(true)
    // The SAME today/dueDay must NOT fire at reportReminderDaysBefore=3 —
    // that would only happen if the implementation wrongly treated dueDay=5
    // as still reachable inside August itself (it is not: day 10 is past it).
    expect(
      shouldSendReportReminder({
        today: '2026-08-10',
        dueDay: 5,
        reportReminderDaysBefore: 3,
        hasSignedReportThisMonth: false,
      }),
    ).toBe(false)
  })

  it('clamps dueDay=31 to the last day of a 30-day month (April)', () => {
    // April has 30 days -> next occurrence is 2026-04-30.
    // reportReminderDaysBefore=3 -> fires on 2026-04-27.
    expect(
      shouldSendReportReminder({
        today: '2026-04-27',
        dueDay: 31,
        reportReminderDaysBefore: 3,
        hasSignedReportThisMonth: false,
      }),
    ).toBe(true)
    // It must NOT fire on the 28th (which would be the case if the
    // implementation wrongly rolled 31 into an invalid/next-month date).
    expect(
      shouldSendReportReminder({
        today: '2026-04-28',
        dueDay: 31,
        reportReminderDaysBefore: 3,
        hasSignedReportThisMonth: false,
      }),
    ).toBe(false)
  })

  it('clamps dueDay=29 to Feb 28 in a NON-leap year', () => {
    // 2026 is not a leap year -> Feb has 28 days -> next occurrence 2026-02-28.
    expect(
      shouldSendReportReminder({
        today: '2026-02-25',
        dueDay: 29,
        reportReminderDaysBefore: 3,
        hasSignedReportThisMonth: false,
      }),
    ).toBe(true)
  })

  it('clamps dueDay=29 to Feb 29 in a LEAP year', () => {
    // 2028 is a leap year -> Feb has 29 days -> next occurrence 2028-02-29.
    expect(
      shouldSendReportReminder({
        today: '2028-02-26',
        dueDay: 29,
        reportReminderDaysBefore: 3,
        hasSignedReportThisMonth: false,
      }),
    ).toBe(true)
    // One day earlier is 4 days from the occurrence, not 3 — must not fire.
    expect(
      shouldSendReportReminder({
        today: '2028-02-25',
        dueDay: 29,
        reportReminderDaysBefore: 3,
        hasSignedReportThisMonth: false,
      }),
    ).toBe(false)
  })
})

// Test-only helper — NOT exported by schedulerLogic.js. Deliberately built on
// daysBetween's inverse via plain UTC arithmetic, independent of whatever
// internal date-math schedulerLogic.js ends up using, so it cannot mask a
// bug shared between production and test code.
function addDays(iso, n) {
  const [y, m, d] = iso.split('-').map(Number)
  const ms = Date.UTC(y, m - 1, d) + n * 86400000
  const dt = new Date(ms)
  const pad = (v) => String(v).padStart(2, '0')
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`
}
