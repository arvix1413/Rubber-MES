import { test } from '@playwright/test'

test('测试页面加载', async ({ page }) => {
  console.log('访问首页...')
  await page.goto('http://43.133.56.234', { timeout: 30000 })
  
  await page.screenshot({ path: 'test-results/homepage.png', fullPage: true })
  console.log('✓ 首页截图已保存')
  
  const title = await page.title()
  console.log(`页面标题: ${title}`)
  
  const content = await page.content()
  console.log(`页面内容长度: ${content.length}`)
  
  console.log('\n访问登录页...')
  await page.goto('http://43.133.56.234/login', { timeout: 30000 })
  
  await page.screenshot({ path: 'test-results/login-page.png', fullPage: true })
  console.log('✓ 登录页截图已保存')
  
  const loginTitle = await page.title()
  console.log(`登录页标题: ${loginTitle}`)
  
  // 检查输入框
  const textInputs = await page.locator('input[type="text"]').count()
  const passwordInputs = await page.locator('input[type="password"]').count()
  const buttons = await page.locator('button').count()
  
  console.log(`文本输入框数量: ${textInputs}`)
  console.log(`密码输入框数量: ${passwordInputs}`)
  console.log(`按钮数量: ${buttons}`)
})
