'use client'
import { useDialog } from '@/components/Dialog'
import FieldLockHint from '@/components/FieldLockHint'
import { useEffect, useState } from 'react'
import { apiFetch, API, getToken } from '@/lib/api'
import { usePagination, Pagination } from '@/lib/usePagination'
import { getUser } from '@/lib/permissions'
import { can } from '@/lib/usePermissions'
import { UNIT_OPTIONS, normalizeUnit } from '@/lib/units'
import { normalizeMoqTiers, type MoqTier } from '@/lib/moqPricing'

type Bom = {
  id:number; product_sku:string; product_name:string; material_name:string; spec:string; unit:string
  supplier_id:number|null; supplier_name:string; supplier_price:number; company_price:number
  currency:string; category:string; version:string; status:string; created_at:string
  cert_code:string; brand:string; image_url:string; moq_tiers?: MoqTier[]
}
const emptyTiers = (): MoqTier[] => Array.from({ length: 5 }, () => ({ moq: 0, price: 0 }))
const empty = (): Partial<Bom> => ({
  product_sku:'', product_name:'', material_name:'', spec:'', unit:'PCS',
  supplier_id:null, supplier_name:'', supplier_price:0, company_price:0,
  currency:'VND', category:'', version:'V1', cert_code:'', brand:'', image_url:'', moq_tiers: emptyTiers()
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
  const [editing, setEditing] = useState<Partial<Bom>|null>(null)
  const [uploading, setUploading] = useState(false)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [catFilter, setCatFilter] = useState('')
  const canWrite = can('bom.create')
  const canEdit = can('bom.edit')
  const canDel = can('bom.delete')

  const load = () => apiFetch<Bom[]>('/api/bom').then(setBoms).finally(()=>setLoading(false))
  useEffect(()=>{
    load()
    apiFetch<Supplier[]>('/api/suppliers').then(setSuppliers).catch(()=>{})
  },[])

  const uploadImage = async (file: File) => {
    setUploading(true)
    try {
      const fd = new FormData(); fd.append('file', file)
      const res = await fetch(`${API}/api/upload`, { method: 'POST', headers: { Authorization: `Bearer ${getToken()}` }, body: fd })
      return (await res.json()).url || ''
    } finally { setUploading(false) }
  }

  const save = async () => {
    if (!editing) return
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
      await load()
    } catch(e:any){ toast('錯誤：'+e.message, 'error') }
  }

  const del = async (id:number, e:React.MouseEvent) => {
    e.stopPropagation()
    if (!await confirmDialog('確定刪除此 BOM？')) return
    try {
      await apiFetch(`/api/bom/${id}`, { method:'DELETE' })
      toast('已刪除')
      await load()
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

  const categories = Array.from(new Set(boms.map(b => b.category).filter(Boolean)))
  const filtered = boms.filter(b => {
    const q = search.toLowerCase()
    const matchSearch = !search || b.product_sku.toLowerCase().includes(q) || b.product_name.toLowerCase().includes(q) || (b.material_name||'').toLowerCase().includes(q)
    const matchCat = !catFilter || b.category === catFilter
    return matchSearch && matchCat
  })
  const { page, setPage, totalPages, paged, total } = usePagination(filtered, 30)
  const inp = 'oms-input'

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-slate-800">材料明細</h1>
          <p className="text-xs text-slate-500 mt-0.5">物料編號、規格、供應商單價、公司售價</p>
        </div>
        {canWrite && <button onClick={()=>setEditing(empty())} className="btn-primary">+ 建立材料</button>}
      </div>

      {/* Edit / Create Modal */}
      {editing && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
              <h2 className="text-base font-semibold text-slate-800">{editing.id ? '編輯材料' : '建立材料'}</h2>
              <button onClick={()=>setEditing(null)} className="text-slate-400 hover:text-slate-600 text-xl leading-none">✕</button>
            </div>
            <div className="p-6 grid grid-cols-2 gap-4">
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
                <label className="block text-[11px] text-slate-500 mb-1.5">材料名稱</label>
                <input className={inp} value={editing.material_name||''} onChange={e=>setEditing(p=>({...p,material_name:e.target.value}))} />
              </div>
              <div>
                <label className="block text-[11px] text-slate-500 mb-1.5">規格</label>
                <input className={inp} value={editing.spec||''} onChange={e=>setEditing(p=>({...p,spec:e.target.value}))} />
              </div>
              <div>
                <label className="block text-[11px] text-slate-500 mb-1.5">單位</label>
                <select
                  className={inp}
                  value={normalizeUnit(editing.unit)}
                  onChange={e=>setEditing(p=>({...p,unit:e.target.value}))}
                >
                  {UNIT_OPTIONS.map(u => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[11px] text-slate-500 mb-1.5">分類</label>
                <input className={inp} value={editing.category||''} onChange={e=>setEditing(p=>({...p,category:e.target.value}))} />
              </div>
              <div>
                <label className="block text-[11px] text-slate-500 mb-1.5">供應商</label>
                <select className={inp} value={editing.supplier_id != null ? String(editing.supplier_id) : ''} onChange={e=>onSupplierChange(e.target.value)}>
                  <option value="">-- 選擇供應商 --</option>
                  {suppliers.map(s=><option key={s.id} value={String(s.id)}>{s.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[11px] text-slate-500 mb-1.5">幣別</label>
                <select className={inp} value={editing.currency||'VND'} onChange={e=>setEditing(p=>({...p,currency:e.target.value}))}>
                  <option>VND</option><option>TWD</option><option>CNY</option><option>USD</option>
                </select>
              </div>
              <div>
                <label className="block text-[11px] text-slate-500 mb-1.5">供應商單價</label>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  required
                  className={inp}
                  value={editing.supplier_price ?? 0}
                  onChange={e=>setEditing(p=>({...p,supplier_price:e.target.value === '' ? undefined : Number(e.target.value)}))}
                />
              </div>
              <div>
                <label className="block text-[11px] text-slate-500 mb-1.5">公司售價</label>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  required
                  className={inp}
                  value={editing.company_price ?? 0}
                  onChange={e=>setEditing(p=>({...p,company_price:e.target.value === '' ? undefined : Number(e.target.value)}))}
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
                      <input
                        type="number"
                        className={inp}
                        placeholder="單價"
                        value={tier.price || ''}
                        onChange={e=>updateTier(i, 'price', Number(e.target.value))}
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
            </div>
            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-100 bg-slate-50 rounded-b-2xl">
              <button onClick={()=>setEditing(null)} className="btn-ghost">取消</button>
              <button onClick={save} className="btn-primary">{editing.id ? '儲存修改' : '建立材料'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-3 mb-4">
        <input className="oms-input w-64" placeholder="搜尋物料編號、產品名稱..." value={search} onChange={e=>setSearch(e.target.value)} />
        <select className="oms-input w-40" value={catFilter} onChange={e=>setCatFilter(e.target.value)}>
          <option value="">全部分類</option>
          {categories.map(c=><option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      <div className="oms-card overflow-hidden">
        {loading ? (
          <div className="flex justify-center py-16"><div className="w-5 h-5 border-2 border-blue-200 border-t-blue-600 rounded-full animate-spin"/></div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm" style={{minWidth:1000}}>
                <thead>
                  <tr className="border-b border-slate-200">
                    {['圖片','分類','物料編號','產品名稱','材料名稱','規格','單位','品牌','認證代碼','供應商'].map(h=>(
                      <th key={h} className="px-3 py-3 text-left text-[11px] font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap">{h}</th>
                    ))}
                    <th className="px-3 py-3 text-right text-[11px] font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap">供應商單價</th>
                    <th className="px-3 py-3 text-right text-[11px] font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap">公司售價</th>
                    <th className="px-3 py-3 text-left text-[11px] font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap">幣別</th>
                    <th className="px-3 py-3 text-left text-[11px] font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {paged.map(b=>(
                    <tr key={b.id} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="px-3 py-2.5">
                        {b.image_url ? <img src={b.image_url} alt="" className="w-9 h-9 object-cover rounded-lg border border-slate-200" onError={e=>{(e.target as HTMLImageElement).style.display='none'}} /> : <div className="w-9 h-9 bg-slate-100 rounded-lg flex items-center justify-center text-slate-300 text-xs">無</div>}
                      </td>
                      <td className="px-3 py-2.5 text-xs text-slate-400 whitespace-nowrap">{b.category||'—'}</td>
                      <td className="px-3 py-2.5 font-mono text-xs text-blue-600 whitespace-nowrap">{b.product_sku}</td>
                      <td className="px-3 py-2.5 text-slate-800 font-medium max-w-[200px] truncate" title={b.product_name}>{b.product_name}</td>
                      <td className="px-3 py-2.5 text-slate-500 whitespace-nowrap">{b.material_name||'—'}</td>
                      <td className="px-3 py-2.5 text-slate-500 whitespace-nowrap max-w-[120px] truncate" title={b.spec}>{b.spec||'—'}</td>
                      <td className="px-3 py-2.5 text-slate-500 whitespace-nowrap">{b.unit}</td>
                      <td className="px-3 py-2.5 text-slate-500 whitespace-nowrap">{b.brand||'—'}</td>
                      <td className="px-3 py-2.5 text-slate-500 whitespace-nowrap">{b.cert_code||'—'}</td>
                      <td className="px-3 py-2.5 text-slate-500 whitespace-nowrap max-w-[140px] truncate" title={b.supplier_name}>{b.supplier_name||'—'}</td>
                      <td className="px-3 py-2.5 text-right text-slate-600 whitespace-nowrap">{Number(b.supplier_price).toLocaleString()}</td>
                      <td className="px-3 py-2.5 text-right font-semibold text-slate-800 whitespace-nowrap">{Number(b.company_price).toLocaleString()}</td>
                      <td className="px-3 py-2.5 text-slate-400 whitespace-nowrap">{b.currency}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        <div className="flex gap-1">
                          {canEdit && <button onClick={()=>setEditing({ ...b, unit: normalizeUnit(b.unit), moq_tiers: (() => {
                            const parsed = normalizeMoqTiers((b as any).moq_tiers)
                            return [...parsed, ...emptyTiers()].slice(0, 5)
                          })() })} className="btn-ghost text-blue-600">編輯</button>}
                          {canDel && <button onClick={e=>del(b.id,e)} className="btn-danger">刪除</button>}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {paged.length===0 && <tr><td colSpan={14} className="text-center py-12 text-slate-400">尚無 BOM 資料</td></tr>}
                </tbody>
              </table>
            </div>
            <Pagination page={page} totalPages={totalPages} setPage={setPage} total={total} pageSize={30} />
          </>
        )}
      </div>
    </div>
  )
}
