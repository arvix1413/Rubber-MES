'use client'
import React from 'react'
import DecimalInput from '@/components/DecimalInput'
import { useDialog } from '@/components/Dialog'
import { useEffect, useState } from 'react'
import { apiFetch, getSignatureUrl } from '@/lib/api'
import { formatDecimal, formatInteger } from '@/lib/numberFormat'
import { usePagination, Pagination } from '@/lib/usePagination'
import { getCompany } from '@/lib/useCompany'
import { normalizeMoqTiers, resolveTierPrice } from '@/lib/moqPricing'
import { SHARED_PRINT_ITEM_TABLE_CSS } from '@/lib/printItemTableStyles'
import { SHARED_PRINT_PARTY_TABLE_CSS } from '@/lib/printPartyTableStyles'

type MoqTier = { moq: number; price: number }
type QItem = { bom_id?:number|null; item_name:string; material_code:string; spec:string; unit:string; qty:number; unit_price:number; total_price:number; remark:string; moq_tiers:MoqTier[]; image_url?:string }
type Q = { id:number; quotation_number:string; customer_name:string; customer_id?:number; status:string; total_amount:number; currency:string; valid_until:string; remark:string; created_at:string; items?:QItem[] }
type Customer = {
  id:number
  customer_name:string
  customer_code:string
  contact?: string
  phone?: string
  address?: string
}
type BOM = { id:number; product_sku:string; product_name:string; spec:string; unit:string; company_price:number; image_url?:string; moq_tiers?: MoqTier[] }

