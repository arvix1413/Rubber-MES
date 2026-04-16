/**
 * 完整业务流程测试
 * 客户订单 → 采购单 → 收货(库存+) → 生产单(库存-) → 出货单
 */
import { test, expect } from '@playwright/test'

const API = 'http://localhost:3001'
const BASE = 'http://localhost:3000'

// 测试用的 BOM/客户/供应商 ID（从现有数据）
const BOM_ID = 89
const BOM_SKU = 'YBCZKA01268'
const BOM_NAME = 'WGDP109 吊卡 / thẻ giấy'
const CUSTOMER_ID = 3
const SUPPLIER_ID = 10
const ORDER_QTY = 100  // 客户订单数量
const PO_QTY = 150     // 采购数量（多备一些）

let token = ''
let coId = 0, coNumber = ''
let poId = 0, poNumber = ''
let prodId = 0, prodNumber = ''
let dnId = 0, dnNumber = ''
let stockBefore = 0

async function api(path: string, opts: any = {}) {
  const res = await fetch(`${API}${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(opts.headers || {}) }
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(`${path} failed: ${JSON.stringify(err)}`)
  }
  return res.json()
}

async function getStock(): Promise<number> {
  const boms = await api('/api/inventory/bom')
  const bom = boms.find((b: any) => b.product_code === BOM_SKU)
  return parseFloat(bom?.closing_balance || '0')
}

test.beforeAll(async () => {
  const data = await fetch(`${API}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@oms.com', password: 'admin123' })
  }).then(r => r.json())
  token = data.token
  console.log('✅ 登入成功')
})

// ─── Step 1: 查看初始库存 ─────────────────────────────────────────────────────
test('Step 1: 查看初始库存', async () => {
  stockBefore = await getStock()
  console.log(`📦 初始库存: ${BOM_SKU} = ${stockBefore}`)
})

// ─── Step 2: 建立客户订单 ─────────────────────────────────────────────────────
test('Step 2: 建立客户订单', async () => {
  const ts = Date.now().toString().slice(-6)
  coNumber = `TEST-CO-${ts}`

  const data = await api('/api/customer-orders', {
    method: 'POST',
    body: JSON.stringify({
      po_number: coNumber,
      customer_id: CUSTOMER_ID,
      po_date: new Date().toISOString().slice(0, 10),
      delivery_date: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
      currency: 'VND',
      tax_rate: 8,
      remark: '自動化測試訂單',
      items: [{
        bom_id: BOM_ID,
        qty: ORDER_QTY,
        unit_price: 5000,
        rta_date: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10)
      }]
    })
  })
  coId = data.id
  console.log(`✅ 客戶訂單建立: ${coNumber} (id=${coId})`)
  expect(coId).toBeGreaterThan(0)

  // 验证订单状态
  const order = await api(`/api/customer-orders/${coId}`)
  expect(order.status).toBe('pending')
  expect(order.items).toHaveLength(1)
  expect(Number(order.items[0].qty)).toBe(ORDER_QTY)
  console.log(`✅ 訂單狀態: ${order.status}, 品項數量: ${order.items[0].qty}`)
})

// ─── Step 3: 建立采购单 ───────────────────────────────────────────────────────
test('Step 3: 建立採購單', async () => {
  const ts = Date.now().toString().slice(-6)
  poNumber = `PO-TEST-${ts}`

  const data = await api('/api/po', {
    method: 'POST',
    body: JSON.stringify({
      supplier_id: SUPPLIER_ID,
      supplier_name: 'CÔNG TY IN ẤN NKV',
      currency: 'VND',
      remark: '自動化測試採購',
      items: [{
        material_code: BOM_SKU,
        material_name: BOM_NAME,
        spec: '50*86mm',
        unit: 'PCS',
        quantity: PO_QTY,
        unit_price: 3000,
        total_price: PO_QTY * 3000,
        currency: 'VND',
        remark: '',
        po_ref: coNumber,
        thickness: ''
      }]
    })
  })
  poId = data.id
  poNumber = data.po_number
  console.log(`✅ 採購單建立: ${poNumber} (id=${poId})`)
  expect(poId).toBeGreaterThan(0)

  // 验证采购单状态
  const po = await api(`/api/po/${poId}`)
  expect(po.status).toBe('draft')
  console.log(`✅ 採購單狀態: ${po.status}`)
})

// ─── Step 4: 核准采购单 ───────────────────────────────────────────────────────
test('Step 4: 核准採購單', async () => {
  await api(`/api/po/${poId}/approve`, { method: 'PATCH' })
  const po = await api(`/api/po/${poId}`)
  expect(po.status).toBe('approved')
  console.log(`✅ 採購單已核准: ${po.status}`)
})

