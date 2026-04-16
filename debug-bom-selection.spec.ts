import { test } from '@playwright/test'

const FRONTEND_URL = 'http://43.133.56.234'

test('调试BOM选择 - 检查数据和函数调用', async ({ page }) => {
  // 监听所有console消息
  page.on('console', msg => {
    console.log(`[浏览器 ${msg.type()}]: ${msg.text()}`)
  })
  
  // 监听错误
  page.on('pageerror', error => {
    console.log(`[页面错误]: ${error.message}`)
  })
  
  // 登录
  await page.goto(`${FRONTEND_URL}/login`)
  await page.fill('input[type="email"]', 'admin@oms.com')
  await page.fill('input[type="password"]', 'admin123')
  await page.click('button[type="submit"]')
  await page.waitForURL('**/dashboard')
  
  // 进入采购单页面
  await page.goto(`${FRONTEND_URL}/dashboard/po`)
  await page.waitForLoadState('networkidle')
  
  // 点击建立采购单
  await page.click('button:has-text("建立採購單")')
  await page.waitForTimeout(1000)
  
  // 选择供应商
  const supplierSelect = page.locator('select').first()
  await supplierSelect.selectOption({ index: 4 })
  await page.waitForTimeout(2000)
  
  // 在页面中注入调试代码
  await page.evaluate(() => {
    console.log('=== 调试信息 ===')
    
    // 检查window对象上是否有React相关的东西
    const root = document.querySelector('#__next') || document.querySelector('[data-reactroot]')
    console.log('React root:', root ? '找到' : '未找到')
    
    // 尝试获取BOM数据
    console.log('尝试从页面获取BOM数据...')
  })
  
  // 点击BOM选择器
  const bomSelector = page.locator('.oms-input.cursor-pointer').first()
  
  // 在点击前添加事件监听
  await page.evaluate(() => {
    const selector = document.querySelector('.oms-input.cursor-pointer')
    if (selector) {
      console.log('找到BOM选择器元素')
      selector.addEventListener('click', () => {
        console.log('BOM选择器被点击')
      })
    }
  })
  
  await bomSelector.click()
  await page.waitForTimeout(1000)
  
  // 检查下拉框中的数据
  const bomOptions = page.locator('div.cursor-pointer.hover\\:bg-blue-50')
  const bomCount = await bomOptions.count()
  console.log(`\nBOM选项数: ${bomCount}`)
  
  if (bomCount > 0) {
    // 获取第一个选项的完整信息
    const firstOption = bomOptions.first()
    const optionText = await firstOption.textContent()
    const optionHtml = await firstOption.innerHTML()
    
    console.log(`\n第一个BOM选项:`)
    console.log(`  文本: ${optionText}`)
    console.log(`  HTML: ${optionHtml}`)
    
    // 在选择前添加监听
    await page.evaluate(() => {
      console.log('准备选择BOM...')
      
      // 监听所有点击事件
      document.addEventListener('click', (e) => {
        const target = e.target as HTMLElement
        if (target.classList.contains('cursor-pointer')) {
          console.log('点击了cursor-pointer元素:', target.textContent)
        }
      }, { once: true })
    })
    
    // 选择BOM
    await firstOption.click()
    await page.waitForTimeout(2000)
    
    // 检查表单状态
    const formState = await page.evaluate(() => {
      // 尝试获取表单数据
      const inputs = document.querySelectorAll('input')
      const result: any = {}
      
      inputs.forEach((input, i) => {
        if (input.value) {
          result[`input_${i}`] = {
            type: input.type,
            value: input.value,
            readonly: input.readOnly,
            placeholder: input.placeholder
          }
        }
      })
      
      return result
    })
    
    console.log('\n表单状态:')
    console.log(JSON.stringify(formState, null, 2))
    
    // 检查材料名称输入框
    const materialNameInput = page.locator('input[readonly]').first()
    const materialName = await materialNameInput.inputValue()
    const materialNamePlaceholder = await materialNameInput.getAttribute('placeholder')
    
    console.log(`\n材料名称输入框:`)
    console.log(`  值: ${materialName || '(空)'}`)
    console.log(`  placeholder: ${materialNamePlaceholder}`)
    
    if (!materialName) {
      console.log('\n✗ 确认BUG：选择BOM后，材料名称未填充')
      console.log('可能原因：')
      console.log('1. selectBOM函数未被调用')
      console.log('2. BOM数据中缺少product_name字段')
      console.log('3. onChange回调未正确传递bomId')
      console.log('4. React状态更新失败')
    }
  }
})
