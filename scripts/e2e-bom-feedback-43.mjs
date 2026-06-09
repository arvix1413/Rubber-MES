import { chromium } from 'playwright'
import fs from 'fs'

const WEB = process.env.PW43_WEB || 'http://43.160.199.226:10101'
const API = process.env.PW43_API || 'http://43.160.199.226:10102'
const ADMIN_EMAIL = process.env.PW43_ADMIN_EMAIL || 'admin@rubber.local'
const ADMIN_PASSWORD = process.env.PW43_ADMIN_PASSWORD || 'admin123'
const OUT = process.env.PW43_OUT_FILE || `/tmp/e2e-bom-feedback-${Date.now()}.json`
const DEPLOY_WAIT_MS = Number(process.env.PW43_DEPLOY_WAIT_MS || 150000)

const tag = `FB${Date.now().toString().slice(-8)}`
const report = { tag, api: [], ui: [], cleanup: [] }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function ok(scope, step, extra={}) { report[scope].push({ step, ok: true, ...extra }) }
function fail(scope, step, error, extra={}) { report[scope].push({ step, ok: false, error: String(error?.message || error), ...extra }) }

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
  const opt = page
    .locator('div.bg-white.border.border-slate-300.rounded-md.shadow-lg.overflow-y-auto > div', { hasText: optionContains })
    .first()
  await opt.waitFor({ state: 'visible', timeout: 10000 })
  await opt.dispatchEvent('mousedown')
}

