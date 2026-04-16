'use client'
import { useDialog } from '@/components/Dialog'
import { useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api'
import { usePagination, Pagination } from '@/lib/usePagination'
import { StatusFlow, ADJ_STEPS, getAdjActions } from '@/components/StatusFlow'

type AdjItem = { material_code: string; material_name: string; unit: string; system_qty: number; actual_qty: number; diff_qty: number; batch_no: string; remark: string }
type Adj = { id: number; adj_number: string; adj_type: string; status: string; adj_date: string; remark: string; created_at: string; items?: AdjItem[] }
type BomStock = { product_sku: string; product_name: string; unit: string; current_stock: number }

const emptyItem = (): AdjItem => ({ material_code: '', material_name: '', unit: 'PCS', system_qty: 0, actual_qty: 0, diff_qty: 0, batch_no: '', remark: '' })

export default function StockAdjustmentsPage() {
  const { toast, confirm: confirmDialog } = useDialog()
  const [adjs, setAdjs] = useState<Adj[]>([])
  const [bomStocks, setBomStocks] = useState<BomStock[]>([])
  const [viewing, setViewing] = useState<Adj | null>(null)
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState({ adj_type: 'count', adj_date: '', remark: '', items: [emptyItem()] })
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [approving, setApproving] = useState<number | null>(null)

  const load = () => apiFetch<Adj[]>('/api/stock-adjustments').then(setAdjs).finally(() => setLoading(false))
  useEffect(() => {
    load()
    apiFetch<any[]>('/api/inventory/bom').then(rows =>
      setBomStocks(rows.map(r => ({ product_sku: r.product_code, product_name: r.product_name, unit: r.unit, current_stock: Number(r.closing_balance) || 0 })))
    ).catch(() => {})
  }, [])

  const viewAdj = async (id: number) => {
    const d = await apiFetch<Adj>(`/api/stock-adjustments/${id}`)
    setViewing(d)
  }

  const save = async () => {
    try {
      await apiFetch('/api/stock-adjustments', { method: 'POST', body: JSON.stringify(form) })
      toast('庫存調整單建立成功')
      setCreating(false)
      setForm({ adj_type: 'count', adj_date: '', remark: '', items: [emptyItem()] })
      load()
    } catch (e: any) { toast('錯誤：' + e.message, 'error') }
  }

  const approve = async (id: number) => {
    if (approving) return
    if (!await confirmDialog('確認核准庫存調整？', '核准後將更新材料庫存，此操作不可撤銷', '確認核准')) return
    setApproving(id)
    try {
      await apiFetch(`/api/stock-adjustments/${id}/approve`, { method: 'PATCH' })
      toast('庫存調整已核准，庫存已更新')
      load()
      if (viewing?.id === id) { viewAdj(id) }
    } catch (e: any) { toast(e.message, 'error') }
    finally { setApproving(null) }
  }

  const del = async (id: number) => {
    if (!await confirmDialog('確定刪除此調整單？')) return
    try {
      await apiFetch(`/api/stock-adjustments/${id}`, { method: 'DELETE' })
      load()
    } catch (e: any) { toast(e.message, 'error') }
  }

  const addItem = () => setForm(p => ({ ...p, items: [...p.items, emptyItem()] }))
  const removeItem = (i: number) => setForm(p => ({ ...p, items: p.items.filter((_, idx) => idx !== i) }))

  const updateItem = (i: number, f: keyof AdjItem, v: any) => {
    setForm(p => ({
      ...p,
      items: p.items.map((item, idx) => {
        if (idx !== i) return item
        const next = { ...item, [f]: v }
        const actual = f === 'actual_qty' ? Number(v) : next.actual_qty
        const system = f === 'system_qty' ? Number(v) : next.system_qty
        return { ...next, diff_qty: actual - system }
      })
    }))
  }

  const onSelectMaterial = (i: number, code: string) => {
    const bom = bomStocks.find(m => m.product_sku === code)
    if (bom) {
      updateItem(i, 'material_code', code)
      updateItem(i, 'material_name', bom.product_name)
      updateItem(i, 'unit', bom.unit || 'PCS')
      updateItem(i, 'system_qty', bom.current_stock || 0)
    } else {
      updateItem(i, 'material_code', code)
    }
  }

  const filtered = adjs.filter(a => !search || a.adj_number.toLowerCase().includes(search.toLowerCase()))
  const { page, setPage, totalPages, paged, total } = usePagination(filtered, 20)
  const inp = 'oms-input text-xs py-1.5'

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-slate-800">庫存調整（盤點）</h1>
          <p className="text-xs text-slate-400 mt-0.5">盤點調整、報廢處理，核准後更新庫存</p>
        </div>
        <button onClick={() => setCreating(true)} className="btn-primary">+ 建立調整單</button>
      </div>

      {creating && (
        <div className="oms-card p-6 mb-5">
          <h2 className="text-sm font-semibold mb-4">建立庫存調整單</h2>
          <div className="grid grid-cols-3 gap-3 mb-4">
            <div>
              <label className="block text-[11px] text-slate-500 mb-1.5">調整類型</label>
              <select className={inp} value={form.adj_type} onChange={e => setForm(p => ({ ...p, adj_type: e.target.value }))}>
                <option value="count">盤點調整</option>
                <option value="scrap">報廢</option>
                <option value="other">其他</option>
              </select>
            </div>
            <div>
              <label className="block text-[11px] text-slate-500 mb-1.5">調整日期</label>
              <input type="date" className={inp} value={form.adj_date} onChange={e => setForm(p => ({ ...p, adj_date: e.target.value }))} />
            </div>
            <div>
              <label className="block text-[11px] text-slate-500 mb-1.5">備註</label>
              <input className={inp} value={form.remark} onChange={e => setForm(p => ({ ...p, remark: e.target.value }))} />
            </div>
          </div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-slate-600">調整明細</span>
            <button onClick={addItem} className="btn-ghost text-blue-600">+ 新增料號</button>
          </div>
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-200">
                  {['料號','材料名稱','單位','系統庫存','實際數量','差異','批次號','備註',''].map(h => (
                    <th key={h} className="px-2 py-2 text-left text-[10px] font-semibold text-slate-500 uppercase">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {form.items.map((item, i) => (
                  <tr key={i} className="border-b border-slate-100">
                    <td className="p-1">
                      <select className={inp} style={{width:130}} value={item.material_code} onChange={e => onSelectMaterial(i, e.target.value)}>
                        <option value="">-- 選擇 BOM 品項 --</option>
                        {bomStocks.map(m => (
                          <option key={m.product_sku} value={m.product_sku}>{m.product_sku} - {m.product_name}</option>
                        ))}
                      </select>
                    </td>
                    <td className="p-1"><input className={inp} value={item.material_name} onChange={e => updateItem(i, 'material_name', e.target.value)} /></td>
                    <td className="p-1"><input className={inp} style={{width:45}} value={item.unit} onChange={e => updateItem(i, 'unit', e.target.value)} /></td>
                    <td className="p-1 px-2 text-right text-slate-400">{item.system_qty}</td>
                    <td className="p-1"><input type="number" className={inp} style={{width:70}} value={item.actual_qty || ''} onChange={e => updateItem(i, 'actual_qty', Number(e.target.value))} /></td>
                    <td className={`p-1 px-2 text-right font-semibold ${item.diff_qty > 0 ? 'text-emerald-600' : item.diff_qty < 0 ? 'text-red-500' : 'text-slate-400'}`}>
                      {item.diff_qty > 0 ? '+' : ''}{item.diff_qty}
                    </td>
                    <td className="p-1"><input className={inp} style={{width:80}} value={item.batch_no} placeholder="批次號" onChange={e => updateItem(i, 'batch_no', e.target.value)} /></td>
                    <td className="p-1"><input className={inp} value={item.remark} onChange={e => updateItem(i, 'remark', e.target.value)} /></td>
                    <td className="p-1 text-center"><button onClick={() => removeItem(i)} className="text-slate-300 hover:text-red-600">✕</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex gap-2 mt-4">
            <button onClick={save} className="btn-primary">建立調整單</button>
            <button onClick={() => setCreating(false)} className="btn-ghost border border-slate-200">取消</button>
          </div>
        </div>
      )}

      {viewing && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white border border-slate-200 rounded-2xl p-6 max-w-3xl w-full max-h-[85vh] overflow-auto">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h2 className="text-base font-bold">{viewing.adj_number}</h2>
                <div className="text-xs text-slate-500">類型：{viewing.adj_type} | 日期：{viewing.adj_date}</div>
              </div>
              <div className="flex gap-2 items-center">
                <span className={viewing.status === 'approved' ? 'badge-green' : 'badge-gray'}>
                  {viewing.status === 'approved' ? '已核准' : '草稿'}
                </span>
                {viewing.status === 'draft' && (
                  <button onClick={() => approve(viewing.id)} className="btn-primary">&#10003; 核准</button>
                )}
                <button onClick={() => setViewing(null)} className="text-slate-400 hover:text-slate-600 text-xl ml-2">&#10005;</button>
              </div>
            </div>
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b border-slate-200">
                  {['料號','材料名稱','單位'].map(h => (
                    <th key={h} className="border border-slate-200 px-3 py-2 text-left text-xs font-medium text-slate-400">{h}</th>
                  ))}
                  {['系統庫存','實際數量','差異'].map(h => (
                    <th key={h} className="border border-slate-200 px-3 py-2 text-right text-xs font-medium text-slate-400">{h}</th>
                  ))}
                  <th className="border border-slate-200 px-3 py-2 text-left text-xs font-medium text-slate-400">批次號</th>
                </tr>
              </thead>
              <tbody>
                {(viewing.items || []).map((item, i) => (
                  <tr key={i} className="hover:bg-slate-50">
                    <td className="border border-slate-200 px-3 py-2 font-mono text-xs text-blue-600">{item.material_code}</td>
                    <td className="border border-slate-200 px-3 py-2">{item.material_name}</td>
                    <td className="border border-slate-200 px-3 py-2">{item.unit}</td>
                    <td className="border border-slate-200 px-3 py-2 text-right text-slate-400">{item.system_qty}</td>
                    <td className="border border-slate-200 px-3 py-2 text-right font-semibold">{item.actual_qty}</td>
                    <td className={`border border-slate-200 px-3 py-2 text-right font-bold ${item.diff_qty > 0 ? 'text-emerald-600' : item.diff_qty < 0 ? 'text-red-500' : 'text-slate-400'}`}>
                      {item.diff_qty > 0 ? '+' : ''}{item.diff_qty}
                    </td>
                    <td className="border border-slate-200 px-3 py-2 text-slate-400">{item.batch_no}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="mb-4">
        <input className="oms-input w-64" placeholder="搜尋調整單號..." value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      <div className="oms-card overflow-hidden">
        {loading ? (
          <div className="flex justify-center py-16"><div className="w-5 h-5 border-2 border-blue-200 border-t-blue-600 rounded-full animate-spin" /></div>
        ) : (
          <>
            <table className="oms-table">
              <thead>
                <tr>
                  <th>調整單號</th><th>類型</th><th>調整日期</th><th>備註</th><th>操作</th>
                </tr>
              </thead>
              <tbody>
                {paged.map(a => (
                  <tr key={a.id}>
                    <td className="font-mono text-xs text-blue-600">{a.adj_number}</td>
                    <td>{{ count: '盤點', scrap: '報廢', other: '其他' }[a.adj_type] || a.adj_type}</td>
                    <td className="text-slate-400 text-xs">{a.adj_date ? String(a.adj_date).slice(0,10) : '—'}</td>
                    <td className="text-slate-400 text-xs">{a.remark}</td>
                    <td>
                      <div className="flex gap-1 flex-wrap items-center">
                        <StatusFlow compact steps={ADJ_STEPS} current={a.status} actions={approving === a.id ? [] : getAdjActions(a.status)} onAction={() => approve(a.id)} />
                        {approving === a.id && <span className="text-xs text-slate-400 px-2">處理中...</span>}
                        <button onClick={() => viewAdj(a.id)} className="btn-ghost ml-1">詳情</button>
                        <button onClick={() => del(a.id)} className="btn-danger">刪除</button>
                      </div>
                    </td>
                  </tr>
                ))}
                {paged.length === 0 && <tr><td colSpan={5} className="text-center py-12 text-slate-400">尚無庫存調整記錄</td></tr>}
              </tbody>
            </table>
            <Pagination page={page} totalPages={totalPages} setPage={setPage} total={total} />
          </>
        )}
      </div>
    </div>
  )
}
