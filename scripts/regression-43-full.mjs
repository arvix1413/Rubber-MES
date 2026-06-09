import { chromium } from 'playwright'
import fs from 'fs'
import path from 'path'

const WEB = process.env.PW43_WEB || 'http://43.160.199.226:10101'
const API = process.env.PW43_API || 'http://43.160.199.226:10102'
const ADMIN_EMAIL = process.env.PW43_ADMIN_EMAIL || 'admin@rubber.local'
const ADMIN_PASSWORD = process.env.PW43_ADMIN_PASSWORD || 'admin123'
const HEADLESS = process.env.PW43_HEADLESS !== 'false'
const OUT_DIR = process.env.PW43_OUT_DIR || '/tmp'
const OUT_FILE = process.env.PW43_OUT_FILE || path.join(OUT_DIR, `regression-43-${Date.now()}.json`)
const DEPLOY_WAIT_MS = Number(process.env.PW43_DEPLOY_WAIT_MS || 150000)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const report = {
  tag: `RG${Date.now().toString().slice(-6)}`,
  web: WEB,
  api: API,
  started_at: new Date().toISOString(),
  api_checks: { ok: [], fail: [] },
  ui_checks: { ok: [], fail: [] },
  ids: {},
}

const pushOk = (scope, step, extra = {}) => report[scope].ok.push({ step, ...extra })
const pushFail = (scope, step, error, extra = {}) => report[scope].fail.push({ step, error: String(error?.message || error), ...extra })

