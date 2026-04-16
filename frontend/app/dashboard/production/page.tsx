'use client'
import { useDialog } from '@/components/Dialog'
import { useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api'
import { usePagination, Pagination } from '@/lib/usePagination'
import { StatusFlow, PROD_STEPS, getProdActions } from '@/components/StatusFlow'
import { can } from '@/lib/usePermissions'
import { getCompany } from '@/lib/useCompany'
import FieldLockHint from '@/components/FieldLockHint'

type ProdMat = {
  material_code: string; material_name: string; spec: string; unit: string
  planned_qty: number; issued_qty: number; batch_no: string; remark: string
  current_stock?: number; shortage?: number; sufficient?: boolean
}
type Prod = {
  id: number; prod_number: string; product_sku: string; product_name: string
  planned_qty: number; produced_qty: number; status: string
  planned_start: string; planned_end: string; remark: string; created_at: string
  bom_id?: number; customer_order_id?: number
  materials?: ProdMat[]
}
type CustomerOrder = { id: number; po_number: string; customer_name: string }
type BOM = { id: number; product_sku: string; product_name: string }

const STATUS_MAP: Record<string, { label: string; badge: string }> = {
  draft:       { label: '待確認',   badge: 'badge-gray'   },
  confirmed:   { label: '已建立',   badge: 'badge-blue'   },
  shortage:    { label: '缺料',     badge: 'badge-red'    },
  ready:       { label: '材料齊',   badge: 'badge-yellow' },
  in_progress: { label: '生產中',   badge: 'badge-purple' },
  completed:   { label: '完工',     badge: 'badge-green'  },
  cancelled:   { label: '作廢',     badge: 'badge-gray'   },
}

export default function ProductionPage() {
  const { toast, confirm: confirmDialog } = useDialog()
  const [prods, setProds] = useState<Prod[]>([])
  const [boms, setBoms] = useState<BOM[]>([])
  const [orders, setOrders] = useState<CustomerOrder[]>([])
  const [editing, setEditing] = useState<Prod | null>(null)
  const [editForm, setEditForm] = useState({ bom_id: '', product_sku: '', product_name: '', planned_qty: 1, planned_start: '', planned_end: '', remark: '', customer_order_id: '' })
  const [creating, setCreating] = useState(false)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const [loadedProds, setLoadedProds] = useState<Record<number, Prod>>({})
  const canWrite = can('production.create')
  const canDel = can('production.delete')

  // Create form
  const [step, setStep] = useState<1 | 2>(1)
  const [form, setForm] = useState({
    customer_order_id: '', bom_id: '', product_sku: '', product_name: '',
    planned_qty: 1, planned_start: '', planned_end: '', remark: ''
  })
  const [stockCheck, setStockCheck] = useState<{ items: ProdMat[]; has_shortage: boolean; status: string } | null>(null)
  const [checking, setChecking] = useState(false)

  const load = () => apiFetch<Prod[]>('/api/production').then(setProds).finally(() => setLoading(false))
  useEffect(() => {
    load()
    apiFetch<BOM[]>('/api/bom').then(setBoms).catch(() => {})
    apiFetch<CustomerOrder[]>('/api/customer-orders').then(setOrders).catch(() => {})
  }, [])

  const onSelectBOM = (bomId: string) => {
    const bom = boms.find(b => String(b.id) === bomId)
    setForm(p => ({ ...p, bom_id: bomId, product_sku: bom?.product_sku || '', product_name: bom?.product_name || '' }))
    setStockCheck(null)
  }

  const checkStock = async () => {
    if (!form.bom_id) { toast('請先選擇 BOM', 'error'); return }
    setChecking(true)
    try {
      const result = await apiFetch<any>('/api/production/check-stock', {
        method: 'POST',
        body: JSON.stringify({ bom_id: form.bom_id, planned_qty: form.planned_qty })
      })
      setStockCheck(result)
      setStep(2)
    } catch (e: any) { toast('庫存檢查失敗：' + e.message, 'error') }
    finally { setChecking(false) }
  }

  const save = async () => {
    if (!form.product_name) { toast('請填寫產品名稱', 'error'); return }
    try {
      const materials = stockCheck?.items.map(i => ({
        material_code: i.material_code, material_name: i.material_name,
        spec: i.spec, unit: i.unit, planned_qty: i.planned_qty,
        issued_qty: 0, batch_no: '', remark: ''
      })) || []
      const initialStatus = stockCheck?.has_shortage ? 'shortage' : 'confirmed'
      await apiFetch('/api/production', {
        method: 'POST',
        body: JSON.stringify({ ...form, materials, initial_status: initialStatus })
      })
      toast('生產單建立成功')
      setCreating(false); setStep(1)
      setForm({ customer_order_id: '', bom_id: '', product_sku: '', product_name: '', planned_qty: 1, planned_start: '', planned_end: '', remark: '' })
      setStockCheck(null)
      load()
    } catch (e: any) { toast('錯誤：' + e.message, 'error') }
  }

  const changeStatus = async (id: number, status: string, producedQty?: number) => {
    const labels: Record<string, string> = {
      confirmed:   '確認建立此生產單？',
      shortage:    '標記為缺料狀態？',
      ready:       '確認材料已齊備？',
      in_progress: '開始生產（將進入生產中狀態）？',
      completed:   '確認完工？完工後將扣減材料庫存',
      cancelled:   '確定作廢此生產單？此操作不可撤銷',
    }
    const btnLabels: Record<string, string> = {
      confirmed: '確認建立', shortage: '標記缺料', ready: '確認齊備',
      in_progress: '開始生產', completed: '確認完工', cancelled: '確認作廢',
    }
    if (!await confirmDialog(labels[status] || `確定切換狀態？`, '', btnLabels[status] || '確認')) return
    try {
      await apiFetch(`/api/production/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status, produced_qty: producedQty }) })
      toast('狀態已更新')
      await load()
    } catch (e: any) { toast(e.message, 'error') }
  }

  const del = async (id: number, prodNumber?: string) => {
    if (!await confirmDialog('確定刪除此生產單？', prodNumber ? `單號：${prodNumber}` : '')) return
    try { await apiFetch(`/api/production/${id}`, { method: 'DELETE' })
      await load() }
    catch (e: any) { toast(e.message, 'error') }
  }

  const printProd = async (prod: Prod) => {
    const txt = (v: any) => {
      if (v === null || v === undefined) return ''
      const s = String(v).trim()
      if (!s || s === 'null' || s === 'undefined' || s === '—' || s === '-') return ''
      return s
    }
    const num = (v: any) => {
      const n = Number(v)
      return Number.isFinite(n) ? n : 0
    }
    const fmt = (v: any) => num(v).toLocaleString()

    const detail = loadedProds[prod.id] || await apiFetch<Prod>(`/api/production/${prod.id}`)
    const company = await getCompany()
    const mats = detail.materials || []
    const rows = mats.map((m, i) => `
      <tr>
        <td style="border:1px solid #bbb;padding:6px;text-align:center">${i + 1}</td>
        <td style="border:1px solid #bbb;padding:6px;font-family:monospace">${txt(m.material_code)}</td>
        <td style="border:1px solid #bbb;padding:6px">${txt(m.material_name)}</td>
        <td style="border:1px solid #bbb;padding:6px">${txt(m.spec)}</td>
        <td style="border:1px solid #bbb;padding:6px;text-align:center">${txt(m.unit) || 'PCS'}</td>
        <td style="border:1px solid #bbb;padding:6px;text-align:right">${fmt(m.planned_qty)}</td>
        <td style="border:1px solid #bbb;padding:6px;text-align:right">${fmt(m.issued_qty)}</td>
      </tr>
    `).join('')
    const html = `<!DOCTYPE html><html lang="zh-TW"><head><meta charset="utf-8"/>
    <title>生產單 ${prod.prod_number}</title>
    <style>
      *{box-sizing:border-box} body{font-family:"Microsoft JhengHei","PingFang TC",Arial,sans-serif;font-size:12px;padding:12mm;color:#111}
      h1{font-size:24px;margin:0 0 4px} .sub{font-size:12px;color:#666;margin-bottom:10px}
      table{width:100%;border-collapse:collapse} th{border:1px solid #555;background:#eee;padding:6px;font-size:11px}
      @media print{@page{size:A4;margin:10mm} body{padding:0}}
    </style></head><body>
    <h1>${txt(company.company_name) || 'FAN YONG CO., LTD'}</h1>
    <div class="sub">${txt(company.company_name_local)}</div>
    <h2 style="font-size:20px;margin:8px 0 10px">生產單</h2>
    <div style="margin-bottom:10px">單號：<b>${txt(prod.prod_number)}</b>　產品：<b>${txt(prod.product_name)}</b>　狀態：<b>${txt(STATUS_MAP[prod.status]?.label || prod.status)}</b></div>
    <div style="margin-bottom:10px">計畫數量：${fmt(prod.planned_qty)}　已完成：${fmt(prod.produced_qty)}　期間：${prod.planned_start ? String(prod.planned_start).slice(0,10) : ''} ~ ${prod.planned_end ? String(prod.planned_end).slice(0,10) : ''}</div>
    <table>
      <thead><tr><th style="width:40px">序</th><th>料號</th><th>材料名稱</th><th>規格</th><th style="width:60px">單位</th><th style="width:90px">計劃用量</th><th style="width:90px">實際領料</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="7" style="border:1px solid #bbb;padding:8px;text-align:center;color:#666">無材料明細</td></tr>'}</tbody>
    </table>
    </body></html>`
    const w = window.open('', '_blank', 'width=860,height=1000')
    if (!w) { toast('瀏覽器已封鎖彈出視窗，請允許後再列印', 'error'); return }
    w.document.write(html); w.document.close(); setTimeout(() => w.print(), 500)
  }

  const startEditProd = async (prod: Prod) => {
    const matchedBom =
      (prod.bom_id ? boms.find(b => b.id === prod.bom_id) : undefined) ||
      (prod.product_sku ? boms.find(b => b.product_sku === prod.product_sku) : undefined)
    setEditForm({
      bom_id: prod.bom_id ? String(prod.bom_id) : (matchedBom ? String(matchedBom.id) : ''),
      product_sku: prod.product_sku || matchedBom?.product_sku || '',
      product_name: prod.product_name || matchedBom?.product_name || '',
      planned_qty: prod.planned_qty,
      planned_start: prod.planned_start ? String(prod.planned_start).slice(0,10) : '',
      planned_end: prod.planned_end ? String(prod.planned_end).slice(0,10) : '',
      remark: prod.remark || '',
      customer_order_id: prod.customer_order_id ? String(prod.customer_order_id) : '',
    })
    setEditing(prod)
  }

  const saveEditProd = async () => {
    if (!editing) return
    try {
      await apiFetch(`/api/production/${editing.id}`, { method: 'PUT', body: JSON.stringify(editForm) })
      toast('生產單已更新')
      setEditing(null)
      load()
    } catch (e: any) { toast('更新失敗：' + e.message, 'error') }
  }

  const filtered = prods.filter(p => {
    const matchSearch = !search || p.prod_number.toLowerCase().includes(search.toLowerCase()) || p.product_name.toLowerCase().includes(search.toLowerCase())
    const matchStatus = !statusFilter || p.status === statusFilter
    return matchSearch && matchStatus
  })
  const { page, setPage, totalPages, paged, total } = usePagination(filtered, 20)

  const shortageItems = stockCheck?.items.filter(i => !i.sufficient) || []

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-slate-800">生產單管理</h1>
          <p className="section-hint">選擇成品 BOM → 自動展開材料 → 庫存檢查 → 建立生產單</p>
        </div>
        {canWrite && <button onClick={() => { setCreating(true); setStep(1) }} className="btn-primary">+ 建立生產單</button>}
      </div>

      {creating && (
        <div className="oms-card p-6 mb-5">
          {/* Step indicator */}
          <div className="flex items-center gap-3 mb-6">
            <div className={`flex items-center gap-2 text-sm font-medium ${step === 1 ? 'text-blue-600' : 'text-slate-400'}`}>
              <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${step === 1 ? 'bg-blue-600 text-white' : 'bg-slate-200 text-slate-500'}`}>1</span>
              選擇成品 & 數量
            </div>
            <div className="flex-1 h-px bg-slate-200" />
            <div className={`flex items-center gap-2 text-sm font-medium ${step === 2 ? 'text-blue-600' : 'text-slate-400'}`}>
              <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${step === 2 ? 'bg-blue-600 text-white' : 'bg-slate-200 text-slate-500'}`}>2</span>
              庫存檢查 & 確認
            </div>
          </div>

          {step === 1 && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1.5">選擇成品 BOM *</label>
                  <select className="oms-input" value={form.bom_id} onChange={e => onSelectBOM(e.target.value)}>
                    <option value="">-- 選擇要生產的成品 --</option>
                    {boms.map(b => <option key={b.id} value={String(b.id)}>{b.product_sku} — {b.product_name}</option>)}
                  </select>
                  {form.product_name && <p className="text-xs text-blue-600 mt-1">✓ {form.product_name}</p>}
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1.5">生產數量 *</label>
                  <input type="number" min="1" className="oms-input" value={form.planned_qty}
                    onChange={e => { setForm(p => ({ ...p, planned_qty: Number(e.target.value) })); setStockCheck(null) }} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1.5">關聯客戶訂單（選填）</label>
                  <select className="oms-input" value={form.customer_order_id} onChange={e => setForm(p => ({ ...p, customer_order_id: e.target.value }))}>
                    <option value="">-- 選擇客戶訂單 --</option>
                    {orders.map(o => <option key={o.id} value={String(o.id)}>{o.po_number} - {o.customer_name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1.5">備註</label>
                  <input className="oms-input" value={form.remark} onChange={e => setForm(p => ({ ...p, remark: e.target.value }))} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1.5">計劃開始</label>
                  <input type="date" className="oms-input" value={form.planned_start} onChange={e => setForm(p => ({ ...p, planned_start: e.target.value }))} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1.5">計劃完成</label>
                  <input type="date" className="oms-input" value={form.planned_end} onChange={e => setForm(p => ({ ...p, planned_end: e.target.value }))} />
                </div>
              </div>
              <div className="flex gap-3 pt-2">
                <button onClick={checkStock} disabled={!form.bom_id || checking} className="btn-primary">
                  {checking ? '檢查中...' : '→ 下一步：檢查庫存'}
                </button>
                <button onClick={() => { setCreating(false); setStep(1) }} className="btn-ghost border border-slate-200">取消</button>
              </div>
            </div>
          )}

          {step === 2 && stockCheck && (
            <div>
              {/* Stock check result */}
              <div className={`mb-4 px-4 py-3 rounded-xl border ${stockCheck.has_shortage ? 'bg-red-50 border-red-200' : 'bg-emerald-50 border-emerald-200'}`}>
                <div className={`text-sm font-semibold ${stockCheck.has_shortage ? 'text-red-700' : 'text-emerald-700'}`}>
                  {stockCheck.has_shortage
                    ? `⚠ 庫存不足 — ${shortageItems.length} 項材料缺料，建立後狀態為「缺料」`
                    : '✓ 庫存充足 — 所有材料庫存足夠，建立後狀態為「已建立」'}
                </div>
                <div className="text-xs text-slate-500 mt-0.5">成品：{form.product_name} | 生產數量：{form.planned_qty}</div>
              </div>

              {/* Materials table */}
              <div className="border border-slate-200 rounded-lg overflow-hidden mb-4">
                <table className="w-full text-xs">
                  <thead><tr className="bg-slate-50 border-b border-slate-200">
                    <th className="px-3 py-2 text-left text-[10px] font-semibold text-slate-500 uppercase">料號</th>
                    <th className="px-3 py-2 text-left text-[10px] font-semibold text-slate-500 uppercase">材料名稱</th>
                    <th className="px-3 py-2 text-left text-[10px] font-semibold text-slate-500 uppercase">規格</th>
                    <th className="px-3 py-2 text-left text-[10px] font-semibold text-slate-500 uppercase">單位</th>
                    <th className="px-3 py-2 text-right text-[10px] font-semibold text-slate-500 uppercase">需用量</th>
                    <th className="px-3 py-2 text-right text-[10px] font-semibold text-slate-500 uppercase">庫存</th>
                    <th className="px-3 py-2 text-right text-[10px] font-semibold text-slate-500 uppercase">缺料</th>
                    <th className="px-3 py-2 text-center text-[10px] font-semibold text-slate-500 uppercase">狀態</th>
                  </tr></thead>
                  <tbody>
                    {stockCheck.items.map((item, i) => (
                      <tr key={i} className={`border-b border-slate-100 last:border-0 ${!item.sufficient ? 'bg-red-50/50' : ''}`}>
                        <td className="px-3 py-2 font-mono text-blue-600">{item.material_code}</td>
                        <td className="px-3 py-2 font-medium text-slate-700">{item.material_name}</td>
                        <td className="px-3 py-2 text-slate-500">{item.spec}</td>
                        <td className="px-3 py-2 text-slate-500">{item.unit}</td>
                        <td className="px-3 py-2 text-right font-medium">{item.planned_qty}</td>
                        <td className={`px-3 py-2 text-right font-medium ${item.sufficient ? 'text-emerald-600' : 'text-red-500'}`}>{item.current_stock}</td>
                        <td className={`px-3 py-2 text-right font-bold ${item.shortage ? 'text-red-600' : 'text-slate-300'}`}>
                          {item.shortage ? `-${item.shortage}` : '—'}
                        </td>
                        <td className="px-3 py-2 text-center">
                          {item.sufficient
                            ? <span className="badge-green">充足</span>
                            : <span className="badge-red">缺料</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex gap-3">
                <button onClick={save} className="btn-primary">建立生產單</button>
                <button onClick={() => setStep(1)} className="btn-ghost border border-slate-200">← 返回修改</button>
                <button onClick={() => { setCreating(false); setStep(1); setStockCheck(null) }} className="btn-ghost">取消</button>
              </div>
            </div>
          )}
        </div>
      )}

      {editing && canWrite && (
        <div className="oms-card p-6 mb-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-bold">編輯生產單 {editing.prod_number}</h2>
              <button onClick={() => setEditing(null)} className="btn-ghost border border-slate-200">返回列表</button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1.5 flex items-center gap-1.5">
                  成品 BOM
                  <FieldLockHint title="生產單建立後不可更換 BOM" />
                </label>
                <select className="oms-input bg-slate-100 text-slate-500 border-slate-200 cursor-not-allowed" value={editForm.bom_id} disabled onChange={e => {
                  const bom = boms.find(b => String(b.id) === e.target.value)
                  setEditForm(p => ({ ...p, bom_id: e.target.value, product_sku: bom?.product_sku || p.product_sku, product_name: bom?.product_name || p.product_name }))
                }}>
                  <option value="">-- 選擇 BOM --</option>
                  {boms.map(b => <option key={b.id} value={String(b.id)}>{b.product_sku} — {b.product_name}</option>)}
                </select>
                <p className="text-[10px] text-slate-400 mt-1">生產單建立後不可更換 BOM</p>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1.5">生產數量</label>
                <input type="number" min="1" className="oms-input" value={editForm.planned_qty} onChange={e => setEditForm(p => ({ ...p, planned_qty: Number(e.target.value) }))} />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1.5">計劃開始</label>
                <input type="date" className="oms-input" value={editForm.planned_start} onChange={e => setEditForm(p => ({ ...p, planned_start: e.target.value }))} />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1.5">計劃完成</label>
                <input type="date" className="oms-input" value={editForm.planned_end} onChange={e => setEditForm(p => ({ ...p, planned_end: e.target.value }))} />
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-medium text-slate-600 mb-1.5">備註</label>
                <input className="oms-input" value={editForm.remark} onChange={e => setEditForm(p => ({ ...p, remark: e.target.value }))} />
              </div>
            </div>
            <div className="flex gap-2 mt-4">
              <button onClick={saveEditProd} className="btn-primary">儲存修改</button>
              <button onClick={() => setEditing(null)} className="btn-ghost border border-slate-200">取消</button>
            </div>
        </div>
      )}

      {!creating && !editing && (
      <>
      <div className="list-controls">
        <input className="list-search" placeholder="搜尋生產單號或產品名稱..." value={search} onChange={e => setSearch(e.target.value)} />
        <div className="flex gap-1">
          {[['', '全部'], ['draft', '待確認'], ['confirmed', '已建立'], ['shortage', '缺料'], ['ready', '材料齊'], ['in_progress', '生產中'], ['completed', '完工']].map(([val, label]) => (
            <button key={val} onClick={() => setStatusFilter(val)}
              className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${statusFilter === val ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300'}`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="oms-card overflow-hidden">
        {loading ? <div className="flex justify-center py-16"><div className="w-5 h-5 border-2 border-blue-200 border-t-blue-600 rounded-full animate-spin" /></div> : (
          <>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200">
                  <th className="w-8" />
                  {['生產單號','產品名稱','計劃數量','已完成','計劃日期','狀態','操作'].map(h => (
                    <th key={h} className="px-3 py-3 text-left text-[11px] font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {paged.map(p => {
                  const isOpen = expanded.has(p.id)
                  return (
                    <>
                      <tr key={p.id}
                        className={`border-b border-slate-100 cursor-pointer transition-colors ${isOpen ? 'bg-slate-50' : 'hover:bg-slate-50'}`}
                        onClick={() => {
                          const n = new Set(expanded)
                          if (n.has(p.id)) { n.delete(p.id) }
                          else {
                            n.add(p.id)
                            if (!loadedProds[p.id]) {
                              apiFetch<Prod>(`/api/production/${p.id}`).then(d => setLoadedProds(prev => ({ ...prev, [p.id]: d })))
                            }
                          }
                          setExpanded(n)
                        }}>
                        <td className="pl-3 py-2.5">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                            className={`w-3.5 h-3.5 text-slate-400 transition-transform duration-200 ${isOpen ? 'rotate-90' : ''}`}>
                            <polyline points="9 18 15 12 9 6" />
                          </svg>
                        </td>
                        <td className="px-3 py-2.5 font-mono text-xs text-blue-600 whitespace-nowrap">{p.prod_number}</td>
                        <td className="px-3 py-2.5 font-medium max-w-[200px] truncate" title={p.product_name}>{p.product_name}</td>
                        <td className="px-3 py-2.5 text-right text-slate-600">{Number(p.planned_qty).toLocaleString()}</td>
                        <td className="px-3 py-2.5 text-right text-emerald-600">{Number(p.produced_qty||0).toLocaleString()}</td>
                        <td className="px-3 py-2.5 text-slate-400 text-xs whitespace-nowrap">
                          {p.planned_start ? String(p.planned_start).slice(0,10) : '—'}
                          {p.planned_end ? ` ~ ${String(p.planned_end).slice(0,10)}` : ''}
                        </td>
                        <td className="px-3 py-2.5"><span className={STATUS_MAP[p.status]?.badge}>{STATUS_MAP[p.status]?.label}</span></td>
                        <td className="px-3 py-2.5" onClick={e => e.stopPropagation()}>
                          <div className="flex gap-1 items-center">
                            <StatusFlow compact steps={PROD_STEPS} current={p.status}
                              actions={getProdActions(p.status)}
                              onAction={(toStatus) => changeStatus(p.id, toStatus, toStatus === 'completed' ? p.planned_qty : undefined)} />
                            <button onClick={e => { e.stopPropagation(); printProd(p) }} className="btn-ghost" title="列印">🖨 列印</button>
                            {canWrite && ['draft','confirmed','shortage'].includes(p.status) && (
                              <button onClick={e => { e.stopPropagation(); startEditProd(p) }} className="btn-ghost text-blue-600">✏ 編輯</button>
                            )}
                            {canDel && (
                              <button onClick={e => { e.stopPropagation(); del(p.id, p.prod_number) }} className="btn-danger">刪除</button>
                            )}
                          </div>
                        </td>
                      </tr>
                      {isOpen && (
                        <tr key={`${p.id}-detail`} className="border-b border-slate-100">
                          <td colSpan={8} className="px-0 py-0">
                            <div className="expand-row-wrap">
                              {/* Materials table */}
                              {(() => {
                                const detail = loadedProds[p.id]
                                if (!detail) return <div className="px-4 py-3 text-xs text-slate-400 flex items-center gap-2"><div className="w-3 h-3 border border-slate-300 border-t-slate-500 rounded-full animate-spin"/>載入中...</div>
                                const mats = detail.materials || []
                                return mats.length > 0 ? (
                                <div className="overflow-x-auto">
                                  <table className="w-full text-xs" style={{minWidth:500}}>
                                    <thead><tr className="border-b border-slate-100">
                                      {['料號','材料名稱','規格','單位','計劃用量','實際領料'].map(h => (
                                        <th key={h} className="px-3 py-2 text-left text-[10px] font-semibold text-slate-500 uppercase whitespace-nowrap">{h}</th>
                                      ))}
                                    </tr></thead>
                                    <tbody>
                                      {mats.map((mat, i) => (
                                        <tr key={i} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                                          <td className="px-3 py-2 font-mono text-xs text-blue-600">{mat.material_code}</td>
                                          <td className="px-3 py-2 text-slate-700">{mat.material_name}</td>
                                          <td className="px-3 py-2 text-slate-400">{mat.spec}</td>
                                          <td className="px-3 py-2 text-slate-500">{mat.unit}</td>
                                          <td className="px-3 py-2 text-right">{mat.planned_qty}</td>
                                          <td className="px-3 py-2 text-right text-emerald-600 font-semibold">{mat.issued_qty}</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              ) : (
                                <div className="px-4 py-3 text-xs text-slate-400">
                                  {detail.remark ? `備註：${detail.remark}` : '無材料明細'}
                                </div>
                              )
                              })()}
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  )
                })}
                {paged.length === 0 && <tr><td colSpan={8} className="text-center py-12 text-slate-400">尚無生產單</td></tr>}
              </tbody>
            </table>
            <Pagination page={page} totalPages={totalPages} setPage={setPage} total={total} />
          </>
        )}
      </div>
      </>
      )}
    </div>
  )
}
