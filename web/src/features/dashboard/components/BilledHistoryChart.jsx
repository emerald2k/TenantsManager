import { useTranslation } from 'react-i18next'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { formatCurrency } from '@/lib/formatCurrency'

/**
 * FR-DASH-09 — the 12-month Billed history chart, rendered with Recharts
 * (brought forward from Phase 2 for M8, CLAUDE.md §4; the one new runtime
 * dependency M8 adds, deliberately NOT lazy-loaded — code splitting stays
 * deferred).
 *
 * ONE series: Billed per month (`Σ billedForReport` over that month's signed
 * reports — the shared definition, never a raw `finalTotal`). The approved
 * mockup also sketches a second "Collected" series; that needs a
 * payment-date-bucketed fetch the dashboard does not do today and is left
 * as a follow-up (see the stage 15 report). SRS §5.3 and FR-DASH-09 both
 * name this "the Billed history chart".
 *
 * FR-DASH-09a: the bars are NOT stable over time (a past month can be
 * unlocked and re-signed), so the chart carries an "as of" line and is
 * explicitly "not a ledger". The current month's bar is drawn dimmer — the
 * month has not closed.
 *
 * @param data rows from `billedHistory(...)`: { month, year, label, billed,
 *   isCurrent }, oldest first.
 * @param hasSignedReports whether ANY signed report exists in the fetched
 *   window — distinguishes "nothing billed in 12 months" (a real, if
 *   unusual, zero) from FR-DASH-10's empty state.
 */
export function BilledHistoryChart({ data, hasSignedReports }) {
  const { t, i18n } = useTranslation()

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

  return (
    <div className="rounded-lg border border-border bg-card p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold text-foreground">
          {t('dashboard.history.title')}
        </h2>
        <span className="text-xs text-muted-foreground">
          {t('dashboard.history.subtitle')}
        </span>
      </div>

      <div className="mt-4 h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={data}
            margin={{ top: 8, right: 8, bottom: 0, left: 8 }}
          >
            <CartesianGrid
              vertical={false}
              stroke="var(--color-border)"
              strokeDasharray="3 3"
            />
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={{ stroke: 'var(--color-border)' }}
              tick={{ fill: 'var(--color-muted-foreground)', fontSize: 12 }}
            />
            <YAxis
              width={72}
              tickLine={false}
              axisLine={false}
              tick={{ fill: 'var(--color-muted-foreground)', fontSize: 12 }}
              tickFormatter={(value) =>
                new Intl.NumberFormat('ro-RO', {
                  notation: 'compact',
                  maximumFractionDigits: 1,
                }).format(value)
              }
            />
            <Tooltip
              cursor={{ fill: 'var(--color-muted)', opacity: 0.4 }}
              content={<BilledTooltip />}
            />
            <Bar dataKey="billed" radius={[3, 3, 0, 0]} maxBarSize={28}>
              {data.map((row) => (
                <Cell
                  key={`${row.year}-${row.month}`}
                  fill="var(--color-chart-2)"
                  fillOpacity={row.isCurrent ? 0.45 : 1}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <p className="mt-3 text-xs text-muted-foreground">
        {t('dashboard.history.asOf', { timestamp: asOf })}
      </p>
    </div>
  )
}

function BilledTooltip({ active, payload }) {
  const { t } = useTranslation()
  if (!active || !payload || payload.length === 0) return null
  const row = payload[0].payload
  return (
    <div className="rounded-md border border-border bg-popover px-3 py-2 text-xs shadow-md">
      <p className="font-medium text-popover-foreground">
        {row.label} {row.year}
        {row.isCurrent ? ` · ${t('dashboard.history.monthOpen')}` : ''}
      </p>
      <p className="mt-1 text-muted-foreground">
        {t('dashboard.history.billedLabel')}: {formatCurrency(row.billed)}
      </p>
    </div>
  )
}
