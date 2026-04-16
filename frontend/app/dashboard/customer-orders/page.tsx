'use client'
import { useDialog } from '@/components/Dialog'
import { useEffect, useState } from 'react'
import { apiFetch, getSignatureUrl } from '@/lib/api'
import { usePagination, Pagination } from '@/lib/usePagination'
import { StatusFlow, CO_STEPS } from '@/components/StatusFlow'
import { generateOrderHTML } from '@/lib/printOrder'
import { SearchableSelect } from '@/components/SearchableSelect'
import { getUser } from '@/lib/permissions'
import { can } from '@/lib/usePermissions'
import { getCompany } from '@/lib/useCompany'
import FieldLockHint from '@/components/FieldLockHint'

// Customer order actions based on current status
function getCOActions(status: string) {
  if (status === 'pending')   return [
    { label: '完成', toStatus: 'completed', icon: '✓', color: 'primary' as const },
    { label: '延遲', toStatus: 'delay',     icon: '⚠', color: 'warning' as const },
  ]
  if (status === 'partial')   return [
    { label: '完成', toStatus: 'completed', icon: '✓', color: 'primary' as const },
    { label: '延遲', toStatus: 'delay',     icon: '⚠', color: 'warning' as const },
  ]
  if (status === 'delay')     return [{ label: '恢復待出貨', toStatus: 'pending', icon: '↩' }]
  return []
}

type OrderItem = { id?:number; bom_id:number|null; qty:number; unit_price:number; remark:string; arrived_qty?:number; arrived_date?:string; balance?:number; status?:string; product_sku?:string; product_name?:string; spec?:string; unit?:string; image_url?:string }
type Order = { id:number; po_date:string; po_number:string; customer_id:number; customer_name:string; customer_code:string; status:string; remark:string; created_at:string; items?:OrderItem[]; tax_rate?:number; tax_amount?:number; total_amount?:number; delivery_date?:string; person_in_charge?:string; payment_terms?:string }
type BOM = { id:number; product_sku:string; product_name:string; company_price?:number; unit?:string; spec?:string; image_url?:string }
type Customer = { id:number; customer_code:string; customer_name:string }
type ProfitOrderSummary = {
  id: number
  revenue: number
  cogs: number
  gross_profit: number
  operating_cost: number
  sales_tax: number
  income_tax: number
  manual_adjustment: number
  net_profit: number
  net_margin: number
}
const emptyItem = (): OrderItem => ({ bom_id:null, qty:0, unit_price:0, remark:'', spec:'', unit:'' })

const STATUS_BADGE: Record<string,string> = { pending:'badge-yellow', completed:'badge-green', delay:'badge-red', partial:'badge-blue' }
const STATUS_LABEL: Record<string,string> = { pending:'待出貨', completed:'已完成', delay:'延遲', partial:'部分到貨' }

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      className={`w-3.5 h-3.5 transition-transform duration-200 ${open ? 'rotate-90' : ''}`}>
      <polyline points="9 18 15 12 9 6" />
    </svg>
  )
}

