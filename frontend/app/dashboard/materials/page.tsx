'use client'

import { useEffect, useState } from 'react'
import { useDialog } from '@/components/Dialog'
import { API, apiFetch, apiFetchRaw } from '@/lib/api'
import { can } from '@/lib/usePermissions'
import { usePagination, Pagination } from '@/lib/usePagination'
import { UNIT_OPTIONS, normalizeUnit } from '@/lib/units'
import { normalizeMoqTiers, type MoqTier } from '@/lib/moqPricing'
import { formatDecimal, formatInteger } from '@/lib/numberFormat'
import DecimalInput from '@/components/DecimalInput'
import { useRefreshOnFocus } from '@/lib/useRefreshOnFocus'

type Material = {
  id: number
  material_code: string
  material_name: string
  spec: string
  unit: string
  category: string
  product_category: string
  supplier_id: number | null
  supplier_name?: string
  supplier_price: number
  company_price: number
  currency: string
  stock: number
  image_url: string
  color?: string
  leadtime_days?: number | null
  leadtime?: string
  moq?: number | null
  moq_tiers?: MoqTier[]
  remark?: string
  created_at: string
}

type Supplier = { id: number; name: string; currency: string }

const emptyTier = (): MoqTier => ({ moq: 0, price: 0 })
const emptyTiers = (count = 1): MoqTier[] => Array.from({ length: Math.min(5, Math.max(1, count)) }, emptyTier)
const ensureTierList = (tiers: any): MoqTier[] => {
  const normalized = normalizeMoqTiers(tiers)
  return normalized.length ? normalized.slice(0, 5) : emptyTiers()
}
const empty = (): Partial<Material> => ({
  material_code: '',
  material_name: '',
  spec: '',
  unit: 'PCS',
  category: '',
  product_category: '',
  supplier_id: null,
  supplier_price: undefined,
  company_price: undefined,
  currency: 'VND',
  stock: 0,
  image_url: '',
  color: '',
  leadtime_days: null,
  leadtime: '',
  moq: null,
  moq_tiers: emptyTiers(),
  remark: '',
})

