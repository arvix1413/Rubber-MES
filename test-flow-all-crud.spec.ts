import { expect, Page, test } from '@playwright/test'

const BASE_URL = process.env.RUBBER_BASE_URL || 'http://43.133.56.234:10101'
const LOGIN_EMAIL = process.env.RUBBER_LOGIN_EMAIL || 'admin@rubber.local'
const LOGIN_PASSWORD = process.env.RUBBER_LOGIN_PASSWORD || 'admin123'

const uid = `${Date.now().toString().slice(-6)}${Math.floor(Math.random() * 1000).toString().padStart(3, '0')}`

type FlowData = {
  customerCode: string
  customerName: string
  supplierCode: string
  supplierName: string
  bomSku: string
  bomName: string
  orderNo: string
  poNo: string
  dnNo: string
}

const data: FlowData = {
  customerCode: `E2E-C-${uid}`,
  customerName: `測試客戶${uid}`,
  supplierCode: `E2E-S-${uid}`,
  supplierName: `測試供應商${uid}`,
  bomSku: `E2E-BOM-${uid}`,
  bomName: `測試膠料${uid}`,
  orderNo: `E2E-CO-${uid}`,
  poNo: '',
  dnNo: '',
}

async function pause(page: Page, ms = 500) {
  await page.waitForTimeout(ms)
}

async function login(page: Page) {
  await page.goto(`${BASE_URL}/login`)
  await page.locator('input[type="email"]').fill(LOGIN_EMAIL)
  await page.locator('input[type="password"]').fill(LOGIN_PASSWORD)
  await page.getByRole('button', { name: /進入系統|登入中/ }).click()
  await page.waitForURL(/\/dashboard/, { timeout: 20000 })
  await pause(page, 900)
}

async function openPage(page: Page, path: string, title: RegExp) {
  await page.goto(`${BASE_URL}${path}`)
  await page.waitForLoadState('domcontentloaded')
  await expect(page.getByRole('heading', { level: 1 })).toContainText(title)
  await pause(page, 500)
}

async function selectByTextContains(selectLocator: ReturnType<Page['locator']>, keyword: string) {
  const value = await selectLocator.locator('option').evaluateAll((opts, key) => {
    const found = opts.find((opt) => (opt.textContent || '').includes(key))
    return found ? (found.getAttribute('value') || '') : ''
  }, keyword)
  if (!value) throw new Error(`找不到下拉選項: ${keyword}`)
  await selectLocator.selectOption(value)
}

async function selectFirstNonEmptyOption(selectLocator: ReturnType<Page['locator']>) {
  const value = await selectLocator.locator('option').evaluateAll((opts) => {
    const found = opts.find((opt) => (opt.getAttribute('value') || '').trim() !== '')
    return found ? (found.getAttribute('value') || '') : ''
  })
  if (!value) throw new Error('下拉無可選選項')
  await selectLocator.selectOption(value)
  return value
}

async function confirmDialog(page: Page) {
  const dialog = page.locator('div.fixed.inset-0').filter({ has: page.getByRole('button', { name: '取消' }) }).last()
  await expect(dialog).toBeVisible({ timeout: 6000 })
  await dialog.getByRole('button').nth(1).click()
  await pause(page, 500)
}

function rowByText(page: Page, text: string) {
  return page.locator('tbody tr', { hasText: text }).first()
}

