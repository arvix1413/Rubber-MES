import { test, expect } from '@playwright/test'

test('prod inventory page is reachable', async ({ page }) => {
  await page.goto('http://43.133.56.234:10101/login')
  await page.fill('input[type="email"]', 'admin@rubber.local')
  await page.fill('input[type="password"]', 'admin123')
  await page.click('button:has-text("進入系統")')
  await page.waitForURL('**/dashboard', { timeout: 20000 })

  await page.goto('http://43.133.56.234:10101/dashboard/inventory')
  await expect(page.locator('h1')).toContainText(/庫存查詢/)
  await expect(page.locator('table')).toBeVisible()
})
