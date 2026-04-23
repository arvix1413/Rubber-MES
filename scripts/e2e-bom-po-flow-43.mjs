import { chromium } from 'playwright'
import fs from 'fs'

const WEB = process.env.PW43_WEB || 'http://43.160.199.226:10101'
const API = process.env.PW43_API || 'http://43.160.199.226:10102'
const ADMIN_EMAIL = process.env.PW43_ADMIN_EMAIL || 'admin@rubber.local'
const ADMIN_PASSWORD = process.env.PW43_ADMIN_PASSWORD || 'admin123'
const OUT = process.env.PW43_OUT_FILE || `/tmp/e2e-bom-po-flow-${Date.now()}.json`
const DEPLOY_WAIT_MS = Number(process.env.PW43_DEPLOY_WAIT_MS || 150000)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const tag = `PF${Date.now().toString().slice(-8)}`
const report = { tag, api: [], ui: [], cleanup: [] }

function ok(scope, step, extra = {}) { report[scope].push({ step, ok: true, ...extra }) }
function fail(scope, step, error, extra = {}) { report[scope].push({ step, ok: false, error: String(error?.message || error), ...extra }) }

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

    const customer = await req('POST', '/api/customers', token, { customer_code: `${tag}-CUS`, customer_name: `${tag}-CUS`, status: 'active' })
    ids.customer = customer.id
    ok('api', 'customers.create', { id: customer.id })

    const m1 = await req('POST', '/api/materials', token, {
      material_code: `${tag}-M1`, material_name: `${tag}-M1-NAME`, spec: 'Spec-1', unit: 'PCS',
      supplier_id: s1.id, supplier_price: 10.125, company_price: 12.5, currency: 'VND', leadtime: '5-8', remark: 'RMK-1',
    })
    const m2 = await req('POST', '/api/materials', token, {
      material_code: `${tag}-M2`, material_name: `${tag}-M2-NAME`, spec: 'Spec-2', unit: 'PCS',
      supplier_id: s2.id, supplier_price: 20.8, company_price: 25.0, currency: 'VND', leadtime: '8-12', remark: 'RMK-2',
    })
    ids.m1 = m1.id; ids.m2 = m2.id
    ok('api', 'materials.create.two')

    const bom = await req('POST', '/api/bom', token, {
      product_sku: `${tag}-SKU`,
      product_name: `${tag}-BOM`,
      material_name: `${tag}-M1-NAME`,
      unit: 'PCS',
      supplier_id: s1.id,
      supplier_name: `${tag}-SUP1`,
      supplier_price: 0,
      company_price: 0,
      currency: 'VND',
      items: [
        { material_id: m1.id, material_code: `${tag}-M1`, material_name: `${tag}-M1-NAME`, spec: 'Spec-1', unit: 'PCS', quantity: 1, supplier_name: `${tag}-SUP1`, supplier_price: 10.125, company_price: 12.5, currency: 'VND', remark: 'RMK-1', lt: '5-8', moq: 5 },
        { material_id: m2.id, material_code: `${tag}-M2`, material_name: `${tag}-M2-NAME`, spec: 'Spec-2', unit: 'PCS', quantity: 2, supplier_name: `${tag}-SUP2`, supplier_price: 20.8, company_price: 25.0, currency: 'VND', remark: 'RMK-2', lt: '8-12', moq: 9 },
      ],
    })
    ids.bom = bom.id
    ok('api', 'bom.create', { id: bom.id })

    const coNo = `${tag}-CO`
    const co = await req('POST', '/api/customer-orders', token, {
      po_number: coNo,
      customer_id: customer.id,
      customer_name: `${tag}-CUS`,
      currency: 'VND',
      items: [{ bom_id: ids.bom, qty: 3, unit_price: 62.5, po_no: `${tag}-LINE-1` }],
    })
    ids.co = co.id
    ids.coNo = coNo
    ok('api', 'customer-orders.create', { id: co.id })

    const imported = await req('GET', `/api/po/materials-from-order-po/${encodeURIComponent(coNo)}`, token)
    if (!Array.isArray(imported.items) || imported.items.length < 2) throw new Error('import endpoint did not return BOM material rows')
    if (!imported.items.some((x) => String(x.po_ref || '').includes(`${tag}-LINE-1`))) throw new Error('po_ref from customer order item missing')
    ok('api', 'po.import.endpoint', { rows: imported.items.length, suppliers: imported.suppliers?.length || 0 })

    browser = await chromium.launch({ headless: true })
    page = await browser.newPage({ viewport: { width: 1680, height: 1100 } })
    await loginUi(page)
    ok('ui', 'login')

    // BOM level-2 details
    await page.goto(`${WEB}/dashboard/bom`, { waitUntil: 'domcontentloaded' })
    await page.locator('input[placeholder="搜尋物料編號、產品名稱..."]').fill(`${tag}-SKU`)
    const bomRow = page.locator('tr', { hasText: `${tag}-SKU` }).first()
    await bomRow.waitFor({ state: 'visible', timeout: 10000 })
    await bomRow.click()
    await page.locator('div.expand-row-wrap.layer-panel-l2').first().waitFor({ state: 'visible', timeout: 10000 })
    const bomDetailText = await page.locator('div.expand-row-wrap.layer-panel-l2').first().innerText()
    if (!bomDetailText.includes(`${tag}-M1`) || !bomDetailText.includes(`${tag}-M2`)) throw new Error('BOM expanded detail missing material rows')
    ok('ui', 'bom.expand.material-rows')

    // Customer order level-3 details
    await page.goto(`${WEB}/dashboard/customer-orders`, { waitUntil: 'domcontentloaded' })
    await page.locator('input.list-search').fill(coNo)
    const coRow = page.locator('tr', { hasText: coNo }).first()
    await coRow.waitFor({ state: 'visible', timeout: 10000 })
    await coRow.click()
    const itemExpandBtn = page.locator('button[title="展開 BOM 輔料明細"]').first()
    await itemExpandBtn.waitFor({ state: 'visible', timeout: 10000 })
    await itemExpandBtn.click()
    const lv3 = page.locator('div.layer-panel-l3').first()
    await lv3.waitFor({ state: 'visible', timeout: 10000 })
    const waitStart = Date.now()
    let lv3Text = await lv3.innerText()
    while (Date.now() - waitStart < 10000 && (!lv3Text.includes(`${tag}-M1`) || !lv3Text.includes(`${tag}-M2`))) {
      await page.waitForTimeout(250)
      lv3Text = await lv3.innerText()
    }
    if (!lv3Text.includes(`${tag}-M1`) || !lv3Text.includes(`${tag}-M2`)) throw new Error('Customer order level-3 detail missing BOM materials')
    ok('ui', 'customer-orders.level3.expand')

    // PO import + keep supplier + remove unchecked + save
    await page.goto(`${WEB}/dashboard/po`, { waitUntil: 'domcontentloaded' })
    await page.getByRole('button', { name: '+ 建立採購單' }).click()
    await page.locator("label:has-text('客戶訂單號（PO NO）')").locator('xpath=following::input[1]').fill(coNo)
    await page.getByRole('button', { name: '帶入客戶訂單輔料' }).click()
    await page.locator(`text=帶入明細：`).first().waitFor({ state: 'visible', timeout: 10000 })

    // choose supplier-1 and keep only it
    const supplierSelect = page.locator("label:has-text('供應商 *')").locator('xpath=following::select[1]')
    await supplierSelect.selectOption(String(s1.id))
    await page.getByRole('button', { name: '只保留當前供應商' }).click()
    await page.getByRole('button', { name: '刪除未勾選' }).click()
    const dataRows = page.locator('table tbody tr')
    const rowCount = await dataRows.count()
    if (rowCount !== 1) throw new Error(`expected 1 row after supplier filter, got ${rowCount}`)

    await page.getByRole('button', { name: '建立採購單' }).click()
    await page.locator('input.list-search').waitFor({ state: 'visible', timeout: 15000 })
    ok('ui', 'po.import.filter.save')

    const poList = await req('GET', '/api/po', token)
    const createdPo = (poList || []).find((x) => x.supplier_id === s1.id && String(x.remark || '').includes(''))
    if (!createdPo) throw new Error('PO save verification failed')
    ids.po = createdPo.id
    ok('api', 'po.created.after-ui', { id: createdPo.id })
  } catch (e) {
    fail('ui', 'e2e-run', e)
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
