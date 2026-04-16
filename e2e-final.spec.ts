import { test, expect } from '@playwright/test'

// 生产环境URL
const FRONTEND_URL = 'http://43.133.56.234'

test.describe('订单创建完整E2E测试', () => {
  test.beforeEach(async ({ page }) => {
    console.log(`\n访问前端: ${FRONTEND_URL}`)
    
    // 登录
    await page.goto(`${FRONTEND_URL}/login`)
    await page.waitForLoadState('networkidle')
    
    await page.fill('input[type="email"]', 'admin@oms.com')
    await page.fill('input[type="password"]', 'admin123')
    await page.click('button[type="submit"]')
    
    await page.waitForURL('**/dashboard', { timeout: 10000 })
    console.log('✓ 登录成功\n')
  })

  test('完整测试 - 创建采购单', async ({ page }) => {
    console.log('=== 开始测试采购单创建 ===\n')
    
    await page.goto(`${FRONTEND_URL}/dashboard/po`)
    await page.waitForLoadState('networkidle')
    console.log('✓ 进入采购单页面')
    
    await page.click('button:has-text("建立採購單")')
    await page.waitForTimeout(1000)
    console.log('✓ 点击建立采购单')
    await page.screenshot({ path: 'test-results/final-po-01-form.png', fullPage: true })
    
    // 选择供应商
    const supplierSelect = page.locator('select').first()
    const supplierOptions = await supplierSelect.locator('option').allTextContents()
    console.log(`\n可用供应商 (${supplierOptions.length - 1}个):`)
    supplierOptions.slice(1, 6).forEach((s, i) => console.log(`  ${i + 1}. ${s}`))
    
    if (supplierOptions.length <= 1) {
      throw new Error('没有可用的供应商')
    }
    
    // 选择第一个供应商
    await supplierSelect.selectOption({ index: 1 })
    await page.waitForTimeout(2000)
    const selectedSupplier = supplierOptions[1]
    console.log(`\n✓ 已选择供应商: ${selectedSupplier}`)
    
    await page.fill('textarea', 'E2E完整测试采购单')
    
    // 点击BOM选择器
    const bomSelector = page.locator('.oms-input.cursor-pointer').first()
    await bomSelector.click()
    await page.waitForTimeout(1000)
    console.log('✓ 点击BOM选择器')
    await page.screenshot({ path: 'test-results/final-po-02-dropdown.png', fullPage: true })
    
    // 检查BOM选项
    const bomOptions = page.locator('div.cursor-pointer.hover\\:bg-blue-50')
    const bomCount = await bomOptions.count()
    console.log(`\nBOM选项数: ${bomCount}`)
    
    if (bomCount === 0) {
      console.log(`\n⚠ 供应商"${selectedSupplier}"没有关联的BOM`)
      console.log('这是数据问题，需要在BOM表中为该供应商添加产品')
      console.log('\n建议：')
      console.log('1. 检查BOM表中是否有supplier_id字段')
      console.log('2. 确保BOM记录的supplier_id与选择的供应商ID匹配')
      console.log('3. 或者选择其他有BOM的供应商')
      
      // 尝试选择其他供应商
      for (let i = 2; i < Math.min(supplierOptions.length, 5); i++) {
        console.log(`\n尝试供应商: ${supplierOptions[i]}`)
        await page.click('button:has-text("取消")')
        await page.waitForTimeout(500)
        await page.click('button:has-text("建立採購單")')
        await page.waitForTimeout(1000)
        
        await supplierSelect.selectOption({ index: i })
        await page.waitForTimeout(2000)
        
        await bomSelector.click()
        await page.waitForTimeout(1000)
        
        const newBomCount = await bomOptions.count()
        console.log(`  BOM选项数: ${newBomCount}`)
        
        if (newBomCount > 0) {
          console.log(`✓ 找到有BOM的供应商: ${supplierOptions[i]}`)
          break
        }
      }
      
      const finalBomCount = await bomOptions.count()
      if (finalBomCount === 0) {
        throw new Error('所有测试的供应商都没有关联的BOM')
      }
    }
    
    // 选择第一个BOM
    const firstBomText = await bomOptions.first().textContent()
    console.log(`\n选择BOM: ${firstBomText}`)
    await bomOptions.first().click()
    await page.waitForTimeout(1000)
    console.log('✓ 已选择BOM')
    await page.screenshot({ path: 'test-results/final-po-03-bom-selected.png', fullPage: true })
    
    // 填写表单
    await page.locator('input[placeholder="PO編號"]').first().fill(`E2E-${Date.now()}`)
    await page.locator('input[type="number"]').first().fill('100')
    await page.locator('input[type="number"]').nth(1).fill('50')
    await page.waitForTimeout(500)
    console.log('✓ 已填写数量和单价')
    await page.screenshot({ path: 'test-results/final-po-04-filled.png', fullPage: true })
    
    // 提交
    console.log('\n准备提交...')
    const responsePromise = page.waitForResponse(
      response => response.url().includes('/api/po') && response.request().method() === 'POST',
      { timeout: 10000 }
    )
    
    await page.click('button:has-text("建立採購單")')
    
    try {
      const response = await responsePromise
      const status = response.status()
      console.log(`API响应状态: ${status}`)
      
      if (status === 201 || status === 200) {
        const data = await response.json()
        console.log(`✓ 采购单创建成功！`)
        console.log(`  ID: ${data.id}`)
        console.log(`  PO号: ${data.po_number}`)
      } else {
        const error = await response.text()
        console.log(`✗ API返回错误: ${error}`)
      }
    } catch (e) {
      console.log(`⚠ 未捕获到API响应: ${e}`)
    }
    
    await page.waitForTimeout(2000)
    await page.screenshot({ path: 'test-results/final-po-05-result.png', fullPage: true })
    
    const isListPage = await page.locator('input[placeholder*="搜尋採購單號"]').isVisible()
    if (isListPage) {
      console.log('\n✓✓✓ 采购单创建成功！已返回列表页面 ✓✓✓')
    } else {
      console.log('\n✗✗✗ 采购单创建失败，还在表单页面 ✗✗✗')
      throw new Error('采购单创建失败')
    }
    
    console.log('\n=== 采购单测试完成 ===\n')
  })

  test('完整测试 - 创建客户订单', async ({ page }) => {
    console.log('=== 开始测试客户订单创建 ===\n')
    
    await page.goto(`${FRONTEND_URL}/dashboard/customer-orders`)
    await page.waitForLoadState('networkidle')
    console.log('✓ 进入客户订单页面')
    
    await page.click('button:has-text("新增訂單")')
    await page.waitForTimeout(1000)
    console.log('✓ 点击新增订单')
    await page.screenshot({ path: 'test-results/final-co-01-form.png', fullPage: true })
    
    // 填写基本信息
    const today = new Date().toISOString().split('T')[0]
    const poNumber = `E2E-CO-${Date.now()}`
    
    await page.locator('input[type="date"]').first().fill(today)
    await page.locator('input').filter({ hasText: '' }).nth(1).fill(poNumber)
    console.log(`✓ 已填写日期和单号: ${poNumber}`)
    
    // 选择客户
    const customerSelect = page.locator('select').first()
    const customerOptions = await customerSelect.locator('option').allTextContents()
    console.log(`\n可用客户 (${customerOptions.length - 1}个):`)
    customerOptions.slice(1, 6).forEach((c, i) => console.log(`  ${i + 1}. ${c}`))
    
    if (customerOptions.length <= 1) {
      throw new Error('没有可用的客户')
    }
    
    await customerSelect.selectOption({ index: 1 })
    await page.waitForTimeout(1000)
    console.log(`\n✓ 已选择客户: ${customerOptions[1]}`)
    
    // 填写其他信息
    await page.locator('input[type="date"]').nth(1).fill(today)
    await page.locator('input').filter({ hasText: '' }).nth(4).fill('测试地址')
    
    // 选择BOM
    const bomSelector = page.locator('.oms-input.cursor-pointer').first()
    await bomSelector.click()
    await page.waitForTimeout(1000)
    console.log('✓ 点击BOM选择器')
    await page.screenshot({ path: 'test-results/final-co-02-dropdown.png', fullPage: true })
    
    const bomOptions = page.locator('div.cursor-pointer.hover\\:bg-blue-50')
    const bomCount = await bomOptions.count()
    console.log(`\nBOM选项数: ${bomCount}`)
    
    if (bomCount === 0) {
      throw new Error('没有可用的BOM')
    }
    
    const firstBomText = await bomOptions.first().textContent()
    console.log(`选择BOM: ${firstBomText}`)
    await bomOptions.first().click()
    await page.waitForTimeout(1000)
    console.log('✓ 已选择BOM')
    await page.screenshot({ path: 'test-results/final-co-03-bom-selected.png', fullPage: true })
    
    // 填写数量和单价
    await page.locator('input[type="number"]').first().fill('200')
    await page.locator('input[type="number"]').nth(1).fill('100')
    await page.locator('input[type="date"]').nth(2).fill(today)
    await page.waitForTimeout(500)
    console.log('✓ 已填写数量、单价和出货日期')
    await page.screenshot({ path: 'test-results/final-co-04-filled.png', fullPage: true })
    
    // 提交
    console.log('\n准备提交...')
    const responsePromise = page.waitForResponse(
      response => response.url().includes('/api/customer-orders') && response.request().method() === 'POST',
      { timeout: 10000 }
    )
    
    await page.click('button:has-text("建立訂單")')
    
    try {
      const response = await responsePromise
      const status = response.status()
      console.log(`API响应状态: ${status}`)
      
      if (status === 201 || status === 200) {
        const data = await response.json()
        console.log(`✓ 客户订单创建成功！`)
        console.log(`  订单ID: ${data.id}`)
        console.log(`  出货单ID: ${data.dn_id}`)
        console.log(`  出货单号: ${data.dn_number}`)
      } else {
        const error = await response.text()
        console.log(`✗ API返回错误: ${error}`)
      }
    } catch (e) {
      console.log(`⚠ 未捕获到API响应: ${e}`)
    }
    
    await page.waitForTimeout(2000)
    await page.screenshot({ path: 'test-results/final-co-05-result.png', fullPage: true })
    
    const isListPage = await page.locator('input[placeholder*="搜尋採購單號"]').isVisible()
    if (isListPage) {
      console.log('\n✓✓✓ 客户订单创建成功！已返回列表页面 ✓✓✓')
    } else {
      console.log('\n✗✗✗ 客户订单创建失败，还在表单页面 ✗✗✗')
      throw new Error('客户订单创建失败')
    }
    
    console.log('\n=== 客户订单测试完成 ===\n')
  })
})
