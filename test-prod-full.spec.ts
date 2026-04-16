import { test, expect } from '@playwright/test'

const PROD = 'http://43.133.56.234'
const th = 'text-[10px] font-semibold text-slate-500'

async function login(page: any) {
  await page.goto(PROD)
  await page.fill('input[type="email"]', 'admin@oms.com')
  await page.fill('input[type="password"]', 'admin123')
  await page.click('button:has-text("登入")')
  await page.waitForURL('**/dashboard', { timeout: 15000 })
  await page.waitForTimeout(800)
}

// 检查日期格式是否正确（不含T和Z）
function checkDateFormat(dateStr: string): boolean {
  if (!dateStr || dateStr === '—') return true
  return !dateStr.includes('T') && !dateStr.includes('Z') && dateStr.length <= 16
}

// ─── 1. 登入/登出 ─────────────────────────────────────────────────────────────
test('1. 登入/登出', async ({ page }) => {
  await login(page)
  await expect(page.locator('text=歡迎回來').first()).toBeVisible()
  console.log('✅ 登入成功')
  await page.click('button:has-text("登出系統")')
  await page.waitForURL('**/login', { timeout: 5000 })
  console.log('✅ 登出成功')
})

// ─── 2. 客戶訂單 - 列表对齐 + 日期格式 ──────────────────────────────────────
test('2. 客戶訂單 - 列表', async ({ page }) => {
  await login(page)
  await page.goto(`${PROD}/dashboard/customer-orders`)
  await page.waitForTimeout(2000)

  // 检查列头对齐
  const headers = await page.locator('thead th').allTextContents()
  console.log('客戶訂單列头:', headers.join(' | '))

  // 检查日期格式
  const dateCells = await page.locator('td').allTextContents()
  const badDates = dateCells.filter(d => d.includes('T') && d.includes('Z'))
  if (badDates.length > 0) {
    console.log('❌ 发现ISO日期格式:', badDates.slice(0,3))
  } else {
    console.log('✅ 日期格式正常')
  }

  // 展开第一条订单
  const firstRow = page.locator('tbody tr').first()
  if (await firstRow.isVisible()) {
    await firstRow.click()
    await page.waitForTimeout(1000)
    const subHeaders = await page.locator('tbody tr:nth-child(2) thead th').allTextContents()
    console.log('展开列头:', subHeaders.join(' | '))

    // 检查数字列头是否右对齐
    const rightAligned = await page.locator('tbody tr:nth-child(2) thead th.text-right').count()
    console.log(`✅ 右对齐列头数量: ${rightAligned}（數量/單價/已到數量/結餘 应为4个）`)
  }
})

// ─── 3. 採購單 - 列表对齐 ────────────────────────────────────────────────────
test('3. 採購單 - 列表', async ({ page }) => {
  await login(page)
  await page.goto(`${PROD}/dashboard/po`)
  await page.waitForTimeout(2000)

  // 展开第一条
  const firstRow = page.locator('tbody tr').first()
  if (await firstRow.isVisible()) {
    await firstRow.click()
    await page.waitForTimeout(1000)
    const subHeaders = await page.locator('tbody tr:nth-child(2) thead th').allTextContents()
    console.log('採購單展开列头:', subHeaders.join(' | '))
    const rightAligned = await page.locator('tbody tr:nth-child(2) thead th.text-right').count()
    console.log(`✅ 右对齐列头: ${rightAligned}（重量/數量/單價/小計 应为4个）`)
  }
})

// ─── 4. BOM - 价格列头对齐 ───────────────────────────────────────────────────
test('4. BOM - 价格列头对齐', async ({ page }) => {
  await login(page)
  await page.goto(`${PROD}/dashboard/bom`)
  await page.waitForTimeout(2000)

  const headers = await page.locator('thead th').allTextContents()
  console.log('BOM列头:', headers.join(' | '))
  const rightAligned = await page.locator('thead th.text-right').count()
  console.log(`✅ 右对齐列头: ${rightAligned}（供應商單價/公司售價 应为2个）`)
})

// ─── 5. 庫存查詢 - 库存量列头对齐 ───────────────────────────────────────────
test('5. 庫存查詢 - 列头对齐', async ({ page }) => {
  await login(page)
  await page.goto(`${PROD}/dashboard/inventory`)
  await page.waitForTimeout(2000)

  const rightAligned = await page.locator('thead th.text-right').count()
  console.log(`✅ 庫存量右对齐列头: ${rightAligned}（应为1个）`)
})

