import { test } from '@playwright/test'

const PROD = 'http://43.133.56.234'

async function login(page: any) {
  await page.goto(`${PROD}/login`)
  await page.fill('input[type="email"]', 'admin@oms.com')
  await page.fill('input[type="password"]', 'admin123')
  await page.click('button[type="submit"]')
  await page.waitForURL('**/dashboard', { timeout: 15000 })
  await page.waitForTimeout(700)
}

test.use({ viewport: { width: 1440, height: 900 } })

test('desktop quick audit', async ({ page }) => {
  await login(page)
  const routes = [
    ['/dashboard/customer-orders', 'ui-desktop-v2-customer-orders.png'],
    ['/dashboard/users', 'ui-desktop-v2-users.png'],
    ['/dashboard/audit-logs', 'ui-desktop-v2-audit-logs.png'],
  ] as const

  for (const [route, file] of routes) {
    await page.goto(`${PROD}${route}`)
    await page.waitForTimeout(1200)
    await page.screenshot({ path: file, fullPage: true })
  }
})
