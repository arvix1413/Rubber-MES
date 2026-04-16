import { test } from '@playwright/test'

test('检查视口信息', async ({ page }) => {
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
  
  // 获取视口信息
  const viewportInfo = await page.evaluate(() => {
    return {
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      scrollY: window.scrollY,
      scrollX: window.scrollX
    }
  })
  
  console.log('\n=== 视口信息 ===')
  console.log(JSON.stringify(viewportInfo, null, 2))
  
  // 获取输入框位置
  const bomInput = page.locator('.oms-input.cursor-pointer').first()
  const inputBox = await bomInput.boundingBox()
  
  console.log('\n=== 输入框位置 ===')
  console.log('Top:', inputBox?.y)
  console.log('Bottom:', inputBox ? inputBox.y + inputBox.height : 0)
  
  if (inputBox && viewportInfo) {
    const spaceBelow = viewportInfo.innerHeight - (inputBox.y + inputBox.height)
    const spaceAbove = inputBox.y
    
    console.log('\n=== 空间计算 ===')
    console.log('下方空间:', spaceBelow, 'px')
    console.log('上方空间:', spaceAbove, 'px')
    console.log('是否应该向上展开:', spaceBelow < 150 ? '是' : '否')
  }
  
  await page.waitForTimeout(2000)
})
