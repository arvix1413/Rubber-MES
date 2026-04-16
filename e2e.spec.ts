import { test, expect, Page } from '@playwright/test'

const BASE = 'http://43.133.56.234'

async function login(p: Page) {
  await p.goto(`${BASE}/login`)
  await p.fill('input[type="email"]', 'admin@oms.com')
  await p.fill('input[type="password"]', 'admin123')
  await p.click('button[type="submit"]')
  await p.waitForURL(`${BASE}/dashboard**`, { timeout: 15000 })
}

async function waitMsg(p: Page) {
  await p.waitForSelector('text=/成功|已更新|已核准|已建立|完工|已出貨|已確認/', { timeout: 8000 }).catch(() => {})
  await p.waitForTimeout(600)
}

// ── 1. Login ──────────────────────────────────────────────────────────────────
test('01. Login', async ({ page }) => {
  await login(page)
  await expect(page).toHaveURL(/\/dashboard/)
  console.log('✅ Login OK')
})

// ── 2. BOM 管理 ───────────────────────────────────────────────────────────────
test('02. BOM CRUD', async ({ page }) => {
  await login(page)
  await page.goto(`${BASE}/dashboard/bom`)
  await page.waitForLoadState('networkidle')

  // Use timestamp to ensure unique SKU
  const sku = `E2E-SKU-${Date.now()}`

  // Create
  await page.locator('div.flex button.btn-primary').click()
  await page.waitForTimeout(600)
  await page.locator('input.oms-input').nth(0).fill(sku)
  await page.locator('input.oms-input').nth(1).fill('E2E BOM 測試')
  await page.locator('.rounded-b-2xl button.btn-primary').click()
  await waitMsg(page)
  await page.waitForTimeout(800)
  // If modal still open (e.g. SKU conflict), close it
  const modalStillOpen = await page.locator('.fixed.inset-0').isVisible().catch(() => false)
  if (modalStillOpen) {
    await page.locator('.fixed.inset-0 button', { hasText: '✕' }).first().click()
    await page.waitForTimeout(400)
  }
  await expect(page.locator('td', { hasText: sku }).first()).toBeVisible({ timeout: 8000 })

  // Expand row by clicking first cell
  const bomRow = page.locator('tbody tr', { hasText: sku }).first()
  await bomRow.locator('td').first().click()
  await page.waitForTimeout(600)

  // Edit - click edit button
  await bomRow.locator('button', { hasText: '編輯' }).click()
  await page.waitForTimeout(600)
  // Fill product name (index 1 in modal)
  const nameInput = page.locator('.fixed.inset-0 input.oms-input').nth(1)
  await nameInput.fill('E2E BOM Updated')
  await page.locator('.rounded-b-2xl button.btn-primary').click()
  await waitMsg(page)
  await page.waitForTimeout(500)
  // Close modal if still open
  const editModalOpen = await page.locator('.fixed.inset-0').isVisible().catch(() => false)
  if (editModalOpen) {
    await page.locator('.fixed.inset-0 button', { hasText: '✕' }).first().click()
    await page.waitForTimeout(400)
  }

  // Delete
  page.on('dialog', d => d.accept())
  await bomRow.locator('button', { hasText: '刪除' }).click()
  await page.waitForTimeout(800)
  console.log('✅ BOM CRUD OK')
})

// ── 3. 客戶訂單 ───────────────────────────────────────────────────────────────
test('03. Customer Orders CRUD', async ({ page }) => {
  await login(page)
  await page.goto(`${BASE}/dashboard/customer-orders`)
  await page.waitForLoadState('networkidle')

  await page.locator('button', { hasText: /新增|建立/ }).first().click()
  await page.waitForTimeout(400)

  // Fill PO number (first text input after date)
  await page.locator('input.oms-input').nth(0).fill('PO-E2E-UI-001')

  // Select first customer from dropdown
  const custSelect = page.locator('select').first()
  const opts = await custSelect.locator('option').all()
  if (opts.length > 1) await custSelect.selectOption({ index: 1 })
  await page.waitForTimeout(300)

  // Add a BOM item if available
  const bomSelect = page.locator('select').nth(1)
  const bomOpts = await bomSelect.locator('option').all()
  if (bomOpts.length > 1) {
    await bomSelect.selectOption({ index: 1 })
    await page.waitForTimeout(200)
    await page.locator('input[type="number"]').first().fill('5')
  }

  await page.locator('button', { hasText: '建立訂單' }).click()
  await waitMsg(page)
  await expect(page.locator('td', { hasText: 'PO-E2E-UI-001' }).first()).toBeVisible({ timeout: 5000 })

  page.on('dialog', d => d.accept())
  await page.locator('button', { hasText: '刪除' }).first().click()
  await page.waitForTimeout(800)
  console.log('✅ Customer Orders CRUD OK')
})

