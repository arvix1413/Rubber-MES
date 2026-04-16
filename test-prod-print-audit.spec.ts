import { test, expect } from '@playwright/test'

const PROD = 'http://43.133.56.234'

async function login(page: any) {
  await page.goto(`${PROD}/login`)
  await page.fill('input[type="email"]', 'admin@oms.com')
  await page.fill('input[type="password"]', 'admin123')
  await page.click('button[type="submit"]')
  await page.waitForURL('**/dashboard', { timeout: 15000 })
  await page.waitForTimeout(800)
}

async function capturePopup(page: any, trigger: () => Promise<void>, path: string, expected: string[] = []) {
  const [popup] = await Promise.all([
    page.waitForEvent('popup', { timeout: 10000 }),
    trigger(),
  ])
  await popup.waitForLoadState('domcontentloaded')
  await popup.waitForTimeout(1200)

  for (const s of expected) {
    await expect(popup.locator(s).first()).toBeVisible()
  }

  await popup.screenshot({ path, fullPage: true })
  await popup.close()
}

test('print audit: customer order / po / delivery note / quotation', async ({ page }) => {
  await login(page)

  // 1) Customer Order print
  await page.goto(`${PROD}/dashboard/customer-orders`)
  await page.waitForTimeout(1600)
  const coPrintBtn = page.locator('button[title="列印"]').first()
  if (await coPrintBtn.count()) {
    await capturePopup(page, async () => { await coPrintBtn.click() }, 'print-co.png', ['.header', '.items', '.footer'])
  }

  // 2) PO print
  await page.goto(`${PROD}/dashboard/po`)
  await page.waitForTimeout(1600)
  const poPrintBtn = page.locator('button[title="列印"]').first()
  if (await poPrintBtn.count()) {
    await capturePopup(page, async () => { await poPrintBtn.click() }, 'print-po.png', ['.header', '.items', '.sign-section'])
  }

  // 3) Delivery Note print (from detail modal)
  await page.goto(`${PROD}/dashboard/delivery-notes`)
  await page.waitForTimeout(1600)
  const detailBtn = page.locator('button:has-text("詳情")').first()
  if (await detailBtn.count()) {
    await detailBtn.click()
    await page.waitForTimeout(500)
    const dnPrintBtn = page.locator('button:has-text("🖨 列印")').first()
    if (await dnPrintBtn.count()) {
      await capturePopup(page, async () => { await dnPrintBtn.click() }, 'print-dn.png', ['.header', '.items', '.footer'])
    }
    const closeBtn = page.locator('button:has-text("✕")').first()
    if (await closeBtn.count()) await closeBtn.click().catch(() => {})
  }

  // 4) Quotation print
  await page.goto(`${PROD}/dashboard/quotations`)
  await page.waitForTimeout(1600)
  const qtPrintBtn = page.locator('button[title="列印"]').first()
  if (await qtPrintBtn.count()) {
    await capturePopup(page, async () => { await qtPrintBtn.click() }, 'print-qt.png', ['.header', '.items', '.sign-row'])
  }
})
