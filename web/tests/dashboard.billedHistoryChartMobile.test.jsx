import { describe, expect, it } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from './renderWithProviders'
import { BilledHistoryChartMobile } from '@/features/dashboard/components/BilledHistoryChartMobile'

// M8 stage 15b — the phone history chart (NFR-UX-03, FR-DASH-09b). One series,
// Billed. The mockup draws two bars and a two-figure band; that is stale
// (docs/design/README.md). The scroll/snap/open-on-current behaviour is a
// browser check — jsdom cannot see it — so these tests cover the data
// contract: 12 bars, a band that states ONE figure and updates on tap.

const MONTHS = [
  'sep',
  'oct',
  'nov',
  'dec',
  'ian',
  'feb',
  'mar',
  'apr',
  'mai',
  'iun',
  'iul',
  'aug',
]

const DATA = MONTHS.map((label, i) => ({
  month: ((8 + i) % 12) + 1,
  year: i < 4 ? 2025 : 2026,
  label,
  billed: 11000 + i * 200,
  isCurrent: i === MONTHS.length - 1,
}))

describe('BilledHistoryChartMobile', () => {
  it('shows the empty state when there is no signed report', async () => {
    await renderWithProviders(
      <BilledHistoryChartMobile data={DATA} hasSignedReports={false} />,
    )
    expect(
      screen.getByText(/graficul se completează după prima semnare/),
    ).toBeInTheDocument()
  })

  it('renders one bar button per month (12)', async () => {
    await renderWithProviders(
      <BilledHistoryChartMobile data={DATA} hasSignedReports />,
    )
    const bars = screen
      .getAllByRole('button')
      .filter((b) => b.getAttribute('aria-label')?.includes('facturat'))
    expect(bars).toHaveLength(12)
  })

  it('the value band opens on the current month and states ONE figure', async () => {
    await renderWithProviders(
      <BilledHistoryChartMobile data={DATA} hasSignedReports />,
    )
    // aug 2026 is the current month; its billed is 11000 + 11*200 = 13.200.
    const band = screen.getByText('Facturat').closest('div')
    expect(within(band).getByText('13.200,00 lei')).toBeInTheDocument()
    expect(within(band).getByText('aug 2026')).toBeInTheDocument()
    expect(within(band).getByText('luna nu s-a încheiat')).toBeInTheDocument()
    // No second series — nothing about "încasat" (collected) in the band.
    expect(within(band).queryByText(/încasat/i)).not.toBeInTheDocument()
  })

  it('tapping another bar moves the band to that month, still one figure', async () => {
    const user = userEvent.setup()
    await renderWithProviders(
      <BilledHistoryChartMobile data={DATA} hasSignedReports />,
    )
    // "ian" is index 4 → year 2026, billed 11000 + 4*200 = 11.800.
    const janBar = screen.getByRole('button', {
      name: /ian 2026: 11\.800,00 lei facturat/,
    })
    await user.click(janBar)

    const band = screen.getByText('Facturat').closest('div')
    expect(within(band).getByText('11.800,00 lei')).toBeInTheDocument()
    expect(within(band).getByText('ian 2026')).toBeInTheDocument()
    // A non-current month: no "month not closed" line.
    expect(
      within(band).queryByText('luna nu s-a încheiat'),
    ).not.toBeInTheDocument()
  })
})
