'use client'

import { useEffect, useMemo, useState } from 'react'
import { API, apiFetch, getToken } from '@/lib/api'
import { usePagination, Pagination } from '@/lib/usePagination'
import { formatDateYMD, todayYMD } from '@/lib/datetime'
import { useDialog } from '@/components/Dialog'
import { SearchableSelect } from '@/components/SearchableSelect'

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
  order_count?: number
  linked_po_count: number
  item_count: number
  due_date?: string | null
  status: 'pending' | 'partial' | 'completed'
  remark?: string
}

type ProgressItem = {
  id?: number
  order_po_number?: string
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
  materialOptionId: string
  orderPoNumber: string
  material_code: string
  material_name: string
  spec: string
  unit: string
  planned_qty: string
  remark: string
}

type OrderMaterialOption = {
  id: string
  material_id?: number | null
  material_code: string
  material_name: string
  spec: string
  unit: string
  suggested_qty: number
  due_date?: string | null
  order_po_numbers: string[]
  customer_po_numbers: string[]
  bom_skus: string[]
  bom_names: string[]
  order_item_count: number
}

type CreateForm = {
  customerId: string
  customerName: string
  dueDate: string
  linkedOrderIds: number[]
  remark: string
  lines: LineForm[]
}

type EditForm = {
  dueDate: string
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
  materialOptionId: '',
  orderPoNumber: '',
  material_code: '',
  material_name: '',
  spec: '',
  unit: 'PCS',
  planned_qty: '',
  remark: '',
})

const createEmptyForm = (): CreateForm => ({
  customerId: '',
  customerName: '',
  dueDate: '',
  linkedOrderIds: [],
  remark: '',
  lines: [createEmptyLine(1)],
})

const normalizeYmdInput = (value: string) => {
  const text = String(value || '').trim()
  if (!text) return ''
  const m = text.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  const dmy = text.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  if (dmy) return `${dmy[3]}-${dmy[2]}-${dmy[1]}`
  return text
}

const summarizeTokens = (input: string, limit: number) => {
  const values = Array.from(new Set(
    String(input || '')
      .split(/[\n,，;；]+/)
      .map((it) => it.trim())
      .filter(Boolean),
  ))
  if (!values.length) return { text: '未整理', hidden: 0 }
  const shown = values.slice(0, limit)
  return {
    text: shown.join(', '),
    hidden: Math.max(0, values.length - shown.length),
  }
}

const summarizeItems = (input: string, limit: number) => {
  const values = String(input || '')
    .split(',')
    .map((it) => it.trim())
    .filter(Boolean)
  if (!values.length) return { text: '-', hidden: 0 }
  const shown = values.slice(0, limit)
  return {
    text: shown.join(', '),
    hidden: Math.max(0, values.length - shown.length),
  }
}

