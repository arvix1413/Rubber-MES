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
  po_number: string
  material_name: string
  planned_qty: number
  purchased_qty: number
  purchase_gap_qty: number
  linked_po_count: number
  item_count: number
  due_date?: string | null
  status: 'pending' | 'partial' | 'completed'
  remark?: string
}

type ProgressItem = {
  id?: number
  material_code?: string
  material_name: string
  spec?: string
  unit?: string
  planned_qty: number
  purchased_qty?: number
  purchase_gap_qty?: number
  due_date?: string | null
  status?: 'pending' | 'partial' | 'completed'
  remark?: string
}

type ProgressDetail = IntakeItem & {
  po_numbers?: string[]
  customer_order_ids?: number[]
  items: ProgressItem[]
}

type Customer = { id: number; customer_name: string; address?: string }
type OrderSummary = { id: number; po_number: string; customer_id: number; customer_name?: string; status: string }

type LineForm = {
  key: string
  material_name: string
  planned_qty: string
  due_date: string
  remark: string
}

type CreateForm = {
  customerId: string
  customerName: string
  poInput: string
  linkedOrderIds: number[]
  remark: string
  lines: LineForm[]
}

type EditForm = {
  poInput: string
  linkedOrderIds: number[]
  remark: string
  status: 'pending' | 'partial' | 'completed'
  lines: LineForm[]
}

const STATUS_LABEL: Record<string, string> = {
  pending: '待處理',
  partial: '部分完成',
  completed: '已完成',
}

const createEmptyLine = (seed: number): LineForm => ({
  key: `line-${seed}`,
  material_name: '',
  planned_qty: '',
  due_date: '',
  remark: '',
})

const createEmptyForm = (): CreateForm => ({
  customerId: '',
  customerName: '',
  poInput: '',
  linkedOrderIds: [],
  remark: '',
  lines: [createEmptyLine(1)],
})

const splitPoValues = (input: string): string[] => Array.from(new Set(
  String(input || '')
    .split(/[\n,，;；]+/)
    .map((it) => it.trim())
    .filter(Boolean),
))

const statusBadgeClass = (status: string) => {
  if (status === 'completed') return 'bg-emerald-100 text-emerald-700'
  if (status === 'partial') return 'bg-amber-100 text-amber-700'
  return 'bg-slate-100 text-slate-700'
}

