import { test, expect } from '@playwright/test'

/**
 * SRS §9 critical flow 1 — **login + role redirect, admin vs tenant.**
 *
 * The previous version of this file asserted only that `/login` renders its
 * two inputs, under the name `login`. That reads as coverage of flow 1 to
 * anyone who does not open the file (stage 18 audit, discrepancy 7). This
 * version drives a real sign-in for each role and proves the redirect sends
 * them to **different** places — "we are no longer on /login" passes for both
 * roles and proves nothing about the redirect.
 *
 * Credentials come from `functions/scripts/seed.js`, which
 * `e2e/global-setup.js` runs as part of the band: `ADMIN` and `SEED_TENANT`
 * (the active tenant with the two-year history).
 */

const ADMIN = { email: 'admin@test.ro', password: 'admin123' }
const TENANT = { email: 'chirias@test.ro', password: 'chirias123' }

async function signIn(page, { email, password }) {
  await page.goto('/login')
  await page.locator('#email').fill(email)
  await page.locator('#password').fill(password)
  await page.getByRole('button', { name: 'Autentificare' }).click()
  // The page navigates itself: AuthProvider receives the token, GuestRoute on
  // /login redirects to the role's home. No explicit navigation in the app.
}

test.describe('SRS §9 flow 1 — login + role redirect', () => {
  test('the administrator lands on the admin area, not the tenant portal', async ({
    page,
  }) => {
    await signIn(page, ADMIN)
    await page.waitForURL('**/admin')

    // The redirect is to the admin home specifically — not merely away from
    // /login, and not the tenant portal.
    expect(new URL(page.url()).pathname).toBe('/admin')
    // A nav destination that exists only in the admin shell (both the desktop
    // sidebar and the phone tab bar carry "Chiriași"); the tenant portal has
    // no such link.
    await expect(
      page.getByRole('link', { name: 'Chiriași' }).first(),
    ).toBeVisible()
    // ...and none of the tenant portal's own nav.
    await expect(page.getByRole('link', { name: 'Acasă' })).toHaveCount(0)
  })

  test('the tenant lands on the tenant portal, not the admin area', async ({
    page,
  }) => {
    await signIn(page, TENANT)
    await page.waitForURL('**/app')

    expect(new URL(page.url()).pathname).toBe('/app')
    // The tenant portal's own nav.
    await expect(
      page.getByRole('link', { name: 'Acasă' }).first(),
    ).toBeVisible()
    // ...and none of the admin shell's nav — if the redirect had sent the
    // tenant to /admin, this count would not be 0.
    await expect(page.getByRole('link', { name: 'Chiriași' })).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'Plăți' })).toHaveCount(0)
  })
})

test('the login page renders its email and password fields', async ({
  page,
}) => {
  await page.goto('/login')
  await expect(page.locator('#email')).toBeVisible()
  await expect(page.locator('#password')).toBeVisible()
})