async function apiReq(method, pathName, token, body) {
  const res = await fetch(`${API}${pathName}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let json
  try { json = text ? JSON.parse(text) : {} } catch { json = { raw: text } }
  if (!res.ok) {
    throw new Error(`${method} ${pathName} -> ${res.status} ${json?.error || text}`)
  }
  return json
}

async function runApiCrudSweep(token) {
  const tag = report.tag

  const supplier = await apiReq('POST', '/api/suppliers', token, {
    supplier_code: `${tag}-SUP`,
    name: `${tag}-SUP`,
    currency: 'VND',
    status: 'active',
  })
  report.ids.supplier_id = supplier.id
  pushOk('api_checks', 'suppliers.create', { id: supplier.id })
  await apiReq('PUT', `/api/suppliers/${supplier.id}`, token, { name: `${tag}-SUP-U`, currency: 'VND', status: 'active' })
  pushOk('api_checks', 'suppliers.update')

  const customer = await apiReq('POST', '/api/customers', token, {
    customer_code: `${tag}-CUS`,
    customer_name: `${tag}-CUS`,
    status: 'active',
  })
  report.ids.customer_id = customer.id
  pushOk('api_checks', 'customers.create', { id: customer.id })
  await apiReq('PUT', `/api/customers/${customer.id}`, token, { customer_name: `${tag}-CUS-U`, status: 'active' })
  pushOk('api_checks', 'customers.update')

  const material = await apiReq('POST', '/api/materials', token, {
    material_code: `${tag}-MAT`,
    material_name: `${tag}-MAT`,
    unit: 'PCS',
    currency: 'VND',
    supplier_id: supplier.id,
  })
  report.ids.material_id = material.id
  pushOk('api_checks', 'materials.create', { id: material.id })
  await apiReq('PUT', `/api/materials/${material.id}`, token, { material_name: `${tag}-MAT-U`, unit: 'PCS', currency: 'VND', supplier_id: supplier.id })
  pushOk('api_checks', 'materials.update')

  const bom = await apiReq('POST', '/api/bom', token, {
    product_sku: `${tag}-SKU`,
    product_name: `${tag}-SKU`,
    unit: 'PCS',
    supplier_id: supplier.id,
    supplier_price: 10,
    company_price: 12,
    currency: 'VND',
    items: [],
  })
  report.ids.bom_id = bom.id
  pushOk('api_checks', 'bom.create', { id: bom.id })
  await apiReq('PUT', `/api/bom/${bom.id}`, token, { product_name: `${tag}-SKU-U`, unit: 'PCS', supplier_id: supplier.id, supplier_price: 11, company_price: 13, currency: 'VND', items: [] })
  pushOk('api_checks', 'bom.update')

  const co = await apiReq('POST', '/api/customer-orders', token, {
    po_number: `${tag}-CO`,
    customer_id: customer.id,
    customer_name: `${tag}-CUS`,
    currency: 'VND',
    items: [{ bom_id: bom.id, qty: 10, unit_price: 13 }],
  })
  report.ids.customer_order_id = co.id
  pushOk('api_checks', 'customer-orders.create', { id: co.id })
  await apiReq('PUT', `/api/customer-orders/${co.id}`, token, {
    po_number: `${tag}-CO`,
    customer_id: customer.id,
    customer_name: `${tag}-CUS`,
    currency: 'VND',
    items: [{ bom_id: bom.id, qty: 12, unit_price: 13 }],
  })
  pushOk('api_checks', 'customer-orders.update')

  const genPo = await apiReq('POST', `/api/order-intake/${co.id}/generate-po`, token, { split_by_supplier: true })
  pushOk('api_checks', 'order-intake.generate-po', { count: genPo.count || 0 })

  const poNo = genPo?.created?.[0]?.po_number
  if (poNo) {
    const poList = await apiReq('GET', '/api/po', token)
    const po = poList.find((x) => x.po_number === poNo)
    if (po?.id) {
      report.ids.po_id = po.id
      await apiReq('PATCH', `/api/po/${po.id}/approve`, token, {})
      pushOk('api_checks', 'po.approve')
      await apiReq('PATCH', `/api/po/${po.id}/status`, token, { status: 'sent' })
      pushOk('api_checks', 'po.status.sent')
      await apiReq('PATCH', `/api/po/${po.id}/receive`, token, {})
      pushOk('api_checks', 'po.receive')
    }
  }

  const dn = await apiReq('POST', '/api/delivery-notes', token, {
    customer_id: customer.id,
    customer_name: `${tag}-CUS`,
    customer_order_id: co.id,
    delivery_date: null,
    remark: tag,
    items: [{ item_name: `${tag}-ITEM`, material_code: `${tag}-SKU`, unit: 'PCS', qty: 4 }],
  })
  report.ids.delivery_note_id = dn.id
  pushOk('api_checks', 'delivery-notes.create', { id: dn.id })
  await apiReq('PUT', `/api/delivery-notes/${dn.id}`, token, {
    delivery_date: null,
    remark: `${tag}-U`,
    items: [{ item_name: `${tag}-ITEM-U`, material_code: `${tag}-SKU`, unit: 'PCS', qty: 4 }],
  })
  pushOk('api_checks', 'delivery-notes.update')
  await apiReq('PATCH', `/api/delivery-notes/${dn.id}/status`, token, { status: 'confirmed' })
  pushOk('api_checks', 'delivery-notes.status.confirmed')
  await apiReq('PATCH', `/api/delivery-notes/${dn.id}/status`, token, { status: 'shipped' })
  pushOk('api_checks', 'delivery-notes.status.shipped')

  const pendingRec = await apiReq('GET', '/api/reconciliations/pending-items?page_size=1000', token)
  const recBaseItem = pendingRec.find((x) => x.delivery_note_id === dn.id) || pendingRec[0]
  if (recBaseItem) {
    const rec = await apiReq('POST', '/api/reconciliations', token, {
      items: [{
        delivery_note_item_id: recBaseItem.delivery_note_item_id,
        accepted_qty: recBaseItem.shipped_qty,
        difference_reason: '',
      }],
      remark: tag,
    })
    report.ids.reconciliation_id = rec.id
    pushOk('api_checks', 'reconciliations.create', { id: rec.id })

    const recDetail = await apiReq('GET', `/api/reconciliations/${rec.id}`, token)
    await apiReq('PUT', `/api/reconciliations/${rec.id}`, token, {
      reconcile_date: recDetail.reconcile_date,
      remark: `${tag}-U`,
      items: (recDetail.items || []).map((i) => ({ id: i.id, accepted_qty: i.accepted_qty, difference_reason: i.difference_reason || '' })),
    })
    pushOk('api_checks', 'reconciliations.update')
    await apiReq('PATCH', `/api/reconciliations/${rec.id}/confirm`, token, {})
    pushOk('api_checks', 'reconciliations.confirm')
  }

  for (const type of ['customer', 'supplier']) {
    const pend = await apiReq('GET', `/api/invoices/pending-items?type=${type}`, token)
    if (!pend.length) {
      pushOk('api_checks', `invoices.${type}.pending.empty`)
      continue
    }
    const base = pend[0]
    const inv = await apiReq('POST', '/api/invoices', token, {
      invoice_type: type,
      items: [{ reconciliation_item_id: base.reconciliation_item_id, qty: base.remaining_qty, unit_price: base.unit_price }],
      tax_rate: 0,
      remark: tag,
    })
    pushOk('api_checks', `invoices.${type}.create`, { id: inv.id })

    const detail = await apiReq('GET', `/api/invoices/${inv.id}`, token)
    await apiReq('PUT', `/api/invoices/${inv.id}`, token, {
      invoice_date: detail.invoice_date,
      tax_rate: 0,
      remark: `${tag}-U`,
      items: (detail.items || []).map((r) => ({ id: r.id, qty: r.qty, unit_price: r.unit_price })),
    })
    pushOk('api_checks', `invoices.${type}.update`, { id: inv.id })
    await apiReq('PATCH', `/api/invoices/${inv.id}/confirm`, token, {})
    pushOk('api_checks', `invoices.${type}.confirm`, { id: inv.id })
  }

  const receivables = await apiReq('GET', '/api/receivables?page_size=1000', token)
  if (receivables.length) {
    const r = receivables[0]
    await apiReq('PATCH', `/api/receivables/${r.id}/payment`, token, {
      received_amount: Number(r.total_amount || 0),
      payment_date: new Date().toISOString().slice(0, 10),
      payment_note: tag,
    })
    pushOk('api_checks', 'receivables.payment')
  }

  const payables = await apiReq('GET', '/api/payables?page_size=1000', token)
  if (payables.length) {
    const p = payables[0]
    await apiReq('PATCH', `/api/payables/${p.id}/payment`, token, {
      paid_amount: Number(p.total_amount || 0),
      payment_date: new Date().toISOString().slice(0, 10),
      payment_note: tag,
    })
    pushOk('api_checks', 'payables.payment')
  }

  const user = await apiReq('POST', '/api/users', token, {
    email: `${tag.toLowerCase()}@rubber.local`,
    name: `${tag}-USER`,
    password: 'admin123',
    role: 'employee',
  })
  report.ids.user_id = user.id
  pushOk('api_checks', 'users.create', { id: user.id })
  await apiReq('PUT', `/api/users/${user.id}`, token, { name: `${tag}-USER-U`, role: 'employee' })
  pushOk('api_checks', 'users.update')
  await apiReq('POST', `/api/users/${user.id}/reset-password`, token, {})
  pushOk('api_checks', 'users.reset-password')
  await apiReq('DELETE', `/api/users/${user.id}`, token)
  pushOk('api_checks', 'users.delete')

  const supToDelete = await apiReq('POST', '/api/suppliers', token, { supplier_code: `${tag}-SUPD`, name: `${tag}-SUPD`, currency: 'VND', status: 'active' })
  await apiReq('DELETE', `/api/suppliers/${supToDelete.id}`, token)
  pushOk('api_checks', 'suppliers.delete')

  const cusToDelete = await apiReq('POST', '/api/customers', token, { customer_code: `${tag}-CUSD`, customer_name: `${tag}-CUSD`, status: 'active' })
  await apiReq('DELETE', `/api/customers/${cusToDelete.id}`, token)
  pushOk('api_checks', 'customers.delete')
}

async function uiLogin(page) {
  await page.goto(`${WEB}/login`, { waitUntil: 'domcontentloaded', timeout: 30000 })
  await page.fill('input[type="email"]', ADMIN_EMAIL)
  await page.fill('input[type="password"]', ADMIN_PASSWORD)
  const submit = page.locator('button[type="submit"]').first()
  await Promise.all([
    page.waitForURL('**/dashboard**', { timeout: 30000 }),
    submit.click(),
  ])
}

async function runUiSweep() {
  const browser = await chromium.launch({ headless: HEADLESS })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  try {
    await uiLogin(page)

    const routes = [
      '/dashboard/customers',
      '/dashboard/suppliers',
      '/dashboard/materials',
      '/dashboard/bom',
      '/dashboard/customer-orders',
      '/dashboard/order-intake',
      '/dashboard/po',
      '/dashboard/delivery-notes',
      '/dashboard/shipment-reconciliation',
      '/dashboard/invoices',
      '/dashboard/receivables',
      '/dashboard/payables',
      '/dashboard/inventory',
      '/dashboard/users',
      '/dashboard/company',
      '/dashboard/profile',
    ]

    for (const route of routes) {
      try {
        await page.goto(`${WEB}${route}`, { waitUntil: 'domcontentloaded', timeout: 30000 })
        await page.waitForTimeout(1200)
        const bodyText = await page.locator('body').innerText()
        const hasError = ['系統暫時異常', '操作失敗', '請稍後再試'].some((kw) => bodyText.includes(kw))
        const shot = path.join(OUT_DIR, `regression-43-${route.replace(/\//g, '_')}.png`)
        await page.screenshot({ path: shot, fullPage: true })
        if (hasError) {
          pushFail('ui_checks', `page:${route}`, 'found error toast/text', { screenshot: shot })
        } else {
          pushOk('ui_checks', `page:${route}`, { screenshot: shot })
        }
      } catch (e) {
        pushFail('ui_checks', `page:${route}`, e)
      }
    }
  } finally {
    await browser.close()
  }
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true })
  try {
    if (DEPLOY_WAIT_MS > 0) {
      console.log(`[deploy-wait] waiting ${DEPLOY_WAIT_MS}ms before regression starts`)
      await sleep(DEPLOY_WAIT_MS)
    }
    const login = await apiReq('POST', '/api/auth/login', null, { email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
    const token = login.token
    pushOk('api_checks', 'auth.login')

    try {
      await runApiCrudSweep(token)
    } catch (e) {
      pushFail('api_checks', 'api-crud-sweep', e)
    }

    await runUiSweep()
  } catch (e) {
    pushFail('api_checks', 'bootstrap', e)
  } finally {
    report.finished_at = new Date().toISOString()
    fs.writeFileSync(OUT_FILE, JSON.stringify(report, null, 2), 'utf8')
    console.log(`REPORT ${OUT_FILE}`)
    console.log(`API OK=${report.api_checks.ok.length} FAIL=${report.api_checks.fail.length}`)
    console.log(`UI  OK=${report.ui_checks.ok.length} FAIL=${report.ui_checks.fail.length}`)
    if (report.api_checks.fail.length || report.ui_checks.fail.length) process.exit(1)
  }
}

main()
