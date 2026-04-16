'use client'
import { useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api'
import { usePagination, Pagination } from '@/lib/usePagination'

type Inv = {
  id: number
  product_code: string
  product_name: string
  spec: string
  unit: string
  closing_balance: number
  category: string
  supplier_name: string
  currency: string
  image_url?: string
}

export default function InventoryPage() {
  const [items, setItems] = useState<Inv[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [stockFilter, setStockFilter] = useState<'all' | 'low' | 'ok'>('all')
  const [lastRefresh, setLastRefresh] = useState(new Date())

  const load = () => {
    setLoading(true)
    apiFetch<Inv[]>('/api/inventory/bom').then(setItems).finally(() => {
      setLoading(false)
      setLastRefresh(new Date())
    })
  }
  useEffect(() => { load() }, [])

  const filtered = items.filter(i => {
    const q = search.toLowerCase()
    const matchSearch = !search ||
      i.product_code.toLowerCase().includes(q) ||
      i.product_name.toLowerCase().includes(q) ||
      (i.spec || '').toLowerCase().includes(q) ||
      (i.supplier_name || '').toLowerCase().includes(q)
    const stock = Number(i.closing_balance)
    const matchStock =
      stockFilter === 'all' ? true :
      stockFilter === 'low' ? stock <= 0 :
      stock > 0
    return matchSearch && matchStock
  })

  const { page, setPage, totalPages, paged, total } = usePagination(filtered, 30)
  const totalStock = filtered.reduce((s, i) => s + (Number(i.closing_balance) || 0), 0)
  const lowStock = items.filter(i => Number(i.closing_balance) <= 0).length

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-slate-800">庫存查詢</h1>
          <p className="text-xs text-slate-400 mt-0.5">
            BOM 成品庫存 · 最後更新：{lastRefresh.toLocaleTimeString()}
          </p>
        </div>
        <button onClick={load} className="btn-ghost border border-slate-200 flex items-center gap-2">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
            <path d="M23 4v6h-6M1 20v-6h6"/>
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
          </svg>
          重新整理
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="oms-card p-4">
          <div className="text-xs text-slate-400 mb-1">BOM 品項總數</div>
          <div className="text-2xl font-bold text-slate-800">{items.length}</div>
        </div>
        <div className="oms-card p-4">
          <div className="text-xs text-slate-400 mb-1">篩選結果庫存總量</div>
          <div className="text-2xl font-bold text-blue-600">{totalStock.toLocaleString()}</div>
        </div>
        <div className="oms-card p-4">
          <div className="text-xs text-slate-400 mb-1">零庫存品項</div>
          <div className={`text-2xl font-bold ${lowStock > 0 ? 'text-red-500' : 'text-emerald-600'}`}>{lowStock}</div>
        </div>
      </div>

      {/* Low stock alert banner */}
      {!loading && lowStock > 0 && (
        <div className="mb-4 flex items-center gap-3 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5 flex-shrink-0 text-red-500">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
            <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
          </svg>
          <span>有 <strong>{lowStock}</strong> 個品項庫存為零，請及時補貨</span>
          <button onClick={() => setStockFilter('low')} className="ml-auto text-xs underline hover:no-underline">檢視零庫存</button>
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-3 mb-4">
        <input className="oms-input w-64" placeholder="搜尋料號、品名、規格、供應商..." value={search} onChange={e => setSearch(e.target.value)} />
        <div className="flex gap-1">
          {(['all', 'ok', 'low'] as const).map(f => (
            <button key={f} onClick={() => setStockFilter(f)}
              className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${stockFilter === f ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300'}`}>
              {f === 'all' ? '全部' : f === 'ok' ? '有庫存' : '零庫存'}
            </button>
          ))}
        </div>
      </div>

      <div className="oms-card overflow-hidden">
        {loading ? (
          <div className="flex justify-center py-16"><div className="w-5 h-5 border-2 border-blue-200 border-t-blue-600 rounded-full animate-spin"/></div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm" style={{ minWidth: 700 }}>
                <thead>
                  <tr className="border-b border-slate-200">
                    {['圖片', '物料編號', '品名', '規格', '單位', '供應商'].map(h => (
                      <th key={h} className="px-3 py-3 text-left text-[11px] font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap">{h}</th>
                    ))}
                    <th className="px-3 py-3 text-right text-[11px] font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap">庫存量</th>
                  </tr>
                </thead>
                <tbody>
                  {paged.map(item => {
                    const stock = Number(item.closing_balance)
                    return (
                      <tr key={item.id} className={`border-b border-slate-100 hover:bg-slate-50 ${stock <= 0 ? 'bg-red-50/30' : ''}`}>
                        <td className="px-3 py-2">
                          {item.image_url ? (
                            <img src={item.image_url} alt="" className="w-9 h-9 object-cover rounded border border-slate-200" onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
                          ) : (
                            <div className="w-9 h-9 bg-slate-100 rounded flex items-center justify-center text-slate-300 text-[10px]">無</div>
                          )}
                        </td>
                        <td className="px-3 py-2.5 font-mono text-xs text-blue-600 whitespace-nowrap">{item.product_code}</td>
                        <td className="px-3 py-2.5 text-slate-800 font-medium max-w-[200px] truncate" title={item.product_name}>{item.product_name}</td>
                        <td className="px-3 py-2.5 text-slate-500 whitespace-nowrap max-w-[120px] truncate" title={item.spec}>{item.spec || '—'}</td>
                        <td className="px-3 py-2.5 text-slate-500 whitespace-nowrap">{item.unit}</td>
                        <td className="px-3 py-2.5 text-slate-500 whitespace-nowrap max-w-[140px] truncate" title={item.supplier_name}>{item.supplier_name || '—'}</td>
                        <td className="px-3 py-2.5 text-right whitespace-nowrap">
                          <span className={`font-bold text-base ${stock <= 0 ? 'text-red-500' : stock < 10 ? 'text-orange-500' : 'text-emerald-600'}`}>
                            {stock.toLocaleString()}
                          </span>
                          <span className="text-xs text-slate-400 ml-1">{item.unit}</span>
                        </td>
                      </tr>
                    )
                  })}
                  {paged.length === 0 && (
                    <tr><td colSpan={7} className="px-4 py-12 text-center text-slate-400">尚無庫存資料</td></tr>
                  )}
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
