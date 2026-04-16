import { test, expect, Page } from '@playwright/test'

const PROD = 'http://43.133.56.234'

async function login(page: Page) {
  await page.goto(`${PROD}/login`)
  await page.fill('input[type="email"]', 'admin@oms.com')
  await page.fill('input[type="password"]', 'admin123')
  await page.click('button[type="submit"]')
  await page.waitForURL('**/dashboard', { timeout: 15000 })
  await page.waitForTimeout(600)
}

async function openRoute(page: Page, route: string) {
  await page.goto(`${PROD}${route}`)
  await page.waitForLoadState('domcontentloaded')
  await page.waitForTimeout(700)
  const title = (await page.locator('h1').first().textContent().catch(() => ''))?.trim() || '(no h1)'
  const createBtn = await page.locator('button:has-text("新增"), button:has-text("建立"), button:has-text("+ ")').count()
  const editBtn = await page.locator('button:has-text("編輯")').count()
  const delBtn = await page.locator('button:has-text("刪除")').count()
  console.log(`[Route] ${route} | ${title} | C:${createBtn > 0 ? 'Y' : 'N'} U:${editBtn > 0 ? 'Y' : 'N'} D:${delBtn > 0 ? 'Y' : 'N'}`)
}

test('A. 全界面走查（逐页进入）', async ({ page }) => {
  await login(page)
  const routes = [
    '/dashboard',
    '/dashboard/customer-orders',
    '/dashboard/quotations',
    '/dashboard/bom',
    '/dashboard/po',
    '/dashboard/production',
    '/dashboard/delivery-notes',
    '/dashboard/customers',
    '/dashboard/suppliers',
    '/dashboard/inventory',
    '/dashboard/stock-ledger',
    '/dashboard/stock-adjustments',
    '/dashboard/company',
    '/dashboard/roles',
    '/dashboard/users',
    '/dashboard/audit-logs',
    '/dashboard/profile',
  ]

  for (const route of routes) {
    await openRoute(page, route)
    await expect(page).toHaveURL(new RegExp(route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  }
})

test('B. 客户管理 CRUD', async ({ page }) => {
  await login(page)
  const uid = Date.now().toString().slice(-6)
  const code = `AUTO-C-${uid}`
  const name = `自动客户${uid}`
  const name2 = `${name}-改`

  await page.goto(`${PROD}/dashboard/customers`)
  await page.click('button:has-text("新增客戶")')

  const modal = page.locator('.fixed .bg-white').first()
  await modal.locator('input').nth(0).fill(code)
  await modal.locator('input').nth(1).fill(name)
  await modal.locator('input').nth(4).fill('0912345678')
  await modal.locator('input').nth(5).fill(`c${uid}@test.com`)
  await modal.locator('button:has-text("儲存")').click()

  const search = page.locator('input[placeholder*="搜尋客戶名稱或編號"]')
  await search.fill(code)
  await page.waitForTimeout(1200)
  const row = page.locator('tr', { hasText: code }).first()
  await expect(row).toBeVisible()

  await row.locator('button:has-text("編輯")').click()
  const editModal = page.locator('.fixed .bg-white').first()
  await editModal.locator('input').nth(1).fill(name2)
  await editModal.locator('button:has-text("儲存")').click()

  await search.fill(code)
  await page.waitForTimeout(1000)
  const updatedRow = page.locator('tr', { hasText: code }).first()
  await expect(updatedRow).toContainText(name2)

  await updatedRow.locator('button:has-text("刪除")').click()
  await page.locator('button:has-text("確認")').last().click()
  await page.waitForTimeout(1200)
  await search.fill(code)
  await page.waitForTimeout(1000)
  await expect(page.locator('tr', { hasText: code })).toHaveCount(0)
})

test('C. 供应商管理 CRUD', async ({ page }) => {
  await login(page)
  const uid = Date.now().toString().slice(-6)
  const code = `AUTO-S-${uid}`
  const name = `自动供应商${uid}`
  const name2 = `${name}-改`

  await page.goto(`${PROD}/dashboard/suppliers`)
  await page.click('button:has-text("新增供應商")')

  const modal = page.locator('.fixed .bg-white').first()
  await modal.locator('input').nth(0).fill(code)
  await modal.locator('input').nth(1).fill(name)
  await modal.locator('input').nth(4).fill('0912345678')
  await modal.locator('input').nth(5).fill(`s${uid}@test.com`)
  await modal.locator('button:has-text("儲存")').click()

  const search = page.locator('input[placeholder*="搜尋供應商名稱或編號"]')
  await search.fill(code)
  await page.waitForTimeout(1200)
  const row = page.locator('tr', { hasText: code }).first()
  await expect(row).toBeVisible()

  await row.locator('button:has-text("編輯")').click()
  const editModal = page.locator('.fixed .bg-white').first()
  await editModal.locator('input').nth(1).fill(name2)
  await editModal.locator('button:has-text("儲存")').click()

  await search.fill(code)
  await page.waitForTimeout(1000)
  const updatedRow = page.locator('tr', { hasText: code }).first()
  await expect(updatedRow).toContainText(name2)

  await updatedRow.locator('button:has-text("刪除")').click()
  await page.locator('button:has-text("確認")').last().click()
  await page.waitForTimeout(1200)
  await search.fill(code)
  await page.waitForTimeout(1000)
  await expect(page.locator('tr', { hasText: code })).toHaveCount(0)
})

test('D. 用户管理 CRUD', async ({ page }) => {
  await login(page)
  const uid = Date.now().toString().slice(-6)
  const email = `auto${uid}@test.com`
  const name = `自动用户${uid}`
  const name2 = `${name}-改`

  await page.goto(`${PROD}/dashboard/users`)
  await page.click('button:has-text("新增用戶")')

  const form = page.locator('.oms-card', { hasText: '新增用戶' }).first()
  await form.locator('input[type="email"]').fill(email)
  await form.locator('input[placeholder="用戶姓名"]').fill(name)
  await form.locator('select').first().selectOption('manager')
  await form.locator('input[type="password"]').fill('admin123')
  await form.locator('button:has-text("建立用戶")').click()

  const search = page.locator('input[placeholder*="搜尋姓名或Email"]')
  await search.fill(email)
  await page.waitForTimeout(1200)
  const row = page.locator('tr', { hasText: email }).first()
  await expect(row).toBeVisible()

  await row.locator('button:has-text("編輯")').click()
  const editForm = page.locator('.oms-card', { hasText: '編輯用戶資料' }).first()
  await editForm.locator('input[placeholder="用戶姓名"]').fill(name2)
  await editForm.locator('button:has-text("儲存變更")').click()

  await search.fill(email)
  await page.waitForTimeout(1200)
  const updatedRow = page.locator('tr', { hasText: email }).first()
  await expect(updatedRow).toContainText(name2)

  await updatedRow.locator('button:has-text("刪除")').click()
  await page.locator('button:has-text("確認")').last().click()
  await page.waitForTimeout(1200)
  await search.fill(email)
  await page.waitForTimeout(1000)
  await expect(page.locator('tr', { hasText: email })).toHaveCount(0)
})
