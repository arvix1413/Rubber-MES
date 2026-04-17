import { chromium } from 'playwright'
import { promises as fs } from 'fs'

const WEB = process.env.PW43_WEB || 'http://43.133.56.234:10101'
const API = process.env.PW43_API || 'http://43.133.56.234:10102'
const ADMIN_EMAIL = process.env.PW43_ADMIN_EMAIL || 'admin@rubber.local'
const ADMIN_PASSWORD = process.env.PW43_ADMIN_PASSWORD || 'admin123'
const HEADLESS = process.env.PW43_HEADLESS !== 'false'
const OUT_FILE = process.env.PW43_OUT_FILE || '/tmp/pw43-soft-delete-ids.json'
const RETRY = Number(process.env.PW43_API_RETRY || 2)
const TIMEOUT_MS = Number(process.env.PW43_API_TIMEOUT_MS || 15000)
const NAV_TIMEOUT_MS = Number(process.env.PW43_NAV_TIMEOUT_MS || 25000)
const SHOT_DIR = process.env.PW43_SHOT_DIR || '/tmp'

const CREATE_JOBS = [
  {
    key: 'supplier',
    table: 'suppliers',
    endpoint: '/api/suppliers',
    marker: (ctx) => ctx.supplierMarker,
    payload: (ctx) => ({ name: ctx.supplierMarker, supplier_code: ctx.supplierMarker, currency: 'VND', status: 'active' }),
    id: (r) => Number(r.id),
    rowMarker: (ctx) => ctx.supplierMarker,
    deletePath: '/dashboard/suppliers',
  },
  {
    key: 'customer',
    table: 'customers',
    endpoint: '/api/customers',
    marker: (ctx) => ctx.customerMarker,
    payload: (ctx) => ({ customer_code: ctx.customerMarker, customer_name: ctx.customerMarker, status: 'active' }),
    id: (r) => Number(r.id),
    rowMarker: (ctx) => ctx.customerMarker,
    deletePath: '/dashboard/customers',
  },
  {
    key: 'material',
    table: 'materials',
    endpoint: '/api/materials',
    marker: (ctx) => ctx.materialMarker,
    payload: (ctx) => ({
      material_code: ctx.materialMarker,
      material_name: ctx.materialMarker,
      unit: 'PCS',
      currency: 'VND',
      supplier_id: ctx.ids.supplier,
    }),
    id: (r) => Number(r.id),
    rowMarker: (ctx) => ctx.materialMarker,
    deletePath: '/dashboard/materials',
  },
  {
    key: 'bom',
    table: 'bom',
    endpoint: '/api/bom',
    marker: (ctx) => ctx.bomMarker,
    payload: (ctx) => ({
      product_sku: ctx.bomMarker,
      product_name: `${ctx.tag}-BOM`,
      unit: 'PCS',
      company_price: 100,
      supplier_price: 90,
      currency: 'VND',
      items: [],
    }),
    id: (r) => Number(r.id),
    rowMarker: (ctx) => ctx.bomMarker,
    deletePath: '/dashboard/bom',
  },
  {
    key: 'po',
    table: 'purchase_orders',
    endpoint: '/api/po',
    marker: (ctx) => ctx.poMarker,
    payload: (ctx) => ({
      supplier_id: ctx.ids.supplier,
      supplier_name: ctx.poMarker,
      currency: 'VND',
      tax_rate: 8,
      items: [{
        material_code: ctx.bomMarker,
        material_name: `${ctx.tag}-BOM`,
        unit: 'PCS',
        quantity: 1,
        unit_price: 100,
        total_price: 100,
        currency: 'VND',
        remark: ctx.tag,
        po_ref: ctx.tag,
      }],
    }),
    id: (r) => Number(r.id),
    rowMarker: (ctx, r) => String(r.po_number || ctx.poMarker),
    deletePath: '/dashboard/po',
  },
  {
    key: 'customer_order',
    table: 'customer_orders',
    endpoint: '/api/customer-orders',
    marker: (ctx) => ctx.coMarker,
    payload: (ctx) => ({
      po_number: ctx.coMarker,
      customer_id: ctx.ids.customer,
      customer_name: ctx.customerMarker,
      currency: 'VND',
      items: [{ bom_id: ctx.ids.bom, qty: 1, unit_price: 120 }],
    }),
    id: (r) => Number(r.id),
    rowMarker: (ctx) => ctx.coMarker,
    deletePath: '/dashboard/customer-orders',
  },
  {
    key: 'quotation',
    table: 'quotations',
    endpoint: '/api/quotations',
    marker: (ctx) => ctx.qtMarker,
    payload: (ctx) => ({
      customer_id: ctx.ids.customer,
      customer_name: ctx.qtMarker,
      currency: 'VND',
      items: [{ item_name: `${ctx.tag}-item`, material_code: ctx.bomMarker, unit: 'PCS', qty: 1, unit_price: 99, total_price: 99 }],
    }),
    id: (r) => Number(r.id),
    rowMarker: (ctx, r) => String(r.quotation_number || ctx.qtMarker),
    deletePath: '/dashboard/quotations',
  },
  {
    key: 'delivery_note',
    table: 'delivery_notes',
    endpoint: '/api/delivery-notes',
    marker: (ctx) => ctx.dnMarker,
    payload: (ctx) => ({
      customer_id: ctx.ids.customer,
      customer_name: ctx.dnMarker,
      customer_order_id: ctx.ids.customer_order,
      status: 'draft',
      items: [{ item_name: `${ctx.tag}-item`, material_code: ctx.bomMarker, unit: 'PCS', qty: 1 }],
    }),
    id: (r) => Number(r.id),
    rowMarker: (ctx, r) => String(r.dn_number || ctx.dnMarker),
    deletePath: '/dashboard/delivery-notes',
  },
  {
    key: 'delivery_sheet',
    table: 'delivery_sheets',
    endpoint: '/api/delivery-sheets',
    marker: (ctx) => ctx.dsMarker,
    payload: (ctx) => ({
      customer_id: ctx.ids.customer,
      customer_name: ctx.dsMarker,
      customer_order_id: ctx.ids.customer_order,
      status: 'draft',
      items: [{ item_name: `${ctx.tag}-item`, material_code: ctx.bomMarker, unit: 'PCS', qty: 1 }],
    }),
    id: (r) => Number(r.id),
    rowMarker: (ctx, r) => String(r.ds_number || ctx.dsMarker),
    deletePath: '/dashboard/delivery-sheets',
  },
  {
    key: 'goods_receipt',
    table: 'goods_receipts',
    endpoint: '/api/goods-receipts',
    marker: (ctx) => ctx.grMarker,
    payload: (ctx) => ({
      supplier_id: ctx.ids.supplier,
      supplier_name: ctx.supplierMarker,
      po_number: ctx.grMarker,
      items: [{ material_code: ctx.bomMarker, material_name: `${ctx.tag}-BOM`, unit: 'PCS', ordered_qty: 1, received_qty: 1, unit_price: 100 }],
    }),
    id: (r) => Number(r.id),
    rowMarker: (ctx, r) => String(r.gr_number || ctx.grMarker),
    deletePath: '/dashboard/goods-receipts',
  },
  {
    key: 'production',
    table: 'production_orders',
    endpoint: '/api/production',
    marker: (ctx) => ctx.prodMarker,
    payload: (ctx) => ({
      bom_id: ctx.ids.bom,
      product_sku: ctx.bomMarker,
      product_name: ctx.prodMarker,
      planned_qty: 1,
      initial_status: 'draft',
      materials: [],
    }),
    id: (r) => Number(r.id),
    rowMarker: (ctx) => ctx.prodMarker,
    deletePath: '/dashboard/production',
  },
  {
    key: 'stock_adjustment',
    table: 'stock_adjustments',
    endpoint: '/api/stock-adjustments',
    marker: (ctx) => ctx.adjMarker,
    payload: (ctx) => ({
      adj_type: 'count',
      remark: ctx.adjMarker,
      items: [{ material_code: ctx.bomMarker, material_name: `${ctx.tag}-BOM`, unit: 'PCS', actual_qty: 1 }],
    }),
    id: (r) => Number(r.id),
    rowMarker: (ctx, r) => String(r.adj_number || ctx.adjMarker),
    deletePath: '/dashboard/stock-adjustments',
  },
  {
    key: 'user',
    table: 'users',
    endpoint: '/api/users',
    marker: (ctx) => ctx.userEmail,
    payload: (ctx) => ({ email: ctx.userEmail, password: 'admin123', name: `${ctx.tag}-USER`, role: 'employee' }),
    id: (r) => Number(r.id),
    rowMarker: (ctx) => ctx.userEmail,
    deletePath: '/dashboard/users',
  },
]

