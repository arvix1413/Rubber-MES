'use client'
import { useDialog } from '@/components/Dialog'
import FieldLockHint from '@/components/FieldLockHint'
import { useEffect, useState } from 'react'
import { apiFetch, API, getToken } from '@/lib/api'
import { usePagination, Pagination } from '@/lib/usePagination'

type Product = { id: number; sku: string; name: string; category: string; description: string; image_url: string; price: number; stock: number; unit: string; status: string }
const empty = (): Partial<Product> => ({ sku:'', name:'', category:'', description:'', image_url:'', price:0, stock:0, unit:'PCS', status:'active' })

export default function ProductsPage() {
  const { toast, confirm: confirmDialog } = useDialog()

  const [products, setProducts] = useState<Product[]>([])
  const [editing, setEditing] = useState<Partial<Product> | null>(null)
  const [uploading, setUploading] = useState(false)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  const load = () => apiFetch<Product[]>('/api/products').then(setProducts).finally(() => setLoading(false))
  useEffect(() => { load() }, [])

  const uploadImage = async (file: File): Promise<string> => {
    setUploading(true)
    try {
      const fd = new FormData(); fd.append('file', file)
      const res = await fetch(`${API}/api/upload`, { method: 'POST', headers: { Authorization: `Bearer ${getToken()}` }, body: fd })
      const data = await res.json()
      return data.url || ''
    } finally { setUploading(false) }
  }

  const save = async () => {
    if (!editing) return
    try {
      if (editing.id) {
        await apiFetch(`/api/products/${editing.id}`, { method: 'PUT', body: JSON.stringify(editing) })
      } else {
        await apiFetch('/api/products', { method: 'POST', body: JSON.stringify(editing) })
      }
      toast('儲存成功')
      setEditing(null)
      await load()
    } catch (e: any) { toast('錯誤：' + e.message) }
  }

  const del = async (id: number) => {
    if (!await confirmDialog('確定刪除？')) return
    await apiFetch(`/api/products/${id}`, { method: 'DELETE' })
    await load()
  }

  const inp = 'oms-input'
  const filtered = products.filter(p => !search || p.name.toLowerCase().includes(search.toLowerCase()) || (p.sku||'').toLowerCase().includes(search.toLowerCase()))
  const { page, setPage, totalPages, paged, total } = usePagination(filtered, 20)

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-slate-800">商品管理</h1>
        <button onClick={() => setEditing(empty())} className="btn-primary">+ 新增商品</button>
      </div>

      {/* Form */}
      {editing && (
        <div className="oms-card p-6 mb-5">
          <h2 className="font-semibold mb-4">{editing.id ? '編輯商品' : '新增商品'}</h2>
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <label className="flex items-center gap-1.5 text-xs font-medium mb-1">
                SKU *
                {!!editing.id && <FieldLockHint />}
              </label>
              <input
                className={inp}
                value={editing.sku||''}
                onChange={e=>setEditing(p=>({...p,sku:e.target.value}))}
                disabled={!!editing.id}
              />
              {!!editing.id && <p className="text-[10px] text-slate-400 mt-1">SKU 建立後不可修改</p>}
            </div>
            <div><label className="block text-xs font-medium mb-1">商品名稱 *</label><input className={inp} value={editing.name||''} onChange={e=>setEditing(p=>({...p,name:e.target.value}))} /></div>
            <div><label className="block text-xs font-medium mb-1">分類</label><input className={inp} value={editing.category||''} onChange={e=>setEditing(p=>({...p,category:e.target.value}))} /></div>
            <div><label className="block text-xs font-medium mb-1">單位</label><input className={inp} value={editing.unit||'PCS'} onChange={e=>setEditing(p=>({...p,unit:e.target.value}))} /></div>
            <div><label className="block text-xs font-medium mb-1">售價 (VND)</label><input type="number" className={inp} value={editing.price || ""} onChange={e=>setEditing(p=>({...p,price:Number(e.target.value)}))} /></div>
            <div><label className="block text-xs font-medium mb-1">庫存</label><input type="number" className={inp} value={editing.stock || ""} onChange={e=>setEditing(p=>({...p,stock:Number(e.target.value)}))} /></div>
            <div className="md:col-span-2"><label className="block text-xs font-medium mb-1">描述</label><textarea className={`${inp} h-16`} value={editing.description||''} onChange={e=>setEditing(p=>({...p,description:e.target.value}))} /></div>
            <div className="md:col-span-2">
              <label className="block text-xs font-medium mb-1">商品圖片</label>
              <div className="flex items-center gap-3">
                {editing.image_url && <img src={editing.image_url} alt="" className="w-16 h-16 object-cover rounded-lg border" />}
                <input type="file" accept="image/*" onChange={async e => {
                  const f = e.target.files?.[0]; if (!f) return
                  const url = await uploadImage(f)
                  setEditing(p => ({...p, image_url: url}))
                }} className="text-sm" />
                {uploading && <span className="text-xs text-slate-400">上傳中...</span>}
              </div>
              <input className={`${inp} mt-2`} placeholder="或直接輸入圖片 URL" value={editing.image_url||''} onChange={e=>setEditing(p=>({...p,image_url:e.target.value}))} />
            </div>
          </div>
          <div className="flex gap-3 mt-4">
            <button onClick={save} className="btn-primary">儲存</button>
            <button onClick={() => setEditing(null)} className="btn-ghost border border-slate-200 hover:bg-gray-300">取消</button>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="mb-4"><input className="oms-input w-64" placeholder="搜尋商品名稱或SKU..." value={search} onChange={e=>setSearch(e.target.value)} /></div>

      <div className="oms-card overflow-hidden">
        {loading ? <div className="flex justify-center py-16"><div className="w-5 h-5 border-2 border-blue-200 border-t-blue-600 rounded-full animate-spin" /></div> : (
          <>
            <table className="oms-table">
              <thead className="bg-transparent text-xs text-slate-400 uppercase">
                <tr>
                  <th className="px-4 py-3 text-left">圖片</th>
                  <th className="px-4 py-3 text-left">SKU</th>
                  <th className="px-4 py-3 text-left">商品名稱</th>
                  <th className="px-4 py-3 text-left">分類</th>
                  <th className="px-4 py-3 text-right">售價</th>
                  <th className="px-4 py-3 text-right">庫存</th>
                  <th className="px-4 py-3 text-left">狀態</th>
                  <th className="px-4 py-3 text-left">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">
                {paged.map(p => (
                  <tr key={p.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      {p.image_url ? (
                        <img src={p.image_url} alt={p.name} className="w-12 h-12 object-cover rounded-lg border"
                          onError={e => { (e.target as HTMLImageElement).src = 'https://via.placeholder.com/48' }} />
                      ) : <div className="w-12 h-12 bg-gray-100 rounded-lg flex items-center justify-center text-slate-300 text-xs">無圖</div>}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-blue-600">{p.sku}</td>
                    <td className="px-4 py-3 text-slate-800 text-slate-800 font-medium">{p.name}</td>
                    <td className="px-4 py-3 text-slate-500">{p.category}</td>
                    <td className="px-4 py-3 text-right">{p.price.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right">{p.stock}</td>
                    <td className="px-4 py-3">
                      <span className={p.status === 'active' ? 'badge-green' : 'badge-gray'}>{p.status === 'active' ? '啟用' : '停用'}</span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2">
                        <button onClick={() => setEditing(p)} className="btn-ghost">編輯</button>
                        <button onClick={() => del(p.id)} className="btn-danger">刪除</button>
                      </div>
                    </td>
                  </tr>
                ))}
                {paged.length === 0 && <tr><td colSpan={8} className="px-4 py-12 text-center text-slate-400">尚無商品</td></tr>}
              </tbody>
            </table>
            <Pagination page={page} totalPages={totalPages} setPage={setPage} total={total} />
          </>
        )}
      </div>
    </div>
  )
}