export default function CustomerOrdersPage() {
  const { toast, confirm: confirmDialog } = useDialog()
  const user = getUser()
  const canViewProfit = user?.role === 'manager'

  const [orders, setOrders] = useState<Order[]>([])
  const [profitByOrderId, setProfitByOrderId] = useState<Record<number, ProfitOrderSummary>>({})
  const [boms, setBoms] = useState<BOM[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const [loadedItems, setLoadedItems] = useState<Record<number, OrderItem[]>>({})
  const [creating, setCreating] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState({
    po_date:'', po_number:'', customer_id:'', remark:'',
    currency: 'VND', delivery_date:'', delivery_address:'',
    person_in_charge:'', payment_terms:'',
    items:[emptyItem()]
  })
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const canWrite = can('customer_order.create')
  const canDel = can('customer_order.delete')

  const load = () => {
    const requests: Promise<any>[] = [apiFetch<Order[]>('/api/customer-orders')]
    if (canViewProfit) requests.push(apiFetch<{ orders: ProfitOrderSummary[] }>('/api/profit-tracking/orders'))
    return Promise.all(requests)
      .then(([orderList, profitResp]) => {
        setOrders(orderList as Order[])
        if (!canViewProfit) {
          setProfitByOrderId({})
          return
        }
        const map: Record<number, ProfitOrderSummary> = {}
        ;((profitResp as { orders?: ProfitOrderSummary[] } | undefined)?.orders || []).forEach((row) => {
          map[Number(row.id)] = row
        })
        setProfitByOrderId(map)
      })
      .catch(err => {
        console.error('Failed to load orders:', err)
        toast('載入訂單失敗：' + err.message, 'error')
      })
      .finally(()=>setLoading(false))
  }
  useEffect(()=>{
    load()
    apiFetch<BOM[]>('/api/bom').then(setBoms).catch(()=>{})
    apiFetch<Customer[]>('/api/customers').then(setCustomers).catch(()=>{})
  },[])

  const toggleExpand = async (id: number) => {
    const next = new Set(expanded)
    if (next.has(id)) { next.delete(id); setExpanded(next) }
    else {
      next.add(id); setExpanded(next)
      if (loadedItems[id] === undefined) {
        const data = await apiFetch<Order>(`/api/customer-orders/${id}`)
        setLoadedItems(p => ({ ...p, [id]: data.items || [] }))
      }
    }
  }

  const save = async () => {
    if (!form.po_number) { toast('請填寫採購單號', 'error'); return }
    if (!form.customer_id) { toast('請選擇客戶', 'error'); return }
    const validItems = form.items.filter(i => i.bom_id)
    if (!validItems.length) { toast('請至少選擇一個 BOM 品項', 'error'); return }
    try {
      if (editingId) {
        await apiFetch(`/api/customer-orders/${editingId}`, { method:'PUT', body:JSON.stringify({ ...form, tax_rate: 0, items: validItems }) })
        toast('訂單已更新'); setEditingId(null)
      } else {
        await apiFetch('/api/customer-orders', { method:'POST', body:JSON.stringify({ ...form, tax_rate: 0, items: validItems }) })
        toast('建立成功'); setCreating(false)
      }
      setForm({ po_date:'', po_number:'', customer_id:'', remark:'', currency:'VND', delivery_date:'', delivery_address:'', person_in_charge:'', payment_terms:'', items:[emptyItem()] })
      await load()
    } catch(e:any){ toast('錯誤：'+e.message, 'error') }
  }

  const startEdit = async (order: Order) => {
    const data = await apiFetch<Order>(`/api/customer-orders/${order.id}`)
    setForm({
      po_date: order.po_date ? String(order.po_date).slice(0,10) : '',
      po_number: order.po_number,
      customer_id: String(order.customer_id),
      remark: order.remark || '',
      currency: (order as any).currency || 'VND',
      delivery_date: order.delivery_date ? String(order.delivery_date).slice(0,10) : '',
      delivery_address: (order as any).delivery_address || '',
      person_in_charge: order.person_in_charge || '',
      payment_terms: order.payment_terms || '',
      items: (data.items || []).map(i => {
        const matchedBom =
          (i.bom_id ? boms.find(b => b.id === i.bom_id) : undefined) ||
          (i.product_sku ? boms.find(b => b.product_sku === i.product_sku) : undefined)
        return {
          bom_id: i.bom_id ?? matchedBom?.id ?? null,
          qty: Number(i.qty),
          unit_price: Number(i.unit_price) || Number(matchedBom?.company_price) || 0,
          remark: (i as any).remark || '',
          spec: i.spec || matchedBom?.spec || '',
          unit: i.unit || matchedBom?.unit || '',
          product_sku: i.product_sku || matchedBom?.product_sku,
          product_name: i.product_name || matchedBom?.product_name,
          image_url: i.image_url || matchedBom?.image_url,
        }
      })
    })
    setEditingId(order.id)
    setCreating(false)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const printOrder = async (orderId: number) => {
    const [data, company] = await Promise.all([
      apiFetch<any>(`/api/customer-orders/${orderId}`),
      getCompany(),
    ])
    const html = generateOrderHTML(data, getSignatureUrl() || undefined, company)
    const w = window.open('', '_blank', 'width=800,height=1000')
    if (w) { w.document.write(html); w.document.close(); setTimeout(() => w.print(), 500) }
  }

  const del = async (id: number) => {
    if (!await confirmDialog('確定刪除？', '此操作將同時刪除關聯的出貨單')) return
    try {
      await apiFetch(`/api/customer-orders/${id}`, { method:'DELETE' })
      toast('已刪除')
      await load()
    } catch(e:any){ toast('刪除失敗：'+e.message, 'error') }
  }

  const changeStatus = async (id: number, status: string) => {
    const labels: Record<string, string> = {
      completed: '確認此訂單已全部完成？',
      delay:     '確認標記為延遲？',
      pending:   '確認恢復為待出貨狀態？',
      partial:   '確認標記為部分出貨？',
    }
    const btnLabels: Record<string, string> = {
      completed: '確認完成', delay: '標記延遲', pending: '恢復待出貨', partial: '部分出貨',
    }
    if (!await confirmDialog(labels[status] || '確認變更狀態？', '', btnLabels[status] || '確認')) return
    try {
      await apiFetch(`/api/customer-orders/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) })
      toast('狀態已更新')
      await load()
    } catch (e: any) { toast('錯誤：' + e.message, 'error') }
  }

  const addItem = () => setForm(p=>({...p, items:[...p.items, emptyItem()]}))
  const removeItem = (i:number) => setForm(p=>({...p, items:p.items.filter((_,idx)=>idx!==i)}))
  const updateItem = (i:number, f:keyof OrderItem, v:any) => setForm(p=>({...p, items:p.items.map((item,idx)=>idx===i?{...item,[f]:v}:item)}))

  // When BOM selected, auto-fill unit_price, spec, unit, image_url from BOM
  const onSelectBom = (i:number, bomId:string) => {
    const bom = boms.find(b => String(b.id) === bomId)
    const updates: Partial<OrderItem> = { bom_id: bomId ? Number(bomId) : null }
    
    if (bom) {
      if (bom.company_price) updates.unit_price = Number(bom.company_price)
      if (bom.spec) updates.spec = bom.spec
      if (bom.unit) updates.unit = bom.unit
      if (bom.image_url) updates.image_url = bom.image_url
      updates.product_sku = bom.product_sku
      updates.product_name = bom.product_name
    } else {
      updates.unit_price = 0
      updates.spec = ''
      updates.unit = ''
      updates.image_url = ''
      updates.product_sku = ''
      updates.product_name = ''
    }
    
    setForm(p => ({
      ...p,
      items: p.items.map((item, idx) => idx === i ? { ...item, ...updates } : item)
    }))
  }

  const filtered = orders.filter(o => {
    const matchSearch = !search ||
      o.po_number.toLowerCase().includes(search.toLowerCase()) ||
      (o.customer_name||'').toLowerCase().includes(search.toLowerCase())
    const matchStatus = !statusFilter || o.status === statusFilter
    return matchSearch && matchStatus
  })
  
  const { page, setPage, totalPages, paged, total } = usePagination(filtered, 20)
  const inp = 'oms-input text-xs py-1.5'
  const lockedInp = `${inp} bom-locked-field`
  const money = (v?: number) => Number(v || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-slate-800">客戶訂單明細</h1>
          <p className="section-hint">點選訂單列展開檢視品項明細</p>
        </div>
        {canWrite && <button onClick={()=>{ setCreating(true); setEditingId(null); setForm({ po_date:'', po_number:'', customer_id:'', remark:'', currency:'VND', delivery_date:'', delivery_address:'', person_in_charge:'', payment_terms:'', items:[emptyItem()] }) }} className="btn-primary">+ 新增訂單</button>}
      </div>

      {(creating || editingId !== null) && canWrite && (
        <div className="oms-card p-6 mb-5">
          <h2 className="text-sm font-semibold text-slate-800 mb-4">{editingId ? '編輯客戶訂單' : '新增客戶訂單'}</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
            <div>
              <label className="block text-[11px] text-slate-500 mb-1.5">採購日期</label>
              <input type="date" className={inp} value={form.po_date} onChange={e=>setForm(p=>({...p,po_date:e.target.value}))} />
            </div>
            <div>
              <label className="flex items-center gap-1.5 text-[11px] text-slate-500 mb-1.5">
                採購單號 *
                {editingId !== null && <FieldLockHint />}
              </label>
              <input
                className={inp}
                value={form.po_number}
                onChange={e=>setForm(p=>({...p,po_number:e.target.value}))}
                disabled={editingId !== null}
              />
              {editingId !== null && <p className="text-[10px] text-slate-400 mt-1">訂單編號建立後不可修改</p>}
            </div>
            <div>
              <label className="block text-[11px] text-slate-500 mb-1.5">客戶 *</label>
              <select className={inp} value={form.customer_id} onChange={e=>{
                const cust = customers.find(c=>String(c.id)===e.target.value)
                setForm(p=>({...p, customer_id:e.target.value, payment_terms: (cust as any)?.payment_terms||p.payment_terms }))
              }}>
                <option value="">-- 選擇客戶 --</option>
                {customers.map(c=>(
                  <option key={c.id} value={String(c.id)}>{c.customer_name}{c.customer_code?` (${c.customer_code})`:''}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[11px] text-slate-500 mb-1.5">交貨日期</label>
              <input type="date" className={inp} value={form.delivery_date} onChange={e=>setForm(p=>({...p,delivery_date:e.target.value}))} />
            </div>
            <div>
              <label className="block text-[11px] text-slate-500 mb-1.5">交貨地點</label>
              <input className={inp} value={form.delivery_address} onChange={e=>setForm(p=>({...p,delivery_address:e.target.value}))} placeholder="交貨地址" />
            </div>
            <div>
              <label className="block text-[11px] text-slate-500 mb-1.5">負責人</label>
              <input className={inp} value={form.person_in_charge} onChange={e=>setForm(p=>({...p,person_in_charge:e.target.value}))} />
            </div>
            <div>
              <label className="block text-[11px] text-slate-500 mb-1.5">付款方式</label>
              <input className={inp} value={form.payment_terms} onChange={e=>setForm(p=>({...p,payment_terms:e.target.value}))} placeholder="如：月結30天" />
            </div>
            <div>
              <label className="block text-[11px] text-slate-500 mb-1.5">幣種</label>
              <select className={inp} value={form.currency} onChange={e=>setForm(p=>({...p,currency:e.target.value}))}>
                <option value="VND">VND</option>
                <option value="USD">USD</option>
                <option value="CNY">CNY</option>
              </select>
            </div>
            <div className="md:col-span-4">
              <label className="block text-[11px] text-slate-500 mb-1.5">備註（交易條件、特殊要求等）</label>
              <textarea className={inp} rows={3} value={form.remark} onChange={e=>setForm(p=>({...p,remark:e.target.value}))} placeholder="可輸入交易條件、付款方式、交貨要求等資訊..." />
            </div>
          </div>

          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-slate-600">訂單品項</span>
            <button onClick={addItem} className="btn-ghost text-blue-600">+ 新增品項</button>
          </div>
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full text-xs">
              <thead><tr className="bg-slate-50 border-b border-slate-200">
                <th className="px-3 py-2 text-left text-[10px] font-semibold text-slate-500 uppercase">圖片</th>
                <th className="px-3 py-2 text-left text-[10px] font-semibold text-slate-500 uppercase">品名（BOM）</th>
                <th className="px-3 py-2 text-left text-[10px] font-semibold text-slate-500 uppercase">規格</th>
                <th className="px-3 py-2 text-left text-[10px] font-semibold text-slate-500 uppercase">單位</th>
                <th className="px-3 py-2 text-left text-[10px] font-semibold text-slate-500 uppercase">數量</th>
                <th className="px-3 py-2 text-left text-[10px] font-semibold text-slate-500 uppercase">單價</th>
                <th className="px-3 py-2 text-right text-[10px] font-semibold text-slate-500 uppercase">小計</th>
                <th className="px-3 py-2 text-left text-[10px] font-semibold text-slate-500 uppercase">Remark</th>
                <th className="w-8" />
              </tr></thead>
              <tbody>
                {form.items.map((item,i)=>(
                  <tr key={i} className="border-b border-slate-100 last:border-0">
                    <td className="p-1.5">
                      {item.image_url ? (
                        <img src={item.image_url} alt="" className="w-10 h-10 object-cover rounded border border-slate-200" onError={e=>{(e.target as HTMLImageElement).style.display='none'}} />
                      ) : (
                        <div className="w-10 h-10 bg-slate-100 rounded flex items-center justify-center text-slate-300 text-xs">無</div>
                      )}
                    </td>
                    <td className="p-1.5 min-w-[260px]">
                      <SearchableSelect
                        options={boms}
                        value={item.bom_id ? String(item.bom_id) : ''}
                        onChange={val => onSelectBom(i, val)}
                        placeholder="-- 選擇成品 BOM --"
                        renderOption={b => `${b.product_sku} — ${b.product_name}${b.spec ? ` (${b.spec})` : ''}`}
                        filterFn={(b, search) => 
                          b.product_sku.toLowerCase().includes(search) ||
                          b.product_name.toLowerCase().includes(search) ||
                          (b.spec||'').toLowerCase().includes(search)
                        }
                      />
                    </td>
                    <td className="p-1.5 min-w-[120px]">
                      <input className={lockedInp} value={item.spec||''} onChange={e=>updateItem(i,'spec',e.target.value)} placeholder="規格" readOnly />
                    </td>
                    <td className="p-1.5 w-20">
                      <input className={lockedInp} value={item.unit||''} onChange={e=>updateItem(i,'unit',e.target.value)} readOnly />
                    </td>
                    <td className="p-1.5 w-24">
                      <input type="number" className={inp} value={item.qty||''} onChange={e=>updateItem(i,'qty',Number(e.target.value))} />
                    </td>
                    <td className="p-1.5 w-28">
                      <input type="number" className={inp} value={item.unit_price||''} onChange={e=>updateItem(i,'unit_price',Number(e.target.value))} />
                    </td>
                    <td className="p-1.5 w-28 text-right">
                      <span className="font-semibold text-slate-700">{((item.qty||0) * (item.unit_price||0)).toLocaleString()}</span>
                    </td>
                    <td className="p-1.5 min-w-[180px]">
                      <input className={inp} value={item.remark || ''} onChange={e=>updateItem(i,'remark',e.target.value)} placeholder="Remark" />
                    </td>
                    <td className="p-1.5 text-center">
                      <button onClick={()=>removeItem(i)} className="text-slate-300 hover:text-red-600 transition-colors">✕</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* Summary */}
          {(() => {
            const subtotal = form.items.reduce((s,i) => s + (i.qty||0)*(i.unit_price||0), 0)
            return (
              <div className="flex justify-end mt-3 text-xs text-slate-500 gap-6">
                <span>小計：<span className="font-semibold text-slate-700">{subtotal.toLocaleString()}</span></span>
                <span>總計：<span className="font-bold text-slate-900 text-sm">{subtotal.toLocaleString()}</span></span>
              </div>
            )
          })()}
          <div className="flex gap-2 mt-4">
            <button onClick={save} className="btn-primary">{editingId ? '儲存修改' : '建立訂單'}</button>
            <button onClick={()=>{ setCreating(false); setEditingId(null); setForm({ po_date:'', po_number:'', customer_id:'', remark:'', currency:'VND', delivery_date:'', delivery_address:'', person_in_charge:'', payment_terms:'', items:[emptyItem()] }) }} className="btn-ghost border border-slate-200">取消</button>
          </div>
        </div>
      )}

      {!creating && editingId === null && (
        <>
          <div className="list-controls">
            <input className="list-search" placeholder="搜尋採購單號或客戶..." value={search} onChange={e=>setSearch(e.target.value)} />
            <div className="flex gap-1">
              {[['', '全部'], ['pending', '待出貨'], ['partial', '部分'], ['delay', '延遲'], ['completed', '已完成']].map(([val, label]) => (
                <button key={val} onClick={() => setStatusFilter(val)}
                  className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${statusFilter === val ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300'}`}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="oms-card overflow-hidden">
        {loading ? <div className="flex justify-center py-16"><div className="w-5 h-5 border-2 border-blue-200 border-t-blue-600 rounded-full animate-spin"/></div> : (
          <>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200">
                  <th className="w-8" />
                  <th className="px-4 py-3 text-left text-[11px] font-semibold text-slate-500 uppercase tracking-wider">訂單編號</th>
                  <th className="px-4 py-3 text-left text-[11px] font-semibold text-slate-500 uppercase tracking-wider">客戶</th>
                  <th className="px-4 py-3 text-left text-[11px] font-semibold text-slate-500 uppercase tracking-wider">訂單日期</th>
                  <th className="px-4 py-3 text-left text-[11px] font-semibold text-slate-500 uppercase tracking-wider">交貨日</th>
                  <th className="px-4 py-3 text-right text-[11px] font-semibold text-slate-500 uppercase tracking-wider">總計</th>
                  {canViewProfit && <th className="px-4 py-3 text-right text-[11px] font-semibold text-slate-500 uppercase tracking-wider">淨利</th>}
                  <th className="px-4 py-3 text-left text-[11px] font-semibold text-slate-500 uppercase tracking-wider">狀態</th>
                  <th className="px-4 py-3 text-left text-[11px] font-semibold text-slate-500 uppercase tracking-wider">操作</th>
                </tr>
              </thead>
              <tbody>
                {paged.map(o => {
                  const isOpen = expanded.has(o.id)
                  const items = loadedItems[o.id]
                  const profit = profitByOrderId[o.id]
                  return (
                    <>
                      <tr key={o.id}
                        className={`border-b border-slate-100 cursor-pointer transition-colors ${isOpen ? 'bg-slate-50' : 'hover:bg-slate-50'}`}
                        onClick={() => toggleExpand(o.id)}>
                        <td className="pl-4 py-3"><span className="text-slate-500"><ChevronIcon open={isOpen} /></span></td>
                        <td className="px-4 py-3 font-mono text-xs text-blue-600">{o.po_number}</td>
                        <td className="px-4 py-3 text-slate-800 font-medium max-w-[220px] truncate" title={o.customer_name}>{o.customer_name}</td>
                        <td className="px-4 py-3 text-slate-400 text-xs">{o.po_date ? String(o.po_date).slice(0,10) : '—'}</td>
                        <td className="px-4 py-3 text-slate-400 text-xs">{o.delivery_date ? String(o.delivery_date).slice(0,10) : '—'}</td>
                        <td className="px-4 py-3 text-right font-semibold text-slate-800">{o.total_amount ? Number(o.total_amount).toLocaleString() : '—'}</td>
                        {canViewProfit && (
                          <td className={`px-4 py-3 text-right font-semibold ${(profit?.net_profit || 0) >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                            {profit ? money(profit.net_profit) : '—'}
                          </td>
                        )}
                        <td className="px-4 py-3">
                          <StatusFlow compact steps={CO_STEPS} current={o.status}
                            actions={getCOActions(o.status)}
                            onAction={(toStatus) => changeStatus(o.id, toStatus)} />
                        </td>
                        <td className="px-4 py-3" onClick={e=>e.stopPropagation()}>
                          <div className="flex gap-1">
                            <button onClick={e=>{e.stopPropagation();printOrder(o.id)}} className="btn-ghost" title="列印">🖨 列印</button>
                            {canWrite && o.status !== 'completed' && (
                              <button onClick={e=>{e.stopPropagation();startEdit(o)}} className="btn-ghost text-blue-600">✏ 編輯</button>
                            )}
                            {canDel && (
                              <button onClick={e=>{e.stopPropagation();del(o.id)}} className="btn-danger">刪除</button>
                            )}
                          </div>
                        </td>
                      </tr>
                      {isOpen && (
                        <tr key={`${o.id}-items`} className="border-b border-slate-100">
                          <td colSpan={canViewProfit ? 9 : 8} className="px-0 py-0">
                            <div className="expand-row-wrap">
                              {canViewProfit && profit && (
                                <div className="px-4 py-3 border-b border-slate-100 bg-slate-50">
                                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-[11px]">
                                    <div><span className="text-slate-400">營收</span><div className="font-semibold text-slate-700">{money(profit.revenue)}</div></div>
                                    <div><span className="text-slate-400">成本</span><div className="font-semibold text-slate-700">{money(profit.cogs)}</div></div>
                                    <div><span className="text-slate-400">毛利</span><div className="font-semibold text-slate-700">{money(profit.gross_profit)}</div></div>
                                    <div><span className="text-slate-400">營運成本</span><div className="font-semibold text-slate-700">{money(profit.operating_cost)}</div></div>
                                    <div><span className="text-slate-400">VAT</span><div className="font-semibold text-slate-700">{money(profit.sales_tax)}</div></div>
                                    <div><span className="text-slate-400">CIT</span><div className="font-semibold text-slate-700">{money(profit.income_tax)}</div></div>
                                    <div><span className="text-slate-400">手動調整</span><div className="font-semibold text-slate-700">{money(profit.manual_adjustment)}</div></div>
                                    <div><span className="text-slate-400">淨利率</span><div className={`font-semibold ${(profit.net_margin || 0) >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>{Number(profit.net_margin || 0).toFixed(2)}%</div></div>
                                  </div>
                                  <div className="mt-2 text-[11px] text-slate-500">
                                    淨利 = 毛利 - 營運成本 - VAT - CIT + 手動調整
                                  </div>
                                  <div className="mt-1 text-[10px] text-slate-400">
                                    VAT/CIT 以毛利計；營運成本以稅後毛利計
                                  </div>
                                </div>
                              )}
                              {items === undefined ? (
                                <div className="expand-row-loading">
                                  <div className="w-3 h-3 border border-slate-300 border-t-slate-500 rounded-full animate-spin"/>載入中...
                                </div>
                              ) : items.length === 0 ? (
                                <div className="expand-row-empty">尚無品項</div>
                              ) : (
                                <table className="w-full text-xs">
                                  <thead><tr className="border-b border-slate-100">
                                    <th className="px-4 py-2 text-left text-[10px] font-semibold text-slate-500 uppercase whitespace-nowrap">料號</th>
                                    <th className="px-4 py-2 text-left text-[10px] font-semibold text-slate-500 uppercase whitespace-nowrap">品名</th>
                                    <th className="px-4 py-2 text-right text-[10px] font-semibold text-slate-500 uppercase whitespace-nowrap">數量</th>
                                    <th className="px-4 py-2 text-right text-[10px] font-semibold text-slate-500 uppercase whitespace-nowrap">單價</th>
                                    <th className="px-4 py-2 text-left text-[10px] font-semibold text-slate-500 uppercase whitespace-nowrap">Remark</th>
                                    <th className="px-4 py-2 text-right text-[10px] font-semibold text-slate-500 uppercase whitespace-nowrap">已到數量</th>
                                    <th className="px-4 py-2 text-right text-[10px] font-semibold text-slate-500 uppercase whitespace-nowrap">結餘</th>
                                    <th className="px-4 py-2 text-left text-[10px] font-semibold text-slate-500 uppercase whitespace-nowrap">狀態</th>
                                  </tr></thead>
                                  <tbody>
                                    {items.map((item,i)=>(
                                      <tr key={i} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                                        <td className="px-4 py-2 font-mono text-blue-600 whitespace-nowrap">{item.product_sku}</td>
                                        <td className="px-4 py-2 text-slate-700 whitespace-nowrap max-w-[200px] truncate" title={item.product_name}>{item.product_name}</td>
                                        <td className="px-4 py-2 text-right font-medium whitespace-nowrap">{Number(item.qty).toLocaleString()}</td>
                                        <td className="px-4 py-2 text-right text-slate-600 whitespace-nowrap">{Number(item.unit_price).toLocaleString()}</td>
                                        <td className="px-4 py-2 text-slate-400 whitespace-nowrap">{(item as any).remark || '—'}</td>
                                        <td className="px-4 py-2 text-right text-slate-600 whitespace-nowrap">{Number(item.arrived_qty||0).toLocaleString()}</td>
                                        <td className="px-4 py-2 text-right font-medium whitespace-nowrap">{Number(item.balance||0).toLocaleString()}</td>
                                        <td className="px-4 py-2 whitespace-nowrap">
                                          <span className={STATUS_BADGE[item.status||'pending']||'badge-gray'}>{STATUS_LABEL[item.status||'pending']||item.status}</span>
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  )
                })}
                {paged.length===0 && <tr><td colSpan={canViewProfit ? 9 : 8} className="px-4 py-12 text-center text-slate-400">尚無訂單</td></tr>}
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