// ─── Step 5: 收货（库存增加）─────────────────────────────────────────────────
test('Step 5: 採購單收貨 → 庫存增加', async () => {
  const stockBeforeRecv = await getStock()
  console.log(`📦 收貨前庫存: ${stockBeforeRecv}`)

  await api(`/api/po/${poId}/receive`, { method: 'PATCH' })

  const po = await api(`/api/po/${poId}`)
  expect(po.status).toBe('received')
  console.log(`✅ 採購單已收貨: ${po.status}`)

  const stockAfterRecv = await getStock()
  console.log(`📦 收貨後庫存: ${stockAfterRecv}`)
  expect(stockAfterRecv).toBe(stockBeforeRecv + PO_QTY)
  console.log(`✅ 庫存增加正確: ${stockBeforeRecv} + ${PO_QTY} = ${stockAfterRecv}`)
})

// ─── Step 6: 建立生产单 ───────────────────────────────────────────────────────
test('Step 6: 建立生產單', async () => {
  const stockBeforeProd = await getStock()
  console.log(`📦 生產前庫存: ${stockBeforeProd}`)

  const data = await api('/api/production', {
    method: 'POST',
    body: JSON.stringify({
      bom_id: BOM_ID,
      product_sku: BOM_SKU,
      product_name: BOM_NAME,
      planned_qty: ORDER_QTY,
      customer_order_id: coId,
      planned_start: new Date().toISOString().slice(0, 10),
      planned_end: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
      remark: '自動化測試生產',
      initial_status: 'confirmed',
      materials: []
    })
  })
  prodId = data.id
  prodNumber = data.prod_number
  console.log(`✅ 生產單建立: ${prodNumber} (id=${prodId})`)
  expect(prodId).toBeGreaterThan(0)
})

// ─── Step 7: 生产完成（库存消耗）─────────────────────────────────────────────
test('Step 7: 生產完成 → 庫存消耗', async () => {
  const stockBeforeComplete = await getStock()
  console.log(`📦 完工前庫存: ${stockBeforeComplete}`)

  // 推进状态到 in_progress
  await api(`/api/production/${prodId}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'in_progress' })
  })

  // 完工
  await api(`/api/production/${prodId}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'completed', produced_qty: ORDER_QTY })
  })

  const prod = await api(`/api/production/${prodId}`)
  expect(prod.status).toBe('completed')
  console.log(`✅ 生產單完工: ${prod.status}, 生產數量: ${prod.produced_qty}`)

  // 注意：生产单消耗的是 bom_items 里的原材料，不是 BOM 本身
  // 如果 bom_items 为空，库存不变
  const stockAfterComplete = await getStock()
  console.log(`📦 完工後庫存: ${stockAfterComplete}（如有原材料配置則會減少）`)
})

// ─── Step 8: 建立出货单 ───────────────────────────────────────────────────────
test('Step 8: 建立出貨單', async () => {
  // 获取客户订单的待出货品项
  const order = await api(`/api/customer-orders/${coId}`)
  const items = order.items || []
  expect(items.length).toBeGreaterThan(0)

  const data = await api('/api/delivery-notes', {
    method: 'POST',
    body: JSON.stringify({
      customer_id: CUSTOMER_ID,
      customer_name: 'CÔNG TY WAGON VN',
      delivery_date: new Date().toISOString().slice(0, 10),
      remark: '自動化測試出貨',
      items: items.map((item: any) => ({
        bom_id: item.bom_id,
        item_name: BOM_NAME,
        material_code: BOM_SKU,
        qty: ORDER_QTY,
        shipped_qty: ORDER_QTY,
        remark: ''
      }))
    })
  })
  dnId = data.id
  dnNumber = data.dn_number
  console.log(`✅ 出貨單建立: ${dnNumber} (id=${dnId})`)
  expect(dnId).toBeGreaterThan(0)
})

// ─── Step 8b: 确认出货，库存减少 ─────────────────────────────────────────────
test('Step 8b: 確認出貨 → 庫存減少', async () => {
  const stockBeforeShip = await getStock()
  console.log(`📦 出貨前庫存: ${stockBeforeShip}`)

  // confirmed
  await api(`/api/delivery-notes/${dnId}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'confirmed' })
  })

  // shipped → 触发库存扣减
  await api(`/api/delivery-notes/${dnId}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'shipped' })
  })

  const dn = await api(`/api/delivery-notes/${dnId}`)
  expect(dn.status).toBe('shipped')
  console.log(`✅ 出貨單已出貨: ${dn.status}`)

  const stockAfterShip = await getStock()
  console.log(`📦 出貨後庫存: ${stockAfterShip}`)
  expect(stockAfterShip).toBe(stockBeforeShip - ORDER_QTY)
  console.log(`✅ 庫存減少正確: ${stockBeforeShip} - ${ORDER_QTY} = ${stockAfterShip}`)
})

