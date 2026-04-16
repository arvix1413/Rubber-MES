import { test, expect } from '@playwright/test'

const BASE = 'http://localhost:3000'

async function loginAs(page: any, email: string, password = 'test123') {
  await page.goto(BASE)
  await page.fill('input[type="email"]', email)
  await page.fill('input[type="password"]', password)
  await page.click('button:has-text("登入")')
  await page.waitForURL('**/dashboard', { timeout: 10000 })
  await page.waitForTimeout(800)
}

// ─── viewer 角色 ─────────────────────────────────────────────────────────────
test('viewer - 只能查看，无新增/删除按钮', async ({ page }) => {
  await loginAs(page, 'viewer@test.com')

  // 客戶訂單：无新增按钮
  await page.goto(`${BASE}/dashboard/customer-orders`)
  await page.waitForTimeout(1000)
  await expect(page.locator('button:has-text("新增訂單")')).not.toBeVisible()
  console.log('✅ viewer - 客戶訂單无新增按钮')

  // 採購單：无建立按钮
  await page.goto(`${BASE}/dashboard/po`)
  await page.waitForTimeout(1000)
  await expect(page.locator('button:has-text("建立採購單")')).not.toBeVisible()
  console.log('✅ viewer - 採購單无建立按钮')

  // BOM：无建立按钮
  await page.goto(`${BASE}/dashboard/bom`)
  await page.waitForTimeout(1000)
  await expect(page.locator('button:has-text("建立材料")')).not.toBeVisible()
  console.log('✅ viewer - BOM无建立按钮')

  // 出貨單：无新增按钮
  await page.goto(`${BASE}/dashboard/delivery-notes`)
  await page.waitForTimeout(1000)
  await expect(page.locator('button:has-text("新增出貨單")')).not.toBeVisible()
  console.log('✅ viewer - 出貨單无新增按钮')

  // 用戶管理：应被重定向
  await page.goto(`${BASE}/dashboard/users`)
  await page.waitForTimeout(1500)
  const url = page.url()
  expect(url).not.toContain('/users')
  console.log('✅ viewer - 用戶管理被重定向')

  // 展开采购单，无删除按钮
  await page.goto(`${BASE}/dashboard/po`)
  await page.waitForTimeout(1500)
  const firstRow = page.locator('tbody tr').first()
  if (await firstRow.isVisible()) {
    await firstRow.click()
    await page.waitForTimeout(500)
    await expect(page.locator('button:has-text("刪除")')).not.toBeVisible()
    console.log('✅ viewer - 採購單无删除按钮')
  }
})

// ─── purchaser 角色 ───────────────────────────────────────────────────────────
test('purchaser - 可新增，不能删除/核准', async ({ page }) => {
  await loginAs(page, 'purchaser@test.com')

  // 客戶訂單：有新增按钮
  await page.goto(`${BASE}/dashboard/customer-orders`)
  await page.waitForTimeout(1000)
  await expect(page.locator('button:has-text("新增訂單")')).toBeVisible()
  console.log('✅ purchaser - 客戶訂單有新增按钮')

  // 採購單：有建立按钮
  await page.goto(`${BASE}/dashboard/po`)
  await page.waitForTimeout(1000)
  await expect(page.locator('button:has-text("建立採購單")')).toBeVisible()
  console.log('✅ purchaser - 採購單有建立按钮')

  // 採購單：展开后无删除按钮，无核准按钮
  const firstRow = page.locator('tbody tr').first()
  if (await firstRow.isVisible()) {
    await firstRow.click()
    await page.waitForTimeout(500)
    await expect(page.locator('button:has-text("刪除")')).not.toBeVisible()
    console.log('✅ purchaser - 採購單无删除按钮')
  }

  // 採購單列表：无核准按钮（StatusFlow中的核准）
  const approveBtn = page.locator('button:has-text("核准")')
  const approveCount = await approveBtn.count()
  expect(approveCount).toBe(0)
  console.log('✅ purchaser - 採購單无核准按钮')

  // BOM：有建立按钮，无删除按钮
  await page.goto(`${BASE}/dashboard/bom`)
  await page.waitForTimeout(1000)
  await expect(page.locator('button:has-text("建立材料")')).toBeVisible()
  await expect(page.locator('button:has-text("刪除")')).not.toBeVisible()
  console.log('✅ purchaser - BOM有建立无删除')

  // 用戶管理：应被重定向
  await page.goto(`${BASE}/dashboard/users`)
  await page.waitForTimeout(1500)
  expect(page.url()).not.toContain('/users')
  console.log('✅ purchaser - 用戶管理被重定向')
})

