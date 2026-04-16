'use client'
import { generateDeliveryNoteHTML } from '@/lib/printDeliveryNote'
import { useDialog } from '@/components/Dialog'
import { useEffect, useState } from 'react'
import { apiFetch, getSignatureUrl } from '@/lib/api'
import { usePagination, Pagination } from '@/lib/usePagination'
import { StatusFlow, DN_STEPS, getDNActions } from '@/components/StatusFlow'
import { can } from '@/lib/usePermissions'
import { getCompany } from '@/lib/useCompany'

type DNItem = { bom_id?:number|null; item_name:string; material_code:string; qty:number; shipped_qty:number; remark:string; po_ref?: string; spec?: string; unit?: string }
type DN = { id:number; dn_number:string; customer_name:string; delivery_date:string; status:string; remark:string; created_at:string; items?:DNItem[]; order_po_number?:string }
type Customer = { id:number; customer_name:string; customer_code:string }
type PendingOrder = { id:number; po_number:string; po_date:string; items_summary:string }
type OrderItem = { id:number; bom_id:number|null; qty:number; unit_price:number; product_name:string; product_sku:string }

const STATUS_MAP: Record<string,{label:string;badge:string}> = {
  draft:     { label:'草稿',   badge:'badge-gray'  },
  confirmed: { label:'已確認', badge:'badge-blue'  },
  shipped:   { label:'已出貨', badge:'badge-green' },
}

