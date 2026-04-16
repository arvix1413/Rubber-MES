import { chromium } from 'playwright'
import fs from 'fs'

const WEB = process.env.PW43_WEB || 'http://43.133.56.234'
const API = process.env.PW43_API || 'http://43.133.56.234'
const outFile = '/tmp/pw43-soft-delete-ids.json'

const assert = (cond, msg) => {
  if (!cond) throw new Error(msg)
}

async function apiPost(token, url, data) {
  const r = await fetch(`${API}${url}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(data),
  })
  if (!r.ok) {
    throw new Error(`${url} -> ${r.status} ${await r.text()}`)
  }
  return r.json()
}

async function clickDeleteAndConfirm(page, marker) {
  const row = page.locator('tr', { hasText: marker }).first()
  await row.waitFor({ state: 'visible', timeout: 20000 })
  const delBtn = row.locator('button:has-text("刪除"), button:has-text("删除")').first()
  await delBtn.click({ force: true })

  const dialogConfirm = page.locator('div.fixed.inset-0.z-\\[9998\\] button.bg-red-500').last()
  if (await dialogConfirm.isVisible({ timeout: 5000 }).catch(() => false)) {
    await dialogConfirm.click()
  } else {
    await page.locator('button:has-text("確認刪除"), button:has-text("確認"), button:has-text("刪除"), button:has-text("删除")').last().click()
  }
  await page.waitForTimeout(1200)
  const delInRow = page.locator('tr', { hasText: marker }).locator('button:has-text("刪除"), button:has-text("删除")').first()
  await delInRow.waitFor({ state: 'detached', timeout: 20000 }).catch(async () => {
    if (await delInRow.isVisible().catch(() => false)) {
      throw new Error(`delete still visible for marker ${marker}`)
    }
  })
}

async function gotoListAndDelete(page, path, marker) {
  await page.goto(`${WEB}${path}`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(500)
  await clickDeleteAndConfirm(page, marker)
}

async function main() {
  const tag = `PW43${Date.now().toString().slice(-8)}`
  const created = []
  const deleteResults = []

  const loginResp = await fetch(`${API}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@oms.com', password: 'admin123' }),
  })
  assert(loginResp.ok, `login failed: ${loginResp.status}`)
  const loginJson = await loginResp.json()
  const token = loginJson.token

  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })

  await page.goto(`${WEB}/login`)
  await page.fill('input[type="email"]', 'admin@oms.com')
  await page.fill('input[type="password"]', 'admin123')
  await page.click('button:has-text("登入")')
  await page.waitForURL('**/dashboard**', { timeout: 20000 })

  const supplierMarker = `${tag}-SUP`
  const supplier = await apiPost(token, '/api/suppliers', { name: supplierMarker, supplier_code: supplierMarker, currency: 'VND', status: 'active' })
  created.push({ key: 'supplier', table: 'suppliers', id: Number(supplier.id), marker: supplierMarker })

  const customerMarker = `${tag}-CUS`
  const customer = await apiPost(token, '/api/customers', { customer_code: customerMarker, customer_name: customerMarker, status: 'active' })
  created.push({ key: 'customer', table: 'customers', id: Number(customer.id), marker: customerMarker })

  const materialMarker = `${tag}-MAT`
  const material = await apiPost(token, '/api/materials', { material_code: materialMarker, material_name: materialMarker, unit: 'PCS', currency: 'VND', supplier_id: Number(supplier.id) })
  created.push({ key: 'material', table: 'materials', id: Number(material.id), marker: materialMarker })

  const bomMarker = `${tag}-SKU`
  const bom = await apiPost(token, '/api/bom', { product_sku: bomMarker, product_name: `${tag}-BOM`, unit: 'PCS', company_price: 100, supplier_price: 90, currency: 'VND', items: [] })
  created.push({ key: 'bom', table: 'bom', id: Number(bom.id), marker: bomMarker })

  const poMarker = `${tag}-PO-SUP`
  const po = await apiPost(token, '/api/po', {
    supplier_id: Number(supplier.id),
    supplier_name: poMarker,
    currency: 'VND',
    tax_rate: 8,
    items: [{ material_code: bomMarker, material_name: `${tag}-BOM`, unit: 'PCS', quantity: 1, unit_price: 100, total_price: 100, currency: 'VND', remark: tag, po_ref: tag }],
  })
  created.push({ key: 'po', table: 'purchase_orders', id: Number(po.id), marker: String(po.po_number || poMarker) })

  const coMarker = `${tag}-CO`
  const co = await apiPost(token, '/api/customer-orders', { po_number: coMarker, customer_id: Number(customer.id), customer_name: customerMarker, currency: 'VND', items: [{ bom_id: Number(bom.id), qty: 1, unit_price: 120 }] })
  created.push({ key: 'customer_order', table: 'customer_orders', id: Number(co.id), marker: coMarker })

  const qtMarker = `${tag}-QT-CUS`
  const quotation = await apiPost(token, '/api/quotations', {
    customer_id: Number(customer.id),
    customer_name: qtMarker,
    currency: 'VND',
    items: [{ item_name: `${tag}-item`, material_code: bomMarker, unit: 'PCS', qty: 1, unit_price: 99, total_price: 99 }],
  })
  created.push({ key: 'quotation', table: 'quotations', id: Number(quotation.id), marker: String(quotation.quotation_number || qtMarker) })

  const dnMarker = `${tag}-DN-CUS`
  const dn = await apiPost(token, '/api/delivery-notes', {
    customer_id: Number(customer.id),
    customer_name: dnMarker,
    customer_order_id: Number(co.id),
    status: 'draft',
    items: [{ item_name: `${tag}-item`, material_code: bomMarker, unit: 'PCS', qty: 1 }],
  })
  created.push({ key: 'delivery_note', table: 'delivery_notes', id: Number(dn.id), marker: String(dn.dn_number || dnMarker) })

  const dsMarker = `${tag}-DS-CUS`
  const ds = await apiPost(token, '/api/delivery-sheets', {
    customer_id: Number(customer.id),
    customer_name: dsMarker,
    customer_order_id: Number(co.id),
    status: 'draft',
    items: [{ item_name: `${tag}-item`, material_code: bomMarker, unit: 'PCS', qty: 1 }],
  })
  created.push({ key: 'delivery_sheet', table: 'delivery_sheets', id: Number(ds.id), marker: String(ds.ds_number || dsMarker) })

  const grMarker = `${tag}-GR-SUP`
  const gr = await apiPost(token, '/api/goods-receipts', {
    supplier_id: Number(supplier.id),
    supplier_name: supplierMarker,
    po_number: grMarker,
    items: [{ material_code: bomMarker, material_name: `${tag}-BOM`, unit: 'PCS', ordered_qty: 1, received_qty: 1, unit_price: 100 }],
  })
  created.push({ key: 'goods_receipt', table: 'goods_receipts', id: Number(gr.id), marker: String(gr.gr_number || grMarker) })

  const prodMarker = `${tag}-PROD`
  const prod = await apiPost(token, '/api/production', { bom_id: Number(bom.id), product_sku: bomMarker, product_name: prodMarker, planned_qty: 1, initial_status: 'draft', materials: [] })
  created.push({ key: 'production', table: 'production_orders', id: Number(prod.id), marker: prodMarker })

  const adjMarker = `${tag}-ADJ`
  const adj = await apiPost(token, '/api/stock-adjustments', { adj_type: 'count', remark: adjMarker, items: [{ material_code: bomMarker, material_name: `${tag}-BOM`, unit: 'PCS', actual_qty: 1 }] })
  created.push({ key: 'stock_adjustment', table: 'stock_adjustments', id: Number(adj.id), marker: String(adj.adj_number || adjMarker) })

  const userEmail = `${tag.toLowerCase()}@oms.com`
  const user = await apiPost(token, '/api/users', { email: userEmail, password: 'admin123', name: `${tag}-USER`, role: 'employee' })
  created.push({ key: 'user', table: 'users', id: Number(user.id), marker: userEmail })

  const safeDelete = async (key, path, marker) => {
    try {
      await gotoListAndDelete(page, path, marker)
      deleteResults.push({ key, path, marker, ok: true })
    } catch (e) {
      deleteResults.push({ key, path, marker, ok: false, error: String(e.message || e) })
    }
  }

  await safeDelete('user', '/dashboard/users', userEmail)
  await safeDelete('stock_adjustment', '/dashboard/stock-adjustments', created.find(x => x.key === 'stock_adjustment').marker)
  await safeDelete('production', '/dashboard/production', prodMarker)
  await safeDelete('goods_receipt', '/dashboard/goods-receipts', created.find(x => x.key === 'goods_receipt').marker)
  await safeDelete('delivery_sheet', '/dashboard/delivery-sheets', created.find(x => x.key === 'delivery_sheet').marker)
  await safeDelete('delivery_note', '/dashboard/delivery-notes', created.find(x => x.key === 'delivery_note').marker)
  await safeDelete('quotation', '/dashboard/quotations', created.find(x => x.key === 'quotation').marker)
  await safeDelete('customer_order', '/dashboard/customer-orders', coMarker)
  await safeDelete('po', '/dashboard/po', created.find(x => x.key === 'po').marker)
  await safeDelete('bom', '/dashboard/bom', bomMarker)
  await safeDelete('material', '/dashboard/materials', materialMarker)
  await safeDelete('customer', '/dashboard/customers', customerMarker)
  await safeDelete('supplier', '/dashboard/suppliers', supplierMarker)

  fs.writeFileSync(outFile, JSON.stringify({ tag, created, deleteResults }, null, 2), 'utf8')
  await browser.close()
  console.log(`OK ${outFile}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
