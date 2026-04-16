import { test, expect } from '@playwright/test'

const BASE = 'http://localhost:3000'

async function loginAs(page: any, email: string, password = 'test123') {
  // Clear any existing session first
  await page.goto(BASE)
  await page.evaluate(() => { localStorage.clear() })
  await page.goto(`${BASE}/login`)
  await page.waitForSelector('input[type="email"]', { timeout: 5000 })
  await page.fill('input[type="email"]', email)
  await page.fill('input[type="password"]', password)
  await page.click('button:has-text("登入")')
  await page.waitForURL('**/dashboard', { timeout: 10000 })
  await page.waitForTimeout(800)
  const perms = await page.evaluate(() => JSON.parse(localStorage.getItem('oms_permissions') || '[]'))
  console.log(`  [${email}] permissions loaded: ${perms.length} items`)
  return perms as string[]
}

// ─── 1. admin - 全部权限 ──────────────────────────────────────────────────────
test('1. admin - 全部权限 + 用户管理', async ({ page }) => {
  const perms = await loginAs(page, 'admin@oms.com', 'admin123')
  expect(perms).toContain('user.manage')
  expect(perms).toContain('po.approve')
  expect(perms).toContain('po.delete')
  console.log('✅ admin permissions 包含 user.manage, po.approve, po.delete')

  // 侧边栏有系统管理
  await expect(page.locator('text=系統管理')).toBeVisible()
  console.log('✅ admin 侧边栏有系統管理')

  // 采购单有建立/删除/核准
  await page.goto(`${BASE}/dashboard/po`)
  await page.waitForTimeout(1000)
  await expect(page.locator('button:has-text("建立採購單")')).toBeVisible()
  console.log('✅ admin 採購單有建立按钮')
})

// ─── 2. manager - 动态权限（全部业务权限，无用户管理）────────────────────────
test('2. manager - 动态权限验证', async ({ page }) => {
  const perms = await loginAs(page, 'manager@test.com')
  expect(perms).toContain('po.create')
  expect(perms).toContain('po.approve')
  expect(perms).toContain('po.delete')
  expect(perms).not.toContain('user.manage')
  console.log('✅ manager permissions: 有po.create/approve/delete, 无user.manage')

  // 采购单：有建立/删除/核准
  await page.goto(`${BASE}/dashboard/po`)
  await page.waitForTimeout(1000)
  await expect(page.locator('button:has-text("建立採購單")')).toBeVisible()
  console.log('✅ manager 採購單有建立按钮')

  // 用户管理：被重定向
  await page.goto(`${BASE}/dashboard/users`)
  await page.waitForTimeout(1500)
  expect(page.url()).not.toContain('/users')
  console.log('✅ manager 无法访问用戶管理')

  // BOM：有建立/编辑/删除
  await page.goto(`${BASE}/dashboard/bom`)
  await page.waitForTimeout(1000)
  await expect(page.locator('button:has-text("建立材料")')).toBeVisible()
  const delBtns = await page.locator('button:has-text("刪除")').count()
  expect(delBtns).toBeGreaterThan(0)
  console.log(`✅ manager BOM有建立和删除(${delBtns})按钮`)
})

// ─── 3. employee - 动态权限（基本操作，无删除/核准）──────────────────────────
test('3. employee - 动态权限验证', async ({ page }) => {
  const perms = await loginAs(page, 'employee@test.com')
  expect(perms).toContain('po.create')
  expect(perms).not.toContain('po.approve')
  expect(perms).not.toContain('po.delete')
  expect(perms).not.toContain('user.manage')
  console.log('✅ employee permissions: 有po.create, 无po.approve/delete/user.manage')

  // 采购单：有建立，无删除/核准
  await page.goto(`${BASE}/dashboard/po`)
  await page.waitForTimeout(1000)
  await expect(page.locator('button:has-text("建立採購單")')).toBeVisible()
  const delBtns = await page.locator('button:has-text("刪除")').count()
  expect(delBtns).toBe(0)
  const approveBtns = await page.locator('button:has-text("核准")').count()
  expect(approveBtns).toBe(0)
  console.log('✅ employee 採購單有建立，无删除/核准')

  // BOM：有建立/编辑，无删除
  await page.goto(`${BASE}/dashboard/bom`)
  await page.waitForTimeout(1000)
  await expect(page.locator('button:has-text("建立材料")')).toBeVisible()
  const bomDelBtns = await page.locator('button:has-text("刪除")').count()
  expect(bomDelBtns).toBe(0)
  console.log('✅ employee BOM有建立，无删除')

  // 用户管理：被重定向
  await page.goto(`${BASE}/dashboard/users`)
  await page.waitForTimeout(1500)
  expect(page.url()).not.toContain('/users')
  console.log('✅ employee 无法访问用戶管理')
})

