'use client'
import { useDialog } from '@/components/Dialog'
import FieldLockHint from '@/components/FieldLockHint'
import { Fragment, useEffect, useState } from 'react'
import { apiFetch, apiFetchRaw } from '@/lib/api'
import { usePagination, Pagination } from '@/lib/usePagination'
import { getUser } from '@/lib/permissions'
import { can } from '@/lib/usePermissions'
import { SearchableSelect } from '@/components/SearchableSelect'
import DecimalInput from '@/components/DecimalInput'
import { UNIT_OPTIONS, normalizeUnit } from '@/lib/units'
import { normalizeMoqTiers, type MoqTier } from '@/lib/moqPricing'
import { formatDecimal, formatInteger } from '@/lib/numberFormat'

type Bom = {
  id:number; product_sku:string; product_name:string; material_name:string; spec:string; unit:string
  supplier_id:number|null; supplier_name:string; supplier_price:number; company_price:number
  currency:string; category:string; version:string; status:string; created_at:string
  cert_code:string; brand:string; image_url:string; color?:string; lt?:string; moq?:number|null; moq_tiers?: MoqTier[]
  items?: BomItem[]
}
type BomItem = {
  id?: number
  material_code: string
  material_name: string
  spec: string
  unit: string
  quantity?: number | null
  supplier_name?: string
  supplier_price?: number
  company_price?: number
  currency?: string
  remark?: string
  color?: string
  lt?: string
  moq?: number | null
}
type Material = {
  id: number
  supplier_id?: number | null
  material_code: string
  material_name: string
  spec: string
  unit: string
  supplier_name?: string
  supplier_price?: number
  company_price?: number
  currency?: string
  color?: string
  leadtime_days?: number | null
  leadtime?: string
  moq?: number | null
  remark?: string
}
const emptyTiers = (): MoqTier[] => Array.from({ length: 5 }, () => ({ moq: 0, price: 0 }))
const empty = (): Partial<Bom> => ({
  product_sku:'', product_name:'', material_name:'', spec:'', unit:'PCS',
  supplier_id:null, supplier_name:'', supplier_price:undefined, company_price:undefined,
  currency:'VND', category:'', version:'V1', cert_code:'', brand:'', image_url:'', color:'', lt:'', moq:null, moq_tiers: emptyTiers(), items:[]
})

type Supplier = { id:number; name:string; currency:string }

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      className={`w-3.5 h-3.5 transition-transform duration-200 ${open ? 'rotate-90' : ''}`}>
      <polyline points="9 18 15 12 9 6" />
    </svg>
  )
}

