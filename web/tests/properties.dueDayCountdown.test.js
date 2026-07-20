import { describe, expect, it } from 'vitest'
import { computeDaysUntilDueDay } from '@/features/properties/dueDayCountdown'

// FR-PROP-11: days remaining until the NEXT occurrence of the tenancy's dueDay —
// a pure calendar calculation, pinned edge-case semantics (advisor review,
// Sub-stage E):
//   - today IS the due day → 0 (not a full 30-day cycle)
//   - dueDay > days in the target month → clamped to the month's last day
//     (still valid: dueDay's own schema bound is 1-31, independent of any given
//     month's actual length)
//   - dueDay < 1, or not a number at all → null (hidden, not a crash or a wrong
//     number)
//
// SUB-STAGE E, TYPE CORRECTION: `dueDay` is now a real NUMBER everywhere upstream
// (schema.js, kyc.js, seed.js) — this test file's inputs changed from string
// literals ('5', '31', '30', '0', '-3') to numbers (5, 31, 30, 0, -3) to match.
// The three "obviously invalid" cases ('abc', '', undefined) are UNCHANGED
// deliberately: they still prove the function stays defensive against a
// non-number ever reaching it (bad data, a stale draft, etc.) rather than
// crashing — `parseInt`-based string coercion is gone, but the null-on-invalid
// contract is not.

describe('computeDaysUntilDueDay (FR-PROP-11)', () => {
  it('returns 0 when today IS the due day', () => {
    const today = new Date(2026, 6, 5) // 2026-07-05
    expect(computeDaysUntilDueDay(5, today)).toBe(0)
  })

  it('counts forward to the due day later this month', () => {
    const today = new Date(2026, 6, 1) // 2026-07-01
    expect(computeDaysUntilDueDay(5, today)).toBe(4)
  })

  it('rolls over to next month when the due day already passed this month', () => {
    const today = new Date(2026, 6, 10) // 2026-07-10, dueDay 5 already passed
    // Next occurrence: 2026-08-05 → 26 days away.
    expect(computeDaysUntilDueDay(5, today)).toBe(26)
  })

  it('clamps a dueDay beyond the current month length (e.g. 31 in a 30-day month)', () => {
    const today = new Date(2026, 8, 25) // 2026-09-25 (September has 30 days)
    // dueDay 31 clamps to Sept 30 → 5 days away.
    expect(computeDaysUntilDueDay(31, today)).toBe(5)
  })

  it('clamps against a non-leap February when rolling into next month', () => {
    const today = new Date(2027, 0, 31) // 2027-01-31 (dueDay 30 already passed in Jan)
    // 2027 is not a leap year — Feb has 28 days, so dueDay 30 clamps to Feb 28,
    // 28 days from Jan 31.
    expect(computeDaysUntilDueDay(30, today)).toBe(28)
  })

  it('rolls over the year boundary (December → January)', () => {
    const today = new Date(2026, 11, 20) // 2026-12-20, dueDay 5 already passed
    // Next occurrence: 2027-01-05 → 16 days away.
    expect(computeDaysUntilDueDay(5, today)).toBe(16)
  })

  it('returns null for a non-numeric dueDay (defensive — bad/stale data)', () => {
    expect(computeDaysUntilDueDay('abc', new Date(2026, 6, 1))).toBeNull()
    expect(computeDaysUntilDueDay('', new Date(2026, 6, 1))).toBeNull()
    expect(computeDaysUntilDueDay(undefined, new Date(2026, 6, 1))).toBeNull()
    // A numeric-LOOKING string is no longer coerced — the source is a number
    // everywhere now, so a string here means something upstream is wrong.
    expect(computeDaysUntilDueDay('5', new Date(2026, 6, 1))).toBeNull()
  })

  it('returns null for a dueDay below 1', () => {
    expect(computeDaysUntilDueDay(0, new Date(2026, 6, 1))).toBeNull()
    expect(computeDaysUntilDueDay(-3, new Date(2026, 6, 1))).toBeNull()
  })
})
