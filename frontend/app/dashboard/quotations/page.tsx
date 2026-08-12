'use client'
import React from 'react'
import DecimalInput from '@/components/DecimalInput'
import { useDialog } from '@/components/Dialog'
import { Suspense, useEffect, useMemo, useState } from 'react'
import { apiFetch } from '@/lib/api'
import { useSearchParams } from 'next/navigation'
import { formatDecimal, formatInteger } from '@/lib/numberFormat'
import { usePagination, Pagination } from '@/lib/usePagination'
import { getCompany, getCompanySignatureUrl } from '@/lib/useCompany'
import { generateQuotationHTML, openQuotationPrint } from '@/lib/printQuotation'
import { normalizeMoqTiers, resolveTierPrice } from '@/lib/moqPricing'
import StatusCountChips from '@/components/StatusCountChips'
import { StatusFlow, QT_STEPS, getQTActions } from '@/components/StatusFlow'
import { can } from '@/lib/usePermissions'

type MoqTier = { moq: number; price: number }
type QItem = { bom_id?:number|null; material_id?:number|null; item_name:string; material_code:string; spec:string; unit:string; qty:number; unit_price:number; total_price:number; remark:string; moq_tiers:MoqTier[]; image_url?:string }
type Q = { id:number; quotation_number:string; customer_name:string; customer_id?:number; status:string; total_amount:number; currency:string; valid_until:string; remark:string; created_at:string; items?:QItem[] }
type Customer = {
  id:number
  customer_name:string
  customer_code:string
  contact?: string
  phone?: string
  address?: string
}
type BOM = { id:number; product_sku:string; product_name:string; spec:string; unit:string; company_price:number; image_url?:string; moq_tiers?: MoqTier[]; color?: string }

