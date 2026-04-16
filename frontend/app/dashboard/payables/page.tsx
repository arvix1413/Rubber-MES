'use client'
import { useDialog } from '@/components/Dialog'
import { useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api'
import { usePagination, Pagination } from '@/lib/usePagination'

type AP = {
  id: number; po_number: string; supplier_name: string; total_amount: number
  currency: string; status: string; paid_amount: number; payment_status: string | null
  payment_date: string | null; payment_note: string; approved_at: string; created_at: string
}

const PO_STATUS: Record<string, string> = {
  approved: '已核准', sent: '已送出', received: '已收貨'
}

const PAY_STATUS = {
  null: { label: '待付款', badge: 'badge-gray' },
  pending: { label: '待付款', badge: 'badge-gray' },
  partial: { label: '部分付款', badge: 'badge-blue' },
  paid: { label: '已付款', badge: 'badge-green' },
}

export default function PayablesPage() {
  const { toast, confirm: confirmDialog } = useDialog()

  const [items, setItems] = useState<AP[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<AP | null>(null)
  const [form, setForm] = useState({ payment_status: 'paid', paid_amount: 0, payment_date: '', payment_note: '' })
  const [search, setSearch] = useState('')
  const [payFilter, setPayFilter] = useState('')

  const load = () => apiFetch<AP[]>('/api/payables').then(setItems).finally(() => setLoading(false))
  useEffect(() => { load() }, [])

  const openEdit = (item: AP) => {
    setEditing(item)
    setForm({
      payment_status: item.payment_status || 'paid',
      paid_amount: item.total_amount,
      payment_date: new Date().toISOString().slice(0, 10),
      payment_note: item.payment_note || '',
    })
  }

  const save = async () => {
    if (!editing) return
    try {
      await apiFetch(`/api/payables/${editing.id}/payment`, { method: 'PATCH', body: JSON.stringify(form) })
      toast('已更新付款狀態')
      setEditing(null)
      load()
    } catch (e: any) { toast('錯誤：' + e.message) }
  }

  const filtered = items.filter(i => {
    const matchSearch = !search ||
      i.po_number.toLowerCase().includes(search.toLowerCase()) ||
      i.supplier_name.toLowerCase().includes(search.toLowerCase())
    const matchPay = !payFilter || (i.payment_status || 'pending') === payFilter
    return matchSearch && matchPay
  })
  const { page, setPage, totalPages, paged, total } = usePagination(filtered, 20)

  const totalPayable = items.reduce((s, i) => s + (i.total_amount || 0), 0)
  const totalPaid = items.filter(i => i.payment_status === 'paid').reduce((s, i) => s + (i.paid_amount || 0), 0)
  const totalPending = totalPayable - totalPaid

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-slate-800">應付帳款管理（付款）</h1>
          <p className="text-xs text-slate-400 mt-0.5">採購單的付款追蹤</p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="oms-card p-4">
          <div className="text-xs text-slate-400 mb-1">應付總額</div>
          <div className="text-xl font-bold text-slate-800">{totalPayable.toLocaleString()}</div>
        </div>
        <div className="oms-card p-4">
          <div className="text-xs text-slate-400 mb-1">已付款</div>
          <div className="text-xl font-bold text-emerald-600">{totalPaid.toLocaleString()}</div>
        </div>
        <div className="oms-card p-4">
          <div className="text-xs text-slate-400 mb-1">待付款</div>
          <div className="text-xl font-bold text-amber-500">{totalPending.toLocaleString()}</div>
        </div>
      </div>

      {editing && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white border border-slate-200 rounded-2xl shadow-xl p-6 w-full max-w-md">
            <h2 className="text-sm font-semibold text-slate-800 mb-4">更新付款 — {editing.po_number}</h2>
            <div className="space-y-3">
              <div>
                <label className="block text-[11px] text-slate-500 mb-1.5">付款狀態</label>
                <select className="oms-input" value={form.payment_status} onChange={e => setForm(p => ({ ...p, payment_status: e.target.value }))}>
                  <option value="pending">待付款</option>
                  <option value="partial">部分付款</option>
                  <option value="paid">已付款</option>
                </select>
              </div>
              <div>
                <label className="block text-[11px] text-slate-500 mb-1.5">付款金額（應付：{Number(editing.total_amount||0).toLocaleString()} {editing.currency}）</label>
                <input type="number" className="oms-input" value={form.paid_amount} onChange={e => setForm(p => ({ ...p, paid_amount: Number(e.target.value) }))} />
              </div>
              <div>
                <label className="block text-[11px] text-slate-500 mb-1.5">付款日期</label>
                <input type="date" className="oms-input" value={form.payment_date} onChange={e => setForm(p => ({ ...p, payment_date: e.target.value }))} />
              </div>
              <div>
                <label className="block text-[11px] text-slate-500 mb-1.5">備註</label>
                <input className="oms-input" value={form.payment_note} onChange={e => setForm(p => ({ ...p, payment_note: e.target.value }))} />
              </div>
            </div>
            <div className="flex gap-2 mt-5">
              <button onClick={save} className="btn-primary flex-1 justify-center">儲存</button>
              <button onClick={() => setEditing(null)} className="btn-ghost flex-1 justify-center border border-slate-200">取消</button>
            </div>
          </div>
        </div>
      )}

      <div className="mb-4 flex gap-3">
        <input className="oms-input w-64" placeholder="搜尋採購單號或供應商..." value={search} onChange={e => setSearch(e.target.value)} />
        <div className="flex gap-1">
          {[['', '全部'], ['pending', '待付款'], ['partial', '部分付款'], ['paid', '已付款']].map(([val, label]) => (
            <button key={val} onClick={() => setPayFilter(val)}
              className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${payFilter === val ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300'}`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="oms-card overflow-hidden">
        {loading ? <div className="flex justify-center py-16"><div className="w-5 h-5 border-2 border-blue-200 border-t-blue-600 rounded-full animate-spin" /></div> : (
          <>
            <table className="oms-table">
              <thead><tr>
                <th>採購單號</th><th>供應商</th><th>採購單狀態</th>
                <th className="text-right">應付金額</th><th>幣別</th>
                <th className="text-right">已付金額</th><th>付款日期</th><th>付款狀態</th><th>操作</th>
              </tr></thead>
              <tbody>
                {paged.map(item => {
                  const st = PAY_STATUS[(item.payment_status as keyof typeof PAY_STATUS) || 'null'] || PAY_STATUS.null
                  return (
                    <tr key={item.id}>
                      <td className="font-mono text-xs text-blue-600">{item.po_number}</td>
                      <td className="font-medium">{item.supplier_name}</td>
                      <td><span className="badge-blue">{PO_STATUS[item.status] || item.status}</span></td>
                      <td className="text-right font-medium">{(item.total_amount || 0).toLocaleString()}</td>
                      <td className="text-slate-400 text-xs">{item.currency}</td>
                      <td className="text-right text-emerald-600">{(item.paid_amount || 0).toLocaleString()}</td>
                      <td className="text-slate-400 text-xs">{item.payment_date}</td>
                      <td><span className={st.badge}>{st.label}</span></td>
                      <td>
                        <button onClick={() => openEdit(item)} className="btn-ghost">付款</button>
                      </td>
                    </tr>
                  )
                })}
                {paged.length === 0 && <tr><td colSpan={9} className="text-center py-12 text-slate-400">尚無待付款記錄（採購單需已核准）</td></tr>}
              </tbody>
            </table>
            <Pagination page={page} totalPages={totalPages} setPage={setPage} total={total} />
          </>
        )}
      </div>
    </div>
  )
}
