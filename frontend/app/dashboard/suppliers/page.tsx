'use client'
import { useDialog } from '@/components/Dialog'
import FieldLockHint from '@/components/FieldLockHint'
import { useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api'
import { usePagination, Pagination } from '@/lib/usePagination'
import { validate } from '@/lib/validate'

type Supplier = { id: number; supplier_code: string; name: string; tax_id: string; contact: string; phone: string; email: string; address: string; main_items: string; payment_terms: string; currency: string; status: string }
const empty = (): Partial<Supplier> => ({ supplier_code:'', name:'', tax_id:'', contact:'', phone:'', email:'', address:'', main_items:'', payment_terms:'', currency:'VND', status:'active' })

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-lg max-h-[85vh] overflow-auto shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <h2 className="text-sm font-semibold text-slate-800">{title}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors text-lg leading-none">✕</button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  )
}

function DetailRow({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null
  return (
    <div className="flex gap-3 py-2.5 border-b border-slate-100 last:border-0">
      <span className="text-xs text-slate-400 w-20 shrink-0 pt-0.5">{label}</span>
      <span className="text-sm text-slate-600 break-all">{value}</span>
    </div>
  )
}

export default function SuppliersPage() {
  const { toast, confirm: confirmDialog } = useDialog()

  const [items, setItems] = useState<Supplier[]>([])
  const [editing, setEditing] = useState<Partial<Supplier>|null>(null)
  const [detail, setDetail] = useState<Supplier|null>(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  const load = () => apiFetch<Supplier[]>('/api/suppliers').then(setItems).finally(()=>setLoading(false))
  useEffect(()=>{ load() },[])

  const save = async () => {
    if (!editing) return
    const err = validate(editing, [
      { field: 'name', label: '供應商名稱', required: true },
      { field: 'email', label: '電子郵件', email: true },
      { field: 'phone', label: '電話', phone: true },
    ])
    if (err) { toast(err, 'error'); return }
    try {
      if (editing.id) await apiFetch(`/api/suppliers/${editing.id}`,{method:'PUT',body:JSON.stringify(editing)})
      else await apiFetch('/api/suppliers',{method:'POST',body:JSON.stringify(editing)})
      toast('儲存成功'); setEditing(null)
      await load()
    } catch(e:any){ toast('錯誤：'+e.message, 'error') }
  }
  const del = async (id:number) => {
    if (!await confirmDialog('確定刪除？')) return
    try {
      await apiFetch(`/api/suppliers/${id}`,{method:'DELETE'})
      toast('已刪除')
      await load()
    } catch(e:any){ toast('刪除失敗：'+e.message, 'error') }
  }

  const filtered = items.filter(s => !search || s.name.toLowerCase().includes(search.toLowerCase()) || (s.supplier_code||'').toLowerCase().includes(search.toLowerCase()))
  const { page, setPage, totalPages, paged, total } = usePagination(filtered, 20)

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-slate-800">供應商管理</h1>
          <p className="text-xs text-slate-400 mt-0.5">管理所有合作供應商資訊</p>
        </div>
        <button onClick={()=>setEditing(empty())} className="btn-primary">
          <span className="text-base leading-none">+</span> 新增供應商
        </button>
      </div>

      {detail && (
        <Modal title="供應商詳情" onClose={()=>setDetail(null)}>
          <div className="mb-4">
            <div className="text-base font-bold text-slate-800">{detail.name}</div>
            <div className="text-xs text-slate-400 font-mono mt-0.5">{detail.supplier_code}</div>
          </div>
          <DetailRow label="稅號" value={detail.tax_id} />
          <DetailRow label="聯絡人" value={detail.contact} />
          <DetailRow label="電話" value={detail.phone} />
          <DetailRow label="電子郵件" value={detail.email} />
          <DetailRow label="地址" value={detail.address} />
          <DetailRow label="主要品項" value={detail.main_items} />
          <DetailRow label="付款方式" value={detail.payment_terms} />
          <DetailRow label="幣別" value={detail.currency} />
          <div className="mt-4">
            <button onClick={()=>{ setEditing(detail); setDetail(null) }} className="btn-primary w-full justify-center">編輯</button>
          </div>
        </Modal>
      )}

      {editing && (
        <Modal title={editing.id ? '編輯供應商' : '新增供應商'} onClose={()=>setEditing(null)}>
          <div className="grid grid-cols-2 gap-3">
            {[
              ['供應商編號','supplier_code'],['供應商名稱 *','name'],['稅號','tax_id'],
              ['聯絡人','contact'],['電話','phone'],['電子郵件','email'],
              ['主要品項','main_items'],['付款方式','payment_terms'],
            ].map(([label, key]) => (
              <div key={key} className={key === 'name' ? 'col-span-2' : ''}>
                <label className="flex items-center gap-1.5 text-[11px] text-slate-500 mb-1.5">
                  {label}
                  {key === 'supplier_code' && !!editing.id && <FieldLockHint />}
                </label>
                <input
                  className="oms-input"
                  value={(editing as any)[key]||''}
                  onChange={e=>setEditing(p=>({...p,[key]:e.target.value}))}
                  disabled={key === 'supplier_code' && !!editing.id}
                />
                {key === 'supplier_code' && !!editing.id && <p className="text-[10px] text-slate-400 mt-1">供應商編號建立後不可修改</p>}
              </div>
            ))}
            <div>
              <label className="block text-[11px] text-slate-500 mb-1.5">幣別</label>
              <select className="oms-input" value={editing.currency||'VND'} onChange={e=>setEditing(p=>({...p,currency:e.target.value}))}>
                <option>VND</option><option>TWD</option><option>CNY</option><option>USD</option>
              </select>
            </div>
            <div className="col-span-2">
              <label className="block text-[11px] text-slate-500 mb-1.5">地址</label>
              <input className="oms-input" value={editing.address||''} onChange={e=>setEditing(p=>({...p,address:e.target.value}))} />
            </div>
          </div>
          <div className="flex gap-2 mt-5">
            <button onClick={save} className="btn-primary flex-1 justify-center">儲存</button>
            <button onClick={()=>setEditing(null)} className="btn-ghost flex-1 justify-center border border-slate-200">取消</button>
          </div>
        </Modal>
      )}

      {/* Search */}
      <div className="mb-4">
        <input className="oms-input w-64" placeholder="搜尋供應商名稱或編號..." value={search} onChange={e=>setSearch(e.target.value)} />
      </div>

      <div className="oms-card overflow-hidden">
        {loading ? (
          <div className="flex justify-center py-16"><div className="w-5 h-5 border-2 border-blue-200 border-t-blue-600 rounded-full animate-spin"/></div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="oms-table">
                <thead>
                  <tr>
                    <th>供應商編號</th><th>供應商名稱</th><th>聯絡人</th>
                    <th>電話</th><th>主要品項</th><th>付款方式</th><th>狀態</th><th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {paged.map(s=>(
                    <tr key={s.id}>
                      <td><span className="font-mono text-xs text-blue-600">{s.supplier_code || '—'}</span></td>
                      <td><span className="text-slate-800 font-medium block max-w-[220px] truncate" title={s.name}>{s.name}</span></td>
                      <td>{s.contact}</td>
                      <td>{s.phone}</td>
                      <td>{s.main_items}</td>
                      <td>{s.payment_terms}</td>
                      <td>
                        <span className={s.status==='active' ? 'badge-green' : 'badge-gray'}>
                          <span className={`w-1 h-1 rounded-full ${s.status==='active'?'bg-emerald-400':'bg-white/20'}`}/>
                          {s.status==='active'?'啟用':'停用'}
                        </span>
                      </td>
                      <td>
                        <div className="flex items-center gap-1">
                          <button onClick={()=>setDetail(s)} className="btn-ghost">詳情</button>
                          <button onClick={()=>setEditing(s)} className="btn-ghost">編輯</button>
                          <button onClick={()=>del(s.id)} className="btn-danger">刪除</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {paged.length===0 && <tr><td colSpan={8} className="text-center py-12 text-slate-400">尚無供應商資料</td></tr>}
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
