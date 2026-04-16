import { test, expect } from '@playwright/test'

test('Test BOM selection without supplier filter', async ({ page }) => {
  // Listen to console
  const consoleLogs: string[] = []
  page.on('console', msg => {
    const text = msg.text()
    console.log('🔵', text)
    consoleLogs.push(text)
  })

  // Navigate
  await page.goto('http://localhost:3000')
  
  // Login
  await page.fill('input[type="email"]', 'admin@oms.com')
  await page.fill('input[type="password"]', 'admin123')
  await page.click('button:has-text("登入")')
  await page.waitForURL('**/dashboard', { timeout: 10000 })
  await page.waitForTimeout(1000)
  
  // Go to Customer Orders page (no supplier filter)
  console.log('\n=== Going to Customer Orders page ===')
  await page.click('a:has-text("客戶訂單")')
  await page.waitForTimeout(2000)
  
  // Click create
  await page.click('button:has-text("新增訂單")')
  await page.waitForTimeout(1000)
  
  console.log('\n=== Opening BOM dropdown (no supplier filter) ===')
  
  // Open BOM dropdown (should show all BOMs)
  const bomDropdown = page.locator('.oms-input.cursor-pointer').first()
  await bomDropdown.click()
  await page.waitForTimeout(1000)
  
  // Check dropdown
  const dropdown = page.locator('div.bg-white.border').first()
  const isVisible = await dropdown.isVisible()
  console.log('Dropdown visible:', isVisible)
  
  if (isVisible) {
    const options = dropdown.locator('div.px-3.py-2.text-xs.cursor-pointer')
    const count = await options.count()
    console.log('BOM options count:', count)
    
    if (count > 0) {
      // Get first few options
      const optionTexts = await options.allTextContents()
      console.log('First 3 options:')
      optionTexts.slice(0, 3).forEach((text, idx) => {
        console.log(`  [${idx}]: ${text}`)
      })
      
      console.log('\n=== Clicking first BOM option ===')
      
      // Clear logs
      consoleLogs.length = 0
      
      // Click first option
      const firstOption = options.first()
      await firstOption.click()
      await page.waitForTimeout(2000)
      
      console.log('\n=== Console logs after click ===')
      console.log('Total logs:', consoleLogs.length)
      consoleLogs.forEach((log, i) => {
        console.log(`  [${i}]:`, log)
      })
      
      // Check for specific logs
      const hasOnSelectBom = consoleLogs.some(log => log.includes('onSelectBom'))
      const hasOnClick = consoleLogs.some(log => log.includes('onClick'))
      
      console.log('\nHas onSelectBom log:', hasOnSelectBom ? '✅' : '❌')
      console.log('Has onClick log:', hasOnClick ? '✅' : '❌')
      
      console.log('\n=== Checking form fields ===')
      
      // Check spec field (readonly)
      const specInput = page.locator('input[placeholder="規格"]').first()
      const specValue = await specInput.inputValue()
      console.log('Spec value:', specValue || '(empty)')
      
      // Check unit field (readonly)
      const unitInputs = page.locator('input[readonly]')
      if (await unitInputs.count() > 0) {
        const unitValue = await unitInputs.first().inputValue()
        console.log('Unit value:', unitValue || '(empty)')
      }
      
      // Check unit_price field
      const priceInputs = page.locator('input[type="number"]')
      if (await priceInputs.count() > 1) {
        const priceValue = await priceInputs.nth(1).inputValue()
        console.log('Unit price value:', priceValue || '(empty)')
      }
      
      if (!specValue) {
        console.log('\n❌ BUG CONFIRMED: Fields not filled after BOM selection')
      } else {
        console.log('\n✅ SUCCESS: BOM selection works!')
      }
    } else {
      console.log('❌ No BOM options available')
    }
  } else {
    console.log('❌ Dropdown not visible')
  }
  
  await page.screenshot({ path: 'customer-order-bom-test.png', fullPage: true })
  await page.waitForTimeout(3000)
})
