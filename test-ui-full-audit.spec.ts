import { test } from '@playwright/test'

const PROD = 'http://43.133.56.234'

async function login(page: any) {
  await page.goto(`${PROD}/login`)
  await page.fill('input[type="email"]', 'admin@oms.com')
  await page.fill('input[type="password"]', 'admin123')
  await page.click('button[type="submit"]')
  await page.waitForURL('**/dashboard', { timeout: 15000 })
  await page.waitForTimeout(800)
}

const routes = [
  '/dashboard',
  '/dashboard/customer-orders',
  '/dashboard/quotations',
  '/dashboard/bom',
  '/dashboard/po',
  '/dashboard/production',
  '/dashboard/delivery-notes',
  '/dashboard/customers',
  '/dashboard/suppliers',
  '/dashboard/inventory',
  '/dashboard/stock-ledger',
  '/dashboard/stock-adjustments',
  '/dashboard/company',
  '/dashboard/roles',
  '/dashboard/users',
  '/dashboard/audit-logs',
  '/dashboard/profile',
]

test.use({ viewport: { width: 1280, height: 800 } })
test('ui audit desktop screenshots', async ({ page }) => {
  await login(page)
  for (const route of routes) {
    await page.goto(`${PROD}${route}`)
    await page.waitForTimeout(1200)
    const name = route.replace('/dashboard/', '') || 'dashboard'
    await page.screenshot({ path: `ui-desktop-${name}.png`, fullPage: true })
  }
})

test.describe('mobile', () => {
  test.use({ viewport: { width: 390, height: 844 } })
  test('ui audit mobile screenshots', async ({ page }) => {
    await login(page)
    for (const route of routes) {
      await page.goto(`${PROD}${route}`)
      await page.waitForTimeout(1200)
      const name = route.replace('/dashboard/', '') || 'dashboard'
      await page.screenshot({ path: `ui-mobile-${name}.png`, fullPage: true })
    }
  })
})