const filterOrdersByKeyword = (rows: OrderSummary[], keyword: string) => {
  const search = keyword.trim().toLowerCase()
  if (!search) return rows
  return rows.filter((order) => {
    const text = [
      order.po_number,
      order.customer_name || '',
      order.status || '',
    ].join(' ').toLowerCase()
    return text.includes(search)
  })
}

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
  const [createOrderSearch, setCreateOrderSearch] = useState('')
  const [createMaterialOptions, setCreateMaterialOptions] = useState<OrderMaterialOption[]>([])
  const [createMaterialLoading, setCreateMaterialLoading] = useState(false)
  const [editing, setEditing] = useState<ProgressDetail | null>(null)
  const [editForm, setEditForm] = useState<EditForm | null>(null)
  const [editLineSeed, setEditLineSeed] = useState(1000)
  const [editOrderSearch, setEditOrderSearch] = useState('')
  const [editMaterialOptions, setEditMaterialOptions] = useState<OrderMaterialOption[]>([])
  const [editMaterialLoading, setEditMaterialLoading] = useState(false)
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
      toast(String(e?.message || '交期進度載入失敗'), 'error')
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

  const fetchOrderMaterialOptions = async (orderIds: number[]) => {
    if (!orderIds.length) return []
    return apiFetch<OrderMaterialOption[]>(`/api/customer-orders/material-options?order_ids=${orderIds.join(',')}`)
  }

  useEffect(() => {
    let cancelled = false
    if (!createForm.linkedOrderIds.length) {
      setCreateMaterialOptions([])
      return
    }
    setCreateMaterialLoading(true)
    fetchOrderMaterialOptions(createForm.linkedOrderIds)
      .then((rows) => {
        if (!cancelled) setCreateMaterialOptions(rows || [])
      })
      .catch(() => {
        if (!cancelled) setCreateMaterialOptions([])
      })
      .finally(() => {
        if (!cancelled) setCreateMaterialLoading(false)
      })
    return () => { cancelled = true }
  }, [createForm.linkedOrderIds])

  useEffect(() => {
    let cancelled = false
    if (!editForm?.linkedOrderIds.length) {
      setEditMaterialOptions([])
      return
    }
    setEditMaterialLoading(true)
    fetchOrderMaterialOptions(editForm.linkedOrderIds)
      .then((rows) => {
        if (!cancelled) setEditMaterialOptions(rows || [])
      })
      .catch(() => {
        if (!cancelled) setEditMaterialOptions([])
      })
      .finally(() => {
        if (!cancelled) setEditMaterialLoading(false)
      })
    return () => { cancelled = true }
  }, [editForm?.linkedOrderIds])

  useEffect(() => {
    if (!editForm || !editMaterialOptions.length) return
    const nextLines = editForm.lines.map((line) => {
      if (line.materialOptionId) return line
      const matched = editMaterialOptions.find((option) =>
        option.material_code === line.material_code &&
        option.material_name === line.material_name &&
        option.spec === line.spec &&
        option.unit === line.unit,
      )
      return matched ? { ...line, materialOptionId: matched.id } : line
    })
    const changed = nextLines.some((line, idx) => line.materialOptionId !== editForm.lines[idx].materialOptionId)
    if (changed) setEditForm({ ...editForm, lines: nextLines })
  }, [editForm, editMaterialOptions])

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

  const createLockedCustomerId = useMemo(() => {
    const first = createLinkedOrders[0]
    const customerId = Number(first?.customer_id || 0)
    return customerId > 0 ? customerId : 0
  }, [createLinkedOrders])

  const createOrderOptions = useMemo(() => {
    const selectedId = createLockedCustomerId || (createForm.customerId ? Number(createForm.customerId) : 0)
    const filtered = orders.filter((order) => {
      if (!selectedId) return true
      return Number(order.customer_id || 0) === selectedId
    })
    return filterOrdersByKeyword(filtered, createOrderSearch)
  }, [orders, createForm.customerId, createLockedCustomerId, createOrderSearch])

  const editLinkedOrders = useMemo(() => {
    if (!editForm) return []
    return orders.filter((order) => editForm.linkedOrderIds.includes(order.id))
  }, [orders, editForm])

  const editOrderOptions = useMemo(() => {
    if (!editForm || !editing) return []
    const filtered = orders.filter((order) => {
      if (!editing.customer_id) return true
      return Number(order.customer_id || 0) === Number(editing.customer_id)
    })
    return filterOrdersByKeyword(filtered, editOrderSearch)
  }, [orders, editForm, editing, editOrderSearch])

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
    setCreateOrderSearch('')
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

  const formatMaterialOption = (option: OrderMaterialOption) => {
    const code = option.material_code ? `${option.material_code} ` : ''
    const spec = option.spec ? ` / ${option.spec}` : ''
    const bom = option.bom_skus.length ? ` / BOM ${option.bom_skus.join(', ')}` : ''
    const po = option.order_po_numbers.length ? ` / 訂單 ${option.order_po_numbers.join(', ')}` : ''
    return `${code}${option.material_name}${spec}${bom}${po}`
  }

  const filterMaterialOption = (option: OrderMaterialOption, search: string) => {
    const text = [
      option.material_code,
      option.material_name,
      option.spec,
      option.unit,
      ...option.order_po_numbers,
      ...option.customer_po_numbers,
      ...option.bom_skus,
      ...option.bom_names,
    ].join(' ').toLowerCase()
    return text.includes(search)
  }

  const applyMaterialOption = (option: OrderMaterialOption, line: LineForm): Partial<LineForm> => ({
    materialOptionId: option.id,
    orderPoNumber: option.customer_po_numbers[0] || option.order_po_numbers[0] || line.orderPoNumber,
  material_code: option.material_code,
  material_name: option.material_name,
  spec: option.spec,
  unit: option.unit || 'PCS',
  planned_qty: option.suggested_qty > 0 ? String(option.suggested_qty) : line.planned_qty,
})

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

  const toggleCreateLinkedOrder = (orderId: number) => {
    const order = orders.find((it) => it.id === orderId)
    if (!order) return
    setCreateForm((prev) => ({
      ...prev,
      customerId: prev.customerId || String(order.customer_id || ''),
      customerName: prev.customerName || order.customer_name || '',
      linkedOrderIds: prev.linkedOrderIds.includes(orderId)
        ? prev.linkedOrderIds.filter((id) => id !== orderId)
        : [...prev.linkedOrderIds, orderId],
    }))
  }

  const removeCreateLinkedOrder = (orderId: number) => {
    setCreateForm((prev) => {
      const nextLinkedOrderIds = prev.linkedOrderIds.filter((id) => id !== orderId)
      return {
        ...prev,
        linkedOrderIds: nextLinkedOrderIds,
      }
    })
  }

  const createProgress = async () => {
    const selectedCustomer = customers.find((c) => String(c.id) === createForm.customerId)
    const customerName = (selectedCustomer?.customer_name || createForm.customerName || '').trim()
    if (!customerName) {
      toast('請先選擇客戶', 'error')
      return
    }
    const lines = createForm.lines
      .map((line) => ({
        order_po_number: line.orderPoNumber.trim(),
        material_code: line.material_code.trim(),
        material_name: line.material_name.trim(),
        spec: line.spec.trim(),
        unit: line.unit.trim() || 'PCS',
        planned_qty: Number(line.planned_qty),
        due_date: createForm.dueDate || undefined,
        remark: line.remark.trim(),
      }))
      .filter((line) => line.material_name || line.material_code || line.planned_qty || line.remark)

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
          customer_order_ids: createForm.linkedOrderIds,
          remark: createForm.remark.trim(),
          items: lines,
        }),
      })
      toast(`交期進度已建立，共 ${lines.length} 筆明細`)
      closeCreate()
      await load(status)
    } catch (e: any) {
      toast(String(e?.message || '建立失敗'), 'error')
    }
  }

  const removeProgress = async (row: IntakeItem) => {
    if (!(await confirm('確定刪除此交期進度？', row.progress_no || '', '刪除'))) return
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
        dueDate: normalizeYmdInput(formatDateYMD(detail.due_date) || formatDateYMD(detail.items?.[0]?.due_date) || ''),
        linkedOrderIds: detail.customer_order_ids || [],
        remark: detail.remark || '',
        status: detail.status || 'pending',
        lines: (detail.items || []).map((item, index) => ({
          key: `edit-${item.id || index}`,
          materialOptionId: '',
          orderPoNumber: item.order_po_number || '',
          material_code: item.material_code || '',
          material_name: item.material_name || '',
          spec: item.spec || '',
          unit: item.unit || 'PCS',
          planned_qty: String(item.planned_qty || ''),
          remark: item.remark || '',
        })),
      })
      setEditLineSeed(2000)
      setEditOrderSearch('')
    } catch (e: any) {
      toast(String(e?.message || '交期進度詳情載入失敗'), 'error')
    } finally {
      setEditLoading(false)
    }
  }

  const closeEdit = () => {
    setEditing(null)
    setEditForm(null)
    setEditOrderSearch('')
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

  const toggleEditLinkedOrder = (orderId: number) => {
    if (!editForm) return
    const order = orders.find((it) => it.id === orderId)
    if (!order) return
    setEditForm({
      ...editForm,
      linkedOrderIds: editForm.linkedOrderIds.includes(orderId)
        ? editForm.linkedOrderIds.filter((id) => id !== orderId)
        : [...editForm.linkedOrderIds, orderId],
    })
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
        order_po_number: line.orderPoNumber.trim(),
        material_code: line.material_code.trim(),
        material_name: line.material_name.trim(),
        spec: line.spec.trim(),
        unit: line.unit.trim() || 'PCS',
        planned_qty: Number(line.planned_qty),
        due_date: editForm.dueDate || undefined,
        remark: line.remark.trim(),
      }))
      .filter((line) => line.material_name || line.material_code || line.planned_qty || line.remark)

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
          customer_order_ids: editForm.linkedOrderIds,
          remark: editForm.remark.trim(),
          status: editForm.status,
          items,
        }),
      })
      toast('交期進度已更新')
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
          <h1 className="text-xl font-bold text-slate-800">交期進度</h1>
          <p className="mt-1 text-xs text-slate-500">一個交期進度可包含多筆訂單、多個 PO No，以及多筆交期明細。</p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <button className="btn-ghost" onClick={exportCsv}>匯出 CSV</button>
          <button className="btn-primary" onClick={openCreate}>+ 建立交期進度</button>
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
                    <div className="mt-1 text-xs text-slate-500">
                      {r.order_count || 0} 筆訂單 / {r.linked_po_count} 個 PO / {r.item_count} 筆明細
                    </div>
                  </td>
                  <td className="px-3 py-2 align-top">{r.customer_name || '-'}</td>
                  <td className="px-3 py-2 align-top">
                    {(() => {
                      const poSummary = summarizeTokens(r.po_number || '', 2)
                      return (
                        <>
                          <div className="break-words">{poSummary.text}</div>
                          <div className="mt-1 text-xs text-slate-500">
                            {r.linked_po_count > 0 ? `共 ${r.linked_po_count} 個 PO` : '舊資料'}
                            {poSummary.hidden > 0 ? ` / +${poSummary.hidden}` : ''}
                          </div>
                        </>
                      )
                    })()}
                  </td>
                  <td className="px-3 py-2 align-top">
                    {(() => {
                      const itemSummary = summarizeItems(r.material_name || '', 2)
                      return (
                        <>
                          <div className="max-w-[280px] break-words">{itemSummary.text}</div>
                          {itemSummary.hidden > 0 && <div className="mt-1 text-xs text-slate-500">+{itemSummary.hidden} 項</div>}
                        </>
                      )
                    })()}
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
              <h2 className="text-base font-bold text-slate-800">建立交期進度</h2>
              <button className="btn-ghost" onClick={closeCreate}>關閉</button>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs text-slate-500">客戶</label>
                <select
                  className="rubber-input"
                  value={createLockedCustomerId ? String(createLockedCustomerId) : createForm.customerId}
                  disabled={createLockedCustomerId > 0}
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
                    setCreateOrderSearch('')
                  }}
                >
                  <option value="">-- 請選擇客戶 --</option>
                  {customers.map((c) => (
                    <option key={c.id} value={String(c.id)}>{c.customer_name}</option>
                  ))}
                </select>
                {createLockedCustomerId > 0 && (
                  <p className="mt-1 text-xs text-slate-500">已依關聯訂單自動鎖定客戶，移除全部訂單後可重新選擇。</p>
                )}
              </div>

              <div>
                  <label className="mb-1 block text-xs text-slate-500">交期進度</label>
                  <input
                    type="date"
                    className="rubber-input h-9"
                    value={createForm.dueDate}
                    onChange={(e) => updateCreateForm({ dueDate: e.target.value })}
                  />
                <p className="mt-1 text-xs text-slate-500">此日期會套用到全部交期明細。</p>
              </div>

              <div className="md:col-span-2">
                <label className="mb-1 block text-xs text-slate-500">關聯客戶訂單（可多選）</label>
                <input
                  className="rubber-input h-9"
                  value={createOrderSearch}
                  onChange={(e) => setCreateOrderSearch(e.target.value)}
                  placeholder="搜尋 PO / 客戶"
                />
                <div className="mt-2 max-h-44 overflow-auto rounded-lg border border-slate-200">
                  {createOrderOptions.length > 0 ? createOrderOptions.map((o) => {
                    const checked = createForm.linkedOrderIds.includes(o.id)
                    return (
                      <label key={o.id} className={`flex cursor-pointer items-start gap-3 border-b border-slate-100 px-3 py-2 text-sm last:border-0 ${checked ? 'bg-amber-50' : 'bg-white'}`}>
                        <input type="checkbox" className="mt-1" checked={checked} onChange={() => toggleCreateLinkedOrder(o.id)} />
                        <div className="min-w-0">
                          <div className="font-medium text-slate-700">{o.po_number}</div>
                          <div className="text-xs text-slate-500">{o.customer_name || '-'} / {STATUS_LABEL[o.status] || o.status}</div>
                        </div>
                      </label>
                    )
                  }) : (
                    <div className="px-3 py-4 text-xs text-slate-500">目前沒有可選訂單</div>
                  )}
                </div>
                <p className="mt-1 text-xs text-slate-500">已選 {createLinkedOrders.length} 張訂單，勾選後會自動整合材料候選。</p>
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

            </div>

              <div className="mt-5">
                <div className="mb-2 flex items-center justify-between">
                  <label className="block text-xs text-slate-500">交期明細</label>
                  <button type="button" className="btn-ghost text-xs" onClick={addCreateLine}>+ 新增明細</button>
                </div>
                {createForm.linkedOrderIds.length > 0 && (
                  <p className="mb-2 text-xs text-slate-500">
                    已按所選客戶訂單，將對應 BOM 的全部材料明細整合為單一材料下拉框。
                    {createMaterialLoading ? ' 載入中...' : ` 共 ${createMaterialOptions.length} 個材料候選`}
                  </p>
                )}
                <div className="overflow-hidden rounded-lg border border-slate-200">
                  <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50">
                      <th className="px-3 py-2 text-left">材料名稱</th>
                      <th className="px-3 py-2 text-right">數量</th>
                      <th className="px-3 py-2 text-left">交貨 PO No.</th>
                      <th className="px-3 py-2 text-left">備註</th>
                      <th className="px-3 py-2 text-left">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {createForm.lines.map((line) => (
                      <tr key={line.key} className="border-b border-slate-100 last:border-0">
                        <td className="px-3 py-2">
                          {createForm.linkedOrderIds.length > 0 ? (
                            <div className="space-y-1">
                              <SearchableSelect
                                options={createMaterialOptions}
                                value={line.materialOptionId}
                                onChange={(value) => {
                                  const option = createMaterialOptions.find((it) => it.id === value)
                                  if (!option) return
                                  updateCreateLine(line.key, applyMaterialOption(option, line))
                                  if (!createForm.dueDate) {
                                    updateCreateForm({ dueDate: normalizeYmdInput(formatDateYMD(option.due_date) || '') })
                                  }
                                }}
                                placeholder={createMaterialLoading ? '-- 材料載入中 --' : '-- 選擇客戶訂單對應材料 --'}
                                renderOption={formatMaterialOption}
                                filterFn={filterMaterialOption}
                                disabled={createMaterialLoading}
                                className="h-9"
                              />
                              {(line.material_name || line.material_code) && (
                                <div className="text-[11px] text-slate-500">
                                  {line.material_code || '-'} / {line.spec || '-'} / {line.unit || 'PCS'}
                                </div>
                              )}
                            </div>
                          ) : (
                            <input className="rubber-input h-9" value={line.material_name} onChange={(e) => updateCreateLine(line.key, { material_name: e.target.value })} placeholder="輸入材料名稱" />
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <input type="number" min={0} className="rubber-input h-9 text-right" value={line.planned_qty} onChange={(e) => updateCreateLine(line.key, { planned_qty: e.target.value })} />
                        </td>
                        <td className="px-3 py-2">
                          <input className="rubber-input h-9" value={line.orderPoNumber} onChange={(e) => updateCreateLine(line.key, { orderPoNumber: e.target.value })} placeholder="輸入 PO No." />
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
                    <h2 className="text-base font-bold text-slate-800">編輯交期進度 {editing.progress_no}</h2>
                    <p className="mt-1 text-xs text-slate-500">{editing.customer_name || '-'}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      {(editing.order_count || 0)} 筆訂單 / {editing.linked_po_count} 個 PO / {editing.item_count} 筆明細 / 總數量 {editing.planned_qty}
                    </p>
                  </div>
                  <button className="btn-ghost" onClick={closeEdit}>關閉</button>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-xs text-slate-500">交期進度</label>
                    <input
                      type="date"
                      className="rubber-input h-9"
                      value={editForm.dueDate}
                      onChange={(e) => setEditForm({ ...editForm, dueDate: e.target.value })}
                    />
                <p className="mt-1 text-xs text-slate-500">此日期會套用到全部交期明細。</p>
                  </div>

                  <div className="md:col-span-2">
                    <label className="mb-1 block text-xs text-slate-500">關聯客戶訂單（可多選）</label>
                    <input
                      className="rubber-input h-9"
                      value={editOrderSearch}
                      onChange={(e) => setEditOrderSearch(e.target.value)}
                      placeholder="搜尋 PO"
                    />
                    <div className="mt-2 max-h-44 overflow-auto rounded-lg border border-slate-200">
                      {editOrderOptions.length > 0 ? editOrderOptions.map((o) => {
                        const checked = editForm.linkedOrderIds.includes(o.id)
                        return (
                          <label key={o.id} className={`flex cursor-pointer items-start gap-3 border-b border-slate-100 px-3 py-2 text-sm last:border-0 ${checked ? 'bg-amber-50' : 'bg-white'}`}>
                            <input type="checkbox" className="mt-1" checked={checked} onChange={() => toggleEditLinkedOrder(o.id)} />
                            <div className="min-w-0">
                              <div className="font-medium text-slate-700">{o.po_number}</div>
                              <div className="text-xs text-slate-500">{o.customer_name || '-'} / {STATUS_LABEL[o.status] || o.status}</div>
                            </div>
                          </label>
                        )
                      }) : (
                        <div className="px-3 py-4 text-xs text-slate-500">目前沒有可選訂單</div>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-slate-500">已選 {editLinkedOrders.length} 張訂單，勾選後會自動整合材料候選。</p>
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
                    <label className="block text-xs text-slate-500">交期明細</label>
                    <button type="button" className="btn-ghost text-xs" onClick={addEditLine}>+ 新增明細</button>
                  </div>
                  {editForm.linkedOrderIds.length > 0 && (
                    <p className="mb-2 text-xs text-slate-500">
                      已按所選客戶訂單，將對應 BOM 的全部材料明細整合為單一材料下拉框。
                      {editMaterialLoading ? ' 載入中...' : ` 共 ${editMaterialOptions.length} 個材料候選`}
                    </p>
                  )}
                  <div className="overflow-hidden rounded-lg border border-slate-200">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-slate-200 bg-slate-50">
                          <th className="px-3 py-2 text-left">材料名稱</th>
                          <th className="px-3 py-2 text-right">數量</th>
                          <th className="px-3 py-2 text-left">交貨 PO No.</th>
                          <th className="px-3 py-2 text-right">已採購</th>
                          <th className="px-3 py-2 text-right">缺口</th>
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
                                {editForm.linkedOrderIds.length > 0 ? (
                                  <div className="space-y-1">
                                    <SearchableSelect
                                      options={editMaterialOptions}
                                      value={line.materialOptionId}
                                      onChange={(value) => {
                                        const option = editMaterialOptions.find((it) => it.id === value)
                                        if (!option) return
                                        updateEditLine(line.key, applyMaterialOption(option, line))
                                        if (!editForm.dueDate) {
                                          setEditForm({ ...editForm, dueDate: normalizeYmdInput(formatDateYMD(option.due_date) || '') })
                                        }
                                      }}
                                      placeholder={editMaterialLoading ? '-- 材料載入中 --' : '-- 選擇客戶訂單對應材料 --'}
                                      renderOption={formatMaterialOption}
                                      filterFn={filterMaterialOption}
                                      disabled={editMaterialLoading}
                                      className="h-9"
                                    />
                                    {(line.material_name || line.material_code) && (
                                      <div className="text-[11px] text-slate-500">
                                        {line.material_code || '-'} / {line.spec || '-'} / {line.unit || 'PCS'}
                                      </div>
                                    )}
                                  </div>
                                ) : (
                                  <input className="rubber-input h-9" value={line.material_name} onChange={(e) => updateEditLine(line.key, { material_name: e.target.value })} />
                                )}
                              </td>
                              <td className="px-3 py-2">
                                <input type="number" min={0} className="rubber-input h-9 text-right" value={line.planned_qty} onChange={(e) => updateEditLine(line.key, { planned_qty: e.target.value })} />
                              </td>
                              <td className="px-3 py-2">
                                <input className="rubber-input h-9" value={line.orderPoNumber} onChange={(e) => updateEditLine(line.key, { orderPoNumber: e.target.value })} placeholder="輸入 PO No." />
                              </td>
                              <td className="px-3 py-2 text-right text-slate-500">{source?.purchased_qty ?? 0}</td>
                              <td className="px-3 py-2 text-right text-amber-600">{source?.purchase_gap_qty ?? Math.max(0, Number(line.planned_qty || 0))}</td>
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