export default function OrderIntakePage() {
  const { notice, toast, confirm } = useDialog()
  const [rows, setRows] = useState<IntakeItem[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [orders, setOrders] = useState<OrderSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [creatingId, setCreatingId] = useState<number | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [createForm, setCreateForm] = useState<CreateForm>(createEmptyForm())
  const [createLineSeed, setCreateLineSeed] = useState(2)
  const [createOrderToAdd, setCreateOrderToAdd] = useState('')
  const [editing, setEditing] = useState<ProgressDetail | null>(null)
  const [editForm, setEditForm] = useState<EditForm | null>(null)
  const [editLineSeed, setEditLineSeed] = useState(1000)
  const [editOrderToAdd, setEditOrderToAdd] = useState('')
  const [editLoading, setEditLoading] = useState(false)

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

  const createLinkedOrders = useMemo(
    () => orders.filter((order) => createForm.linkedOrderIds.includes(order.id)),
    [orders, createForm.linkedOrderIds],
  )

  const createOrderOptions = useMemo(() => {
    const selectedId = createForm.customerId ? Number(createForm.customerId) : 0
    return orders.filter((order) => {
      if (createForm.linkedOrderIds.includes(order.id)) return false
      if (!selectedId) return true
      return Number(order.customer_id || 0) === selectedId
    })
  }, [orders, createForm.customerId, createForm.linkedOrderIds])

  const editLinkedOrders = useMemo(() => {
    if (!editForm) return []
    return orders.filter((order) => editForm.linkedOrderIds.includes(order.id))
  }, [orders, editForm])

  const editOrderOptions = useMemo(() => {
    if (!editForm || !editing) return []
    return orders.filter((order) => {
      if (editForm.linkedOrderIds.includes(order.id)) return false
      if (!editing.customer_id) return true
      return Number(order.customer_id || 0) === Number(editing.customer_id)
    })
  }, [orders, editForm, editing])

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
    setCreateForm(createEmptyForm())
    setCreateLineSeed(2)
    setCreateOrderToAdd('')
  }

  const openCreate = () => {
    resetCreate()
    setShowCreate(true)
  }

  const closeCreate = () => {
    setShowCreate(false)
    resetCreate()
  }

  const updateCreateForm = (patch: Partial<CreateForm>) => {
    setCreateForm((prev) => ({ ...prev, ...patch }))
  }

  const updateCreateLine = (key: string, patch: Partial<LineForm>) => {
    setCreateForm((prev) => ({
      ...prev,
      lines: prev.lines.map((line) => (line.key === key ? { ...line, ...patch } : line)),
    }))
  }

  const addCreateLine = () => {
    setCreateForm((prev) => ({ ...prev, lines: [...prev.lines, createEmptyLine(createLineSeed)] }))
    setCreateLineSeed((prev) => prev + 1)
  }

  const removeCreateLine = (key: string) => {
    setCreateForm((prev) => {
      if (prev.lines.length <= 1) return { ...prev, lines: [createEmptyLine(createLineSeed)] }
      return { ...prev, lines: prev.lines.filter((line) => line.key !== key) }
    })
    setCreateLineSeed((prev) => prev + 1)
  }

  const addCreateLinkedOrder = () => {
    const orderId = Number(createOrderToAdd || 0)
    if (!orderId) return
    const order = orders.find((it) => it.id === orderId)
    if (!order) return
    setCreateForm((prev) => ({
      ...prev,
      customerId: prev.customerId || String(order.customer_id || ''),
      customerName: prev.customerName || order.customer_name || '',
      linkedOrderIds: prev.linkedOrderIds.includes(orderId) ? prev.linkedOrderIds : [...prev.linkedOrderIds, orderId],
      poInput: splitPoValues(`${prev.poInput}\n${order.po_number || ''}`).join('\n'),
    }))
    setCreateOrderToAdd('')
  }

  const removeCreateLinkedOrder = (orderId: number) => {
    setCreateForm((prev) => ({
      ...prev,
      linkedOrderIds: prev.linkedOrderIds.filter((id) => id !== orderId),
    }))
  }

  const createProgress = async () => {
    const poNumbers = splitPoValues(createForm.poInput)
    const selectedCustomer = customers.find((c) => String(c.id) === createForm.customerId)
    const customerName = (selectedCustomer?.customer_name || createForm.customerName || '').trim()
    if (!customerName) {
      toast('請先選擇客戶', 'error')
      return
    }
    if (poNumbers.length <= 0 && createForm.linkedOrderIds.length <= 0) {
      toast('請至少輸入一個 PO 編號或關聯一張客戶訂單', 'error')
      return
    }

    const lines = createForm.lines
      .map((line) => ({
        material_name: line.material_name.trim(),
        planned_qty: Number(line.planned_qty),
        due_date: line.due_date || undefined,
        remark: line.remark.trim(),
      }))
      .filter((line) => line.material_name || line.planned_qty || line.due_date || line.remark)

    if (!lines.length) {
      toast('請至少新增一筆交貨明細', 'error')
      return
    }
    for (const line of lines) {
      if (!line.material_name) {
        toast('材料名稱不可空白', 'error')
        return
      }
      if (!Number.isFinite(line.planned_qty) || line.planned_qty <= 0) {
        toast(`材料 ${line.material_name} 的數量需大於 0`, 'error')
        return
      }
    }

    try {
      await apiFetch('/api/order-intake', {
        method: 'POST',
        body: JSON.stringify({
          customer_id: createForm.customerId ? Number(createForm.customerId) : undefined,
          customer_name: customerName,
          po_numbers: poNumbers,
          customer_order_ids: createForm.linkedOrderIds,
          remark: createForm.remark.trim(),
          items: lines,
        }),
      })
      toast(`交貨進度已建立，共 ${lines.length} 筆明細`)
      closeCreate()
      await load(status)
    } catch (e: any) {
      toast(String(e?.message || '建立失敗'), 'error')
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

  const startEdit = async (row: IntakeItem) => {
    setEditLoading(true)
    try {
      const detail = await apiFetch<ProgressDetail>(`/api/order-intake/${row.id}`)
      setEditing(detail)
      setEditForm({
        poInput: (detail.po_numbers || []).join('\n'),
        linkedOrderIds: detail.customer_order_ids || [],
        remark: detail.remark || '',
        status: detail.status || 'pending',
        lines: (detail.items || []).map((item, index) => ({
          key: `edit-${item.id || index}`,
          material_name: item.material_name || '',
          planned_qty: String(item.planned_qty || ''),
          due_date: formatDateYMD(item.due_date) || '',
          remark: item.remark || '',
        })),
      })
      setEditLineSeed(2000)
      setEditOrderToAdd('')
    } catch (e: any) {
      toast(String(e?.message || '交貨進度詳情載入失敗'), 'error')
    } finally {
      setEditLoading(false)
    }
  }

  const closeEdit = () => {
    setEditing(null)
    setEditForm(null)
    setEditOrderToAdd('')
  }

  const updateEditLine = (key: string, patch: Partial<LineForm>) => {
    if (!editForm) return
    setEditForm({
      ...editForm,
      lines: editForm.lines.map((line) => (line.key === key ? { ...line, ...patch } : line)),
    })
  }

  const addEditLine = () => {
    if (!editForm) return
    setEditForm({ ...editForm, lines: [...editForm.lines, createEmptyLine(editLineSeed)] })
    setEditLineSeed((prev) => prev + 1)
  }

  const removeEditLine = (key: string) => {
    if (!editForm) return
    setEditForm({
      ...editForm,
      lines: editForm.lines.length <= 1 ? [createEmptyLine(editLineSeed)] : editForm.lines.filter((line) => line.key !== key),
    })
    setEditLineSeed((prev) => prev + 1)
  }

  const addEditLinkedOrder = () => {
    if (!editForm) return
    const orderId = Number(editOrderToAdd || 0)
    if (!orderId) return
    const order = orders.find((it) => it.id === orderId)
    if (!order) return
    setEditForm({
      ...editForm,
      linkedOrderIds: editForm.linkedOrderIds.includes(orderId) ? editForm.linkedOrderIds : [...editForm.linkedOrderIds, orderId],
      poInput: splitPoValues(`${editForm.poInput}\n${order.po_number || ''}`).join('\n'),
    })
    setEditOrderToAdd('')
  }

  const removeEditLinkedOrder = (orderId: number) => {
    if (!editForm) return
    setEditForm({
      ...editForm,
      linkedOrderIds: editForm.linkedOrderIds.filter((id) => id !== orderId),
    })
  }

  const saveEdit = async () => {
    if (!editing || !editForm) return
    const items = editForm.lines
      .map((line) => ({
        material_name: line.material_name.trim(),
        planned_qty: Number(line.planned_qty),
        due_date: line.due_date || undefined,
        remark: line.remark.trim(),
      }))
      .filter((line) => line.material_name || line.planned_qty || line.due_date || line.remark)

    if (!items.length) {
      toast('請至少保留一筆交貨明細', 'error')
      return
    }
    for (const item of items) {
      if (!item.material_name) {
        toast('材料名稱不可空白', 'error')
        return
      }
      if (!Number.isFinite(item.planned_qty) || item.planned_qty <= 0) {
        toast(`材料 ${item.material_name} 的數量需大於 0`, 'error')
        return
      }
    }

    try {
      await apiFetch(`/api/order-intake/${editing.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          po_numbers: splitPoValues(editForm.poInput),
          customer_order_ids: editForm.linkedOrderIds,
          remark: editForm.remark.trim(),
          status: editForm.status,
          items,
        }),
      })
      toast('交貨進度已更新')
      closeEdit()
      await load(status)
    } catch (e: any) {
      toast(String(e?.message || '更新失敗'), 'error')
    }
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

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-800">交貨進度</h1>
          <p className="mt-1 text-xs text-slate-500">一個交貨進度可包含多筆訂單、多個 PO No，以及多筆交貨明細。</p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <button className="btn-ghost" onClick={exportCsv}>匯出 CSV</button>
          <button className="btn-primary" onClick={openCreate}>+ 建立交貨進度</button>
          <span className="badge-gray">總進度 {summary.total}</span>
          <span className="badge-yellow">進行中 {summary.open}</span>
          <span className="badge-green">已完成 {summary.completed}</span>
        </div>
      </div>

      <div className="rubber-card mb-4 p-4">
        <div className="grid gap-3 md:grid-cols-5">
          <input
            className="rubber-input md:col-span-3"
            placeholder="搜尋進度號、客戶、PO 編號、材料摘要"
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
          <table className="rubber-table" style={{ minWidth: 1260 }}>
            <thead>
              <tr>
                <th className="px-3 py-2 text-left">進度單</th>
                <th className="px-3 py-2 text-left">客戶</th>
                <th className="px-3 py-2 text-left">PO 編號</th>
                <th className="px-3 py-2 text-left">明細摘要</th>
                <th className="px-3 py-2 text-right">總數量</th>
                <th className="px-3 py-2 text-left">交期</th>
                <th className="px-3 py-2 text-left">狀態</th>
                <th className="px-3 py-2 text-left">操作</th>
              </tr>
            </thead>
            <tbody>
              {paged.map((r) => (
                <tr key={r.id} className="border-t border-slate-100">
                  <td className="px-3 py-2 align-top">
                    <div className="font-medium text-slate-800">{r.progress_no}</div>
                    <div className="mt-1 text-xs text-slate-500">{r.item_count} 筆明細</div>
                  </td>
                  <td className="px-3 py-2 align-top">{r.customer_name || '-'}</td>
                  <td className="px-3 py-2 align-top">
                    <div className="whitespace-pre-wrap break-words">{r.po_number || '-'}</div>
                    <div className="mt-1 text-xs text-slate-500">共 {r.linked_po_count} 個 PO</div>
                  </td>
                  <td className="px-3 py-2 align-top">
                    <div className="max-w-[280px] whitespace-pre-wrap break-words">{r.material_name || '-'}</div>
                  </td>
                  <td className="px-3 py-2 text-right">{r.planned_qty}</td>
                  <td className="px-3 py-2">{formatDateYMD(r.due_date) || '-'}</td>
                  <td className="px-3 py-2">
                    <span className={`inline-flex items-center rounded px-2 py-1 text-xs font-medium ${statusBadgeClass(r.status)}`}>
                      {STATUS_LABEL[r.status] || r.status}
                    </span>
                  </td>
                  <td className="min-w-[220px] px-3 py-2 align-top">
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
                  <td className="px-3 py-8 text-center text-slate-500" colSpan={8}>目前無資料</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {loading && <div className="mt-3 text-xs text-slate-500">載入中...</div>}
      {!loading && total > 0 && (
        <div className="mt-4">
          <Pagination page={page} totalPages={totalPages} setPage={setPage} total={total} pageSize={20} />
        </div>
      )}

      {showCreate && (
        <div className="fixed inset-0 z-[9998] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/35" onClick={closeCreate} />
          <div className="relative max-h-[90vh] w-full max-w-5xl overflow-auto rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-base font-bold text-slate-800">建立交貨進度</h2>
              <button className="btn-ghost" onClick={closeCreate}>關閉</button>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs text-slate-500">客戶</label>
                <select
                  className="rubber-input"
                  value={createForm.customerId}
                  onChange={(e) => {
                    const customerId = e.target.value
                    const customer = customers.find((c) => String(c.id) === customerId)
                    updateCreateForm({
                      customerId,
                      customerName: customer?.customer_name || '',
                      linkedOrderIds: customerId
                        ? createForm.linkedOrderIds.filter((id) => Number(orders.find((o) => o.id === id)?.customer_id || 0) === Number(customerId))
                        : createForm.linkedOrderIds,
                    })
                    setCreateOrderToAdd('')
                  }}
                >
                  <option value="">-- 請選擇客戶 --</option>
                  {customers.map((c) => (
                    <option key={c.id} value={String(c.id)}>{c.customer_name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1 block text-xs text-slate-500">關聯客戶訂單（選填，可多張）</label>
                <div className="flex gap-2">
                  <select className="rubber-input" value={createOrderToAdd} onChange={(e) => setCreateOrderToAdd(e.target.value)}>
                    <option value="">-- 選擇訂單 --</option>
                    {createOrderOptions.map((o) => (
                      <option key={o.id} value={String(o.id)}>{o.po_number} {o.customer_name ? `/${o.customer_name}` : ''}</option>
                    ))}
                  </select>
                  <button type="button" className="btn-ghost whitespace-nowrap" onClick={addCreateLinkedOrder}>加入</button>
                </div>
                {createLinkedOrders.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {createLinkedOrders.map((order) => (
                      <span key={order.id} className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-700">
                        {order.po_number}
                        <button type="button" className="text-slate-500 hover:text-red-600" onClick={() => removeCreateLinkedOrder(order.id)}>×</button>
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <div className="md:col-span-2">
                <label className="mb-1 block text-xs text-slate-500">PO 編號（可多個，逗號或換行分隔）</label>
                <textarea
                  className="rubber-input"
                  rows={3}
                  value={createForm.poInput}
                  onChange={(e) => updateCreateForm({ poInput: e.target.value })}
                  placeholder={'例如：\nPO-001\nPO-002\nPO-003'}
                />
                <p className="mt-1 text-xs text-slate-400">已解析 {splitPoValues(createForm.poInput).length} 個 PO</p>
              </div>
            </div>

            <div className="mt-5">
              <div className="mb-2 flex items-center justify-between">
                <label className="block text-xs text-slate-500">交貨明細</label>
                <button type="button" className="btn-ghost text-xs" onClick={addCreateLine}>+ 新增明細</button>
              </div>
              <div className="overflow-hidden rounded-lg border border-slate-200">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50">
                      <th className="px-3 py-2 text-left">材料名稱</th>
                      <th className="px-3 py-2 text-right">數量</th>
                      <th className="px-3 py-2 text-left">交期</th>
                      <th className="px-3 py-2 text-left">備註</th>
                      <th className="px-3 py-2 text-left">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {createForm.lines.map((line) => (
                      <tr key={line.key} className="border-b border-slate-100 last:border-0">
                        <td className="px-3 py-2">
                          <input className="rubber-input h-9" value={line.material_name} onChange={(e) => updateCreateLine(line.key, { material_name: e.target.value })} placeholder="輸入材料名稱" />
                        </td>
                        <td className="px-3 py-2">
                          <input type="number" min={0} className="rubber-input h-9 text-right" value={line.planned_qty} onChange={(e) => updateCreateLine(line.key, { planned_qty: e.target.value })} />
                        </td>
                        <td className="px-3 py-2">
                          <input type="date" className="rubber-input h-9" value={line.due_date} onChange={(e) => updateCreateLine(line.key, { due_date: e.target.value })} />
                        </td>
                        <td className="px-3 py-2">
                          <input className="rubber-input h-9" value={line.remark} onChange={(e) => updateCreateLine(line.key, { remark: e.target.value })} />
                        </td>
                        <td className="px-3 py-2">
                          <button type="button" className="btn-ghost text-xs" onClick={() => removeCreateLine(line.key)}>刪除</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="mt-4">
              <label className="mb-1 block text-xs text-slate-500">主單備註</label>
              <textarea className="rubber-input" rows={3} value={createForm.remark} onChange={(e) => updateCreateForm({ remark: e.target.value })} />
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button className="btn-ghost" onClick={closeCreate}>取消</button>
              <button className="btn-primary" onClick={createProgress}>建立</button>
            </div>
          </div>
        </div>
      )}

      {(editing || editLoading) && (
        <div className="fixed inset-0 z-[9998] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/35" onClick={closeEdit} />
          <div className="relative max-h-[90vh] w-full max-w-5xl overflow-auto rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl">
            {editLoading || !editing || !editForm ? (
              <div className="py-10 text-center text-sm text-slate-500">載入中...</div>
            ) : (
              <>
                <div className="mb-4 flex items-center justify-between">
                  <div>
                    <h2 className="text-base font-bold text-slate-800">編輯交貨進度 {editing.progress_no}</h2>
                    <p className="mt-1 text-xs text-slate-500">{editing.customer_name || '-'} / {editing.item_count} 筆明細 / {editing.linked_po_count} 個 PO</p>
                  </div>
                  <button className="btn-ghost" onClick={closeEdit}>關閉</button>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="md:col-span-2">
                    <label className="mb-1 block text-xs text-slate-500">PO 編號（可多個）</label>
                    <textarea className="rubber-input" rows={3} value={editForm.poInput} onChange={(e) => setEditForm({ ...editForm, poInput: e.target.value })} />
                  </div>

                  <div className="md:col-span-2">
                    <label className="mb-1 block text-xs text-slate-500">關聯客戶訂單（選填）</label>
                    <div className="flex gap-2">
                      <select className="rubber-input" value={editOrderToAdd} onChange={(e) => setEditOrderToAdd(e.target.value)}>
                        <option value="">-- 選擇訂單 --</option>
                        {editOrderOptions.map((o) => (
                          <option key={o.id} value={String(o.id)}>{o.po_number}</option>
                        ))}
                      </select>
                      <button type="button" className="btn-ghost whitespace-nowrap" onClick={addEditLinkedOrder}>加入</button>
                    </div>
                    {editLinkedOrders.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {editLinkedOrders.map((order) => (
                          <span key={order.id} className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-700">
                            {order.po_number}
                            <button type="button" className="text-slate-500 hover:text-red-600" onClick={() => removeEditLinkedOrder(order.id)}>×</button>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  <div>
                    <label className="mb-1 block text-xs text-slate-500">狀態</label>
                    <select className="rubber-input" value={editForm.status} onChange={(e) => setEditForm({ ...editForm, status: e.target.value as EditForm['status'] })}>
                      <option value="pending">待處理</option>
                      <option value="partial">部分完成</option>
                      <option value="completed">已完成</option>
                    </select>
                  </div>
                </div>

                <div className="mt-5">
                  <div className="mb-2 flex items-center justify-between">
                    <label className="block text-xs text-slate-500">交貨明細</label>
                    <button type="button" className="btn-ghost text-xs" onClick={addEditLine}>+ 新增明細</button>
                  </div>
                  <div className="overflow-hidden rounded-lg border border-slate-200">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-slate-200 bg-slate-50">
                          <th className="px-3 py-2 text-left">材料名稱</th>
                          <th className="px-3 py-2 text-right">數量</th>
                          <th className="px-3 py-2 text-right">已採購</th>
                          <th className="px-3 py-2 text-right">缺口</th>
                          <th className="px-3 py-2 text-left">交期</th>
                          <th className="px-3 py-2 text-left">備註</th>
                          <th className="px-3 py-2 text-left">操作</th>
                        </tr>
                      </thead>
                      <tbody>
                        {editForm.lines.map((line, idx) => {
                          const source = editing.items[idx]
                          return (
                            <tr key={line.key} className="border-b border-slate-100 last:border-0">
                              <td className="px-3 py-2">
                                <input className="rubber-input h-9" value={line.material_name} onChange={(e) => updateEditLine(line.key, { material_name: e.target.value })} />
                              </td>
                              <td className="px-3 py-2">
                                <input type="number" min={0} className="rubber-input h-9 text-right" value={line.planned_qty} onChange={(e) => updateEditLine(line.key, { planned_qty: e.target.value })} />
                              </td>
                              <td className="px-3 py-2 text-right text-slate-500">{source?.purchased_qty ?? 0}</td>
                              <td className="px-3 py-2 text-right text-amber-600">{source?.purchase_gap_qty ?? Math.max(0, Number(line.planned_qty || 0))}</td>
                              <td className="px-3 py-2">
                                <input type="date" className="rubber-input h-9" value={line.due_date} onChange={(e) => updateEditLine(line.key, { due_date: e.target.value })} />
                              </td>
                              <td className="px-3 py-2">
                                <input className="rubber-input h-9" value={line.remark} onChange={(e) => updateEditLine(line.key, { remark: e.target.value })} />
                              </td>
                              <td className="px-3 py-2">
                                <button type="button" className="btn-ghost text-xs" onClick={() => removeEditLine(line.key)}>刪除</button>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="mt-4">
                  <label className="mb-1 block text-xs text-slate-500">主單備註</label>
                  <textarea className="rubber-input" rows={3} value={editForm.remark} onChange={(e) => setEditForm({ ...editForm, remark: e.target.value })} />
                </div>

                <div className="mt-5 flex justify-end gap-2">
                  <button className="btn-ghost" onClick={closeEdit}>取消</button>
                  <button className="btn-primary" onClick={saveEdit}>儲存</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
