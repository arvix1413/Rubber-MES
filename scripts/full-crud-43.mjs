import { chromium } from 'playwright'
import fs from 'fs'

const WEB = process.env.PW43_WEB || 'http://43.133.56.234'
const API = process.env.PW43_API || 'http://43.133.56.234'
const OUT = '/tmp/full-crud-43-report.json'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function api(method, token, path, data) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: data ? JSON.stringify(data) : undefined,
  })
  const txt = await res.text()
  let body = null
  try { body = txt ? JSON.parse(txt) : null } catch { body = { raw: txt } }
  return { ok: res.ok, status: res.status, body }
}

async function uiLogin(page) {
  await page.goto(`${WEB}/login`, { waitUntil: 'domcontentloaded' })
  await page.fill('input[type="email"]', 'admin@oms.com')
  await page.fill('input[type="password"]', 'admin123')
  await page.click('button:has-text("登入")')
  await page.waitForURL('**/dashboard**', { timeout: 20000 })
}

async function uiSelectRow(page, path, marker) {
  await page.goto(`${WEB}${path}`, { waitUntil: 'domcontentloaded' })
  await sleep(800)
  const row = page.locator('tr', { hasText: marker }).first()
  await row.waitFor({ state: 'visible', timeout: 20000 })
  // try select/expand
  await row.click({ force: true }).catch(() => {})
  await sleep(400)
}

async function uiDeleteRow(page, path, marker) {
  await page.goto(`${WEB}${path}`, { waitUntil: 'domcontentloaded' })
  await sleep(800)
  const row = page.locator('tr', { hasText: marker }).first()
  await row.waitFor({ state: 'visible', timeout: 20000 })
  const del = row.locator('button:has-text("刪除"), button:has-text("删除")').first()
  await del.click({ force: true })
  const confirmBtn = page.locator('div.fixed.inset-0.z-\\[9998\\] button.bg-red-500').last()
  if (await confirmBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
    await confirmBtn.click()
  } else {
    await page.locator('button:has-text("確認"), button:has-text("刪除"), button:has-text("删除")').last().click()
  }
  await sleep(1200)
}

