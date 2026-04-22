'use client'

import { useEffect, useMemo, useState } from 'react'
import { API, apiFetch, getToken } from '@/lib/api'
import { usePagination, Pagination } from '@/lib/usePagination'
import { formatDateYMD, todayYMD } from '@/lib/datetime'
import { useDialog } from '@/components/Dialog'

type IntakeItem = {
  id: number
  progress_no: string
  customer_id: number | null
  customer_name: string
  order_id: number | null
  order_item_id: number | null
  po_number: string
  po_date?: string
  order_status?: string
  material_code: string
  material_name: string
  spec: string
  unit: string
  planned_qty: number
  purchased_qty: number
  purchase_gap_qty: number
  shipped_qty: number
  reconciled_qty: number
  pending_reconcile_qty: number
  fulfillment_rate: number
  reconcile_rate: number
  linked_po_count: number
  due_date?: string | null
  status: 'pending' | 'partial' | 'completed'
  remark?: string
}

type Customer = { id: number; customer_name: string }
type OrderSummary = { id: number; po_number: string; customer_id: number; customer_name?: string; status: string }
type OrderDetailItem = {
  id: number
  qty: number
  balance?: number
  product_sku?: string
  product_name?: string
  spec?: string
  unit?: string
}
type OrderDetail = { id: number; po_number: string; customer_id: number; customer_name?: string; items: OrderDetailItem[] }

type ProgressForm = {
  customerId: string
  customerName: string
  orderId: string
  orderPo: string
  orderItemId: string
  materialCode: string
  materialName: string
  spec: string
  unit: string
  plannedQty: string
  dueDate: string
  remark: string
}

const STATUS_LABEL: Record<string, string> = {
  pending: '待處理',
  partial: '部分完成',
  completed: '已完成',
}

const PROCUREMENT_LABEL: Record<string, string> = {
  pending: '待採購',
  partial: '部分已採購',
  procured: '已採購完成',
}

const emptyForm: ProgressForm = {
  customerId: '',
  customerName: '',
  orderId: '',
  orderPo: '',
  orderItemId: '',
  materialCode: '',
  materialName: '',
  spec: '',
  unit: 'PCS',
  plannedQty: '',
  dueDate: '',
  remark: '',
}