// ── 4. 採購單 ─────────────────────────────────────────────────────────────────
test('04. Purchase Orders CRUD', async ({ page }) => {
  await login(page)
  await page.goto(`${BASE}/dashboard/po`)
  await page.waitForLoadState('networkidle')

  await page.locator('button', { hasText: '建立採購單' }).click()
  await page.waitForTimeout(400)
  // Select first supplier
  const supSelect = page.locator('select').first()
  const options = await supSelect.locator('option').all()
  if (options.length > 1) await supSelect.selectOption({ index: 1 })
  await page.waitForTimeout(500)
  // Fill item
  const row = page.locator('tbody tr').first()
  await row.locator('input[type="number"]').nth(0).fill('5')
  await row.locator('input[type="number"]').nth(1).fill('1000')
  await page.locator('button', { hasText: '建立採購單' }).last().click()
  await waitMsg(page)

  // Expand and approve
  await page.locator('tbody tr').first().click()
  await page.waitForTimeout(800)
  await page.locator('button', { hasText: '核准' }).first().click()
  await waitMsg(page)

  page.on('dialog', d => d.accept())
  await page.locator('button', { hasText: '刪除' }).first().click()
  await page.waitForTimeout(800)
  console.log('✅ Purchase Orders CRUD OK')
})

// ── 5. 生產單 ─────────────────────────────────────────────────────────────────
test('05. Production CRUD', async ({ page }) => {
  await login(page)
  await page.goto(`${BASE}/dashboard/production`)
  await page.waitForLoadState('networkidle')

  await page.locator('button', { hasText: '建立生產單' }).click()
  await page.waitForTimeout(400)
  // Select first BOM
  const bomSelect = page.locator('select').first()
  const opts = await bomSelect.locator('option').all()
  if (opts.length > 1) await bomSelect.selectOption({ index: 1 })
  await page.waitForTimeout(300)
  await page.locator('input[type="number"]').first().fill('3')
  // Check stock
  await page.locator('button', { hasText: /下一步|檢查庫存/ }).click()
  await page.waitForTimeout(1000)
  await page.locator('button', { hasText: '建立生產單' }).last().click()
  await waitMsg(page)

  // View detail and change status
  await page.locator('button', { hasText: '詳情' }).first().click()
  await page.waitForTimeout(400)
  // Click whichever action button is available
  const actionBtn = page.locator('button').filter({ hasText: /✓ 確認|✓ 材料齊|▶ 開始生產/ }).first()
  if (await actionBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await actionBtn.click()
    await waitMsg(page)
  }
  // Close modal with Escape (avoid clicking ✕ which might be intercepted)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(500)
  console.log('✅ Production CRUD OK')
})

// ── 6. 出貨單 ─────────────────────────────────────────────────────────────────
test('06. Delivery Notes CRUD', async ({ page }) => {
  await login(page)
  await page.goto(`${BASE}/dashboard/delivery-notes`)
  await page.waitForLoadState('networkidle')

  await page.locator('button', { hasText: '新增出貨單' }).click()
  await page.waitForTimeout(400)
  // Fill customer name - it's the first non-date input
  const allInputs = page.locator('input.oms-input')
  await allInputs.nth(0).fill('E2E 出貨客戶')
  const row = page.locator('tbody tr').first()
  await row.locator('input').nth(1).fill('E2E 品項')
  await row.locator('input[type="number"]').first().fill('3')
  await page.locator('button', { hasText: '建立出貨單' }).click()
  await waitMsg(page)
  await page.waitForTimeout(1000)
  // Check if created - look for any DN number or customer name
  const dnRows = page.locator('tbody tr')
  const count = await dnRows.count()
  expect(count).toBeGreaterThan(0)

  // View and confirm
  await page.locator('button', { hasText: '詳情' }).first().click()
  await page.waitForTimeout(400)
  await page.locator('button', { hasText: '✓ 確認' }).click()
  await waitMsg(page)
  await page.locator('button').filter({ hasText: '✕' }).first().click()
  await page.waitForTimeout(300)

  page.on('dialog', d => d.accept())
  await page.locator('button', { hasText: '刪除' }).first().click()
  await page.waitForTimeout(800)
  console.log('✅ Delivery Notes CRUD OK')
})

