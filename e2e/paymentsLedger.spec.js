import { test, expect } from '@playwright/test'

/**
 * FR-PAY-07/08/09, FR-PROP-12 (M8 stage 12) — the second of the two E2E
 * flows M8 adds (the other is `darkModeExport.spec.js`, stage 9).
 *
 * Both tests use YEAR MODE pinned to 2026 rather than the default "current
 * month" — the seed's reports are hardcoded to 2025/2026 (`OCCUPIED_MONTHS`
 * etc., `functions/scripts/seed.js`), not relative to the real wall-clock
 * date the test runner happens to have, and a due-date-dependent badge
 * (unpaid vs. overdue) would drift as real calendars pass the seeded due
 * dates. The year navigation below reaches 2026 from whatever year the
 * runner's clock is actually on.
 */

async function loginAsAdmin(page) {
  await page.goto('/login')
  await page.locator('#email').fill('admin@test.ro')
  await page.locator('#password').fill('admin123')
  await page.getByRole('button', { name: 'Autentificare' }).click()
  await page.waitForURL('**/admin')
}

async function goToPaymentsInYear2026(page) {
  await page.goto('/admin/payments')
  await page.getByLabel('Tip perioadă').selectOption('year')

  const delta = 2026 - new Date().getFullYear()
  const button = delta >= 0 ? 'Anul următor' : 'Anul anterior'
  for (let i = 0; i < Math.abs(delta); i += 1) {
    await page.getByRole('button', { name: button }).click()
  }
  await expect(page.getByText('2026', { exact: true })).toBeVisible()
}

test.describe('Payments ledger (FR-PAY-07/08/09, FR-PROP-12)', () => {
  test('an unpaid report with no paymentDate stays visible — a Firestore orderBy would silently drop it', async ({
    page,
  }) => {
    await loginAsAdmin(page)
    await goToPaymentsInYear2026(page)

    // `seed-tenancy-occupied` / "Apartament Zorilor" has 4 SIGNED 2026
    // reports (Jan, Feb, May, Jul) plus 1 draft (Aug) — three of the five
    // (Feb "unpaid", Jul "payment omitted", Aug draft) carry NO
    // `paymentDate` at all. If the ledger sorted with a Firestore
    // `orderBy('paymentDate')` instead of the required JS sort, those rows
    // would not merely sort differently — they would not be fetched at
    // all, and this row count would silently drop from 5 to 2.
    await page
      .getByLabel('Proprietate')
      .selectOption({ label: 'Apartament Zorilor' })

    const rows = page.getByRole('table').getByRole('row')
    await expect(rows).toHaveCount(6) // 1 header + 5 reports

    // At least one of those rows genuinely has no payment date recorded —
    // the exact symptom an `orderBy` bug would erase.
    const dashCells = page
      .getByRole('table')
      .getByRole('cell', { name: '—', exact: true })
    expect(await dashCells.count()).toBeGreaterThan(0)
  })

  test('year-mode footer totals show the seeded Σ rent for 2026 (signed reports only) and state the excluded draft', async ({
    page,
  }) => {
    await loginAsAdmin(page)
    await goToPaymentsInYear2026(page)

    // Hand-computed independently from functions/scripts/seed.js (see the
    // stage 12 outbox report for the full derivation): 4 × 2.500 lei
    // (occupied, Jan/Feb/May/Jul, signed) + 1.800 lei (ended tenancy, Jan)
    // + 950 lei + 1.150 lei (the hand-over pair, Jul) = 13.900 lei. The
    // August DRAFT report (2.500 lei) is deliberately excluded — the
    // administrator's decision now recorded in FR-PROP-12.
    await expect(page.getByText('Facturat')).toBeVisible()
    await expect(page.getByText('Total chirie (2026)')).toBeVisible()
    const rentLabel = page.getByText('Total chirie (2026)')
    const rentValue = rentLabel.locator('xpath=following-sibling::p[1]')
    await expect(rentValue).toHaveText('13.900,00 lei')

    await expect(
      page.getByText(
        '1 rapoarte nesemnate din 2026 nu sunt incluse în totaluri.',
      ),
    ).toBeVisible()
  })
})
