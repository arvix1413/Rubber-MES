import { test, expect } from '@playwright/test'

/**
 * 本地E2E测试 - 订单创建
 * 
 * 运行前准备：
 * 1. 启动后端: cd backend && npm run dev (端口3001)
 * 2. 启动前端: cd frontend && npm run dev (端口3000)
 * 3. 运行测试: npx playwright test e2e-local.spec.ts
 */

const FRONTEND_URL = 'http://localhost:3000'

test.describe('本地订单创建E2E测试', () => {
  test.beforeEach(async ({ page }) => {
    console.log(`访问前端: ${FRONTEND_URL}`)
    
    // 登录
    await page.goto(`${FRONTEND_URL}/login`)
    await page.waitForLoadState('networkidle')
    
    // 填写登录信息
    await page.fill('input[type="text"]', 'admin')
    await page.fill('input[type="password"]', 'admin123')
    await page.click('button[type="submit"]')
    
    // 等待跳转到dashboard
    await page.waitForURL('**/dashboard', { timeout: 10000 })
    console.log('✓ 登录成功')
  })

  test('本地E2E - 创建采购单完整流程', async ({ page }) => {
    console.log('\n=== 开始测试采购单创建 ===')
    
    // 1. 导航到采购单页面
    await page.goto(`${FRONTEND_URL}/dashboard/po`)
    await page.waitForLoadState('networkidle')
    console.log('✓ 进入采购单页面')
    
    // 截图：初始状态
    await page.screenshot({ path: 'test-results/local-po-01-initial.png', fullPage: true })
    
    // 2. 点击建立采购单
    await page.click('button:has-text("建立採購單")')
    await page.waitForTimeout(1000)
    console.log('✓ 点击建立采购单')
    
    // 截图：表单显示
    await page.screenshot({ path: 'test-results/local-po-02-form-opened.png', fullPage: true })
    
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
      throw new Error('没有可用的供应商')
    }
    
    await supplierSelect.selectOption({ index: 1 })
    await page.waitForTimeout(1500)
    const selectedSupplier = await supplierSelect.inputValue()
    console.log(`✓ 已选择供应商 ID: ${selectedSupplier}`)
    
    // 截图：选择供应商后
    await page.screenshot({ path: 'test-results/local-po-03-supplier-selected.png', fullPage: true })
    
    // 5. 填写备注
    await page.fill('textarea[placeholder*="交易條件"]', 'E2E本地测试采购单')
    console.log('✓ 已填写备注')
    
    // 6. 点击BOM选择器
    const bomSelector = page.locator('.oms-input.cursor-pointer').first()
    const isDisabled = await bomSelector.evaluate(el => el.classList.contains('bg-slate-100'))
    
    if (isDisabled) {
      console.log('✗ BOM选择器被禁用')
      await page.screenshot({ path: 'test-results/local-po-error-bom-disabled.png', fullPage: true })
      throw new Error('BOM选择器被禁用')
    }
    
    await bomSelector.click()
    await page.waitForTimeout(800)
    console.log('✓ 点击BOM选择器')
    
    // 截图：下拉框打开
    await page.screenshot({ path: 'test-results/local-po-04-dropdown-opened.png', fullPage: true })
    
    // 7. 检查下拉框
    const dropdown = page.locator('div.fixed.bg-white.border').first()
    const dropdownVisible = await dropdown.isVisible()
    console.log(`  下拉框可见: ${dropdownVisible}`)
    
    if (!dropdownVisible) {
      console.log('✗ 下拉框未显示')
      await page.screenshot({ path: 'test-results/local-po-error-no-dropdown.png', fullPage: true })
      throw new Error('下拉框未显示')
    }
    
    // 8. 检查选项
    const options = page.locator('div.cursor-pointer.hover\\:bg-blue-50')
    const optionCount = await options.count()
    console.log(`  BOM选项数: ${optionCount}`)
    
    if (optionCount === 0) {
      console.log('✗ 没有BOM选项')
      await page.screenshot({ path: 'test-results/local-po-error-no-options.png', fullPage: true })
      throw new Error('没有BOM选项')
    }
    
    // 9. 选择第一个BOM
    const firstOptionText = await options.first().textContent()
    console.log(`  选择BOM: ${firstOptionText}`)
    await options.first().click()
    await page.waitForTimeout(1000)
    console.log('✓ 已选择BOM')
    
    // 截图：选择BOM后
    await page.screenshot({ path: 'test-results/local-po-05-bom-selected.png', fullPage: true })
    
    // 10. 检查自动填充的字段
    const materialNameInputs = page.locator('input[readonly]')
    const materialNameInput = materialNameInputs.first()
    const materialName = await materialNameInput.inputValue()
    console.log(`  自动填充的材料名称: ${materialName || '(空)'}`)
    
    if (!materialName) {
      console.log('⚠ 材料名称未自动填充')
      await page.screenshot({ path: 'test-results/local-po-warning-no-autofill.png', fullPage: true })
    }
    
    // 11. 填写PO编号
    const poRefInput = page.locator('input[placeholder="PO編號"]').first()
    const poRef = `E2E-LOCAL-${Date.now()}`
    await poRefInput.fill(poRef)
    console.log(`✓ 已填写PO编号: ${poRef}`)
    
    // 12. 填写数量
    const qtyInput = page.locator('input[type="number"]').first()
    await qtyInput.clear()
    await qtyInput.fill('100')
    await page.waitForTimeout(500)
    console.log('✓ 已填写数量: 100')
    
    // 13. 填写单价
    const priceInput = page.locator('input[type="number"]').nth(1)
    await priceInput.clear()
    await priceInput.fill('50')
    await page.waitForTimeout(500)
    console.log('✓ 已填写单价: 50')
    
    // 截图：填写完成
    await page.screenshot({ path: 'test-results/local-po-06-form-filled.png', fullPage: true })
    
    // 14. 检查小计
    const subtotalCell = page.locator('td.px-2.py-2.text-right.text-slate-600.font-medium').first()
    const subtotalText = await subtotalCell.textContent()
    console.log(`  小计: ${subtotalText}`)
    expect(subtotalText).toContain('5,000')
    
    // 15. 点击建立采购单按钮
    console.log('准备提交表单...')
    
    // 监听网络请求
    const responsePromise = page.waitForResponse(response => 
      response.url().includes('/api/po') && response.request().method() === 'POST'
    )
    
    await page.click('button:has-text("建立採購單")')
    
    // 等待API响应
    try {
      const response = await responsePromise
      const status = response.status()
      console.log(`  API响应状态: ${status}`)
      
      if (status === 201 || status === 200) {
        const data = await response.json()
        console.log(`  创建的采购单ID: ${data.id}`)
        console.log(`  采购单号: ${data.po_number}`)
      } else {
        const errorData = await response.text()
        console.log(`  API错误: ${errorData}`)
      }
    } catch (e) {
      console.log(`  等待API响应超时: ${e}`)
    }
    
    // 等待页面更新
    await page.waitForTimeout(2000)
    
    // 截图：提交后
    await page.screenshot({ path: 'test-results/local-po-07-after-submit.png', fullPage: true })
    
    // 16. 检查是否返回列表页面
    const searchBoxVisible = await page.locator('input[placeholder*="搜尋採購單號或供應商"]').isVisible()
    
    if (searchBoxVisible) {
      console.log('✓ 采购单创建成功！已返回列表页面')
      
      // 检查是否有新创建的采购单
      const firstPoNumber = await page.locator('td.font-mono.text-xs.text-blue-600').first().textContent()
      console.log(`  最新采购单号: ${firstPoNumber}`)
      
      expect(searchBoxVisible).toBe(true)
    } else {
      console.log('✗ 未返回列表页面，采购单创建可能失败')
      await page.screenshot({ path: 'test-results/local-po-error-not-returned.png', fullPage: true })
      throw new Error('采购单创建失败：未返回列表页面')
    }
    
    console.log('=== 采购单创建测试完成 ===\n')
  })

  test('本地E2E - 创建客户订单完整流程', async ({ page }) => {
    console.log('\n=== 开始测试客户订单创建 ===')
    
    // 1. 导航到客户订单页面
    await page.goto(`${FRONTEND_URL}/dashboard/customer-orders`)
    await page.waitForLoadState('networkidle')
    console.log('✓ 进入客户订单页面')
    
    // 截图：初始状态
    await page.screenshot({ path: 'test-results/local-co-01-initial.png', fullPage: true })
    
    // 2. 点击新增订单
    await page.click('button:has-text("新增訂單")')
    await page.waitForTimeout(1000)
    console.log('✓ 点击新增订单')
    
    // 截图：表单显示
    await page.screenshot({ path: 'test-results/local-co-02-form-opened.png', fullPage: true })
    
    // 3. 填写采购日期
    const today = new Date().toISOString().split('T')[0]
    await page.locator('input[type="date"]').first().fill(today)
    console.log(`✓ 已填写采购日期: ${today}`)
    
    // 4. 填写采购单号
    const poNumber = `E2E-CO-LOCAL-${Date.now()}`
    const poNumberInputs = page.locator('input').filter({ hasText: '' })
    await poNumberInputs.nth(1).fill(poNumber)
    console.log(`✓ 已填写采购单号: ${poNumber}`)
    
    // 5. 选择客户
    const customerSelect = page.locator('select').first()
    const customerOptions = await customerSelect.locator('option').count()
    console.log(`  客户选项数: ${customerOptions}`)
    
    if (customerOptions <= 1) {
      console.log('✗ 没有可用的客户')
      throw new Error('没有可用的客户')
    }
    
    await customerSelect.selectOption({ index: 1 })
    await page.waitForTimeout(1000)
    console.log('✓ 已选择客户')
    
    // 截图：选择客户后
    await page.screenshot({ path: 'test-results/local-co-03-customer-selected.png', fullPage: true })
    
    // 6. 填写其他信息
    await page.locator('input[type="date"]').nth(1).fill(today)
    console.log('✓ 已填写交货日期')
    
    const addressInputs = page.locator('input').filter({ hasText: '' })
    await addressInputs.nth(4).fill('E2E测试地址123号')
    console.log('✓ 已填写交货地址')
    
    // 7. 点击BOM选择器
    const bomSelector = page.locator('.oms-input.cursor-pointer').first()
    await bomSelector.click()
    await page.waitForTimeout(800)
    console.log('✓ 点击BOM选择器')
    
    // 截图：下拉框打开
    await page.screenshot({ path: 'test-results/local-co-04-dropdown-opened.png', fullPage: true })
    
    // 8. 选择BOM
    const options = page.locator('div.cursor-pointer.hover\\:bg-blue-50')
    const optionCount = await options.count()
    console.log(`  BOM选项数: ${optionCount}`)
    
    if (optionCount === 0) {
      console.log('✗ 没有BOM选项')
      throw new Error('没有BOM选项')
    }
    
    const firstOptionText = await options.first().textContent()
    console.log(`  选择BOM: ${firstOptionText}`)
    await options.first().click()
    await page.waitForTimeout(1000)
    console.log('✓ 已选择BOM')
    
    // 截图：选择BOM后
    await page.screenshot({ path: 'test-results/local-co-05-bom-selected.png', fullPage: true })
    
    // 9. 填写数量
    const qtyInput = page.locator('input[type="number"]').first()
    await qtyInput.clear()
    await qtyInput.fill('200')
    await page.waitForTimeout(500)
    console.log('✓ 已填写数量: 200')
    
    // 10. 填写单价
    const priceInput = page.locator('input[type="number"]').nth(1)
    await priceInput.clear()
    await priceInput.fill('100')
    await page.waitForTimeout(500)
    console.log('✓ 已填写单价: 100')
    
    // 11. 填写出货日期
    await page.locator('input[type="date"]').nth(2).fill(today)
    console.log('✓ 已填写出货日期')
    
    // 截图：填写完成
    await page.screenshot({ path: 'test-results/local-co-06-form-filled.png', fullPage: true })
    
    // 12. 点击建立订单按钮
    console.log('准备提交表单...')
    
    // 监听网络请求
    const responsePromise = page.waitForResponse(response => 
      response.url().includes('/api/customer-orders') && response.request().method() === 'POST'
    )
    
    await page.click('button:has-text("建立訂單")')
    
    // 等待API响应
    try {
      const response = await responsePromise
      const status = response.status()
      console.log(`  API响应状态: ${status}`)
      
      if (status === 201 || status === 200) {
        const data = await response.json()
        console.log(`  创建的订单ID: ${data.id}`)
        console.log(`  自动创建的出货单ID: ${data.dn_id}`)
      } else {
        const errorData = await response.text()
        console.log(`  API错误: ${errorData}`)
      }
    } catch (e) {
      console.log(`  等待API响应超时: ${e}`)
    }
    
    // 等待页面更新
    await page.waitForTimeout(2000)
    
    // 截图：提交后
    await page.screenshot({ path: 'test-results/local-co-07-after-submit.png', fullPage: true })
    
    // 13. 检查是否返回列表页面
    const searchBoxVisible = await page.locator('input[placeholder*="搜尋採購單號或客戶"]').isVisible()
    
    if (searchBoxVisible) {
      console.log('✓ 客户订单创建成功！已返回列表页面')
      
      // 检查是否有新创建的订单
      const firstOrderNumber = await page.locator('td.font-mono.text-xs.text-blue-600').first().textContent()
      console.log(`  最新订单号: ${firstOrderNumber}`)
      
      expect(searchBoxVisible).toBe(true)
    } else {
      console.log('✗ 未返回列表页面，订单创建可能失败')
      await page.screenshot({ path: 'test-results/local-co-error-not-returned.png', fullPage: true })
      throw new Error('客户订单创建失败：未返回列表页面')
    }
    
    console.log('=== 客户订单创建测试完成 ===\n')
  })
})
