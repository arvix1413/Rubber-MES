import { test } from '@playwright/test'

test('检查登录页元素', async ({ page }) => {
  await page.goto('http://43.133.56.234/login')
  
  console.log('\n=== 检查所有input元素 ===')
  const inputs = page.locator('input')
  const inputCount = await inputs.count()
  console.log(`总input数量: ${inputCount}`)
  
  for (let i = 0; i < inputCount; i++) {
    const input = inputs.nth(i)
    const type = await input.getAttribute('type')
    const placeholder = await input.getAttribute('placeholder')
    const name = await input.getAttribute('name')
    const id = await input.getAttribute('id')
    console.log(`Input ${i}: type="${type}", placeholder="${placeholder}", name="${name}", id="${id}"`)
  }
  
  console.log('\n=== 检查所有button元素 ===')
  const buttons = page.locator('button')
  const buttonCount = await buttons.count()
  console.log(`总button数量: ${buttonCount}`)
  
  for (let i = 0; i < buttonCount; i++) {
    const button = buttons.nth(i)
    const text = await button.textContent()
    const type = await button.getAttribute('type')
    console.log(`Button ${i}: text="${text}", type="${type}"`)
  }
  
  console.log('\n=== 尝试登录 ===')
  
  // 尝试不同的选择器
  const emailInput = page.locator('input[type="email"]').or(page.locator('input[placeholder*="帳號"]')).or(page.locator('input').first())
  const passwordInput = page.locator('input[type="password"]')
  
  await emailInput.fill('admin')
  console.log('✓ 已填写用户名')
  
  await passwordInput.fill('admin123')
  console.log('✓ 已填写密码')
  
  await page.screenshot({ path: 'test-results/login-filled.png', fullPage: true })
  console.log('✓ 截图已保存')
  
  const submitButton = page.locator('button[type="submit"]')
  await submitButton.click()
  console.log('✓ 已点击登录按钮')
  
  await page.waitForTimeout(3000)
  
  const currentUrl = page.url()
  console.log(`当前URL: ${currentUrl}`)
  
  await page.screenshot({ path: 'test-results/after-login.png', fullPage: true })
  console.log('✓ 登录后截图已保存')
})
