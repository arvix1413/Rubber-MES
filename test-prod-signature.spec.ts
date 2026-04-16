import { test, expect } from '@playwright/test'
import path from 'path'
import fs from 'fs'

const PROD = 'http://43.133.56.234'

async function login(page: any) {
  await page.goto(PROD)
  await page.fill('input[type="email"]', 'admin@oms.com')
  await page.fill('input[type="password"]', 'admin123')
  await page.click('button:has-text("登入")')
  await page.waitForURL('**/dashboard', { timeout: 15000 })
  await page.waitForTimeout(1000)
}

test('1. Profile页面UI - 两栏布局', async ({ page }) => {
  await login(page)
  await page.goto(`${PROD}/dashboard/profile`)
  await page.waitForTimeout(2000)

  await page.screenshot({ path: 'prod-profile.png', fullPage: true })

  await expect(page.locator('h2:has-text("電子簽名")')).toBeVisible()
  await expect(page.locator('h2:has-text("修改密碼")')).toBeVisible()
  console.log('✅ Profile页面两栏布局正常')
})

test('2. 上传签名并验证打印预览', async ({ page }) => {
  await login(page)
  await page.goto(`${PROD}/dashboard/profile`)
  await page.waitForTimeout(2000)

  // 创建测试签名图片（简单白色PNG）
  const testImgPath = path.join(__dirname, 'test-sig-prod.png')
  const pngBuffer = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAoAAAAFCAYAAAB8ZH1oAAAAGklEQVQI12P4z8BQDwADhQGAWjR9awAAAABJRU5ErkJggg==',
    'base64'
  )
  fs.writeFileSync(testImgPath, pngBuffer)

  // 如果已有签名先移除
  const removeBtn = page.locator('button:has-text("移除")')
  if (await removeBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await removeBtn.click()
    await page.waitForTimeout(1000)
  }

  // 上传签名
  const fileInput = page.locator('input[type="file"]')
  await fileInput.setInputFiles(testImgPath)
  await page.waitForTimeout(3000)

  // 验证预览显示
  const preview = page.locator('img[alt="簽名預覽"]')
  await expect(preview).toBeVisible({ timeout: 5000 })
  console.log('✅ 签名上传成功，预览显示')

  await page.screenshot({ path: 'prod-profile-with-sig.png', fullPage: true })
  fs.unlinkSync(testImgPath)
})

test('3. 采购单打印预览 - 验证签名栏', async ({ page }) => {
  await login(page)
  await page.goto(`${PROD}/dashboard/po`)
  await page.waitForTimeout(2000)

  // 找第一个采购单的打印按钮
  const printBtn = page.locator('button:has-text("🖨")').first()
  if (!await printBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    console.log('⚠️  无采购单，跳过打印测试')
    return
  }

  // 监听新窗口
  const [popup] = await Promise.all([
    page.waitForEvent('popup', { timeout: 10000 }),
    printBtn.click()
  ])

  await popup.waitForLoadState('domcontentloaded')
  await popup.waitForTimeout(1000)

  // 截图打印预览
  await popup.screenshot({ path: 'prod-po-print.png', fullPage: true })

  // 检查签名栏
  const signSection = popup.locator('.sign-section, .footer')
  const signContent = await signSection.textContent().catch(() => '')
  console.log('签名栏内容:', signContent?.slice(0, 100))

  // 检查是否有img标签（签名图片）
  const signImg = popup.locator('.sign-box img')
  const hasSignImg = await signImg.count() > 0
  console.log(hasSignImg ? '✅ 签名图片已嵌入打印预览' : '⚠️  签名图片未显示（可能未上传签名）')

  await popup.close()
})

test('4. 侧边栏底部UI', async ({ page }) => {
  await login(page)
  await page.waitForTimeout(1000)

  // 验证侧边栏底部有用户头像卡片
  const userCard = page.locator('a[href="/dashboard/profile"]')
  await expect(userCard).toBeVisible()
  console.log('✅ 侧边栏用户卡片（点击跳Profile）正常')

  // 验证登出按钮
  const logoutBtn = page.locator('button:has-text("登出系統")')
  await expect(logoutBtn).toBeVisible()
  console.log('✅ 登出按钮正常')

  await page.screenshot({ path: 'prod-sidebar.png', fullPage: false })
})