// ─── manager 角色 ─────────────────────────────────────────────────────────────
test('manager - 可新增/删除/核准，不能管理用户', async ({ page }) => {
  await loginAs(page, 'manager@test.com')

  // 採購單：有建立、删除、核准按钮
  await page.goto(`${BASE}/dashboard/po`)
  await page.waitForTimeout(1000)
  await expect(page.locator('button:has-text("建立採購單")')).toBeVisible()
  console.log('✅ manager - 採購單有建立按钮')

  // 展开后有删除按钮
  const firstRow = page.locator('tbody tr').first()
  if (await firstRow.isVisible()) {
    await firstRow.click()
    await page.waitForTimeout(500)
    const delBtn = page.locator('button:has-text("刪除")')
    const delCount = await delBtn.count()
    expect(delCount).toBeGreaterThan(0)
    console.log('✅ manager - 採購單有删除按钮')
  }

  // 通过 API 直接创建一个 draft PO（用 manager token）
  const managerToken = await page.evaluate(async () => {
    const res = await fetch('http://localhost:3001/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'manager@test.com', password: 'test123' })
    })
    const d = await res.json()
    return d.token
  })

  // 获取供应商列表
  const suppliers = await page.evaluate(async (token: string) => {
    const res = await fetch('http://localhost:3001/api/suppliers', { headers: { Authorization: `Bearer ${token}` } })
    return res.json()
  }, managerToken)

  if (suppliers.length > 0) {
    await page.evaluate(async ({ token, supplierId, supplierName }: any) => {
      await fetch('http://localhost:3001/api/po', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          supplier_id: supplierId, supplier_name: supplierName, currency: 'VND', remark: 'test',
          items: [{ material_code: 'TEST001', material_name: '測試物料', spec: '', unit: 'PCS', quantity: 1, unit_price: 100, total_price: 100, currency: 'VND', remark: '', po_ref: '', thickness: '' }]
        })
      })
    }, { token: managerToken, supplierId: suppliers[0].id, supplierName: suppliers[0].name })
    console.log('✅ manager - 通過API建立draft採購單')
  }

  // 刷新页面
  await page.reload()
  await page.waitForTimeout(2000)

  // 现在应该有核准按钮
  const approveBtn = page.locator('button:has-text("核准")')
  const approveCount = await approveBtn.count()
  expect(approveCount).toBeGreaterThan(0)
  console.log(`✅ manager - 採購單有核准按钮(${approveCount}个)`)

  // BOM：有建立、编辑、删除
  await page.goto(`${BASE}/dashboard/bom`)
  await page.waitForTimeout(1000)
  await expect(page.locator('button:has-text("建立材料")')).toBeVisible()
  const editBtns = await page.locator('button:has-text("編輯")').count()
  const delBtns = await page.locator('button:has-text("刪除")').count()
  expect(editBtns).toBeGreaterThan(0)
  expect(delBtns).toBeGreaterThan(0)
  console.log(`✅ manager - BOM有编辑(${editBtns})和删除(${delBtns})按钮`)

  // 用戶管理：应被重定向（manager不能管理用户）
  await page.goto(`${BASE}/dashboard/users`)
  await page.waitForTimeout(1500)
  expect(page.url()).not.toContain('/users')
  console.log('✅ manager - 用戶管理被重定向')

  // 侧边栏：无系统管理入口
  const adminNav = page.locator('text=使用者管理')
  await expect(adminNav).not.toBeVisible()
  console.log('✅ manager - 侧边栏无用户管理入口')
})

// ─── admin 角色 ───────────────────────────────────────────────────────────────
test('admin - 全部权限', async ({ page }) => {
  await loginAs(page, 'admin@oms.com', 'admin123')

  // 採購單：全部按钮
  await page.goto(`${BASE}/dashboard/po`)
  await page.waitForTimeout(1000)
  await expect(page.locator('button:has-text("建立採購單")')).toBeVisible()
  console.log('✅ admin - 採購單有建立按钮')

  // 用戶管理：可以访问
  await page.goto(`${BASE}/dashboard/users`)
  await page.waitForTimeout(1500)
  expect(page.url()).toContain('/users')
  await expect(page.locator('h1:has-text("用戶管理")')).toBeVisible()
  console.log('✅ admin - 可访问用戶管理')

  // 侧边栏有系统管理
  await page.goto(`${BASE}/dashboard`)
  await page.waitForTimeout(800)
  const adminSection = page.locator('text=系統管理')
  await expect(adminSection).toBeVisible()
  console.log('✅ admin - 侧边栏有系統管理入口')

  // 操作日志：可以访问
  await page.goto(`${BASE}/dashboard/audit-logs`)
  await page.waitForTimeout(1000)
  await expect(page.locator('h1:has-text("操作日誌")')).toBeVisible()
  console.log('✅ admin - 可访问操作日誌')
})

// ─── 清理测试用户 ─────────────────────────────────────────────────────────────
test('cleanup - 删除测试用户', async ({ page }) => {
  await loginAs(page, 'admin@oms.com', 'admin123')
  await page.goto(`${BASE}/dashboard/users`)
  await page.waitForTimeout(1500)

  // 删除 viewer/purchaser/manager 测试用户
  for (const name of ['只讀員工', '採購員工', '主管員工']) {
    const row = page.locator(`tr:has-text("${name}")`)
    if (await row.isVisible({ timeout: 2000 }).catch(() => false)) {
      await row.locator('button:has-text("刪除")').click()
      await page.waitForTimeout(500)
      await page.click('button:has-text("確認刪除")')
      await page.waitForTimeout(1000)
      console.log(`✅ 已删除测试用户: ${name}`)
    }
  }
})
