import { test } from '@playwright/test'

// Test against production
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

test('1. Quotation list page', async ({ page }) => {
  await login(page)
  await page.goto('/dashboard/quotations')
  await page.waitForTimeout(2500)
  await page.screenshot({ path: 'qt-01-list.png' })
})

test('2. Quotation create form with 5-tier MOQ', async ({ page }) => {
  await login(page)
  await page.goto('/dashboard/quotations')
  await page.waitForTimeout(2000)

  // Open create form
  await page.locator('button').filter({ hasText: '新增報價單' }).click()
  await page.waitForTimeout(1500)
  await page.screenshot({ path: 'qt-02-create-form-open.png' })

  // Select customer
  const selects = page.locator('select')
  const custOpts = await selects.first().locator('option').count()
  if (custOpts > 1) await selects.first().selectOption({ index: 1 })
  await page.waitForTimeout(300)

  // Select BOM
  const allSelects = page.locator('select')
  const sc = await allSelects.count()
  if (sc > 1) {
    const bomOpts = await allSelects.nth(1).locator('option').count()
    if (bomOpts > 1) { await allSelects.nth(1).selectOption({ index: 1 }); await page.waitForTimeout(500) }
  }

  await page.screenshot({ path: 'qt-03-bom-selected.png' })

  // Fill 5 MOQ tiers
  const moqInputs = page.locator('input[placeholder="MOQ"]')
  const priceInputs = page.locator('input[placeholder="單價"]')
  const mc = await moqInputs.count()
  const moqVals = [1000, 3000, 5000, 7000, 10000]
  const priceVals = [1230, 1210, 1110, 980, 880]
  for (let i = 0; i < Math.min(mc, 5); i++) {
    await moqInputs.nth(i).fill(String(moqVals[i]))
    await priceInputs.nth(i).fill(String(priceVals[i]))
  }

  await page.screenshot({ path: 'qt-04-tiers-filled.png' })

  // Save
  await page.locator('button').filter({ hasText: '建立報價單' }).click()
  await page.waitForTimeout(3000)
  await page.screenshot({ path: 'qt-05-after-save.png' })
})

test('3. Quotation expand and tiers display', async ({ page }) => {
  await login(page)
  await page.goto('/dashboard/quotations')
  await page.waitForTimeout(2500)

  // Expand first row
  const rows = page.locator('tbody tr')
  const count = await rows.count()
  if (count > 0) {
    await rows.first().click()
    await page.waitForTimeout(2000)
    await page.screenshot({ path: 'qt-06-expanded-tiers.png' })
  }
})

test('4. Quotation inline edit', async ({ page }) => {
  await login(page)
  await page.goto('/dashboard/quotations')
  await page.waitForTimeout(2500)

  // Find a draft quotation and expand it
  const rows = page.locator('tbody tr')
  const count = await rows.count()
  for (let i = 0; i < Math.min(count, 5); i++) {
    const row = rows.nth(i)
    const badge = row.locator('.badge-gray')
    if (await badge.count() > 0) {
      await row.click()
      await page.waitForTimeout(1500)
      const editBtn = page.locator('button:has-text("編輯")').first()
      if (await editBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await editBtn.click()
        await page.waitForTimeout(1500)
        await page.screenshot({ path: 'qt-07-inline-edit.png' })
        // Cancel
        await page.locator('button:has-text("取消")').first().click()
        await page.waitForTimeout(500)
        break
      }
    }
  }
})

test('5. Quotation send and accept flow', async ({ page }) => {
  await login(page)
  await page.goto('/dashboard/quotations')
  await page.waitForTimeout(2500)

  // Find draft and expand
  const rows = page.locator('tbody tr')
  const count = await rows.count()
  for (let i = 0; i < Math.min(count, 5); i++) {
    const row = rows.nth(i)
    const badge = row.locator('.badge-gray')
    if (await badge.count() > 0) {
      await row.click()
      await page.waitForTimeout(1500)
      const sendBtn = page.locator('button:has-text("發送")').first()
      if (await sendBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await page.screenshot({ path: 'qt-08-before-send.png' })
        await sendBtn.click()
        await page.waitForTimeout(2000)
        await page.screenshot({ path: 'qt-09-after-send.png' })
        // Expand sent row
        await rows.first().click()
        await page.waitForTimeout(1500)
        await page.screenshot({ path: 'qt-10-sent-expanded.png' })
      }
      break
    }
  }
})
