import { test, expect } from '@playwright/test'

/**
 * Manual test for order creation
 * 
 * To run this test:
 * 1. Start the backend: cd backend && npm run dev
 * 2. Start the frontend: cd frontend && npm run dev
 * 3. Run test: npx playwright test manual-test-orders.spec.ts --headed
 */

const BASE_URL = 'http://localhost:3000'

test.describe('手动测试订单创建', () => {
  test.beforeEach(async ({ page }) => {
    // 登录
    await page.goto(`${BASE_URL}/login`)
    await page.fill('input[type="text"]', 'admin')
    await page.fill('input[type="password"]', 'admin123')
    await page.click('button[type="submit"]')
    await page.waitForURL('**/dashboard')
  })

  test('手动测试 - 创建采购单流程', async ({ page }) => {
    console.log('\n=== 开始测试采购单创建 ===\n')
    
    // 1. 导航到采购单页面
    await page.goto(`${BASE_URL}/dashboard/po`)
    await page.waitForLoadState('networkidle')
    console.log('✓ 已进入采购单页面')
    
    // 2. 点击建立采购单
    await page.click('button:has-text("建立採購單")')
    await page.waitForTimeout(500)
    console.log('✓ 点击建立采购单按钮')
    
    // 3. 检查表单是否显示
    const formVisible = await page.locator('h2:has-text("建立採購單")').isVisible()
    expect(formVisible).toBe(true)
    console.log('✓ 创建表单已显示')
    
    // 4. 选择供应商
    const supplierSelect = page.locator('select').first()
    const supplierOptions = await supplierSelect.locator('option').count()
    console.log(`  供应商选项数量: ${supplierOptions}`)
    
    if (supplierOptions > 1) {
      await supplierSelect.selectOption({ index: 1 })
      await page.waitForTimeout(1000)
      const selectedSupplier = await supplierSelect.inputValue()
      console.log(`✓ 已选择供应商 ID: ${selectedSupplier}`)
    } else {
      console.log('⚠ 没有可用的供应商')
    }
    
    // 5. 填写备注
    await page.fill('textarea[placeholder*="交易條件"]', '测试采购单 - 自动化测试')
    console.log('✓ 已填写备注')
    
    // 6. 检查BOM下拉框是否启用
    const bomSelector = page.locator('.oms-input.cursor-pointer').first()
    const isDisabled = await bomSelector.evaluate(el => el.classList.contains('bg-slate-100'))
    console.log(`  BOM选择器状态: ${isDisabled ? '禁用' : '启用'}`)
    
    if (!isDisabled) {
      // 7. 点击BOM选择器
      await bomSelector.click()
      await page.waitForTimeout(500)
      console.log('✓ 点击BOM选择器')
      
      // 8. 检查下拉框是否显示
      const dropdown = page.locator('div.fixed.bg-white.border')
      const dropdownVisible = await dropdown.isVisible()
      console.log(`  下拉框显示状态: ${dropdownVisible ? '可见' : '不可见'}`)
      
      if (dropdownVisible) {
        // 9. 检查搜索框
        const searchInput = page.locator('input[placeholder="搜尋..."]')
        const searchVisible = await searchInput.isVisible()
        console.log(`  搜索框显示状态: ${searchVisible ? '可见' : '不可见'}`)
        
        // 10. 检查选项数量
        const options = page.locator('div.cursor-pointer.hover\\:bg-blue-50')
        const optionCount = await options.count()
        console.log(`  BOM选项数量: ${optionCount}`)
        
        if (optionCount > 0) {
          // 11. 选择第一个BOM
          await options.first().click()
          await page.waitForTimeout(500)
          console.log('✓ 已选择第一个BOM')
          
          // 12. 检查是否自动填充了字段
          const materialName = await page.locator('input').filter({ hasText: '' }).nth(1).inputValue()
          console.log(`  自动填充的材料名称: ${materialName || '(空)'}`)
        } else {
          console.log('⚠ 没有可用的BOM选项')
        }
      }
    } else {
      console.log('⚠ BOM选择器被禁用（可能未选择供应商）')
    }
    
    // 13. 截图保存当前状态
    await page.screenshot({ path: 'test-results/po-creation-form.png', fullPage: true })
    console.log('✓ 已保存截图: test-results/po-creation-form.png')
    
    console.log('\n=== 采购单创建测试完成 ===\n')
  })

  test('手动测试 - 创建客户订单流程', async ({ page }) => {
    console.log('\n=== 开始测试客户订单创建 ===\n')
    
    // 1. 导航到客户订单页面
    await page.goto(`${BASE_URL}/dashboard/customer-orders`)
    await page.waitForLoadState('networkidle')
    console.log('✓ 已进入客户订单页面')
    
    // 2. 点击新增订单
    await page.click('button:has-text("新增訂單")')
    await page.waitForTimeout(500)
    console.log('✓ 点击新增订单按钮')
    
    // 3. 检查表单是否显示
    const formVisible = await page.locator('h2:has-text("新增客戶訂單")').isVisible()
    expect(formVisible).toBe(true)
    console.log('✓ 创建表单已显示')
    
    // 4. 填写采购日期
    const today = new Date().toISOString().split('T')[0]
    await page.fill('input[type="date"]', today)
    console.log(`✓ 已填写采购日期: ${today}`)
    
    // 5. 填写采购单号
    const poNumber = `TEST-CO-${Date.now()}`
    await page.locator('input').filter({ hasText: '' }).nth(1).fill(poNumber)
    console.log(`✓ 已填写采购单号: ${poNumber}`)
    
    // 6. 选择客户
    const customerSelect = page.locator('select').first()
    const customerOptions = await customerSelect.locator('option').count()
    console.log(`  客户选项数量: ${customerOptions}`)
    
    if (customerOptions > 1) {
      await customerSelect.selectOption({ index: 1 })
      await page.waitForTimeout(500)
      const selectedCustomer = await customerSelect.inputValue()
      console.log(`✓ 已选择客户 ID: ${selectedCustomer}`)
    } else {
      console.log('⚠ 没有可用的客户')
    }
    
    // 7. 检查BOM下拉框
    const bomSelector = page.locator('.oms-input.cursor-pointer').first()
    await bomSelector.click()
    await page.waitForTimeout(500)
    console.log('✓ 点击BOM选择器')
    
    // 8. 检查下拉框
    const dropdown = page.locator('div.fixed.bg-white.border')
    const dropdownVisible = await dropdown.isVisible()
    console.log(`  下拉框显示状态: ${dropdownVisible ? '可见' : '不可见'}`)
    
    if (dropdownVisible) {
      const options = page.locator('div.cursor-pointer.hover\\:bg-blue-50')
      const optionCount = await options.count()
      console.log(`  BOM选项数量: ${optionCount}`)
      
      if (optionCount > 0) {
        await options.first().click()
        await page.waitForTimeout(500)
        console.log('✓ 已选择第一个BOM')
      }
    }
    
    // 9. 截图保存当前状态
    await page.screenshot({ path: 'test-results/customer-order-creation-form.png', fullPage: true })
    console.log('✓ 已保存截图: test-results/customer-order-creation-form.png')
    
    console.log('\n=== 客户订单创建测试完成 ===\n')
  })

  test('调试 - 检查页面元素', async ({ page }) => {
    console.log('\n=== 调试页面元素 ===\n')
    
    await page.goto(`${BASE_URL}/dashboard/po`)
    await page.waitForLoadState('networkidle')
    
    await page.click('button:has-text("建立採購單")')
    await page.waitForTimeout(500)
    
    // 检查所有select元素
    const selects = await page.locator('select').count()
    console.log(`页面上的select元素数量: ${selects}`)
    
    // 检查所有input元素
    const inputs = await page.locator('input').count()
    console.log(`页面上的input元素数量: ${inputs}`)
    
    // 检查所有textarea元素
    const textareas = await page.locator('textarea').count()
    console.log(`页面上的textarea元素数量: ${textareas}`)
    
    // 检查SearchableSelect组件
    const searchableSelects = await page.locator('.oms-input.cursor-pointer').count()
    console.log(`SearchableSelect组件数量: ${searchableSelects}`)
    
    // 检查按钮
    const buttons = await page.locator('button').count()
    console.log(`页面上的button元素数量: ${buttons}`)
    
    console.log('\n=== 调试完成 ===\n')
  })
})
