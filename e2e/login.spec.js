import { test, expect } from '@playwright/test'

test('the login page renders', async ({ page }) => {
  await page.goto('/login')
  await expect(page.locator('#email')).toBeVisible()
  await expect(page.locator('#password')).toBeVisible()
})