async function waitForInputValueContains(locator, expected, timeoutMs = 5000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const val = await locator.inputValue().catch(() => '')
    if (String(val).includes(expected)) return val
    await new Promise((r) => setTimeout(r, 120))
  }
  return await locator.inputValue().catch(() => '')
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

    // API setup + assertions
    const login = await req('POST', '/api/auth/login', null, { email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
    token = login.token
    ok('api', 'auth.login')

    const supplier = await req('POST', '/api/suppliers', token, {
      supplier_code: `${tag}-SUP`,
      name: `${tag}-SUP`,
      currency: 'VND',
      status: 'active',
    })
    ids.supplier = supplier.id
    ok('api', 'suppliers.create', { id: supplier.id })

    const customer = await req('POST', '/api/customers', token, {
      customer_code: `${tag}-CUS`,
      customer_name: `${tag}-CUS`,
      status: 'active',
    })
    ids.customer = customer.id
    ok('api', 'customers.create', { id: customer.id })

    const m1 = await req('POST', '/api/materials', token, {
      material_code: `${tag}-M1`,
      material_name: `${tag}-M1-NAME`,
      spec: 'Spec-A',
      unit: 'PCS',
      supplier_id: supplier.id,
      supplier_price: 7,
      company_price: 10,
      currency: 'VND',
      color: 'RED',
      leadtime: '15-20',
      moq: 5,
      remark: 'RMK-M1',
    })
    ids.m1 = m1.id
    const m2 = await req('POST', '/api/materials', token, {
      material_code: `${tag}-M2`,
      material_name: `${tag}-M2-NAME`,
      spec: 'Spec-B',
      unit: 'PCS',
      supplier_id: supplier.id,
      supplier_price: 8,
      company_price: 20,
      currency: 'VND',
      color: 'BLUE',
      leadtime: '25~30',
      moq: 9,
      remark: 'RMK-M2',
    })
    ids.m2 = m2.id
    ok('api', 'materials.create.2')

    const mats = await req('GET', '/api/materials', token)
    const row1 = mats.find((x) => x.id === ids.m1)
    if (!row1 || row1.leadtime !== '15-20') throw new Error('leadtime text not persisted/readable')
    ok('api', 'materials.leadtime.text', { leadtime: row1.leadtime })

    const bom = await req('POST', '/api/bom', token, {
      product_sku: `${tag}-SKU`,
      product_name: `${tag}-BOM`,
      material_name: `${tag}-M1-NAME`,
      unit: 'PCS',
      supplier_id: supplier.id,
      supplier_name: `${tag}-SUP`,
      supplier_price: 0,
      company_price: 0,
      currency: 'VND',
      items: [
        { material_code: `${tag}-M1`, material_name: `${tag}-M1-NAME`, spec: 'Spec-A', unit: 'PCS', quantity: 1, supplier_name: `${tag}-SUP`, supplier_price: 7, company_price: 10, currency: 'VND', remark: 'RMK-M1', color: 'RED', lt: '15-20', moq: 5 },
        { material_code: `${tag}-M2`, material_name: `${tag}-M2-NAME`, spec: 'Spec-B', unit: 'PCS', quantity: 1, supplier_name: `${tag}-SUP`, supplier_price: 8, company_price: 20, currency: 'VND', remark: 'RMK-M2', color: 'BLUE', lt: '25~30', moq: 9 },
      ],
    })
    ids.bom = bom.id
    const bomDetail = await req('GET', `/api/bom/${ids.bom}`, token)
    if (Number(bomDetail.company_price) !== 30) throw new Error(`expected BOM company total=30, got ${bomDetail.company_price}`)
    if (Number(bomDetail.supplier_price) !== 15) throw new Error(`expected BOM supplier total=15, got ${bomDetail.supplier_price}`)
    ok('api', 'bom.aggregated.price', { company_price: bomDetail.company_price, supplier_price: bomDetail.supplier_price })

    const co = await req('POST', '/api/customer-orders', token, {
      po_number: `${tag}-CO`,
      customer_id: customer.id,
      customer_name: `${tag}-CUS`,
      currency: 'VND',
      items: [{ bom_id: ids.bom, qty: 2, unit_price: 30 }],
    })
    ids.co = co.id
    ok('api', 'customer-orders.create', { id: ids.co })

    // UI validations
    browser = await chromium.launch({ headless: true })
    page = await browser.newPage({ viewport: { width: 1600, height: 1100 } })
    await loginUi(page)
    ok('ui', 'login')

    // Point 3: materials table has horizontal scroll container and sticky left columns rendered
    await page.goto(`${WEB}/dashboard/materials`, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('.table-scroll-x', { timeout: 10000 })
    const hasSticky = await page.locator('th.sticky.left-0').count()
    if (hasSticky < 1) throw new Error('materials sticky header/column not found')
    ok('ui', 'materials.scroll.sticky')

    // BOM create modal: header material autofill + item autofill remark + aggregated header price
    await page.goto(`${WEB}/dashboard/bom`, { waitUntil: 'domcontentloaded' })
    await page.getByRole('button', { name: '+ 建立 BOM' }).click()

    await page.locator("label:has-text('物料編號')").locator('xpath=following::input[1]').fill(`${tag}-SKU-UI`)
    await page.locator("label:has-text('產品名稱')").locator('xpath=following::input[1]').fill(`${tag}-BOM-UI`)

    let specVal = ''
    try {
      await pickSearchable(page, '-- 選擇主料（自動帶入資料）--', `${tag}-M1`, `${tag}-M1`)
      const specInput = page.locator("label:has-text('規格') + input").first()
      specVal = await waitForInputValueContains(specInput, 'Spec-A', 5000)
      if (!specVal.includes('Spec-A')) throw new Error(`header autofill spec failed: ${specVal}`)
      ok('ui', 'bom.header-material-autofill', { spec: specVal })
    } catch (e) {
      fail('ui', 'bom.header-material-autofill', e)
    }

    let row0Remark = ''
    let companyVal = ''
    try {
      await page.getByRole('button', { name: '+ 新增列' }).click()
      const row0MatCode = page.locator('tbody tr').first().locator('td').nth(0).locator('input')
      await row0MatCode.fill(`${tag}-M2`)
      await row0MatCode.press('Tab')
      await page.waitForTimeout(300)
      row0Remark = await page.locator('tbody tr').first().locator('td').nth(11).locator('input').inputValue()
      if (!row0Remark.includes('RMK-M2')) throw new Error(`item autofill remark failed: ${row0Remark}`)

      const companyInput = page.locator("label:has-text('公司售價')").locator('xpath=following::input[1]')
      await page.waitForTimeout(300)
      companyVal = await companyInput.inputValue()
      if (!['20', '20.00'].some(v => companyVal.startsWith(v))) throw new Error(`aggregated price not updated after row autofill: ${companyVal}`)
      ok('ui', 'bom.item-autofill-and-aggregate', { company_val: companyVal, remark: row0Remark })
    } catch (e) {
      fail('ui', 'bom.item-autofill-and-aggregate', e, { company_val: companyVal, remark: row0Remark })
    }

    // Customer order page: selected BOM price should be aggregated (30)
    try {
      await page.goto(`${WEB}/dashboard/customer-orders`, { waitUntil: 'domcontentloaded' })
      await page.getByRole('button', { name: '+ 新增訂單' }).click()
      await page.locator("label:has-text('Order No')").locator('xpath=following::input[1]').fill(`${tag}-CO-UI`)

      // customer select
      const customerSelect = page.locator("label:has-text('客戶')").locator('xpath=following::select[1]')
      await customerSelect.selectOption(String(ids.customer))

      // select BOM in first row
      await pickSearchable(page, '-- 選擇成品 BOM --', `${tag}-SKU`, `${tag}-SKU`)
      const unitPriceInput = page.locator('table tbody tr').first().locator('td').nth(6).locator('input[type="number"]')
      const up = await unitPriceInput.inputValue()
      if (!['30', '30.00'].some(v => up.startsWith(v))) throw new Error(`customer-order unit price not aggregated BOM price: ${up}`)
      ok('ui', 'customer-order.uses-aggregated-price', { unit_price: up })
    } catch (e) {
      fail('ui', 'customer-order.uses-aggregated-price', e)
    }

  } catch (e) {
    fail('ui', 'e2e-run', e)
  } finally {
    // cleanup API entities in reverse
    try {
      if (ids.co) { await req('DELETE', `/api/customer-orders/${ids.co}`, token); ok('cleanup', 'customer-order.delete') }
    } catch (e) { fail('cleanup', 'customer-order.delete', e) }
    try {
      if (ids.bom) { await req('DELETE', `/api/bom/${ids.bom}`, token); ok('cleanup', 'bom.delete') }
    } catch (e) { fail('cleanup', 'bom.delete', e) }
    try {
      if (ids.m1) { await req('DELETE', `/api/materials/${ids.m1}`, token); ok('cleanup', 'material1.delete') }
    } catch (e) { fail('cleanup', 'material1.delete', e) }
    try {
      if (ids.m2) { await req('DELETE', `/api/materials/${ids.m2}`, token); ok('cleanup', 'material2.delete') }
    } catch (e) { fail('cleanup', 'material2.delete', e) }
    try {
      if (ids.customer) { await req('DELETE', `/api/customers/${ids.customer}`, token); ok('cleanup', 'customer.delete') }
    } catch (e) { fail('cleanup', 'customer.delete', e) }
    try {
      if (ids.supplier) { await req('DELETE', `/api/suppliers/${ids.supplier}`, token); ok('cleanup', 'supplier.delete') }
    } catch (e) { fail('cleanup', 'supplier.delete', e) }

    if (page) await page.close().catch(() => {})
    if (browser) await browser.close().catch(() => {})

    const summary = {
      tag,
      pass_api: report.api.filter(x => x.ok).length,
      fail_api: report.api.filter(x => !x.ok).length,
      pass_ui: report.ui.filter(x => x.ok).length,
      fail_ui: report.ui.filter(x => !x.ok).length,
      pass_cleanup: report.cleanup.filter(x => x.ok).length,
      fail_cleanup: report.cleanup.filter(x => !x.ok).length,
      report,
    }
    fs.writeFileSync(OUT, JSON.stringify(summary, null, 2))
    console.log(JSON.stringify(summary, null, 2))
    process.exit(summary.fail_api || summary.fail_ui ? 1 : 0)
  }
})()
