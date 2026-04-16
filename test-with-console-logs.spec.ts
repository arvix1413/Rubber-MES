import { test } from '@playwright/test'

const FRONTEND_URL = 'http://43.133.56.234'

test('测试BOM选择并捕获所有console日志', async ({ page }) => {
  const consoleLogs: string[] = []
  const consoleErrors: string[] = []
  
  // 捕获所有console消息
  page.on('console', msg => {
    const text = `[${msg.type()}] ${msg.text()}`
    consoleLogs.push(text)
    console.log(text)
  })
  
  // 捕获错误
  page.on('pageerror', error => {
    const text = `[ERROR] ${error.message}`
    consoleErrors.push(text)
    console.log(text)
  })
  
  console.log('\n=== 开始测试 ===\n')
  
  // 登录
  await page.goto(`${FRONTEND_URL}/login`)
  await page.fill('input[type="email"]', 'admin@oms.com')
  await page.fill('input[type="password"]', 'admin123')
  await page.click('button[type="submit"]')
  await page.waitForURL('**/dashboard')
  console.log('✓ 登录成功')
  
  // 进入采购单页面
  await page.goto(`${FRONTEND_URL}/dashboard/po`)
  await page.waitForLoadState('networkidle')
  console.log('✓ 进入采购单页面')
  
  // 点击建立采购单
  await page.click('button:has-text("建立採購單")')
  await page.waitForTimeout(1000)
  console.log('✓ 打开创建表单')
  
  // 选择供应商
  const supplierSelect = page.locator('select').first()
  await supplierSelect.selectOption({ index: 4 })
  await page.waitForTimeout(2000)
  console.log('✓ 已选择供应商')
  
  // 清空之前的日志
  consoleLogs.length = 0
  
  console.log('\n--- 准备选择BOM，开始监听console ---\n')
  
  // 点击BOM选择器
  const bomSelector = page.locator('.oms-input.cursor-pointer').first()
  await bomSelector.click()
  await page.waitForTimeout(1000)
  console.log('✓ 点击BOM选择器')
  
  // 选择BOM
  const bomOptions = page.locator('div.cursor-pointer.hover\\:bg-blue-50')
  const bomCount = await bomOptions.count()
  console.log(`\nBOM选项数: ${bomCount}`)
  
  if (bomCount > 0) {
    const firstBomText = await bomOptions.first().textContent()
    console.log(`选择BOM: ${firstBomText}`)
    
    await bomOptions.first().click()
    await page.waitForTimeout(3000)
    console.log('✓ 已点击BOM')
    
    console.log('\n--- 选择BOM后的console日志 ---\n')
    
    if (consoleLogs.length === 0) {
      console.log('⚠️ 没有捕获到任何console日志')
      console.log('这意味着：')
      console.log('1. selectBOM函数没有被调用')
      console.log('2. 或者生产环境的代码还没有更新')
    } else {
      console.log(`捕获到 ${consoleLogs.length} 条日志：`)
      consoleLogs.forEach(log => console.log(`  ${log}`))
    }
    
    if (consoleErrors.length > 0) {
      console.log('\n--- JavaScript错误 ---\n')
      consoleErrors.forEach(err => console.log(`  ${err}`))
    }
    
    // 检查表单状态
    console.log('\n--- 检查表单字段 ---\n')
    
    const materialNameInput = page.locator('input[readonly]').first()
    const materialName = await materialNameInput.inputValue()
    console.log(`材料名称: ${materialName || '(空)'}`)
    
    const specInput = page.locator('input[readonly]').nth(1)
    const spec = await specInput.inputValue()
    console.log(`规格: ${spec || '(空)'}`)
    
    const unitInput = page.locator('input[readonly]').nth(2)
    const unit = await unitInput.inputValue()
    console.log(`单位: ${unit || '(空)'}`)
    
    const priceInput = page.locator('input[type="number"]').nth(1)
    const price = await priceInput.inputValue()
    console.log(`单价: ${price || '(空)'}`)
    
    // 判断
    console.log('\n--- 测试结果 ---\n')
    
    if (!materialName) {
      console.log('✗ BUG确认：材料名称未填充')
      
      if (consoleLogs.some(log => log.includes('selectBOM called'))) {
        console.log('  → selectBOM函数被调用了')
        
        if (consoleLogs.some(log => log.includes('Found BOM'))) {
          console.log('  → 找到了BOM数据')
          console.log('  → 问题可能在React状态更新')
        } else {
          console.log('  → 没有找到BOM数据')
          console.log('  → 问题可能在BOM查找逻辑')
        }
      } else {
        console.log('  → selectBOM函数没有被调用')
        console.log('  → 问题可能在onChange回调')
      }
    } else {
      console.log('✓ 自动填充正常工作')
    }
  }
  
  await page.screenshot({ path: 'test-results/console-test-result.png', fullPage: true })
  console.log('\n✓ 截图已保存\n')
})
