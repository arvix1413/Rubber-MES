'use client'
import { useDialog } from '@/components/Dialog'
import FieldLockHint from '@/components/FieldLockHint'
import { useEffect, useState, useRef } from 'react'
import { apiFetch, API, getToken } from '@/lib/api'
import { usePagination, Pagination } from '@/lib/usePagination'
import * as XLSX from 'xlsx'

type Supplier = { id: number; name: string; supplier_code: string; currency: string }
type Material = { id: number; material_code: string; material_name: string; spec: string; unit: string; category: string; product_category: string; supplier_id: number|null; supplier_name: string; supplier_price: number; company_price: number; currency: string; stock: number; image_url: string }
const empty = (): Partial<Material> => ({ material_code:'', material_name:'', spec:'', unit:'PCS', category:'', product_category:'', supplier_id:null, supplier_price:0, company_price:0, currency:'VND', stock:0, image_url:'' })

function DetailModal({ item, onClose, onEdit }: { item: Material; onClose: () => void; onEdit: () => void }) {
  const row = (label: string, val: any, cls = '') => (
    <div className="flex gap-3 py-2.5 border-b border-slate-100 last:border-0">
      <span className="text-xs text-slate-400 w-28 shrink-0 pt-0.5">{label}</span>
      <span className={`text-sm text-slate-600 break-all ${cls}`}>{val ?? '—'}</span>
    </div>
  )
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-md max-h-[85vh] overflow-auto shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <div className="flex items-center gap-3">
            {item.image_url && <img src={item.image_url} alt="" className="w-10 h-10 object-cover rounded-lg border border-slate-200" onError={e=>{(e.target as HTMLImageElement).style.display='none'}} />}
            <div>
              <h2 className="text-sm font-bold text-slate-800">{item.material_name}</h2>
              <span className="text-xs text-slate-400 font-mono">{item.material_code}</span>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-lg leading-none ml-4">✕</button>
        </div>
        <div className="p-6 mb-2">
          {row('物料編號', item.material_code, 'font-mono text-blue-600')}
          {row('產品分類', item.category)}
          {row('材料分類', item.product_category)}
          {row('規格', item.spec)}
          {row('單位', item.unit)}
          {row('供應商', item.supplier_name)}
          {row('供應商單價', item.supplier_price?.toLocaleString())}
          {row('公司售價', item.company_price?.toLocaleString(), 'font-semibold text-slate-800')}
          {row('幣別', item.currency)}
          {row('庫存', item.stock?.toLocaleString())}
        </div>
        <div className="px-6 pb-6">
          <button onClick={onEdit} className="btn-primary w-full justify-center">編輯</button>
        </div>
      </div>
    </div>
  )
}

