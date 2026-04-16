import { test, expect } from '@playwright/test'

test('Test BOM selection click event locally', async ({ page }) => {
  // Listen to ALL console messages
  const consoleLogs: string[] = []
  page.on('console', msg => {
    const text = msg.text()
    console.log('🔵 Browser console:', text)
    consoleLogs.push(text)
  })

  // Navigate to local frontend
  await page.goto('http://localhost:3000')
  
  // Login
  await page.fill('input[type="email"]', 'admin@oms.com')
  await page.fill('input[type="password"]', 'admin123')
  await page.click('button:has-text("登入")')
  
  // Wait for dashboard
  await page.waitForURL('**/dashboard', { timeout: 10000 })
  await page.waitForTimeout(1000)
  
  console.log('\n=== Step 1: Navigating to PO page ===')
  
  // Click on "採購單" link
  await page.click('a:has-text("採購單")')
  await page.waitForTimeout(2000)
  
  console.log('\n=== Step 2: Clicking create button ===')
  
  // Click create button
  await page.click('button:has-text("建立採購單")')
  await page.waitForTimeout(1000)
  
  console.log('\n=== Step 3: Selecting supplier ===')
  
  // Select supplier (first non-empty option)
  const supplierSelect = page.locator('select').first()
  await supplierSelect.selectOption({ index: 1 })
  await page.waitForTimeout(1000)
  
  console.log('\n=== Step 4: Opening BOM dropdown ===')
  
  // Find and click the BOM dropdown
  const bomDropdown = page.locator('.oms-input.cursor-pointer').first()
  await bomDropdown.click()
  await page.waitForTimeout(1000)
  
  console.log('\n=== Step 5: Checking dropdown visibility ===')
  
  // Check if dropdown is visible
  const dropdown = page.locator('div.fixed.bg-white.border')
  const isVisible = await dropdown.isVisible()
  console.log('✅ Dropdown visible:', isVisible)
  
  if (isVisible) {
    // Get all options
    const options = dropdown.locator('div.px-3.py-2.text-xs.cursor-pointer')
    const count = await options.count()
    console.log('✅ Number of options:', count)
    
    if (count > 0) {
      console.log('\n=== Step 6: Clicking first BOM option ===')
      
      const firstOption = options.first()
      const optionText = await firstOption.textContent()
      console.log('Clicking option:', optionText)
      
      // Clear console logs before clicking
      consoleLogs.length = 0
      
      // Click the option
      await firstOption.click()
      await page.waitForTimeout(2000)
      
      console.log('\n=== Step 7: Checking console logs after click ===')
      console.log('Total console logs after click:', consoleLogs.length)
      
      if (consoleLogs.length > 0) {
        consoleLogs.forEach((log, i) => {
          console.log(`  [${i}]:`, log)
        })
      } else {
        console.log('❌ NO CONSOLE LOGS - onClick event NOT triggered!')
      }
      
      // Check for specific logs
      const hasSelectBOMLog = consoleLogs.some(log => log.includes('selectBOM'))
      const hasOnClickLog = consoleLogs.some(log => log.includes('onClick'))
      
      console.log('\n=== Analysis ===')
      console.log('Has selectBOM log:', hasSelectBOMLog ? '✅' : '❌')
      console.log('Has onClick log:', hasOnClickLog ? '✅' : '❌')
      
      console.log('\n=== Step 8: Checking form fields ===')
      
      // Wait a bit for state update
      await page.waitForTimeout(1000)
      
      // Check material_name field (should be readonly and filled)
      const materialNameInputs = page.locator('input[readonly]')
      const count2 = await materialNameInputs.count()
      console.log('Number of readonly inputs:', count2)
      
      if (count2 > 0) {
        const materialNameValue = await materialNameInputs.first().inputValue()
        console.log('Material name value:', materialNameValue || '(empty)')
        
        if (!materialNameValue) {
          console.log('❌ BUG CONFIRMED: Material name NOT filled after BOM selection')
        } else {
          console.log('✅ Material name filled successfully')
        }
      }
    } else {
      console.log('❌ No BOM options available')
    }
  } else {
    console.log('❌ Dropdown not visible')
  }
  
  // Take screenshot
  await page.screenshot({ path: 'bom-selection-test.png', fullPage: true })
  
  // Keep browser open for inspection
  await page.waitForTimeout(3000)
})