export default function MaterialsPage() {
  const { toast, confirm: confirmDialog } = useDialog()
  const [rows, setRows] = useState<Material[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [editing, setEditing] = useState<Partial<Material> | null>(null)
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [search, setSearch] = useState('')
  const [supplierPriceInput, setSupplierPriceInput] = useState('')
  const [companyPriceInput, setCompanyPriceInput] = useState('')
  const canWrite = can('bom.create')
  const canEdit = can('bom.edit')
  const canDel = can('bom.delete')

  const refreshAll = async (showSpinner = false) => {
    if (showSpinner) setLoading(true)
    try {
      const [materialRows, supplierRows] = await Promise.all([
        apiFetch<Material[]>('/api/materials'),
        apiFetch<Supplier[]>('/api/suppliers'),
      ])
      setRows(materialRows || [])
      setSuppliers(supplierRows || [])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refreshAll(true)
  }, [])

  useRefreshOnFocus(() => refreshAll(false))

  useEffect(() => {
    if (!editing) {
      setSupplierPriceInput('')
      setCompanyPriceInput('')
      return
    }
    setSupplierPriceInput(editing.supplier_price == null ? '' : formatDecimal(editing.supplier_price))
    setCompanyPriceInput(editing.company_price == null ? '' : formatDecimal(editing.company_price))
  }, [editing?.id, editing?.material_code])

  const normalizeMoneyInput = (raw: string) => raw.trim()
  const parseMoney = (raw: string) => {
    const t = raw.trim().replace(/,/g, '')
    if (!t) return undefined
    if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(t)) return null
    const n = Number(t)
    if (!Number.isFinite(n) || n < 0) return null
    return n
  }

  const bindMoney = (field: 'supplier_price' | 'company_price', raw: string) => {
    const next = normalizeMoneyInput(raw)
    if (field === 'supplier_price') setSupplierPriceInput(next)
    else setCompanyPriceInput(next)
    setEditing((p) => {
      if (!p) return p
      if (!next) return { ...p, [field]: undefined }
      const n = parseMoney(next)
      if (n === null || n === undefined) return p
      return { ...p, [field]: n }
    })
  }

  const blurMoney = (field: 'supplier_price' | 'company_price') => {
    const current = field === 'supplier_price' ? supplierPriceInput : companyPriceInput
    if (!current) return
    const n = parseMoney(current)
    if (n === null || n === undefined) return
    const normalized = formatDecimal(n)
    if (field === 'supplier_price') setSupplierPriceInput(normalized)
    else setCompanyPriceInput(normalized)
  }

  const uploadImage = async (file: File) => {
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await apiFetchRaw('/api/upload', { method: 'POST', body: fd })
      if (!res.ok) throw new Error('上傳失敗')
      const body = await res.json()
      return body.url || ''
    } finally {
      setUploading(false)
    }
  }

  const save = async () => {
    if (!editing) return
    if (!String(editing.material_code || '').trim()) {
      toast('請填寫物料編號', 'error')
      return
    }
    if (!String(editing.material_name || '').trim()) {
      toast('請填寫材料名稱', 'error')
      return
    }
    try {
      if (editing.id) {
        await apiFetch(`/api/materials/${editing.id}`, { method: 'PUT', body: JSON.stringify(editing) })
        toast('材料更新成功')
      } else {
        await apiFetch('/api/materials', { method: 'POST', body: JSON.stringify(editing) })
        toast('材料建立成功')
      }
      setEditing(null)
      await refreshAll(false)
    } catch (e: any) {
      toast(`儲存失敗：${e.message}`, 'error')
    }
  }

  const del = async (id: number) => {
    if (!await confirmDialog('確定刪除此材料？')) return
    try {
      await apiFetch(`/api/materials/${id}`, { method: 'DELETE' })
      toast('已刪除')
      await refreshAll(false)
    } catch (e: any) {
      toast(`刪除失敗：${e.message}`, 'error')
    }
  }

  const filtered = rows.filter((r) => {
    if (!search.trim()) return true
    const q = search.trim().toLowerCase()
    return (
      String(r.material_code || '').toLowerCase().includes(q)
      || String(r.material_name || '').toLowerCase().includes(q)
      || String(r.spec || '').toLowerCase().includes(q)
      || String(r.supplier_name || '').toLowerCase().includes(q)
    )
  })
  const { page, setPage, totalPages, paged, total } = usePagination(filtered, 10)

  const onSupplierChange = (supplierId: string) => {
    const sup = suppliers.find((s) => String(s.id) === supplierId)
    setEditing((p) => ({
      ...p,
      supplier_id: supplierId ? Number(supplierId) : null,
      currency: sup?.currency || p?.currency || 'VND',
    }))
  }
  const updateTier = (tierIdx:number, field:'moq'|'price', val:number) => {
    setEditing((p) => {
      const tiers = Array.isArray(p?.moq_tiers) && p.moq_tiers.length ? [...p.moq_tiers] : emptyTiers()
      tiers[tierIdx] = { ...(tiers[tierIdx] || { moq: 0, price: 0 }), [field]: Math.max(0, Number(val) || 0) }
      return { ...p, moq_tiers: tiers }
    })
  }
  const addTier = () => {
    setEditing((p) => {
      const tiers = Array.isArray(p?.moq_tiers) && p.moq_tiers.length ? [...p.moq_tiers] : emptyTiers()
      if (tiers.length >= 5) return p
      return { ...p, moq_tiers: [...tiers, emptyTier()] }
    })
  }
  const removeTier = (tierIdx:number) => {
    setEditing((p) => {
      const tiers = Array.isArray(p?.moq_tiers) && p.moq_tiers.length ? [...p.moq_tiers] : emptyTiers()
      if (tiers.length <= 1) return p
      return { ...p, moq_tiers: tiers.filter((_, idx) => idx !== tierIdx) }
    })
  }
  const tierSummary = (r: Material) => {
    const tiers = normalizeMoqTiers(r.moq_tiers)
    if (!tiers.length) return r.moq ? `MOQ ${formatInteger(r.moq)}` : '—'
    return tiers.map((t) => `${formatInteger(t.moq)}/${formatDecimal(t.price)}`).join(' | ')
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-slate-800">材料管理</h1>
          <p className="text-xs text-slate-500 mt-0.5">物料編號、顏色、Leadtime、MOQ、供應商單價</p>
        </div>
        {canWrite && <button onClick={() => setEditing(empty())} className="btn-primary">+ 新增材料</button>}
      </div>

      {editing && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-2xl shadow-xl w-full max-w-3xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
              <h2 className="text-base font-semibold text-slate-800">{editing.id ? '編輯材料' : '新增材料'}</h2>
              <button onClick={() => setEditing(null)} className="text-slate-400 hover:text-slate-600 text-xl leading-none">✕</button>
            </div>
            <div className="p-6 grid grid-cols-2 gap-4">
              <div>
                <label className="block text-[11px] text-slate-500 mb-1.5">物料編號 *</label>
                <input className="rubber-input" value={editing.material_code || ''} onChange={(e) => setEditing((p) => ({ ...p, material_code: e.target.value }))} />
                {editing.id && <p className="mt-1 text-[10px] leading-4 text-amber-600">若已被既有 BOM、採購、出貨、進貨或庫存資料引用，物料編號無法直接修改。</p>}
              </div>
              <div>
                <label className="block text-[11px] text-slate-500 mb-1.5">材料名稱 *</label>
                <input className="rubber-input" value={editing.material_name || ''} onChange={(e) => setEditing((p) => ({ ...p, material_name: e.target.value }))} />
              </div>
              <div>
                <label className="block text-[11px] text-slate-500 mb-1.5">規格</label>
                <input className="rubber-input" value={editing.spec || ''} onChange={(e) => setEditing((p) => ({ ...p, spec: e.target.value }))} />
              </div>
              <div>
                <label className="block text-[11px] text-slate-500 mb-1.5">顏色</label>
                <input className="rubber-input" value={editing.color || ''} onChange={(e) => setEditing((p) => ({ ...p, color: e.target.value }))} />
              </div>
              <div>
                <label className="block text-[11px] text-slate-500 mb-1.5">單位</label>
                <select className="rubber-input" value={normalizeUnit(editing.unit)} onChange={(e) => setEditing((p) => ({ ...p, unit: e.target.value }))}>
                  {UNIT_OPTIONS.map((u) => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[11px] text-slate-500 mb-1.5">供應商</label>
                <select className="rubber-input" value={editing.supplier_id != null ? String(editing.supplier_id) : ''} onChange={(e) => onSupplierChange(e.target.value)}>
                  <option value="">-- 選擇供應商 --</option>
                  {suppliers.map((s) => <option key={s.id} value={String(s.id)}>{s.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[11px] text-slate-500 mb-1.5">供應商單價</label>
                <input
                  type="text"
                  inputMode="decimal"
                  className="rubber-input"
                  value={supplierPriceInput}
                  onChange={(e) => bindMoney('supplier_price', e.target.value)}
                  onBlur={() => blurMoney('supplier_price')}
                />
              </div>
              <div>
                <label className="block text-[11px] text-slate-500 mb-1.5">銷售單價</label>
                <input
                  type="text"
                  inputMode="decimal"
                  className="rubber-input"
                  value={companyPriceInput}
                  onChange={(e) => bindMoney('company_price', e.target.value)}
                  onBlur={() => blurMoney('company_price')}
                />
              </div>
              <div>
                <label className="block text-[11px] text-slate-500 mb-1.5">Leadtime（天）</label>
                <input className="rubber-input" placeholder="例如：25~30 或 15-20" value={editing.leadtime ?? (editing.leadtime_days != null ? String(editing.leadtime_days) : '')} onChange={(e) => setEditing((p) => ({ ...p, leadtime: e.target.value, leadtime_days: null }))} />
              </div>
              <div className="col-span-2">
                <div className="mb-1.5 flex items-center justify-between gap-3">
                  <label className="block text-[11px] text-slate-500">MOQ 階梯價格（數量 / 單價）</label>
                  <button type="button" className="btn-ghost text-blue-600 shrink-0" onClick={addTier} disabled={(editing.moq_tiers || []).length >= 5}>+ 新增 MOQ</button>
                </div>
                <div className="rounded-xl border border-slate-200 p-3 space-y-1.5 bg-slate-50/50">
                  {(editing.moq_tiers || emptyTiers()).map((tier, i) => (
                    <div key={i} className="grid grid-cols-[26px_1fr_1fr_auto] gap-2 items-center">
                      <span className="text-[10px] text-slate-400 text-center">#{i + 1}</span>
                      <input
                        type="number"
                        className="rubber-input"
                        placeholder="MOQ"
                        value={tier.moq || ''}
                        onChange={e=>updateTier(i, 'moq', Number(e.target.value))}
                      />
                      <DecimalInput
                        className="rubber-input"
                        placeholder="單價"
                        value={tier.price}
                        onValueChange={(value) => updateTier(i, 'price', value ?? 0)}
                      />
                      <button
                        type="button"
                        className="text-xs text-slate-400 transition hover:text-red-600 disabled:cursor-not-allowed disabled:text-slate-300"
                        onClick={() => removeTier(i)}
                        disabled={(editing.moq_tiers || []).length <= 1}
                      >
                        刪除
                      </button>
                    </div>
                  ))}
                </div>
                <p className="text-[10px] text-slate-400 mt-1">同一材料可設定最多 5 組 MOQ 階梯，至少保留 1 組</p>
              </div>
              <div>
                <label className="block text-[11px] text-slate-500 mb-1.5">幣別</label>
                <select className="rubber-input" value={editing.currency || 'VND'} onChange={(e) => setEditing((p) => ({ ...p, currency: e.target.value }))}>
                  <option>VND</option><option>TWD</option><option>USD</option><option>CNY</option>
                </select>
              </div>
              <div>
                <label className="block text-[11px] text-slate-500 mb-1.5">分類</label>
                <input className="rubber-input" value={editing.category || ''} onChange={(e) => setEditing((p) => ({ ...p, category: e.target.value }))} />
              </div>
              <div className="col-span-2">
                <label className="block text-[11px] text-slate-500 mb-1.5">備註</label>
                <textarea className="rubber-input min-h-20" value={editing.remark || ''} onChange={(e) => setEditing((p) => ({ ...p, remark: e.target.value }))} />
              </div>
              <div className="col-span-2">
                <label className="block text-[11px] text-slate-500 mb-1.5">圖片</label>
                <div className="flex items-center gap-3">
                  {editing.image_url ? <img src={editing.image_url} alt="" className="w-12 h-12 rounded object-cover border" /> : null}
                  <input type="file" accept="image/*" onChange={async (e) => {
                    const f = e.target.files?.[0]
                    if (!f) return
                    const url = await uploadImage(f)
                    setEditing((p) => ({ ...p, image_url: url }))
                  }} />
                  {uploading && <span className="text-xs text-slate-400">上傳中...</span>}
                </div>
              </div>
            </div>
            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-100 bg-slate-50 rounded-b-2xl">
              <button onClick={() => setEditing(null)} className="btn-ghost">取消</button>
              <button onClick={save} className="btn-primary">{editing.id ? '儲存修改' : '建立材料'}</button>
            </div>
          </div>
        </div>
      )}

      <div className="mb-4">
        <input className="rubber-input w-72" placeholder="搜尋物料編號 / 名稱 / 規格 / 供應商" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      <div className="rubber-card overflow-hidden">
        {loading ? <div className="text-xs text-slate-500 p-6">載入中...</div> : (
          <>
            <div className="px-4 pt-4 text-xs text-slate-500">
              表格區域支援橫向捲動，頁面維持整體縱向捲動，與其他列表頁一致。
            </div>
            <div className="px-4 pb-4 pt-3">
            <div className="table-scroll-x rounded-xl border border-slate-200 bg-white shadow-inner">
              <table className="rubber-table" style={{ minWidth: 1540 }}>
                <thead>
                  <tr>
                    <th className="min-w-[152px]">物料編號</th>
                    <th className="min-w-[360px]">材料名稱</th>
                    <th className="min-w-[160px]">規格</th>
                    <th className="min-w-[120px]">顏色</th>
                    <th className="min-w-[90px]">單位</th>
                    <th className="min-w-[180px]">供應商</th>
                    <th className="min-w-[120px] text-right">單價</th>
                    <th className="min-w-[120px] text-right">售價</th>
                    <th className="min-w-[120px]">Leadtime</th>
                    <th className="min-w-[280px]">MOQ階梯</th>
                    <th className="min-w-[90px]">幣別</th>
                    <th className="min-w-[240px]">備註</th>
                    <th className="min-w-[140px]">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {paged.map((r) => (
                    <tr key={r.id} className="odd:bg-white even:bg-slate-50/40">
                      <td className="min-w-[152px] whitespace-nowrap font-mono text-xs text-blue-600">{r.material_code}</td>
                      <td className="min-w-[360px] whitespace-nowrap font-medium text-slate-800">{r.material_name}</td>
                      <td className="min-w-[160px] text-slate-500 whitespace-nowrap">{r.spec || '—'}</td>
                      <td className="min-w-[120px] text-slate-500 whitespace-nowrap">{r.color || '—'}</td>
                      <td className="min-w-[90px] text-slate-500 whitespace-nowrap">{r.unit || 'PCS'}</td>
                      <td className="min-w-[180px] text-slate-500 whitespace-nowrap">{r.supplier_name || '—'}</td>
                      <td className="min-w-[120px] text-right text-slate-700 whitespace-nowrap">{formatDecimal(r.supplier_price || 0)}</td>
                      <td className="min-w-[120px] text-right text-slate-700 whitespace-nowrap">{formatDecimal(r.company_price || 0)}</td>
                      <td className="min-w-[120px] text-slate-500 whitespace-nowrap">{r.leadtime || (r.leadtime_days ?? '—')}</td>
                      <td className="min-w-[280px] text-slate-500 whitespace-nowrap max-w-[280px] truncate" title={tierSummary(r)}>{tierSummary(r)}</td>
                      <td className="min-w-[90px] text-slate-500 whitespace-nowrap">{r.currency || 'VND'}</td>
                      <td className="min-w-[240px] text-slate-500 max-w-[240px] truncate" title={r.remark || ''}>{r.remark || '—'}</td>
                      <td className="min-w-[140px] whitespace-nowrap">
                        <div className="flex gap-1">
                          {canEdit && <button onClick={() => setEditing({ ...r, leadtime: r.leadtime || (r.leadtime_days != null ? String(r.leadtime_days) : ''), moq_tiers: ensureTierList((r as any).moq_tiers) })} className="btn-ghost text-blue-600">編輯</button>}
                          {canDel && <button onClick={() => del(r.id)} className="btn-danger">刪除</button>}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {paged.length === 0 && <tr><td colSpan={13} className="text-center py-12 text-slate-400">尚無材料資料</td></tr>}
                </tbody>
              </table>
            </div>
            </div>
            <Pagination page={page} totalPages={totalPages} setPage={setPage} total={total} pageSize={10} />
          </>
        )}
      </div>
    </div>
  )
}