export default function OrderIntakePage() {
  const { notice, toast, confirm } = useDialog()
  const [rows, setRows] = useState<IntakeItem[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [orders, setOrders] = useState<OrderSummary[]>([])
  const [orderDetail, setOrderDetail] = useState<OrderDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [creatingId, setCreatingId] = useState<number | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [editing, setEditing] = useState<IntakeItem | null>(null)
  const [form, setForm] = useState<ProgressForm>(emptyForm)
  const [orderSearch, setOrderSearch] = useState('')

  const load = async (nextStatus = status) => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (search.trim()) params.set('search', search.trim())
      if (nextStatus) params.set('status', nextStatus)
      params.set('page_size', '1000')
      const data = await apiFetch<IntakeItem[]>(`/api/order-intake${params.toString() ? `?${params.toString()}` : ''}`)
      setRows(data)
    } catch (e: any) {
      toast(String(e?.message || '交貨進度載入失敗'), 'error')
    } finally {
      setLoading(false)
    }
  }

  const loadBaseOptions = async () => {
    try {
      const [customerRows, orderRows] = await Promise.all([
        apiFetch<Customer[]>('/api/customers'),
        apiFetch<OrderSummary[]>('/api/customer-orders'),
      ])
      setCustomers(customerRows || [])
      setOrders((orderRows || []).filter((it) => it.status !== 'completed'))
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    load('')
    loadBaseOptions()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const summary = useMemo(() => {
    const total = rows.length
    const open = rows.filter((r) => r.status !== 'completed').length
    return { total, open, completed: total - open }
  }, [rows])

  const { page, setPage, totalPages, paged, total } = usePagination(rows, 20)

  const exportCsv = async () => {
    try {
      const token = getToken()
      const res = await fetch(`${API}/api/order-intake/export/csv`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      if (!res.ok) throw new Error('匯出失敗')
      const csv = await res.text()
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `delivery_progress_${todayYMD()}.csv`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      toast('匯出失敗', 'error')
    }
  }

  const resetCreate = () => {
    setForm(emptyForm)
    setOrderDetail(null)
    setOrderSearch('')
  }

  const openCreate = () => {
    resetCreate()
    setShowCreate(true)
  }

  const onChangeOrder = async (orderId: string) => {
    setForm((prev) => ({ ...prev, orderId, orderItemId: '' }))
    setOrderDetail(null)
    if (!orderId) return
    try {
      const detail = await apiFetch<OrderDetail>(`/api/customer-orders/${orderId}`)
      setOrderDetail(detail)
      setForm((prev) => ({
        ...prev,
        customerId: String(detail.customer_id || prev.customerId || ''),
        customerName: detail.customer_name || prev.customerName,
        orderPo: detail.po_number || prev.orderPo,
      }))
    } catch (e: any) {
      toast(String(e?.message || '訂單明細載入失敗'), 'error')
    }
  }

  const onChangeOrderItem = (orderItemId: string) => {
    setForm((prev) => ({ ...prev, orderItemId }))
    if (!orderDetail || !orderItemId) return
    const item = (orderDetail.items || []).find((it) => String(it.id) === orderItemId)
    if (!item) return
    const defaultQty = Number(item.balance ?? item.qty ?? 0)
    setForm((prev) => ({
      ...prev,
      orderItemId,
      materialCode: item.product_sku || prev.materialCode,
      materialName: item.product_name || prev.materialName,
      spec: item.spec || prev.spec,
      unit: item.unit || prev.unit || 'PCS',
      plannedQty: defaultQty > 0 ? String(defaultQty) : prev.plannedQty,
    }))
  }

  const createProgress = async () => {
    const plannedQty = Number(form.plannedQty)
    if (!form.customerName.trim()) {
      toast('客戶名稱必填', 'error')
      return
    }
    if (!form.materialCode.trim()) {
      toast('料號必填', 'error')
      return
    }
    if (!Number.isFinite(plannedQty) || plannedQty <= 0) {
      toast('計畫數量需大於 0', 'error')
      return
    }
    try {
      await apiFetch('/api/order-intake', {
        method: 'POST',
        body: JSON.stringify({
          customer_id: form.customerId ? Number(form.customerId) : undefined,
          customer_name: form.customerName.trim(),
          customer_order_id: form.orderId ? Number(form.orderId) : undefined,
          order_item_id: form.orderItemId ? Number(form.orderItemId) : undefined,
          order_po_number: form.orderPo.trim() || undefined,
          material_code: form.materialCode.trim(),
          material_name: form.materialName.trim(),
          spec: form.spec.trim(),
          unit: form.unit.trim() || 'PCS',
          planned_qty: plannedQty,
          due_date: form.dueDate || undefined,
          remark: form.remark.trim(),
        }),
      })
      toast('交貨進度已建立')
      setShowCreate(false)
      resetCreate()
      await load(status)
    } catch (e: any) {
      toast(String(e?.message || '建立失敗'), 'error')
    }
  }

  const saveEdit = async () => {
    if (!editing) return
    const plannedQty = Number(form.plannedQty)
    if (!Number.isFinite(plannedQty) || plannedQty <= 0) {
      toast('計畫數量需大於 0', 'error')
      return
    }
    try {
      await apiFetch(`/api/order-intake/${editing.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          planned_qty: plannedQty,
          due_date: form.dueDate || undefined,
          remark: form.remark.trim(),
          status: editing.status,
          material_name: form.materialName.trim(),
          spec: form.spec.trim(),
          unit: form.unit.trim() || 'PCS',
        }),
      })
      toast('交貨進度已更新')
      setEditing(null)
      await load(status)
    } catch (e: any) {
      toast(String(e?.message || '更新失敗'), 'error')
    }
  }

  const removeProgress = async (row: IntakeItem) => {
    if (!(await confirm('確定刪除此交貨進度？', row.progress_no || '', '刪除'))) return
    try {
      await apiFetch(`/api/order-intake/${row.id}`, { method: 'DELETE' })
      toast('已刪除')
      await load(status)
    } catch (e: any) {
      toast(String(e?.message || '刪除失敗'), 'error')
    }
  }

  const startEdit = (row: IntakeItem) => {
    setEditing(row)
    setForm({
      customerId: row.customer_id ? String(row.customer_id) : '',
      customerName: row.customer_name || '',
      orderId: row.order_id ? String(row.order_id) : '',
      orderPo: row.po_number || '',
      orderItemId: row.order_item_id ? String(row.order_item_id) : '',
      materialCode: row.material_code || '',
      materialName: row.material_name || '',
      spec: row.spec || '',
      unit: row.unit || 'PCS',
      plannedQty: String(row.planned_qty || ''),
      dueDate: formatDateYMD(row.due_date) || '',
      remark: row.remark || '',
    })
  }

  const generatePo = async (id: number) => {
    if (creatingId) return
    setCreatingId(id)
    try {
      const res = await apiFetch<{ created: Array<{ id: number; po_number: string; supplier_name: string }>; count: number }>(`/api/order-intake/${id}/generate-po`, {
        method: 'POST',
      })
      const lines = (res.created || []).map((it) => `${it.po_number}（${it.supplier_name || '未指定供應商'}）`)
      notice(`已生成 ${res.count || lines.length} 張採購單`, '本次建立結果：', lines)
      await load(status)
    } catch (e: any) {
      toast(String(e?.message || '生成採購單失敗'), 'error')
    } finally {
      setCreatingId(null)
    }
  }

  const filteredOrders = useMemo(() => {
    const q = orderSearch.trim().toLowerCase()
    if (!q) return orders
    return orders.filter((o) => (o.po_number || '').toLowerCase().includes(q))
  }, [orders, orderSearch])

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-slate-800">交貨進度</h1>
          <p className="text-xs text-slate-500 mt-1">手動建立交貨進度，按進度生成採購單。</p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <button className="btn-ghost" onClick={exportCsv}>匯出 CSV</button>
          <button className="btn-primary" onClick={openCreate}>+ 建立新進度</button>
          <span className="badge-gray">總項目 {summary.total}</span>
          <span className="badge-yellow">待處理 {summary.open}</span>
          <span className="badge-green">已完成 {summary.completed}</span>
        </div>
      </div>

      <div className="rubber-card p-4 mb-4">
        <div className="grid md:grid-cols-5 gap-3">
          <input
            className="rubber-input md:col-span-3"
            placeholder="搜尋進度號、客戶、訂單號、料號、品名"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select className="rubber-input" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">全部狀態</option>
            <option value="open">進行中</option>
            <option value="completed">已完成</option>
          </select>
          <button className="btn-primary" onClick={() => { setPage(1); load(status) }}>查詢</button>
        </div>
      </div>

      <div className="rubber-card overflow-hidden">
        <div className="table-scroll-x">
          <table className="rubber-table" style={{ minWidth: 1320 }}>
            <thead>
              <tr>
                <th className="px-3 py-2 text-left">進度號</th>
                <th className="px-3 py-2 text-left">訂單 / 客戶</th>
                <th className="px-3 py-2 text-left">料件</th>
                <th className="px-3 py-2 text-right">計畫量</th>
                <th className="px-3 py-2 text-right">已採購</th>
                <th className="px-3 py-2 text-right">缺口</th>
                <th className="px-3 py-2 text-right">出貨 / 核對</th>
                <th className="px-3 py-2 text-left">到期日</th>
                <th className="px-3 py-2 text-left">狀態</th>
                <th className="px-3 py-2 text-left">操作</th>
              </tr>
            </thead>
            <tbody>
              {paged.map((r) => (
                <tr key={r.id} className="border-t border-slate-100">
                  <td className="px-3 py-2 align-top">
                    <div className="font-semibold text-slate-800">{r.progress_no}</div>
                    <div className="text-xs text-slate-500 mt-1">建立 {formatDateYMD(r.due_date || r.po_date) || '-'}</div>
                  </td>
                  <td className="px-3 py-2 align-top">
                    <div className="font-medium text-slate-800">{r.po_number || '-'}</div>
                    <div className="text-xs text-slate-500">{r.customer_name || '-'}</div>
                  </td>
                  <td className="px-3 py-2 align-top">
                    <div className="text-slate-800">{r.material_code || '-'} {r.material_name || ''}</div>
                    <div className="text-xs text-slate-500">{r.spec || '-'} / {r.unit || 'PCS'}</div>
                  </td>
                  <td className="px-3 py-2 text-right">{r.planned_qty}</td>
                  <td className="px-3 py-2 text-right">{r.purchased_qty}</td>
                  <td className="px-3 py-2 text-right font-semibold text-orange-700">{r.purchase_gap_qty}</td>
                  <td className="px-3 py-2 text-right">
                    <div>{r.shipped_qty} / {r.reconciled_qty}</div>
                    <div className="text-[11px] text-slate-500">{r.fulfillment_rate}% / {r.reconcile_rate}%</div>
                  </td>
                  <td className="px-3 py-2">{formatDateYMD(r.due_date) || '-'}</td>
                  <td className="px-3 py-2">
                    <span className={`inline-flex items-center px-2 py-1 rounded text-xs font-medium ${
                      r.status === 'completed'
                        ? 'bg-emerald-100 text-emerald-700'
                        : r.status === 'partial'
                          ? 'bg-amber-100 text-amber-700'
                          : 'bg-slate-100 text-slate-700'
                    }`}>
                      {STATUS_LABEL[r.status] || r.status}
                    </span>
                    <div className="text-[11px] text-slate-500 mt-1">
                      {PROCUREMENT_LABEL[r.purchase_gap_qty <= 0 ? 'procured' : r.purchased_qty > 0 ? 'partial' : 'pending']}
                    </div>
                  </td>
                  <td className="px-3 py-2 align-top min-w-[220px]">
                    <div className="flex flex-wrap gap-2">
                      <button className="btn-ghost text-xs" onClick={() => startEdit(r)}>編輯</button>
                      <button className="btn-ghost text-xs" onClick={() => removeProgress(r)}>刪除</button>
                      {r.purchase_gap_qty > 0 ? (
                        <button className="btn-primary text-xs" disabled={creatingId === r.id} onClick={() => generatePo(r.id)}>
                          {creatingId === r.id ? '生成中...' : '生成採購單'}
                        </button>
                      ) : (
                        <span className="text-xs text-slate-500">已無採購缺口</span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {!loading && paged.length === 0 && (
                <tr>
                  <td className="px-3 py-8 text-center text-slate-500" colSpan={10}>目前無資料</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {loading && <div className="text-xs text-slate-500 mt-3">載入中...</div>}
      {!loading && total > 0 && (
        <div className="mt-4">
          <Pagination page={page} totalPages={totalPages} setPage={setPage} total={total} pageSize={20} />
        </div>
      )}

      {showCreate && (
        <div className="fixed inset-0 z-[9998] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/35" onClick={() => setShowCreate(false)} />
          <div className="relative w-full max-w-4xl max-h-[90vh] overflow-auto rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-bold text-slate-800">建立交貨進度</h2>
              <button className="btn-ghost" onClick={() => setShowCreate(false)}>關閉</button>
            </div>
            <div className="grid md:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-slate-500 mb-1">客戶</label>
                <select className="rubber-input" value={form.customerId} onChange={(e) => {
                  const customerId = e.target.value
                  const name = customers.find((c) => String(c.id) === customerId)?.customer_name || form.customerName
                  setForm((prev) => ({ ...prev, customerId, customerName: name }))
                }}>
                  <option value="">-- 選填 --</option>
                  {customers.map((c) => (<option key={c.id} value={String(c.id)}>{c.customer_name}</option>))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">客戶名稱</label>
                <input className="rubber-input" value={form.customerName} onChange={(e) => setForm((prev) => ({ ...prev, customerName: e.target.value }))} />
              </div>

              <div>
                <label className="block text-xs text-slate-500 mb-1">訂單搜尋</label>
                <input className="rubber-input" placeholder="輸入 PO 編號" value={orderSearch} onChange={(e) => setOrderSearch(e.target.value)} />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">關聯客戶訂單（選填）</label>
                <select className="rubber-input" value={form.orderId} onChange={(e) => onChangeOrder(e.target.value)}>
                  <option value="">-- 無關聯 --</option>
                  {filteredOrders.slice(0, 200).map((o) => (
                    <option key={o.id} value={String(o.id)}>{o.po_number}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs text-slate-500 mb-1">訂單明細（選填）</label>
                <select className="rubber-input" value={form.orderItemId} onChange={(e) => onChangeOrderItem(e.target.value)} disabled={!orderDetail}>
                  <option value="">-- 無關聯 --</option>
                  {(orderDetail?.items || []).map((it) => (
                    <option key={it.id} value={String(it.id)}>
                      {it.product_sku || '-'} / {it.product_name || '-'} / 餘量 {Number(it.balance ?? it.qty ?? 0)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">訂單號</label>
                <input className="rubber-input" value={form.orderPo} onChange={(e) => setForm((prev) => ({ ...prev, orderPo: e.target.value }))} />
              </div>

              <div>
                <label className="block text-xs text-slate-500 mb-1">料號 *</label>
                <input className="rubber-input" value={form.materialCode} onChange={(e) => setForm((prev) => ({ ...prev, materialCode: e.target.value }))} />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">品名</label>
                <input className="rubber-input" value={form.materialName} onChange={(e) => setForm((prev) => ({ ...prev, materialName: e.target.value }))} />
              </div>

              <div>
                <label className="block text-xs text-slate-500 mb-1">規格</label>
                <input className="rubber-input" value={form.spec} onChange={(e) => setForm((prev) => ({ ...prev, spec: e.target.value }))} />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">單位</label>
                <input className="rubber-input" value={form.unit} onChange={(e) => setForm((prev) => ({ ...prev, unit: e.target.value }))} />
              </div>

              <div>
                <label className="block text-xs text-slate-500 mb-1">計畫數量 *</label>
                <input type="number" className="rubber-input" min={0} value={form.plannedQty} onChange={(e) => setForm((prev) => ({ ...prev, plannedQty: e.target.value }))} />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">到期日</label>
                <input type="date" className="rubber-input" value={form.dueDate} onChange={(e) => setForm((prev) => ({ ...prev, dueDate: e.target.value }))} />
              </div>
            </div>

            <div className="mt-3">
              <label className="block text-xs text-slate-500 mb-1">備註</label>
              <textarea className="rubber-input" rows={3} value={form.remark} onChange={(e) => setForm((prev) => ({ ...prev, remark: e.target.value }))} />
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button className="btn-ghost" onClick={() => setShowCreate(false)}>取消</button>
              <button className="btn-primary" onClick={createProgress}>建立</button>
            </div>
          </div>
        </div>
      )}

      {editing && (
        <div className="fixed inset-0 z-[9998] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/35" onClick={() => setEditing(null)} />
          <div className="relative w-full max-w-2xl rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-bold text-slate-800">編輯交貨進度 {editing.progress_no}</h2>
              <button className="btn-ghost" onClick={() => setEditing(null)}>關閉</button>
            </div>

            <div className="grid md:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-slate-500 mb-1">料號</label>
                <input className="rubber-input" value={form.materialCode} disabled />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">品名</label>
                <input className="rubber-input" value={form.materialName} onChange={(e) => setForm((prev) => ({ ...prev, materialName: e.target.value }))} />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">規格</label>
                <input className="rubber-input" value={form.spec} onChange={(e) => setForm((prev) => ({ ...prev, spec: e.target.value }))} />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">單位</label>
                <input className="rubber-input" value={form.unit} onChange={(e) => setForm((prev) => ({ ...prev, unit: e.target.value }))} />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">計畫數量</label>
                <input type="number" className="rubber-input" min={0} value={form.plannedQty} onChange={(e) => setForm((prev) => ({ ...prev, plannedQty: e.target.value }))} />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">到期日</label>
                <input type="date" className="rubber-input" value={form.dueDate} onChange={(e) => setForm((prev) => ({ ...prev, dueDate: e.target.value }))} />
              </div>
            </div>

            <div className="mt-3">
              <label className="block text-xs text-slate-500 mb-1">備註</label>
              <textarea className="rubber-input" rows={3} value={form.remark} onChange={(e) => setForm((prev) => ({ ...prev, remark: e.target.value }))} />
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button className="btn-ghost" onClick={() => setEditing(null)}>取消</button>
              <button className="btn-primary" onClick={saveEdit}>儲存</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
