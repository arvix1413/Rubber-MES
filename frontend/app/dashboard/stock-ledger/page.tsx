'use client'
import { useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api'
import { usePagination, Pagination } from '@/lib/usePagination'

type Ledger = { id: number; material_code: string; material_name: string; transaction_type: string; ref_type: string; ref_number: string; qty_change: number; qty_before: number; qty_after: number; unit: string; batch_no: string; remark: string; created_at: string }

const TX_LABELS: Record<string, { label: string; badge: string }> = {
  GR_IN:    { label: '進貨', badge: 'badge-green' },
  PROD_OUT: { label: '生產領料', badge: 'badge-blue' },
  PROD_IN:  { label: '生產入庫', badge: 'badge-purple' },
  DN_OUT:   { label: '出貨', badge: 'badge-red' },
  ADJ_IN:   { label: '調整增加', badge: 'badge-yellow' },
  ADJ_OUT:  { label: '調整減少', badge: 'badge-yellow' },
  INIT:     { label: '初始', badge: 'badge-gray' },
}

export default function StockLedgerPage() {
  const [logs, setLogs] = useState<Ledger[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterType, setFilterType] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  const load = () => {
    setLoading(true)
    apiFetch<Ledger[]>('/api/stock-ledger?limit=500').then(setLogs).finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [])

  const filtered = logs.filter(l => {
    const matchSearch = !search || l.material_code.toLowerCase().includes(search.toLowerCase()) || l.material_name.toLowerCase().includes(search.toLowerCase())
    const matchType = !filterType || l.transaction_type === filterType
    const d = l.created_at?.slice(0, 10) || ''
    const matchFrom = !dateFrom || d >= dateFrom
    const matchTo = !dateTo || d <= dateTo
    return matchSearch && matchType && matchFrom && matchTo
  })
  const { page, setPage, totalPages, paged, total } = usePagination(filtered, 50)

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-slate-800">庫存流水記錄</h1>
          <p className="text-xs text-slate-400 mt-0.5">所有庫存變動的完整記錄</p>
        </div>
        <button onClick={load} className="btn-ghost">↻ 重新整理</button>
      </div>

      <div className="flex gap-3 mb-4 flex-wrap">
        <input className="oms-input w-52" placeholder="搜尋料號或材料名稱..." value={search} onChange={e => setSearch(e.target.value)} />
        <select className="oms-input w-36" value={filterType} onChange={e => setFilterType(e.target.value)}>
          <option value="">全部類型</option>
          {Object.entries(TX_LABELS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <input type="date" className="oms-input w-36" value={dateFrom} onChange={e => setDateFrom(e.target.value)} title="開始日期" />
        <input type="date" className="oms-input w-36" value={dateTo} onChange={e => setDateTo(e.target.value)} title="結束日期" />
        {(search || filterType || dateFrom || dateTo) && <button onClick={() => { setSearch(''); setFilterType(''); setDateFrom(''); setDateTo('') }} className="btn-ghost">清除</button>}
      </div>

      <div className="oms-card overflow-hidden">
        {loading ? <div className="flex justify-center py-16"><div className="w-5 h-5 border-2 border-blue-200 border-t-blue-600 rounded-full animate-spin" /></div> : (
          <>
            <table className="oms-table">
              <thead><tr>
                <th>時間</th><th>料號</th><th>材料名稱</th><th>類型</th><th>單據號</th>
                <th className="text-right">變動量</th><th className="text-right">變動前</th><th className="text-right">變動後</th>
                <th>批次號</th><th>備註</th>
              </tr></thead>
              <tbody>
                {paged.map(l => {
                  const tx = TX_LABELS[l.transaction_type] || { label: l.transaction_type, badge: 'badge-gray' }
                  return (
                    <tr key={l.id}>
                      <td className="text-xs text-slate-400 whitespace-nowrap">{l.created_at?.slice(0,16)}</td>
                      <td className="font-mono text-xs text-blue-600">{l.material_code}</td>
                      <td className="font-medium">{l.material_name}</td>
                      <td><span className={tx.badge}>{tx.label}</span></td>
                      <td className="text-xs text-slate-400">{l.ref_number}</td>
                      <td className={`text-right font-semibold ${l.qty_change > 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                        {l.qty_change > 0 ? '+' : ''}{l.qty_change} {l.unit}
                      </td>
                      <td className="text-right text-slate-400">{l.qty_before}</td>
                      <td className="text-right font-medium text-slate-700">{l.qty_after}</td>
                      <td className="text-xs text-slate-400">{l.batch_no}</td>
                      <td className="text-xs text-slate-400 max-w-[150px] truncate" title={l.remark}>{l.remark}</td>
                    </tr>
                  )
                })}
                {paged.length === 0 && <tr><td colSpan={10} className="text-center py-12 text-slate-400">尚無庫存流水記錄</td></tr>}
              </tbody>
            </table>
            <Pagination page={page} totalPages={totalPages} setPage={setPage} total={total} pageSize={50} />
          </>
        )}
      </div>
    </div>
  )
}
