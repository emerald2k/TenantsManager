import { describe, expect, it } from 'vitest'
import {
  DELIVERY_LABEL_KEY,
  NOTIFICATION_WINDOW_MONTHS,
  TYPE_LABEL_KEY,
  formatSentAt,
  sortBySentAtDesc,
  toDate,
  windowCutoff,
  withinWindow,
} from '@/features/notifications/calculations'

// Fast band — pure helpers, no Firestore, no React. The notification-log
// page test (notificationLog.page.test.jsx) covers what the page does with
// these; here we pin the helpers themselves.

const ts = (iso) => ({ toDate: () => new Date(iso) }) // a Firestore Timestamp

describe('windowCutoff', () => {
  it('is 12 months before the given date', () => {
    expect(NOTIFICATION_WINDOW_MONTHS).toBe(12)
    const cut = windowCutoff(new Date('2026-08-30T12:00:00Z'))
    expect(cut.getFullYear()).toBe(2025)
    expect(cut.getMonth()).toBe(7) // August (0-based)
  })
})

describe('toDate', () => {
  it('unwraps a Firestore Timestamp', () => {
    expect(toDate(ts('2026-05-01T00:00:00Z')).toISOString()).toBe(
      '2026-05-01T00:00:00.000Z',
    )
  })
  it('passes a Date through, parses an ISO string and millis', () => {
    const d = new Date('2026-05-01')
    expect(toDate(d)).toBe(d)
    expect(toDate('2026-05-01').getTime()).toBe(d.getTime())
    expect(toDate(d.getTime()).getTime()).toBe(d.getTime())
  })
  it('returns null for a missing or unparseable value', () => {
    expect(toDate(null)).toBeNull()
    expect(toDate(undefined)).toBeNull()
    expect(toDate('not a date')).toBeNull()
  })
})

describe('formatSentAt', () => {
  it('is ISO date + time (admin surfaces show the time — SRS §5.5)', () => {
    // Local time; assert the shape, not a fixed offset-dependent value.
    expect(formatSentAt(new Date(2026, 4, 1, 9, 5))).toBe('2026-05-01 09:05')
  })
  it('renders an em dash for a not-yet-resolved sentAt', () => {
    expect(formatSentAt(null)).toBe('—')
  })
})

describe('sortBySentAtDesc', () => {
  it('orders most-recent first and does not mutate the input', () => {
    const rows = [
      { id: 'a', sentAt: ts('2026-01-01') },
      { id: 'b', sentAt: ts('2026-06-01') },
      { id: 'c', sentAt: ts('2026-03-01') },
    ]
    const sorted = sortBySentAtDesc(rows)
    expect(sorted.map((r) => r.id)).toEqual(['b', 'c', 'a'])
    expect(rows.map((r) => r.id)).toEqual(['a', 'b', 'c'])
  })
  it('puts a row with no sentAt yet at the top — it is the newest', () => {
    const sorted = sortBySentAtDesc([
      { id: 'old', sentAt: ts('2026-01-01') },
      { id: 'fresh' },
    ])
    expect(sorted[0].id).toBe('fresh')
  })
})

describe('withinWindow', () => {
  const from = new Date('2026-08-30T00:00:00Z')
  it('keeps rows inside the 12-month window and drops older ones', () => {
    const kept = withinWindow(
      [
        { id: 'in', sentAt: ts('2026-08-01T00:00:00Z') },
        { id: 'edge', sentAt: ts('2025-08-30T00:00:00Z') },
        { id: 'out', sentAt: ts('2025-08-29T00:00:00Z') },
      ],
      from,
    )
    expect(kept.map((r) => r.id).sort()).toEqual(['edge', 'in'])
  })
  it('keeps a row with no sentAt yet', () => {
    expect(withinWindow([{ id: 'fresh' }], from)).toHaveLength(1)
  })
})

describe('label maps', () => {
  it('cover every FR-NLOG-03 type and every FR-NLOG-05 delivery state', () => {
    expect(Object.keys(TYPE_LABEL_KEY).sort()).toEqual(
      [
        'arrears-reminder',
        'balance-mismatch',
        'contract-expired',
        'contract-expiry',
        'credentials',
        'credentials-resent',
        'daily-heartbeat',
        'payment-recorded',
        'payment-upcoming',
        'report-new',
        'report-preparation',
        'report-updated',
        'tenancy-assigned',
      ].sort(),
    )
    expect(Object.keys(DELIVERY_LABEL_KEY).sort()).toEqual([
      'ERROR',
      'PENDING',
      'PROCESSING',
      'RETRY',
      'SUCCESS',
    ])
  })
})
