'use client'
import { useDialog } from '@/components/Dialog'
import { useEffect, useState } from 'react'
import { apiFetch, getSignatureUrl } from '@/lib/api'
import { usePagination, Pagination } from '@/lib/usePagination'
import { StatusFlow, PO_STEPS, getPOActions } from '@/components/StatusFlow'
import { SearchableSelect } from '@/components/SearchableSelect'
import { can } from '@/lib/usePermissions'
import { getCompany } from '@/lib/useCompany'
import { resolveTierPrice, type MoqTier } from '@/lib/moqPricing'

type PoItem = { material_code:string; material_name:string; spec:string; unit:string; quantity:number; unit_price:number; total_price:number; currency:string; remark:string; po_ref:string; thickness?:number|string; image_url?:string; bom_id?:number }
type Po = { id:number; po_number:string; supplier_name:string; status:string; total_amount:number; tax_rate?:number; currency:string; remark:string; created_at:string; approved_at?:string; items?:PoItem[] }
type Supplier = { id: number; name: string; currency: string; supplier_code: string }
type BOM = { id: number; product_sku: string; product_name: string; spec: string; unit: string; supplier_price: number; company_price: number; currency: string; image_url?: string; material_name?: string; supplier_id?: number; moq_tiers?: MoqTier[] }

const STATUS_MAP: Record<string,{label:string;badge:string}> = {
  draft:     { label:'草稿',   badge:'badge-gray'   },
  approved:  { label:'已核准', badge:'badge-green'  },
  sent:      { label:'已送出', badge:'badge-blue'   },
  received:  { label:'已收貨', badge:'badge-purple' },
  cancelled: { label:'已取消', badge:'badge-red'    },
}

const emptyItem = (): PoItem => ({ material_code:'', material_name:'', spec:'', unit:'', quantity:1, unit_price:0, total_price:0, currency:'VND', remark:'', po_ref:'' })

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      className={`w-3.5 h-3.5 transition-transform duration-200 ${open ? 'rotate-90' : ''}`}>
      <polyline points="9 18 15 12 9 6" />
    </svg>
  )
}

