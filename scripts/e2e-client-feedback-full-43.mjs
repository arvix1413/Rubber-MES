import { chromium } from 'playwright'
import fs from 'fs'

const WEB = process.env.PW43_WEB || 'http://43.160.199.226:10101'
const API = process.env.PW43_API || 'http://43.160.199.226:10102'
const ADMIN_EMAIL = process.env.PW43_ADMIN_EMAIL || 'admin@rubber.local'
const ADMIN_PASSWORD = process.env.PW43_ADMIN_PASSWORD || 'admin123'
const OUT = process.env.PW43_OUT_FILE || `/tmp/e2e-client-feedback-full-${Date.now()}.json`
const DEPLOY_WAIT_MS = Number(process.env.PW43_DEPLOY_WAIT_MS || 150000)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const tag = `CF${Date.now().toString().slice(-8)}`

const report = {
  tag,
  cases: [],
  api: [],
  cleanup: [],
}

const CASES = [
  'C01 材料管理單價顯示與輸入格式一致（3位小數）',
  'C02 材料Leadtime支持自由文本並正確顯示',
  'C03 新增表單數字輸入框初始不強制0',
  'C04 材料表格有橫向滾動與凍結欄位',
  'C05 BOM主料選擇後回填規格/供應商/單價',
  'C06 BOM新增列選材後回填備註與聚合價格',
  'C07 BOM首頁支持▸展開並顯示輔料row明細',
  'C08 客戶訂單選BOM後單價採用BOM聚合價格',
  'C09 客戶訂單二層明細支持第3層▸展開輔料',
  'C10 客戶訂單PO NO字段可保存並帶入後續流程',
  'C11 採購單API可按客戶訂單號帶出全部輔料',
  'C12 採購單UI可帶入、按供應商保留、刪除未勾選並成功建單',
]

function passCase(id, detail = {}) {
  report.cases.push({ id, ok: true, ...detail })
}
function failCase(id, error, detail = {}) {
  report.cases.push({ id, ok: false, error: String(error?.message || error), ...detail })
}
function ok(scope, step, detail = {}) {
  report[scope].push({ step, ok: true, ...detail })
}
function fail(scope, step, error, detail = {}) {
  report[scope].push({ step, ok: false, error: String(error?.message || error), ...detail })
}

