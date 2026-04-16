import { test } from '@playwright/test'

test.use({ baseURL: 'http://43.133.56.234' })

async function login(page: any) {
  await page.goto('/login')
  await page.waitForSelector('input[type="email"]', { timeout: 10000 })
  await page.fill('input[type="email"]', 'admin@oms.com')
  await page.fill('input[type="password"]', 'admin123')
  await page.click('button[type="submit"]')
  await page.waitForURL('**/dashboard', { timeout: 10000 })
  await page.waitForTimeout(1500)
}

test('Debug quotation create form', async ({ page }) => {
  // Capture console errors
  const errors: string[] = []
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()) })
  page.on('pageerror', err => errors.push(err.message))

  await login(page)
  await page.goto('/dashboard/quotations')
  await page.waitForTimeout(2000)

  // Click button
  await page.locator('button').filter({ hasText: '新增報價單' }).click()
  await page.waitForTimeout(3000)

  // Check if form appeared
  const formTitle = page.locator('h2:has-text("新增報價單")')
  const formVisible = await formTitle.isVisible().catch(() => false)
  console.log('Form visible:', formVisible)
  console.log('Console errors:', errors)

  // Check creating state via DOM
  const card = page.locator('.oms-card').count()
  console.log('Card count:', await card)

  await page.screenshot({ path: 'qt-debug-after-click.png', fullPage: true })
})