export default function PoPage() {
  const { toast, confirm: confirmDialog } = useDialog()

  const [pos, setPos] = useState<Po[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [boms, setBoms] = useState<BOM[]>([])
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const [loadedItems, setLoadedItems] = useState<Record<number, PoItem[]>>({})
  const [creating, setCreating] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState({ supplier_id: '', supplier_name:'', currency:'VND', tax_rate: 8, remark:'', items:[emptyItem()] })
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const canWrite = can('po.create')
  const canApprove = can('po.approve')
  const canDel = can('po.delete')

  const load = () => apiFetch<Po[]>('/api/po').then(setPos).finally(() => setLoading(false))
  useEffect(() => {
    load()
    apiFetch<Supplier[]>('/api/suppliers').then(setSuppliers).catch(() => {})
    apiFetch<BOM[]>('/api/bom').then(setBoms).catch(() => {})
  }, [])

  const onSelectSupplier = async (supplierId: string) => {
    const sup = suppliers.find(s => String(s.id) === supplierId)
    setForm(p => ({ ...p, supplier_id: supplierId, supplier_name: sup?.name || '', currency: sup?.currency || 'VND', items: [emptyItem()] }))
  }

  // Get filtered BOMs based on selected supplier
  const getFilteredBoms = () => {
    if (!form.supplier_id) return boms
    return boms.filter(b => !b.supplier_id || String(b.supplier_id) === form.supplier_id)
  }

  const selectBOM = (i: number, bomId: string) => {
    const bom = getFilteredBoms().find(b => String(b.id) === bomId)
    if (!bom) {
      setForm(p => ({
        ...p,
        items: p.items.map((item, idx) => idx !== i ? item : {
          ...item,
          bom_id: undefined,
          material_code: '',
          material_name: '',
          spec: '',
          unit: '',
          unit_price: 0,
          image_url: '',
          total_price: 0,
        })
      }))
      return
    }
    
    setForm(p => ({
      ...p,
      items: p.items.map((item, idx) => idx !== i ? item : {
        ...(item || {}),
        ...item,
        bom_id: Number(bomId),
        material_code: bom.product_sku,
        material_name: bom.product_name,
        spec: bom.spec || '',
        unit: bom.unit || 'PCS',
        unit_price: resolveTierPrice(bom.moq_tiers, item.quantity || 0, bom.supplier_price || 0),
        currency: bom.currency || form.currency,
        image_url: bom.image_url || '',
        total_price: (item.quantity || 0) * resolveTierPrice(bom.moq_tiers, item.quantity || 0, bom.supplier_price || 0),
      })
    }))
  }

  const toggleExpand = async (id: number) => {
    const next = new Set(expanded)
    if (next.has(id)) {
      next.delete(id)
      setExpanded(next)
    } else {
      next.add(id)
      setExpanded(next)
      if (!loadedItems[id]) {
        const data = await apiFetch<Po>(`/api/po/${id}`)
        setLoadedItems(p => ({ ...p, [id]: data.items || [] }))
      }
    }
  }

  const approve = async (id: number, e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      await apiFetch(`/api/po/${id}/approve`, { method: 'PATCH' })
      toast('已核准')
      setLoadedItems(p => { const n = { ...p }; delete n[id]; return n })
      load()
    } catch (e: any) { toast('核准失敗：' + e.message, 'error') }
  }

  const confirmReceipt = async (po: Po, e: React.MouseEvent) => {
    e.stopPropagation()
    if (!await confirmDialog('確認收貨？', '確認後將更新材料庫存，此操作不可撤銷', '確認收貨')) return
    try {
      await apiFetch(`/api/po/${po.id}/receive`, { method: 'PATCH' })
      toast('收貨完成，庫存已更新')
      setLoadedItems(p => { const n = { ...p }; delete n[po.id]; return n })
      load()
    } catch (e: any) { toast('收貨失敗：' + e.message, 'error') }
  }

  const changeStatus = async (id: number, status: string, e: React.MouseEvent) => {
    e.stopPropagation()
    const labels: Record<string, string> = { sent: '確認送出此採購單？' }
    const btnLabels: Record<string, string> = { sent: '確認送出' }
    if (!await confirmDialog(labels[status] || '確認變更狀態？', '', btnLabels[status] || '確認')) return
    try {
      await apiFetch(`/api/po/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) })
      toast('狀態已更新')
      await load()
      if (expanded.has(id)) {
        const data = await apiFetch<Po>(`/api/po/${id}`)
        setLoadedItems(p => ({ ...p, [id]: data.items || [] }))
      }
    } catch (e: any) { toast('操作失敗：' + e.message, 'error') }
  }

  const del = async (id: number, e: React.MouseEvent) => {
    e.stopPropagation()
    if (!await confirmDialog('確定刪除此採購單？')) return
    try {
      await apiFetch(`/api/po/${id}`, { method: 'DELETE' })
      await load()
    } catch (e: any) { toast('刪除失敗：' + e.message, 'error') }
  }

  const addItem = () => setForm(p => ({ ...p, items: [...p.items, emptyItem()] }))
  const removeItem = (i: number) => setForm(p => ({ ...p, items: p.items.filter((_, idx) => idx !== i) }))
  const updateItem = (i: number, field: keyof PoItem, val: any) => {
    setForm(p => ({
      ...p,
      items: p.items.map((item, idx) => {
        if (idx !== i) return item
        const u = { ...item, [field]: val }
        if (field === 'quantity' && u.bom_id) {
          const bom = boms.find((b) => b.id === u.bom_id)
          if (bom) u.unit_price = resolveTierPrice(bom.moq_tiers, Number(u.quantity) || 0, bom.supplier_price || 0)
        }
        if (field === 'quantity' || field === 'unit_price') u.total_price = (Number(u.quantity) || 0) * (Number(u.unit_price) || 0)
        return u
      })
    }))
  }

  const save = async () => {
    if (!form.supplier_id) { toast('請選擇供應商', 'error'); return }
    const validItems = form.items.filter(i => i.bom_id)
    if (!validItems.length) { toast('請至少選擇一個 BOM 品項', 'error'); return }
    try {
      if (editingId) {
        await apiFetch(`/api/po/${editingId}`, { method: 'PUT', body: JSON.stringify({ ...form, items: validItems }) })
        toast('採購單已更新')
        setEditingId(null)
      } else {
        await apiFetch('/api/po', { method: 'POST', body: JSON.stringify({ ...form, items: validItems }) })
        toast('採購單建立成功')
        setCreating(false)
      }
      setForm({ supplier_id: '', supplier_name:'', currency:'VND', tax_rate: 8, remark:'', items:[emptyItem()] })
      await load()
    } catch (e: any) { toast('錯誤：' + e.message, 'error') }
  }

  const startEdit = async (po: Po, e: React.MouseEvent) => {
    e.stopPropagation()
    const data = await apiFetch<Po>(`/api/po/${po.id}`)
    const rawSupplierId = (po as any).supplier_id ?? (data as any).supplier_id
    const sup = rawSupplierId
      ? suppliers.find(s => String(s.id) === String(rawSupplierId))
      : suppliers.find(s => s.name === po.supplier_name)
    setForm({
      supplier_id: sup ? String(sup.id) : (rawSupplierId ? String(rawSupplierId) : ''),
      supplier_name: po.supplier_name,
      currency: po.currency,
      tax_rate: Math.min(25, Math.max(1, Number((data as any).tax_rate ?? (po as any).tax_rate ?? 8))),
      remark: po.remark || '',
      items: (data.items || []).map(i => {
        // Match BOM by product_sku = material_code
        const matchedBom = boms.find(b => b.product_sku === i.material_code)
        return {
          material_code: i.material_code,
          material_name: i.material_name,
          spec: i.spec,
          unit: i.unit,
          quantity: Number(i.quantity),
          unit_price: Number(i.unit_price),
          total_price: Number(i.total_price),
          currency: i.currency,
          remark: i.remark,
          po_ref: i.po_ref,
          image_url: i.image_url || matchedBom?.image_url || '',
          bom_id: matchedBom ? matchedBom.id : undefined,
        }
      })
    })
    setEditingId(po.id)
    setCreating(false)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const printPo = async (id: number, poNumber: string, supplierName: string) => {
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
    const fmt = (v: any) => num(v).toLocaleString()

    const [data, company] = await Promise.all([
      apiFetch<Po>(`/api/po/${id}`),
      getCompany(),
    ])
    const items = data.items || []
    const subTotal = items.reduce((s, i) => s + num(i.total_price), 0)
    const taxRate = Math.min(25, Math.max(1, Number((data as any).tax_rate || 8)))
    const total = Math.round(subTotal * (1 + taxRate / 100) * 100) / 100
    const currency = txt(items[0]?.currency) || txt(data.currency) || 'VND'
    const signatureUrl = getSignatureUrl()
    const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://43.133.56.234'
    const logoUrl = company.logo_url ? (company.logo_url.startsWith('http') ? company.logo_url : `${API_BASE}${company.logo_url}`) : null

    const itemRows = items.map((item, idx) => `
      <tr>
        <td class="col-st" style="text-align:center">${idx + 1}</td>
        <td class="col-poref" style="text-align:center;font-family:monospace;font-size:10px">${txt(item.po_ref)}</td>
        <td class="col-code" style="font-family:monospace;font-size:10px;color:#1a56db">${txt(item.material_code)}</td>
        <td class="col-name">${txt(item.material_name)}</td>
        <td class="col-spec" style="font-size:10px;color:#555">${txt(item.spec)}</td>
        <td class="col-unit" style="text-align:center">${txt(item.unit) || 'PCS'}</td>
        <td class="col-qty" style="text-align:right;font-weight:600">${fmt(item.quantity)}</td>
        <td class="col-price" style="text-align:right">${fmt(item.unit_price)}</td>
        <td class="col-total" style="text-align:right;font-weight:700">${fmt(item.total_price)}</td>
        <td class="col-tax" style="text-align:center">${taxRate}%</td>
        <td class="col-cur" style="text-align:center;font-size:10px">${txt(item.currency) || currency}</td>
        <td class="col-remark" style="font-size:10px;color:#666">${txt(item.remark)}</td>
      </tr>`).join('')

    const html = `<!DOCTYPE html><html lang="zh-TW"><head><meta charset="utf-8"/>
    <title>採購單 ${poNumber}</title>
    <style>
      * { box-sizing: border-box; margin: 0; padding: 0; }
      body { font-family: "Microsoft JhengHei", "PingFang TC", Arial, sans-serif; font-size: 11px; font-weight: 400; color: #000; background: #fff; }
      .page { padding: 12mm 15mm; max-width: 210mm; margin: 0 auto; }
      /* Header */
      .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #000; padding-bottom: 5mm; margin-bottom: 5mm; }
      .company { font-size: 18px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; }
      .subtitle { font-size: 10px; color: #666; margin-top: 3px; }
      .doc-title { font-size: 22px; font-weight: 700; color: #1a56db; letter-spacing: 2px; text-align: right; }
      .doc-sub { font-size: 10px; color: #666; text-align: right; margin-top: 2px; }
      .doc-no { font-size: 12px; font-weight: 600; text-align: right; margin-top: 3px; }
      /* Info table */
      .info-table { width: 100%; border-collapse: collapse; margin-bottom: 5mm; }
      .info-table td { border: 1px solid #bbb; padding: 5px 8px; font-size: 11px; font-weight: 400; vertical-align: middle; }
      .info-table .lbl { font-weight: 600; background: #f5f5f5; white-space: nowrap; width: 110px; color: #333; line-height: 1.4; }
      .info-table .val { color: #000; }
      /* Items table */
      table.items { width: 100%; border-collapse: collapse; table-layout: fixed; margin-bottom: 4mm; }
      table.items th { border: 1px solid #555; background: #e8e8e8; padding: 5px 4px; text-align: center; font-size: 10px; font-weight: 600; white-space: nowrap; color: #000; }
      table.items td { border: 1px solid #bbb; padding: 5px 5px; font-size: 11px; font-weight: 400; color: #000; }
      table.items tbody tr:nth-child(even) { background: #fafafa; }
      table.items .col-st { width: 24px; }
      table.items .col-poref { width: 48px; }
      table.items .col-code { width: 64px; }
      table.items .col-name { width: 140px; word-break: break-word; line-height: 1.35; font-weight: 500; }
      table.items .col-spec { width: 56px; }
      table.items .col-unit { width: 36px; }
      table.items .col-qty { width: 42px; }
      table.items .col-price { width: 56px; }
      table.items .col-total { width: 64px; }
      table.items .col-tax { width: 40px; }
      table.items .col-cur { width: 32px; }
      table.items .col-remark { width: 44px; }
      .total-row td { border: 1px solid #555; background: #efefef; font-weight: 600; font-size: 11px; padding: 6px 8px; }
      /* Remark */
      .remark-box { border: 1px solid #bbb; padding: 6px 10px; min-height: 18mm; font-size: 10px; font-weight: 400; margin-top: 5mm; }
      .remark-title { font-weight: 600; margin-bottom: 4px; font-size: 10px; }
      /* Terms */
      .terms { border: 1px solid #ccc; padding: 6px 10px; margin-top: 4mm; font-size: 9px; font-weight: 400; line-height: 1.5; color: #555; }
      /* Sign section - equal height both sides */
      .sign-section { display: grid; grid-template-columns: 1fr 1fr; gap: 8mm; margin-top: 8mm; }
      .sign-box { border: 1px solid #bbb; padding: 8px 10px; text-align: center; display: flex; flex-direction: column; }
      .sign-label { font-weight: 600; font-size: 10px; color: #333; padding-bottom: 4px; border-bottom: 1px solid #eee; margin-bottom: 0; }
      .sign-area { flex: 1; min-height: 50px; display: flex; align-items: center; justify-content: center; }
      .sign-line { border-top: 1px solid #555; padding-top: 4px; font-size: 10px; font-weight: 400; color: #333; margin-top: 4px; }
      @media print { body { -webkit-print-color-adjust: exact; } @page { size: A4; margin: 0; } }
    </style></head><body>
    <div class="page">
      <div class="header">
        <div>
          ${logoUrl ? `<img src="${logoUrl}" style="max-height:40px;max-width:160px;object-fit:contain;margin-bottom:4px" onerror="this.style.display='none'"/><br/>` : ''}
          <div class="company">${txt(company.company_name)}</div>
          <div class="subtitle">${txt(company.company_name_local)}</div>
        </div>
        <div>
          <div class="doc-title">採購單</div>
          <div class="doc-sub">PURCHASE ORDER / ĐƠN ĐẶT HÀNG</div>
          <div class="doc-no">No. ${txt(poNumber)}</div>
        </div>
      </div>

      <table class="info-table">
        <tr>
          <td class="lbl">供應商<br/>Nhà cung cấp</td>
          <td class="val" colspan="3" style="font-weight:600;font-size:12px">${txt(supplierName)}</td>
          <td class="lbl">採購單號<br/>Số PO</td>
          <td class="val" style="font-family:monospace;font-weight:600">${txt(poNumber)}</td>
        </tr>
        <tr>
          <td class="lbl">幣別<br/>Loại tiền</td>
          <td class="val">${currency}</td>
          <td class="lbl">稅率<br/>Thuế suất</td>
          <td class="val">${taxRate}%</td>
        </tr>
        <tr>
          <td class="lbl">建立日期<br/>Ngày lập</td>
          <td class="val">${data.created_at ? String(data.created_at).slice(0,10) : ''}</td>
          <td class="lbl">狀態<br/>Trạng thái</td>
          <td class="val">${txt(data.status)}</td>
          <td class="lbl"></td>
          <td class="val"></td>
        </tr>
        ${txt(data.remark) ? `<tr><td class="lbl">備註<br/>Ghi chú</td><td class="val" colspan="5">${txt(data.remark)}</td></tr>` : ''}
      </table>

      <table class="items">
        <thead><tr>
          <th class="col-st">ST</th>
          <th class="col-poref">PO訂單編號</th>
          <th class="col-code">物料編號</th>
          <th class="col-name">材料名稱</th>
          <th class="col-spec">規格</th>
          <th class="col-unit">單位</th>
          <th class="col-qty">數量</th>
          <th class="col-price">單價</th>
          <th class="col-total">小計</th>
          <th class="col-tax">稅率</th>
          <th class="col-cur">幣別</th>
          <th class="col-remark">備註</th>
        </tr></thead>
        <tbody>${itemRows}</tbody>
        <tfoot>
          <tr class="total-row">
            <td colspan="8" style="text-align:right">未稅 / Trước thuế</td>
            <td style="text-align:right;font-size:12px">${fmt(subTotal)}</td>
            <td style="text-align:center">${taxRate}%</td>
            <td style="text-align:center">${currency}</td>
            <td></td>
          </tr>
          <tr class="total-row">
            <td colspan="8" style="text-align:right">含稅合計 / Tổng cộng sau thuế</td>
            <td style="text-align:right;font-size:12px;color:#1a56db">${fmt(total)}</td>
            <td style="text-align:center">${taxRate}%</td>
            <td style="text-align:center">${currency}</td>
            <td></td>
          </tr>
        </tfoot>
      </table>

      ${txt(data.remark) ? `<div class="remark-box"><div class="remark-title">備註 / Ghi chú：</div><div>${txt(data.remark)}</div></div>` : ''}

      <div class="terms">
        <strong>注意事項 / Lưu ý：</strong>
        供應商須按訂單規格、數量、日期交貨，如有不符將不予收貨。訂單確認後不得擅自更改，如需更改須經本公司書面同意。
        Nhà cung cấp phải giao hàng đúng quy cách, số lượng, ngày giao theo đơn hàng. Sau khi xác nhận đơn hàng không được tự ý thay đổi, nếu cần thay đổi phải có sự đồng ý bằng văn bản của chúng tôi.
      </div>

      <div class="sign-section">
        <div class="sign-box">
          <div class="sign-label">供應商確認 / NCC xác nhận</div>
          <div class="sign-area"></div>
          <div class="sign-line">${txt(supplierName)}</div>
        </div>
        <div class="sign-box">
          <div class="sign-label">採購確認 / Người lập biểu xác nhận</div>
          <div class="sign-area">
            ${signatureUrl ? `<img src="${signatureUrl}" style="max-height:44px;max-width:150px;object-fit:contain" />` : ''}
          </div>
          <div class="sign-line">${txt(company.company_name)}</div>
        </div>
      </div>
    </div>
    </body></html>`

    const w = window.open('', '_blank', 'width=900,height=1100')
    if (w) { w.document.write(html); w.document.close(); setTimeout(() => w.print(), 500) }
  }

  const formTotal = form.items.reduce((s, i) => s + (i.total_price || 0), 0)
  const filteredPos = pos.filter(p => {
    const matchSearch = !search || p.po_number.toLowerCase().includes(search.toLowerCase()) || p.supplier_name.toLowerCase().includes(search.toLowerCase())
    const matchStatus = !statusFilter || p.status === statusFilter
    return matchSearch && matchStatus
  })
  const { page, setPage, totalPages, paged, total } = usePagination(filteredPos, 20)
  const inp = 'oms-input text-xs py-1.5'
  const lockedInp = `${inp} bom-locked-field`

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-slate-800">採購單管理</h1>
          <p className="section-hint">點選採購單列展開檢視料號明細</p>
        </div>
        {canWrite && <button onClick={() => { setCreating(true); setEditingId(null); setForm({ supplier_id: '', supplier_name:'', currency:'VND', tax_rate: 8, remark:'', items:[emptyItem()] }) }} className="btn-primary">+ 建立採購單</button>}
      </div>

      {(creating || editingId !== null) && canWrite && (
        <div className="oms-card p-6 mb-5">
          <h2 className="text-sm font-semibold text-slate-800 mb-4">{editingId ? '編輯採購單（草稿）' : '建立採購單'}</h2>
          <div className="grid grid-cols-3 gap-3 mb-4">
            <div>
              <label className="block text-[11px] text-slate-500 mb-1.5">供應商 *</label>
              <select className={inp} value={form.supplier_id}
                onChange={e => onSelectSupplier(e.target.value)}>
                <option value="">-- 選擇供應商 --</option>
                {suppliers.map(s => (
                  <option key={s.id} value={String(s.id)}>{s.name}{s.supplier_code ? ` (${s.supplier_code})` : ''}</option>
                ))}
              </select>            </div>
            <div>
              <label className="block text-[11px] text-slate-500 mb-1.5">幣別</label>
              <select className={inp} value={form.currency} onChange={e=>setForm(p=>({...p,currency:e.target.value}))}>
                <option>VND</option><option>TWD</option><option>CNY</option><option>USD</option>
              </select>
            </div>
            <div>
              <label className="block text-[11px] text-slate-500 mb-1.5">備註（交易條件、特殊要求等）</label>
              <textarea className={inp} rows={3} value={form.remark} onChange={e=>setForm(p=>({...p,remark:e.target.value}))} placeholder="可輸入交易條件、付款方式、交貨要求等資訊..." />
            </div>
          </div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-slate-600">採購明細</span>
            <button onClick={addItem} className="btn-ghost text-blue-600">+ 新增料號</button>
          </div>
          <div className="overflow-x-auto overscroll-x-contain rounded-lg border border-slate-200">
            <table className="w-full text-xs" style={{ minWidth: 1760 }}>
              <thead><tr className="border-b border-slate-200">
                {['圖片','PO訂單編號','物料編號（BOM）','材料名稱','規格','單位','數量','單價','小計','稅率','幣別','備註',''].map(h=>(
                  <th key={h} className="px-2 py-2 text-left text-[10px] font-semibold text-slate-500 uppercase">{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {form.items.map((item, i) => (
                  <tr key={i} className="border-b border-slate-100">
                    <td className="p-1.5">
                      {item.image_url ? (
                        <img src={item.image_url} alt="" className="w-10 h-10 object-cover rounded border border-slate-200" onError={e=>{(e.target as HTMLImageElement).style.display='none'}} />
                      ) : (
                        <div className="w-10 h-10 bg-slate-100 rounded flex items-center justify-center text-slate-300 text-xs">無</div>
                      )}
                    </td>
                    <td className="p-1"><input className={inp} style={{width:130}} value={item.po_ref} placeholder="PO編號" onChange={e=>updateItem(i,'po_ref',e.target.value)} /></td>
                    <td className="p-1 min-w-[280px]">
                      <SearchableSelect
                        options={getFilteredBoms()}
                        value={item.bom_id ? String(item.bom_id) : ''}
                        onChange={val => selectBOM(i, val)}
                        placeholder="-- 選擇 BOM --"
                        disabled={!form.supplier_id}
                        renderOption={b => `${b.product_sku} — ${b.product_name}${b.spec ? ` (${b.spec})` : ''}`}
                        filterFn={(b, search) => 
                          b.product_sku.toLowerCase().includes(search) ||
                          b.product_name.toLowerCase().includes(search) ||
                          (b.spec||'').toLowerCase().includes(search) ||
                          (b.material_name||'').toLowerCase().includes(search)
                        }
                      />
                    </td>
                    <td className="p-1"><input className={lockedInp} value={item.material_name} onChange={e=>updateItem(i,'material_name',e.target.value)} readOnly /></td>
                    <td className="p-1"><input className={lockedInp} value={item.spec} onChange={e=>updateItem(i,'spec',e.target.value)} readOnly style={{width:120}} /></td>
                    <td className="p-1"><input className={lockedInp} value={item.unit} onChange={e=>updateItem(i,'unit',e.target.value)} readOnly style={{width:70}} /></td>
                    <td className="p-1"><input type="number" className={inp} style={{width:90}} value={item.quantity || ""} onChange={e=>updateItem(i,'quantity',Number(e.target.value))} /></td>
                    <td className="p-1"><input type="number" className={inp} style={{width:110}} value={item.unit_price || ""} onChange={e=>updateItem(i,'unit_price',Number(e.target.value))} /></td>
                    <td className="p-1 px-2 text-right text-slate-600 font-medium whitespace-nowrap">{Number(item.total_price).toLocaleString()}</td>
                    <td className="p-1">
                      <select className={inp} style={{width:80}} value={String(form.tax_rate)}
                        onChange={e=>setForm(p=>({...p, tax_rate: Math.min(25, Math.max(1, Number(e.target.value) || 8))}))}>
                        {Array.from({ length: 25 }, (_, idx) => idx + 1).map(v => (
                          <option key={v} value={v}>{v}%</option>
                        ))}
                      </select>
                    </td>
                    <td className="p-1">
                      <select className={inp} style={{width:72}} value={item.currency} onChange={e=>updateItem(i,'currency',e.target.value)}>
                        <option>VND</option><option>TWD</option><option>CNY</option><option>USD</option>
                      </select>
                    </td>
                    <td className="p-1"><input className={inp} style={{width:180}} value={item.remark} onChange={e=>updateItem(i,'remark',e.target.value)} /></td>
                    <td className="p-1 text-center"><button onClick={() => removeItem(i)} className="text-slate-300 hover:text-red-600 transition-colors">✕</button></td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-slate-200">
                  <td colSpan={8} className="px-3 py-2 text-right text-[11px] text-slate-400 font-semibold uppercase">未稅合計</td>
                  <td className="px-2 py-2 text-right text-slate-600 font-bold">{formTotal.toLocaleString()}</td>
                  <td className="px-2 py-2 text-slate-400 text-xs">{form.tax_rate}%</td>
                  <td className="px-2 py-2 text-slate-400 text-xs">{form.currency}</td>
                  <td className="px-2 py-2 text-right text-slate-700 font-bold" colSpan={2}>
                    含稅 {(formTotal * (1 + (form.tax_rate || 8) / 100)).toLocaleString()}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
          <div className="flex gap-2 mt-4">
            <button onClick={save} className="btn-primary">{editingId ? '儲存修改' : '建立採購單'}</button>
            <button onClick={() => { setCreating(false); setEditingId(null); setForm({ supplier_id: '', supplier_name:'', currency:'VND', tax_rate: 8, remark:'', items:[emptyItem()] }) }} className="btn-ghost border border-slate-200">取消</button>
          </div>
        </div>
      )}

      {!creating && editingId === null && (
        <>
          <div className="list-controls">
            <input className="list-search" placeholder="搜尋採購單號或供應商..." value={search} onChange={e=>setSearch(e.target.value)} />
            <div className="flex gap-1">
              {[['', '全部'], ['draft', '草稿'], ['approved', '已核准'], ['sent', '已送出'], ['received', '已收貨']].map(([val, label]) => (
                <button key={val} onClick={() => setStatusFilter(val)}
                  className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${statusFilter === val ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300'}`}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="oms-card overflow-hidden">
        {loading ? <div className="flex justify-center py-16"><div className="w-5 h-5 border-2 border-blue-200 border-t-blue-600 rounded-full animate-spin" /></div> : (
          <>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200">
                  <th className="w-8" />
                  <th className="px-4 py-3 text-left text-[11px] font-semibold text-slate-500 uppercase tracking-wider">採購單號</th>
                  <th className="px-4 py-3 text-left text-[11px] font-semibold text-slate-500 uppercase tracking-wider">供應商</th>
                  <th className="px-4 py-3 text-right text-[11px] font-semibold text-slate-500 uppercase tracking-wider">金額</th>
                  <th className="px-4 py-3 text-left text-[11px] font-semibold text-slate-500 uppercase tracking-wider">幣別</th>
                  <th className="px-4 py-3 text-left text-[11px] font-semibold text-slate-500 uppercase tracking-wider">狀態</th>
                  <th className="px-4 py-3 text-left text-[11px] font-semibold text-slate-500 uppercase tracking-wider">建立時間</th>
                  <th className="px-4 py-3 text-left text-[11px] font-semibold text-slate-500 uppercase tracking-wider">操作</th>
                </tr>
              </thead>
              <tbody>
                {paged.map(p => {
                  const isOpen = expanded.has(p.id)
                  const items = loadedItems[p.id] || []
                  const sm = STATUS_MAP[p.status] || { label: p.status, badge: 'badge-gray' }
                  return (
                    <>
                      <tr key={p.id}
                        className={`border-b border-slate-100 cursor-pointer transition-colors ${isOpen ? 'bg-slate-50' : 'hover:bg-slate-50'}`}
                        onClick={() => toggleExpand(p.id)}>
                        <td className="pl-4 py-3">
                          <span className="text-slate-500"><ChevronIcon open={isOpen} /></span>
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-blue-600">{p.po_number}</td>
                        <td className="px-4 py-3 text-slate-800 font-medium max-w-[200px] truncate" title={p.supplier_name}>{p.supplier_name}</td>
                        <td className="px-4 py-3 text-right text-slate-600 font-medium">{Number(p.total_amount).toLocaleString()}</td>
                        <td className="px-4 py-3 text-slate-400 text-xs">{p.currency}</td>
                        <td className="px-4 py-3"><span className={sm.badge}>{sm.label}</span></td>
                        <td className="px-4 py-3 text-slate-300 text-xs">{p.created_at?.slice(0,10)}</td>
                        <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                          <div className="flex items-center gap-1">
                            <StatusFlow compact steps={PO_STEPS} current={p.status}
                              actions={getPOActions(p.status).filter(a => {
                                if (a.toStatus === 'approved') return canApprove
                                if (a.toStatus === 'received') return canApprove
                                return canWrite
                              })}
                              onAction={async (toStatus) => {
                                if (toStatus === 'approved') await approve(p.id, { stopPropagation: ()=>{} } as any)
                                else if (toStatus === 'received') await confirmReceipt(p, { stopPropagation: ()=>{} } as any)
                                else await changeStatus(p.id, toStatus, { stopPropagation: ()=>{} } as any)
                              }} />
                            <button onClick={e => { e.stopPropagation(); printPo(p.id, p.po_number, p.supplier_name) }} className="btn-ghost ml-1" title="列印">🖨 列印</button>
                            {canWrite && p.status === 'draft' && (
                              <button onClick={e => startEdit(p, e)} className="btn-ghost text-blue-600">✏ 編輯</button>
                            )}
                            {canDel && (
                              <button onClick={e => del(p.id, e)} className="btn-danger">刪除</button>
                            )}
                          </div>
                        </td>
                      </tr>
                      {isOpen && (
                        <tr key={`${p.id}-items`} className="border-b border-slate-100">
                          <td colSpan={8} className="px-0 py-0">
                            <div className="expand-row-wrap">
                              {items.length === 0 ? (
                                <div className="expand-row-loading">
                                  <div className="w-3 h-3 border border-slate-300 border-t-slate-500 rounded-full animate-spin"/>載入中...
                                </div>
                              ) : (
                                <div className="overflow-x-auto">
                                  <table className="w-full text-xs" style={{minWidth:700}}>
                                    <thead>
                                      <tr className="border-b border-slate-100">
                                        {['PO訂單編號','料號','材料名稱','規格'].map(h=>(
                                          <th key={h} className="px-3 py-2 text-left text-[10px] font-semibold text-slate-500 uppercase whitespace-nowrap">{h}</th>
                                        ))}
                                        {['數量','單價','小計'].map(h=>(
                                          <th key={h} className="px-3 py-2 text-right text-[10px] font-semibold text-slate-500 uppercase whitespace-nowrap">{h}</th>
                                        ))}
                                        {['稅率','單位','幣別','備註'].map(h=>(
                                          <th key={h} className="px-3 py-2 text-left text-[10px] font-semibold text-slate-500 uppercase whitespace-nowrap">{h}</th>
                                        ))}
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {items.map((item, i) => (
                                        <tr key={i} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                                          <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{item.po_ref}</td>
                                          <td className="px-3 py-2 font-mono text-blue-600 whitespace-nowrap">{item.material_code}</td>
                                          <td className="px-3 py-2 text-slate-600 whitespace-nowrap max-w-[160px] truncate" title={item.material_name}>{item.material_name}</td>
                                          <td className="px-3 py-2 text-slate-400 whitespace-nowrap max-w-[120px] truncate" title={item.spec}>{item.spec}</td>
                                          <td className="px-3 py-2 text-right text-slate-600 font-medium whitespace-nowrap">{Number(item.quantity).toLocaleString()}</td>
                                          <td className="px-3 py-2 text-right text-slate-600 whitespace-nowrap">{Number(item.unit_price).toLocaleString()}</td>
                                          <td className="px-3 py-2 text-right text-slate-800 font-semibold whitespace-nowrap">{Number(item.total_price).toLocaleString()}</td>
                                          <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{Number((p as any).tax_rate || 8)}%</td>
                                          <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{item.unit}</td>
                                          <td className="px-3 py-2 text-slate-400 whitespace-nowrap">{item.currency}</td>
                                          <td className="px-3 py-2 text-slate-400 whitespace-nowrap">{item.remark}</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                    <tfoot>
                                      <tr className="border-t border-slate-200">
                                        <td colSpan={7} className="px-3 py-2 text-right text-[10px] text-slate-300 font-semibold uppercase">未稅合計</td>
                                        <td className="px-3 py-2 text-right text-slate-600 font-bold">{items.reduce((s,i)=>s+Number(i.total_price),0).toLocaleString()}</td>
                                        <td className="px-3 py-2 text-slate-400 text-xs">{Number((p as any).tax_rate || 8)}%</td>
                                        <td colSpan={3} className="px-3 py-2 text-slate-400 text-xs">{items[0]?.currency}</td>
                                      </tr>
                                    </tfoot>
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
                {paged.length === 0 && <tr><td colSpan={8} className="px-4 py-12 text-center text-slate-400">尚無採購單</td></tr>}
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
