'use client'
import { useDialog } from '@/components/Dialog'
import { useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api'
import { usePagination, Pagination } from '@/lib/usePagination'

type AR = {
  id: number; dn_number: string; customer_name: string; delivery_date: string
  invoice_amount: number; received_amount: number; payment_status: string | null
  payment_date: string | null; payment_note: string; customer_po: string
}

const STATUS = {
  null: { label: '待收款', badge: 'badge-gray' },
  pending: { label: '待收款', badge: 'badge-gray' },
  partial: { label: '部分收款', badge: 'badge-blue' },
  paid: { label: '已收款', badge: 'badge-green' },
}

export default function ReceivablesPage() {
  const { toast, confirm: confirmDialog } = useDialog()

  const [items, setItems] = useState<AR[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<AR | null>(null)
  const [form, setForm] = useState({ payment_status: 'paid', received_amount: 0, payment_date: '', payment_note: '' })
  const [search, setSearch] = useState('')
  const [payFilter, setPayFilter] = useState('')

  const load = () => apiFetch<AR[]>('/api/receivables').then(setItems).finally(() => setLoading(false))
  useEffect(() => { load() }, [])

  const openEdit = (item: AR) => {
    setEditing(item)
    setForm({
      payment_status: item.payment_status || 'paid',
      received_amount: item.invoice_amount,
      payment_date: new Date().toISOString().slice(0, 10),
      payment_note: item.payment_note || '',
    })
  }

  const save = async () => {
    if (!editing) return
    try {
      await apiFetch(`/api/receivables/${editing.id}/payment`, { method: 'PATCH', body: JSON.stringify(form) })
      toast('已更新收款狀態')
      setEditing(null)
      load()
    } catch (e: any) { toast('錯誤：' + e.message) }
  }

  const filtered = items.filter(i => {
    const matchSearch = !search ||
      i.dn_number.toLowerCase().includes(search.toLowerCase()) ||
      i.customer_name.toLowerCase().includes(search.toLowerCase())
    const matchPay = !payFilter || (i.payment_status || 'pending') === payFilter
    return matchSearch && matchPay
  })
  const { page, setPage, totalPages, paged, total } = usePagination(filtered, 20)

  const totalInvoiced = items.reduce((s, i) => s + (i.invoice_amount || 0), 0)
  const totalReceived = items.filter(i => i.payment_status === 'paid').reduce((s, i) => s + (i.received_amount || 0), 0)
  const totalPending = totalInvoiced - totalReceived

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-slate-800">應收帳款管理（收款）</h1>
          <p className="text-xs text-slate-400 mt-0.5">已出貨訂單的收款追蹤</p>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="oms-card p-4">
          <div className="text-xs text-slate-400 mb-1">應收總額</div>
          <div className="text-xl font-bold text-slate-800">{totalInvoiced.toLocaleString()}</div>
        </div>
        <div className="oms-card p-4">
          <div className="text-xs text-slate-400 mb-1">已收款</div>
          <div className="text-xl font-bold text-emerald-600">{totalReceived.toLocaleString()}</div>
        </div>
        <div className="oms-card p-4">
          <div className="text-xs text-slate-400 mb-1">待收款</div>
          <div className="text-xl font-bold text-amber-500">{totalPending.toLocaleString()}</div>
        </div>
      </div>

      {editing && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white border border-slate-200 rounded-2xl shadow-xl p-6 w-full max-w-md">
            <h2 className="text-sm font-semibold text-slate-800 mb-4">更新收款 — {editing.dn_number}</h2>
            <div className="space-y-3">
              <div>
                <label className="block text-[11px] text-slate-500 mb-1.5">收款狀態</label>
                <select className="oms-input" value={form.payment_status} onChange={e => setForm(p => ({ ...p, payment_status: e.target.value }))}>
                  <option value="pending">待收款</option>
                  <option value="partial">部分收款</option>
                  <option value="paid">已收款</option>
                </select>
              </div>
              <div>
                <label className="block text-[11px] text-slate-500 mb-1.5">收款金額（應收：{Number(editing.invoice_amount||0).toLocaleString()}）</label>
                <input type="number" className="oms-input" value={form.received_amount} onChange={e => setForm(p => ({ ...p, received_amount: Number(e.target.value) }))} />
              </div>
              <div>
                <label className="block text-[11px] text-slate-500 mb-1.5">收款日期</label>
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
        <input className="oms-input w-64" placeholder="搜尋出貨單號或客戶..." value={search} onChange={e => setSearch(e.target.value)} />
        <div className="flex gap-1">
          {[['', '全部'], ['pending', '待收款'], ['partial', '部分收款'], ['paid', '已收款']].map(([val, label]) => (
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
                <th>出貨單號</th><th>客戶</th><th>客戶PO</th><th>出貨日期</th>
                <th className="text-right">應收金額</th><th className="text-right">已收金額</th>
                <th>收款日期</th><th>狀態</th><th>操作</th>
              </tr></thead>
              <tbody>
                {paged.map(item => {
                  const st = STATUS[(item.payment_status as keyof typeof STATUS) || 'null'] || STATUS.null
                  return (
                    <tr key={item.id}>
                      <td className="font-mono text-xs text-blue-600">{item.dn_number}</td>
                      <td className="font-medium">{item.customer_name}</td>
                      <td className="text-slate-400 text-xs">{item.customer_po}</td>
                      <td className="text-slate-400 text-xs">{item.delivery_date}</td>
                      <td className="text-right font-medium">{(item.invoice_amount || 0).toLocaleString()}</td>
                      <td className="text-right text-emerald-600">{(item.received_amount || 0).toLocaleString()}</td>
                      <td className="text-slate-400 text-xs">{item.payment_date}</td>
                      <td><span className={st.badge}>{st.label}</span></td>
                      <td>
                        <button onClick={() => openEdit(item)} className="btn-ghost">收款</button>
                      </td>
                    </tr>
                  )
                })}
                {paged.length === 0 && <tr><td colSpan={9} className="text-center py-12 text-slate-400">尚無待收款記錄（出貨單狀態需為「已出貨」）</td></tr>}
              </tbody>
            </table>
            <Pagination page={page} totalPages={totalPages} setPage={setPage} total={total} />
          </>
        )}
      </div>
    </div>
  )
}
