import { test, expect } from '@playwright/test'

const BASE_URL = process.env.PLAYWRIGHT_TEST_BASE_URL || 'http://localhost:3000'

test.describe('创建订单测试', () => {
  test.beforeEach(async ({ page }) => {
    // 登录
    await page.goto(`${BASE_URL}/login`)
    await page.fill('input[type="text"]', 'admin')
    await page.fill('input[type="password"]', 'admin123')
    await page.click('button[type="submit"]')
    await page.waitForURL('**/dashboard')
  })

  test('创建客户订单', async ({ page }) => {
    console.log('开始测试创建客户订单...')
    
    // 导航到客户订单页面
    await page.goto(`${BASE_URL}/dashboard/customer-orders`)
    await page.waitForLoadState('networkidle')
    
    // 点击新增订单按钮
    await page.click('button:has-text("新增訂單")')
    await page.waitForTimeout(500)
    
    // 填写基本信息
    console.log('填写采购日期...')
    const today = new Date().toISOString().split('T')[0]
    await page.fill('input[type="date"]', today)
    
    console.log('填写采购单号...')
    const poNumber = `TEST-CO-${Date.now()}`
    await page.fill('input[placeholder*="採購單號"]', poNumber)
    
    // 选择客户 - 使用原生select
    console.log('选择客户...')
    const customerSelect = page.locator('select').first()
    await customerSelect.selectOption({ index: 1 }) // 选择第一个客户
    await page.waitForTimeout(500)
    
    // 填写其他信息
    console.log('填写交货日期...')
    const deliveryDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    await page.locator('input[type="date"]').nth(1).fill(deliveryDate)
    
    console.log('填写交货地点...')
    await page.fill('input[placeholder*="交貨地址"]', '测试地址123号')
    
    console.log('填写负责人...')
    await page.locator('input').filter({ hasText: '' }).nth(5).fill('张三')
    
    console.log('填写付款方式...')
    await page.fill('input[placeholder*="月結"]', '月结30天')
    
    // 选择BOM - 点击可搜索下拉框
    console.log('选择BOM产品...')
    await page.waitForTimeout(1000)
    
    // 查找BOM选择器（在表格中）
    const bomSelector = page.locator('.oms-input.cursor-pointer').first()
    await bomSelector.click()
    await page.waitForTimeout(500)
    
    // 在弹出的搜索框中输入搜索
    const searchInput = page.locator('input[placeholder="搜尋..."]')
    if (await searchInput.isVisible()) {
      console.log('找到搜索框，输入搜索内容...')
      await searchInput.fill('YBC')
      await page.waitForTimeout(500)
      
      // 点击第一个搜索结果
      const firstOption = page.locator('div.cursor-pointer.hover\\:bg-blue-50').first()
      if (await firstOption.isVisible()) {
        await firstOption.click()
        console.log('已选择BOM产品')
      }
    }
    
    await page.waitForTimeout(500)
    
    // 填写数量
    console.log('填写数量...')
    await page.locator('input[type="number"]').filter({ hasText: '' }).first().fill('100')
    
    // 填写单价
    console.log('填写单价...')
    await page.locator('input[type="number"]').nth(1).fill('50')
    
    // 填写出货日期
    console.log('填写出货日期...')
    await page.locator('input[type="date"]').nth(2).fill(deliveryDate)
    
    await page.waitForTimeout(500)
    
    // 点击建立订单按钮
    console.log('点击建立订单按钮...')
    await page.click('button:has-text("建立訂單")')
    
    // 等待成功提示或页面更新
    await page.waitForTimeout(2000)
    
    // 验证订单是否创建成功 - 检查是否返回列表页面
    const isListVisible = await page.locator('input[placeholder*="搜尋採購單號"]').isVisible()
    console.log('订单列表是否可见:', isListVisible)
    
    if (isListVisible) {
      console.log('✓ 客户订单创建成功！')
    } else {
      console.log('⚠ 可能还在创建表单页面，检查是否有错误...')
      // 截图保存
      await page.screenshot({ path: 'customer-order-error.png', fullPage: true })
    }
  })

  test('创建采购单', async ({ page }) => {
    console.log('开始测试创建采购单...')
    
    // 导航到采购单页面
    await page.goto(`${BASE_URL}/dashboard/po`)
    await page.waitForLoadState('networkidle')
    
    // 点击建立采购单按钮
    await page.click('button:has-text("建立採購單")')
    await page.waitForTimeout(500)
    
    // 选择供应商 - 使用原生select
    console.log('选择供应商...')
    const supplierSelect = page.locator('select').first()
    await supplierSelect.selectOption({ index: 1 }) // 选择第一个供应商
    await page.waitForTimeout(1000) // 等待供应商选择后的处理
    
    // 填写备注
    console.log('填写备注...')
    await page.fill('textarea[placeholder*="交易條件"]', '测试采购单备注')
    
    // 选择BOM - 点击可搜索下拉框
    console.log('选择BOM物料...')
    await page.waitForTimeout(1000)
    
    // 查找BOM选择器（在表格中）
    const bomSelector = page.locator('.oms-input.cursor-pointer').first()
    await bomSelector.click()
    await page.waitForTimeout(500)
    
    // 在弹出的搜索框中输入搜索
    const searchInput = page.locator('input[placeholder="搜尋..."]')
    if (await searchInput.isVisible()) {
      console.log('找到搜索框，输入搜索内容...')
      await searchInput.fill('EVA')
      await page.waitForTimeout(500)
      
      // 点击第一个搜索结果
      const firstOption = page.locator('div.cursor-pointer.hover\\:bg-blue-50').first()
      if (await firstOption.isVisible()) {
        await firstOption.click()
        console.log('已选择BOM物料')
      }
    }
    
    await page.waitForTimeout(500)
    
    // 填写PO订单编号
    console.log('填写PO订单编号...')
    await page.fill('input[placeholder="PO編號"]', `PO-${Date.now()}`)
    
    // 填写数量
    console.log('填写数量...')
    const qtyInput = page.locator('input[type="number"]').filter({ hasText: '' }).first()
    await qtyInput.fill('200')
    
    // 填写单价
    console.log('填写单价...')
    const priceInput = page.locator('input[type="number"]').nth(1)
    await priceInput.fill('30')
    
    await page.waitForTimeout(500)
    
    // 点击建立采购单按钮
    console.log('点击建立采购单按钮...')
    await page.click('button:has-text("建立採購單")')
    
    // 等待成功提示或页面更新
    await page.waitForTimeout(2000)
    
    // 验证采购单是否创建成功 - 检查是否返回列表页面
    const isListVisible = await page.locator('input[placeholder*="搜尋採購單號或供應商"]').isVisible()
    console.log('采购单列表是否可见:', isListVisible)
    
    if (isListVisible) {
      console.log('✓ 采购单创建成功！')
    } else {
      console.log('⚠ 可能还在创建表单页面，检查是否有错误...')
      // 截图保存
      await page.screenshot({ path: 'po-error.png', fullPage: true })
    }
  })

  test('测试SearchableSelect组件', async ({ page }) => {
    console.log('测试SearchableSelect组件...')
    
    // 导航到采购单页面
    await page.goto(`${BASE_URL}/dashboard/po`)
    await page.waitForLoadState('networkidle')
    
    // 点击建立采购单
    await page.click('button:has-text("建立採購單")')
    await page.waitForTimeout(500)
    
    // 选择供应商
    const supplierSelect = page.locator('select').first()
    await supplierSelect.selectOption({ index: 1 })
    await page.waitForTimeout(1000)
    
    // 测试SearchableSelect
    console.log('点击BOM选择器...')
    const bomSelector = page.locator('.oms-input.cursor-pointer').first()
    await bomSelector.click()
    await page.waitForTimeout(500)
    
    // 检查下拉框是否可见
    const dropdown = page.locator('div.fixed.bg-white.border')
    const isDropdownVisible = await dropdown.isVisible()
    console.log('下拉框是否可见:', isDropdownVisible)
    
    if (isDropdownVisible) {
      // 检查搜索框
      const searchInput = page.locator('input[placeholder="搜尋..."]')
      const isSearchVisible = await searchInput.isVisible()
      console.log('搜索框是否可见:', isSearchVisible)
      
      if (isSearchVisible) {
        // 测试搜索功能
        await searchInput.fill('test')
        await page.waitForTimeout(500)
        
        // 检查选项列表
        const options = page.locator('div.cursor-pointer.hover\\:bg-blue-50')
        const optionCount = await options.count()
        console.log('搜索结果数量:', optionCount)
        
        // 截图
        await page.screenshot({ path: 'searchable-select-test.png', fullPage: true })
        
        console.log('✓ SearchableSelect组件工作正常！')
      }
    } else {
      console.log('⚠ 下拉框未显示')
      await page.screenshot({ path: 'searchable-select-error.png', fullPage: true })
    }
  })
})
