import { test, expect } from '@playwright/test'

test('Simple local test - check dashboard', async ({ page }) => {
  // Listen to console messages
  page.on('console', msg => {
    console.log('Browser console:', msg.text())
  })

  // Navigate to local frontend
  await page.goto('http://localhost:3000')
  
  // Login
  await page.fill('input[type="email"]', 'admin@oms.com')
  await page.fill('input[type="password"]', 'admin123')
  await page.click('button:has-text("登入")')
  
  // Wait for dashboard
  await page.waitForURL('**/dashboard', { timeout: 10000 })
  await page.waitForTimeout(2000)
  
  // Take screenshot
  await page.screenshot({ path: 'dashboard-screenshot.png', fullPage: true })
  
  // Get all text content
  const bodyText = await page.locator('body').textContent()
  console.log('\n=== Dashboard content ===')
  console.log(bodyText)
  
  // Try to find navigation links
  const links = await page.locator('a').allTextContents()
  console.log('\n=== All links ===')
  links.forEach(link => console.log('  -', link))
  
  await page.waitForTimeout(2000)
})