async function req(method, path, token, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const txt = await res.text()
  let data
  try { data = txt ? JSON.parse(txt) : null } catch { data = { raw: txt } }
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${data?.error || txt}`)
  return data
}

async function loginUi(page) {
  await page.goto(`${WEB}/login`, { waitUntil: 'domcontentloaded' })
  await page.fill('input[type="email"]', ADMIN_EMAIL)
  await page.fill('input[type="password"]', ADMIN_PASSWORD)
  await Promise.all([
    page.waitForURL('**/dashboard**', { timeout: 30000 }),
    page.locator('button[type="submit"]').first().click(),
  ])
}

async function pickSearchable(page, placeholder, keyword, optionContains) {
  const box = page.locator(`input[placeholder='${placeholder}']`).first()
  await box.click()
  await box.fill(keyword)
  const opt = page.locator('div.bg-white.border.border-slate-300.rounded-md.shadow-lg.overflow-y-auto > div', { hasText: optionContains }).first()
  await opt.waitFor({ state: 'visible', timeout: 10000 })
  await opt.dispatchEvent('mousedown')
}

;(async () => {
  let token = ''
  let browser
  let page
  const ids = {}

  try {
    if (DEPLOY_WAIT_MS > 0) {
      console.log(`[deploy-wait] waiting ${DEPLOY_WAIT_MS}ms before E2E starts`)
      await sleep(DEPLOY_WAIT_MS)
    }

    const login = await req('POST', '/api/auth/login', null, { email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
    token = login.token
    ok('api', 'auth.login')

    const s1 = await req('POST', '/api/suppliers', token, { supplier_code: `${tag}-SUP1`, name: `${tag}-SUP1`, currency: 'VND', status: 'active' })
    const s2 = await req('POST', '/api/suppliers', token, { supplier_code: `${tag}-SUP2`, name: `${tag}-SUP2`, currency: 'VND', status: 'active' })
    ids.s1 = s1.id; ids.s2 = s2.id
    ok('api', 'suppliers.create.two')

    const customer = await req('POST', '/api/customers', token, {
      customer_code: `${tag}-CUS`, customer_name: `${tag}-CUS`, status: 'active',
    })
    ids.customer = customer.id
    ok('api', 'customers.create', { id: customer.id })

    const m1 = await req('POST', '/api/materials', token, {
      material_code: `${tag}-M1`, material_name: `${tag}-M1-NAME`, spec: 'Spec-A', unit: 'PCS',
      supplier_id: s1.id, supplier_price: 231.0, company_price: 397.8, currency: 'VND',
      leadtime: '15-20', moq: 5, remark: 'RMK-M1',
    })
    const m2 = await req('POST', '/api/materials', token, {
      material_code: `${tag}-M2`, material_name: `${tag}-M2-NAME`, spec: 'Spec-B', unit: 'PCS',
      supplier_id: s2.id, supplier_price: 20.8, company_price: 25.0, currency: 'VND',
      leadtime: '25~30', moq: 9, remark: 'RMK-M2',
    })
    ids.m1 = m1.id; ids.m2 = m2.id
    ok('api', 'materials.create.two')

    const bom = await req('POST', '/api/bom', token, {
      product_sku: `${tag}-SKU`, product_name: `${tag}-BOM`, material_name: `${tag}-M1-NAME`, unit: 'PCS',
      supplier_id: s1.id, supplier_name: `${tag}-SUP1`, supplier_price: 0, company_price: 0, currency: 'VND',
      items: [
        { material_id: m1.id, material_code: `${tag}-M1`, material_name: `${tag}-M1-NAME`, spec: 'Spec-A', unit: 'PCS', quantity: 1, supplier_name: `${tag}-SUP1`, supplier_price: 231.0, company_price: 397.8, currency: 'VND', remark: 'RMK-M1', lt: '15-20', moq: 5 },
        { material_id: m2.id, material_code: `${tag}-M2`, material_name: `${tag}-M2-NAME`, spec: 'Spec-B', unit: 'PCS', quantity: 1, supplier_name: `${tag}-SUP2`, supplier_price: 20.8, company_price: 25.0, currency: 'VND', remark: 'RMK-M2', lt: '25~30', moq: 9 },
      ],
    })
    ids.bom = bom.id
    ok('api', 'bom.create', { id: bom.id })

    const coNo = `${tag}-CO`
    const co = await req('POST', '/api/customer-orders', token, {
      po_number: coNo, customer_id: customer.id, customer_name: `${tag}-CUS`, currency: 'VND',
      items: [{ bom_id: ids.bom, qty: 3, unit_price: 422.8, po_no: `${tag}-PO-LINE-1`, remark: 'CO-RMK' }],
    })
    ids.co = co.id
    ids.coNo = coNo
    ok('api', 'customer-order.create', { id: co.id })

    browser = await chromium.launch({ headless: true })
    page = await browser.newPage({ viewport: { width: 1680, height: 1100 } })
    await loginUi(page)

    // C01,C02,C03,C04
    await page.goto(`${WEB}/dashboard/materials`, { waitUntil: 'domcontentloaded' })
    await page.locator('input[placeholder="搜尋物料編號 / 名稱 / 規格 / 供應商"]').fill(`${tag}-M1`)
    const matRow = page.locator('tbody tr', { hasText: `${tag}-M1` }).first()
    await matRow.waitFor({ state: 'visible', timeout: 10000 })
    const matText = await matRow.innerText()
    if (!matText.includes('231.000') || !matText.includes('397.800')) throw new Error('price formatting not 3 decimals')
    passCase('C01')
    if (!matText.includes('15-20')) throw new Error('leadtime free text not shown')
    passCase('C02')

    await page.getByRole('button', { name: '+ 新增材料' }).click()
    const supplierPriceInput = page.locator("label:has-text('供應商單價')").locator('xpath=following::input[1]')
    const supplierInit = await supplierPriceInput.inputValue()
    if (supplierInit !== '') throw new Error(`supplier price initial value should be empty, got: ${supplierInit}`)
    passCase('C03')
    await page.locator('button:has-text("取消")').first().click()

    await page.waitForSelector('.table-scroll-x', { timeout: 10000 })
    const stickyCount = await page.locator('th.sticky.left-0').count()
    if (stickyCount < 1) throw new Error('sticky columns not found')
    passCase('C04')

    // C05,C06,C07
    await page.goto(`${WEB}/dashboard/bom`, { waitUntil: 'domcontentloaded' })
    await page.getByRole('button', { name: '+ 建立 BOM' }).click()
    await page.locator("label:has-text('物料編號')").locator('xpath=following::input[1]').fill(`${tag}-SKU-UI`)
    await page.locator("label:has-text('產品名稱')").locator('xpath=following::input[1]').fill(`${tag}-BOM-UI`)
    await pickSearchable(page, '-- 選擇主料（自動帶入資料）--', `${tag}-M1`, `${tag}-M1`)

    const specInput = page.locator("label:has-text('規格') + input").first()
    const waitStart = Date.now()
    let specVal = await specInput.inputValue()
    while (Date.now() - waitStart < 7000 && !specVal.includes('Spec-A')) {
      await page.waitForTimeout(150)
      specVal = await specInput.inputValue()
    }
    if (!specVal.includes('Spec-A')) throw new Error('header material autofill failed')
    passCase('C05', { spec: specVal })

    await page.getByRole('button', { name: '+ 新增列' }).click()
    const row0Code = page.locator('tbody tr').first().locator('td').nth(0).locator('input')
    await row0Code.fill(`${tag}-M2`)
    await row0Code.press('Tab')
    await page.waitForTimeout(400)
    const row0Remark = await page.locator('tbody tr').first().locator('td').nth(11).locator('input').inputValue()
    const companyVal = await page.locator("label:has-text('公司售價')").locator('xpath=following::input[1]').inputValue()
    if (!row0Remark.includes('RMK-M2')) throw new Error('BOM row autofill remark failed')
    if (!['25', '25.0', '25.00'].some(v => companyVal.startsWith(v))) throw new Error(`BOM aggregate update failed: ${companyVal}`)
    passCase('C06', { row0Remark, companyVal })
    await page.locator('button:has-text("取消")').first().click()

    await page.locator('input[placeholder="搜尋物料編號、產品名稱..."]').fill(`${tag}-SKU`)
    const bomRow = page.locator('tbody tr', { hasText: `${tag}-SKU` }).first()
    await bomRow.waitFor({ state: 'visible', timeout: 10000 })
    await bomRow.click()
    const bomPanel = page.locator('div.expand-row-wrap.layer-panel-l2').first()
    await bomPanel.waitFor({ state: 'visible', timeout: 10000 })
    const bStart = Date.now()
    let bTxt = await bomPanel.innerText()
    while (Date.now() - bStart < 7000 && (!bTxt.includes(`${tag}-M1`) || !bTxt.includes(`${tag}-M2`))) {
      await page.waitForTimeout(200)
      bTxt = await bomPanel.innerText()
    }
    if (!bTxt.includes(`${tag}-M1`) || !bTxt.includes(`${tag}-M2`)) throw new Error('BOM expand does not show material rows')
    passCase('C07')

    // C08,C09,C10
    await page.goto(`${WEB}/dashboard/customer-orders`, { waitUntil: 'domcontentloaded' })
    await page.getByRole('button', { name: '+ 新增訂單' }).click()
    await page.locator("label:has-text('Order No')").locator('xpath=following::input[1]').fill(`${tag}-CO-UI`)
    await page.locator("label:has-text('客戶 *')").locator('xpath=following::select[1]').selectOption(String(ids.customer))
    await page.locator('input[placeholder="PO No"]').first().fill(`${tag}-PO-LINE-2`)
    await pickSearchable(page, '-- 選擇成品 BOM --', `${tag}-SKU`, `${tag}-SKU`)
    const up = await page.locator('table tbody tr').first().locator('td').nth(6).locator('input[type="number"]').inputValue()
    if (!up || Number(up) <= 0) throw new Error('customer order unit price not set from BOM')
    passCase('C08', { unit_price: up })
    await page.locator('button:has-text("取消")').first().click()

    await page.locator('input.list-search').fill(coNo)
    const coRow = page.locator('tr', { hasText: coNo }).first()
    await coRow.waitFor({ state: 'visible', timeout: 10000 })
    await coRow.click()
    const itemExpandBtn = page.locator('button[title="展開 BOM 輔料明細"]').first()
    await itemExpandBtn.waitFor({ state: 'visible', timeout: 10000 })
    await itemExpandBtn.click()
    const lv3 = page.locator('div.layer-panel-l3').first()
    await lv3.waitFor({ state: 'visible', timeout: 10000 })
    const cStart = Date.now()
    let lv3Text = await lv3.innerText()
    while (Date.now() - cStart < 7000 && (!lv3Text.includes(`${tag}-M1`) || !lv3Text.includes(`${tag}-M2`))) {
      await page.waitForTimeout(200)
      lv3Text = await lv3.innerText()
    }
    if (!lv3Text.includes(`${tag}-M1`) || !lv3Text.includes(`${tag}-M2`)) throw new Error('customer order level-3 detail missing bom materials')
    passCase('C09')
    const lv2Text = await page.locator('div.expand-row-wrap.layer-panel-l2').first().innerText()
    if (!lv2Text.includes(`${tag}-PO-LINE-1`)) throw new Error('PO NO not retained in customer order detail')
    passCase('C10')

    // C11 API + C12 UI
    const imported = await req('GET', `/api/po/materials-from-order-po/${encodeURIComponent(coNo)}`, token)
    if (!Array.isArray(imported.items) || imported.items.length < 2) throw new Error('po import endpoint missing material rows')
    if (!imported.items.some((x) => String(x.po_ref || '').includes(`${tag}-PO-LINE-1`))) throw new Error('po_ref missing in import endpoint')
    passCase('C11', { rows: imported.items.length, suppliers: imported.suppliers?.length || 0 })

    const uiPoNo = `${tag}-PO-UI`
    await page.goto(`${WEB}/dashboard/po`, { waitUntil: 'domcontentloaded' })
    await page.getByRole('button', { name: '+ 建立採購單' }).click()
    await page.locator("label:has-text('採購單號（選填）')").locator('xpath=following::input[1]').fill(uiPoNo)
    await page.locator("label:has-text('客戶訂單號（PO NO）')").locator('xpath=following::input[1]').fill(coNo)
    await page.getByRole('button', { name: '帶入客戶訂單輔料' }).click()
    await page.locator('text=帶入明細：').first().waitFor({ state: 'visible', timeout: 10000 })
    await page.locator("label:has-text('供應商 *')").locator('xpath=following::select[1]').selectOption(String(ids.s1))
    await page.getByRole('button', { name: '只保留當前供應商' }).click()
    await page.getByRole('button', { name: '刪除未勾選' }).click()
    const rowCount = await page.locator('table tbody tr').count()
    if (rowCount !== 1) throw new Error(`after supplier keep/remove expected 1 row, got ${rowCount}`)
    await page.getByRole('button', { name: '建立採購單', exact: true }).click()
    await page.locator('input.list-search').waitFor({ state: 'visible', timeout: 15000 })
    const poRows = await req('GET', '/api/po', token)
    const createdPo = Array.isArray(poRows) ? poRows.find((x) => String(x.po_number || '') === uiPoNo) : null
    if (!createdPo?.id) throw new Error(`created PO not found by po_number=${uiPoNo}`)
    ids.po = Number(createdPo.id)
    passCase('C12')

  } catch (e) {
    fail('api', 'run', e)
  } finally {
    try { if (ids.po) { await req('DELETE', `/api/po/${ids.po}`, token); ok('cleanup', 'po.delete') } } catch (e) { fail('cleanup', 'po.delete', e) }
    try { if (ids.co) { await req('DELETE', `/api/customer-orders/${ids.co}`, token); ok('cleanup', 'customer-order.delete') } } catch (e) { fail('cleanup', 'customer-order.delete', e) }
    try { if (ids.bom) { await req('DELETE', `/api/bom/${ids.bom}`, token); ok('cleanup', 'bom.delete') } } catch (e) { fail('cleanup', 'bom.delete', e) }
    try { if (ids.m1) { await req('DELETE', `/api/materials/${ids.m1}`, token); ok('cleanup', 'material1.delete') } } catch (e) { fail('cleanup', 'material1.delete', e) }
    try { if (ids.m2) { await req('DELETE', `/api/materials/${ids.m2}`, token); ok('cleanup', 'material2.delete') } } catch (e) { fail('cleanup', 'material2.delete', e) }
    try { if (ids.customer) { await req('DELETE', `/api/customers/${ids.customer}`, token); ok('cleanup', 'customer.delete') } } catch (e) { fail('cleanup', 'customer.delete', e) }
    try { if (ids.s1) { await req('DELETE', `/api/suppliers/${ids.s1}`, token); ok('cleanup', 'supplier1.delete') } } catch (e) { fail('cleanup', 'supplier1.delete', e) }
    try { if (ids.s2) { await req('DELETE', `/api/suppliers/${ids.s2}`, token); ok('cleanup', 'supplier2.delete') } } catch (e) { fail('cleanup', 'supplier2.delete', e) }

    if (page) await page.close().catch(() => {})
    if (browser) await browser.close().catch(() => {})

    const expectedIds = CASES.map((x) => x.split(' ')[0])
    const seenIds = new Set(report.cases.map((x) => x.id))
    for (const id of expectedIds) {
      if (!seenIds.has(id)) {
        failCase(id, '未执行：前置步骤失败导致中断')
      }
    }

    const passCount = report.cases.filter((x) => x.ok).length
    const failCount = report.cases.filter((x) => !x.ok).length
    const output = {
      ...report,
      case_count: CASES.length,
      case_names: CASES,
      pass_cases: passCount,
      fail_cases: failCount,
    }
    fs.writeFileSync(OUT, JSON.stringify(output, null, 2))
    console.log(JSON.stringify(output, null, 2))
    process.exit(failCount > 0 ? 1 : 0)
  }
})()