async function main() {
  const tag = `ALL43${Date.now().toString().slice(-8)}`
  const report = { tag, created: [], updated: [], selected: [], deleted: [], notes: [] }

  const login = await fetch(`${API}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@oms.com', password: 'admin123' }),
  })
  if (!login.ok) throw new Error(`login failed: ${login.status}`)
  const token = (await login.json()).token

  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  await uiLogin(page)

  const push = (arr, x) => arr.push(x)

  // 1) suppliers
  const supplierName = `${tag}-SUP`
  const supplierCode = `${tag}-SUP`
  const cSup = await api('POST', token, '/api/suppliers', { name: supplierName, supplier_code: supplierCode, currency: 'VND', status: 'active' })
  if (!cSup.ok) throw new Error(`create supplier fail: ${JSON.stringify(cSup.body)}`)
  const supplierId = Number(cSup.body.id)
  push(report.created, { key: 'suppliers', id: supplierId, marker: supplierCode })
  const uSup = await api('PUT', token, `/api/suppliers/${supplierId}`, { name: `${supplierName}-UPD`, currency: 'VND', status: 'active' })
  push(report.updated, { key: 'suppliers', id: supplierId, ok: uSup.ok, status: uSup.status })
  await uiSelectRow(page, '/dashboard/suppliers', supplierCode); push(report.selected, { key: 'suppliers', marker: supplierCode, ok: true })

  // 2) customers
  const customerCode = `${tag}-CUS`
  const cCus = await api('POST', token, '/api/customers', { customer_code: customerCode, customer_name: `${tag}-CUS`, status: 'active' })
  if (!cCus.ok) throw new Error(`create customer fail: ${JSON.stringify(cCus.body)}`)
  const customerId = Number(cCus.body.id)
  push(report.created, { key: 'customers', id: customerId, marker: customerCode })
  const uCus = await api('PUT', token, `/api/customers/${customerId}`, { customer_name: `${tag}-CUS-UPD`, status: 'active' })
  push(report.updated, { key: 'customers', id: customerId, ok: uCus.ok, status: uCus.status })
  await uiSelectRow(page, '/dashboard/customers', customerCode); push(report.selected, { key: 'customers', marker: customerCode, ok: true })

  // 3) materials
  const materialCode = `${tag}-MAT`
  const cMat = await api('POST', token, '/api/materials', {
    material_code: materialCode, material_name: `${tag}-MAT`, unit: 'PCS', currency: 'VND', supplier_id: supplierId,
  })
  if (!cMat.ok) throw new Error(`create material fail: ${JSON.stringify(cMat.body)}`)
  const materialId = Number(cMat.body.id)
  push(report.created, { key: 'materials', id: materialId, marker: materialCode })
  const uMat = await api('PUT', token, `/api/materials/${materialId}`, { material_name: `${tag}-MAT-UPD`, unit: 'PCS', currency: 'VND', supplier_id: supplierId })
  push(report.updated, { key: 'materials', id: materialId, ok: uMat.ok, status: uMat.status })
  await uiSelectRow(page, '/dashboard/materials', materialCode); push(report.selected, { key: 'materials', marker: materialCode, ok: true })

  // 4) bom
  const bomSku = `${tag}-SKU`
  const cBom = await api('POST', token, '/api/bom', { product_sku: bomSku, product_name: `${tag}-BOM`, unit: 'PCS', supplier_id: supplierId, supplier_price: 80, company_price: 100, currency: 'VND', items: [] })
  if (!cBom.ok) throw new Error(`create bom fail: ${JSON.stringify(cBom.body)}`)
  const bomId = Number(cBom.body.id)
  push(report.created, { key: 'bom', id: bomId, marker: bomSku })
  const uBom = await api('PUT', token, `/api/bom/${bomId}`, { product_name: `${tag}-BOM-UPD`, unit: 'PCS', supplier_id: supplierId, supplier_price: 81, company_price: 101, currency: 'VND', items: [] })
  push(report.updated, { key: 'bom', id: bomId, ok: uBom.ok, status: uBom.status })
  await uiSelectRow(page, '/dashboard/bom', bomSku); push(report.selected, { key: 'bom', marker: bomSku, ok: true })

  // 5) po
  const poSupplierNameMarker = `${tag}-PO-SUP`
  const cPo = await api('POST', token, '/api/po', {
    supplier_id: supplierId, supplier_name: poSupplierNameMarker, currency: 'VND', tax_rate: 8,
    items: [{ material_code: bomSku, material_name: `${tag}-BOM`, unit: 'PCS', quantity: 2, unit_price: 100, total_price: 200, currency: 'VND', remark: tag, po_ref: tag }],
  })
  if (!cPo.ok) throw new Error(`create po fail: ${JSON.stringify(cPo.body)}`)
  const poId = Number(cPo.body.id)
  const poNo = String(cPo.body.po_number)
  push(report.created, { key: 'purchase_orders', id: poId, marker: poNo })
  const uPo = await api('PUT', token, `/api/po/${poId}`, {
    supplier_id: supplierId, supplier_name: poSupplierNameMarker, currency: 'VND', tax_rate: 8,
    items: [{ material_code: bomSku, material_name: `${tag}-BOM`, unit: 'PCS', quantity: 3, unit_price: 100, total_price: 300, currency: 'VND', remark: `${tag}-U`, po_ref: tag }],
  })
  push(report.updated, { key: 'purchase_orders', id: poId, ok: uPo.ok, status: uPo.status })
  await uiSelectRow(page, '/dashboard/po', poNo); push(report.selected, { key: 'purchase_orders', marker: poNo, ok: true })

  // 6) customer orders
  const coNo = `${tag}-CO`
  const cCo = await api('POST', token, '/api/customer-orders', { po_number: coNo, customer_id: customerId, customer_name: customerCode, currency: 'VND', items: [{ bom_id: bomId, qty: 2, unit_price: 120 }] })
  if (!cCo.ok) throw new Error(`create co fail: ${JSON.stringify(cCo.body)}`)
  const coId = Number(cCo.body.id)
  push(report.created, { key: 'customer_orders', id: coId, marker: coNo })
  const uCo = await api('PUT', token, `/api/customer-orders/${coId}`, { po_number: coNo, customer_id: customerId, customer_name: customerCode, currency: 'VND', items: [{ bom_id: bomId, qty: 4, unit_price: 130 }] })
  push(report.updated, { key: 'customer_orders', id: coId, ok: uCo.ok, status: uCo.status })
  await uiSelectRow(page, '/dashboard/customer-orders', coNo); push(report.selected, { key: 'customer_orders', marker: coNo, ok: true })

  // 7) quotations
  const cQt = await api('POST', token, '/api/quotations', {
    customer_id: customerId, customer_name: `${tag}-QT-CUS`, currency: 'VND',
    items: [{ item_name: `${tag}-itm`, material_code: bomSku, unit: 'PCS', qty: 2, unit_price: 99, total_price: 198 }],
  })
  if (!cQt.ok) throw new Error(`create qt fail: ${JSON.stringify(cQt.body)}`)
  const qtId = Number(cQt.body.id)
  const qtNo = String(cQt.body.quotation_number)
  push(report.created, { key: 'quotations', id: qtId, marker: qtNo })
  const uQt = await api('PUT', token, `/api/quotations/${qtId}`, {
    customer_id: customerId, customer_name: `${tag}-QT-CUS-U`, currency: 'VND',
    items: [{ item_name: `${tag}-itm-u`, material_code: bomSku, unit: 'PCS', qty: 3, unit_price: 100, total_price: 300 }],
  })
  push(report.updated, { key: 'quotations', id: qtId, ok: uQt.ok, status: uQt.status })
  await uiSelectRow(page, '/dashboard/quotations', qtNo); push(report.selected, { key: 'quotations', marker: qtNo, ok: true })

  // 8) delivery note
  const cDn = await api('POST', token, '/api/delivery-notes', {
    customer_id: customerId, customer_name: `${tag}-DN-CUS`, customer_order_id: coId, delivery_date: null, remark: tag,
    items: [{ item_name: `${tag}-itm`, material_code: bomSku, unit: 'PCS', qty: 1 }],
  })
  if (!cDn.ok) throw new Error(`create dn fail: ${JSON.stringify(cDn.body)}`)
  const dnId = Number(cDn.body.id)
  const dnNo = String(cDn.body.dn_number)
  push(report.created, { key: 'delivery_notes', id: dnId, marker: dnNo })
  const uDn = await api('PUT', token, `/api/delivery-notes/${dnId}`, {
    delivery_date: null, remark: `${tag}-U`,
    items: [{ item_name: `${tag}-itm-u`, material_code: bomSku, unit: 'PCS', qty: 2 }],
  })
  push(report.updated, { key: 'delivery_notes', id: dnId, ok: uDn.ok, status: uDn.status })
  await uiSelectRow(page, '/dashboard/delivery-notes', dnNo); push(report.selected, { key: 'delivery_notes', marker: dnNo, ok: true })

  // 9) delivery sheet
  const cDs = await api('POST', token, '/api/delivery-sheets', {
    customer_id: customerId, customer_name: `${tag}-DS-CUS`, customer_order_id: coId, delivery_date: null, remark: tag,
    items: [{ item_name: `${tag}-itm`, material_code: bomSku, unit: 'PCS', qty: 1 }],
  })
  if (!cDs.ok) throw new Error(`create ds fail: ${JSON.stringify(cDs.body)}`)
  const dsId = Number(cDs.body.id)
  const dsNo = String(cDs.body.ds_number)
  push(report.created, { key: 'delivery_sheets', id: dsId, marker: dsNo })
  const uDs = await api('PUT', token, `/api/delivery-sheets/${dsId}`, {
    delivery_date: null, remark: `${tag}-U`,
    items: [{ item_name: `${tag}-itm-u`, material_code: bomSku, unit: 'PCS', qty: 2 }],
  })
  push(report.updated, { key: 'delivery_sheets', id: dsId, ok: uDs.ok, status: uDs.status })
  await uiSelectRow(page, '/dashboard/delivery-sheets', dsNo); push(report.selected, { key: 'delivery_sheets', marker: dsNo, ok: true })

  // 10) goods receipt
  const cGr = await api('POST', token, '/api/goods-receipts', {
    supplier_id: supplierId, supplier_name: supplierCode, po_number: `${tag}-GR`,
    items: [{ material_code: bomSku, material_name: `${tag}-BOM`, unit: 'PCS', ordered_qty: 1, received_qty: 1, unit_price: 100 }],
  })
  if (!cGr.ok) throw new Error(`create gr fail: ${JSON.stringify(cGr.body)}`)
  const grId = Number(cGr.body.id)
  const grNo = String(cGr.body.gr_number)
  push(report.created, { key: 'goods_receipts', id: grId, marker: grNo })
  await uiSelectRow(page, '/dashboard/goods-receipts', grNo); push(report.selected, { key: 'goods_receipts', marker: grNo, ok: true })

  // 11) production
  const prodName = `${tag}-PROD`
  const cProd = await api('POST', token, '/api/production', { bom_id: bomId, product_sku: bomSku, product_name: prodName, planned_qty: 1, initial_status: 'draft', materials: [] })
  if (!cProd.ok) throw new Error(`create prod fail: ${JSON.stringify(cProd.body)}`)
  const prodId = Number(cProd.body.id)
  push(report.created, { key: 'production_orders', id: prodId, marker: prodName })
  const uProd = await api('PUT', token, `/api/production/${prodId}`, { bom_id: bomId, product_sku: bomSku, product_name: `${prodName}-U`, planned_qty: 2, materials: [] })
  push(report.updated, { key: 'production_orders', id: prodId, ok: uProd.ok, status: uProd.status })
  await uiSelectRow(page, '/dashboard/production', prodName); push(report.selected, { key: 'production_orders', marker: prodName, ok: true })

  // 12) stock adjustment
  const cAdj = await api('POST', token, '/api/stock-adjustments', { adj_type: 'count', remark: `${tag}-ADJ`, items: [{ material_code: bomSku, material_name: `${tag}-BOM`, unit: 'PCS', actual_qty: 1 }] })
  if (!cAdj.ok) throw new Error(`create adj fail: ${JSON.stringify(cAdj.body)}`)
  const adjId = Number(cAdj.body.id)
  const adjNo = String(cAdj.body.adj_number)
  push(report.created, { key: 'stock_adjustments', id: adjId, marker: adjNo })
  await uiSelectRow(page, '/dashboard/stock-adjustments', adjNo); push(report.selected, { key: 'stock_adjustments', marker: adjNo, ok: true })

  // 13) user
  const userEmail = `${tag.toLowerCase()}@oms.com`
  const cUser = await api('POST', token, '/api/users', { email: userEmail, password: 'admin123', name: `${tag}-USER`, role: 'employee' })
  if (!cUser.ok) throw new Error(`create user fail: ${JSON.stringify(cUser.body)}`)
  const userId = Number(cUser.body.id)
  push(report.created, { key: 'users', id: userId, marker: userEmail })
  const uUser = await api('PUT', token, `/api/users/${userId}`, { name: `${tag}-USER-U`, role: 'employee' })
  push(report.updated, { key: 'users', id: userId, ok: uUser.ok, status: uUser.status })
  await uiSelectRow(page, '/dashboard/users', userEmail); push(report.selected, { key: 'users', marker: userEmail, ok: true })

  // Non-CRUD list select checks (selection only)
  for (const p of ['/dashboard/inventory', '/dashboard/stock-ledger', '/dashboard/receivables', '/dashboard/payables', '/dashboard/reports', '/dashboard/audit-logs']) {
    await page.goto(`${WEB}${p}`, { waitUntil: 'domcontentloaded' })
    await sleep(800)
    push(report.selected, { key: p, marker: 'page-open', ok: true })
  }

  // delete in dependency-safe order
  const delPlan = [
    ['users', '/dashboard/users', userEmail],
    ['stock_adjustments', '/dashboard/stock-adjustments', adjNo],
    ['production_orders', '/dashboard/production', prodName],
    ['goods_receipts', '/dashboard/goods-receipts', grNo],
    ['delivery_sheets', '/dashboard/delivery-sheets', dsNo],
    ['delivery_notes', '/dashboard/delivery-notes', dnNo],
    ['quotations', '/dashboard/quotations', qtNo],
    ['customer_orders', '/dashboard/customer-orders', coNo],
    ['purchase_orders', '/dashboard/po', poNo],
    ['bom', '/dashboard/bom', bomSku],
    ['materials', '/dashboard/materials', materialCode],
    ['customers', '/dashboard/customers', customerCode],
    ['suppliers', '/dashboard/suppliers', supplierCode],
  ]
  for (const [key, path, marker] of delPlan) {
    try {
      await uiDeleteRow(page, path, marker)
      push(report.deleted, { key, marker, ok: true })
    } catch (e) {
      push(report.deleted, { key, marker, ok: false, error: String(e.message || e) })
    }
  }

  await browser.close()
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2), 'utf8')
  console.log(`REPORT ${OUT}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

