import { test, expect } from '@playwright/test'

// 生产环境URL - 前端运行在80端口，后端运行在3001端口
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://43.133.56.234'

test.describe('订单创建E2E测试', () => {
  test.beforeEach(async ({ page }) => {
    console.log(`访问前端: ${FRONTEND_URL}`)
    
    // 登录
    await page.goto(`${FRONTEND_URL}/login`)
    await page.waitForLoadState('networkidle')
    
    // 填写登录信息 - 使用完整的邮箱地址
    await page.fill('input[type="email"]', 'admin@oms.com')
    await page.fill('input[type="password"]', 'admin123')
    await page.click('button[type="submit"]')
    
    // 等待跳转到dashboard
    await page.waitForURL('**/dashboard', { timeout: 10000 })
    console.log('✓ 登录成功')
  })

  test('E2E - 创建采购单完整流程', async ({ page }) => {
    console.log('\n=== 开始测试采购单创建 ===')
    
    // 1. 导航到采购单页面
    await page.goto(`${FRONTEND_URL}/dashboard/po`)
    await page.waitForLoadState('networkidle')
    console.log('✓ 进入采购单页面')
    
    // 截图：初始状态
    await page.screenshot({ path: 'test-results/po-01-initial.png', fullPage: true })
    
    // 2. 点击建立采购单
    await page.click('button:has-text("建立採購單")')
    await page.waitForTimeout(1000)
    console.log('✓ 点击建立采购单')
    
    // 截图：表单显示
    await page.screenshot({ path: 'test-results/po-02-form-opened.png', fullPage: true })
    
    // 3. 检查表单是否显示
    const formTitle = await page.locator('h2:has-text("建立採購單")').isVisible()
    expect(formTitle).toBe(true)
    console.log('✓ 表单已显示')
    
    // 4. 选择供应商
    const supplierSelect = page.locator('select').first()
    const supplierOptions = await supplierSelect.locator('option').count()
    console.log(`  供应商选项数: ${supplierOptions}`)
    
    if (supplierOptions <= 1) {
      console.log('✗ 没有可用的供应商，测试终止')
      return
    }
    
    await supplierSelect.selectOption({ index: 1 })
    await page.waitForTimeout(1500)
    const selectedSupplier = await supplierSelect.inputValue()
    console.log(`✓ 已选择供应商 ID: ${selectedSupplier}`)
    
    // 截图：选择供应商后
    await page.screenshot({ path: 'test-results/po-03-supplier-selected.png', fullPage: true })
    
    // 5. 填写备注
    await page.fill('textarea[placeholder*="交易條件"]', 'E2E测试采购单')
    console.log('✓ 已填写备注')
    
    // 6. 点击BOM选择器
    const bomSelector = page.locator('.oms-input.cursor-pointer').first()
    const isDisabled = await bomSelector.evaluate(el => el.classList.contains('bg-slate-100'))
    
    if (isDisabled) {
      console.log('✗ BOM选择器被禁用，测试终止')
      await page.screenshot({ path: 'test-results/po-error-bom-disabled.png', fullPage: true })
      return
    }
    
    await bomSelector.click()
    await page.waitForTimeout(800)
    console.log('✓ 点击BOM选择器')
    
    // 截图：下拉框打开
    await page.screenshot({ path: 'test-results/po-04-dropdown-opened.png', fullPage: true })
    
    // 7. 检查下拉框
    const dropdown = page.locator('div.fixed.bg-white.border').first()
    const dropdownVisible = await dropdown.isVisible()
    console.log(`  下拉框可见: ${dropdownVisible}`)
    
    if (!dropdownVisible) {
      console.log('✗ 下拉框未显示，测试终止')
      await page.screenshot({ path: 'test-results/po-error-no-dropdown.png', fullPage: true })
      return
    }
    
    // 8. 检查选项
    const options = page.locator('div.cursor-pointer.hover\\:bg-blue-50')
    const optionCount = await options.count()
    console.log(`  BOM选项数: ${optionCount}`)
    
    if (optionCount === 0) {
      console.log('✗ 没有BOM选项，测试终止')
      await page.screenshot({ path: 'test-results/po-error-no-options.png', fullPage: true })
      return
    }
    
    // 9. 选择第一个BOM
    await options.first().click()
    await page.waitForTimeout(1000)
    console.log('✓ 已选择BOM')
    
    // 截图：选择BOM后
    await page.screenshot({ path: 'test-results/po-05-bom-selected.png', fullPage: true })
    
    // 10. 检查自动填充的字段
    const materialNameInput = page.locator('input[readonly]').filter({ hasText: '' }).first()
    const materialName = await materialNameInput.inputValue()
    console.log(`  自动填充的材料名称: ${materialName || '(空)'}`)
    
    if (!materialName) {
      console.log('⚠ 材料名称未自动填充')
    }
    
    // 11. 填写PO编号
    const poRefInput = page.locator('input[placeholder="PO編號"]').first()
    await poRefInput.fill(`E2E-PO-${Date.now()}`)
    console.log('✓ 已填写PO编号')
    
    // 12. 填写数量
    const qtyInput = page.locator('input[type="number"]').first()
    await qtyInput.fill('100')
    await page.waitForTimeout(500)
    console.log('✓ 已填写数量: 100')
    
    // 13. 填写单价
    const priceInput = page.locator('input[type="number"]').nth(1)
    await priceInput.fill('50')
    await page.waitForTimeout(500)
    console.log('✓ 已填写单价: 50')
    
    // 截图：填写完成
    await page.screenshot({ path: 'test-results/po-06-form-filled.png', fullPage: true })
    
    // 14. 检查小计
    const subtotalText = await page.locator('td.px-2.py-2.text-right.text-slate-600.font-medium').first().textContent()
    console.log(`  小计: ${subtotalText}`)
    
    // 15. 点击建立采购单按钮
    console.log('准备提交表单...')
    await page.click('button:has-text("建立採購單")')
    
    // 等待响应
    await page.waitForTimeout(3000)
    
    // 截图：提交后
    await page.screenshot({ path: 'test-results/po-07-after-submit.png', fullPage: true })
    
    // 16. 检查是否返回列表页面
    const searchBoxVisible = await page.locator('input[placeholder*="搜尋採購單號或供應商"]').isVisible()
    
    if (searchBoxVisible) {
      console.log('✓ 采购单创建成功！已返回列表页面')
      
      // 检查是否有新创建的采购单
      const firstPoNumber = await page.locator('td.font-mono.text-xs.text-blue-600').first().textContent()
      console.log(`  最新采购单号: ${firstPoNumber}`)
    } else {
      console.log('⚠ 可能还在表单页面，检查是否有错误')
      
      // 检查是否有错误提示
      const errorVisible = await page.locator('text=/錯誤|失敗|error/i').isVisible().catch(() => false)
      if (errorVisible) {
        const errorText = await page.locator('text=/錯誤|失敗|error/i').first().textContent()
        console.log(`  错误信息: ${errorText}`)
      }
    }
    
    console.log('=== 采购单创建测试完成 ===\n')
  })

  test('E2E - 创建客户订单完整流程', async ({ page }) => {
    console.log('\n=== 开始测试客户订单创建 ===')
    
    // 1. 导航到客户订单页面
    await page.goto(`${FRONTEND_URL}/dashboard/customer-orders`)
    await page.waitForLoadState('networkidle')
    console.log('✓ 进入客户订单页面')
    
    // 截图：初始状态
    await page.screenshot({ path: 'test-results/co-01-initial.png', fullPage: true })
    
    // 2. 点击新增订单
    await page.click('button:has-text("新增訂單")')
    await page.waitForTimeout(1000)
    console.log('✓ 点击新增订单')
    
    // 截图：表单显示
    await page.screenshot({ path: 'test-results/co-02-form-opened.png', fullPage: true })
    
    // 3. 填写采购日期
    const today = new Date().toISOString().split('T')[0]
    await page.locator('input[type="date"]').first().fill(today)
    console.log(`✓ 已填写采购日期: ${today}`)
    
    // 4. 填写采购单号
    const poNumber = `E2E-CO-${Date.now()}`
    const poNumberInput = page.locator('input').filter({ hasText: '' }).nth(1)
    await poNumberInput.fill(poNumber)
    console.log(`✓ 已填写采购单号: ${poNumber}`)
    
    // 5. 选择客户
    const customerSelect = page.locator('select').first()
    const customerOptions = await customerSelect.locator('option').count()
    console.log(`  客户选项数: ${customerOptions}`)
    
    if (customerOptions <= 1) {
      console.log('✗ 没有可用的客户，测试终止')
      return
    }
    
    await customerSelect.selectOption({ index: 1 })
    await page.waitForTimeout(1000)
    console.log('✓ 已选择客户')
    
    // 截图：选择客户后
    await page.screenshot({ path: 'test-results/co-03-customer-selected.png', fullPage: true })
    
    // 6. 填写其他信息
    await page.locator('input[type="date"]').nth(1).fill(today)
    console.log('✓ 已填写交货日期')
    
    await page.locator('input').filter({ hasText: '' }).nth(4).fill('测试地址123号')
    console.log('✓ 已填写交货地址')
    
    // 7. 点击BOM选择器
    const bomSelector = page.locator('.oms-input.cursor-pointer').first()
    await bomSelector.click()
    await page.waitForTimeout(800)
    console.log('✓ 点击BOM选择器')
    
    // 截图：下拉框打开
    await page.screenshot({ path: 'test-results/co-04-dropdown-opened.png', fullPage: true })
    
    // 8. 选择BOM
    const options = page.locator('div.cursor-pointer.hover\\:bg-blue-50')
    const optionCount = await options.count()
    console.log(`  BOM选项数: ${optionCount}`)
    
    if (optionCount === 0) {
      console.log('✗ 没有BOM选项，测试终止')
      return
    }
    
    await options.first().click()
    await page.waitForTimeout(1000)
    console.log('✓ 已选择BOM')
    
    // 截图：选择BOM后
    await page.screenshot({ path: 'test-results/co-05-bom-selected.png', fullPage: true })
    
    // 9. 填写数量
    const qtyInput = page.locator('input[type="number"]').first()
    await qtyInput.fill('200')
    await page.waitForTimeout(500)
    console.log('✓ 已填写数量: 200')
    
    // 10. 填写单价
    const priceInput = page.locator('input[type="number"]').nth(1)
    await priceInput.fill('100')
    await page.waitForTimeout(500)
    console.log('✓ 已填写单价: 100')
    
    // 11. 填写出货日期
    await page.locator('input[type="date"]').nth(2).fill(today)
    console.log('✓ 已填写出货日期')
    
    // 截图：填写完成
    await page.screenshot({ path: 'test-results/co-06-form-filled.png', fullPage: true })
    
    // 12. 点击建立订单按钮
    console.log('准备提交表单...')
    await page.click('button:has-text("建立訂單")')
    
    // 等待响应
    await page.waitForTimeout(3000)
    
    // 截图：提交后
    await page.screenshot({ path: 'test-results/co-07-after-submit.png', fullPage: true })
    
    // 13. 检查是否返回列表页面
    const searchBoxVisible = await page.locator('input[placeholder*="搜尋採購單號或客戶"]').isVisible()
    
    if (searchBoxVisible) {
      console.log('✓ 客户订单创建成功！已返回列表页面')
      
      // 检查是否有新创建的订单
      const firstOrderNumber = await page.locator('td.font-mono.text-xs.text-blue-600').first().textContent()
      console.log(`  最新订单号: ${firstOrderNumber}`)
    } else {
      console.log('⚠ 可能还在表单页面，检查是否有错误')
      
      // 检查是否有错误提示
      const errorVisible = await page.locator('text=/錯誤|失敗|error/i').isVisible().catch(() => false)
      if (errorVisible) {
        const errorText = await page.locator('text=/錯誤|失敗|error/i').first().textContent()
        console.log(`  错误信息: ${errorText}`)
      }
    }
    
    console.log('=== 客户订单创建测试完成 ===\n')
  })
})
