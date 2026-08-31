import { describe, expect, it } from 'vitest'
import {
  collectSettlementAttachmentPaths,
  computeDepositSettlement,
  depositSettlementSchema,
} from '@/features/tenants/depositSettlementSchema'

// Pure functions, tested in isolation — same convention as
// dueDayCountdown.js / reports/schema.js (CLAUDE.md §7).

describe('computeDepositSettlement (FR-CON-10)', () => {
  it('reproduces the seed’s own worked example exactly', () => {
    // functions/scripts/seed.js — endedTenancy(): one 200-lei restoration
    // line against a 1800-lei deposit -> toReturn 1600, ownerBears 0. The
    // fixture IS the spec's own worked example — this proves the formula
    // matches it, not just that the formula is internally consistent.
    const result = computeDepositSettlement(
      [{ description: 'Curățenie generală la predare', amount: 200 }],
      1800,
    )

    expect(result).toEqual({ deducted: 200, toReturn: 1600, ownerBears: 0 })
  })

  it('produces ownerBears, never a negative toReturn, when deductions exceed the deposit', () => {
    const result = computeDepositSettlement(
      [{ description: 'Reparații majore', amount: 2500 }],
      1800,
    )

    expect(result).toEqual({ deducted: 2500, toReturn: 0, ownerBears: 700 })
  })

  it('reproduces the seed’s own ownerBears worked example exactly', () => {
    // functions/scripts/seed.js — handoverOutTenancy(): the seed's ONE
    // ownerBears>0 case, added at Bogdan's explicit instruction rather than
    // a sixth seed graph — a 2800-lei restoration line against a 2100-lei
    // deposit -> toReturn 0, ownerBears 700.
    const result = computeDepositSettlement(
      [
        {
          description: 'Refacere pardoseală și zugrăveli după degradări',
          amount: 2800,
        },
      ],
      2100,
    )

    expect(result).toEqual({ deducted: 2800, toReturn: 0, ownerBears: 700 })
  })

  it('sums multiple restoration lines before comparing against the deposit', () => {
    const result = computeDepositSettlement(
      [
        { description: 'Curățenie', amount: 200 },
        { description: 'Vopsit perete', amount: 350 },
      ],
      1800,
    )

    expect(result).toEqual({ deducted: 550, toReturn: 1250, ownerBears: 0 })
  })

  it('treats a missing securityDeposit as 0 — every deduction becomes ownerBears', () => {
    const result = computeDepositSettlement(
      [{ description: 'Curățenie', amount: 100 }],
      undefined,
    )

    expect(result).toEqual({ deducted: 100, toReturn: 0, ownerBears: 100 })
  })

  it('an empty item list against a real deposit returns it whole, as toReturn', () => {
    const result = computeDepositSettlement([], 1800)

    expect(result).toEqual({ deducted: 0, toReturn: 1800, ownerBears: 0 })
  })

  it('never returns both toReturn and ownerBears positive at once', () => {
    const cases = [
      [[{ amount: 0 }], 1800],
      [[{ amount: 1800 }], 1800],
      [[{ amount: 1801 }], 1800],
    ]
    for (const [items, deposit] of cases) {
      const result = computeDepositSettlement(items, deposit)
      expect(result.toReturn === 0 || result.ownerBears === 0).toBe(true)
    }
  })
})

describe('collectSettlementAttachmentPaths', () => {
  it('flattens every attachment path across every item', () => {
    const paths = collectSettlementAttachmentPaths({
      items: [
        {
          description: 'Curățenie',
          amount: 200,
          attachments: [{ path: 'a.pdf' }, { path: 'b.pdf' }],
        },
        {
          description: 'Vopsit',
          amount: 100,
          attachments: [{ path: 'c.pdf' }],
        },
      ],
    })

    expect(paths).toEqual(['a.pdf', 'b.pdf', 'c.pdf'])
  })

  it('returns [] for an absent settlement (not yet completed)', () => {
    expect(collectSettlementAttachmentPaths(undefined)).toEqual([])
  })

  it('skips a pending (file-only, no path) attachment — nothing to clean up yet', () => {
    const paths = collectSettlementAttachmentPaths({
      items: [
        {
          description: 'Curățenie',
          amount: 200,
          attachments: [{ name: 'pending.pdf', file: new File([], 'p.pdf') }],
        },
      ],
    })

    expect(paths).toEqual([])
  })
})

describe('depositSettlementSchema', () => {
  it('accepts a valid item list', () => {
    const result = depositSettlementSchema.safeParse({
      items: [{ description: 'Curățenie', amount: 200, attachments: [] }],
    })

    expect(result.success).toBe(true)
  })

  it('rejects a line with no description (NFR-VAL-01: presence, not format)', () => {
    const result = depositSettlementSchema.safeParse({
      items: [{ description: '', amount: 200, attachments: [] }],
    })

    expect(result.success).toBe(false)
  })

  it('coerces a blank/NaN amount to 0 rather than failing (same discipline as reports/schema.js)', () => {
    const result = depositSettlementSchema.safeParse({
      items: [{ description: 'Curățenie', amount: '', attachments: [] }],
    })

    expect(result.success).toBe(true)
    expect(result.data.items[0].amount).toBe(0)
  })

  it('accepts an empty item list — a settlement with nothing to deduct is valid', () => {
    const result = depositSettlementSchema.safeParse({ items: [] })

    expect(result.success).toBe(true)
  })
})
