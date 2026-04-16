import { test, expect } from '@playwright/test'

const BASE_URL = 'http://43.133.56.234'

test.describe('BOM Image Upload', () => {
  test.beforeEach(async ({ page }) => {
    // Login
    await page.goto(`${BASE_URL}/login`)
    await page.fill('input[type="email"]', 'admin@oms.com')
    await page.fill('input[type="password"]', 'admin123')
    await page.click('button[type="submit"]')
    await page.waitForURL(`${BASE_URL}/dashboard`)
  })

  test('should display image in BOM list', async ({ page }) => {
    // Navigate to BOM page
    await page.goto(`${BASE_URL}/dashboard/bom`)
    await page.waitForLoadState('networkidle')

    // Wait for table to load
    await page.waitForSelector('table tbody tr', { timeout: 10000 })

    // Check if first row has an image
    const firstRowImage = page.locator('table tbody tr:first-child td:first-child img')
    const imageCount = await firstRowImage.count()

    if (imageCount > 0) {
      console.log('✅ Image found in first row')
      const imageSrc = await firstRowImage.getAttribute('src')
      console.log(`   Image src: ${imageSrc}`)
      expect(imageSrc).toBeTruthy()
    } else {
      console.log('⚠️  No image in first row (might be empty)')
      // Check for placeholder
      const placeholder = page.locator('table tbody tr:first-child td:first-child div')
      await expect(placeholder).toBeVisible()
    }
  })

  test('should show image upload in edit modal', async ({ page }) => {
    // Navigate to BOM page
    await page.goto(`${BASE_URL}/dashboard/bom`)
    await page.waitForLoadState('networkidle')

    // Wait for table to load
    await page.waitForSelector('table tbody tr', { timeout: 10000 })

    // Click edit button on first row
    await page.click('table tbody tr:first-child button:has-text("編輯")')

    // Wait for modal to appear
    await page.waitForSelector('input[type="file"]', { timeout: 5000 })

    // Check if image upload input exists
    const fileInput = page.locator('input[type="file"][accept="image/*"]')
    await expect(fileInput).toBeVisible()

    // Check if URL input exists
    const urlInput = page.locator('input[placeholder*="圖片 URL"]')
    await expect(urlInput).toBeVisible()

    console.log('✅ Image upload UI is present in edit modal')
  })

  test('should update image URL via text input', async ({ page }) => {
    // Navigate to BOM page
    await page.goto(`${BASE_URL}/dashboard/bom`)
    await page.waitForLoadState('networkidle')

    // Wait for table to load
    await page.waitForSelector('table tbody tr', { timeout: 10000 })

    // Get first BOM's SKU for verification
    const firstSku = await page.locator('table tbody tr:first-child td:nth-child(3)').textContent()
    console.log(`Testing with BOM SKU: ${firstSku}`)

    // Click edit button on first row
    await page.click('table tbody tr:first-child button:has-text("編輯")')

    // Wait for modal
    await page.waitForSelector('input[placeholder*="圖片 URL"]', { timeout: 5000 })

    // Enter test image URL
    const testImageUrl = '/uploads/test-playwright.jpg'
    await page.fill('input[placeholder*="圖片 URL"]', testImageUrl)

    // Save
    await page.click('button:has-text("儲存")')

    // Wait for modal to close
    await page.waitForSelector('input[placeholder*="圖片 URL"]', { state: 'hidden', timeout: 5000 })

    // Reload page to verify
    await page.reload()
    await page.waitForLoadState('networkidle')

    // Check if image is displayed
    const firstRowImage = page.locator('table tbody tr:first-child td:first-child img')
    const imageSrc = await firstRowImage.getAttribute('src')
    
    console.log(`✅ Image URL after save: ${imageSrc}`)
    expect(imageSrc).toBe(testImageUrl)
  })
})