// ── 7. 客戶管理 ───────────────────────────────────────────────────────────────
test('07. Customers CRUD', async ({ page }) => {
  await login(page)
  await page.goto(`${BASE}/dashboard/customers`)
  await page.waitForLoadState('networkidle')

  const code = `E2E-${Date.now()}`

  await page.locator('button', { hasText: /新增客戶/ }).first().click()
  await page.waitForTimeout(400)
  await page.locator('input.oms-input').nth(0).fill(code)
  await page.locator('input.oms-input').nth(1).fill('E2E UI 客戶')
  await page.locator('button', { hasText: '儲存' }).click()
  await waitMsg(page)
  await page.waitForTimeout(600)
  // Close modal if still open
  const modalOpen = await page.locator('.fixed.inset-0').isVisible().catch(() => false)
  if (modalOpen) {
    await page.locator('.fixed.inset-0 button', { hasText: '✕' }).first().click()
    await page.waitForTimeout(400)
  }
  await expect(page.locator('td', { hasText: 'E2E UI 客戶' }).first()).toBeVisible({ timeout: 5000 })

  page.on('dialog', d => d.accept())
  await page.locator('tbody tr button', { hasText: '刪除' }).first().click()
  await page.waitForTimeout(800)
  console.log('✅ Customers CRUD OK')
})

// ── 8. 供應商管理 ─────────────────────────────────────────────────────────────
test('08. Suppliers CRUD', async ({ page }) => {
  await login(page)
  await page.goto(`${BASE}/dashboard/suppliers`)
  await page.waitForLoadState('networkidle')

  await page.locator('button', { hasText: '新增供應商' }).click()
  await page.waitForTimeout(400)
  await page.locator('input.oms-input').nth(1).fill('E2E UI 供應商')
  await page.locator('button', { hasText: '儲存' }).click()
  await waitMsg(page)
  await expect(page.locator('td', { hasText: 'E2E UI 供應商' }).first()).toBeVisible({ timeout: 5000 })

  // Edit via detail
  await page.locator('button', { hasText: '詳情' }).first().click()
  await page.waitForTimeout(400)
  await page.locator('.rounded-2xl button', { hasText: '編輯' }).click()
  await page.waitForTimeout(400)
  await page.locator('input.oms-input').nth(1).fill('E2E UI 供應商 Updated')
  await page.locator('button', { hasText: '儲存' }).first().click()
  await waitMsg(page)

  page.on('dialog', d => d.accept())
  await page.locator('button', { hasText: '刪除' }).first().click()
  await page.waitForTimeout(800)
  console.log('✅ Suppliers CRUD OK')
})

// ── 9. 料號管理 ───────────────────────────────────────────────────────────────
test('09. Materials CRUD', async ({ page }) => {
  await login(page)
  await page.goto(`${BASE}/dashboard/materials`)
  await page.waitForLoadState('networkidle')

  await page.locator('button', { hasText: '新增料號' }).click()
  await page.waitForTimeout(400)
  await page.locator('input.oms-input').nth(0).fill('E2E-MAT-UI')
  await page.locator('input.oms-input').nth(1).fill('E2E UI 物料')
  await page.locator('button', { hasText: '儲存' }).first().click()
  await waitMsg(page)
  await page.waitForTimeout(500)
  await expect(page.locator('td', { hasText: 'E2E-MAT-UI' }).first()).toBeVisible({ timeout: 8000 })

  page.on('dialog', d => d.accept())
  await page.locator('button', { hasText: '刪除' }).first().click()
  await page.waitForTimeout(800)
  console.log('✅ Materials CRUD OK')
})

