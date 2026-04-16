import { test, expect } from '@playwright/test'

test('Test BOM selection locally with console logs', async ({ page }) => {
  // Listen to console messages
  const consoleLogs: string[] = []
  page.on('console', msg => {
    const text = msg.text()
    console.log('Browser console:', text)
    consoleLogs.push(text)
  })

  // Navigate to local frontend
  await page.goto('http://localhost:3000')
  
  // Login
  await page.fill('input[type="email"]', 'admin@oms.com')
  await page.fill('input[type="password"]', 'admin123')
  await page.click('button:has-text("登入")')
  
  // Wait for dashboard
  await page.waitForURL('**/dashboard')
  await page.waitForTimeout(1000)
  
  // Go to PO page
  await page.click('text=採購單管理')
  await page.waitForTimeout(1000)
  
  // Click create button
  await page.click('button:has-text("建立採購單")')
  await page.waitForTimeout(500)
  
  console.log('\n=== Step 1: Selecting supplier ===')
  
  // Select supplier
  const supplierSelect = page.locator('select').first()
  await supplierSelect.selectOption({ index: 1 }) // Select first supplier
  await page.waitForTimeout(500)
  
  console.log('\n=== Step 2: Opening BOM dropdown ===')
  
  // Find the BOM dropdown trigger
  const bomDropdown = page.locator('.oms-input.cursor-pointer').first()
  await bomDropdown.click()
  await page.waitForTimeout(500)
  
  console.log('\n=== Step 3: Checking if dropdown is visible ===')
  
  // Check if dropdown is visible
  const dropdown = page.locator('div.fixed.bg-white.border')
  const isVisible = await dropdown.isVisible()
  console.log('Dropdown visible:', isVisible)
  
  if (isVisible) {
    console.log('\n=== Step 4: Clicking on first BOM option ===')
    
    // Click on first option
    const firstOption = dropdown.locator('div.px-3.py-2.text-xs.cursor-pointer').first()
    const optionText = await firstOption.textContent()
    console.log('Clicking option:', optionText)
    
    await firstOption.click()
    await page.waitForTimeout(1000)
    
    console.log('\n=== Step 5: Checking console logs ===')
    console.log('Total console logs captured:', consoleLogs.length)
    consoleLogs.forEach((log, i) => {
      console.log(`  [${i}]:`, log)
    })
    
    // Check if selectBOM was called
    const hasSelectBOMLog = consoleLogs.some(log => log.includes('selectBOM'))
    const hasOnClickLog = consoleLogs.some(log => log.includes('onClick'))
    
    console.log('\nHas selectBOM log:', hasSelectBOMLog)
    console.log('Has onClick log:', hasOnClickLog)
    
    console.log('\n=== Step 6: Checking form fields ===')
    
    // Check if material_name field is filled
    const materialNameInput = page.locator('input[readonly]').first()
    const materialNameValue = await materialNameInput.inputValue()
    console.log('Material name value:', materialNameValue)
    
    if (!materialNameValue) {
      console.log('❌ Material name NOT filled - BUG CONFIRMED')
    } else {
      console.log('✅ Material name filled:', materialNameValue)
    }
  } else {
    console.log('❌ Dropdown not visible - cannot test')
  }
  
  // Keep browser open for manual inspection
  await page.waitForTimeout(5000)
})