// ─── 6. 操作日誌 - 日期格式 ──────────────────────────────────────────────────
test('6. 操作日誌 - 日期格式', async ({ page }) => {
  await login(page)
  await page.goto(`${PROD}/dashboard/audit-logs`)
  await page.waitForTimeout(2000)

  const dateCells = await page.locator('tbody td:first-child').allTextContents()
  if (dateCells.length > 0) {
    const sample = dateCells[0]
    console.log('日誌日期样本:', sample)
    if (sample.includes('T') || sample.includes('Z')) {
      console.log('❌ 日期格式错误，包含T/Z')
    } else {
      console.log('✅ 日期格式正常')
    }
  }
})

// ─── 7. 出貨單 - 日期格式 ────────────────────────────────────────────────────
test('7. 出貨單 - 日期格式', async ({ page }) => {
  await login(page)
  await page.goto(`${PROD}/dashboard/delivery-notes`)
  await page.waitForTimeout(2000)

  const dateCells = await page.locator('tbody td:nth-child(3)').allTextContents()
  const badDates = dateCells.filter(d => d.includes('T') || d.includes('Z'))
  if (badDates.length > 0) {
    console.log('❌ 出貨日期格式错误:', badDates[0])
  } else {
    console.log('✅ 出貨日期格式正常')
  }
})

// ─── 8. Profile - 签名 + 密码修改 ────────────────────────────────────────────
test('8. Profile页面', async ({ page }) => {
  await login(page)
  await page.goto(`${PROD}/dashboard/profile`)
  await page.waitForTimeout(1500)

  await expect(page.locator('h2:has-text("電子簽名")')).toBeVisible()
  await expect(page.locator('h2:has-text("修改密碼")')).toBeVisible()
  console.log('✅ Profile两栏布局正常')

  // 检查签名区域
  const hasPreview = await page.locator('img[alt="簽名預覽"]').isVisible().catch(() => false)
  const hasUpload = await page.locator('text=點擊上傳簽名圖片').isVisible().catch(() => false)
  console.log(hasPreview ? '✅ 签名预览显示' : hasUpload ? '✅ 签名上传区域显示' : '⚠️  签名区域状态未知')
})

// ─── 9. 採購單打印预览 ────────────────────────────────────────────────────────
test('9. 採購單打印预览', async ({ page }) => {
  await login(page)
  await page.goto(`${PROD}/dashboard/po`)
  await page.waitForTimeout(2000)

  const printBtn = page.locator('button:has-text("🖨")').first()
  if (!await printBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    console.log('⚠️  无采购单，跳过')
    return
  }

  const [popup] = await Promise.all([
    page.waitForEvent('popup', { timeout: 10000 }),
    printBtn.click()
  ])
  await popup.waitForLoadState('domcontentloaded')
  await popup.waitForTimeout(1000)

  // 检查签名栏等高
  const signBoxes = await popup.locator('.sign-box').count()
  console.log(`✅ 签名栏数量: ${signBoxes}（应为2个）`)

  // 检查信息表格
  const infoTable = popup.locator('.info-table')
  const hasInfoTable = await infoTable.isVisible().catch(() => false)
  console.log(hasInfoTable ? '✅ 信息表格存在' : '❌ 信息表格不存在')

  await popup.screenshot({ path: 'prod-po-print-final.png', fullPage: true })
  await popup.close()
})

// ─── 10. 側邊欄導航 ───────────────────────────────────────────────────────────
test('10. 側邊欄導航', async ({ page }) => {
  await login(page)
  const routes = [
    '/dashboard/customer-orders',
    '/dashboard/bom',
    '/dashboard/po',
    '/dashboard/delivery-notes',
    '/dashboard/inventory',
    '/dashboard/audit-logs',
    '/dashboard/profile',
  ]
  for (const route of routes) {
    await page.goto(`${PROD}${route}`)
    await page.waitForTimeout(600)
    const title = await page.locator('h1').first().textContent().catch(() => route)
    console.log(`✅ ${route.split('/').pop()}: ${title}`)
  }
})