const DELETE_SEQUENCE = [
  'user',
  'stock_adjustment',
  'production',
  'goods_receipt',
  'delivery_sheet',
  'delivery_note',
  'quotation',
  'customer_order',
  'po',
  'bom',
  'material',
  'customer',
  'supplier',
]

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function log(message) {
  const ts = new Date().toISOString()
  console.log(`[${ts}] ${message}`)
}

async function safeJson(res) {
  const text = await res.text()
  try {
    return text ? JSON.parse(text) : null
  } catch {
    return text
  }
}

async function fetchWithTimeout(url, options = {}, timeoutMs = TIMEOUT_MS) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...options, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

async function apiRequest(token, method, url, data, attempt = 0) {
  try {
    const res = await fetchWithTimeout(`${API}${url}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    })
    if (!res.ok) {
      const body = await safeJson(res)
      throw new Error(`${method} ${url} -> ${res.status} ${typeof body === 'string' ? body : JSON.stringify(body)}`)
    }
    return await safeJson(res)
  } catch (error) {
    if (attempt < RETRY) {
      await new Promise((r) => setTimeout(r, 400 * (attempt + 1)))
      return apiRequest(token, method, url, data, attempt + 1)
    }
    throw error
  }
}

async function loginApi() {
  const login = await apiRequest(null, 'POST', '/api/auth/login', {
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
  })
  assert(login?.token, 'API login failed: missing token')
  return login
}

async function loginUi(page) {
  await page.goto(`${WEB}/login`, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS })
  await page.fill('input[type="email"]', ADMIN_EMAIL)
  await page.fill('input[type="password"]', ADMIN_PASSWORD)
  await Promise.all([
    page.waitForURL('**/dashboard**', { timeout: NAV_TIMEOUT_MS }),
    page.click('button:has-text("登入"), button:has-text("Login")'),
  ])
}

function rowLocator(page, marker) {
  return page.locator('tr', { hasText: marker }).first()
}

async function clickDeleteAndConfirm(page, marker) {
  const row = rowLocator(page, marker)
  await row.waitFor({ state: 'visible', timeout: 20000 })

  const delBtn = row.locator('button:has-text("刪除"), button:has-text("删除")').first()
  await delBtn.waitFor({ state: 'visible', timeout: 10000 })
  await delBtn.click({ force: true })

  const modalConfirm = page.locator('div.fixed.inset-0.z-\\[9998\\] button.bg-red-500').last()
  if (await modalConfirm.isVisible({ timeout: 2500 }).catch(() => false)) {
    await modalConfirm.click()
  } else {
    const fallback = page.locator('button:has-text("確認刪除"), button:has-text("確認"), button:has-text("刪除"), button:has-text("删除")').last()
    await fallback.waitFor({ state: 'visible', timeout: 5000 })
    await fallback.click()
  }

  await page.waitForTimeout(1000)
  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {})

  const sameRowDeleteBtn = rowLocator(page, marker).locator('button:has-text("刪除"), button:has-text("删除")').first()
  await sameRowDeleteBtn.waitFor({ state: 'detached', timeout: 15000 }).catch(async () => {
    const stillVisible = await sameRowDeleteBtn.isVisible().catch(() => false)
    if (stillVisible) throw new Error(`delete still visible for marker ${marker}`)
  })
}

async function gotoListAndDelete(page, path, marker) {
  await page.goto(`${WEB}${path}`, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS })
  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {})
  await clickDeleteAndConfirm(page, marker)
}

function createContext(tag) {
  return {
    tag,
    ids: {},
    markers: {},
    rowMarkers: {},
    supplierMarker: `${tag}-SUP`,
    customerMarker: `${tag}-CUS`,
    materialMarker: `${tag}-MAT`,
    bomMarker: `${tag}-SKU`,
    poMarker: `${tag}-PO-SUP`,
    coMarker: `${tag}-CO`,
    qtMarker: `${tag}-QT-CUS`,
    dnMarker: `${tag}-DN-CUS`,
    dsMarker: `${tag}-DS-CUS`,
    grMarker: `${tag}-GR-SUP`,
    prodMarker: `${tag}-PROD`,
    adjMarker: `${tag}-ADJ`,
    userEmail: `${tag.toLowerCase()}@rubber.local`,
  }
}

async function createRecords(token, ctx) {
  const created = []
  for (const job of CREATE_JOBS) {
    const marker = job.marker(ctx)
    const payload = job.payload(ctx)
    const result = await apiRequest(token, 'POST', job.endpoint, payload)

    const id = job.id(result)
    const rowMarker = job.rowMarker(ctx, result)

    ctx.ids[job.key] = id
    ctx.markers[job.key] = marker
    ctx.rowMarkers[job.key] = rowMarker

    created.push({
      key: job.key,
      table: job.table,
      id,
      marker: rowMarker,
      endpoint: job.endpoint,
      path: job.deletePath,
    })

    log(`created ${job.key}: id=${id} marker=${rowMarker}`)
  }
  return created
}

async function deleteRecords(page, ctx) {
  const deleteResults = []

  for (const key of DELETE_SEQUENCE) {
    const job = CREATE_JOBS.find((j) => j.key === key)
    if (!job) continue

    const marker = ctx.rowMarkers[key] || ctx.markers[key]
    try {
      assert(marker, `missing marker for ${key}`)
      await gotoListAndDelete(page, job.deletePath, marker)
      deleteResults.push({ key, path: job.deletePath, marker, ok: true })
      log(`deleted ${key}: marker=${marker}`)
    } catch (error) {
      const message = String(error?.message || error)
      const screenshot = `${SHOT_DIR}/pw43-delete-fail-${key}-${Date.now()}.png`
      await page.screenshot({ path: screenshot, fullPage: true }).catch(() => {})
      deleteResults.push({ key, path: job.deletePath, marker, ok: false, error: message, screenshot })
      log(`delete failed ${key}: ${message}`)
    }
  }

  return deleteResults
}

async function main() {
  const start = Date.now()
  const tag = `PW43${Date.now().toString().slice(-8)}`
  const ctx = createContext(tag)

  let browser
  let page

  try {
    log(`start soft-delete sweep tag=${tag}`)
    const login = await loginApi()
    const token = login.token

    browser = await chromium.launch({ headless: HEADLESS })
    page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
    await loginUi(page)

    const created = await createRecords(token, ctx)
    const deleteResults = await deleteRecords(page, ctx)

    const okCount = deleteResults.filter((x) => x.ok).length
    const failCount = deleteResults.length - okCount
    const elapsedMs = Date.now() - start

    const output = {
      tag,
      web: WEB,
      api: API,
      elapsedMs,
      created,
      deleteResults,
      summary: {
        totalCreated: created.length,
        totalDeleted: deleteResults.length,
        okCount,
        failCount,
      },
    }

    await fs.writeFile(OUT_FILE, JSON.stringify(output, null, 2), 'utf8')
    log(`done. out=${OUT_FILE} ok=${okCount} fail=${failCount} elapsedMs=${elapsedMs}`)
  } finally {
    await page?.close().catch(() => {})
    await browser?.close().catch(() => {})
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