export default function DeliveryNotesPage() {
  const { toast, confirm: confirmDialog } = useDialog()

  const [dns, setDns] = useState<DN[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<DN|null>(null)
  const [editForm, setEditForm] = useState({ delivery_date: '', remark: '', items: [] as DNItem[] })
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [actionLoading, setActionLoading] = useState<number | null>(null)
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const [loadedItems, setLoadedItems] = useState<Record<number, DNItem[]>>({})
  const canWrite = can('delivery.create')
  const canDel = can('delivery.delete')

  // Create form state
  const [selectedCustomerId, setSelectedCustomerId] = useState('')
  const [poSearch, setPoSearch] = useState('')
  const [pendingOrders, setPendingOrders] = useState<PendingOrder[]>([])
  const [selectedOrderId, setSelectedOrderId] = useState('')
  const [orderItems, setOrderItems] = useState<OrderItem[]>([])
  const [shippedQtys, setShippedQtys] = useState<Record<number, number>>({})
  const [deliveryDate, setDeliveryDate] = useState('')
  const [remark, setRemark] = useState('')

  const load = () => apiFetch<DN[]>('/api/delivery-notes').then(setDns).finally(() => setLoading(false))
  useEffect(() => {
    load()
    apiFetch<Customer[]>('/api/customers').then(setCustomers).catch(() => {})
  }, [])

  const onSelectCustomer = async (customerId: string) => {
    setSelectedCustomerId(customerId)
    setSelectedOrderId('')
    setOrderItems([])
    setShippedQtys({})
    setPoSearch('')
    if (!customerId) { setPendingOrders([]); return }
    const orders = await apiFetch<PendingOrder[]>(`/api/customer-orders/pending?customer_id=${customerId}`)
    setPendingOrders(orders)
  }

  // Search by PO number directly
  const onSearchPO = async (val: string) => {
    setPoSearch(val)
    setSelectedOrderId('')
    setOrderItems([])
    setShippedQtys({})
    if (!val.trim()) { if (!selectedCustomerId) setPendingOrders([]); return }
    // Search all pending orders matching PO number
    const orders = await apiFetch<PendingOrder[]>(`/api/customer-orders/pending?po_search=${encodeURIComponent(val)}`)
    setPendingOrders(orders)
  }

  const onSelectOrder = async (orderId: string) => {
    setSelectedOrderId(orderId)
    setOrderItems([])
    setShippedQtys({})
    if (!orderId) return
    const data = await apiFetch<any>(`/api/customer-orders/${orderId}`)
    const items: OrderItem[] = (data.items || []).map((i: any) => ({
      id: i.id, bom_id: i.bom_id, qty: Number(i.qty),
      unit_price: Number(i.unit_price),
      product_name: i.product_name || '',
      product_sku: i.product_sku || '',
    }))
    setOrderItems(items)
    // Default shipped qty = ordered qty
    const qtys: Record<number, number> = {}
    items.forEach(i => { qtys[i.id] = i.qty })
    setShippedQtys(qtys)
  }

  const save = async () => {
    if (!selectedCustomerId) { toast('請選擇客戶', 'error'); return }
    if (!selectedOrderId) { toast('請選擇訂單', 'error'); return }
    const items = orderItems.map(i => ({
      bom_id: i.bom_id,
      item_name: i.product_name,
      material_code: i.product_sku,
      qty: shippedQtys[i.id] || 0,
      remark: '',
    })).filter(i => i.qty > 0)
    if (!items.length) { toast('請填寫出貨數量', 'error'); return }
    try {
      await apiFetch('/api/delivery-notes', {
        method: 'POST',
        body: JSON.stringify({
          customer_id: Number(selectedCustomerId),
          customer_order_id: Number(selectedOrderId),
          delivery_date: deliveryDate,
          remark,
          items,
        })
      })
      toast('出貨單建立成功')
      setCreating(false)
      resetForm()
      load()
    } catch (e: any) { toast('錯誤：' + e.message, 'error') }
  }

  const resetForm = () => {
    setSelectedCustomerId(''); setSelectedOrderId('')
    setPendingOrders([]); setOrderItems([]); setShippedQtys({})
    setDeliveryDate(''); setRemark(''); setPoSearch('')
  }

  const toggleExpand = async (id: number) => {
    const next = new Set(expanded)
    if (next.has(id)) { next.delete(id); setExpanded(next) }
    else {
      next.add(id); setExpanded(next)
      if (!loadedItems[id]) {
        const d = await apiFetch<DN>(`/api/delivery-notes/${id}`)
        setLoadedItems(p => ({ ...p, [id]: d.items || [] }))
      }
    }
  }

  const startEditDN = async (dn: DN) => {
    const d = await apiFetch<DN>(`/api/delivery-notes/${dn.id}`)
    setEditForm({
      delivery_date: dn.delivery_date ? String(dn.delivery_date).slice(0,10) : '',
      remark: dn.remark || '',
      items: d.items || []
    })
    setEditing(d)
  }

  const saveEditDN = async () => {
    if (!editing) return
    try {
      await apiFetch(`/api/delivery-notes/${editing.id}`, { method: 'PUT', body: JSON.stringify(editForm) })
      toast('出貨單已更新')
      setEditing(null)
      load()
    } catch (e: any) { toast('更新失敗：' + e.message, 'error') }
  }

  const changeStatus = async (id: number, status: string) => {
    const labels: Record<string, string> = {
      confirmed: '確認此出貨單？',
      shipped: '確認出貨？出貨後狀態不可撤銷，並將自動扣減庫存',
    }
    const btnLabels: Record<string, string> = { confirmed: '確認', shipped: '確認出貨' }
    if (!await confirmDialog(labels[status] || '確認變更狀態？', '', btnLabels[status] || '確認')) return
    setActionLoading(id)
    try {
      await apiFetch(`/api/delivery-notes/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) })
      toast('狀態已更新')
      await load()
    } catch (e: any) { toast('操作失敗：' + e.message, 'error') }
    finally { setActionLoading(null) }
  }

  const del = async (id: number) => {
    if (!await confirmDialog('確定刪除？')) return
    try {
      await apiFetch(`/api/delivery-notes/${id}`, { method: 'DELETE' })
      await load()
    } catch (e: any) { toast('刪除失敗：' + e.message, 'error') }
  }

  const printDN = async (dn: DN) => {
    const detail = await apiFetch<DN & { po_ref?: string; address?: string }>(`/api/delivery-notes/${dn.id}`)
    const company = await getCompany()
    const html = generateDeliveryNoteHTML({
      dn_number: dn.dn_number,
      customer_name: dn.customer_name,
      delivery_date: dn.delivery_date,
      po_ref: detail.po_ref || dn.order_po_number || '',
      address: detail.address || '',
      remark: dn.remark,
      items: detail.items || dn.items || []
    }, getSignatureUrl() || undefined, company)
    const w = window.open('', '_blank', 'width=800,height=1000')
    if (!w) {
      toast('瀏覽器已封鎖彈出視窗，請允許後再列印', 'error')
      return
    }
    w.document.write(html)
    w.document.close()
    setTimeout(() => w.print(), 500)
  }

  const filtered = dns.filter(d => !search ||
    d.dn_number.toLowerCase().includes(search.toLowerCase()) ||
    (d.customer_name||'').toLowerCase().includes(search.toLowerCase()))
  const { page, setPage, totalPages, paged, total } = usePagination(filtered, 20)
  const inp = 'oms-input text-xs py-1.5'

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-slate-800">出貨單</h1>
        {canWrite && <button onClick={() => setCreating(true)} className="btn-primary">+ 新增出貨單</button>}
      </div>

      {creating && canWrite && (
        <div className="oms-card p-6 mb-5">
          <h2 className="font-semibold text-slate-800 mb-5">新增出貨單</h2>

          {/* Step 1: Select customer or search by PO number */}
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
              <label className="block text-[11px] text-slate-500 mb-1.5">出貨日期</label>
              <input type="date" className="oms-input" value={deliveryDate} onChange={e => setDeliveryDate(e.target.value)} />
            </div>
            <div>
              <label className="block text-[11px] text-slate-500 mb-1.5">備註（交易條件、特殊要求等）</label>
              <textarea className="oms-input" rows={3} value={remark} onChange={e => setRemark(e.target.value)} placeholder="可輸入交易條件、付款方式、交貨要求等資訊..." />
            </div>
          </div>

          {/* Step 2: Order items with shipped qty */}
          {orderItems.length > 0 && (
            <div className="mb-5">
              <div className="text-xs font-semibold text-slate-600 mb-2">出貨明細（可修改實際出貨數量）</div>
              <div className="border border-slate-200 rounded-lg overflow-hidden">
                <table className="w-full text-xs">
                  <thead><tr className="bg-slate-50 border-b border-slate-200">
                    <th className="px-3 py-2 text-left text-[10px] font-semibold text-slate-500 uppercase">品名</th>
                    <th className="px-3 py-2 text-left text-[10px] font-semibold text-slate-500 uppercase">物料編號</th>
                    <th className="px-3 py-2 text-right text-[10px] font-semibold text-slate-500 uppercase">訂單數量</th>
                    <th className="px-3 py-2 text-right text-[10px] font-semibold text-slate-500 uppercase">本次出貨</th>
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
                            value={shippedQtys[item.id] ?? item.qty}
                            onChange={e => setShippedQtys(p => ({ ...p, [item.id]: Number(e.target.value) }))} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="flex gap-2">
            <button onClick={save} className="btn-primary" disabled={!selectedOrderId || orderItems.length === 0}>建立出貨單</button>
            <button onClick={() => { setCreating(false); resetForm() }} className="btn-ghost border border-slate-200">取消</button>
          </div>
        </div>
      )}

      {editing && canWrite && (
        <div className="oms-card p-6 mb-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-bold">編輯出貨單 {editing.dn_number}</h2>
              <button onClick={() => setEditing(null)} className="btn-ghost border border-slate-200">返回列表</button>
            </div>
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div>
                <label className="block text-[11px] text-slate-500 mb-1.5">出貨日期</label>
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
              <button onClick={saveEditDN} className="btn-primary">儲存修改</button>
              <button onClick={() => setEditing(null)} className="btn-ghost border border-slate-200">取消</button>
            </div>
        </div>
      )}

      {!creating && !editing && (
        <>
          <div className="mb-4">
            <input className="oms-input w-64" placeholder="搜尋出貨單號或客戶..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>

          <div className="oms-card overflow-hidden">
        {loading ? <div className="flex justify-center py-16"><div className="w-5 h-5 border-2 border-blue-200 border-t-blue-600 rounded-full animate-spin"/></div> : (
          <>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200">
                  <th className="w-8" />
                  {['出貨單號','客戶名稱','關聯訂單','出貨日期','備註','狀態','操作'].map(h => (
                    <th key={h} className="px-3 py-3 text-left text-[11px] font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {paged.map(dn => {
                  const isOpen = expanded.has(dn.id)
                  const items = loadedItems[dn.id] || []
                  return (
                    <>
                      <tr key={dn.id}
                        className={`border-b border-slate-100 cursor-pointer transition-colors ${isOpen ? 'bg-slate-50' : 'hover:bg-slate-50'}`}
                        onClick={() => toggleExpand(dn.id)}>
                        <td className="pl-3 py-2.5">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                            className={`w-3.5 h-3.5 text-slate-400 transition-transform duration-200 ${isOpen ? 'rotate-90' : ''}`}>
                            <polyline points="9 18 15 12 9 6" />
                          </svg>
                        </td>
                        <td className="px-3 py-2.5 font-mono text-xs text-blue-600 whitespace-nowrap">{dn.dn_number}</td>
                        <td className="px-3 py-2.5 font-medium whitespace-nowrap max-w-[200px] truncate" title={dn.customer_name}>{dn.customer_name}</td>
                        <td className="px-3 py-2.5 text-slate-400 text-xs whitespace-nowrap">{dn.order_po_number || '—'}</td>
                        <td className="px-3 py-2.5 text-slate-400 whitespace-nowrap">{dn.delivery_date ? String(dn.delivery_date).slice(0,10) : '—'}</td>
                        <td className="px-3 py-2.5 text-slate-400 whitespace-nowrap max-w-[120px] truncate" title={dn.remark}>{dn.remark||'—'}</td>
                        <td className="px-3 py-2.5 whitespace-nowrap"><span className={STATUS_MAP[dn.status]?.badge}>{STATUS_MAP[dn.status]?.label}</span></td>
                        <td className="px-3 py-2.5 whitespace-nowrap" onClick={e => e.stopPropagation()}>
                          <div className="flex gap-1 items-center">
                            <StatusFlow compact steps={DN_STEPS} current={dn.status}
                              actions={actionLoading === dn.id ? [] : getDNActions(dn.status)}
                              onAction={(toStatus) => changeStatus(dn.id, toStatus)} />
                            {actionLoading === dn.id && <span className="text-xs text-slate-400 px-1">處理中...</span>}
                            <button onClick={e => { e.stopPropagation(); printDN(dn) }} className="btn-ghost" title="列印">🖨 列印</button>
                            {canWrite && dn.status === 'draft' && <button onClick={e => { e.stopPropagation(); startEditDN(dn) }} className="btn-ghost text-blue-600">✏ 編輯</button>}
                            {canDel && <button onClick={e => { e.stopPropagation(); del(dn.id) }} className="btn-danger">刪除</button>}
                          </div>
                        </td>
                      </tr>
                      {isOpen && (
                        <tr key={`${dn.id}-items`} className="border-b border-slate-100">
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
                                          <td className="px-3 py-2 text-slate-400">{(item as any).spec || '—'}</td>
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
                {paged.length === 0 && <tr><td colSpan={8} className="px-4 py-12 text-center text-slate-400">尚無出貨單</td></tr>}
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