export default function MaterialsPage() {
  const { toast, confirm: confirmDialog } = useDialog()

  const [items, setItems] = useState<Material[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [editing, setEditing] = useState<Partial<Material> | null>(null)
  const [detail, setDetail] = useState<Material|null>(null)
  const [uploading, setUploading] = useState(false)
  const [loading, setLoading] = useState(true)
  const [importing, setImporting] = useState(false)
  const [importPreview, setImportPreview] = useState<any[]|null>(null)
  const [search, setSearch] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const load = () => apiFetch<Material[]>('/api/materials').then(setItems).finally(() => setLoading(false))
  useEffect(() => {
    load()
    apiFetch<Supplier[]>('/api/suppliers').then(setSuppliers)
  }, [])

  const filtered = items.filter(m => !search || m.material_code.toLowerCase().includes(search.toLowerCase()) || m.material_name.toLowerCase().includes(search.toLowerCase()))
  const { page, setPage, totalPages, paged, total } = usePagination(filtered, 20)

  // When supplier changes, auto-fill currency
  const handleSupplierChange = (supplierId: string) => {
    const id = supplierId ? Number(supplierId) : null
    const sup = suppliers.find(s => s.id === id)
    setEditing(p => ({ ...p, supplier_id: id, currency: sup?.currency || 'VND' }))
  }

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
    try {
      if (editing.id) await apiFetch(`/api/materials/${editing.id}`, { method: 'PUT', body: JSON.stringify(editing) })
      else await apiFetch('/api/materials', { method: 'POST', body: JSON.stringify(editing) })
      toast('儲存成功')
      setEditing(null)
      await load()
    } catch (e: any) { toast('錯誤：' + e.message, 'error') }
  }

  const del = async (id: number) => {
    if (!await confirmDialog('確定刪除？')) return
    await apiFetch(`/api/materials/${id}`, { method: 'DELETE' })
    await load()
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (evt) => {
      try {
        const wb = XLSX.read(evt.target?.result, { type: 'binary' })
        const sheetName = wb.SheetNames.includes('材料 BOM 表') ? '材料 BOM 表' : wb.SheetNames[0]
        const ws = wb.Sheets[sheetName]
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1 }) as any[][]
        const seen = new Set<string>()
        const parsed = rows.slice(1).filter(r => r[2] && r[3]).map(r => {
          const code = String(r[2]).trim()
          if (seen.has(code)) return null
          seen.add(code)
          return {
            material_code: code,
            material_name: String(r[3] || '').trim(),
            spec: String(r[4] || '').trim(),
            unit: String(r[6] || 'PCS').trim(),
            category: String(r[0] || '').trim(),
            product_category: String(r[1] || '').trim(),
            supplier_name: String(r[7] || '').trim(),
            supplier_price: Number(r[8]) || 0,
            currency: 'VND', stock: 0,
          }
        }).filter(Boolean)
        setImportPreview(parsed)
        toast(`解析完成，共 ${parsed.length} 筆料號，請確認後匯入`, 'info')
      } catch (e: any) { toast('解析失敗：' + e.message, 'error') }
    }
    reader.readAsBinaryString(file)
    e.target.value = ''
  }

  const confirmImport = async () => {
    if (!importPreview?.length) return
    setImporting(true)
    try {
      const result = await apiFetch<{success:number;updated:number;new_suppliers:number;errors:string[]}>('/api/materials/bulk', {
        method: 'POST', body: JSON.stringify(importPreview)
      })
      const newSup = result.new_suppliers > 0 ? `，自動建立 ${result.new_suppliers} 個供應商` : ''
      toast(`匯入完成：新增 ${result.success} 筆，更新 ${result.updated} 筆${newSup}${result.errors.length ? `，失敗 ${result.errors.length} 筆` : ''}`, result.errors.length ? 'error' : 'success')
      setImportPreview(null)
      await load()
    } catch (e: any) { toast('匯入失敗：' + e.message, 'error') }
    finally { setImporting(false) }
  }

  const downloadTemplate = () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ['產品', '產品名稱', '物料編號', '材料名稱', '規格 ', '單位', '單位', '供應商名稱', '供應商單價(VND)', '公司售價(VND)'],
      ['包材印刷', 'SHOE IN 隔板 16.3*34 MM', '6BF000719', '紙箱', '340*163mm', 1, 'PCS', 'NS', 622, 1620],
    ])
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, '材料 BOM 表')
    XLSX.writeFile(wb, '料號匯入範本.xlsx')
  }

  const inp = 'oms-input'

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-slate-800">料號管理</h1>
        <div className="flex gap-2">
          <button onClick={downloadTemplate} className="btn-ghost border border-slate-200">📥 下載範本</button>
          <button onClick={() => fileRef.current?.click()} className="btn-ghost border border-blue-500/30 text-blue-600">📤 Excel 匯入</button>
          <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleFileSelect} />
          <button onClick={() => setEditing(empty())} className="btn-primary">+ 新增料號</button>
        </div>
      </div>

      {detail && <DetailModal item={detail} onClose={()=>setDetail(null)} onEdit={()=>{ setEditing(detail); setDetail(null) }} />}

      {/* Import Preview */}
      {importPreview && (
        <div className="oms-card p-5 mb-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold">匯入預覽（共 {importPreview.length} 筆）</h2>
            <div className="flex gap-2">
              <button onClick={() => setImportPreview(null)} className="btn-ghost border border-slate-200">取消</button>
              <button onClick={confirmImport} disabled={importing} className="btn-primary disabled:opacity-60">
                {importing ? '匯入中...' : '確認匯入'}
              </button>
            </div>
          </div>
          <div className="overflow-x-auto max-h-64 overflow-y-auto">
            <table className="w-full text-xs border-collapse">
              <thead className="sticky top-0 bg-white">
                <tr>{['物料編號','材料名稱','規格','單位','分類','供應商（自動匹配）','供應商單價'].map(h=><th key={h} className="border border-slate-200 px-2 py-1.5 text-left font-medium text-slate-400">{h}</th>)}</tr>
              </thead>
              <tbody>
                {importPreview.slice(0,50).map((row,i)=>(
                  <tr key={i} className="hover:bg-slate-50">
                    <td className="border border-slate-200 px-2 py-1 font-mono text-blue-600">{row.material_code}</td>
                    <td className="border border-slate-200 px-2 py-1 text-slate-600">{row.material_name}</td>
                    <td className="border border-slate-200 px-2 py-1 text-slate-400">{row.spec}</td>
                    <td className="border border-slate-200 px-2 py-1 text-slate-600">{row.unit}</td>
                    <td className="border border-slate-200 px-2 py-1 text-slate-400">{row.category}</td>
                    <td className="border border-slate-200 px-2 py-1 text-slate-400">{row.supplier_name}</td>
                    <td className="border border-slate-200 px-2 py-1 text-right text-slate-600">{row.supplier_price?.toLocaleString()}</td>
                  </tr>
                ))}
                {importPreview.length > 50 && <tr><td colSpan={7} className="border border-slate-200 px-2 py-2 text-center text-slate-400">...還有 {importPreview.length-50} 筆</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Edit Form */}
      {editing && (
        <div className="oms-card p-6 mb-5">
          <h2 className="font-semibold mb-4">{editing.id ? '編輯料號' : '新增料號'}</h2>
          <div className="grid md:grid-cols-3 gap-4">
            <div>
              <label className="flex items-center gap-1.5 text-[11px] text-slate-500 mb-1.5">
                料號 *
                {!!editing.id && <FieldLockHint />}
              </label>
              <input
                className={inp}
                value={editing.material_code||''}
                onChange={e=>setEditing(p=>({...p,material_code:e.target.value}))}
                disabled={!!editing.id}
              />
              {!!editing.id && <p className="text-[10px] text-slate-400 mt-1">料號建立後不可修改</p>}
            </div>
            <div><label className="block text-[11px] text-slate-500 mb-1.5">材料名稱 *</label><input className={inp} value={editing.material_name||''} onChange={e=>setEditing(p=>({...p,material_name:e.target.value}))} /></div>
            <div><label className="block text-[11px] text-slate-500 mb-1.5">規格</label><input className={inp} value={editing.spec||''} onChange={e=>setEditing(p=>({...p,spec:e.target.value}))} /></div>
            <div><label className="block text-[11px] text-slate-500 mb-1.5">單位</label><input className={inp} value={editing.unit||'PCS'} onChange={e=>setEditing(p=>({...p,unit:e.target.value}))} /></div>
            <div><label className="block text-[11px] text-slate-500 mb-1.5">分類</label><input className={inp} value={editing.category||''} onChange={e=>setEditing(p=>({...p,category:e.target.value}))} /></div>
            <div>
              <label className="block text-[11px] text-slate-500 mb-1.5">供應商</label>
              <select className={inp} value={editing.supplier_id||''} onChange={e=>handleSupplierChange(e.target.value)}>
                <option value="">-- 選擇供應商 --</option>
                {suppliers.map(s=>(
                  <option key={s.id} value={s.id}>{s.name}{s.supplier_code ? ` (${s.supplier_code})` : ''}</option>
                ))}
              </select>
            </div>
            <div><label className="block text-[11px] text-slate-500 mb-1.5">供應商單價</label><input type="number" className={inp} value={editing.supplier_price || ""} onChange={e=>setEditing(p=>({...p,supplier_price:Number(e.target.value)}))} /></div>
            <div><label className="block text-[11px] text-slate-500 mb-1.5">公司售價</label><input type="number" className={inp} value={editing.company_price || ""} onChange={e=>setEditing(p=>({...p,company_price:Number(e.target.value)}))} /></div>
            <div>
              <label className="block text-[11px] text-slate-500 mb-1.5">幣別</label>
              <select className={inp} value={editing.currency||'VND'} onChange={e=>setEditing(p=>({...p,currency:e.target.value}))}>
                <option>VND</option><option>TWD</option><option>CNY</option><option>USD</option>
              </select>
            </div>
            <div><label className="block text-[11px] text-slate-500 mb-1.5">庫存</label><input type="number" className={inp} value={editing.stock || ""} onChange={e=>setEditing(p=>({...p,stock:Number(e.target.value)}))} /></div>
            <div className="md:col-span-3">
              <label className="block text-[11px] text-slate-500 mb-1.5">圖片</label>
              <div className="flex items-center gap-3">
                {editing.image_url && <img src={editing.image_url} alt="" className="w-12 h-12 object-cover rounded border" onError={e=>{(e.target as HTMLImageElement).style.display='none'}} />}
                <input type="file" accept="image/*" onChange={async e => { const f = e.target.files?.[0]; if (f) { const url = await uploadImage(f); setEditing(p=>({...p,image_url:url})) } }} className="text-sm" />
                {uploading && <span className="text-xs text-slate-400">上傳中...</span>}
              </div>
              <input className={`${inp} mt-2`} placeholder="或輸入圖片 URL" value={editing.image_url||''} onChange={e=>setEditing(p=>({...p,image_url:e.target.value}))} />
            </div>
          </div>
          <div className="flex gap-3 mt-4">
            <button onClick={save} className="btn-primary">儲存</button>
            <button onClick={() => setEditing(null)} className="btn-ghost border border-slate-200">取消</button>
          </div>
        </div>
      )}

      {/* Search */}
      <div className="mb-4">
        <input className="oms-input w-72" placeholder="搜尋料號或材料名稱..." value={search} onChange={e=>setSearch(e.target.value)} />
      </div>

      {/* Table */}
      <div className="oms-card overflow-hidden">
        {loading ? <div className="flex justify-center py-16"><div className="w-5 h-5 border-2 border-blue-200 border-t-blue-600 rounded-full animate-spin" /></div> : (
          <>
            <div className="overflow-x-auto">
              <table className="oms-table" style={{minWidth: 1100}}>
                <thead>
                  <tr>
                    <th className="px-3 py-3 text-left sticky left-0 bg-white z-10 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">圖片</th>
                    <th className="px-3 py-3 text-left sticky left-[52px] bg-white z-10 whitespace-nowrap text-[11px] font-semibold text-slate-500 uppercase tracking-wider">物料編號</th>
                    <th className="px-3 py-3 text-left whitespace-nowrap text-[11px] font-semibold text-slate-500 uppercase tracking-wider">材料名稱</th>
                    <th className="px-3 py-3 text-left whitespace-nowrap text-[11px] font-semibold text-slate-500 uppercase tracking-wider">產品分類</th>
                    <th className="px-3 py-3 text-left whitespace-nowrap text-[11px] font-semibold text-slate-500 uppercase tracking-wider">材料分類</th>
                    <th className="px-3 py-3 text-left whitespace-nowrap text-[11px] font-semibold text-slate-500 uppercase tracking-wider">規格</th>
                    <th className="px-3 py-3 text-left whitespace-nowrap text-[11px] font-semibold text-slate-500 uppercase tracking-wider">單位</th>
                    <th className="px-3 py-3 text-left whitespace-nowrap text-[11px] font-semibold text-slate-500 uppercase tracking-wider">供應商</th>
                    <th className="px-3 py-3 text-right whitespace-nowrap text-[11px] font-semibold text-slate-500 uppercase tracking-wider">供應商單價</th>
                    <th className="px-3 py-3 text-right whitespace-nowrap text-[11px] font-semibold text-slate-500 uppercase tracking-wider">公司售價</th>
                    <th className="px-3 py-3 text-left whitespace-nowrap text-[11px] font-semibold text-slate-500 uppercase tracking-wider">幣別</th>
                    <th className="px-3 py-3 text-right whitespace-nowrap text-[11px] font-semibold text-slate-500 uppercase tracking-wider">庫存</th>
                    <th className="px-3 py-3 text-left whitespace-nowrap text-[11px] font-semibold text-slate-500 uppercase tracking-wider">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.04]">
                  {paged.map(m => (
                    <tr key={m.id} className="hover:bg-slate-50">
                      <td className="px-3 py-2 sticky left-0 bg-white">
                        {m.image_url ? <img src={m.image_url} alt="" className="w-9 h-9 object-cover rounded-lg border border-slate-200" onError={e=>{(e.target as HTMLImageElement).style.display='none'}} /> : <div className="w-9 h-9 bg-white/5 rounded-lg flex items-center justify-center text-slate-300 text-xs">無</div>}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs text-blue-600 sticky left-[52px] bg-white whitespace-nowrap">{m.material_code}</td>
                      <td className="px-3 py-2 text-slate-800 font-medium whitespace-nowrap max-w-[180px] truncate" title={m.material_name}>{m.material_name}</td>
                      <td className="px-3 py-2 text-slate-400 whitespace-nowrap">{m.category}</td>
                      <td className="px-3 py-2 text-slate-400 whitespace-nowrap">{m.product_category}</td>
                      <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{m.spec}</td>
                      <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{m.unit}</td>
                      <td className="px-3 py-2 text-slate-500 whitespace-nowrap max-w-[150px] truncate" title={m.supplier_name || ''}>{m.supplier_name || <span className="text-slate-300 text-xs">未指定</span>}</td>
                      <td className="px-3 py-2 text-right text-slate-600 whitespace-nowrap">{m.supplier_price?.toLocaleString()}</td>
                      <td className="px-3 py-2 text-right text-slate-800 font-medium whitespace-nowrap">{m.company_price?.toLocaleString()}</td>
                      <td className="px-3 py-2 text-slate-400 whitespace-nowrap">{m.currency}</td>
                      <td className="px-3 py-2 text-right text-slate-600 whitespace-nowrap">{m.stock?.toLocaleString()}</td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <div className="flex gap-1">
                          <button onClick={() => setDetail(m)} className="btn-ghost">詳情</button>
                          <button onClick={() => setEditing(m)} className="btn-ghost">編輯</button>
                          <button onClick={() => del(m.id)} className="btn-danger">刪除</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {paged.length === 0 && <tr><td colSpan={13} className="px-4 py-12 text-center text-slate-400">尚無料號</td></tr>}
                </tbody>
              </table>
            </div>
            <Pagination page={page} totalPages={totalPages} setPage={setPage} total={total} />
          </>
        )}
      </div>
    </div>
  )
}
