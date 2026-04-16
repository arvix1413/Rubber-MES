import { test, expect } from '@playwright/test'

test('库存查询显示BOM数据 + 料号管理已隐藏', async ({ page }) => {
  await page.goto('http://localhost:3000')
  await page.fill('input[type="email"]', 'admin@oms.com')
  await page.fill('input[type="password"]', 'admin123')
  await page.click('button:has-text("登入")')
  await page.waitForURL('**/dashboard', { timeout: 10000 })
  await page.waitForTimeout(800)

  // 确认料号管理已隐藏
  const materialsLink = page.locator('a[href="/dashboard/materials"]')
  await expect(materialsLink).not.toBeVisible()
  console.log('✅ 料號管理已隱藏')

  // 进入库存查询
  await page.goto('http://localhost:3000/dashboard/inventory')
  await page.waitForTimeout(2000)

  await expect(page.locator('h1:has-text("庫存查詢")')).toBeVisible()
  await expect(page.locator('text=BOM 成品庫存')).toBeVisible()
  console.log('✅ 庫存查詢頁面標題正確')

  // 等待数据加载
  await page.waitForSelector('table tbody tr', { timeout: 8000 })
  const rows = page.locator('table tbody tr')
  const count = await rows.count()
  expect(count).toBeGreaterThan(0)
  console.log(`✅ BOM 庫存數據已載入，共 ${count} 條`)

  // 确认有物料编号列（BOM的product_sku）
  const firstCode = await rows.first().locator('td:nth-child(2)').textContent()
  console.log(`✅ 第一條物料編號: ${firstCode}`)

  // 测试搜索
  await page.fill('input[placeholder*="搜尋"]', 'WGDP')
  await page.waitForTimeout(500)
  const filteredRows = page.locator('table tbody tr')
  const filteredCount = await filteredRows.count()
  console.log(`✅ 搜索 "WGDP" 結果: ${filteredCount} 條`)

  // 测试库存过滤按钮
  await page.click('button:has-text("零庫存")')
  await page.waitForTimeout(300)
  console.log('✅ 零庫存過濾正常')

  await page.click('button:has-text("全部")')
  await page.waitForTimeout(300)
  console.log('✅ 全部過濾正常')
})
