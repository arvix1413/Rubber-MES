'use client'
import { useDialog } from '@/components/Dialog'
import FieldLockHint from '@/components/FieldLockHint'
import { useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api'
import { usePagination, Pagination } from '@/lib/usePagination'
import { validate } from '@/lib/validate'

type Customer = { id:number; customer_code:string; customer_name:string; tax_id:string; contact:string; phone:string; email:string; address:string; main_products:string; payment_terms:string; status:string }
const empty = (): Partial<Customer> => ({ customer_code:'', customer_name:'', tax_id:'', contact:'', phone:'', email:'', address:'', main_products:'', payment_terms:'', status:'active' })

function Modal({ title, onClose, children }: { title:string; onClose:()=>void; children:React.ReactNode }) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-lg max-h-[85vh] overflow-auto shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <h2 className="text-sm font-semibold text-slate-800">{title}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-lg leading-none">✕</button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  )
}

function DR({ label, value }: { label:string; value?:string|null }) {
  if (!value) return null
  return (
    <div className="flex gap-3 py-2.5 border-b border-slate-100 last:border-0">
      <span className="text-xs text-slate-400 w-20 shrink-0 pt-0.5">{label}</span>
      <span className="text-sm text-slate-600 break-all">{value}</span>
    </div>
  )
}

export default function CustomersPage() {
  const { toast, confirm: confirmDialog } = useDialog()

  const [items, setItems] = useState<Customer[]>([])
  const [editing, setEditing] = useState<Partial<Customer>|null>(null)
  const [detail, setDetail] = useState<Customer|null>(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  const load = () => apiFetch<Customer[]>('/api/customers').then(setItems).finally(()=>setLoading(false))
  useEffect(()=>{ load() },[])

  const save = async () => {
    if (!editing) return
    const err = validate(editing, [
      { field: 'customer_code', label: '客戶編號', required: true },
      { field: 'customer_name', label: '客戶名稱', required: true },
      { field: 'email', label: '電子郵件', email: true },
      { field: 'phone', label: '電話', phone: true },
    ])
    if (err) { toast(err, 'error'); return }
    try {
      if (editing.id) await apiFetch(`/api/customers/${editing.id}`,{method:'PUT',body:JSON.stringify(editing)})
      else await apiFetch('/api/customers',{method:'POST',body:JSON.stringify(editing)})
      toast('儲存成功'); setEditing(null)
      await load()
    } catch(e:any){ toast('錯誤：'+e.message, 'error') }
  }
  const del = async (id:number) => {
    if (!await confirmDialog('確定刪除？')) return
    try {
      await apiFetch(`/api/customers/${id}`,{method:'DELETE'})
      toast('已刪除')
      await load()
    } catch(e:any){ toast('刪除失敗：'+e.message, 'error') }
  }

  const filtered = items.filter(c => !search || c.customer_name.toLowerCase().includes(search.toLowerCase()) || (c.customer_code||'').toLowerCase().includes(search.toLowerCase()))
  const { page, setPage, totalPages, paged, total } = usePagination(filtered, 20)

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-slate-800">客戶管理</h1>
          <p className="text-xs text-slate-400 mt-0.5">管理所有客戶資訊</p>
        </div>
        <button onClick={()=>setEditing(empty())} className="btn-primary"><span className="text-base leading-none">+</span> 新增客戶</button>
      </div>

      {detail && (
        <Modal title="客戶詳情" onClose={()=>setDetail(null)}>
          <div className="mb-4">
            <div className="text-base font-bold text-slate-800">{detail.customer_name}</div>
            <div className="text-xs text-slate-400 font-mono mt-0.5">{detail.customer_code}</div>
          </div>
          <DR label="稅號" value={detail.tax_id} />
          <DR label="聯絡人" value={detail.contact} />
          <DR label="電話" value={detail.phone} />
          <DR label="電子郵件" value={detail.email} />
          <DR label="地址" value={detail.address} />
          <DR label="主要產品" value={detail.main_products} />
          <DR label="付款方式" value={detail.payment_terms} />
          <div className="mt-4"><button onClick={()=>{ setEditing(detail); setDetail(null) }} className="btn-primary w-full justify-center">編輯</button></div>
        </Modal>
      )}

      {editing && (
        <Modal title={editing.id?'編輯客戶':'新增客戶'} onClose={()=>setEditing(null)}>
          <div className="grid grid-cols-2 gap-3">
            {[['客戶編號 *','customer_code'],['客戶名稱 *','customer_name'],['稅號','tax_id'],['聯絡人','contact'],['電話','phone'],['電子郵件','email'],['付款方式','payment_terms'],['主要產品','main_products']].map(([label,key])=>(
              <div key={key} className={key==='customer_name'?'col-span-2':''}>
                <label className="flex items-center gap-1.5 text-[11px] text-slate-500 mb-1.5">
                  {label}
                  {key === 'customer_code' && !!editing.id && <FieldLockHint />}
                </label>
                <input
                  className="oms-input"
                  value={(editing as any)[key]||''}
                  onChange={e=>setEditing(p=>({...p,[key]:e.target.value}))}
                  disabled={key === 'customer_code' && !!editing.id}
                />
                {key === 'customer_code' && !!editing.id && <p className="text-[10px] text-slate-400 mt-1">客戶編號建立後不可修改</p>}
              </div>
            ))}
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

      <div className="mb-4"><input className="oms-input w-64" placeholder="搜尋客戶名稱或編號..." value={search} onChange={e=>setSearch(e.target.value)} /></div>

      <div className="oms-card overflow-hidden">
        {loading ? <div className="flex justify-center py-16"><div className="w-5 h-5 border-2 border-blue-200 border-t-blue-600 rounded-full animate-spin"/></div> : (
          <>
            <div className="overflow-x-auto">
              <table className="oms-table">
                <thead><tr><th>客戶編號</th><th>客戶名稱</th><th>聯絡人</th><th>電話</th><th>付款方式</th><th>狀態</th><th>操作</th></tr></thead>
                <tbody>
                  {paged.map(c=>(
                    <tr key={c.id}>
                      <td><span className="font-mono text-xs text-blue-600">{c.customer_code}</span></td>
                      <td><span className="text-slate-800 font-medium block max-w-[200px] truncate" title={c.customer_name}>{c.customer_name}</span></td>
                      <td>{c.contact}</td>
                      <td>{c.phone}</td>
                      <td>{c.payment_terms}</td>
                      <td><span className={c.status==='active'?'badge-green':'badge-gray'}><span className={`w-1 h-1 rounded-full ${c.status==='active'?'bg-emerald-400':'bg-white/20'}`}/>{c.status==='active'?'啟用':'停用'}</span></td>
                      <td><div className="flex items-center gap-1"><button onClick={()=>setDetail(c)} className="btn-ghost">詳情</button><button onClick={()=>setEditing(c)} className="btn-ghost">編輯</button><button onClick={()=>del(c.id)} className="btn-danger">刪除</button></div></td>
                    </tr>
                  ))}
                  {paged.length===0 && <tr><td colSpan={7} className="text-center py-12 text-slate-400">尚無客戶資料</td></tr>}
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