test.describe.serial('全界面流程 CRUD + 造數', () => {
  test('walk all pages and run CRUD flows', async ({ page }) => {
    test.setTimeout(12 * 60 * 1000)
    page.setDefaultTimeout(15000)
    const errors: string[] = []

    const run = async (name: string, fn: () => Promise<void>) => {
      try {
        await test.step(name, fn)
      } catch (e: any) {
        errors.push(`${name}: ${e?.message || String(e)}`)
      }
    }

    await login(page)

    await run('Dashboard load', async () => {
      await openPage(page, '/dashboard', /Rubber|流程控制臺|Dashboard/)
    })

    await run('Customers CRUD', async () => {
      await openPage(page, '/dashboard/customers', /客戶管理/)

      await page.getByRole('button', { name: /新增客戶/ }).click()
      let modal = page.locator('.fixed .bg-white').last()
      await modal.locator('input').nth(0).fill(data.customerCode)
      await modal.locator('input').nth(1).fill(data.customerName)
      await modal.locator('input').nth(4).fill('0912000001')
      await modal.locator('input').nth(5).fill(`c${uid}@rubber.test`)
      await modal.getByRole('button', { name: '儲存' }).click()
      await pause(page, 1000)

      const search = page.getByPlaceholder('搜尋客戶名稱或編號...')
      await search.fill(data.customerCode)
      await pause(page, 900)
      const row = rowByText(page, data.customerCode)
      await expect(row).toBeVisible()
      await row.getByRole('button', { name: '編輯' }).click()
      modal = page.locator('.fixed .bg-white').last()
      await modal.locator('input').nth(1).fill(`${data.customerName}-改`)
      await modal.getByRole('button', { name: '儲存' }).click()
      await pause(page, 900)
      await expect(rowByText(page, data.customerCode)).toContainText(`${data.customerName}-改`)

      const tempCode = `${data.customerCode}-TMP`
      await page.getByRole('button', { name: /新增客戶/ }).click()
      modal = page.locator('.fixed .bg-white').last()
      await modal.locator('input').nth(0).fill(tempCode)
      await modal.locator('input').nth(1).fill(`臨時客戶${uid}`)
      await modal.getByRole('button', { name: '儲存' }).click()
      await pause(page, 1000)
      await search.fill(tempCode)
      await pause(page, 900)
      const tmpRow = rowByText(page, tempCode)
      await tmpRow.getByRole('button', { name: '刪除' }).click()
      await confirmDialog(page)
      await search.fill(tempCode)
      await pause(page, 800)
      await expect(page.locator('tbody tr', { hasText: tempCode })).toHaveCount(0)
    })

    await run('Suppliers CRUD', async () => {
      await openPage(page, '/dashboard/suppliers', /供應商管理/)

      await page.getByRole('button', { name: /新增供應商/ }).click()
      let modal = page.locator('.fixed .bg-white').last()
      await modal.locator('input').nth(0).fill(data.supplierCode)
      await modal.locator('input').nth(1).fill(data.supplierName)
      await modal.locator('input').nth(4).fill('0912000002')
      await modal.locator('input').nth(5).fill(`s${uid}@rubber.test`)
      await modal.getByRole('button', { name: '儲存' }).click()
      await pause(page, 1000)

      const search = page.getByPlaceholder('搜尋供應商名稱或編號...')
      await search.fill(data.supplierCode)
      await pause(page, 900)
      const row = rowByText(page, data.supplierCode)
      await expect(row).toBeVisible()
      await row.getByRole('button', { name: '編輯' }).click()
      modal = page.locator('.fixed .bg-white').last()
      await modal.locator('input').nth(1).fill(`${data.supplierName}-改`)
      await modal.getByRole('button', { name: '儲存' }).click()
      await pause(page, 900)
      await expect(rowByText(page, data.supplierCode)).toContainText(`${data.supplierName}-改`)

      const tempCode = `${data.supplierCode}-TMP`
      await page.getByRole('button', { name: /新增供應商/ }).click()
      modal = page.locator('.fixed .bg-white').last()
      await modal.locator('input').nth(0).fill(tempCode)
      await modal.locator('input').nth(1).fill(`臨時供應商${uid}`)
      await modal.getByRole('button', { name: '儲存' }).click()
      await pause(page, 900)
      await search.fill(tempCode)
      await pause(page, 900)
      const tmpRow = rowByText(page, tempCode)
      await tmpRow.getByRole('button', { name: '刪除' }).click()
      await confirmDialog(page)
      await search.fill(tempCode)
      await pause(page, 800)
      await expect(page.locator('tbody tr', { hasText: tempCode })).toHaveCount(0)
    })

    await run('BOM CRUD', async () => {
      await openPage(page, '/dashboard/bom', /材料明細/)

      await page.getByRole('button', { name: '+ 建立材料' }).click()
      let modal = page.locator('.fixed .bg-white').last()
      await modal.locator('div:has(> label:has-text("物料編號")) input').first().fill(data.bomSku)
      await modal.locator('div:has(> label:has-text("產品名稱")) input').first().fill(data.bomName)
      await modal.locator('div:has(> label:has-text("材料名稱")) input').first().fill(`原料-${uid}`)
      await modal.locator('div:has(> label:has-text("規格")) input').first().fill('80A')
      await modal.locator('div:has(> label:has-text("分類")) input').first().fill('E2E')
      await modal.locator('div:has(> label:has-text("供應商單價")) input').first().fill('12.5')
      await modal.locator('div:has(> label:has-text("公司售價")) input').first().fill('18.8')
      await modal.getByRole('button', { name: '建立材料' }).click()
      await pause(page, 1200)

      const search = page.getByPlaceholder('搜尋物料編號、產品名稱...')
      await search.fill(data.bomSku)
      await pause(page, 900)
      const row = rowByText(page, data.bomSku)
      await expect(row).toBeVisible()
      await row.getByRole('button', { name: '編輯' }).click()
      modal = page.locator('.fixed .bg-white').last()
      await modal.locator('div:has(> label:has-text("產品名稱")) input').first().fill(`${data.bomName}-改`)
      await modal.getByRole('button', { name: '儲存修改' }).click()
      await pause(page, 1000)
      await expect(rowByText(page, data.bomSku)).toContainText(`${data.bomName}-改`)
    })

    await run('Customer Orders CRUD', async () => {
      await openPage(page, '/dashboard/customer-orders', /客戶訂單/)

      await page.getByRole('button', { name: /\+ 新增訂單/ }).click()
      const card = page.locator('.rubber-card').filter({ hasText: '新增客戶訂單' }).first()
      await card.locator('div:has(> label:has-text("Order No")) input').fill(data.orderNo)
      const customerSelect = card.locator('div:has(> label:has-text("客戶")) select')
      if ((await customerSelect.locator('option').count()) > 1) {
        try {
          await selectByTextContains(customerSelect, data.customerCode)
        } catch {
          await selectFirstNonEmptyOption(customerSelect)
        }
      }
      await card.locator('div:has(> label:has-text("RTA Default")) input').fill('2026-04-30')
      await card.getByPlaceholder('-- 選擇成品 BOM --').first().click()
      await card.getByPlaceholder('-- 選擇成品 BOM --').first().fill(data.bomSku)
      const bomOption = page.locator('div[style*="z-index: 9999"] div', { hasText: data.bomSku }).first()
      if (await bomOption.count()) {
        await bomOption.click()
      } else {
        await page.locator('div[style*="z-index: 9999"] div').first().click()
      }
      await card.locator('tbody tr').first().locator('input[type="number"]').first().fill('25')
      await card.locator('div:has(> label:has-text("備註")) textarea').fill(`E2E 訂單 ${uid}`)
      await card.getByRole('button', { name: '建立訂單' }).click()
      await pause(page, 1400)
      if (!(await page.getByPlaceholder('搜尋客戶訂單號或客戶...').isVisible().catch(() => false))) {
        await page.getByRole('button', { name: '取消' }).first().click()
      }

      const search = page.getByPlaceholder('搜尋客戶訂單號或客戶...')
      await search.fill(data.orderNo)
      await pause(page, 1000)
      let row = rowByText(page, data.orderNo)
      if (await row.count() === 0) row = page.locator('tbody tr').first()
      if (await row.count() === 0) return
      const rowCells = row.locator('td')
      if ((await rowCells.count()) < 2) return
      await expect(row).toBeVisible()
      data.orderNo = (await row.locator('td').nth(1).textContent())?.trim() || data.orderNo
      await row.getByRole('button', { name: /編輯/ }).click()
      const editCard = page.locator('.rubber-card').filter({ hasText: '編輯客戶訂單' }).first()
      await editCard.locator('div:has(> label:has-text("備註")) textarea').fill(`E2E 訂單更新 ${uid}`)
      await editCard.getByRole('button', { name: '儲存修改' }).click()
      await pause(page, 1200)
      await search.fill(data.orderNo)
      await pause(page, 700)
      await expect(rowByText(page, data.orderNo)).toBeVisible()
    })

    await run('PO CRUD + status flow', async () => {
      await openPage(page, '/dashboard/po', /採購單管理/)

      await page.getByRole('button', { name: /\+ 建立採購單/ }).click()
      const card = page.locator('.rubber-card').filter({ hasText: '建立採購單' }).first()
      const supplierSelect = card.locator('div:has(> label:has-text("供應商")) select')
      if ((await supplierSelect.locator('option').count()) > 1) {
        try {
          await selectByTextContains(supplierSelect, data.supplierCode)
        } catch {
          await selectFirstNonEmptyOption(supplierSelect)
        }
      }
      await card.getByPlaceholder('-- 選擇 BOM --').first().click()
      await card.getByPlaceholder('-- 選擇 BOM --').first().fill(data.bomSku)
      const bomOption = page.locator('div[style*="z-index: 9999"] div', { hasText: data.bomSku }).first()
      if (await bomOption.count()) {
        await bomOption.click()
      } else {
        await page.locator('div[style*="z-index: 9999"] div').first().click()
      }
      await card.locator('input[placeholder="PO編號"]').first().fill(`PO-REF-${uid}`)
      await card.locator('tbody tr').first().locator('input[type="number"]').first().fill('30')
      await card.locator('div:has(> label:has-text("備註")) textarea').fill(`PO E2E ${uid}`)
      await card.getByRole('button', { name: '建立採購單' }).click()
      await pause(page, 1500)
      if (!(await page.getByPlaceholder('搜尋 PO NO 或供應商...').isVisible().catch(() => false))) {
        await page.getByRole('button', { name: '取消' }).first().click()
      }

      const search = page.getByPlaceholder('搜尋 PO NO 或供應商...')
      await search.fill(data.supplierCode)
      await pause(page, 900)
      let row = rowByText(page, data.supplierCode)
      if (await row.count() === 0) row = page.locator('tbody tr').first()
      if (await row.count() === 0) return
      const rowCells = row.locator('td')
      if ((await rowCells.count()) < 2) return
      await expect(row).toBeVisible()
      data.poNo = (await row.locator('td').nth(1).textContent())?.trim() || ''

      const editBtn = row.getByRole('button', { name: /編輯/ })
      if (await editBtn.count()) {
        await editBtn.click()
        const editCard = page.locator('.rubber-card').filter({ hasText: '編輯採購單' }).first()
        await editCard.locator('div:has(> label:has-text("備註")) textarea').fill(`PO E2E update ${uid}`)
        await editCard.getByRole('button', { name: '儲存修改' }).click()
        await pause(page, 1000)
      }

      await search.fill(data.supplierCode)
      await pause(page, 800)
      const statusRow = rowByText(page, data.supplierCode)
      const approve = statusRow.getByRole('button', { name: '核准' })
      if (await approve.count()) {
        await approve.click()
        await pause(page, 900)
      }
      const send = statusRow.getByRole('button', { name: '送出' })
      if (await send.count()) {
        await send.click()
        await confirmDialog(page)
      }
      const receive = statusRow.getByRole('button', { name: '確認收貨' })
      if (await receive.count()) {
        await receive.click()
        await confirmDialog(page)
      }
    })

    await run('Delivery Notes CRUD + status flow', async () => {
      await openPage(page, '/dashboard/delivery-notes', /出貨單/)

      await page.getByRole('button', { name: /\+ 新增出貨單/ }).click()
      const createCard = page.locator('.rubber-card').filter({ hasText: '新增出貨單' }).first()
      const customerSelect = createCard.locator('div:has(> label:has-text("客戶")) select')
      if ((await customerSelect.locator('option').count()) > 1) {
        try {
          await selectByTextContains(customerSelect, data.customerName)
        } catch {
          await selectFirstNonEmptyOption(customerSelect)
        }
      }
      const orderSelect = createCard.locator('div:has(> label:has-text("待出貨訂單")) select')
      if ((await orderSelect.locator('option').count()) <= 1) {
        return
      }
      let orderValue = ''
      try {
        await selectByTextContains(orderSelect, data.orderNo)
        orderValue = await orderSelect.inputValue()
      } catch {
        orderValue = await selectFirstNonEmptyOption(orderSelect)
      }
      const chosenOrderText = await orderSelect.locator(`option[value="${orderValue}"]`).textContent()
      if (chosenOrderText) data.orderNo = chosenOrderText.split('(')[0].trim()
      await createCard.locator('div:has(> label:has-text("出貨日期")) input').fill('2026-05-01')
      await createCard.locator('div:has(> label:has-text("備註")) textarea').fill(`DN E2E ${uid}`)
      await createCard.getByRole('button', { name: '建立出貨單' }).click()
      await pause(page, 1500)

      const search = page.getByPlaceholder('搜尋出貨單號或客戶...')
      await search.fill(data.orderNo)
      await pause(page, 900)
      const row = rowByText(page, data.orderNo)
      await expect(row).toBeVisible()
      data.dnNo = (await row.locator('td').nth(1).textContent())?.trim() || ''

      const editBtn = row.getByRole('button', { name: /編輯/ })
      if (await editBtn.count()) {
        await editBtn.click()
        const editCard = page.locator('.rubber-card').filter({ hasText: '編輯出貨單' }).first()
        await editCard.locator('div:has(> label:has-text("備註")) input').fill(`DN E2E update ${uid}`)
        await editCard.getByRole('button', { name: '儲存修改' }).click()
        await pause(page, 1000)
      }

      await search.fill(data.orderNo)
      await pause(page, 700)
      const statusRow = rowByText(page, data.orderNo)
      const confirmBtn = statusRow.getByRole('button', { name: '確認' })
      if (await confirmBtn.count()) {
        await confirmBtn.click()
        await confirmDialog(page)
      }
      const shipBtn = statusRow.getByRole('button', { name: '出貨' })
      if (await shipBtn.count()) {
        await shipBtn.click()
        await confirmDialog(page)
      }
    })

    await run('Shipment Reconciliation CRUD', async () => {
      await openPage(page, '/dashboard/shipment-reconciliation', /出貨核對/)

      await page.getByRole('button', { name: /\+ 新建核對單/ }).click()
      const createCard = page.locator('.rubber-card').filter({ hasText: '建立核對單' }).first()
      let pendingRow = createCard.locator('tbody tr', { hasText: data.orderNo }).first()
      if (await pendingRow.count() === 0) {
        pendingRow = createCard.locator('tbody tr').first()
      }
      if (await pendingRow.count() === 0 || await createCard.getByText('目前沒有待核對出貨項目').isVisible().catch(() => false)) {
        return
      }
      await pendingRow.locator('input[type="checkbox"]').check()
      const acceptedInput = pendingRow.locator('input[type="number"]').first()
      const current = Number(await acceptedInput.inputValue())
      await acceptedInput.fill(String(Math.max(0, current - 1)))
      await pendingRow.locator('input[placeholder="可選"]').first().fill('抽樣差異')
      await createCard.getByRole('button', { name: '建立核對單' }).click()
      await pause(page, 1400)

      const draftRow = page.locator('tbody tr', { hasText: '草稿' }).first()
      await expect(draftRow).toBeVisible()
      await draftRow.getByRole('button', { name: '明細' }).click()
      await pause(page, 700)
      const expanded = page.locator('tr:has(input[class*="rubber-input"])').first()
      const reasonInput = expanded.locator('input.rubber-input').last()
      if (await reasonInput.count()) {
        await reasonInput.fill('草稿更新原因')
      }
      const saveDraftBtn = page.getByRole('button', { name: '儲存草稿' }).first()
      if (await saveDraftBtn.count()) {
        await saveDraftBtn.click()
        await pause(page, 900)
      }
      const confirmBtn = draftRow.getByRole('button', { name: '確認' })
      if (await confirmBtn.count()) {
        await confirmBtn.click()
        await confirmDialog(page)
      }
    })

    await run('Invoices CRUD (customer + supplier)', async () => {
      await openPage(page, '/dashboard/invoices', /發票管理/)
      await page.getByRole('button', { name: '客戶發票' }).click()
      await pause(page, 800)
      await page.getByRole('button', { name: /\+ 新建發票/ }).click()
      const createCard = page.locator('.rubber-card').filter({ hasText: '建立發票草稿' }).first()
      let pendingRow = createCard.locator('tbody tr', { hasText: data.orderNo }).first()
      if (await pendingRow.count() === 0) {
        pendingRow = createCard.locator('tbody tr').first()
      }
      if (await pendingRow.count() === 0 || await createCard.getByText('目前無待開票項目').isVisible().catch(() => false)) {
        return
      }
      if (await pendingRow.count() > 0) {
        await pendingRow.locator('input[type="checkbox"]').check()
        await createCard.getByRole('button', { name: '建立發票草稿' }).click()
        await pause(page, 1300)

        const draftRow = page.locator('tbody tr', { hasText: '草稿' }).first()
        await expect(draftRow).toBeVisible()
        await draftRow.getByRole('button', { name: '明細' }).click()
        await pause(page, 600)
        const remarkInput = page.locator('label:has-text("備註") + input').first()
        if (await remarkInput.count()) {
          await remarkInput.fill(`INV E2E ${uid}`)
        }
        const saveBtn = page.getByRole('button', { name: '儲存草稿' }).first()
        if (await saveBtn.count()) {
          await saveBtn.click()
          await pause(page, 700)
        }
        const confirmBtn = draftRow.getByRole('button', { name: '確認' })
        if (await confirmBtn.count()) {
          await confirmBtn.click()
          await confirmDialog(page)
        }
      }

      await page.getByRole('button', { name: '供應商發票' }).click()
      await pause(page, 800)
      await page.getByRole('button', { name: /\+ 新建發票/ }).click()
      const supplierCard = page.locator('.rubber-card').filter({ hasText: '建立發票草稿' }).first()
      const supplierPending = supplierCard.locator('tbody tr').first()
      if (await supplierPending.count() > 0 && !(await supplierCard.getByText('目前無待開票項目').isVisible().catch(() => false))) {
        await supplierPending.locator('input[type="checkbox"]').check()
        await supplierCard.getByRole('button', { name: '建立發票草稿' }).click()
        await pause(page, 1200)
        const supplierDraft = page.locator('tbody tr', { hasText: '草稿' }).first()
        if (await supplierDraft.count()) {
          const confirmBtn = supplierDraft.getByRole('button', { name: '確認' })
          if (await confirmBtn.count()) {
            await confirmBtn.click()
            await confirmDialog(page)
          }
        }
      }
    })

    await run('Payables update flow', async () => {
      await openPage(page, '/dashboard/payables', /應付帳款管理/)
      const search = page.getByPlaceholder('搜尋採購單號或供應商...')
      if (data.poNo) {
        await search.fill(data.poNo)
      } else {
        await search.fill(data.supplierCode)
      }
      await pause(page, 900)
      let row = data.poNo ? rowByText(page, data.poNo) : rowByText(page, data.supplierCode)
      if (await row.count() === 0) {
        row = page.locator('tbody tr').first()
      }
      if (await row.count() > 0 && !(await page.getByText('尚無待付款記錄').isVisible().catch(() => false))) {
        await row.getByRole('button', { name: '付款' }).click()
        const modal = page.locator('.fixed .bg-white').last()
        await modal.locator('select').selectOption('partial')
        await modal.locator('input[type="number"]').fill('100')
        await modal.getByRole('button', { name: '儲存' }).click()
        await pause(page, 1000)

        await search.fill(data.poNo || data.supplierCode)
        await pause(page, 700)
        row = data.poNo ? rowByText(page, data.poNo) : rowByText(page, data.supplierCode)
        await row.getByRole('button', { name: '付款' }).click()
        const modal2 = page.locator('.fixed .bg-white').last()
        await modal2.locator('select').selectOption('paid')
        await modal2.getByRole('button', { name: '儲存' }).click()
        await pause(page, 900)
      }
    })

    await run('Inventory check with created BOM data', async () => {
      await openPage(page, '/dashboard/inventory', /庫存查詢/)
      const search = page.getByPlaceholder('搜尋料號、品名、規格、供應商...')
      await search.fill(data.bomSku)
      await pause(page, 900)
      await expect(page.locator('table')).toBeVisible()
    })

    await run('Order Intake check with created order data', async () => {
      await openPage(page, '/dashboard/order-intake', /訂單收集池/)
      await page.getByPlaceholder('搜尋客戶、訂單號、料號、品名').fill(data.orderNo)
      await page.getByRole('button', { name: '查詢' }).click()
      await pause(page, 900)
      await expect(page.locator('table')).toBeVisible()
    })

    await run('Profile page load', async () => {
      await openPage(page, '/dashboard/profile', /Rubber Admin|電子簽名|修改密碼/)
      await expect(page.getByText('修改密碼')).toBeVisible()
      await expect(page.getByText('電子簽名')).toBeVisible()
    })

    if (errors.length) {
      throw new Error(`流程未全部通過:\n${errors.join('\n')}`)
    }
  })
})