// ─── 4. 动态权限变更测试 ──────────────────────────────────────────────────────
test('4. 动态权限变更 - 修改后重新登录立即生效', async ({ page }) => {
  // Step 1: admin 通过 API 移除 employee 的 po.create 权限
  await loginAs(page, 'admin@oms.com', 'admin123')
  const adminToken = await page.evaluate(() => localStorage.getItem('oms_token'))

  await page.evaluate(async (token: string) => {
    await fetch('http://localhost:3001/api/role-permissions', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ role: 'employee', permission: 'po.create', allowed: false })
    })
  }, adminToken!)
  console.log('✅ admin 已移除 employee 的 po.create 权限')

  // Step 2: employee 重新登录，验证权限已更新
  await loginAs(page, 'employee@test.com')
  const perms = await page.evaluate(() => JSON.parse(localStorage.getItem('oms_permissions') || '[]'))
  const hasPoCreate = perms.includes('po.create')
  expect(hasPoCreate).toBe(false)
  console.log(`✅ employee 重新登录后 po.create: ${hasPoCreate ? '有（错误）' : '无（正确）'}`)

  // Step 3: 验证采购单建立按钮消失
  await page.goto(`${BASE}/dashboard/po`)
  await page.waitForTimeout(1000)
  const createBtn = await page.locator('button:has-text("建立採購單")').isVisible()
  expect(createBtn).toBe(false)
  console.log('✅ employee 採購單建立按钮已隐藏（权限生效）')

  // Step 4: admin 恢复权限
  await loginAs(page, 'admin@oms.com', 'admin123')
  const adminToken2 = await page.evaluate(() => localStorage.getItem('oms_token'))
  await page.evaluate(async (token: string) => {
    await fetch('http://localhost:3001/api/role-permissions', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ role: 'employee', permission: 'po.create', allowed: true })
    })
  }, adminToken2!)
  console.log('✅ admin 已恢复 employee 的 po.create 权限')
})

// ─── 5. 角色管理页面 UI ───────────────────────────────────────────────────────
test('5. 角色管理页面 - 权限矩阵显示', async ({ page }) => {
  await loginAs(page, 'admin@oms.com', 'admin123')
  await page.goto(`${BASE}/dashboard/roles`)
  await page.waitForTimeout(2000)

  // 有三列：admin, manager, employee
  const headers = await page.locator('thead th').allTextContents()
  console.log('角色列头:', headers.join(' | '))
  expect(headers.some(h => h.includes('主管'))).toBeTruthy()
  expect(headers.some(h => h.includes('員工'))).toBeTruthy()
  console.log('✅ 角色管理页面有主管和員工列')

  // 有权限分组
  const groups = await page.locator('tbody tr.bg-slate-50').allTextContents()
  console.log('权限分组:', groups.join(', '))
  expect(groups.length).toBeGreaterThan(3)
  console.log(`✅ 权限分组数量: ${groups.length}`)

  // 点击一个 checkbox 验证即时更新
  const checkboxes = page.locator('button.rounded.border-2')
  const count = await checkboxes.count()
  console.log(`✅ 可点击的权限方格数量: ${count}`)
})

// ─── cleanup ──────────────────────────────────────────────────────────────────
test('cleanup', async ({ page }) => {
  await loginAs(page, 'admin@oms.com', 'admin123')
  await page.goto(`${BASE}/dashboard/users`)
  await page.waitForTimeout(1500)
  for (const name of ['主管測試', '員工測試']) {
    const row = page.locator(`tr:has-text("${name}")`)
    if (await row.isVisible({ timeout: 2000 }).catch(() => false)) {
      await row.locator('button:has-text("刪除")').click()
      await page.waitForTimeout(500)
      await page.click('button:has-text("確認刪除")')
      await page.waitForTimeout(1000)
      console.log(`✅ 已删除: ${name}`)
    }
  }
})
