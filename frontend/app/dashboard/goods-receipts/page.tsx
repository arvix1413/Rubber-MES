'use client'
import { useDialog } from '@/components/Dialog'
import { useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api'
import { usePagination, Pagination } from '@/lib/usePagination'
import { StatusFlow, GR_STEPS, getGRActions } from '@/components/StatusFlow'

type GRItem = { po_item_id?: number; material_code: string; material_name: string; spec: string; unit: string; ordered_qty: number; received_qty: number; unit_price: number; currency: string; batch_no: string; remark: string }
type GR = { id: number; gr_number: string; po_number: string; supplier_name: string; status: string; received_date: string; remark: string; created_at: string; items?: GRItem[] }
type PO = { id: number; po_number: string; supplier_name: string; supplier_id: number; status: string; items?: any[] }

const emptyItem = (): GRItem => ({ material_code: '', material_name: '', spec: '', unit: 'PCS', ordered_qty: 0, received_qty: 0, unit_price: 0, currency: 'VND', batch_no: '', remark: '' })

export default function GoodsReceiptsPage() {
  const { toast, confirm: confirmDialog } = useDialog()
  const [grs, setGrs] = useState<GR[]>([])
  const [pos, setPos] = useState<PO[]>([])
  const [viewing, setViewing] = useState<GR | null>(null)
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState({ po_id: '', po_number: '', supplier_name: '', received_date: '', remark: '', items: [emptyItem()] })
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  const load = () => apiFetch<GR[]>('/api/goods-receipts').then(setGrs).finally(() => setLoading(false))
  useEffect(() => {
    load()
    apiFetch<PO[]>('/api/po').then(setPos).catch(() => {})
  }, [])

  const onSelectPO = async (poId: string) => {
    const po = pos.find(p => String(p.id) === poId)
    if (!po) { setForm(p => ({ ...p, po_id: '', po_number: '', supplier_name: '', items: [emptyItem()] })); return }
    try {
      const data = await apiFetch<PO>(`/api/po/${poId}`)
      const items = (data.items || []).map((i: any) => ({
        po_item_id: i.id, material_code: i.material_code, material_name: i.material_name,
        spec: i.spec || '', unit: i.unit || 'PCS', ordered_qty: i.quantity,
        received_qty: i.quantity - (i.received_qty || 0), unit_price: i.unit_price,
        currency: i.currency || 'VND', batch_no: '', remark: ''
      }))
      setForm(p => ({ ...p, po_id: poId, po_number: po.po_number, supplier_name: po.supplier_name, items: items.length ? items : [emptyItem()] }))
    } catch { setForm(p => ({ ...p, po_id: poId, po_number: po.po_number, supplier_name: po.supplier_name })) }
  }

  const save = async () => {
    if (!form.supplier_name) { toast('請選擇採購單或填寫供應商', 'error'); return }
    try {
      await apiFetch('/api/goods-receipts', { method: 'POST', body: JSON.stringify(form) })
      toast('進貨單建立成功'); setCreating(false)
      setForm({ po_id: '', po_number: '', supplier_name: '', received_date: '', remark: '', items: [emptyItem()] })
      load()
    } catch (e: any) { toast('錯誤：' + e.message, 'error') }
  }

  const confirm = async (id: number) => {
    if (!await confirmDialog('確認進貨？', '確認後將更新材料庫存，此操作不可撤銷', '確認進貨')) return
    try {
      await apiFetch(`/api/goods-receipts/${id}/confirm`, { method: 'PATCH' })
      toast('進貨已確認，庫存已更新')
      load()
      if (viewing?.id === id) { const d = await apiFetch<GR>(`/api/goods-receipts/${id}`); setViewing(d) }
    } catch (e: any) { toast('錯誤：' + e.message, 'error') }
  }

  const del = async (id: number) => {
    if (!await confirmDialog('確定刪除此進貨單？')) return
    try { await apiFetch(`/api/goods-receipts/${id}`, { method: 'DELETE' })
      await load() }
    catch (e: any) { toast(e.message, 'error') }
  }

  const viewGR = async (id: number) => { const d = await apiFetch<GR>(`/api/goods-receipts/${id}`); setViewing(d) }
  const addItem = () => setForm(p => ({ ...p, items: [...p.items, emptyItem()] }))
  const removeItem = (i: number) => setForm(p => ({ ...p, items: p.items.filter((_, idx) => idx !== i) }))
  const updateItem = (i: number, f: keyof GRItem, v: any) => setForm(p => ({ ...p, items: p.items.map((item, idx) => idx === i ? { ...item, [f]: v } : item) }))

  const filtered = grs.filter(g => !search || g.gr_number.toLowerCase().includes(search.toLowerCase()) || g.supplier_name.toLowerCase().includes(search.toLowerCase()))
  const { page, setPage, totalPages, paged, total } = usePagination(filtered, 20)
  const inp = 'oms-input text-xs py-1.5'

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-slate-800">進貨單管理</h1>
          <p className="text-xs text-slate-400 mt-0.5">採購收貨，確認後自動更新材料庫存</p>
        </div>
        <button onClick={() => setCreating(true)} className="btn-primary">+ 建立進貨單</button>
      </div>

      {creating && (
        <div className="oms-card p-6 mb-5">
          <h2 className="text-sm font-semibold mb-4">建立進貨單</h2>
          <div className="grid grid-cols-3 gap-3 mb-4">
            <div>
              <label className="block text-[11px] text-slate-500 mb-1.5">關聯採購單（選填）</label>
              <select className={inp} value={form.po_id} onChange={e => onSelectPO(e.target.value)}>
                <option value="">-- 選擇採購單 --</option>
                {pos.filter(p => p.status !== 'cancelled').map(p => (
                  <option key={p.id} value={String(p.id)}>{p.po_number} - {p.supplier_name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[11px] text-slate-500 mb-1.5">供應商 *</label>
              <input className={inp} value={form.supplier_name} onChange={e => setForm(p => ({ ...p, supplier_name: e.target.value }))} />
            </div>
            <div>
              <label className="block text-[11px] text-slate-500 mb-1.5">收貨日期</label>
              <input type="date" className={inp} value={form.received_date} onChange={e => setForm(p => ({ ...p, received_date: e.target.value }))} />
            </div>
          </div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-slate-600">收貨明細</span>
            <button onClick={addItem} className="btn-ghost text-blue-600">+ 新增料號</button>
          </div>
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full text-xs">
              <thead><tr className="border-b border-slate-200">
                {['料號','材料名稱','規格','單位','訂購數量','實收數量','單價','幣別','批次號','備註',''].map(h => (
                  <th key={h} className="px-2 py-2 text-left text-[10px] font-semibold text-slate-500 uppercase">{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {form.items.map((item, i) => (
                  <tr key={i} className="border-b border-slate-100">
                    <td className="p-1"><input className={inp} style={{width:90}} value={item.material_code} onChange={e => updateItem(i, 'material_code', e.target.value)} /></td>
                    <td className="p-1"><input className={inp} value={item.material_name} onChange={e => updateItem(i, 'material_name', e.target.value)} /></td>
                    <td className="p-1"><input className={inp} style={{width:80}} value={item.spec} onChange={e => updateItem(i, 'spec', e.target.value)} /></td>
                    <td className="p-1"><input className={inp} style={{width:45}} value={item.unit} onChange={e => updateItem(i, 'unit', e.target.value)} /></td>
                    <td className="p-1"><input type="number" className={inp} style={{width:65}} value={item.ordered_qty || ''} onChange={e => updateItem(i, 'ordered_qty', Number(e.target.value))} /></td>
                    <td className="p-1"><input type="number" className={inp} style={{width:65}} value={item.received_qty || ''} onChange={e => updateItem(i, 'received_qty', Number(e.target.value))} /></td>
                    <td className="p-1"><input type="number" className={inp} style={{width:80}} value={item.unit_price || ''} onChange={e => updateItem(i, 'unit_price', Number(e.target.value))} /></td>
                    <td className="p-1">
                      <select className={inp} style={{width:55}} value={item.currency} onChange={e => updateItem(i, 'currency', e.target.value)}>
                        <option>VND</option><option>TWD</option><option>CNY</option><option>USD</option>
                      </select>
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
            <button onClick={save} className="btn-primary">建立進貨單</button>
            <button onClick={() => setCreating(false)} className="btn-ghost border border-slate-200">取消</button>
          </div>
        </div>
      )}

      {viewing && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white border border-slate-200 rounded-2xl p-6 max-w-4xl w-full max-h-[85vh] overflow-auto">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h2 className="text-base font-bold">{viewing.gr_number}</h2>
                <div className="text-xs text-slate-500">供應商：{viewing.supplier_name} | 收貨日期：{viewing.received_date}</div>
                {viewing.po_number && <div className="text-xs text-slate-400">關聯採購單：{viewing.po_number}</div>}
              </div>
              <div className="flex gap-2 items-center">
                <span className={viewing.status === 'confirmed' ? 'badge-green' : 'badge-gray'}>{viewing.status === 'confirmed' ? '已確認' : '草稿'}</span>
                {viewing.status === 'draft' && <button onClick={() => confirm(viewing.id)} className="btn-primary">✓ 確認進貨</button>}
                <button onClick={() => setViewing(null)} className="text-slate-400 hover:text-slate-600 text-xl ml-2">✕</button>
              </div>
            </div>
            <table className="w-full text-sm border-collapse">
              <thead><tr className="border-b border-slate-200">
                {['料號','材料名稱','規格','單位','訂購','實收','批次號','備註'].map((h, i) => (
                  <th key={h} className={`border border-slate-200 px-3 py-2 text-xs font-medium text-slate-400 ${i >= 4 && i <= 5 ? 'text-right' : 'text-left'}`}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {(viewing.items || []).map((item, i) => (
                  <tr key={i} className="hover:bg-slate-50">
                    <td className="border border-slate-200 px-3 py-2 font-mono text-xs text-blue-600">{item.material_code}</td>
                    <td className="border border-slate-200 px-3 py-2">{item.material_name}</td>
                    <td className="border border-slate-200 px-3 py-2 text-slate-500">{item.spec}</td>
                    <td className="border border-slate-200 px-3 py-2">{item.unit}</td>
                    <td className="border border-slate-200 px-3 py-2 text-right">{item.ordered_qty}</td>
                    <td className="border border-slate-200 px-3 py-2 text-right font-semibold text-emerald-600">{item.received_qty}</td>
                    <td className="border border-slate-200 px-3 py-2 text-slate-400">{item.batch_no}</td>
                    <td className="border border-slate-200 px-3 py-2 text-slate-400">{item.remark}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="mb-4"><input className="oms-input w-64" placeholder="搜尋進貨單號或供應商..." value={search} onChange={e => setSearch(e.target.value)} /></div>

      <div className="oms-card overflow-hidden">
        {loading ? <div className="flex justify-center py-16"><div className="w-5 h-5 border-2 border-blue-200 border-t-blue-600 rounded-full animate-spin" /></div> : (
          <>
            <table className="oms-table">
              <thead><tr>
                <th>進貨單號</th><th>供應商</th><th>關聯採購單</th><th>收貨日期</th><th>狀態</th><th>操作</th>
              </tr></thead>
              <tbody>
                {paged.map(gr => (
                  <tr key={gr.id}>
                    <td className="font-mono text-xs text-blue-600">{gr.gr_number}</td>
                    <td className="font-medium">{gr.supplier_name}</td>
                    <td className="text-slate-400 text-xs">{gr.po_number}</td>
                    <td className="text-slate-400 text-xs">{gr.received_date ? String(gr.received_date).slice(0,10) : '—'}</td>
                    <td>
                      <div className="flex gap-1 flex-wrap items-center">
                        <StatusFlow compact steps={GR_STEPS} current={gr.status}
                          actions={getGRActions(gr.status)}
                          onAction={() => confirm(gr.id)} />
                        <button onClick={() => viewGR(gr.id)} className="btn-ghost ml-1">詳情</button>
                        <button onClick={() => del(gr.id)} className="btn-danger">刪除</button>
                      </div>
                    </td>
                  </tr>
                ))}
                {paged.length === 0 && <tr><td colSpan={6} className="text-center py-12 text-slate-400">尚無進貨單</td></tr>}
              </tbody>
            </table>
            <Pagination page={page} totalPages={totalPages} setPage={setPage} total={total} />
          </>
        )}
      </div>
    </div>
  )
}
