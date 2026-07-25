/**
 * Romanian money format (NFR-LOC-02): "1.234,56 lei". First implementation of
 * this rule in the app — isolated here, for readonly display only (the report
 * form's editable amount inputs stay plain `type="number"`, like every other
 * numeric input in the app; only the computed/reference amounts are formatted).
 */
export function formatCurrency(amount) {
  const value = Number(amount) || 0
  const formatted = new Intl.NumberFormat('ro-RO', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)
  return `${formatted} lei`
}
