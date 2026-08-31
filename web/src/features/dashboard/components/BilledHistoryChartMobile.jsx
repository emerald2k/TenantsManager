import { useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { formatCurrency } from '@/lib/formatCurrency'

/**
 * FR-DASH-09 / FR-DASH-09b — the 12-month Billed history on the phone
 * (NFR-UX-03). Recharts is the wrong tool here: `ResponsiveContainer`
 * measures its container, not `width: max-content` content, so it fights an
 * `overflow-x:auto` wrapper, and per-month scroll-snap, open-on-current-month
 * and a persistent tap-updated band are all scroll/DOM behaviour it does not
 * expose. `billedHistory()` already returns exactly a bar strip's shape, so
 * there is no data work — the same rows the desktop chart draws.
 *
 * ONE series, Billed. The mockup draws two bars per month and a two-figure
 * band ("x încasat din y facturați"); FR-DASH-09b declined the Collected
 * series and `docs/design/README.md` records the mockup as stale here. One
 * bar, and the band states one figure.
 *
 * A phone has no hover, so the values live in a persistent band under the
 * chart that updates on tap/focus, never in a tooltip. The strip opens
 * scrolled to the current month (last, since `billedHistory` is oldest-first)
 * and that month starts selected.
 *
 * @param data rows from `billedHistory(...)`: { month, year, label, billed,
 *   isCurrent }, oldest first.
 * @param hasSignedReports whether ANY signed report exists in the window —
 *   distinguishes "nothing billed in 12 months" from FR-DASH-10's empty state.
 */
export function BilledHistoryChartMobile({ data, hasSignedReports }) {
  const { t, i18n } = useTranslation()
  const scrollerRef = useRef(null)
  const [selectedIndex, setSelectedIndex] = useState(() => {
    const current = data.findIndex((row) => row.isCurrent)
    return current === -1 ? Math.max(0, data.length - 1) : current
  })

  useLayoutEffect(() => {
    // Only on mount — later selections must not yank the scroll position, so
    // `selectedIndex` is deliberately not a dependency (its mount value is
    // the current month and never changes identity here).
    const node = scrollerRef.current?.querySelector('[data-selected="true"]')
    // jsdom implements scrollIntoView as a no-op; optional-chained anyway.
    node?.scrollIntoView?.({ inline: 'center', block: 'nearest' })
  }, [])

  const asOf = new Intl.DateTimeFormat(
    i18n.language === 'ro' ? 'ro-RO' : 'en-US',
    { dateStyle: 'long', timeStyle: 'short' },
  ).format(new Date())

  if (!hasSignedReports) {
    return (
      <div className="rounded-lg border border-border bg-card p-6">
        <h2 className="text-base font-semibold text-foreground">
          {t('dashboard.history.title')}
        </h2>
        <p className="mt-4 text-sm text-muted-foreground">
          {t('dashboard.history.empty')}
        </p>
      </div>
    )
  }

  const maxBilled = Math.max(...data.map((row) => row.billed), 0)
  const selected = data[selectedIndex] ?? data[data.length - 1]

  return (
    <div className="rounded-lg border border-border bg-card p-6">
      <h2 className="text-base font-semibold text-foreground">
        {t('dashboard.history.title')}
      </h2>
      <p className="mt-1 text-xs text-muted-foreground">
        {t('dashboard.history.mobileHint')}
      </p>

      <div
        ref={scrollerRef}
        className="mt-4 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        <div className="flex h-44 w-max items-end gap-3 pb-6">
          {data.map((row, index) => {
            const isSelected = index === selectedIndex
            const heightPct =
              maxBilled > 0 && row.billed > 0
                ? Math.max(3, (row.billed / maxBilled) * 100)
                : 0
            return (
              <button
                key={`${row.year}-${row.month}`}
                type="button"
                data-selected={isSelected ? 'true' : undefined}
                aria-pressed={isSelected}
                aria-label={t('dashboard.history.barLabel', {
                  month: row.label,
                  year: row.year,
                  amount: formatCurrency(row.billed),
                })}
                onClick={() => setSelectedIndex(index)}
                className="relative flex h-full w-10 flex-col items-center justify-end gap-1 focus-visible:outline-none"
              >
                <span
                  style={{ height: `${heightPct}%` }}
                  className={`w-3.5 rounded-t-sm ${
                    row.isCurrent
                      ? 'bg-chart-2/45 outline outline-1 outline-chart-2'
                      : 'bg-chart-2'
                  }`}
                />
                <span
                  className={`absolute -bottom-6 text-xs ${
                    row.isCurrent
                      ? 'font-semibold text-foreground'
                      : 'text-muted-foreground'
                  }`}
                >
                  {row.label}
                </span>
                <span
                  className={`absolute -bottom-1 h-[3px] rounded-full bg-primary transition-[width] duration-150 ${
                    isSelected ? 'w-6' : 'w-0'
                  }`}
                />
              </button>
            )
          })}
        </div>
      </div>

      {/* The persistent value band — ONE figure (Billed). Updates on tap. */}
      <div className="mt-4 flex min-h-[52px] items-center justify-between gap-3 rounded-md border border-border bg-muted/40 px-3 py-2">
        <span className="flex min-w-0 flex-col">
          <b className="text-base font-bold text-foreground tabular-nums">
            {formatCurrency(selected.billed)}
          </b>
          <span className="text-xs text-muted-foreground">
            {t('dashboard.history.billedLabel')}
          </span>
        </span>
        <span className="flex flex-none flex-col text-right text-xs text-muted-foreground">
          <b className="text-sm font-semibold text-foreground">
            {selected.label} {selected.year}
          </b>
          {selected.isCurrent && (
            <span>{t('dashboard.history.monthOpen')}</span>
          )}
        </span>
      </div>

      <p className="mt-3 text-xs text-muted-foreground">
        {t('dashboard.history.asOf', { timestamp: asOf })}
      </p>
    </div>
  )
}