const emptyTiers = (): MoqTier[] => Array.from({length:5}, () => ({ moq: 0, price: 0 }))
const emptyItem = (): QItem => ({ bom_id:null, item_name:'', material_code:'', spec:'', unit:'', qty:0, unit_price:0, total_price:0, remark:'', moq_tiers:emptyTiers(), image_url:'' })
const normalizeTiers = (tiers: any): MoqTier[] => {
  const src = Array.isArray(tiers) ? tiers : []
  return Array.from({ length: 5 }, (_, i) => {
    const t = src[i] || {}
    return {
      moq: Number(t.moq) || 0,
      price: Number(t.price) || 0,
    }
  })
}
const STATUS_MAP: Record<string,{label:string;badge:string}> = {
  draft:    { label:'草稿',   badge:'badge-gray'  },
  sent:     { label:'已送出', badge:'badge-blue'  },
  accepted: { label:'已接受', badge:'badge-green' },
  rejected: { label:'已拒絕', badge:'badge-red'   },
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      className={`w-3.5 h-3.5 transition-transform duration-200 ${open ? 'rotate-90' : ''}`}>
      <polyline points="9 18 15 12 9 6" />
    </svg>
  )
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
  const [form, setForm] = useState({ customer_id: '', customer_name:'', currency:'VND', valid_until:'', remark:'', items:[emptyItem()] })
  const [loading, setLoading] = useState(true)
  const [mounted, setMounted] = useState(false)
  const [search, setSearch] = useState('')

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
    setForm({ customer_id:'', customer_name:'', currency:'VND', valid_until:'', remark:'', items:[emptyItem()] })
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
    await apiFetch(`/api/quotations/${id}/status`,{method:'PATCH',body:JSON.stringify({status})})
    toast('狀態已更新')
    await load()
    await refreshExpandedRows(Array.from(expanded))
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
  const save = async () => {
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
      const savedId = editingId
      if (editingId) {
        await apiFetch(`/api/quotations/${editingId}`,{method:'PUT',body:JSON.stringify({...form, items: itemsToSave})})
        toast('報價單已更新')
      } else {
        await apiFetch('/api/quotations',{method:'POST',body:JSON.stringify({...form, items: itemsToSave})})
        toast('報價單建立成功')
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
        const matchedBom = boms.find(b => b.product_sku === i.material_code)
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
          bom_id: i.bom_id ?? matchedBom?.id ?? null,
          item_name: i.item_name || '',
          material_code: i.material_code || '',
          spec: i.spec || '',
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
    const txt = (v: any) => {
      if (v === null || v === undefined) return ''
      const s = String(v).trim()
      if (!s || s === 'null' || s === 'undefined' || s === '—' || s === '-') return ''
      return s
    }
    const num = (v: any) => {
      const n = Number(v)
      return Number.isFinite(n) ? n : 0
    }
    const fmt = (v: any) => formatDecimal(num(v))

    const [data, company] = await Promise.all([
      apiFetch<Q>(`/api/quotations/${id}`),
      getCompany(),
    ])
    const quotation = data as any
    const items = data.items || []
    const signUrl = getSignatureUrl()
    const apiBase = process.env.NEXT_PUBLIC_API_URL || (typeof window !== 'undefined' ? window.location.origin : 'http://43.160.199.226')
    const logoUrl = company.logo_url ? (company.logo_url.startsWith('http') ? company.logo_url : `${apiBase}${company.logo_url}`) : null
    const rawCustomerId = quotation.customer_id ?? q.customer_id
    const customerDetail = rawCustomerId
      ? customers.find(c => String(c.id) === String(rawCustomerId))
      : customers.find(c => c.customer_name === q.customer_name)
    const customerAddress = txt(customerDetail?.address)
    const customerPhone = txt(customerDetail?.phone)
    const customerContact = txt(customerDetail?.contact)

    const itemRows = items.map((item: any, idx: number) => {
      const imgUrl = item.image_url
        ? (item.image_url.startsWith('http') ? item.image_url : `${apiBase}${item.image_url}`)
        : ''
      let tiers: {moq:number;price:number}[] = []
      if (item.moq_tiers && Array.isArray(item.moq_tiers)) {
        tiers = item.moq_tiers.filter((t: any) => t.moq > 0 || t.price > 0)
      } else if (item.moq) {
        try {
          const parsed = JSON.parse(String(item.moq))
          if (Array.isArray(parsed)) tiers = parsed.filter((t: any) => t.moq > 0 || t.price > 0)
        } catch { if (item.moq) tiers = [{moq: Number(item.moq)||0, price: Number(item.unit_price)||0}] }
      }
      if (tiers.length === 0 && num(item.unit_price) > 0) tiers = [{moq:0, price: num(item.unit_price)}]

      const moqCell = tiers.map(t => `<div style="line-height:1.6;white-space:nowrap">${t.moq > 0 ? fmt(t.moq) : ''}</div>`).join('')
      const priceCell = tiers.map(t => `<div style="line-height:1.6;white-space:nowrap">${t.price > 0 ? fmt(t.price) : ''}</div>`).join('')

      return `
      <tr>
        <td class="col-st" style="text-align:center;font-size:11px">${idx+1}</td>
        <td style="font-size:11px">${txt(item.item_name)}</td>
        <td class="col-code" style="text-align:center;font-size:11px">${txt(item.material_code)}</td>
        <td class="col-spec" style="font-size:11px">${txt(item.spec)}</td>
        <td class="col-unit" style="text-align:center;font-size:11px">${txt(item.unit) || 'PCS'}</td>
        <td class="col-moq" style="text-align:center;font-size:11px">${moqCell}</td>
        <td class="col-price" style="text-align:center;font-size:11px">${priceCell}</td>
        <td class="col-image" style="text-align:center;padding:2px">
          ${imgUrl ? `<img src="${imgUrl}" style="max-width:60px;max-height:50px;object-fit:contain" onerror="this.style.display='none'"/>` : ''}
        </td>
        <td class="col-remark" style="text-align:center;font-size:10px;color:#555">${txt(item.remark)}</td>
      </tr>`
    }).join('')

    const html = `<!DOCTYPE html><html lang="zh-TW"><head><meta charset="utf-8"/>
    <title>報價單 ${txt(quotation.quotation_number || q.quotation_number)}</title>
    <style>
      *{box-sizing:border-box;margin:0;padding:0}
      body{font-family:"Microsoft JhengHei","PingFang TC",Arial,sans-serif;font-size:11px;font-weight:400;color:#000;background:#fff}
      .page{padding:8mm 6mm;max-width:210mm;margin:0 auto}
      .header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #000;padding-bottom:5mm;margin-bottom:5mm}
      .company{font-size:18px;font-weight:700;letter-spacing:1px;text-transform:uppercase}
      .subtitle{font-size:10px;color:#666;margin-top:3px}
      .doc-title{font-size:22px;font-weight:700;color:#1a56db;text-align:right}
      .doc-sub{font-size:10px;color:#666;text-align:right;margin-top:2px}
      .doc-no{font-size:12px;font-weight:600;text-align:right;margin-top:3px}
      ${SHARED_PRINT_PARTY_TABLE_CSS}
      .info-table{width:100%;border-collapse:collapse;margin-bottom:5mm}
      .info-table td{border:1px solid #bbb;padding:5px 8px;font-size:11px;font-weight:400;vertical-align:middle;text-align:center}
      .info-table .lbl{font-weight:600;background:#f5f5f5;white-space:nowrap;width:120px;color:#333}
      ${SHARED_PRINT_ITEM_TABLE_CSS}
      .note-box{border:1px solid #bbb;padding:6px 10px;margin-bottom:5mm;font-size:10px;line-height:1.6}
      .note-title{font-weight:600;margin-bottom:4px}
      .sign-row{display:grid;grid-template-columns:1fr 1fr;gap:8mm;margin-top:8mm}
      .sign-box{border:1px solid #bbb;padding:8px 10px;text-align:center;display:flex;flex-direction:column}
      .sign-label{font-weight:600;font-size:10px;color:#333;padding-bottom:4px;border-bottom:1px solid #eee}
      .sign-area{flex:1;min-height:50px;display:flex;align-items:center;justify-content:center}
      .sign-line{border-top:1px solid #555;padding-top:4px;font-size:10px;font-weight:400;color:#333;margin-top:4px}
      @media print{body{-webkit-print-color-adjust:exact}@page{size:A4;margin:0}}
    </style></head><body>
    <div class="page">
      <div class="header">
        <div>
          ${logoUrl ? `<img src="${logoUrl}" style="max-height:40px;max-width:160px;object-fit:contain;margin-bottom:4px" onerror="this.style.display='none'"/><br/>` : ''}
          <div class="company">${txt(company.company_name)}</div>
          <div class="subtitle">${txt(company.company_name_local)}</div>
        </div>
        <div>
          <div class="doc-title">報價單</div>
          <div class="doc-sub">QUOTATION / BẢNG BÁO GIÁ</div>
          <div class="doc-no">No. ${txt(quotation.quotation_number || q.quotation_number)}</div>
        </div>
      </div>

      <table class="party-table">
        <tr>
          <td class="section" colspan="4">本公司 / Company Name</td>
          <td class="section" colspan="4">客戶公司 / Customer Name</td>
        </tr>
        <tr>
          <td class="label">公司名</td>
          <td class="value" colspan="3">${txt(company.company_name)}</td>
          <td class="label">公司名</td>
          <td class="value" colspan="3">${txt(q.customer_name)}</td>
        </tr>
        <tr>
          <td class="label">地址</td>
          <td class="value" colspan="3">${txt(company.address)}</td>
          <td class="label">地址</td>
          <td class="value" colspan="3">${customerAddress}</td>
        </tr>
        <tr>
          <td class="label">電話</td>
          <td class="value" colspan="3">${txt(company.phone)}</td>
          <td class="label">電話</td>
          <td class="value" colspan="3">${customerPhone}</td>
        </tr>
        <tr>
          <td class="label">聯絡人</td>
          <td class="value" colspan="3">${txt(company.contact_person)}</td>
          <td class="label">聯絡人</td>
          <td class="value" colspan="3">${customerContact}</td>
        </tr>
      </table>

      <table class="info-table">
        <tr>
          <td class="lbl">客戶<br/>Khách hàng</td>
          <td style="font-weight:600;font-size:12px" colspan="3">${txt(q.customer_name)}</td>
          <td class="lbl">報價日<br/>Date issue</td>
          <td>${String(q.created_at || '').slice(0,10) || ''}</td>
        </tr>
        <tr>
          <td class="lbl">聯絡人<br/>Contact</td>
          <td>${txt(company.contact_person)}</td>
          <td class="lbl">有效期<br/>Valid until</td>
          <td>${q.valid_until ? String(q.valid_until).slice(0,10) : ''}</td>
          <td class="lbl">幣別<br/>Currency</td>
          <td>${txt(q.currency) || 'VND'}</td>
        </tr>
        <tr>
          <td class="lbl">地址<br/>Address</td>
          <td colspan="5">${txt(company.address)}</td>
        </tr>
      </table>

      <table class="items">
        <thead><tr>
          <th class="col-st">ST</th>
          <th class="col-name">品名 / Products</th>
          <th class="col-code">物料編號</th>
          <th class="col-spec">規格</th>
          <th class="col-unit">單位</th>
          <th class="col-moq">MOQ</th>
          <th class="col-price">單價</th>
          <th class="col-image">圖片</th>
          <th style="width:1%">備註</th>
        </tr></thead>
        <tbody>${itemRows}</tbody>
      </table>

      <div class="note-box">
        <div class="note-title">備註 / Ghi chú：</div>
        <div style="white-space:pre-line">${txt(q.remark) || '1. 交易方式：現金轉款\n2. 樣品日期：8-10天\n3. 以上單價不包含8%VAT\n4. 交貨方式：越南當地門到門\n5. 如有問題根據樣品報價單\n6. 三天內確認打樣費用，請簽回並確認\n7. 收到量產訂單出貨後，打樣費將在8天內退還'}</div>
      </div>

      <div class="sign-row">
        <div class="sign-box">
          <div class="sign-label">FAN YONG 確認 / Xác nhận</div>
          <div class="sign-area">
            ${signUrl ? `<img src="${signUrl}" style="max-height:44px;max-width:150px;object-fit:contain"/>` : ''}
          </div>
          <div class="sign-line">${txt(company.company_name)}</div>
        </div>
        <div class="sign-box">
          <div class="sign-label">客戶確認 / Khách hàng xác nhận</div>
          <div class="sign-area"></div>
          <div class="sign-line">${txt(q.customer_name)}</div>
        </div>
      </div>
    </div>
    </body></html>`
    const w = window.open('','_blank','width=900,height=1200')
    if (w) { w.document.write(html); w.document.close(); setTimeout(()=>w.print(),600) }
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
        const tiers = [...item.moq_tiers]
        tiers[tierIdx] = { ...tiers[tierIdx], [field]: val }
        return { ...item, moq_tiers: tiers }
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
          return { ...item, bom_id: null, material_code: '', item_name: '', spec: '', unit: '', unit_price: 0, image_url: '' }
        }
        const bomTiers = normalizeMoqTiers(bom.moq_tiers)
        const tiers = normalizeTiers(bomTiers.length ? bomTiers : item.moq_tiers)
        const matchedPrice = resolveTierPrice(tiers, Number(item.qty) || 0, bom.company_price || 0)
        return {
          ...item,
          bom_id: bom.id,
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
    <div className="min-w-[260px] space-y-1">
      {item.moq_tiers.map((tier, t) => (
        <div key={t} className="grid grid-cols-[26px_1fr_1fr] gap-1 items-center">
          <span className="text-[10px] text-slate-400 text-center">#{t + 1}</span>
          <DecimalInput
            className={inputClass}
            digits={0}
            value={tier.moq}
            placeholder="MOQ"
            onValueChange={value => updateTier(itemIndex, t, 'moq', value ?? 0)}
          />
          <DecimalInput
            className={inputClass}
            value={tier.price}
            placeholder="單價"
            onValueChange={value => updateTier(itemIndex, t, 'price', value ?? 0)}
          />
        </div>
      ))}
    </div>
  )

  const filtered = items.filter(q => !search || q.quotation_number.toLowerCase().includes(search.toLowerCase()) || q.customer_name.toLowerCase().includes(search.toLowerCase()))
  const { page, setPage, totalPages, paged, total: filteredTotal } = usePagination(filtered, 10)
  const inp = 'rubber-input text-xs py-1.5'
  const lockedInp = `${inp} opacity-80 bg-[#f4ede4] cursor-default`

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-[#2d261d]">報價單</h1>
          <p className="mt-1 text-sm text-[#7c6f60]">點選報價單列展開檢視品項明細</p>
        </div>
        <button onClick={startCreate} className="btn-primary">+ 新增報價單</button>
      </div>

      {mounted && (creating || editingId !== null) && (
        <div className="rounded-3xl border border-[#e1d6c5] bg-white/90 p-6 shadow-sm mb-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-[#2d261d]">{editingId ? '編輯報價單' : '新增報價單'}</h2>
            <button onClick={() => resetForm()} className="rounded-xl border border-[#d8c9b5] px-3 py-2 text-sm text-[#6d5b49] transition hover:bg-[#f8efe5]">返回列表</button>
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
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-semibold text-[#6d5b49]">報價明細</span>
            <button onClick={addItem} className="text-sm font-medium text-[#a0541f] transition hover:text-[#7a3d14]">+ 新增品項</button>
          </div>
          <div className="overflow-x-auto rounded-2xl border border-[#eadfce]">
            <table className="w-full text-xs" style={{ minWidth: 1320 }}>
              <thead><tr className="border-b border-[#eadfce] bg-[#fbf6f0]">
                {['選擇BOM','品名','規格','單位','階梯報價（MOQ / 單價）','Remark',''].map(h=>(
                  <th key={h} className="px-1.5 py-2 text-left text-[10px] font-semibold uppercase whitespace-nowrap text-[#7d705f]">{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {form.items.map((item,i)=>(
                  <tr key={i} className="border-b border-[#f0e7da] last:border-0">
                    <td className="p-1 min-w-[260px]">
                      <select className={inp} value={item.bom_id ? String(item.bom_id) : ''} onChange={e => onSelectBom(i, e.target.value)}>
                        <option value="">-- 選擇 BOM --</option>
                        {boms.map(b => <option key={b.id} value={String(b.id)}>{b.product_sku} — {b.product_name}</option>)}
                      </select>
                    </td>
                    <td className="p-1"><input className={lockedInp} style={{width:180}} value={item.item_name} readOnly /></td>
                    <td className="p-1"><input className={lockedInp} style={{width:120}} value={item.spec} readOnly /></td>
                    <td className="p-1"><input className={lockedInp} style={{width:70}} value={item.unit || ''} readOnly /></td>
                    <td className="p-1 align-top">{renderTierEditor(item, i, inp)}</td>
                    <td className="p-1"><input className={inp} style={{width:180}} value={item.remark} onChange={e=>updateItem(i,'remark',e.target.value)} /></td>
                    <td className="p-1 text-center"><button onClick={()=>removeItem(i)} className="text-slate-300 hover:text-red-600 transition-colors">✕</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-4 flex gap-2">
            <button onClick={save} className="btn-primary">{editingId ? '儲存修改' : '建立報價單'}</button>
            <button onClick={() => resetForm()} className="rounded-xl border border-[#d8c9b5] px-3 py-2 text-sm text-[#6d5b49] transition hover:bg-[#f8efe5]">取消</button>
          </div>
        </div>
      )}

      {!creating && editingId === null && (
      <>
      <div className="mb-4"><input className="rubber-input w-64" placeholder="搜尋報價單號或客戶..." value={search} onChange={e=>setSearch(e.target.value)} /></div>

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
                        className={`cursor-pointer border-b border-[#f0e7da] transition-colors ${isOpen ? 'bg-[#faf2e7]' : 'hover:bg-[#fcf7f1]'}`}
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
                            <button onClick={e=>{ e.stopPropagation(); printQuotation(q.id, q) }} className="rounded-lg px-2 py-1 text-xs text-[#7f5b36] transition hover:bg-[#f3e6d7]" title="列印">🖨 列印</button>
                            {q.status==='draft' && <button onClick={e=>startEdit(q,e)} className="rounded-lg px-2 py-1 text-xs text-[#8d4a1d] transition hover:bg-[#f3e6d7]">✏ 編輯</button>}
                            {q.status==='draft' && <button onClick={e=>changeStatus(q.id,'sent',e)} className="rounded-lg px-2 py-1 text-xs text-[#6d5b49] transition hover:bg-[#f3e6d7]">送出</button>}
                            {q.status==='sent' && <button onClick={e=>changeStatus(q.id,'accepted',e)} className="rounded-lg px-2 py-1 text-xs text-emerald-700 transition hover:bg-emerald-50">接受</button>}
                            {q.status==='sent' && <button onClick={e=>changeStatus(q.id,'rejected',e)} className="rounded-lg px-2 py-1 text-xs text-red-700 transition hover:bg-red-50">拒絕</button>}
                            <button onClick={e=>del(q.id,e)} className="rounded-lg px-2 py-1 text-xs text-red-700 transition hover:bg-red-50">刪除</button>
                          </div>
                        </td>
                      </tr>
                      {isOpen && (
                        <tr className="border-b border-[#f0e7da]">
                          <td colSpan={8} className="px-0 py-0">
                            <div className="bg-[#fffaf4] px-4 py-3">
                              {qItems.length === 0 ? (
                                <div className="flex items-center gap-2 text-sm text-[#7d705f]">
                                  <div className="h-3 w-3 animate-spin rounded-full border border-[#d8c3ac] border-t-[#9a5d2d]"/>載入中...
                                </div>
                              ) : (
                                <div className="overflow-x-auto">
                                  <table className="w-full text-xs" style={{minWidth:600}}>
                                    <thead><tr className="border-b border-[#eadfce]">
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
                                                    <span className="text-[#7d705f]">{t.moq > 0 ? formatInteger(t.moq) : '—'}</span>
                                                    <span className="text-[#c4b39f]">→</span>
                                                    <span className="font-semibold text-[#8d4a1d]">{t.price > 0 ? formatDecimal(t.price) : '—'}</span>
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
