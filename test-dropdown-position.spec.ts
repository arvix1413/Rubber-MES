import { test, expect } from '@playwright/test'

test('验证下拉框位置 - 应该在输入框下方', async ({ page }) => {
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
  
  // 获取BOM输入框的位置
  const bomInput = page.locator('.oms-input.cursor-pointer').first()
  const inputBox = await bomInput.boundingBox()
  
  console.log('\n=== 输入框位置 ===')
  console.log('Top:', inputBox?.y)
  console.log('Bottom:', inputBox ? inputBox.y + inputBox.height : 0)
  console.log('Left:', inputBox?.x)
  console.log('Width:', inputBox?.width)
  
  // 打开下拉框
  await bomInput.click()
  await page.waitForTimeout(500)
  
  // 获取下拉框的位置
  const dropdown = page.locator('div.bg-white.border').first()
  const dropdownBox = await dropdown.boundingBox()
  
  console.log('\n=== 下拉框位置 ===')
  console.log('Top:', dropdownBox?.y)
  console.log('Bottom:', dropdownBox ? dropdownBox.y + dropdownBox.height : 0)
  console.log('Left:', dropdownBox?.x)
  console.log('Width:', dropdownBox?.width)
  
  // 验证下拉框在输入框下方
  if (inputBox && dropdownBox) {
    const inputBottom = inputBox.y + inputBox.height
    const dropdownTop = dropdownBox.y
    
    console.log('\n=== 位置关系 ===')
    console.log('输入框底部:', inputBottom)
    console.log('下拉框顶部:', dropdownTop)
    console.log('间距:', dropdownTop - inputBottom)
    
    if (dropdownTop > inputBottom) {
      console.log('✅ 正确：下拉框在输入框下方')
    } else {
      console.log('❌ 错误：下拉框在输入框上方或重叠')
    }
    
    // 验证间距合理（应该有4-8px的间距）
    const gap = dropdownTop - inputBottom
    if (gap >= 2 && gap <= 10) {
      console.log('✅ 间距合理:', gap, 'px')
    } else {
      console.log('⚠️  间距异常:', gap, 'px')
    }
  }
  
  // 截图
  await page.screenshot({ path: 'dropdown-position-test.png', fullPage: true })
  
  await page.waitForTimeout(2000)
})