export default function BomPage() {
  const { toast, confirm: confirmDialog } = useDialog()
  const [boms, setBoms] = useState<Bom[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [materials, setMaterials] = useState<Material[]>([])
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const [loadedItems, setLoadedItems] = useState<Record<number, BomItem[]>>({})
  const [headerMaterialCode, setHeaderMaterialCode] = useState('')
  const [editing, setEditing] = useState<Partial<Bom>|null>(null)
  const [uploading, setUploading] = useState(false)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [catFilter, setCatFilter] = useState('')
  const canWrite = can('bom.create')
  const canEdit = can('bom.edit')
  const canDel = can('bom.delete')

  const loadBomItems = async (id: number) => {
    const detail = await apiFetch<Bom>(`/api/bom/${id}`)
    const nextItems = detail.items || []
    setLoadedItems((p) => ({ ...p, [id]: nextItems }))
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
          const detail = await apiFetch<Bom>(`/api/bom/${id}`)
          return [id, detail.items || []] as const
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
      const [nextBoms, nextSuppliers, nextMaterials] = await Promise.all([
        apiFetch<Bom[]>('/api/bom'),
        apiFetch<Supplier[]>('/api/suppliers').catch(() => [] as Supplier[]),
        apiFetch<Material[]>('/api/materials').catch(() => [] as Material[]),
      ])
      setBoms(nextBoms)
      setSuppliers(nextSuppliers)
      setMaterials(nextMaterials)
      await refreshExpandedRows(Array.from(expanded))
    } finally {
      if (showSpinner) setLoading(false)
    }
  }

  useEffect(() => {
    refreshAll(true)
  }, [])

  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') refreshAll(false)
    }
    const handleFocus = () => refreshAll(false)

    window.addEventListener('focus', handleFocus)
    document.addEventListener('visibilitychange', handleVisibility)
    return () => {
      window.removeEventListener('focus', handleFocus)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [])
  const toggleExpand = async (id: number) => {
    const next = new Set(expanded)
    if (next.has(id)) {
      next.delete(id)
      setExpanded(next)
      return
    }
    next.add(id)
    setExpanded(next)
    if (loadedItems[id] === undefined) {
      await loadBomItems(id)
    }
  }

  const uploadImage = async (file: File) => {
    setUploading(true)
    try {
      const fd = new FormData(); fd.append('file', file)
      const res = await apiFetchRaw('/api/upload', { method: 'POST', body: fd })
      if (!res.ok) throw new Error('上傳失敗')
      return (await res.json()).url || ''
    } finally { setUploading(false) }
  }

  const save = async () => {
    if (!editing) return
    const editingId = editing.id ? Number(editing.id) : null
    if (!String(editing.product_sku || '').trim()) { toast('請填寫物料編號', 'error'); return }
    if (!String(editing.product_name || '').trim()) { toast('請填寫產品名稱', 'error'); return }
    if (!String(editing.unit || '').trim()) { toast('請選擇單位', 'error'); return }
    if (!String(editing.currency || '').trim()) { toast('請選擇幣別', 'error'); return }
    if (editing.supplier_price === null || editing.supplier_price === undefined || !Number.isFinite(Number(editing.supplier_price)) || Number(editing.supplier_price) < 0) {
      toast('請填寫有效的供應商單價（不可為空）', 'error')
      return
    }
    if (editing.company_price === null || editing.company_price === undefined || !Number.isFinite(Number(editing.company_price)) || Number(editing.company_price) < 0) {
      toast('請填寫有效的公司售價（不可為空）', 'error')
      return
    }
    try {
      if (editing.id) {
        await apiFetch(`/api/bom/${editing.id}`, { method:'PUT', body:JSON.stringify(editing) })
        toast('BOM 更新成功')
      } else {
        await apiFetch('/api/bom', { method:'POST', body:JSON.stringify(editing) })
        toast('BOM 建立成功')
      }
      setEditing(null)
      setHeaderMaterialCode('')
      await refreshAll(false)
      if (editingId && expanded.has(editingId)) await loadBomItems(editingId)
    } catch(e:any){ toast('錯誤：'+e.message, 'error') }
  }

  const del = async (id:number, e:React.MouseEvent) => {
    e.stopPropagation()
    if (!await confirmDialog('確定刪除此 BOM？')) return
    try {
      await apiFetch(`/api/bom/${id}`, { method:'DELETE' })
      toast('已刪除')
      await refreshAll(false)
    } catch(e:any){ toast('刪除失敗：'+e.message, 'error') }
  }

  const onSupplierChange = (supplierId:string) => {
    const sup = suppliers.find(s => String(s.id) === supplierId)
    setEditing(p => ({ ...p, supplier_id: supplierId ? Number(supplierId) : null, supplier_name: sup?.name||'', currency: sup?.currency||'VND' }))
  }
  const updateTier = (tierIdx:number, field:'moq'|'price', val:number) => {
    setEditing(p => {
      const tiers = Array.isArray(p?.moq_tiers) ? [...p.moq_tiers] : emptyTiers()
      tiers[tierIdx] = { ...(tiers[tierIdx] || { moq: 0, price: 0 }), [field]: Math.max(0, Number(val) || 0) }
      return { ...p, moq_tiers: tiers }
    })
  }
  const calcItemTotals = (items: BomItem[]) => {
    if (!items.length) return null
    const supplierTotal = items.reduce((sum, item) => {
      const qty = Number(item.quantity)
      const qtyFactor = Number.isFinite(qty) && qty > 0 ? qty : 1
      return sum + (Number(item.supplier_price) || 0) * qtyFactor
    }, 0)
    const companyTotal = items.reduce((sum, item) => {
      const qty = Number(item.quantity)
      const qtyFactor = Number.isFinite(qty) && qty > 0 ? qty : 1
      return sum + (Number(item.company_price) || 0) * qtyFactor
    }, 0)
    return {
      supplierTotal: Math.round(supplierTotal * 100) / 100,
      companyTotal: Math.round(companyTotal * 100) / 100,
    }
  }
  const addItem = () => {
    setEditing((p) => {
      const nextItems = [...(p?.items || []), { material_code: '', material_name: '', spec: '', unit: 'PCS', quantity: 1, currency: 'VND' }]
      const totals = calcItemTotals(nextItems)
      return { ...p, items: nextItems, supplier_price: totals ? totals.supplierTotal : p?.supplier_price, company_price: totals ? totals.companyTotal : p?.company_price }
    })
  }
  const removeItem = (idx:number) => {
    setEditing((p) => {
      const nextItems = (p?.items || []).filter((_, i) => i !== idx)
      const totals = calcItemTotals(nextItems)
      return { ...p, items: nextItems, supplier_price: totals ? totals.supplierTotal : p?.supplier_price, company_price: totals ? totals.companyTotal : p?.company_price }
    })
  }
  const updateItem = (idx:number, key:keyof BomItem, val:any) => {
    setEditing((p) => {
      const nextItems = (p?.items || []).map((it, i) => i === idx ? { ...it, [key]: val } : it)
      const totals = calcItemTotals(nextItems)
      return { ...p, items: nextItems, supplier_price: totals ? totals.supplierTotal : p?.supplier_price, company_price: totals ? totals.companyTotal : p?.company_price }
    })
  }
  const applyMaterialToItem = (idx:number, code:string) => {
    const m = materials.find((x) => x.material_code === code)
    if (!m) return
    setEditing((p) => {
      const nextItems = (p?.items || []).map((it, i) => i !== idx ? it : ({
        ...it,
        material_code: m.material_code,
        material_name: m.material_name,
        spec: m.spec || '',
        unit: m.unit || 'PCS',
        supplier_name: m.supplier_name || '',
        supplier_price: Number(m.supplier_price || 0),
        company_price: Number(m.company_price || 0),
        currency: m.currency || 'VND',
        color: m.color || '',
        lt: m.leadtime || (m.leadtime_days ? `${m.leadtime_days}` : ''),
        moq: m.moq ?? null,
        remark: m.remark || '',
      }))
      const totals = calcItemTotals(nextItems)
      return {
        ...p,
        items: nextItems,
        supplier_price: totals ? totals.supplierTotal : p?.supplier_price,
        company_price: totals ? totals.companyTotal : p?.company_price,
      }
    })
  }

  const applyMaterialToHeader = (selected: string) => {
    setHeaderMaterialCode(selected)
    const m = materials.find((x) => String(x.id) === selected) || materials.find((x) => x.material_code === selected)
    if (!m) return
    setEditing((p) => ({
      ...p,
      material_name: m.material_name || '',
      spec: m.spec || '',
      unit: normalizeUnit(m.unit || p?.unit || 'PCS'),
      supplier_id: m.supplier_id ?? p?.supplier_id ?? null,
      supplier_name: m.supplier_name || p?.supplier_name || '',
      supplier_price: m.supplier_price ?? p?.supplier_price ?? undefined,
      company_price: m.company_price ?? p?.company_price ?? undefined,
      currency: m.currency || p?.currency || 'VND',
      color: m.color || p?.color || '',
      lt: m.leadtime || (m.leadtime_days ? `${m.leadtime_days}` : p?.lt || ''),
      moq: m.moq ?? p?.moq ?? null,
    }))
  }

  const categories = Array.from(new Set(boms.map(b => b.category).filter(Boolean)))
  const filtered = boms.filter(b => {
    const q = search.toLowerCase()
    const matchSearch = !search || b.product_sku.toLowerCase().includes(q) || b.product_name.toLowerCase().includes(q) || (b.material_name||'').toLowerCase().includes(q)
    const matchCat = !catFilter || b.category === catFilter
    return matchSearch && matchCat
  })
  const moqTierSummary = (b: Bom) => {
    const tiers = normalizeMoqTiers((b as any).moq_tiers)
    if (!tiers.length) return b.moq ? `MOQ ${formatInteger(b.moq)}` : '—'
    return tiers.map((t) => `${formatInteger(t.moq)}/${formatDecimal(t.price)}`).join(' | ')
  }
  const { page, setPage, totalPages, paged, total } = usePagination(filtered, 10)
  const inp = 'rubber-input'
  const lockedInp = `${inp} bom-locked-field`
  const headerMaterialLocked = Boolean(headerMaterialCode)

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-slate-800">產品規格 / BOM</h1>
          <p className="text-xs text-slate-500 mt-0.5">主產品 + 組合加工材料明細（顏色 / Leadtime / MOQ）</p>
        </div>
        {canWrite && <button onClick={()=>{ setEditing(empty()); setHeaderMaterialCode('') }} className="btn-primary">+ 建立 BOM</button>}
      </div>

      {/* Edit / Create Modal */}
      {editing && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-black/40 p-4">
          <div className="mx-auto w-full max-w-2xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl">
            <div className="border-b border-slate-100 bg-white px-6 py-4 shadow-sm">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-base font-semibold text-slate-800">{editing.id ? '編輯材料' : '建立材料'}</h2>
                  <p className="mt-1 text-[11px] text-slate-400">BOM 主資料與新增列固定顯示，長材料明細可直接往下編輯。</p>
                </div>
                <button onClick={()=>setEditing(null)} className="text-slate-400 hover:text-slate-600 text-xl leading-none shrink-0">✕</button>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4 p-6">
              <div>
                <label className="flex items-center gap-1.5 text-[11px] text-slate-500 mb-1.5">
                  物料編號 *（唯一）
                  {!!editing.id && <FieldLockHint />}
                </label>
                <input
                  className={inp}
                  value={editing.product_sku||''}
                  onChange={e=>setEditing(p=>({...p,product_sku:e.target.value}))}
                  disabled={!!editing.id}
                />
                {!!editing.id && <p className="text-[10px] text-slate-400 mt-1">物料編號建立後不可修改</p>}
              </div>
              <div>
                <label className="block text-[11px] text-slate-500 mb-1.5">產品名稱 *</label>
                <input className={inp} value={editing.product_name||''} onChange={e=>setEditing(p=>({...p,product_name:e.target.value}))} />
              </div>
              <div>
                <label className="block text-[11px] text-slate-500 mb-1.5">主料（面料）</label>
                <SearchableSelect
                  options={materials}
                  value={headerMaterialCode}
                  onChange={applyMaterialToHeader}
                  placeholder="-- 選擇主料（自動帶入資料）--"
                  renderOption={(m) => `${m.material_code} — ${m.material_name}${m.spec ? ` (${m.spec})` : ''}`}
                  filterFn={(m, search) =>
                    m.material_code.toLowerCase().includes(search) ||
                    m.material_name.toLowerCase().includes(search) ||
                    (m.spec || '').toLowerCase().includes(search)
                  }
                />
                <p className="text-[10px] text-slate-400 mt-1">選擇後會自動帶入名稱/規格/供應商/單價/Leadtime/MOQ</p>
              </div>
              <div>
                <label className="block text-[11px] text-slate-500 mb-1.5">規格</label>
                <input className={headerMaterialLocked ? lockedInp : inp} value={editing.spec||''} onChange={e=>setEditing(p=>({...p,spec:e.target.value}))} readOnly={headerMaterialLocked} />
              </div>
              <div>
                <label className="block text-[11px] text-slate-500 mb-1.5">顏色</label>
                <input className={headerMaterialLocked ? lockedInp : inp} value={editing.color||''} onChange={e=>setEditing(p=>({...p,color:e.target.value}))} readOnly={headerMaterialLocked} />
              </div>
              <div>
                <label className="block text-[11px] text-slate-500 mb-1.5">單位</label>
                <select
                  className={headerMaterialLocked ? lockedInp : inp}
                  value={normalizeUnit(editing.unit)}
                  onChange={e=>setEditing(p=>({...p,unit:e.target.value}))}
                  disabled={headerMaterialLocked}
                >
                  {UNIT_OPTIONS.map(u => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[11px] text-slate-500 mb-1.5">Leadtime</label>
                <input className={headerMaterialLocked ? lockedInp : inp} value={editing.lt||''} onChange={e=>setEditing(p=>({...p,lt:e.target.value}))} readOnly={headerMaterialLocked} />
              </div>
              <div>
                <label className="block text-[11px] text-slate-500 mb-1.5">MOQ</label>
                <input type="number" className={headerMaterialLocked ? lockedInp : inp} value={editing.moq ?? ''} onChange={e=>setEditing(p=>({...p,moq:e.target.value ? Number(e.target.value) : null}))} readOnly={headerMaterialLocked} />
              </div>
              <div>
                <label className="block text-[11px] text-slate-500 mb-1.5">分類</label>
                <input className={inp} value={editing.category||''} onChange={e=>setEditing(p=>({...p,category:e.target.value}))} />
              </div>
              <div>
                <label className="block text-[11px] text-slate-500 mb-1.5">供應商</label>
                <select className={headerMaterialLocked ? lockedInp : inp} value={editing.supplier_id != null ? String(editing.supplier_id) : ''} onChange={e=>onSupplierChange(e.target.value)} disabled={headerMaterialLocked}>
                  <option value="">-- 選擇供應商 --</option>
                  {suppliers.map(s=><option key={s.id} value={String(s.id)}>{s.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[11px] text-slate-500 mb-1.5">幣別</label>
                <select className={headerMaterialLocked ? lockedInp : inp} value={editing.currency||'VND'} onChange={e=>setEditing(p=>({...p,currency:e.target.value}))} disabled={headerMaterialLocked}>
                  <option>VND</option><option>TWD</option><option>CNY</option><option>USD</option>
                </select>
              </div>
              <div>
                <label className="block text-[11px] text-slate-500 mb-1.5">供應商單價</label>
                <DecimalInput
                  required
                  className={headerMaterialLocked ? lockedInp : inp}
                  value={editing.supplier_price}
                  onValueChange={(value) => setEditing((p) => ({ ...p, supplier_price: value }))}
                  readOnly={headerMaterialLocked}
                />
              </div>
              <div>
                <label className="block text-[11px] text-slate-500 mb-1.5">公司售價</label>
                <DecimalInput
                  required
                  className={headerMaterialLocked ? lockedInp : inp}
                  value={editing.company_price}
                  onValueChange={(value) => setEditing((p) => ({ ...p, company_price: value }))}
                  readOnly={headerMaterialLocked}
                />
              </div>
              <div className="col-span-2">
                <label className="block text-[11px] text-slate-500 mb-1.5">MOQ 階梯價格（數量 / 單價）</label>
                <div className="rounded-xl border border-slate-200 p-3 space-y-1.5 bg-slate-50/50">
                  {(editing.moq_tiers || emptyTiers()).map((tier, i) => (
                    <div key={i} className="grid grid-cols-[26px_1fr_1fr] gap-2 items-center">
                      <span className="text-[10px] text-slate-400 text-center">#{i + 1}</span>
                      <input
                        type="number"
                        className={inp}
                        placeholder="MOQ"
                        value={tier.moq || ''}
                        onChange={e=>updateTier(i, 'moq', Number(e.target.value))}
                      />
                      <DecimalInput
                        className={inp}
                        placeholder="單價"
                        value={tier.price}
                        onValueChange={(value) => updateTier(i, 'price', value ?? 0)}
                      />
                    </div>
                  ))}
                </div>
                <p className="text-[10px] text-slate-400 mt-1">同一物料編號可在此設定不同 MOQ 對應價格</p>
              </div>
              <div>
                <label className="block text-[11px] text-slate-500 mb-1.5">認證機構代碼</label>
                <input className={inp} value={editing.cert_code||''} onChange={e=>setEditing(p=>({...p,cert_code:e.target.value}))} placeholder="如：CE, RoHS..." />
              </div>
              <div>
                <label className="block text-[11px] text-slate-500 mb-1.5">品牌</label>
                <input className={inp} value={editing.brand||''} onChange={e=>setEditing(p=>({...p,brand:e.target.value}))} />
              </div>
              <div className="col-span-2">
                <label className="block text-[11px] text-slate-500 mb-1.5">產品圖片</label>
                <div className="flex items-center gap-3">
                  {editing.image_url && <img src={editing.image_url} alt="" className="w-12 h-12 object-cover rounded border" onError={e=>{(e.target as HTMLImageElement).style.display='none'}} />}
                  <input type="file" accept="image/*" onChange={async e => { const f = e.target.files?.[0]; if (f) { const url = await uploadImage(f); setEditing(p=>({...p,image_url:url})) } }} className="text-sm" />
                  {uploading && <span className="text-xs text-slate-400">上傳中...</span>}
                </div>
                <input className={`${inp} mt-2`} placeholder="或輸入圖片 URL" value={editing.image_url||''} onChange={e=>setEditing(p=>({...p,image_url:e.target.value}))} />
              </div>
              <div className="col-span-2">
                <div className="flex items-center justify-between mb-2 gap-3">
                  <label className="block text-[11px] text-slate-500">BOM 組合材料明細（可新增列）</label>
                  <button type="button" className="btn-ghost text-blue-600 shrink-0" onClick={addItem}>+ 新增列</button>
                </div>
                <div className="table-scroll-x detail-scroll-panel rounded-lg border border-slate-200">
                  <table className="w-full text-xs oms-table" style={{ minWidth: 1280 }}>
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50">
                        {['物料編號','材料名稱','規格','顏色','單位','供應商','供應商單價','銷售單價','幣別','Leadtime','MOQ','備註',''].map(h => (
                          <th key={h} className="sticky top-0 z-10 bg-slate-50 px-2 py-1.5 text-left text-[10px] font-semibold text-slate-500 uppercase whitespace-nowrap shadow-sm">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {(editing.items || []).map((item, i) => (
                        <tr key={i} className="border-b border-slate-100">
                          <td className="p-1">
                            <input
                              list={`mat-codes-${i}`}
                              className={inp}
                              value={item.material_code || ''}
                              onChange={e => { updateItem(i, 'material_code', e.target.value); applyMaterialToItem(i, e.target.value) }}
                            />
                            <datalist id={`mat-codes-${i}`}>
                              {materials.map(m => <option key={m.id} value={m.material_code}>{m.material_name}</option>)}
                            </datalist>
                          </td>
                          <td className="p-1"><input className={lockedInp} value={item.material_name || ''} onChange={e => updateItem(i, 'material_name', e.target.value)} readOnly /></td>
                          <td className="p-1"><input className={lockedInp} value={item.spec || ''} onChange={e => updateItem(i, 'spec', e.target.value)} readOnly /></td>
                          <td className="p-1"><input className={lockedInp} value={item.color || ''} onChange={e => updateItem(i, 'color', e.target.value)} readOnly /></td>
                          <td className="p-1"><input className={lockedInp} value={item.unit || ''} onChange={e => updateItem(i, 'unit', e.target.value)} readOnly /></td>
                          <td className="p-1"><input className={lockedInp} value={item.supplier_name || ''} onChange={e => updateItem(i, 'supplier_name', e.target.value)} readOnly /></td>
                          <td className="p-1">
                            <DecimalInput
                              className={lockedInp}
                              value={item.supplier_price}
                              onValueChange={(value) => updateItem(i, 'supplier_price', value)}
                              readOnly
                            />
                          </td>
                          <td className="p-1">
                            <DecimalInput
                              className={lockedInp}
                              value={item.company_price}
                              onValueChange={(value) => updateItem(i, 'company_price', value)}
                              readOnly
                            />
                          </td>
                          <td className="p-1"><input className={lockedInp} value={item.currency || 'VND'} onChange={e => updateItem(i, 'currency', e.target.value)} readOnly /></td>
                          <td className="p-1"><input className={lockedInp} value={item.lt || ''} onChange={e => updateItem(i, 'lt', e.target.value)} readOnly /></td>
                          <td className="p-1"><input type="number" className={lockedInp} value={item.moq ?? ''} onChange={e => updateItem(i, 'moq', e.target.value ? Number(e.target.value) : null)} readOnly /></td>
                          <td className="p-1"><input className={inp} value={item.remark || ''} onChange={e => updateItem(i, 'remark', e.target.value)} /></td>
                          <td className="p-1 text-center"><button type="button" className="text-slate-300 hover:text-red-600" onClick={() => removeItem(i)}>✕</button></td>
                        </tr>
                      ))}
                      {(editing.items || []).length === 0 && (
                        <tr><td colSpan={13} className="px-3 py-4 text-center text-slate-400">尚未新增組合材料</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
            <div className="flex items-center justify-between gap-3 rounded-b-2xl border-t border-slate-100 bg-white px-6 py-4">
              <div className="text-xs text-slate-500">明細列數 <span className="font-semibold text-slate-700">{(editing.items || []).length}</span></div>
              <div className="flex items-center gap-3">
              <button onClick={()=>setEditing(null)} className="btn-ghost">取消</button>
              <button onClick={save} className="btn-primary">{editing.id ? '儲存修改' : '建立材料'}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-3 mb-4">
        <input className="rubber-input w-64" placeholder="搜尋物料編號、產品名稱..." value={search} onChange={e=>setSearch(e.target.value)} />
        <select className="rubber-input w-40" value={catFilter} onChange={e=>setCatFilter(e.target.value)}>
          <option value="">全部分類</option>
          {categories.map(c=><option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      <div className="rubber-card overflow-hidden">
        {loading ? (
          <div className="flex justify-center py-16"><div className="w-5 h-5 border-2 border-blue-200 border-t-blue-600 rounded-full animate-spin"/></div>
        ) : (
          <>
            <div className="table-scroll-x">
              <table
                className="w-full text-sm"
                style={{
                  minWidth: 1180,
                  ['--sticky-col-1-width' as any]: '180px',
                  ['--sticky-col-2-width' as any]: '240px',
                }}
              >
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50/70">
                    {['物料編號','產品名稱','圖片','分類','材料名稱','規格','顏色','單位','Leadtime','MOQ階梯','品牌','認證代碼','供應商','展開'].map(h=>(
                      <th key={h} className="px-3 py-3 text-left text-[11px] font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap">{h}</th>
                    ))}
                    <th className="px-3 py-3 text-right text-[11px] font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap">供應商單價</th>
                    <th className="px-3 py-3 text-right text-[11px] font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap">公司售價</th>
                    <th className="px-3 py-3 text-left text-[11px] font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap">幣別</th>
                    <th className="px-3 py-3 text-left text-[11px] font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {paged.map(b => {
                    const isOpen = expanded.has(b.id)
                    const detailItems = loadedItems[b.id] || []
                    return (
                      <Fragment key={b.id}>
                        <tr key={b.id} className={`border-b border-slate-100/80 cursor-pointer transition-colors ${isOpen ? 'layer-row-open' : 'layer-row-hover'}`} onClick={() => toggleExpand(b.id)}>
                          <td className="px-3 py-2.5 font-mono text-xs font-semibold text-blue-600 whitespace-nowrap">{b.product_sku}</td>
                          <td className="px-3 py-2.5 text-slate-800 font-medium min-w-[220px] max-w-[260px]" title={b.product_name}>
                            <div className="truncate">{b.product_name}</div>
                          </td>
                          <td className="px-3 py-2.5">
                            {b.image_url ? <img src={b.image_url} alt="" className="w-9 h-9 object-cover rounded-lg border border-slate-200" onError={e=>{(e.target as HTMLImageElement).style.display='none'}} /> : <div className="w-9 h-9 bg-slate-100 rounded-lg flex items-center justify-center text-slate-300 text-xs">無</div>}
                          </td>
                          <td className="px-3 py-2.5 text-xs text-slate-400 whitespace-nowrap">{b.category||'—'}</td>
                          <td className="px-3 py-2.5 text-slate-500 whitespace-nowrap">{b.material_name||'—'}</td>
                          <td className="px-3 py-2.5 text-slate-500 whitespace-nowrap max-w-[120px] truncate" title={b.spec}>{b.spec||'—'}</td>
                          <td className="px-3 py-2.5 text-slate-500 whitespace-nowrap">{b.color||'—'}</td>
                          <td className="px-3 py-2.5 text-slate-500 whitespace-nowrap">{b.unit}</td>
                          <td className="px-3 py-2.5 text-slate-500 whitespace-nowrap">{b.lt||'—'}</td>
                          <td className="px-3 py-2.5 text-slate-500 whitespace-nowrap max-w-[280px] truncate" title={moqTierSummary(b)}>{moqTierSummary(b)}</td>
                          <td className="px-3 py-2.5 text-slate-500 whitespace-nowrap">{b.brand||'—'}</td>
                          <td className="px-3 py-2.5 text-slate-500 whitespace-nowrap">{b.cert_code||'—'}</td>
                          <td className="px-3 py-2.5 text-slate-500 whitespace-nowrap max-w-[140px] truncate" title={b.supplier_name}>{b.supplier_name||'—'}</td>
                          <td className="px-3 py-2.5">
                            <span className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-slate-200/80 bg-white/80 text-slate-500">
                              <ChevronIcon open={isOpen} />
                            </span>
                          </td>
                          <td className="px-3 py-2.5 text-right text-slate-600 whitespace-nowrap">{formatDecimal(b.supplier_price)}</td>
                          <td className="px-3 py-2.5 text-right font-semibold text-slate-800 whitespace-nowrap">{formatDecimal(b.company_price)}</td>
                          <td className="px-3 py-2.5 text-slate-400 whitespace-nowrap">{b.currency}</td>
                          <td className="px-3 py-2.5 whitespace-nowrap" onClick={e => e.stopPropagation()}>
                            <div className="flex gap-1">
                              {canEdit && <button onClick={async ()=>{
                                const detail = await apiFetch<Bom>(`/api/bom/${b.id}`)
                                const matchedMaterial =
                                  materials.find((m) => m.material_code === detail.product_sku) ||
                                  materials.find((m) => m.material_name === detail.material_name && (!detail.spec || m.spec === detail.spec)) ||
                                  materials.find((m) => m.material_name === detail.material_name)
                                setHeaderMaterialCode(matchedMaterial ? String(matchedMaterial.id) : '')
                                setEditing({
                                  ...detail,
                                  unit: normalizeUnit(detail.unit),
                                  moq_tiers: (() => {
                                    const parsed = normalizeMoqTiers((detail as any).moq_tiers)
                                    return [...parsed, ...emptyTiers()].slice(0, 5)
                                  })(),
                                  items: detail.items || [],
                                })
                              }} className="btn-ghost text-blue-600">編輯</button>}
                              {canDel && <button onClick={e=>del(b.id,e)} className="btn-danger">刪除</button>}
                            </div>
                          </td>
                        </tr>
                        {isOpen && (
                          <tr key={`${b.id}-items`} className="border-b border-slate-100/80">
                            <td colSpan={18} className="px-0 py-0">
                              <div className="expand-row-wrap layer-panel-l2">
                                {detailItems.length === 0 ? (
                                  <div className="expand-row-empty">此 BOM 尚無輔料明細</div>
                                ) : (
                                    <table className="w-full text-xs" style={{ minWidth: 1160 }}>
                                      <thead>
                                        <tr className="layer-head-l2">
                                          {['材料編號','材料名稱','規格','顏色','單位','供應商','Leadtime','MOQ','供應商單價','公司售價','備註'].map((h)=>(
                                            <th key={h} className="px-3 py-2 text-left text-[10px] font-semibold text-slate-500 uppercase whitespace-nowrap">{h}</th>
                                          ))}
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {detailItems.map((item, idx) => (
                                          <tr key={idx} className="border-b border-slate-100/70 last:border-0 hover:bg-slate-50/80">
                                            <td className="px-3 py-2 font-mono text-blue-600 whitespace-nowrap">{item.material_code || '—'}</td>
                                            <td className="px-3 py-2 text-slate-700 whitespace-nowrap">{item.material_name || '—'}</td>
                                            <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{item.spec || '—'}</td>
                                            <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{item.color || '—'}</td>
                                            <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{item.unit || 'PCS'}</td>
                                            <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{item.supplier_name || '—'}</td>
                                            <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{item.lt || '—'}</td>
                                            <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{item.moq != null ? formatInteger(item.moq) : '—'}</td>
                                            <td className="px-3 py-2 text-right text-slate-600 whitespace-nowrap">{formatDecimal(item.supplier_price || 0)}</td>
                                            <td className="px-3 py-2 text-right font-semibold text-slate-800 whitespace-nowrap">{formatDecimal(item.company_price || 0)}</td>
                                            <td className="px-3 py-2 text-slate-500 whitespace-nowrap max-w-[220px] truncate" title={item.remark || ''}>{item.remark || '—'}</td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    )
                  })}
                  {paged.length===0 && <tr><td colSpan={18} className="text-center py-12 text-slate-400">尚無 BOM 資料</td></tr>}
                </tbody>
              </table>
            </div>
            <Pagination page={page} totalPages={totalPages} setPage={setPage} total={total} pageSize={10} />
          </>
        )}
      </div>
    </div>
  )
}