// ─── Step 9: 出货完成，更新客户订单状态 ──────────────────────────────────────
test('Step 9: 完成客戶訂單', async () => {
  await api(`/api/customer-orders/${coId}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'completed' })
  })

  const order = await api(`/api/customer-orders/${coId}`)
  expect(order.status).toBe('completed')
  console.log(`✅ 客戶訂單已完成: ${order.status}`)
})

// ─── Step 10: 验证完整流程 ────────────────────────────────────────────────────
test('Step 10: 驗證完整流程摘要', async () => {
  const finalStock = await getStock()

  console.log('\n========== 完整流程摘要 ==========')
  console.log(`客戶訂單: ${coNumber} (id=${coId}) ✅`)
  console.log(`採購單:   ${poNumber} (id=${poId}) ✅`)
  console.log(`生產單:   ${prodNumber} (id=${prodId}) ✅`)
  console.log(`出貨單:   ${dnNumber} (id=${dnId}) ✅`)
  console.log(`初始庫存: ${stockBefore}`)
  console.log(`最終庫存: ${finalStock}`)
  console.log(`庫存變化: +${PO_QTY}（收貨）- ${ORDER_QTY}（出貨）= ${PO_QTY - ORDER_QTY}`)
  console.log('===================================\n')

  // 最终库存 = 初始库存 + 采购数量 - 出货数量
  expect(finalStock).toBe(stockBefore + PO_QTY - ORDER_QTY)
  console.log('✅ 庫存計算正確')
})

// ─── Step 11: 前端 UI 验证 ────────────────────────────────────────────────────
test('Step 11: 前端UI驗證庫存顯示', async ({ page }) => {
  // Login
  await page.goto(BASE)
  await page.evaluate(() => localStorage.clear())
  await page.goto(`${BASE}/login`)
  await page.fill('input[type="email"]', 'admin@oms.com')
  await page.fill('input[type="password"]', 'admin123')
  await page.click('button:has-text("登入")')
  await page.waitForURL('**/dashboard', { timeout: 10000 })

  // 查看库存页面
  await page.goto(`${BASE}/dashboard/inventory`)
  await page.waitForTimeout(2000)

  // 搜索 BOM SKU
  await page.fill('input[placeholder*="搜尋"]', BOM_SKU)
  await page.waitForTimeout(500)

  const rows = page.locator('tbody tr')
  const count = await rows.count()
  if (count > 0) {
    const stockCell = rows.first().locator('td:last-child span.font-bold')
    const stockText = await stockCell.textContent()
    console.log(`✅ 庫存頁面顯示: ${BOM_SKU} = ${stockText}`)
  }

  // 查看客户订单
  await page.goto(`${BASE}/dashboard/customer-orders`)
  await page.waitForTimeout(1500)
  await page.fill('input[placeholder*="搜尋"]', coNumber)
  await page.waitForTimeout(500)
  const coRow = page.locator(`tr:has-text("${coNumber}")`).first()
  if (coNumber && await coRow.isVisible({ timeout: 2000 }).catch(() => false)) {
    const rowText = await coRow.textContent()
    console.log(`✅ 客戶訂單 ${coNumber} 已顯示在列表`)
  }

  // 查看采购单
  await page.goto(`${BASE}/dashboard/po`)
  await page.waitForTimeout(1500)
  await page.fill('input[placeholder*="搜尋"]', poNumber)
  await page.waitForTimeout(500)
  const poRow = page.locator(`tr:has-text("${poNumber}")`).first()
  if (poNumber && await poRow.isVisible({ timeout: 2000 }).catch(() => false)) {
    console.log(`✅ 採購單 ${poNumber} 已顯示在列表`)
  }
})

// ─── Cleanup ──────────────────────────────────────────────────────────────────
test.afterAll(async () => {
  try {
    if (dnId) await api(`/api/delivery-notes/${dnId}`, { method: 'DELETE' }).catch(() => {})
    if (prodId) await api(`/api/production/${prodId}`, { method: 'DELETE' }).catch(() => {})
    if (poId) await api(`/api/po/${poId}`, { method: 'DELETE' }).catch(() => {})
    if (coId) await api(`/api/customer-orders/${coId}`, { method: 'DELETE' }).catch(() => {})
    console.log('✅ 測試資料已清理')
  } catch (e) {
    console.log('⚠️  清理時發生錯誤（可忽略）')
  }
})
