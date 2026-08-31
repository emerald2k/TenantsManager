import { z } from 'zod'

/**
 * Validation + pure math for the deposit-settlement form (FR-CON-10/11/12,
 * M8 stage 6). A settlement is restoration work only — never rent arrears
 * (FR-CON-11) — so this file never touches `currentBalance`.
 *
 * The attachment shape is IDENTICAL to a report cost line's
 * (`reports/schema.js`'s `attachmentSchema`): exactly one of `path` (already
 * persisted) or `file` (picked, not yet uploaded) at a time. Duplicated
 * rather than imported — this is a small, stable shape, and importing it
 * would couple the tenants feature to the reports feature's internals for a
 * handful of lines (the KYC-schema duplication in CLAUDE.md §7 is the same
 * call: shared trivia is not worth cross-feature coupling).
 */

const REQUIRED = 'reports.errors.required'

const required = () =>
  z.string({ error: REQUIRED }).trim().min(1, { error: REQUIRED })

const blankToZero = (value) =>
  value === '' || (typeof value === 'number' && Number.isNaN(value)) ? 0 : value
const amountField = () => z.preprocess(blankToZero, z.number())

const settlementAttachmentSchema = z.object({
  name: required(),
  type: z.enum(['image', 'pdf', 'doc'], { error: REQUIRED }),
  path: z.string().optional(),
  file: z.instanceof(File).optional(),
})

const settlementItemSchema = z.object({
  description: required(),
  amount: amountField(),
  attachments: z.array(settlementAttachmentSchema).optional(),
})

export const depositSettlementSchema = z.object({
  items: z.array(settlementItemSchema),
})

/**
 * The FR-CON-10 math: `deducted` sums the restoration lines, `toReturn` and
 * `ownerBears` split the gap against `securityDeposit` — never both nonzero
 * at once. `ownerBears` is deliberately NEVER folded into a tenant debt
 * (FR-CON-10's own text): it is a cost the owner bears, full stop.
 */
export function computeDepositSettlement(items, securityDeposit) {
  const deducted = (items ?? []).reduce(
    (sum, item) => sum + (Number(item.amount) || 0),
    0,
  )
  const deposit = securityDeposit ?? 0
  return {
    deducted,
    toReturn: Math.max(deposit - deducted, 0),
    ownerBears: Math.max(deducted - deposit, 0),
  }
}

/** Every attachment path on an already-saved settlement — the "before"
 * snapshot for orphan cleanup on edit, same role as reports/attachments.js's
 * `collectAttachmentPaths`. `undefined` (no settlement yet) returns `[]`. */
export function collectSettlementAttachmentPaths(depositSettlement) {
  return (depositSettlement?.items ?? []).flatMap((item) =>
    (item.attachments ?? [])
      .map((attachment) => attachment.path)
      .filter(Boolean),
  )
}
