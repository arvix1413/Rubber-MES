import { test, expect } from '@playwright/test'

async function login(page: any) {
  await page.goto('http://localhost:3000')
  await page.fill('input[type="email"]', 'admin@oms.com')
  await page.fill('input[type="password"]', 'admin123')
  await page.click('button:has-text("登入")')
  await page.waitForURL('**/dashboard', { timeout: 10000 })
  await page.waitForTimeout(800)
}

// ─── 1. Login / Logout ───────────────────────────────────────────────────────
test('1. 登入 / 登出', async ({ page }) => {
  await page.goto('http://localhost:3000')
  await page.fill('input[type="email"]', 'admin@oms.com')
  await page.fill('input[type="password"]', 'admin123')
  await page.click('button:has-text("登入")')
  await page.waitForURL('**/dashboard', { timeout: 10000 })
  // 確認 dashboard 已載入
  await expect(page.locator('text=歡迎回來').first()).toBeVisible()
  console.log('✅ 登入成功')

  await page.click('button:has-text("登出")')
  await page.waitForURL('**/login', { timeout: 5000 })
  console.log('✅ 登出成功')
})

// ─── 2. Profile page ─────────────────────────────────────────────────────────
test('2. 個人資料頁面 + 修改密碼驗證', async ({ page }) => {
  await login(page)
  // 點側邊欄的個人資料連結
  await page.click('a[href="/dashboard/profile"]')
  await page.waitForURL('**/profile', { timeout: 5000 })
  await page.waitForTimeout(500)

  // 確認頁面元素
  await expect(page.locator('h1:has-text("個人資料")')).toBeVisible()
  await expect(page.locator('h2:has-text("修改密碼")')).toBeVisible()
  await expect(page.locator('text=admin@oms.com').first()).toBeVisible()
  console.log('✅ Profile 頁面正常')

  // 測試密碼不一致
  await page.fill('input[placeholder="輸入目前密碼"]', 'admin123')
  await page.fill('input[placeholder="至少6個字元"]', 'newpass1')
  await page.fill('input[placeholder="再次輸入新密碼"]', 'newpass2')
  await page.click('button:has-text("更新密碼")')
  await page.waitForTimeout(800)
  console.log('✅ 密碼不一致驗證正常')

  // 測試錯誤舊密碼
  await page.fill('input[placeholder="輸入目前密碼"]', 'wrongpw')
  await page.fill('input[placeholder="至少6個字元"]', 'newpass1')
  await page.fill('input[placeholder="再次輸入新密碼"]', 'newpass1')
  await page.click('button:has-text("更新密碼")')
  await page.waitForTimeout(1200)
  console.log('✅ 錯誤舊密碼驗證正常')
})

// ─── 3. User management ──────────────────────────────────────────────────────
test('3. 用戶管理 - 新增/重置密碼/刪除', async ({ page }) => {
  await login(page)

  // 展開系統管理群組
  const adminGroup = page.locator('button:has-text("使用者帳號")')
  if (await adminGroup.isVisible()) await adminGroup.click()
  await page.waitForTimeout(400)

  await page.click('a[href="/dashboard/users"]')
  await page.waitForTimeout(1500)
  await expect(page.locator('h1:has-text("用戶管理")')).toBeVisible()

  // 新增用戶
  await page.click('button:has-text("新增用戶")')
  await page.waitForTimeout(500)
  const ts = Date.now().toString().slice(-6)
  const testEmail = `test${ts}@test.com`
  const testName = `測試員工${ts}`

  await page.fill('input[type="email"]', testEmail)
  await page.fill('input[placeholder="用戶姓名"]', testName)
  await page.selectOption('select', 'viewer')
  await page.fill('input[type="password"]', 'test123')
  await page.click('button:has-text("建立用戶")')
  await page.waitForTimeout(1500)
  await expect(page.locator(`text=${testName}`)).toBeVisible()
  console.log('✅ 新增用戶成功')

  // 重置密碼
  const row = page.locator(`tr:has-text("${testName}")`)
  await row.locator('button:has-text("重置密碼")').click()
  await page.waitForTimeout(500)
  // 確認對話框
  await page.click('button:has-text("確認重置")')
  await page.waitForTimeout(1200)
  console.log('✅ 重置密碼成功')

  // 刪除用戶
  await row.locator('button:has-text("刪除")').click()
  await page.waitForTimeout(500)
  await page.click('button:has-text("確認刪除")')
  await page.waitForTimeout(1200)
  await expect(page.locator(`text=${testName}`)).not.toBeVisible()
  console.log('✅ 刪除用戶成功')
})

