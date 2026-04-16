import { test } from '@playwright/test'

test('手动查看下拉框UI', async ({ page }) => {
  // 导航到本地前端
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
  
  // 打开BOM下拉框
  const bomDropdown = page.locator('.oms-input.cursor-pointer').first()
  await bomDropdown.click()
  await page.waitForTimeout(1000)
  
  console.log('\n=== 下拉框已打开，请手动查看UI ===')
  console.log('检查点：')
  console.log('1. 下拉框位置是否正确？')
  console.log('2. 搜索框是否自动聚焦？')
  console.log('3. 选项列表是否清晰？')
  console.log('4. 鼠标悬停效果是否自然？')
  console.log('5. 点击选项后是否正常关闭？')
  
  // 保持浏览器打开60秒供手动测试
  await page.waitForTimeout(60000)
})
