import { test, expect } from '@playwright/test'

test('Check BOM data and supplier association', async ({ page }) => {
  // Navigate to local frontend
  await page.goto('http://localhost:3000')
  
  // Login
  await page.fill('input[type="email"]', 'admin@oms.com')
  await page.fill('input[type="password"]', 'admin123')
  await page.click('button:has-text("登入")')
  
  // Wait for dashboard
  await page.waitForURL('**/dashboard', { timeout: 10000 })
  await page.waitForTimeout(1000)
  
  // Go to PO page
  await page.click('a:has-text("採購單")')
  await page.waitForTimeout(2000)
  
  // Click create button
  await page.click('button:has-text("建立採購單")')
  await page.waitForTimeout(1000)
  
  console.log('\n=== Checking suppliers ===')
  
  // Get all supplier options
  const supplierSelect = page.locator('select').first()
  const supplierOptions = await supplierSelect.locator('option').allTextContents()
  console.log('Suppliers:', supplierOptions)
  
  // Try each supplier
  for (let i = 1; i < supplierOptions.length; i++) {
    console.log(`\n=== Testing supplier ${i}: ${supplierOptions[i]} ===`)
    
    // Select supplier
    await supplierSelect.selectOption({ index: i })
    await page.waitForTimeout(500)
    
    // Open BOM dropdown
    const bomDropdown = page.locator('.oms-input.cursor-pointer').first()
    await bomDropdown.click()
    await page.waitForTimeout(500)
    
    // Check options
    const dropdown = page.locator('div.fixed.bg-white.border')
    const isVisible = await dropdown.isVisible()
    
    if (isVisible) {
      const options = dropdown.locator('div.px-3.py-2.text-xs.cursor-pointer')
      const count = await options.count()
      console.log(`  BOM options count: ${count}`)
      
      if (count > 0) {
        // Get first 3 options
        const optionTexts = await options.allTextContents()
        console.log(`  First options:`)
        optionTexts.slice(0, 3).forEach((text, idx) => {
          console.log(`    [${idx}]: ${text}`)
        })
        
        // This supplier has BOMs, let's test clicking
        console.log(`\n  ✅ Found supplier with BOMs! Testing click...`)
        
        const firstOption = options.first()
        await firstOption.click()
        await page.waitForTimeout(1000)
        
        // Check if material name is filled
        const materialNameInputs = page.locator('input[readonly]')
        if (await materialNameInputs.count() > 0) {
          const materialNameValue = await materialNameInputs.first().inputValue()
          console.log(`  Material name after click: "${materialNameValue}"`)
          
          if (materialNameValue) {
            console.log(`  ✅ SUCCESS: BOM selection works!`)
          } else {
            console.log(`  ❌ BUG: Material name not filled`)
          }
        }
        
        break // Stop after finding a supplier with BOMs
      } else {
        console.log(`  ⚠️  No BOMs for this supplier`)
      }
      
      // Close dropdown
      await page.keyboard.press('Escape')
      await page.waitForTimeout(300)
    }
  }
  
  await page.waitForTimeout(2000)
})
