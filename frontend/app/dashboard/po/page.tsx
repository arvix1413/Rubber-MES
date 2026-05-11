'use client'
import { useDialog } from '@/components/Dialog'
import { useEffect, useState } from 'react'
import { apiFetch, getSignatureUrl } from '@/lib/api'
import { usePagination, Pagination } from '@/lib/usePagination'
import { StatusFlow, PO_STEPS, getPOActions } from '@/components/StatusFlow'
import { SearchableSelect } from '@/components/SearchableSelect'
import { can } from '@/lib/usePermissions'
import { getCompany } from '@/lib/useCompany'
import { resolveTierPrice, type MoqTier } from '@/lib/moqPricing'
import { generatePurchaseSheetHTML } from '@/lib/printPurchaseSheet'
import { formatDateYMD } from '@/lib/datetime'
import { formatDecimal, formatInteger } from '@/lib/numberFormat'
import { useRefreshOnFocus } from '@/lib/useRefreshOnFocus'

type PoItem = { material_code:string; material_name:string; spec:string; unit:string; quantity:number; unit_price:number; total_price:number; currency:string; remark:string; po_ref:string; thickness?:number|string; image_url?:string; material_id?:number }
type Po = { id:number; po_number:string; supplier_name:string; status:string; total_amount:number; tax_rate?:number; currency:string; remark:string; created_at:string; approved_at?:string; items?:PoItem[] }
type Supplier = { id: number; name: string; currency: string; supplier_code: string }
type Material = { id: number; material_code: string; material_name: string; spec: string; unit: string; supplier_price: number; currency: string; image_url?: string; supplier_id?: number; moq_tiers?: MoqTier[] }
type ImportedPoSource = { order: { id: number; po_number: string; customer_name: string }; items: any[]; suppliers: Array<{ supplier_id: number; supplier_name: string; count: number }> }

type PoItemExt = PoItem & {
  keep?: boolean
  supplier_id?: number | null
  supplier_name?: string
}

const STATUS_MAP: Record<string,{label:string;badge:string}> = {
  draft:     { label:'草稿',   badge:'badge-gray'   },
  approved:  { label:'已核准', badge:'badge-green'  },
  sent:      { label:'已送出', badge:'badge-blue'   },
  received:  { label:'已收貨', badge:'badge-purple' },
  cancelled: { label:'已取消', badge:'badge-red'    },
}

const emptyItem = (): PoItemExt => ({ material_code:'', material_name:'', spec:'', unit:'', quantity:1, unit_price:0, total_price:0, currency:'VND', remark:'', po_ref:'', keep: true, supplier_id: null, supplier_name: '' })

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      className={`w-3.5 h-3.5 transition-transform duration-200 ${open ? 'rotate-90' : ''}`}>
      <polyline points="9 18 15 12 9 6" />
    </svg>
  )
}

