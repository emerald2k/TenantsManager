import { useMediaQuery } from '@/lib/useMediaQuery'
import { CurrentMonthCards } from '@/features/dashboard/components/CurrentMonthCards'
import { CurrentMonthTable } from '@/features/dashboard/components/CurrentMonthTable'

/**
 * Picks the Current-month layout by viewport width: the seven-column table
 * above ~1100 px, cards at or below it (NFR-UX-03, owner decision 2026-08-30 —
 * a named exception to "desktop and tablet share one layout", scoped to this
 * one table). Both take the same `rows` (from `buildCurrentMonthRows`) and the
 * same `onRowClick`, so `/admin` and `/admin/current-month` stay identical at
 * every width (FR-DASH-02a).
 *
 * The 1100 px boundary is deliberately NOT the shared `Table`'s own 768 px
 * card mode — that stays for the other four admin tables; this table needs to
 * card earlier because it is the only one with seven columns and a money
 * column that must never be scrolled off-screen.
 *
 * With no `matchMedia` (jsdom) the query is false → the table renders, which
 * is what the fast band already asserts; a test wanting the cards stubs
 * `matchMedia`.
 */
export function CurrentMonthList({ rows, onRowClick }) {
  const isNarrow = useMediaQuery('(max-width: 1100px)')
  const View = isNarrow ? CurrentMonthCards : CurrentMonthTable
  return <View rows={rows} onRowClick={onRowClick} />
}