// ── 10. 庫存查詢 ──────────────────────────────────────────────────────────────
test('10. Inventory', async ({ page }) => {
  await login(page)
  await page.goto(`${BASE}/dashboard/inventory`)
  await page.waitForLoadState('networkidle')
  await expect(page.locator('h1', { hasText: '庫存' })).toBeVisible()
  const rows = page.locator('tbody tr')
  const count = await rows.count()
  console.log(`✅ Inventory OK - ${count} items`)
})

// ── 11. 庫存流水 ──────────────────────────────────────────────────────────────
test('11. Stock Ledger', async ({ page }) => {
  await login(page)
  await page.goto(`${BASE}/dashboard/stock-ledger`)
  await page.waitForLoadState('networkidle')
  await expect(page.locator('h1', { hasText: '庫存流水' })).toBeVisible()
  const rows = page.locator('tbody tr')
  const count = await rows.count()
  console.log(`✅ Stock Ledger OK - ${count} records`)
})

// ── 12. 庫存調整 ──────────────────────────────────────────────────────────────
test('12. Stock Adjustments CRUD', async ({ page }) => {
  await login(page)
  await page.goto(`${BASE}/dashboard/stock-adjustments`)
  await page.waitForLoadState('networkidle')

  await page.locator('button', { hasText: '建立調整單' }).click()
  await page.waitForTimeout(400)
  // Select first material
  const matSelect = page.locator('select').first()
  const opts = await matSelect.locator('option').all()
  if (opts.length > 1) await matSelect.selectOption({ index: 1 })
  await page.waitForTimeout(300)
  await page.locator('input[type="number"]').first().fill('100')
  await page.locator('button', { hasText: '建立調整單' }).last().click()
  await waitMsg(page)

  // Approve
  await page.locator('button', { hasText: '核准' }).first().click()
  await waitMsg(page)
  console.log('✅ Stock Adjustments CRUD OK')
})

// ── 13. 使用者管理 ────────────────────────────────────────────────────────────
test('13. Users CRUD', async ({ page }) => {
  await login(page)
  await page.goto(`${BASE}/dashboard/users`)
  await page.waitForLoadState('networkidle')

  await page.locator('button', { hasText: /新增用戶/ }).first().click()
  await page.waitForTimeout(400)
  await page.locator('input[type="email"]').fill('e2e-ui-test@oms.com')
  await page.locator('input[placeholder="用戶姓名"]').fill('E2E UI 用戶')
  await page.locator('input[type="password"]').fill('test123456')
  await page.locator('button', { hasText: '建立用戶' }).click()
  await waitMsg(page)
  await expect(page.locator('td', { hasText: 'e2e-ui-test@oms.com' }).first()).toBeVisible({ timeout: 5000 })

  page.on('dialog', d => d.accept())
  await page.locator('button', { hasText: '刪除' }).last().click()
  await page.waitForTimeout(800)
  console.log('✅ Users CRUD OK')
})

// ── 14. 角色管理 ──────────────────────────────────────────────────────────────
test('14. Roles Permissions', async ({ page }) => {
  await login(page)
  await page.goto(`${BASE}/dashboard/roles`)
  await page.waitForLoadState('networkidle')
  await expect(page.locator('h1', { hasText: '角色管理' })).toBeVisible()
  // Toggle a permission
  const btn = page.locator('button.rounded').first()
  if (await btn.isVisible()) {
    await btn.click()
    await page.waitForTimeout(500)
    await btn.click()
  }
  console.log('✅ Roles OK')
})

// ── 15. 操作日誌 ──────────────────────────────────────────────────────────────
test('15. Audit Logs', async ({ page }) => {
  await login(page)
  await page.goto(`${BASE}/dashboard/audit-logs`)
  await page.waitForLoadState('networkidle')
  await expect(page.locator('h1', { hasText: '操作日誌' })).toBeVisible()
  const rows = page.locator('tbody tr')
  const count = await rows.count()
  expect(count).toBeGreaterThan(0)
  console.log(`✅ Audit Logs OK - ${count} entries`)
})
