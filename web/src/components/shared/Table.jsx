import { cn } from '@/lib/utils'

/**
 * The one admin table component (SRS §5.5: "the admin tables — properties,
 * renters, current month, payments, notifications — share one table
 * component: the same column, sort, empty and loading behaviour rather than
 * five hand-built variants"). M8 stage 10 converts the three pages that
 * exist today (properties, tenants, current month); payments (stage 12) and
 * notifications (stage 14) adopt it when their pages are built.
 *
 * Below 768px it renders as a stacked card list, one card per row — a
 * column-config array, not the mockup's CSS `display:block` trick, because
 * the config is what makes the card's "declared primary line" (§5.5)
 * expressible: exactly one column (`primary: true`) becomes the card's
 * unlabelled headline; every other column becomes a labelled line. Sort,
 * loading, empty and error states stay the CALLER's concern — this
 * component only ever receives the rows already meant to be shown.
 *
 * NOT used by `ReportSummaryView`, deliberately: that component is pinned
 * light (NFR-UX-05) and its own hand-rolled table carries no admin-shell
 * styling at all. Pulling it onto this component would put this file in
 * `ReportSummaryView`'s import graph, which `reportSummaryView.
 * forceLight.test.js`'s G1 scan would then have to walk too — and unlike
 * `ReportSummaryView`, this component is legitimately used on themed admin
 * pages and its own responsive rules would need re-auditing for `dark:`
 * tokens it has no reason to avoid. Keep them apart.
 *
 * @param columns [{ key, header, render(row), align?: 'left'|'right',
 *   primary?: boolean, mobileLabel? }] — exactly one column should set
 *   `primary`; its header is never shown (on screen or in the card view).
 *   `header` (and `mobileLabel`, when given) must be a plain STRING, not a
 *   node: the card view paints the label via CSS `content: attr(...)`, not
 *   a DOM text node — deliberately, so it never becomes part of a cell's
 *   `textContent` (a real risk: jsdom does not compute the `hidden`
 *   utility's actual visibility, so a rendered label span would silently
 *   leak into `cell.textContent` in every test, sighted or not, that reads
 *   it — caught exactly that way converting `TenantsListPage`'s own tests).
 * @param rows the already-filtered, already-sorted rows to render.
 * @param getRowKey (row) => string
 * @param onRowClick optional (row) => void — makes a row keyboard- and
 *   click-activatable, matching the existing per-page row-click convention.
 * @param isRowClickable optional (row) => boolean, defaults to `true` for
 *   every row when `onRowClick` is set. Lets a page mix clickable rows
 *   (e.g. an existing tenant) with inert ones (e.g. an in-progress draft
 *   with its own inline action buttons instead) inside one table.
 * @param rowClassName optional (row) => string, merged onto each `<tr>`.
 */
export function Table({
  columns,
  rows,
  getRowKey,
  onRowClick,
  isRowClickable = () => true,
  rowClassName,
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border max-[768px]:overflow-visible max-[768px]:rounded-none max-[768px]:border-0">
      <table className="w-full text-left text-sm max-[768px]:block">
        <thead className="border-b border-border bg-muted/50 max-[768px]:hidden">
          <tr className="text-xs text-muted-foreground">
            {columns.map((column) => (
              <th
                key={column.key}
                className={cn(
                  'px-4 py-2 font-medium',
                  column.align === 'right' && 'text-right',
                )}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="max-[768px]:block">
          {rows.map((row) => {
            const key = getRowKey(row)
            const clickable = Boolean(onRowClick) && isRowClickable(row)
            return (
              <tr
                key={key}
                onClick={clickable ? () => onRowClick(row) : undefined}
                onKeyDown={
                  clickable
                    ? (event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault()
                          onRowClick(row)
                        }
                      }
                    : undefined
                }
                tabIndex={clickable ? 0 : undefined}
                className={cn(
                  'border-b border-border last:border-0',
                  clickable &&
                    'cursor-pointer hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none',
                  'max-[768px]:mb-3 max-[768px]:block max-[768px]:rounded-lg max-[768px]:border max-[768px]:border-border max-[768px]:p-4 max-[768px]:last:mb-0',
                  rowClassName?.(row),
                )}
              >
                {columns.map((column) => (
                  <td
                    key={column.key}
                    data-mobile-label={
                      column.primary
                        ? undefined
                        : (column.mobileLabel ?? column.header)
                    }
                    className={cn(
                      'px-4 py-3',
                      column.align === 'right' && 'text-right',
                      column.primary
                        ? 'font-medium text-foreground'
                        : 'text-muted-foreground',
                      'max-[768px]:flex max-[768px]:items-center max-[768px]:justify-between max-[768px]:gap-3 max-[768px]:px-0 max-[768px]:py-1.5',
                      !column.primary &&
                        'max-[768px]:before:content-[attr(data-mobile-label)] max-[768px]:before:text-xs max-[768px]:before:font-normal max-[768px]:before:text-muted-foreground',
                      column.primary &&
                        'max-[768px]:mb-2 max-[768px]:block max-[768px]:border-b max-[768px]:border-border max-[768px]:pb-2 max-[768px]:text-base',
                    )}
                  >
                    {column.render(row)}
                  </td>
                ))}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
