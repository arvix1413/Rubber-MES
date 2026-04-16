import { test } from '@playwright/test'

test('查看console输出', async ({ page }) => {
  // 监听console
  page.on('console', msg => {
    console.log('🔵', msg.text())
  })
  
  await page.goto('http://localhost:3000')
  
  // 登录
  await page.fill('input[type="email"]', 'admin@oms.com')
  await page.fill('input[type="password"]', 'admin123')
  await page.click('button:has-text("登入")')
  await page.waitForURL('**/dashboard', { timeout: 10000 })
  await page.waitForTimeout(1000)
  
  // 进入客户订单页面
  await page.click('a:has-text("客戶訂單")')
  await page.waitForTimeout(2000)
  
  // 点击新增订单
  await page.click('button:has-text("新增訂單")')
  await page.waitForTimeout(1000)
  
  console.log('\n=== 准备点击BOM下拉框 ===')
  
  // 打开BOM下拉框
  const bomInput = page.locator('.oms-input.cursor-pointer').first()
  await bomInput.click()
  await page.waitForTimeout(2000)
  
  console.log('\n=== 下拉框已打开 ===')
  
  await page.waitForTimeout(2000)
})