const emptyTier = (): MoqTier => ({ moq: 0, price: 0 })
const emptyTiers = (count = 1): MoqTier[] => Array.from({ length: Math.min(5, Math.max(1, count)) }, emptyTier)
const pad2 = (value: number) => String(value).padStart(2, '0')
const formatLocalYmd = (date: Date) => `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
const addMonthsYmd = (dateText: string, months: number) => {
  const normalized = String(dateText || '').trim().replace(/\//g, '-')
  if (!normalized) return ''
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(normalized)
  if (!match) return normalized
  const year = Number(match[1])
  const monthIndex = Number(match[2]) - 1
  const day = Number(match[3])
  const base = new Date(year, monthIndex, day)
  if (Number.isNaN(base.getTime())) return normalized
  const next = new Date(base)
  next.setMonth(next.getMonth() + months)
  return formatLocalYmd(next)
}
const defaultQuotationValidUntil = () => addMonthsYmd(formatLocalYmd(new Date()), 6)
const ensureTierList = (tiers: any): MoqTier[] => {
  const normalized = normalizeMoqTiers(tiers)
  return normalized.length ? normalized.slice(0, 5) : emptyTiers()
}
const emptyItem = (): QItem => ({ bom_id:null, item_name:'', material_code:'', spec:'', unit:'', qty:0, unit_price:0, total_price:0, remark:'', moq_tiers:emptyTiers(), image_url:'' })
const normalizeTiers = (tiers: any): MoqTier[] => {
  return ensureTierList(tiers)
}
const findBomForQuotationItem = (boms: BOM[], item: Partial<QItem> & { material_id?: number | null; material_code?: string | null; item_name?: string | null }) => {
  if (item.bom_id) {
    const matchedByBomId = boms.find(b => b.id === item.bom_id)
    if (matchedByBomId) return matchedByBomId
  }
  if (item.material_code) {
    const normalizedCode = String(item.material_code).trim().toLowerCase()
    const matchedByCode = boms.find(b => String(b.product_sku || '').trim().toLowerCase() === normalizedCode)
    if (matchedByCode) return matchedByCode
  }
  if (item.material_id) {
    const matchedByMaterialId = boms.find(b => (b as any).material_id === item.material_id)
    if (matchedByMaterialId) return matchedByMaterialId
  }
  if (item.item_name) {
    const normalizedName = String(item.item_name).trim().toLowerCase()
    return boms.find(b => String(b.product_name || '').trim().toLowerCase() === normalizedName)
  }
  return undefined
}
const STATUS_MAP: Record<string,{label:string;badge:string}> = {
  draft:          { label:'草稿・待送審', badge:'badge-yellow' },
  pending_review: { label:'審核中', badge:'badge-yellow' },
  approved:       { label:'已審核', badge:'badge-green'  },
  sent:           { label:'已送出', badge:'badge-blue'   },
  accepted:       { label:'已接受', badge:'badge-green'  },
  rejected:       { label:'已拒絕', badge:'badge-red'    },
}

const STATUS_FILTERS = [
  { value: '', label: '全部' },
  { value: 'draft', label: '草稿・待送審' },
  { value: 'pending_review', label: '審核中' },
  { value: 'approved', label: '已審核' },
  { value: 'sent', label: '已送出' },
  { value: 'accepted', label: '已接受' },
  { value: 'rejected', label: '已拒絕' },
] as const

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      className={`w-3.5 h-3.5 transition-transform duration-200 ${open ? 'rotate-90' : ''}`}>
      <polyline points="9 18 15 12 9 6" />
    </svg>
  )
}

function StatusFilterSync({ onChange }: { onChange: (value: string) => void }) {
  const searchParams = useSearchParams()

  useEffect(() => {
    onChange(searchParams.get('status') || '')
  }, [onChange, searchParams])

  return null
}

export default function QuotationsPage() {
  const { toast, confirm: confirmDialog } = useDialog()

  const [items, setItems] = useState<Q[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [boms, setBoms] = useState<BOM[]>([])
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const [loadedItems, setLoadedItems] = useState<Record<number, QItem[]>>({})
  const [creating, setCreating] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState({ customer_id: '', customer_name:'', currency:'VND', valid_until: defaultQuotationValidUntil(), remark:'', items:[emptyItem()] })
  const [loading, setLoading] = useState(true)
  const [mounted, setMounted] = useState(false)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const canWrite = can('customer_order.create')
  const canApprove = can('quotation.approve')
  const canDelete = can('customer_order.delete')

  const loadQuotationItems = async (id: number) => {
    const d = await apiFetch<Q>(`/api/quotations/${id}`)
    const nextItems = d.items || []
    setLoadedItems(p => ({ ...p, [id]: nextItems }))
    return nextItems
  }

  const refreshExpandedRows = async (expandedIds: number[]) => {
    if (!expandedIds.length) {
      setLoadedItems({})
      return
    }
    const nextEntries = await Promise.all(
      expandedIds.map(async (id) => {
        try {
          const d = await apiFetch<Q>(`/api/quotations/${id}`)
          return [id, d.items || []] as const
        } catch {
          return [id, []] as const
        }
      })
    )
    setLoadedItems(Object.fromEntries(nextEntries))
  }

  useEffect(() => { setMounted(true) }, [])

  const load = () => apiFetch<Q[]>('/api/quotations').then(setItems).finally(()=>setLoading(false))
  useEffect(()=>{
    load()
    apiFetch<Customer[]>('/api/customers').then(setCustomers).catch(()=>{})
    apiFetch<BOM[]>('/api/bom').then(setBoms).catch(()=>{})
  },[])

  const resetForm = (opts: { keepCreating?: boolean } = {}) => {
    setForm({ customer_id:'', customer_name:'', currency:'VND', valid_until: defaultQuotationValidUntil(), remark:'', items:[emptyItem()] })
    if (!opts.keepCreating) setCreating(false)
    setEditingId(null)
  }

  const startCreate = () => {
    resetForm({ keepCreating: true })
    setEditingId(null)
    setCreating(true)
  }

  const toggleExpand = async (id: number) => {
    const next = new Set(expanded)
    if (next.has(id)) { next.delete(id) } else {
      next.add(id)
      if (!loadedItems[id]) {
        await loadQuotationItems(id)
      }
    }
    setExpanded(next)
  }

  const changeStatus = async (id:number, status:string, e: React.MouseEvent) => {
    e.stopPropagation()
    if (status === 'pending_review') {
      if (!await confirmDialog('確認送審給主管？', '送審後才會出現在主管的待審核清單；草稿不會通知主管。', '確認送審')) return
    }
    try {
      await apiFetch(`/api/quotations/${id}/status`,{method:'PATCH',body:JSON.stringify({status})})
      toast(status === 'pending_review' ? '已送審，等待主管審核' : '狀態已更新')
      await load()
      await refreshExpandedRows(Array.from(expanded))
    } catch (err: any) {
      toast('操作失敗：' + err.message, 'error')
    }
  }
  const del = async (id:number, e: React.MouseEvent) => {
    e.stopPropagation()
    if (!await confirmDialog('確定刪除？')) return
    try {
      await apiFetch(`/api/quotations/${id}`,{method:'DELETE'})
      toast('已刪除')
      await load()
      setExpanded(prev => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
      setLoadedItems(p => {
        const next = { ...p }
        delete next[id]
        return next
      })
    } catch(e:any){ toast('刪除失敗：'+e.message, 'error') }
  }
  const save = async (submitAfter = false) => {
    if (!form.customer_name) { toast('請選擇客戶', 'error'); return }
    const validItems = form.items.filter(item => item.bom_id)
    if (!validItems.length) { toast('請至少選擇一個 BOM 品項', 'error'); return }
    const itemsToSave = validItems.map(item => {
      const activeTiers = item.moq_tiers.filter(t => t.moq > 0 || t.price > 0)
      const matchedPrice = resolveTierPrice(activeTiers, item.qty || 0, item.unit_price || 0)
      return {
        ...item,
        unit_price: matchedPrice,
        total_price: (item.qty || 0) * matchedPrice,
        moq: activeTiers.length > 0 ? JSON.stringify(activeTiers) : null,
      }
    })
    try {
      let savedId = editingId
      if (editingId) {
        await apiFetch(`/api/quotations/${editingId}`,{method:'PUT',body:JSON.stringify({...form, items: itemsToSave})})
      } else {
        const created = await apiFetch<{ id: number }>('/api/quotations',{method:'POST',body:JSON.stringify({...form, items: itemsToSave})})
        savedId = created.id
      }

      if (submitAfter && savedId) {
        const ok = await confirmDialog(
          '確認送審給主管？',
          '送審後才會出現在主管的待審核清單；草稿不會通知主管。',
          '確認送審',
        )
        if (ok) {
          await apiFetch(`/api/quotations/${savedId}/status`, { method: 'PATCH', body: JSON.stringify({ status: 'pending_review' }) })
          toast('已送審，等待主管審核')
        } else {
          toast('已存成草稿（尚未送審）')
        }
      } else if (editingId) {
        toast('草稿已更新（尚未送審）')
      } else {
        const goSubmit = await confirmDialog(
          '已存成草稿，尚未送審',
          '現在只是草稿，主管看不到。要立刻送審給主管嗎？',
          '立刻送審',
        )
        if (goSubmit && savedId) {
          await apiFetch(`/api/quotations/${savedId}/status`, { method: 'PATCH', body: JSON.stringify({ status: 'pending_review' }) })
          toast('已送審，等待主管審核')
        } else {
          toast('已存成草稿（尚未送審）')
        }
      }

      resetForm()
      await load()
      if (savedId !== null) {
        setExpanded(new Set([savedId]))
        await loadQuotationItems(savedId)
      } else {
        await refreshExpandedRows(Array.from(expanded))
      }
    } catch(e:any){ toast('錯誤：'+e.message, 'error') }
  }

  const startEdit = async (q: Q, e: React.MouseEvent) => {
    e.stopPropagation()
    const data = await apiFetch<Q>(`/api/quotations/${q.id}`)
    const rawCustomerId = q.customer_id ?? (data as any).customer_id
    const cust = rawCustomerId
      ? customers.find(c => String(c.id) === String(rawCustomerId))
      : customers.find(c => c.customer_name === q.customer_name)
    setForm({
      customer_id: cust ? String(cust.id) : (rawCustomerId ? String(rawCustomerId) : ''),
      customer_name: q.customer_name,
      currency: q.currency,
      valid_until: q.valid_until ? String(q.valid_until).slice(0,10) : '',
      remark: q.remark || '',
      items: (data.items || []).map((i: any) => {
        const matchedBom = findBomForQuotationItem(boms, i)
        let moq_tiers = emptyTiers()
        if (i.moq_tiers) {
          moq_tiers = normalizeTiers(i.moq_tiers)
        } else if (i.moq) {
          try {
            const parsed = JSON.parse(String(i.moq))
            if (Array.isArray(parsed)) moq_tiers = normalizeTiers(parsed)
          } catch {}
        }
        return {
          bom_id: matchedBom?.id ?? null,
          material_id: i.material_id ?? null,
          item_name: i.item_name || matchedBom?.product_name || '',
          material_code: i.material_code || matchedBom?.product_sku || '',
          spec: i.spec || matchedBom?.spec || '',
          unit: i.unit || matchedBom?.unit || '',
          qty: Number(i.qty) || 0,
          unit_price: Number(i.unit_price) || 0,
          total_price: Number(i.total_price) || 0,
          remark: i.remark || '',
          moq_tiers,
          image_url: i.image_url || matchedBom?.image_url || '',
        }
      })
    })
    setEditingId(q.id)
    setCreating(false)
    setExpanded(prev => new Set([...Array.from(prev), q.id]))
  }

  const printQuotation = async (id: number, q: Q) => {
    const [data, company] = await Promise.all([
      apiFetch<Q>(`/api/quotations/${id}`),
      getCompany(),
    ])
    const quotation = data as Record<string, unknown>
    const signUrl = quotation.status !== 'draft' ? (getCompanySignatureUrl(company) || '') : ''
    const rawCustomerId = quotation.customer_id ?? q.customer_id
    const customerDetail = rawCustomerId
      ? customers.find(c => String(c.id) === String(rawCustomerId))
      : customers.find(c => c.customer_name === q.customer_name)
    const html = generateQuotationHTML({
      quotation,
      q: q as unknown as Record<string, unknown>,
      company,
      signUrl,
      customerDetail: customerDetail
        ? { address: customerDetail.address, phone: customerDetail.phone, contact: customerDetail.contact }
        : null,
      boms,
    })
    openQuotationPrint(html)
  }
  const addItem = () => setForm(p=>({...p,items:[...p.items,emptyItem()]}))
  const removeItem = (i:number) => setForm(p=>({...p,items:p.items.filter((_,idx)=>idx!==i)}))
  const updateItem = (i:number, f:keyof QItem, v:any) => setForm(p=>({...p,items:p.items.map((item,idx)=>{
    if(idx!==i) return item
    const u={...item,[f]:v}
    if (f === 'qty') {
      u.unit_price = resolveTierPrice(u.moq_tiers, Number(u.qty) || 0, Number(u.unit_price) || 0)
    }
    if(f==='qty'||f==='unit_price') u.total_price=(Number(u.qty)||0)*(Number(u.unit_price)||0)
    return u
  })}))

  const updateTier = (itemIdx:number, tierIdx:number, field:'moq'|'price', val:number) => {
    setForm(p => ({
      ...p,
      items: p.items.map((item, idx) => {
        if (idx !== itemIdx) return item
        const tiers = item.moq_tiers.length ? [...item.moq_tiers] : emptyTiers()
        tiers[tierIdx] = { ...tiers[tierIdx], [field]: val }
        return { ...item, moq_tiers: tiers }
      })
    }))
  }
  const addItemTier = (itemIdx:number) => {
    setForm(p => ({
      ...p,
      items: p.items.map((item, idx) => {
        if (idx !== itemIdx) return item
        if (item.moq_tiers.length >= 5) return item
        return { ...item, moq_tiers: [...(item.moq_tiers.length ? item.moq_tiers : emptyTiers()), emptyTier()] }
      })
    }))
  }
  const removeItemTier = (itemIdx:number, tierIdx:number) => {
    setForm(p => ({
      ...p,
      items: p.items.map((item, idx) => {
        if (idx !== itemIdx) return item
        if (item.moq_tiers.length <= 1) return item
        return { ...item, moq_tiers: item.moq_tiers.filter((_, currentIdx) => currentIdx !== tierIdx) }
      })
    }))
  }
  const onSelectBom = (index: number, bomId: string) => {
    const bom = boms.find(b => String(b.id) === bomId)
    setForm(p => ({
      ...p,
      items: p.items.map((item, i) => {
        if (i !== index) return item
        if (!bom) {
          return { ...item, bom_id: null, material_id: null, material_code: '', item_name: '', spec: '', unit: '', unit_price: 0, image_url: '' }
        }
        const bomTiers = normalizeMoqTiers(bom.moq_tiers)
        const tiers = ensureTierList(bomTiers.length ? bomTiers : item.moq_tiers)
        const matchedPrice = resolveTierPrice(tiers, Number(item.qty) || 0, bom.company_price || 0)
        return {
          ...item,
          bom_id: bom.id,
          material_id: (bom as any).material_id ?? item.material_id ?? null,
          material_code: bom.product_sku,
          item_name: bom.product_name,
          spec: bom.spec || '',
          unit: bom.unit || '',
          unit_price: matchedPrice,
          total_price: (item.qty || 0) * matchedPrice,
          moq_tiers: tiers,
          image_url: bom.image_url || '',
        }
      })
    }))
  }
  const renderTierEditor = (item: QItem, itemIndex: number, inputClass: string) => (
    <div className="w-full">
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className="text-[10px] text-slate-400 leading-none">最多 5 組，至少 1 組</span>
        <button
          type="button"
          className="text-[10px] font-medium text-[#a0541f] transition hover:text-[#7a3d14] disabled:cursor-not-allowed disabled:text-slate-300 leading-none"
          onClick={() => addItemTier(itemIndex)}
          disabled={item.moq_tiers.length >= 5}
        >
          + 新增 MOQ
        </button>
      </div>
      <div className="space-y-1">
        {item.moq_tiers.map((tier, t) => (
          <div key={t} className="flex items-center gap-1.5">
            <span className="text-[10px] text-slate-400 w-5 text-center shrink-0 leading-none">{t + 1}</span>
            <div className="flex-1 flex items-center gap-1.5">
              <DecimalInput
                className={`${inputClass} flex-1 text-xs`}
                digits={0}
                value={tier.moq}
                placeholder="MOQ"
                onValueChange={value => updateTier(itemIndex, t, 'moq', value ?? 0)}
              />
              <DecimalInput
                className={`${inputClass} flex-1 text-xs`}
                value={tier.price}
                placeholder="單價"
                onValueChange={value => updateTier(itemIndex, t, 'price', value ?? 0)}
              />
            </div>
            <button
              type="button"
              className="text-[10px] text-slate-400 transition hover:text-red-600 disabled:cursor-not-allowed disabled:text-slate-300 w-5 shrink-0 leading-none"
              onClick={() => removeItemTier(itemIndex, t)}
              disabled={item.moq_tiers.length <= 1}
              title="刪除"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </div>
  )

  const normalizedSearch = search.trim().toLowerCase()
  const searchedItems = useMemo(() => items.filter((q) => (
    !normalizedSearch ||
    q.quotation_number.toLowerCase().includes(normalizedSearch) ||
    q.customer_name.toLowerCase().includes(normalizedSearch)
  )), [items, normalizedSearch])
  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = { '': searchedItems.length }
    for (const row of searchedItems) {
      counts[row.status] = (counts[row.status] || 0) + 1
    }
    return counts
  }, [searchedItems])
  const filtered = searchedItems.filter((q) => !statusFilter || q.status === statusFilter)
  const statusFilterItems = useMemo(() => STATUS_FILTERS.map((item) => ({
    ...item,
    count: statusCounts[item.value] || 0,
  })), [statusCounts])
  const { page, setPage, totalPages, paged, total: filteredTotal } = usePagination(filtered, 10)
  const inp = 'rubber-input text-xs py-1.5'
  const lockedInp = `${inp} opacity-80 bg-[#f4ede4] cursor-default`

  return (
    <div>
      <Suspense fallback={null}>
        <StatusFilterSync onChange={setStatusFilter} />
      </Suspense>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-[#2d261d]">報價單</h1>
          <p className="mt-1 text-sm text-[#7c6f60]">點選報價單列展開檢視品項明細</p>
        </div>
        {canWrite ? <button onClick={startCreate} className="btn-primary">+ 新增報價單</button> : null}
      </div>

      {mounted && (creating || editingId !== null) && (
        <div className="mb-5 overflow-hidden rounded-3xl border border-[#e1d6c5] bg-white/90 p-0 shadow-sm">
          <div className="border-b border-[#eadfce] bg-white px-6 pt-6 pb-4 shadow-sm">
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <h2 className="text-sm font-semibold text-[#2d261d]">{editingId ? '編輯報價單（草稿）' : '建立報價單草稿'}</h2>
              <p className="mt-1 text-[11px] font-medium text-amber-700">存成草稿後還要按「送審給主管」，主管才會收到待審核。</p>
            </div>
            <button onClick={() => resetForm()} className="rounded-xl border border-[#d8c9b5] px-3 py-2 text-sm text-[#6d5b49] transition hover:bg-[#f8efe5] shrink-0">返回列表</button>
          </div>
          <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
            <div>
              <label className="mb-1.5 block text-[11px] text-[#7d705f]">客戶 *</label>
              <select className={inp} value={form.customer_id} onChange={e => {
                const c = customers.find(c => String(c.id) === e.target.value)
                setForm(p => ({ ...p, customer_id: e.target.value, customer_name: c?.customer_name || '' }))
              }}>
                <option value="">-- 選擇客戶 --</option>
                {customers.map(c => <option key={c.id} value={String(c.id)}>{c.customer_name}{c.customer_code ? ` (${c.customer_code})` : ''}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-[11px] text-[#7d705f]">有效期限</label>
              <input type="date" className={inp} value={form.valid_until} onChange={e=>setForm(p=>({...p,valid_until:e.target.value}))} />
            </div>
            <div>
              <label className="mb-1.5 block text-[11px] text-[#7d705f]">備註</label>
              <input className={inp} value={form.remark} onChange={e=>setForm(p=>({...p,remark:e.target.value}))} />
            </div>
            <div>
              <label className="mb-1.5 block text-[11px] text-[#7d705f]">幣別</label>
              <select className={inp} value={form.currency} onChange={e=>setForm(p=>({...p,currency:e.target.value}))}>
                <option>VND</option><option>TWD</option><option>USD</option>
              </select>
            </div>
          </div>
          <div className="mb-2 flex items-center justify-between gap-3">
            <span className="text-xs font-semibold text-[#6d5b49]">報價明細</span>
            <button onClick={addItem} className="text-sm font-medium text-[#a0541f] transition hover:text-[#7a3d14] shrink-0">+ 新增品項</button>
          </div>
          </div>
          <div className="px-6 py-4">
          <div className="detail-scroll-panel rounded-2xl border border-[#eadfce] bg-white">
            <table className="oms-table w-full text-xs" style={{ minWidth: 1420 }}>
              <colgroup>
                <col style={{ width: '24%' }} />
                <col style={{ width: '14%' }} />
                <col style={{ width: '11%' }} />
                <col style={{ width: '7%' }} />
                <col style={{ width: '32%' }} />
                <col style={{ width: '10%' }} />
                <col style={{ width: '2%' }} />
              </colgroup>
              <thead><tr className="border-b border-[#eadfce] bg-[#fbf6f0]">
                {['選擇BOM','品名','規格','單位','階梯報價（MOQ / 單價）','Remark',''].map(h=>(
                  <th key={h} className="sticky top-0 z-10 bg-[#fbf6f0] px-2 py-2 text-left text-[10px] font-semibold uppercase whitespace-nowrap text-[#7d705f] shadow-sm">{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {form.items.map((item,i)=>(
                  <tr key={i} className="border-b border-[#f0e7da] last:border-0">
                    <td className="p-2 align-top">
                      <select className={`${inp} w-full`} value={item.bom_id ? String(item.bom_id) : ''} onChange={e => onSelectBom(i, e.target.value)}>
                        <option value="">-- 選擇 BOM --</option>
                        {boms.map(b => <option key={b.id} value={String(b.id)}>{b.product_sku} — {b.product_name}</option>)}
                      </select>
                    </td>
                    <td className="p-2 align-top"><input className={`${lockedInp} w-full`} value={item.item_name} readOnly /></td>
                    <td className="p-2 align-top"><input className={`${lockedInp} w-full`} value={item.spec} readOnly /></td>
                    <td className="p-2 align-top"><input className={`${lockedInp} w-full`} value={item.unit || ''} readOnly /></td>
                    <td className="p-2 align-top">{renderTierEditor(item, i, inp)}</td>
                    <td className="p-2 align-top"><input className={`${inp} w-full`} value={item.remark} onChange={e=>updateItem(i,'remark',e.target.value)} /></td>
                    <td className="p-2 align-top text-center"><button onClick={()=>removeItem(i)} className="mt-2 text-slate-300 transition-colors hover:text-red-600">✕</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </div>
          <div className="border-t border-[#eadfce] bg-white px-6 py-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div className="text-xs text-[#7d705f]">目前品項 <span className="font-semibold text-[#2d261d]">{form.items.length}</span></div>
              <div className="flex flex-wrap gap-2">
                <button onClick={() => void save(false)} className="rounded-xl border border-[#d8c9b5] px-3 py-2 text-sm text-[#6d5b49] transition hover:bg-[#f8efe5]">
                  {editingId ? '只儲存草稿' : '存成草稿'}
                </button>
                <button onClick={() => void save(true)} className="btn-primary bg-amber-500 hover:bg-amber-600 border-amber-500">
                  {editingId ? '儲存並送審給主管' : '存成草稿並送審給主管'}
                </button>
                <button onClick={() => resetForm()} className="rounded-xl border border-[#d8c9b5] px-3 py-2 text-sm text-[#6d5b49] transition hover:bg-[#f8efe5]">取消</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {!creating && editingId === null && (
      <>
      <div className="mb-4 space-y-4">
        <input className="rubber-input w-64" placeholder="搜尋報價單號或客戶..." value={search} onChange={e=>setSearch(e.target.value)} />
        <StatusCountChips items={statusFilterItems} value={statusFilter} onChange={setStatusFilter} />
      </div>

      <div className="rounded-3xl border border-[#e1d6c5] bg-white/90 shadow-sm">
        {loading ? <div className="flex justify-center py-16"><div className="h-5 w-5 animate-spin rounded-full border-2 border-[#d8c3ac] border-t-[#9a5d2d]"/></div> : (
          <>
            <div className="overflow-x-auto">
            <table className="w-full text-sm" style={{ minWidth: 980 }}>
              <thead>
                <tr className="border-b border-[#eadfce] bg-[#fbf6f0]">
                  <th className="w-8" />
                  <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-[#7d705f]">報價單號</th>
                  <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-[#7d705f]">客戶</th>
                  <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-wider text-[#7d705f]">金額</th>
                  <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-[#7d705f]">幣別</th>
                  <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-[#7d705f]">有效期</th>
                  <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-[#7d705f]">狀態</th>
                  <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-[#7d705f]">操作</th>
                </tr>
              </thead>
              <tbody>
                {paged.map(q => {
                  const isOpen = expanded.has(q.id)
                  const qItems = loadedItems[q.id] || []
                  const sm = STATUS_MAP[q.status] || { label: q.status, badge: 'badge-gray' }
                  return (
                    <React.Fragment key={q.id}>
                      <tr
                        className={`cursor-pointer border-b border-[#f0e7da] transition-colors ${isOpen ? 'layer-row-open' : 'layer-row-hover'}`}
                        onClick={() => toggleExpand(q.id)}>
                        <td className="pl-4 py-3"><span className="text-[#8f7d67]"><ChevronIcon open={isOpen} /></span></td>
                        <td className="px-4 py-3 font-mono text-xs text-[#8d4a1d]">{q.quotation_number}</td>
                        <td className="px-4 py-3 max-w-[200px] truncate font-medium text-[#2d261d]" title={q.customer_name}>{q.customer_name}</td>
                        <td className="px-4 py-3 text-right font-medium text-[#5f5043]">{formatDecimal(q.total_amount || 0)}</td>
                        <td className="px-4 py-3 text-xs text-[#8f7d67]">{q.currency}</td>
                        <td className="px-4 py-3 text-xs text-[#8f7d67]">{q.valid_until ? String(q.valid_until).slice(0,10) : '—'}</td>
                        <td className="px-4 py-3"><span className={sm.badge}>{sm.label}</span></td>
                        <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                          <div className="flex items-center gap-1">
                            <StatusFlow compact steps={QT_STEPS} current={q.status}
                              actions={getQTActions(q.status).filter(a => {
                                if (a.toStatus === 'approved') return canApprove
                                return canWrite
                              })}
                              onAction={async (toStatus) => {
                                await changeStatus(q.id, toStatus, { stopPropagation: ()=>{} } as any)
                              }} />
                            <button onClick={e=>{ e.stopPropagation(); printQuotation(q.id, q) }} className="btn-ghost ml-1" title="列印">🖨 列印</button>
                            {canWrite && q.status === 'draft' && (
                              <button onClick={e => startEdit(q, e)} className="btn-ghost text-blue-600">✏ 編輯</button>
                            )}
                            {q.status === 'pending_review' && !canApprove && (
                              <span className="text-[11px] font-semibold text-amber-700 bg-amber-50 px-2 py-1 rounded-lg ring-1 ring-amber-200">已送審・等待主管</span>
                            )}
                            {canDelete && <button onClick={e=>del(q.id,e)} className="btn-danger">刪除</button>}
                          </div>
                        </td>
                      </tr>
                      {isOpen && (
                        <tr className="border-b border-[#f0e7da]">
                          <td colSpan={8} className="px-0 py-0">
                            <div className="expand-row-wrap layer-panel-l2">
                              {qItems.length === 0 ? (
                                <div className="expand-row-loading">
                                  <div className="h-3 w-3 animate-spin rounded-full border border-[#d8c3ac] border-t-[#9a5d2d]"/>載入中...
                                </div>
                              ) : (
                                <div className="table-scroll-x">
                                  <table className="w-full text-xs" style={{ minWidth: 980 }}>
                                    <thead><tr className="layer-head-l2">
                                      {['品名','物料編號','規格','單位','MOQ / 單價（阶梯）','備註'].map(h=>(
                                        <th key={h} className="px-3 py-2 text-left text-[10px] font-semibold uppercase whitespace-nowrap text-[#7d705f]">{h}</th>
                                      ))}
                                    </tr></thead>
                                    <tbody>
                                      {qItems.map((item: any, i: number) => {
                                        let tiers: {moq:number;price:number}[] = []
                                        if (item.moq_tiers && Array.isArray(item.moq_tiers)) {
                                          tiers = item.moq_tiers.filter((t: any) => t.moq > 0 || t.price > 0)
                                        } else if (item.moq) {
                                          try {
                                            const parsed = JSON.parse(String(item.moq))
                                            if (Array.isArray(parsed)) tiers = parsed.filter((t: any) => t.moq > 0 || t.price > 0)
                                          } catch { tiers = [{moq: Number(item.moq)||0, price: Number(item.unit_price)||0}] }
                                        }
                                        if (tiers.length === 0 && item.unit_price) tiers = [{moq:0, price: Number(item.unit_price)}]
                                        return (
                                          <tr key={i} className="border-b border-[#f3eadf] last:border-0 hover:bg-[#fdf7ef]">
                                            <td className="px-3 py-2 text-[#5f5043]">{item.item_name}</td>
                                            <td className="px-3 py-2 font-mono text-[#8d4a1d] whitespace-nowrap">{item.material_code}</td>
                                            <td className="px-3 py-2 text-[#8f7d67]">{item.spec}</td>
                                            <td className="px-3 py-2 text-[#6d5b49] whitespace-nowrap">{item.unit}</td>
                                            <td className="px-3 py-2">
                                              <div className="flex flex-wrap gap-2">
                                                {tiers.map((t, ti) => (
                                                  <span key={ti} className="inline-flex items-center gap-1 rounded border border-[#eadfce] bg-[#fff] px-2 py-0.5 text-[10px]">
                                                    <span className="font-semibold text-[#8d4a1d]">
                                                      {(t.moq > 0 ? formatInteger(t.moq) : '—') + ':' + (t.price > 0 ? formatDecimal(t.price) : '—')}
                                                    </span>
                                                  </span>
                                                ))}
                                              </div>
                                            </td>
                                            <td className="px-3 py-2 text-[#8f7d67]">{item.remark}</td>
                                          </tr>
                                        )
                                      })}
                                    </tbody>
                                  </table>
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  )
                })}
                {paged.length===0 && <tr><td colSpan={8} className="px-4 py-12 text-center text-[#9f917e]">尚無報價單</td></tr>}
              </tbody>
            </table>
            </div>
            <Pagination page={page} totalPages={totalPages} setPage={setPage} total={filteredTotal} />
          </>
        )}
      </div>
      </>
      )}
    </div>
  )
}
