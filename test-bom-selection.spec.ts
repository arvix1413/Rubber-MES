import { test } from '@playwright/test'

const FRONTEND_URL = 'http://43.133.56.234'

test('测试BOM选择和自动填充', async ({ page }) => {
  console.log('\n=== 测试BOM选择功能 ===\n')
  
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
  await supplierSelect.selectOption({ index: 4 }) // 选择第4个供应商（CÔNG TY IN ẤN NKV）
  await page.waitForTimeout(2000)
  console.log('✓ 已选择供应商')
  
  await page.screenshot({ path: 'test-results/bom-test-01-supplier-selected.png', fullPage: true })
  
  // 点击BOM选择器
  const bomSelector = page.locator('.oms-input.cursor-pointer').first()
  await bomSelector.click()
  await page.waitForTimeout(1000)
  console.log('✓ 点击BOM选择器')
  
  await page.screenshot({ path: 'test-results/bom-test-02-dropdown-opened.png', fullPage: true })
  
  // 检查BOM选项
  const bomOptions = page.locator('div.cursor-pointer.hover\\:bg-blue-50')
  const bomCount = await bomOptions.count()
  console.log(`\nBOM选项数: ${bomCount}`)
  
  if (bomCount === 0) {
    console.log('✗ 没有BOM选项')
    return
  }
  
  // 获取第一个BOM的文本
  const firstBomText = await bomOptions.first().textContent()
  console.log(`\n选择BOM: ${firstBomText}`)
  
  // 监听console日志
  page.on('console', msg => {
    if (msg.type() === 'log' || msg.type() === 'error') {
      console.log(`[浏览器] ${msg.type()}: ${msg.text()}`)
    }
  })
  
  // 选择第一个BOM
  await bomOptions.first().click()
  await page.waitForTimeout(2000)
  console.log('✓ 已点击BOM选项')
  
  await page.screenshot({ path: 'test-results/bom-test-03-after-selection.png', fullPage: true })
  
  // 检查是否自动填充了字段
  console.log('\n检查自动填充的字段:')
  
  // 材料名称
  const materialNameInput = page.locator('input[readonly]').first()
  const materialName = await materialNameInput.inputValue()
  console.log(`  材料名称: ${materialName || '(空)'}`)
  
  // 规格
  const specInput = page.locator('input[readonly]').nth(1)
  const spec = await specInput.inputValue()
  console.log(`  规格: ${spec || '(空)'}`)
  
  // 单位
  const unitInput = page.locator('input[readonly]').nth(2)
  const unit = await unitInput.inputValue()
  console.log(`  单位: ${unit || '(空)'}`)
  
  // 单价
  const priceInput = page.locator('input[type="number"]').nth(1)
  const price = await priceInput.inputValue()
  console.log(`  单价: ${price || '(空)'}`)
  
  // 检查结果
  if (!materialName) {
    console.log('\n✗✗✗ BUG确认：材料名称未自动填充 ✗✗✗')
  } else {
    console.log('\n✓✓✓ 自动填充正常工作 ✓✓✓')
  }
  
  // 测试客户订单
  console.log('\n\n=== 测试客户订单BOM选择 ===\n')
  
  await page.goto(`${FRONTEND_URL}/dashboard/customer-orders`)
  await page.waitForLoadState('networkidle')
  console.log('✓ 进入客户订单页面')
  
  await page.click('button:has-text("新增訂單")')
  await page.waitForTimeout(1000)
  console.log('✓ 打开创建表单')
  
  await page.screenshot({ path: 'test-results/bom-test-04-co-form.png', fullPage: true })
  
  // 填写必填字段
  const today = new Date().toISOString().split('T')[0]
  await page.locator('input[type="date"]').first().fill(today)
  await page.locator('input').filter({ hasText: '' }).nth(1).fill(`TEST-${Date.now()}`)
  
  // 选择客户
  const customerSelect = page.locator('select').first()
  await customerSelect.selectOption({ index: 1 })
  await page.waitForTimeout(1000)
  console.log('✓ 已选择客户')
  
  // 点击BOM选择器
  const coBomSelector = page.locator('.oms-input.cursor-pointer').first()
  await coBomSelector.click()
  await page.waitForTimeout(1000)
  console.log('✓ 点击BOM选择器')
  
  await page.screenshot({ path: 'test-results/bom-test-05-co-dropdown.png', fullPage: true })
  
  // 选择BOM
  const coBomOptions = page.locator('div.cursor-pointer.hover\\:bg-blue-50')
  const coBomCount = await coBomOptions.count()
  console.log(`\nBOM选项数: ${coBomCount}`)
  
  if (coBomCount > 0) {
    const firstCoBomText = await coBomOptions.first().textContent()
    console.log(`选择BOM: ${firstCoBomText}`)
    
    await coBomOptions.first().click()
    await page.waitForTimeout(2000)
    console.log('✓ 已点击BOM选项')
    
    await page.screenshot({ path: 'test-results/bom-test-06-co-after-selection.png', fullPage: true })
    
    // 检查自动填充
    console.log('\n检查客户订单自动填充:')
    
    const coSpecInput = page.locator('input[readonly]').first()
    const coSpec = await coSpecInput.inputValue()
    console.log(`  规格: ${coSpec || '(空)'}`)
    
    const coUnitInput = page.locator('input[readonly]').nth(1)
    const coUnit = await coUnitInput.inputValue()
    console.log(`  单位: ${coUnit || '(空)'}`)
    
    const coPriceInput = page.locator('input[type="number"]').nth(1)
    const coPrice = await coPriceInput.inputValue()
    console.log(`  单价: ${coPrice || '(空)'}`)
    
    if (!coSpec && !coUnit) {
      console.log('\n✗✗✗ BUG确认：客户订单字段未自动填充 ✗✗✗')
    } else {
      console.log('\n✓✓✓ 客户订单自动填充正常 ✓✓✓')
    }
  }
  
  console.log('\n=== 测试完成 ===\n')
})
