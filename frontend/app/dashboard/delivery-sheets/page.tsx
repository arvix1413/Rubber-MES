'use client'
import { generateDeliverySheetHTML } from '@/lib/printDeliverySheet'
import { useDialog } from '@/components/Dialog'
import { useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api'
import { usePagination, Pagination } from '@/lib/usePagination'
import { can } from '@/lib/usePermissions'
import { getCompany } from '@/lib/useCompany'

type DSItem = { bom_id?:number|null; item_name:string; material_code:string; qty:number; remark:string; po_ref?: string; spec?: string; unit?: string }
type DS = { id:number; ds_number:string; customer_name:string; delivery_date:string; status:string; remark:string; created_at:string; items?:DSItem[]; order_po_number?:string }
type Customer = { id:number; customer_name:string; customer_code:string }
type PendingOrder = { id:number; po_number:string; po_date:string; items_summary:string }
type OrderItem = { id:number; bom_id:number|null; qty:number; unit_price:number; product_name:string; product_sku:string }

const STATUS_MAP: Record<string,{label:string;badge:string}> = {
  draft:     { label:'草稿', badge:'badge-gray' },
  confirmed: { label:'已確認', badge:'badge-blue' },
  shipped:   { label:'已送達', badge:'badge-green' },
}

export default function DeliverySheetsPage() {
  const { toast, confirm: confirmDialog } = useDialog()

  const [sheets, setSheets] = useState<DS[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<DS|null>(null)
  const [editForm, setEditForm] = useState({ delivery_date: '', remark: '', items: [] as DSItem[] })
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const [loadedItems, setLoadedItems] = useState<Record<number, DSItem[]>>({})
  const canWrite = can('delivery.create')
  const canDel = can('delivery.delete')

  const [selectedCustomerId, setSelectedCustomerId] = useState('')
  const [poSearch, setPoSearch] = useState('')
  const [pendingOrders, setPendingOrders] = useState<PendingOrder[]>([])
  const [selectedOrderId, setSelectedOrderId] = useState('')
  const [orderItems, setOrderItems] = useState<OrderItem[]>([])
  const [deliveryQtys, setDeliveryQtys] = useState<Record<number, number>>({})
  const [deliveryDate, setDeliveryDate] = useState('')
  const [remark, setRemark] = useState('')

  const load = () => apiFetch<DS[]>('/api/delivery-sheets').then(setSheets).finally(() => setLoading(false))
  useEffect(() => {
    load()
    apiFetch<Customer[]>('/api/customers').then(setCustomers).catch(() => {})
  }, [])

  const onSelectCustomer = async (customerId: string) => {
    setSelectedCustomerId(customerId)
    setSelectedOrderId('')
    setOrderItems([])
    setDeliveryQtys({})
    setPoSearch('')
    if (!customerId) { setPendingOrders([]); return }
    const orders = await apiFetch<PendingOrder[]>(`/api/customer-orders/pending?customer_id=${customerId}`)
    setPendingOrders(orders)
  }

  const onSearchPO = async (val: string) => {
    setPoSearch(val)
    setSelectedOrderId('')
    setOrderItems([])
    setDeliveryQtys({})
    if (!val.trim()) { if (!selectedCustomerId) setPendingOrders([]); return }
    const orders = await apiFetch<PendingOrder[]>(`/api/customer-orders/pending?po_search=${encodeURIComponent(val)}`)
    setPendingOrders(orders)
  }

  const onSelectOrder = async (orderId: string) => {
    setSelectedOrderId(orderId)
    setOrderItems([])
    setDeliveryQtys({})
    if (!orderId) return
    const data = await apiFetch<any>(`/api/customer-orders/${orderId}`)
    const items: OrderItem[] = (data.items || []).map((i: any) => ({
      id: i.id, bom_id: i.bom_id, qty: Number(i.qty),
      unit_price: Number(i.unit_price),
      product_name: i.product_name || '',
      product_sku: i.product_sku || '',
    }))
    setOrderItems(items)
    const qtys: Record<number, number> = {}
    items.forEach(i => { qtys[i.id] = i.qty })
    setDeliveryQtys(qtys)
  }

  const save = async () => {
    if (!selectedCustomerId) { toast('請選擇客戶', 'error'); return }
    if (!selectedOrderId) { toast('請選擇訂單', 'error'); return }
    const items = orderItems.map(i => ({
      bom_id: i.bom_id,
      item_name: i.product_name,
      material_code: i.product_sku,
      qty: deliveryQtys[i.id] || 0,
      remark: '',
    })).filter(i => i.qty > 0)
    if (!items.length) { toast('請填寫送貨數量', 'error'); return }
    try {
      await apiFetch('/api/delivery-sheets', {
        method: 'POST',
        body: JSON.stringify({
          customer_id: Number(selectedCustomerId),
          customer_order_id: Number(selectedOrderId),
          delivery_date: deliveryDate,
          remark,
          items,
        })
      })
      toast('送貨單建立成功')
      setCreating(false)
      resetForm()
      load()
    } catch (e: any) { toast('錯誤：' + e.message, 'error') }
  }

  const resetForm = () => {
    setSelectedCustomerId(''); setSelectedOrderId('')
    setPendingOrders([]); setOrderItems([]); setDeliveryQtys({})
    setDeliveryDate(''); setRemark(''); setPoSearch('')
  }

  const toggleExpand = async (id: number) => {
    const next = new Set(expanded)
    if (next.has(id)) { next.delete(id); setExpanded(next) }
    else {
      next.add(id); setExpanded(next)
      if (!loadedItems[id]) {
        const d = await apiFetch<DS>(`/api/delivery-sheets/${id}`)
        setLoadedItems(p => ({ ...p, [id]: d.items || [] }))
      }
    }
  }

  const startEdit = async (sheet: DS) => {
    const d = await apiFetch<DS>(`/api/delivery-sheets/${sheet.id}`)
    setEditForm({
      delivery_date: sheet.delivery_date ? String(sheet.delivery_date).slice(0,10) : '',
      remark: sheet.remark || '',
      items: d.items || []
    })
    setEditing(d)
  }

  const saveEdit = async () => {
    if (!editing) return
    try {
      await apiFetch(`/api/delivery-sheets/${editing.id}`, { method: 'PUT', body: JSON.stringify(editForm) })
      toast('送貨單已更新')
      setEditing(null)
      load()
    } catch (e: any) { toast('更新失敗：' + e.message, 'error') }
  }

  const del = async (id: number) => {
    if (!await confirmDialog('確定刪除？')) return
    try {
      await apiFetch(`/api/delivery-sheets/${id}`, { method: 'DELETE' })
      await load()
    } catch (e: any) { toast('刪除失敗：' + e.message, 'error') }
  }

  const printSheet = async (sheet: DS) => {
    const detail = await apiFetch<DS & { po_ref?: string; address?: string }>(`/api/delivery-sheets/${sheet.id}`)
    const company = await getCompany()
    const html = generateDeliverySheetHTML({
      dn_number: sheet.ds_number,
      customer_name: sheet.customer_name,
      delivery_date: sheet.delivery_date,
      po_ref: detail.po_ref || sheet.order_po_number || '',
      address: detail.address || '',
      remark: sheet.remark,
      items: detail.items || sheet.items || []
    }, company)
    const w = window.open('', '_blank', 'width=800,height=1000')
    if (!w) {
      toast('瀏覽器已封鎖彈出視窗，請允許後再列印', 'error')
      return
    }
    w.document.write(html)
    w.document.close()
    setTimeout(() => w.print(), 500)
  }

  const filtered = sheets.filter(s => !search ||
    s.ds_number.toLowerCase().includes(search.toLowerCase()) ||
    (s.customer_name||'').toLowerCase().includes(search.toLowerCase()))
  const { page, setPage, totalPages, paged, total } = usePagination(filtered, 20)
  const inp = 'oms-input text-xs py-1.5'

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-slate-800">送貨單</h1>
        {canWrite && <button onClick={() => setCreating(true)} className="btn-primary">+ 新增送貨單</button>}
      </div>

      {creating && canWrite && (
        <div className="oms-card p-6 mb-5">
          <h2 className="font-semibold text-slate-800 mb-5">新增送貨單</h2>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-5">
            <div>
              <label className="block text-[11px] text-slate-500 mb-1.5">客戶</label>
              <select className="oms-input" value={selectedCustomerId} onChange={e => onSelectCustomer(e.target.value)}>
                <option value="">-- 選擇客戶 --</option>
                {customers.map(c => (
                  <option key={c.id} value={String(c.id)}>{c.customer_name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[11px] text-slate-500 mb-1.5">或直接搜尋客戶訂單號</label>
              <input className="oms-input" placeholder="輸入客戶訂單號..." value={poSearch}
                onChange={e => onSearchPO(e.target.value)} />
            </div>
            <div>
              <label className="block text-[11px] text-slate-500 mb-1.5">
                待出貨訂單 *
                {(selectedCustomerId || poSearch) && pendingOrders.length === 0 && (
                  <span className="text-orange-500 ml-1">（無待出貨訂單）</span>
                )}
              </label>
              <select className="oms-input" value={selectedOrderId} onChange={e => onSelectOrder(e.target.value)}
                disabled={pendingOrders.length === 0}>
                <option value="">-- 選擇訂單 --</option>
                {pendingOrders.map(o => (
                  <option key={o.id} value={String(o.id)}>{o.po_number}{o.items_summary ? ` (${o.items_summary.slice(0,25)})` : ''}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[11px] text-slate-500 mb-1.5">送貨日期</label>
              <input type="date" className="oms-input" value={deliveryDate} onChange={e => setDeliveryDate(e.target.value)} />
            </div>
            <div>
              <label className="block text-[11px] text-slate-500 mb-1.5">備註（交易條件、特殊要求等）</label>
              <textarea className="oms-input" rows={3} value={remark} onChange={e => setRemark(e.target.value)} placeholder="可輸入交易條件、付款方式、交貨要求等資訊..." />
            </div>
          </div>

          {orderItems.length > 0 && (
            <div className="mb-5">
              <div className="text-xs font-semibold text-slate-600 mb-2">送貨明細（可修改實際送貨數量）</div>
              <div className="border border-slate-200 rounded-lg overflow-hidden">
                <table className="w-full text-xs">
                  <thead><tr className="bg-slate-50 border-b border-slate-200">
                    <th className="px-3 py-2 text-left text-[10px] font-semibold text-slate-500 uppercase">品名</th>
                    <th className="px-3 py-2 text-left text-[10px] font-semibold text-slate-500 uppercase">物料編號</th>
                    <th className="px-3 py-2 text-right text-[10px] font-semibold text-slate-500 uppercase">訂單數量</th>
                    <th className="px-3 py-2 text-right text-[10px] font-semibold text-slate-500 uppercase">本次送貨</th>
                  </tr></thead>
                  <tbody>
                    {orderItems.map(item => (
                      <tr key={item.id} className="border-b border-slate-100 last:border-0">
                        <td className="px-3 py-2 text-slate-700 font-medium">{item.product_name}</td>
                        <td className="px-3 py-2 font-mono text-blue-600">{item.product_sku}</td>
                        <td className="px-3 py-2 text-right text-slate-500">{item.qty.toLocaleString()}</td>
                        <td className="px-3 py-2 text-right">
                          <input type="number" className={`${inp} w-24 text-right`}
                            min={0} max={item.qty}
                            value={deliveryQtys[item.id] ?? item.qty}
                            onChange={e => setDeliveryQtys(p => ({ ...p, [item.id]: Number(e.target.value) }))} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="flex gap-2">
            <button onClick={save} className="btn-primary" disabled={!selectedOrderId || orderItems.length === 0}>建立送貨單</button>
            <button onClick={() => { setCreating(false); resetForm() }} className="btn-ghost border border-slate-200">取消</button>
          </div>
        </div>
      )}

      {editing && canWrite && (
        <div className="oms-card p-6 mb-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-bold">編輯送貨單 {editing.ds_number}</h2>
              <button onClick={() => setEditing(null)} className="btn-ghost border border-slate-200">返回列表</button>
            </div>
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div>
                <label className="block text-[11px] text-slate-500 mb-1.5">送貨日期</label>
                <input type="date" className="oms-input" value={editForm.delivery_date} onChange={e => setEditForm(p => ({ ...p, delivery_date: e.target.value }))} />
              </div>
              <div>
                <label className="block text-[11px] text-slate-500 mb-1.5">備註</label>
                <input className="oms-input" value={editForm.remark} onChange={e => setEditForm(p => ({ ...p, remark: e.target.value }))} />
              </div>
            </div>
            <div className="border border-slate-200 rounded-lg overflow-hidden mb-4">
              <table className="w-full text-xs">
                <thead><tr className="bg-slate-50 border-b border-slate-200">
                  <th className="px-3 py-2 text-left text-[10px] font-semibold text-slate-500 uppercase">品名</th>
                  <th className="px-3 py-2 text-left text-[10px] font-semibold text-slate-500 uppercase">物料編號</th>
                  <th className="px-3 py-2 text-right text-[10px] font-semibold text-slate-500 uppercase">數量</th>
                  <th className="px-3 py-2 text-left text-[10px] font-semibold text-slate-500 uppercase">備註</th>
                </tr></thead>
                <tbody>
                  {editForm.items.map((item, i) => (
                    <tr key={i} className="border-b border-slate-100 last:border-0">
                      <td className="px-3 py-2 text-slate-700">{item.item_name}</td>
                      <td className="px-3 py-2 font-mono text-xs text-blue-600">{item.material_code}</td>
                      <td className="px-3 py-2 text-right">
                        <input type="number" className="oms-input text-xs py-1 w-20 text-right" min={0}
                          value={item.qty}
                          onChange={e => setEditForm(p => ({ ...p, items: p.items.map((it, idx) => idx === i ? { ...it, qty: Number(e.target.value) } : it) }))} />
                      </td>
                      <td className="px-3 py-2">
                        <input className="oms-input text-xs py-1" value={item.remark || ''}
                          onChange={e => setEditForm(p => ({ ...p, items: p.items.map((it, idx) => idx === i ? { ...it, remark: e.target.value } : it) }))} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex gap-2">
              <button onClick={saveEdit} className="btn-primary">儲存修改</button>
              <button onClick={() => setEditing(null)} className="btn-ghost border border-slate-200">取消</button>
            </div>
        </div>
      )}

      {!creating && !editing && (
        <>
          <div className="mb-4">
            <input className="oms-input w-64" placeholder="搜尋送貨單號或客戶..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>

          <div className="oms-card overflow-hidden">
            {loading ? <div className="flex justify-center py-16"><div className="w-5 h-5 border-2 border-blue-200 border-t-blue-600 rounded-full animate-spin"/></div> : (
              <>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200">
                      <th className="w-8" />
                      {['送貨單號','客戶名稱','關聯訂單','送貨日期','備註','狀態','操作'].map(h => (
                        <th key={h} className="px-3 py-3 text-left text-[11px] font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {paged.map(sheet => {
                      const isOpen = expanded.has(sheet.id)
                      const items = loadedItems[sheet.id] || []
                      return (
                        <>
                          <tr key={sheet.id}
                            className={`border-b border-slate-100 cursor-pointer transition-colors ${isOpen ? 'bg-slate-50' : 'hover:bg-slate-50'}`}
                            onClick={() => toggleExpand(sheet.id)}>
                            <td className="pl-3 py-2.5">
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                                className={`w-3.5 h-3.5 text-slate-400 transition-transform duration-200 ${isOpen ? 'rotate-90' : ''}`}>
                                <polyline points="9 18 15 12 9 6" />
                              </svg>
                            </td>
                            <td className="px-3 py-2.5 font-mono text-xs text-blue-600 whitespace-nowrap">{sheet.ds_number}</td>
                            <td className="px-3 py-2.5 font-medium whitespace-nowrap max-w-[200px] truncate" title={sheet.customer_name}>{sheet.customer_name}</td>
                            <td className="px-3 py-2.5 text-slate-400 text-xs whitespace-nowrap">{sheet.order_po_number || '—'}</td>
                            <td className="px-3 py-2.5 text-slate-400 whitespace-nowrap">{sheet.delivery_date ? String(sheet.delivery_date).slice(0,10) : '—'}</td>
                            <td className="px-3 py-2.5 text-slate-400 whitespace-nowrap max-w-[120px] truncate" title={sheet.remark}>{sheet.remark||'—'}</td>
                            <td className="px-3 py-2.5 whitespace-nowrap"><span className={STATUS_MAP[sheet.status]?.badge || 'badge-gray'}>{STATUS_MAP[sheet.status]?.label || sheet.status || '草稿'}</span></td>
                            <td className="px-3 py-2.5 whitespace-nowrap" onClick={e => e.stopPropagation()}>
                              <div className="flex gap-1 items-center">
                                <button onClick={e => { e.stopPropagation(); printSheet(sheet) }} className="btn-ghost" title="列印">🧾 列印</button>
                                {canWrite && sheet.status === 'draft' && <button onClick={e => { e.stopPropagation(); startEdit(sheet) }} className="btn-ghost text-blue-600">✏ 編輯</button>}
                                {canDel && <button onClick={e => { e.stopPropagation(); del(sheet.id) }} className="btn-danger">刪除</button>}
                              </div>
                            </td>
                          </tr>
                          {isOpen && (
                            <tr key={`${sheet.id}-items`} className="border-b border-slate-100">
                              <td colSpan={8} className="px-0 py-0">
                                <div className="expand-row-wrap">
                                  {items.length === 0 ? (
                                    <div className="expand-row-loading">
                                      <div className="w-3 h-3 border border-slate-300 border-t-slate-500 rounded-full animate-spin"/>載入中...
                                    </div>
                                  ) : (
                                    <div className="overflow-x-auto">
                                      <table className="w-full text-xs" style={{minWidth:500}}>
                                        <thead><tr className="border-b border-slate-100">
                                          {['品名','物料編號','規格','單位','數量','備註'].map(h => (
                                            <th key={h} className="px-3 py-2 text-left text-[10px] font-semibold text-slate-500 uppercase whitespace-nowrap">{h}</th>
                                          ))}
                                        </tr></thead>
                                        <tbody>
                                          {items.map((item, i) => (
                                            <tr key={i} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                                              <td className="px-3 py-2 text-slate-700">{item.item_name}</td>
                                              <td className="px-3 py-2 font-mono text-xs text-blue-600 whitespace-nowrap">{item.material_code}</td>
                                              <td className="px-3 py-2 text-slate-400">{item.spec || '—'}</td>
                                              <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{item.unit || 'PCS'}</td>
                                              <td className="px-3 py-2 text-right font-medium">{Number(item.qty).toLocaleString()}</td>
                                              <td className="px-3 py-2 text-slate-400">{item.remark}</td>
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    </div>
                                  )}
                                </div>
                              </td>
                            </tr>
                          )}
                        </>
                      )
                    })}
                    {paged.length === 0 && <tr><td colSpan={8} className="px-4 py-12 text-center text-slate-400">尚無送貨單</td></tr>}
                  </tbody>
                </table>
                <Pagination page={page} totalPages={totalPages} setPage={setPage} total={total} />
              </>
            )}
          </div>
        </>
      )}
    </div>
  )
}
