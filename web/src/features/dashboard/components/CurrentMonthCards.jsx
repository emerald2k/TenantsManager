import { useTranslation } from 'react-i18next'
import { ChevronRight } from 'lucide-react'
import {
  DueDateLine,
  PaymentBadge,
  RemainingValue,
  ReportBadge,
} from '@/features/dashboard/components/currentMonthCells'

/**
 * The Current-month list as cards — used below ~1100 px (NFR-UX-03, owner
 * decision 2026-08-30). Seven columns cannot stay legible at tablet width, and
 * horizontal scrolling inside a table hides *Remaining to collect*, the number
 * the page exists for. The card stacks property → renter, the two badges, then
 * Remaining and the due date with its consequence line.
 *
 * It deliberately drops **Total due**: of the two money figures only Remaining
 * demands an action, and a card carrying both invites the row subtraction
 * FR-DASH-02b forbids (NFR-UX-03).
 *
 * Same row objects and the same cell renderers as `CurrentMonthTable`
 * (`./currentMonthCells`), so the two layouts never diverge — FR-DASH-02a.
 * The whole card is one tap target with a permanent `›` (NFR-UX-06); `active:`
 * press feedback is global, `hover:` is auto-scoped to `(hover:hover)` by
 * Tailwind so it never latches on touch.
 */
export function CurrentMonthCards({ rows, onRowClick }) {
  const { t, i18n } = useTranslation()

  return (
    <ul className="flex flex-col gap-3">
      {rows.map((row) => (
        <li key={row.propertyId}>
          <button
            type="button"
            onClick={onRowClick ? () => onRowClick(row) : undefined}
            className="flex w-full flex-col gap-3 rounded-xl border border-border bg-card p-4 text-left transition-[transform,background-color,box-shadow] duration-150 hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none active:scale-[0.985] active:bg-muted/60"
          >
            <span className="flex items-start gap-3">
              <span className="min-w-0 flex-1">
                <span className="block font-semibold text-foreground">
                  {row.propertyName}
                </span>
                <span className="block text-sm text-muted-foreground">
                  {row.tenantName}
                </span>
              </span>
              <ChevronRight
                className="mt-0.5 size-5 shrink-0 text-muted-foreground"
                aria-hidden="true"
              />
            </span>

            <span className="flex flex-wrap gap-2">
              <ReportBadge state={row.reportState} />
              <PaymentBadge payment={row.payment} language={i18n.language} />
            </span>

            <span className="flex items-end justify-between gap-3 border-t border-border pt-3">
              <span className="flex flex-col">
                <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  {t('dashboard.currentMonth.columns.remaining')}
                </span>
                <span className="text-base">
                  <RemainingValue row={row} />
                </span>
              </span>
              <span className="text-right text-sm text-foreground">
                <DueDateLine row={row} language={i18n.language} />
              </span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}
