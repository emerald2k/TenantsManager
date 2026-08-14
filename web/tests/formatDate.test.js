import { describe, expect, it } from 'vitest'
import { Timestamp } from 'firebase/firestore'
import { formatFullDate } from '@/lib/formatDate'

describe('formatFullDate', () => {
  it('formats a Firestore Timestamp in Romanian', () => {
    const timestamp = Timestamp.fromDate(new Date(2026, 0, 31))
    expect(formatFullDate(timestamp, 'ro')).toBe('31 ianuarie 2026')
  })

  it('formats a Firestore Timestamp in English', () => {
    const timestamp = Timestamp.fromDate(new Date(2026, 0, 31))
    expect(formatFullDate(timestamp, 'en')).toBe('January 31, 2026')
  })

  it("formats a 'YYYY-MM-DD' string in Romanian", () => {
    expect(formatFullDate('2026-07-10', 'ro')).toBe('10 iulie 2026')
  })

  it("formats a 'YYYY-MM-DD' string in English", () => {
    expect(formatFullDate('2026-07-10', 'en')).toBe('July 10, 2026')
  })
})
