import { test, expect } from '@playwright/test'

test('combobox: 单输入框 + 搜索 + 选择', async ({ page }) => {
  const logs: string[] = []
  page.on('console', msg => logs.push(msg.text()))

  await page.goto('http://localhost:3000')
  await page.fill('input[type="email"]', 'admin@oms.com')
  await page.fill('input[type="password"]', 'admin123')
  await page.click('button:has-text("登入")')
  await page.waitForURL('**/dashboard', { timeout: 10000 })
  await page.waitForTimeout(1000)

  await page.click('a:has-text("客戶訂單")')
  await page.waitForTimeout(2000)
  await page.click('button:has-text("新增訂單")')
  await page.waitForTimeout(1000)

  // 找到BOM输入框（现在是input，不是div）
  const bomInput = page.locator('input[placeholder="-- 選擇成品 BOM --"]').first()
  const inputBox = await bomInput.boundingBox()
  console.log('输入框 bottom:', inputBox ? inputBox.y + inputBox.height : 'N/A')

  // 点击输入框，应该弹出列表
  await bomInput.click()
  await page.waitForTimeout(500)

  const dropdown = page.locator('div.bg-white.border.border-slate-300').first()
  const isVisible = await dropdown.isVisible()
  console.log('下拉列表可见:', isVisible)

  if (isVisible) {
    const dropdownBox = await dropdown.boundingBox()
    console.log('下拉列表 top:', dropdownBox?.y)

    if (inputBox && dropdownBox) {
      const gap = dropdownBox.y - (inputBox.y + inputBox.height)
      console.log('间距:', gap, 'px')
      console.log(gap >= 0 ? '✅ 下拉框在输入框下方' : '❌ 下拉框在输入框上方')
    }

    // 测试搜索功能
    await bomInput.fill('WGDP')
    await page.waitForTimeout(500)
    const options = dropdown.locator('div.px-3.py-2.text-xs')
    const count = await options.count()
    console.log('搜索"WGDP"后选项数:', count)

    // 选择第一个选项
    if (count > 0) {
      const firstText = await options.first().textContent()
      console.log('选择:', firstText)
      await options.first().click({ force: true })
      await page.waitForTimeout(500)

      // 验证输入框显示选中值
      const inputVal = await bomInput.inputValue()
      console.log('选中后输入框值:', inputVal)
      console.log(inputVal ? '✅ 选中值正确显示' : '❌ 选中值未显示')

      // 验证表单字段填充
      const specVal = await page.locator('input[placeholder="規格"]').first().inputValue()
      console.log('规格字段:', specVal || '(空)')
    }
  }

  await page.screenshot({ path: 'combobox-test.png', fullPage: true })
})
