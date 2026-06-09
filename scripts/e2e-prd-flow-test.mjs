#!/usr/bin/env node
/**
 * PRD E2E: 客戶訂單 → 交期進度 → 出貨，測完清理測試資料
 */
const API = 'http://43.160.199.226:10102'
const TAG = `E2E-PW-${Date.now()}`

const state = {
  token: null,
  customerId: 1202,
  bomId: null,
  orderId: null,
  orderItemId: null,
  poNumber: `${TAG}`,
  progressId: null,
  progressNo: null,
  dnId: null,
  dnNumber: null,
  poIds: [],
}

async function api(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${state.token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let data = {}
  try { data = text ? JSON.parse(text) : {} } catch { data = { raw: text } }
  return { status: res.status, data }
}

function ok(label, cond, detail = '') {
  const mark = cond ? '✓' : '✗'
  console.log(`${mark} ${label}${detail ? ` — ${detail}` : ''}`)
  if (!cond) throw new Error(`FAIL: ${label}`)
}

async function login() {
  const res = await fetch(`${API}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@rubber.local', password: 'Make$45617' }),
  })
  const data = await res.json()
  state.token = data.token
  ok('登入', !!state.token)
}

async function pickBom() {
  const { status, data } = await api('GET', '/api/bom')
  ok('取得 BOM 列表', status === 200 && Array.isArray(data) && data.length > 0)
  const bom = data.find((b) => b.product_sku === '7803V') || data.find((b) => Number(b.item_count || b.items_count || 0) > 0) || data[0]
  state.bomId = bom.id
  ok('選擇 BOM', !!state.bomId, `${bom.product_sku} (#${bom.id})`)
}

async function createCustomerOrder() {
  const payload = {
    po_number: state.poNumber,
    po_date: '2026-06-08',
    customer_id: state.customerId,
    currency: 'VND',
    delivery_date: '2026-06-20',
    remark: `${TAG} auto test`,
    items: [{
      bom_id: state.bomId,
      qty: 3,
      unit_price: 1000,
      rta_date: '2026-06-20',
      po_no: state.poNumber,
      remark: TAG,
    }],
  }
  const { status, data } = await api('POST', '/api/customer-orders', payload)
  ok('建立客戶訂單', status === 201 && data.id, `id=${data.id}`)
  state.orderId = data.id

  const detail = await api('GET', `/api/customer-orders/${state.orderId}`)
  ok('讀取訂單明細', detail.status === 200 && detail.data.items?.length)
  state.orderItemId = detail.data.items[0].id
}

async function createDeliveryProgress() {
  const tree = await api('GET', `/api/customer-orders/bom-material-tree?order_ids=${state.orderId}`)
  ok('讀取 BOM 樹', tree.status === 200 && tree.data.length > 0)
  const node = tree.data[0]
  const payload = {
    customer_id: state.customerId,
    customer_name: node.customer_name,
    customer_order_ids: [state.orderId],
    remark: `${TAG} progress`,
    items: [{
      line_type: 'bom',
      customer_order_id: state.orderId,
      order_item_id: node.order_item_id,
      bom_id: node.bom_id,
      bom_code: node.bom_sku,
      bom_name: node.bom_name,
      order_po_number: node.order_po_number || state.poNumber,
      customer_po_number: node.customer_po_number || state.poNumber,
      planned_qty: 3,
      due_date: '2026-06-20',
      unit: 'PCS',
      remark: TAG,
    }],
  }
  const { status, data } = await api('POST', '/api/order-intake', payload)
  ok('建立交期進度', status === 201 && data.id, `${data.progress_no}`)
  state.progressId = data.id
  state.progressNo = data.progress_no
  state.dnId = data.dn_id
  state.dnNumber = data.dn_number
  if (Array.isArray(data.po_created)) state.poIds = data.po_created.map((p) => p.id)
  ok('自動建立出貨單', !!state.dnId, state.dnNumber)
  ok('自動建立採購單', state.poIds.length > 0, `${state.poIds.length} 張`)
}

async function shipDeliveryNote() {
  const dn = await api('GET', `/api/delivery-notes/${state.dnId}`)
  ok('讀取出貨單', dn.status === 200, `status=${dn.data.status}`)

  let res = await api('PATCH', `/api/delivery-notes/${state.dnId}/status`, { status: 'confirmed' })
  ok('審核出貨單', res.status === 200)

  res = await api('PATCH', `/api/delivery-notes/${state.dnId}/status`, { status: 'shipped' })
  ok('確認出貨', res.status === 200)

  const list = await api('GET', '/api/customer-orders')
  const order = (list.data || []).find((o) => o.id === state.orderId)
  const shipped = Number(order?.shipped_total_qty || order?.arrived_total_qty || 0)
  ok('訂單出貨數量回寫', shipped >= 3, `shipped=${shipped}`)
}

async function verifyDepletedGuard() {
  const tree = await api('GET', `/api/customer-orders/bom-material-tree?order_ids=${state.orderId}`)
  const node = tree.data[0]
  const payload = {
    customer_id: state.customerId,
    customer_name: node.customer_name,
    customer_order_ids: [state.orderId],
    items: [{
      line_type: 'bom',
      customer_order_id: state.orderId,
      order_item_id: node.order_item_id,
      bom_id: node.bom_id,
      bom_code: node.bom_sku,
      bom_name: node.bom_name,
      order_po_number: node.order_po_number,
      planned_qty: 1,
      unit: 'PCS',
    }],
  }
  const res = await api('POST', '/api/order-intake', payload)
  ok('剩餘數量防護 (應 400)', res.status === 400, res.data.error || '')
}

async function cleanup() {
  console.log('\n--- 清理測試資料 ---')
  for (const poId of state.poIds) {
    const res = await api('DELETE', `/api/po/${poId}`)
    ok(`刪除採購單 #${poId}`, res.status === 200)
  }
  if (state.dnId) {
    const res = await api('DELETE', `/api/delivery-notes/${state.dnId}`)
    ok(`刪除出貨單 ${state.dnNumber}`, res.status === 200)
  }
  if (state.progressId) {
    const res = await api('DELETE', `/api/order-intake/${state.progressId}`)
    ok(`刪除交期進度 ${state.progressNo}`, res.status === 200)
  }
  if (state.orderId) {
    const res = await api('DELETE', `/api/customer-orders/${state.orderId}`)
    ok(`刪除客戶訂單 ${state.poNumber}`, res.status === 200)
  }

  // verify gone
  if (state.orderId) {
    const check = await api('GET', `/api/customer-orders/${state.orderId}`)
    ok('訂單已清除', check.status === 404 || check.data?.error === 'Not found', `status=${check.status}`)
  }
}

async function main() {
  console.log(`\n=== Rubber-MES PRD E2E [${TAG}] ===\n`)
  try {
    await login()
    await pickBom()
    await createCustomerOrder()
    await createDeliveryProgress()
    await shipDeliveryNote()
    await verifyDepletedGuard()
    await cleanup()
    console.log(`\n=== 全部通過，測試資料已清理 ===\n`)
  } catch (e) {
    console.error(`\n!!! 測試中斷: ${e.message}`)
    console.log('嘗試清理已建立資料...')
    try { await cleanup() } catch (ce) { console.error('清理失敗:', ce.message) }
    process.exit(1)
  }
}

main()
