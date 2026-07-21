import { describe, expect, it } from 'vitest'
import { filterByText } from '@/lib/filterByText'

// A pure, framework-free filter shared by the tenant list (name+phone+email,
// FR-TEN-13) and the property list (name+address, FR-PROP-07). No React, no
// Firestore — just deterministic substring matching, so it is trivially
// testable and reusable at both call sites.

const people = [
  { id: 'a', name: 'Ana Pop', phone: '0712000111', email: 'ana@example.com' },
  { id: 'b', name: 'Barbu Ion', phone: '0722333444', email: 'barbu@mail.ro' },
  { id: 'c', name: 'Cezar', phone: null, email: undefined },
]

const fields = (p) => [p.name, p.phone, p.email]

describe('filterByText', () => {
  it('returns every item unchanged when the query is empty or whitespace', () => {
    expect(filterByText(people, '', fields)).toEqual(people)
    expect(filterByText(people, '   ', fields)).toEqual(people)
  })

  it('matches on a substring, case-insensitively, across all provided fields', () => {
    // by name
    expect(filterByText(people, 'ana', fields).map((p) => p.id)).toEqual(['a'])
    // by name, different case
    expect(filterByText(people, 'BARBU', fields).map((p) => p.id)).toEqual([
      'b',
    ])
    // by email domain (a field other than name)
    expect(filterByText(people, 'mail.ro', fields).map((p) => p.id)).toEqual([
      'b',
    ])
    // by phone fragment
    expect(filterByText(people, '2333', fields).map((p) => p.id)).toEqual(['b'])
  })

  it('returns every matching item, not just the first', () => {
    // "0" appears in both phone numbers; "example" in one email.
    expect(filterByText(people, '07', fields).map((p) => p.id)).toEqual([
      'a',
      'b',
    ])
  })

  it('returns ZERO items when nothing matches (anti-vacuity guard)', () => {
    // If the filter were removed (always return all), this would fail — that is
    // the point: it proves the filter actually excludes non-matches.
    expect(filterByText(people, 'zzz-nothing', fields)).toEqual([])
  })

  it('skips null/undefined fields without throwing', () => {
    // Cezar has null phone and undefined email — a raw `.includes` would throw.
    expect(filterByText(people, 'cezar', fields).map((p) => p.id)).toEqual([
      'c',
    ])
  })

  it('trims the query before matching', () => {
    expect(filterByText(people, '  ana  ', fields).map((p) => p.id)).toEqual([
      'a',
    ])
  })
})