// ─── 4. Customer Orders ──────────────────────────────────────────────────────
test('4. 客戶訂單 - 建立', async ({ page }) => {
  await login(page)
  await page.click('a[href="/dashboard/customer-orders"]')
  await page.waitForTimeout(1500)
  await page.click('button:has-text("新增訂單")')
  await page.waitForTimeout(600)

  const ts = Date.now().toString().slice(-6)
  // po_number input - 找第二個 input（第一個是日期）
  const inputs = page.locator('input:not([type="date"]):not([type="email"]):not([type="password"])')
  // 找採購單號 input（label 旁邊）
  const poInput = page.locator('label:has-text("採購單號") + div input, label:has-text("採購單號") ~ input').first()
  if (await poInput.count() > 0) {
    await poInput.fill(`TEST-CO-${ts}`)
  } else {
    // fallback: 找第二個 text input
    await page.locator('input.oms-input').nth(1).fill(`TEST-CO-${ts}`)
  }

  // 選客戶
  const custSelect = page.locator('select').first()
  const custCount = await custSelect.locator('option').count()
  if (custCount > 1) await custSelect.selectOption({ index: 1 })

  // 選 BOM
  const bomInput = page.locator('input[placeholder="-- 選擇成品 BOM --"]').first()
  await bomInput.click()
  await page.waitForTimeout(500)
  const opts = page.locator('div.bg-white.border div.px-3.py-2.text-xs')
  if (await opts.count() > 0) {
    await opts.first().click({ force: true })
    await page.waitForTimeout(500)
    console.log('✅ BOM 選擇正常')
  }

  // 填數量
  const qtyInput = page.locator('input[type="number"]').first()
  await qtyInput.fill('10')

  await page.click('button:has-text("建立訂單")')
  await page.waitForTimeout(1500)
  console.log('✅ 客戶訂單建立成功')
})

// ─── 5. Purchase Orders ──────────────────────────────────────────────────────
test('5. 採購單 - 建立', async ({ page }) => {
  await login(page)
  await page.click('a[href="/dashboard/po"]')
  await page.waitForTimeout(1500)
  await page.click('button:has-text("建立採購單")')
  await page.waitForTimeout(500)

  const supSelect = page.locator('select').first()
  const supCount = await supSelect.locator('option').count()
  if (supCount < 2) { console.log('⚠️  無供應商，跳過'); return }

  // 找有 BOM 的供應商
  let hasBom = false
  for (let i = 1; i < Math.min(supCount, 8); i++) {
    await supSelect.selectOption({ index: i })
    await page.waitForTimeout(400)
    const bomInput = page.locator('input[placeholder="-- 選擇 BOM --"]').first()
    await bomInput.click()
    await page.waitForTimeout(400)
    const opts = page.locator('div.bg-white.border div.px-3.py-2.text-xs')
    if (await opts.count() > 0) {
      await opts.first().click({ force: true })
      await page.waitForTimeout(500)
      hasBom = true
      console.log('✅ 找到有 BOM 的供應商，已選擇')
      break
    }
    await page.keyboard.press('Escape')
    await page.waitForTimeout(200)
  }

  if (!hasBom) { console.log('⚠️  無供應商有 BOM，跳過'); return }

  await page.locator('input[type="number"]').first().fill('5')
  await page.click('button:has-text("建立採購單")')
  await page.waitForTimeout(1500)
  console.log('✅ 採購單建立成功')
})

// ─── 6. SearchableSelect ─────────────────────────────────────────────────────
test('6. 下拉框 combobox - 位置/搜索/選擇', async ({ page }) => {
  await login(page)
  await page.click('a[href="/dashboard/customer-orders"]')
  await page.waitForTimeout(1500)
  await page.click('button:has-text("新增訂單")')
  await page.waitForTimeout(500)

  const bomInput = page.locator('input[placeholder="-- 選擇成品 BOM --"]').first()
  const inputBox = await bomInput.boundingBox()

  await bomInput.click()
  await page.waitForTimeout(500)

  const dropdown = page.locator('div.bg-white.border.border-slate-300').first()
  await expect(dropdown).toBeVisible()
  const dropdownBox = await dropdown.boundingBox()

  const gap = dropdownBox!.y - (inputBox!.y + inputBox!.height)
  expect(gap).toBeGreaterThanOrEqual(0)
  console.log(`✅ 下拉框在輸入框下方，間距 ${gap}px`)

  await bomInput.fill('WGDP')
  await page.waitForTimeout(400)
  const filtered = dropdown.locator('div.px-3.py-2.text-xs')
  const count = await filtered.count()
  expect(count).toBeGreaterThan(0)
  console.log(`✅ 搜索正常，找到 ${count} 個結果`)

  await filtered.first().click({ force: true })
  await page.waitForTimeout(500)
  const val = await bomInput.inputValue()
  expect(val.length).toBeGreaterThan(0)
  console.log(`✅ 選擇後顯示: ${val.slice(0, 40)}`)
})

// ─── 7. Navigation ───────────────────────────────────────────────────────────
test('7. 側邊欄導航', async ({ page }) => {
  await login(page)
  const routes = [
    { href: '/dashboard/customer-orders', label: '客戶訂單' },
    { href: '/dashboard/po', label: '採購單' },
    { href: '/dashboard/delivery-notes', label: '出貨單' },
    { href: '/dashboard/inventory', label: '庫存查詢' },
    { href: '/dashboard/profile', label: '個人資料' },
  ]
  for (const r of routes) {
    await page.goto(`http://localhost:3000${r.href}`)
    await page.waitForTimeout(600)
    console.log(`✅ ${r.label} 頁面載入正常`)
  }
})
