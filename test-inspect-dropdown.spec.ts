import { test } from '@playwright/test'

test('检查下拉框的style属性', async ({ page }) => {
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
  
  // 打开下拉框
  const bomInput = page.locator('.oms-input.cursor-pointer').first()
  await bomInput.click()
  await page.waitForTimeout(1000)
  
  // 获取下拉框元素
  const dropdown = page.locator('div.bg-white.border').first()
  
  // 获取style属性
  const style = await dropdown.getAttribute('style')
  console.log('\n=== 下拉框 style 属性 ===')
  console.log(style)
  
  // 获取计算后的样式
  const computedStyle = await dropdown.evaluate((el) => {
    const computed = window.getComputedStyle(el)
    return {
      position: computed.position,
      top: computed.top,
      bottom: computed.bottom,
      left: computed.left,
      width: computed.width,
      zIndex: computed.zIndex
    }
  })
  
  console.log('\n=== 计算后的样式 ===')
  console.log(JSON.stringify(computedStyle, null, 2))
  
  await page.waitForTimeout(2000)
})
