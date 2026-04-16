import { test } from '@playwright/test'

test('强制刷新测试', async ({ page, context }) => {
  // 清除所有缓存
  await context.clearCookies()
  
  // 禁用缓存
  await context.route('**/*', route => {
    route.continue({
      headers: {
        ...route.request().headers(),
        'Cache-Control': 'no-cache, no-store, must-revalidate'
      }
    })
  })
  
  await page.goto('http://localhost:3000', { waitUntil: 'networkidle' })
  
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
  
  // 获取BOM输入框的位置
  const bomInput = page.locator('.oms-input.cursor-pointer').first()
  const inputBox = await bomInput.boundingBox()
  
  console.log('\n=== 输入框位置 ===')
  console.log('Bottom:', inputBox ? inputBox.y + inputBox.height : 0)
  
  // 打开下拉框
  await bomInput.click()
  await page.waitForTimeout(1000)
  
  // 获取下拉框的位置
  const dropdown = page.locator('div.bg-white.border').first()
  const dropdownBox = await dropdown.boundingBox()
  
  console.log('\n=== 下拉框位置 ===')
  console.log('Top:', dropdownBox?.y)
  
  if (inputBox && dropdownBox) {
    const inputBottom = inputBox.y + inputBox.height
    const dropdownTop = dropdownBox.y
    
    if (dropdownTop > inputBottom) {
      console.log('✅ 正确：下拉框在输入框下方，间距:', dropdownTop - inputBottom, 'px')
    } else {
      console.log('❌ 错误：下拉框在输入框上方，间距:', dropdownTop - inputBottom, 'px')
    }
  }
  
  await page.screenshot({ path: 'dropdown-fresh-test.png', fullPage: true })
  await page.waitForTimeout(2000)
})