export default function PoPage() {
  const { toast, confirm: confirmDialog } = useDialog()

  const [pos, setPos] = useState<Po[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [materials, setMaterials] = useState<Material[]>([])
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const [loadedItems, setLoadedItems] = useState<Record<number, PoItem[]>>({})
  const [creating, setCreating] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState({ po_number: '', supplier_id: '', supplier_name:'', currency:'VND', tax_rate: 8, remark:'', items:[emptyItem()] as PoItemExt[] })
  const [sourceOrderPoNo, setSourceOrderPoNo] = useState('')
  const [sourceLoading, setSourceLoading] = useState(false)
  const [sourceMeta, setSourceMeta] = useState<ImportedPoSource | null>(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [unitPriceInputs, setUnitPriceInputs] = useState<Record<number, string>>({})
  const canWrite = can('po.create')
  const canApprove = can('po.approve')
  const canDel = can('po.delete')

  const loadPoItems = async (id: number) => {
    const data = await apiFetch<Po>(`/api/po/${id}`)
    const nextItems = data.items || []
    setLoadedItems(p => ({ ...p, [id]: nextItems }))
    return nextItems
  }

  const refreshExpandedRows = async (expandedIds: number[]) => {
    if (!expandedIds.length) {
      setLoadedItems({})
      return
    }
    const nextEntries = await Promise.all(
      expandedIds.map(async (id) => {
        try {
          const data = await apiFetch<Po>(`/api/po/${id}`)
          return [id, data.items || []] as const
        } catch {
          return [id, []] as const
        }
      })
    )
    setLoadedItems(Object.fromEntries(nextEntries))
  }

  const refreshAll = async (showSpinner = false) => {
    if (showSpinner) setLoading(true)
    try {
      const [poRows, supplierRows, materialRows] = await Promise.all([
        apiFetch<Po[]>('/api/po'),
        apiFetch<Supplier[]>('/api/suppliers'),
        apiFetch<Material[]>('/api/materials'),
      ])
      setPos(poRows || [])
      setSuppliers(supplierRows || [])
      setMaterials(materialRows || [])
      await refreshExpandedRows(Array.from(expanded))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refreshAll(true)
  }, [])

  useRefreshOnFocus(() => refreshAll(false))

  const buildUnitPriceInputs = (items: PoItemExt[]) =>
    Object.fromEntries(items.map((item, idx) => [idx, Number(item.unit_price || 0) ? formatDecimal(item.unit_price) : '']))

  const parseMoney = (raw: string) => {
    const text = raw.trim().replace(/,/g, '')
    if (!text) return 0
    if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(text)) return null
    const value = Number(text)
    if (!Number.isFinite(value) || value < 0) return null
    return value
  }

  const onSelectSupplier = async (supplierId: string) => {
    const sup = suppliers.find(s => String(s.id) === supplierId)
    setForm(p => ({ ...p, supplier_id: supplierId, supplier_name: sup?.name || '', currency: sup?.currency || p.currency || 'VND' }))
  }

  const getFilteredMaterials = () => {
    if (!form.supplier_id) return materials
    return materials.filter(m => !m.supplier_id || String(m.supplier_id) === form.supplier_id)
  }

  const selectMaterial = (i: number, materialId: string) => {
    const material = getFilteredMaterials().find(m => String(m.id) === materialId)
    if (!material) {
      setForm(p => {
        const items = p.items.map((item, idx) => idx !== i ? item : {
          ...item,
          material_id: undefined,
          material_code: '',
          material_name: '',
          spec: '',
          unit: '',
          unit_price: 0,
          image_url: '',
          total_price: 0,
          supplier_id: null,
          supplier_name: '',
        })
        setUnitPriceInputs(buildUnitPriceInputs(items))
        return { ...p, items }
      })
      return
    }
    
    setForm(p => {
      const items = p.items.map((item, idx) => idx !== i ? item : {
        ...(item || {}),
        ...item,
        material_id: Number(materialId),
        material_code: material.material_code,
        material_name: material.material_name,
        spec: material.spec || '',
        unit: material.unit || 'PCS',
        unit_price: resolveTierPrice(material.moq_tiers, item.quantity || 0, material.supplier_price || 0),
        currency: material.currency || form.currency,
        image_url: material.image_url || '',
        total_price: (item.quantity || 0) * resolveTierPrice(material.moq_tiers, item.quantity || 0, material.supplier_price || 0),
        supplier_id: material.supplier_id ?? null,
        supplier_name: suppliers.find((s) => s.id === material.supplier_id)?.name || '',
      })
      setUnitPriceInputs(buildUnitPriceInputs(items))
      return { ...p, items }
    })
  }

  const toggleExpand = async (id: number) => {
    const next = new Set(expanded)
    if (next.has(id)) {
      next.delete(id)
      setExpanded(next)
    } else {
      next.add(id)
      setExpanded(next)
      if (!loadedItems[id]) {
        await loadPoItems(id)
      }
    }
  }

  const approve = async (id: number, e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      await apiFetch(`/api/po/${id}/approve`, { method: 'PATCH' })
      toast('已核准')
      await refreshAll(false)
    } catch (e: any) { toast('核准失敗：' + e.message, 'error') }
  }

  const confirmReceipt = async (po: Po, e: React.MouseEvent) => {
    e.stopPropagation()
    if (!await confirmDialog('確認收貨？', '確認後將更新材料庫存，此操作不可撤銷', '確認收貨')) return
    try {
      await apiFetch(`/api/po/${po.id}/receive`, { method: 'PATCH' })
      toast('收貨完成，庫存已更新')
      await refreshAll(false)
    } catch (e: any) { toast('收貨失敗：' + e.message, 'error') }
  }

  const changeStatus = async (id: number, status: string, e: React.MouseEvent) => {
    e.stopPropagation()
    const labels: Record<string, string> = { sent: '確認送出此採購單？' }
    const btnLabels: Record<string, string> = { sent: '確認送出' }
    if (!await confirmDialog(labels[status] || '確認變更狀態？', '', btnLabels[status] || '確認')) return
    try {
      await apiFetch(`/api/po/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) })
      toast('狀態已更新')
      await refreshAll(false)
    } catch (e: any) { toast('操作失敗：' + e.message, 'error') }
  }

  const del = async (id: number, e: React.MouseEvent) => {
    e.stopPropagation()
    if (!await confirmDialog('確定刪除此採購單？')) return
    try {
      await apiFetch(`/api/po/${id}`, { method: 'DELETE' })
      await refreshAll(false)
    } catch (e: any) { toast('刪除失敗：' + e.message, 'error') }
  }

  const addItem = () => setForm(p => {
    const items = [...p.items, emptyItem()]
    setUnitPriceInputs(buildUnitPriceInputs(items))
    return { ...p, items }
  })
  const removeItem = (i: number) => setForm(p => {
    const items = p.items.filter((_, idx) => idx !== i)
    setUnitPriceInputs(buildUnitPriceInputs(items))
    return { ...p, items }
  })
  const updateItem = (i: number, field: keyof PoItemExt, val: any) => {
    setForm(p => {
      const items = p.items.map((item, idx) => {
        if (idx !== i) return item
        const u = { ...item, [field]: val }
        if (field === 'quantity' && u.material_id) {
          const material = materials.find((m) => m.id === u.material_id)
          if (material) u.unit_price = resolveTierPrice(material.moq_tiers, Number(u.quantity) || 0, material.supplier_price || 0)
        }
        if (field === 'quantity' || field === 'unit_price') u.total_price = (Number(u.quantity) || 0) * (Number(u.unit_price) || 0)
        return u
      })
      if (field === 'quantity') setUnitPriceInputs(buildUnitPriceInputs(items))
      return { ...p, items }
    })
  }
  const onUnitPriceChange = (i: number, raw: string) => {
    setUnitPriceInputs((prev) => ({ ...prev, [i]: raw }))
    const parsed = parseMoney(raw)
    if (parsed === null) return
    updateItem(i, 'unit_price', parsed)
  }
  const onUnitPriceBlur = (i: number) => {
    const current = unitPriceInputs[i] ?? ''
    const parsed = parseMoney(current)
    if (parsed === null) {
      setUnitPriceInputs((prev) => ({ ...prev, [i]: Number(form.items[i]?.unit_price || 0) ? formatDecimal(form.items[i]?.unit_price) : '' }))
      return
    }
    setUnitPriceInputs((prev) => ({ ...prev, [i]: parsed ? formatDecimal(parsed) : '' }))
  }
  const importFromCustomerOrder = async () => {
    const poNo = sourceOrderPoNo.trim()
    if (!poNo) {
      toast('請先輸入客戶訂單號', 'error')
      return
    }
    setSourceLoading(true)
    try {
      const payload = await apiFetch<ImportedPoSource>(`/api/po/materials-from-order-po/${encodeURIComponent(poNo)}`)
      const importedItems: PoItemExt[] = (payload.items || []).map((row) => ({
        material_id: row.material_id ? Number(row.material_id) : undefined,
        material_code: row.material_code || '',
        material_name: row.material_name || '',
        spec: row.spec || '',
        unit: row.unit || 'PCS',
        quantity: Number(row.quantity || 0),
        unit_price: Number(row.unit_price || 0),
        total_price: Number(row.total_price || 0),
        currency: row.currency || 'VND',
        remark: row.remark || '',
        po_ref: row.po_ref || payload.order?.po_number || poNo,
        image_url: row.image_url || '',
        supplier_id: row.supplier_id ? Number(row.supplier_id) : null,
        supplier_name: row.supplier_name || '',
        keep: true,
      }))
      if (!importedItems.length) {
        toast('此訂單無可帶入的輔料明細', 'error')
        return
      }
      const onlyOneSupplier = (payload.suppliers || []).length === 1 ? payload.suppliers[0] : null
      const matchedSup = onlyOneSupplier ? suppliers.find((s) => s.id === onlyOneSupplier.supplier_id) : null
      setForm((p) => ({
        ...p,
        supplier_id: matchedSup ? String(matchedSup.id) : p.supplier_id,
        supplier_name: matchedSup?.name || p.supplier_name,
        currency: matchedSup?.currency || p.currency || 'VND',
        items: importedItems,
      }))
      setUnitPriceInputs(buildUnitPriceInputs(importedItems))
      setSourceMeta(payload)
      toast(`已帶入 ${importedItems.length} 筆輔料明細`)
      if (!onlyOneSupplier) {
        toast('此客戶訂單含多供應商，請先選供應商再用「只保留當前供應商」', 'error')
      }
    } catch (e: any) {
      toast(`帶入失敗：${e.message}`, 'error')
    } finally {
      setSourceLoading(false)
    }
  }
  const keepOnlyCurrentSupplier = () => {
    if (!form.supplier_id) {
      toast('請先選擇供應商', 'error')
      return
    }
    const sid = Number(form.supplier_id)
    setForm((p) => ({
      ...p,
      items: p.items.map((item) => ({ ...item, keep: item.supplier_id === sid })),
    }))
  }
  const removeUncheckedItems = () => {
    setForm((p) => ({
      ...p,
      items: p.items.filter((item) => item.keep !== false),
    }))
  }

  const save = async () => {
    if (!form.supplier_id) { toast('請選擇供應商', 'error'); return }
    const validItems = form.items
      .filter(i => i.keep !== false && i.material_id)
      .map((i) => ({
        material_id: i.material_id,
        material_code: i.material_code,
        material_name: i.material_name,
        spec: i.spec,
        unit: i.unit,
        quantity: i.quantity,
        unit_price: i.unit_price,
        total_price: i.total_price,
        currency: i.currency,
        remark: i.remark,
        po_ref: i.po_ref,
        thickness: i.thickness,
      }))
    if (!validItems.length) { toast('請至少選擇一個材料品項', 'error'); return }
    try {
      if (editingId) {
        await apiFetch(`/api/po/${editingId}`, { method: 'PUT', body: JSON.stringify({ ...form, items: validItems }) })
        toast('採購單已更新')
        setEditingId(null)
      } else {
        await apiFetch('/api/po', { method: 'POST', body: JSON.stringify({ ...form, items: validItems }) })
        toast('採購單建立成功')
        setCreating(false)
      }
      setForm({ po_number: '', supplier_id: '', supplier_name:'', currency:'VND', tax_rate: 8, remark:'', items:[emptyItem()] })
      setUnitPriceInputs({})
      setSourceOrderPoNo('')
      setSourceMeta(null)
      await refreshAll(false)
    } catch (e: any) { toast('錯誤：' + e.message, 'error') }
  }

  const startEdit = async (po: Po, e: React.MouseEvent) => {
    e.stopPropagation()
    const data = await apiFetch<Po>(`/api/po/${po.id}`)
    const rawSupplierId = (po as any).supplier_id ?? (data as any).supplier_id
    const sup = rawSupplierId
      ? suppliers.find(s => String(s.id) === String(rawSupplierId))
      : suppliers.find(s => s.name === po.supplier_name)
    setForm({
      po_number: '',
      supplier_id: sup ? String(sup.id) : (rawSupplierId ? String(rawSupplierId) : ''),
      supplier_name: po.supplier_name,
      currency: po.currency,
      tax_rate: Math.min(25, Math.max(1, Number((data as any).tax_rate ?? (po as any).tax_rate ?? 8))),
      remark: po.remark || '',
      items: (data.items || []).map(i => {
        const matchedMaterial = materials.find(m => m.material_code === i.material_code)
        return {
          material_code: i.material_code,
          material_name: i.material_name,
          spec: i.spec,
          unit: i.unit,
          quantity: Number(i.quantity),
          unit_price: Number(i.unit_price),
          total_price: Number(i.total_price),
          currency: i.currency,
          remark: i.remark,
          po_ref: i.po_ref,
          image_url: i.image_url || matchedMaterial?.image_url || '',
          material_id: matchedMaterial ? matchedMaterial.id : undefined,
          supplier_id: matchedMaterial?.supplier_id ?? null,
          supplier_name: po.supplier_name || '',
          keep: true,
        }
      })
    })
    setUnitPriceInputs(buildUnitPriceInputs((data.items || []).map(i => {
      const matchedMaterial = materials.find(m => m.material_code === i.material_code)
      return {
        material_code: i.material_code,
        material_name: i.material_name,
        spec: i.spec,
        unit: i.unit,
        quantity: Number(i.quantity),
        unit_price: Number(i.unit_price),
        total_price: Number(i.total_price),
        currency: i.currency,
        remark: i.remark,
        po_ref: i.po_ref,
        image_url: i.image_url || matchedMaterial?.image_url || '',
        material_id: matchedMaterial ? matchedMaterial.id : undefined,
        supplier_id: matchedMaterial?.supplier_id ?? null,
        supplier_name: po.supplier_name || '',
        keep: true,
      }
    })))
    setEditingId(po.id)
    setCreating(false)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const printPo = async (id: number) => {
    const [data, company] = await Promise.all([
      apiFetch<Po>(`/api/po/${id}`),
      getCompany(),
    ])
    const html = generatePurchaseSheetHTML(data, getSignatureUrl() || undefined, company)
    const w = window.open('', '_blank', 'width=900,height=1100')
    if (w) { w.document.write(html); w.document.close(); setTimeout(() => w.print(), 500) }
  }

  const formTotal = form.items.filter(i => i.keep !== false).reduce((s, i) => s + (i.total_price || 0), 0)
  const filteredPos = pos.filter(p => {
    const matchSearch = !search || p.po_number.toLowerCase().includes(search.toLowerCase()) || p.supplier_name.toLowerCase().includes(search.toLowerCase())
    const matchStatus = !statusFilter || p.status === statusFilter
    return matchSearch && matchStatus
  })
  const { page, setPage, totalPages, paged, total } = usePagination(filteredPos, 10)
  const inp = 'rubber-input text-xs py-1.5'
  const lockedInp = `${inp} bom-locked-field`

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-slate-800">採購單管理</h1>
          <p className="section-hint">點選採購單列展開檢視料號明細</p>
        </div>
        {canWrite && <button onClick={() => { setCreating(true); setEditingId(null); setForm({ po_number: '', supplier_id: '', supplier_name:'', currency:'VND', tax_rate: 8, remark:'', items:[emptyItem()] }); setUnitPriceInputs({}); setSourceOrderPoNo(''); setSourceMeta(null) }} className="btn-primary">+ 建立採購單</button>}
      </div>

      {(creating || editingId !== null) && canWrite && (
        <div className="rubber-card p-0 overflow-hidden max-h-[calc(100vh-7rem)] flex flex-col mb-5">
          <div className="sticky top-0 z-20 bg-white border-b border-slate-200 px-6 pt-6 pb-4 shadow-sm">
          <div className="flex items-start justify-between gap-4 mb-4">
            <div>
              <h2 className="text-sm font-semibold text-slate-800">{editingId ? '編輯採購單（草稿）' : '建立採購單'}</h2>
              <p className="mt-1 text-[11px] text-slate-400">採購資訊與新增料號固定顯示，長單據操作不需再拉回頂部。</p>
            </div>
            <button onClick={() => { setCreating(false); setEditingId(null); setForm({ po_number: '', supplier_id: '', supplier_name:'', currency:'VND', tax_rate: 8, remark:'', items:[emptyItem()] }); setUnitPriceInputs({}); setSourceOrderPoNo(''); setSourceMeta(null) }} className="btn-ghost border border-slate-200 shrink-0">關閉</button>
          </div>
          <div className="grid grid-cols-4 gap-3 mb-4">
            <div>
              <label className="block text-[11px] text-slate-500 mb-1.5">採購單號（選填）</label>
              <input
                className={inp}
                value={form.po_number}
                onChange={e=>setForm(p=>({...p, po_number: e.target.value}))}
                placeholder="例如 123456-1"
                disabled={editingId !== null}
              />
            </div>
            <div>
              <label className="block text-[11px] text-slate-500 mb-1.5">供應商 *</label>
              <select className={inp} value={form.supplier_id}
                onChange={e => onSelectSupplier(e.target.value)}>
                <option value="">-- 選擇供應商 --</option>
                {suppliers.map(s => (
                  <option key={s.id} value={String(s.id)}>{s.name}{s.supplier_code ? ` (${s.supplier_code})` : ''}</option>
                ))}
              </select>            </div>
            <div>
              <label className="block text-[11px] text-slate-500 mb-1.5">幣別</label>
              <select className={inp} value={form.currency} onChange={e=>setForm(p=>({...p,currency:e.target.value}))}>
                <option>VND</option><option>TWD</option><option>CNY</option><option>USD</option>
              </select>
            </div>
            <div>
              <label className="block text-[11px] text-slate-500 mb-1.5">備註（交易條件、特殊要求等）</label>
              <textarea className={inp} rows={3} value={form.remark} onChange={e=>setForm(p=>({...p,remark:e.target.value}))} placeholder="可輸入交易條件、付款方式、交貨要求等資訊..." />
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3 mb-4">
            <div className="flex items-end gap-2 flex-wrap">
              <div className="min-w-[240px]">
                <label className="block text-[11px] text-slate-500 mb-1.5">客戶訂單號（PO NO）</label>
                <input className={inp} value={sourceOrderPoNo} onChange={e=>setSourceOrderPoNo(e.target.value)} placeholder="輸入客戶訂單號後帶入輔料" />
              </div>
              <button onClick={importFromCustomerOrder} className="btn-primary" disabled={sourceLoading}>
                {sourceLoading ? '帶入中...' : '帶入客戶訂單輔料'}
              </button>
              <button onClick={keepOnlyCurrentSupplier} className="btn-ghost border border-slate-200">只保留當前供應商</button>
              <button onClick={removeUncheckedItems} className="btn-ghost border border-slate-200">刪除未勾選</button>
            </div>
            {sourceMeta && (
              <div className="mt-2 text-[11px] text-slate-500">
                來源訂單：<span className="font-semibold text-slate-700">{sourceMeta.order.po_number}</span>
                {' · '}客戶：<span className="font-semibold text-slate-700">{sourceMeta.order.customer_name}</span>
                {' · '}帶入明細：<span className="font-semibold text-slate-700">{sourceMeta.items.length}</span>
              </div>
            )}
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs font-semibold text-slate-600">採購明細</span>
            <button onClick={addItem} className="btn-ghost text-blue-600 shrink-0">+ 新增料號</button>
          </div>
          </div>
          <div className="flex-1 min-h-0 overflow-hidden px-6 py-4">
          <div className="table-scroll-x h-full overflow-auto overscroll-x-contain rounded-lg border border-slate-200 bg-white">
            <table className="w-full text-xs oms-table" style={{ minWidth: 1760 }}>
              <thead><tr className="border-b border-slate-200">
                {['保留','Item','PO NO','MTL NO（Materials）','Products','Supplier','Spec','Unit','QTY','Unit Price','Amount','Tax','Currency','Remark',''].map(h=>(
                  <th key={h} className="sticky top-0 z-10 bg-white px-2 py-2 text-left text-[10px] font-semibold text-slate-500 uppercase whitespace-nowrap shadow-sm">{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {form.items.map((item, i) => (
                  <tr key={i} className="border-b border-slate-100">
                    <td className="p-1 text-center">
                      <input
                        type="checkbox"
                        checked={item.keep !== false}
                        onChange={e=>updateItem(i,'keep',e.target.checked)}
                      />
                    </td>
                    <td className="p-1.5">
                      {item.image_url ? (
                        <img src={item.image_url} alt="" className="w-10 h-10 object-cover rounded border border-slate-200" onError={e=>{(e.target as HTMLImageElement).style.display='none'}} />
                      ) : (
                        <div className="w-10 h-10 bg-slate-100 rounded flex items-center justify-center text-slate-300 text-xs">無</div>
                      )}
                    </td>
                    <td className="p-1"><input className={inp} style={{width:130}} value={item.po_ref} placeholder="PO編號" onChange={e=>updateItem(i,'po_ref',e.target.value)} /></td>
                    <td className="p-1 min-w-[280px]">
                      <SearchableSelect
                        options={getFilteredMaterials()}
                        value={item.material_id ? String(item.material_id) : ''}
                        onChange={val => selectMaterial(i, val)}
                        placeholder="-- 選擇材料 --"
                        disabled={!form.supplier_id}
                        renderOption={m => `${m.material_code} — ${m.material_name}${m.spec ? ` (${m.spec})` : ''}`}
                        filterFn={(m, search) => 
                          m.material_code.toLowerCase().includes(search) ||
                          m.material_name.toLowerCase().includes(search) ||
                          (m.spec || '').toLowerCase().includes(search)
                        }
                      />
                    </td>
                    <td className="p-1"><input className={lockedInp} value={item.material_name} onChange={e=>updateItem(i,'material_name',e.target.value)} readOnly /></td>
                    <td className="p-1"><input className={lockedInp} style={{width:150}} value={item.supplier_name || ''} onChange={e=>updateItem(i,'supplier_name',e.target.value)} readOnly /></td>
                    <td className="p-1"><input className={lockedInp} value={item.spec} onChange={e=>updateItem(i,'spec',e.target.value)} readOnly style={{width:120}} /></td>
                    <td className="p-1"><input className={lockedInp} value={item.unit} onChange={e=>updateItem(i,'unit',e.target.value)} readOnly style={{width:70}} /></td>
                    <td className="p-1"><input type="number" className={inp} style={{width:90}} value={item.quantity || ""} onChange={e=>updateItem(i,'quantity',Number(e.target.value))} /></td>
                    <td className="p-1"><input type="text" inputMode="decimal" className={inp} style={{width:110}} value={unitPriceInputs[i] ?? ''} onChange={e=>onUnitPriceChange(i, e.target.value)} onBlur={()=>onUnitPriceBlur(i)} /></td>
                    <td className="p-1 px-2 text-right text-slate-600 font-medium whitespace-nowrap">{formatDecimal(item.total_price)}</td>
                    <td className="p-1">
                      <select className={inp} style={{width:80}} value={String(form.tax_rate)}
                        onChange={e=>setForm(p=>({...p, tax_rate: Math.min(25, Math.max(1, Number(e.target.value) || 8))}))}>
                        {Array.from({ length: 25 }, (_, idx) => idx + 1).map(v => (
                          <option key={v} value={v}>{v}%</option>
                        ))}
                      </select>
                    </td>
                    <td className="p-1">
                      <select className={inp} style={{width:72}} value={item.currency} onChange={e=>updateItem(i,'currency',e.target.value)}>
                        <option>VND</option><option>TWD</option><option>CNY</option><option>USD</option>
                      </select>
                    </td>
                    <td className="p-1"><input className={inp} style={{width:180}} value={item.remark} onChange={e=>updateItem(i,'remark',e.target.value)} /></td>
                    <td className="p-1 text-center"><button onClick={() => removeItem(i)} className="text-slate-300 hover:text-red-600 transition-colors">✕</button></td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-slate-200">
                  <td colSpan={10} className="px-3 py-2 text-right text-[11px] text-slate-400 font-semibold uppercase">未稅合計</td>
                  <td className="px-2 py-2 text-right text-slate-600 font-bold">{formatDecimal(formTotal)}</td>
                  <td className="px-2 py-2 text-slate-400 text-xs">{form.tax_rate}%</td>
                  <td className="px-2 py-2 text-slate-400 text-xs">{form.currency}</td>
                  <td className="px-2 py-2 text-right text-slate-700 font-bold" colSpan={2}>
                    含稅 {formatDecimal(formTotal * (1 + (form.tax_rate || 8) / 100))}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
          </div>
          <div className="sticky bottom-0 z-20 bg-white/95 backdrop-blur border-t border-slate-200 px-6 py-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div className="text-xs text-slate-500">
                未稅合計 <span className="font-semibold text-slate-700">{formatDecimal(formTotal)}</span>
                <span className="mx-2 text-slate-300">|</span>
                含稅合計 <span className="font-semibold text-slate-700">{formatDecimal(formTotal * (1 + (form.tax_rate || 8) / 100))}</span>
              </div>
              <div className="flex gap-2">
                <button onClick={save} className="btn-primary">{editingId ? '儲存修改' : '建立採購單'}</button>
                <button onClick={() => { setCreating(false); setEditingId(null); setForm({ po_number: '', supplier_id: '', supplier_name:'', currency:'VND', tax_rate: 8, remark:'', items:[emptyItem()] }); setUnitPriceInputs({}); setSourceOrderPoNo(''); setSourceMeta(null) }} className="btn-ghost border border-slate-200">取消</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {!creating && editingId === null && (
        <>
          <div className="list-controls">
            <input className="list-search" placeholder="搜尋 PO NO 或供應商..." value={search} onChange={e=>setSearch(e.target.value)} />
            <div className="flex gap-1">
              {[['', '全部'], ['draft', '草稿'], ['approved', '已核准'], ['sent', '已送出'], ['received', '已收貨']].map(([val, label]) => (
                <button key={val} onClick={() => setStatusFilter(val)}
                  className={`filter-chip ${statusFilter === val ? 'filter-chip-active' : ''}`}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="rubber-card overflow-hidden">
        {loading ? <div className="flex justify-center py-16"><div className="w-5 h-5 border-2 border-blue-200 border-t-blue-600 rounded-full animate-spin" /></div> : (
          <>
            <div className="table-scroll-x">
            <table className="w-full text-sm" style={{ minWidth: 1460 }}>
              <thead>
                <tr className="border-b border-slate-200">
                  <th className="w-8" />
                  <th className="px-4 py-3 text-left text-[11px] font-semibold text-slate-500 uppercase tracking-wider">採購單號</th>
                  <th className="px-4 py-3 text-left text-[11px] font-semibold text-slate-500 uppercase tracking-wider">供應商</th>
                  <th className="px-4 py-3 text-right text-[11px] font-semibold text-slate-500 uppercase tracking-wider">金額</th>
                  <th className="px-4 py-3 text-left text-[11px] font-semibold text-slate-500 uppercase tracking-wider">幣別</th>
                  <th className="px-4 py-3 text-left text-[11px] font-semibold text-slate-500 uppercase tracking-wider">狀態</th>
                  <th className="px-4 py-3 text-left text-[11px] font-semibold text-slate-500 uppercase tracking-wider">建立時間</th>
                  <th className="px-4 py-3 text-left text-[11px] font-semibold text-slate-500 uppercase tracking-wider">操作</th>
                </tr>
              </thead>
              <tbody>
                {paged.map(p => {
                  const isOpen = expanded.has(p.id)
                  const items = loadedItems[p.id] || []
                  const sm = STATUS_MAP[p.status] || { label: p.status, badge: 'badge-gray' }
                  return (
                    <>
                      <tr key={p.id}
                        className={`border-b border-slate-100 cursor-pointer transition-colors ${isOpen ? 'layer-row-open' : 'layer-row-hover'}`}
                        onClick={() => toggleExpand(p.id)}>
                        <td className="pl-4 py-3">
                          <span className="text-slate-500"><ChevronIcon open={isOpen} /></span>
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-blue-600">{p.po_number}</td>
                        <td className="px-4 py-3 text-slate-800 font-medium max-w-[200px] truncate" title={p.supplier_name}>{p.supplier_name}</td>
                        <td className="px-4 py-3 text-right text-slate-600 font-medium">{formatDecimal(p.total_amount)}</td>
                        <td className="px-4 py-3 text-slate-400 text-xs">{p.currency}</td>
                        <td className="px-4 py-3"><span className={sm.badge}>{sm.label}</span></td>
                        <td className="px-4 py-3 text-slate-300 text-xs">{formatDateYMD(p.created_at) || '—'}</td>
                        <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                          <div className="flex items-center gap-1">
                            <StatusFlow compact steps={PO_STEPS} current={p.status}
                              actions={getPOActions(p.status).filter(a => {
                                if (a.toStatus === 'approved') return canApprove
                                if (a.toStatus === 'received') return canApprove
                                return canWrite
                              })}
                              onAction={async (toStatus) => {
                                if (toStatus === 'approved') await approve(p.id, { stopPropagation: ()=>{} } as any)
                                else if (toStatus === 'received') await confirmReceipt(p, { stopPropagation: ()=>{} } as any)
                                else await changeStatus(p.id, toStatus, { stopPropagation: ()=>{} } as any)
                              }} />
                            <button onClick={e => { e.stopPropagation(); printPo(p.id) }} className="btn-ghost ml-1" title="列印">🖨 列印</button>
                            {canWrite && p.status === 'draft' && (
                              <button onClick={e => startEdit(p, e)} className="btn-ghost text-blue-600">✏ 編輯</button>
                            )}
                            {canDel && (
                              <button onClick={e => del(p.id, e)} className="btn-danger">刪除</button>
                            )}
                          </div>
                        </td>
                      </tr>
                      {isOpen && (
                        <tr key={`${p.id}-items`} className="border-b border-slate-100">
                          <td colSpan={8} className="px-0 py-0">
                            <div className="expand-row-wrap layer-panel-l2">
                              {items.length === 0 ? (
                                <div className="expand-row-loading">
                                  <div className="w-3 h-3 border border-slate-300 border-t-slate-500 rounded-full animate-spin"/>載入中...
                                </div>
                              ) : (
                                <table className="w-full text-xs">
                                  <thead>
                                    <tr className="layer-head-l2">
                                      {['PO訂單編號','料號','材料名稱','規格'].map(h=>(
                                        <th key={h} className="px-3 py-2 text-left text-[10px] font-semibold text-slate-500 uppercase whitespace-nowrap">{h}</th>
                                      ))}
                                      {['數量','單價','小計'].map(h=>(
                                        <th key={h} className="px-3 py-2 text-right text-[10px] font-semibold text-slate-500 uppercase whitespace-nowrap">{h}</th>
                                      ))}
                                      {['稅率','單位','幣別','備註'].map(h=>(
                                        <th key={h} className="px-3 py-2 text-left text-[10px] font-semibold text-slate-500 uppercase whitespace-nowrap">{h}</th>
                                      ))}
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {items.map((item, i) => (
                                      <tr key={i} className="border-b border-[#e1cfb8] last:border-0 hover:bg-[#f5e8d7]">
                                        <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{item.po_ref}</td>
                                        <td className="px-3 py-2 font-mono text-blue-600 whitespace-nowrap">{item.material_code}</td>
                                        <td className="px-3 py-2 text-slate-600 whitespace-nowrap max-w-[160px] truncate" title={item.material_name}>{item.material_name}</td>
                                        <td className="px-3 py-2 text-slate-400 whitespace-nowrap max-w-[120px] truncate" title={item.spec}>{item.spec}</td>
                                        <td className="px-3 py-2 text-right text-slate-600 font-medium whitespace-nowrap">{formatInteger(Number(item.quantity))}</td>
                                        <td className="px-3 py-2 text-right text-slate-600 whitespace-nowrap">{formatDecimal(item.unit_price)}</td>
                                        <td className="px-3 py-2 text-right text-slate-800 font-semibold whitespace-nowrap">{formatDecimal(item.total_price)}</td>
                                        <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{Number((p as any).tax_rate || 8)}%</td>
                                        <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{item.unit}</td>
                                        <td className="px-3 py-2 text-slate-400 whitespace-nowrap">{item.currency}</td>
                                        <td className="px-3 py-2 text-slate-400 whitespace-nowrap">{item.remark}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                  <tfoot>
                                    <tr className="border-t" style={{ borderColor: '#dccab2', background: '#f0e4d4' }}>
                                      <td colSpan={7} className="px-3 py-2 text-right text-[10px] text-slate-300 font-semibold uppercase">未稅合計</td>
                                      <td className="px-3 py-2 text-right text-slate-600 font-bold">{formatDecimal(items.reduce((s,i)=>s+Number(i.total_price),0))}</td>
                                      <td className="px-3 py-2 text-slate-400 text-xs">{Number((p as any).tax_rate || 8)}%</td>
                                      <td colSpan={3} className="px-3 py-2 text-slate-400 text-xs">{items[0]?.currency}</td>
                                    </tr>
                                  </tfoot>
                                </table>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  )
                })}
                {paged.length === 0 && <tr><td colSpan={8} className="px-4 py-12 text-center text-slate-400">尚無採購單</td></tr>}
              </tbody>
            </table>
            </div>
            <Pagination page={page} totalPages={totalPages} setPage={setPage} total={total} />
          </>
        )}
      </div>
      </>
      )}
    </div>
  )
}
