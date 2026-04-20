'use client'

import { Fragment, useEffect, useMemo, useState } from 'react'
import { API, apiFetch, getSignatureUrl, getToken } from '@/lib/api'
import { useDialog } from '@/components/Dialog'
import { can } from '@/lib/usePermissions'
import { usePagination, Pagination } from '@/lib/usePagination'
import { getCompany } from '@/lib/useCompany'
import { generateInvoiceHTML } from '@/lib/printInvoice'
import { useDebouncedValue } from '@/lib/useDebouncedValue'

type InvoiceType = 'customer' | 'supplier'

type PendingItem = {
  reconciliation_item_id: number
  reconciliation_no: string
  reconcile_date: string
  po_number: string
  material_code: string
  material_name: string
  unit: string
  accepted_qty: number
  invoiced_qty: number
  remaining_qty: number
  unit_price: number
  customer_name: string
  supplier_name: string
}

type InvoiceHeader = {
  id: number
  invoice_no: string
  invoice_type: InvoiceType
  invoice_date: string
  status: 'draft' | 'confirmed' | string
  party_name: string
  currency: string
  total_amount: number
  tax_rate: number
  tax_amount: number
  grand_total: number
  item_count: number
  total_qty: number
  created_at: string
  verification_code?: string
}

type InvoiceItem = {
  id: number
  reconciliation_item_id: number
  po_number: string
  material_code: string
  material_name: string
  unit: string
  qty: number
  unit_price: number
  amount: number
}

type InvoiceDetail = InvoiceHeader & {
  remark: string
  qr_payload?: string
  items: InvoiceItem[]
}

const STATUS_MAP: Record<string, { label: string; badge: string }> = {
  draft: { label: '草稿', badge: 'badge-gray' },
  confirmed: { label: '已確認', badge: 'badge-green' },
}

export default function InvoicesPage() {
  const { toast, confirm } = useDialog()
  const canWrite = can('customer_order.create')

  const [invoiceType, setInvoiceType] = useState<InvoiceType>('customer')
  const [creating, setCreating] = useState(false)
  const [loading, setLoading] = useState(true)
  const [pending, setPending] = useState<PendingItem[]>([])
  const [headers, setHeaders] = useState<InvoiceHeader[]>([])
  const [selected, setSelected] = useState<Record<number, { qty: number; unit_price: number }>>({})
  const [invoiceDate, setInvoiceDate] = useState('')
  const [taxRate, setTaxRate] = useState(0)
  const [remark, setRemark] = useState('')
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [details, setDetails] = useState<Record<number, InvoiceDetail>>({})
  const [saving, setSaving] = useState<number | null>(null)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [pendingSearch, setPendingSearch] = useState('')
  const [verifyTargetId, setVerifyTargetId] = useState<number | null>(null)
  const [verifyCodeInput, setVerifyCodeInput] = useState('')
  const [verifyResult, setVerifyResult] = useState<{ ok: boolean; invoice_no: string } | null>(null)
  const debouncedSearch = useDebouncedValue(search.trim(), 350)
  const debouncedPendingSearch = useDebouncedValue(pendingSearch.trim(), 350)

  const loadHeaders = async (
    type: InvoiceType = invoiceType,
    searchText = debouncedSearch,
    status = statusFilter,
    from = dateFrom,
    to = dateTo
  ) => {
    setLoading(true)
    const qs = new URLSearchParams()
    qs.set('type', type)
    qs.set('page_size', '1000')
    if (searchText) qs.set('search', searchText)
    if (status) qs.set('status', status)
    if (from) qs.set('date_from', from)
    if (to) qs.set('date_to', to)
    const rows = await apiFetch<InvoiceHeader[]>(`/api/invoices?${qs.toString()}`)
    setHeaders(rows)
    setLoading(false)
  }

  const loadPending = async (type: InvoiceType = invoiceType, searchText = debouncedPendingSearch) => {
    const qs = new URLSearchParams()
    qs.set('type', type)
    if (searchText) qs.set('search', searchText)
    const rows = await apiFetch<PendingItem[]>(`/api/invoices/pending-items?${qs.toString()}`)
    setPending(rows)
  }

  useEffect(() => {
    Promise.all([
      loadHeaders(invoiceType, debouncedSearch, statusFilter, dateFrom, dateTo),
      loadPending(invoiceType, debouncedPendingSearch),
    ]).catch((e) => {
      toast(`載入失敗：${e.message}`, 'error')
      setLoading(false)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoiceType, debouncedSearch, statusFilter, dateFrom, dateTo, debouncedPendingSearch])

  const selectedCount = useMemo(() => Object.keys(selected).length, [selected])
  const selectedTotal = useMemo(() => Object.entries(selected).reduce((sum, [, row]) => sum + Number(row.qty || 0) * Number(row.unit_price || 0), 0), [selected])

  const toggleSelect = (row: PendingItem, checked: boolean) => {
    setSelected((prev) => {
      const next = { ...prev }
      if (!checked) {
        delete next[row.reconciliation_item_id]
      } else {
        next[row.reconciliation_item_id] = { qty: row.remaining_qty, unit_price: row.unit_price }
      }
      return next
    })
  }

  const createInvoice = async () => {
    const ids = Object.keys(selected)
    if (!ids.length) {
      toast('請先選擇至少一筆項目', 'error')
      return
    }
    try {
      setSaving(0)
      await apiFetch('/api/invoices', {
        method: 'POST',
        body: JSON.stringify({
          invoice_type: invoiceType,
          invoice_date: invoiceDate || null,
          tax_rate: taxRate,
          remark,
          items: ids.map((id) => ({
            reconciliation_item_id: Number(id),
            qty: selected[Number(id)].qty,
            unit_price: selected[Number(id)].unit_price,
          })),
        }),
      })
      toast('發票草稿已建立')
      setCreating(false)
      setSelected({})
      setInvoiceDate('')
      setTaxRate(0)
      setRemark('')
      await Promise.all([loadHeaders(), loadPending()])
    } catch (e: any) {
      toast(`建立失敗：${e.message}`, 'error')
    } finally {
      setSaving(null)
    }
  }

  const openDetail = async (id: number) => {
    if (expandedId === id) {
      setExpandedId(null)
      return
    }
    setExpandedId(id)
    if (!details[id]) {
      const detail = await apiFetch<InvoiceDetail>(`/api/invoices/${id}`)
      setDetails((prev) => ({ ...prev, [id]: detail }))
    }
  }

  const saveDraft = async (id: number) => {
    const detail = details[id]
    if (!detail) return
    try {
      setSaving(id)
      await apiFetch(`/api/invoices/${id}`, {
        method: 'PUT',
        body: JSON.stringify({
          invoice_date: detail.invoice_date,
          tax_rate: detail.tax_rate,
          remark: detail.remark,
          items: detail.items.map((i) => ({ id: i.id, qty: i.qty, unit_price: i.unit_price })),
        }),
      })
      const latest = await apiFetch<InvoiceDetail>(`/api/invoices/${id}`)
      setDetails((prev) => ({ ...prev, [id]: latest }))
      await Promise.all([loadHeaders(), loadPending()])
      toast('草稿已更新')
    } catch (e: any) {
      toast(`儲存失敗：${e.message}`, 'error')
    } finally {
      setSaving(null)
    }
  }

  const confirmInvoice = async (id: number) => {
    if (!await confirm('確認發票？', '確認後將鎖定發票資料並回寫結算進度。', '確認發票')) return
    try {
      setSaving(id)
      await apiFetch(`/api/invoices/${id}/confirm`, { method: 'PATCH' })
      await Promise.all([loadHeaders(), loadPending()])
      if (expandedId === id) {
        const latest = await apiFetch<InvoiceDetail>(`/api/invoices/${id}`)
        setDetails((prev) => ({ ...prev, [id]: latest }))
      }
      toast('發票已確認')
    } catch (e: any) {
      toast(`確認失敗：${e.message}`, 'error')
    } finally {
      setSaving(null)
    }
  }

  const printInvoice = async (id: number) => {
    try {
      const [detail, company] = await Promise.all([
        apiFetch<InvoiceDetail>(`/api/invoices/${id}`),
        getCompany(),
      ])
      const html = generateInvoiceHTML(detail, getSignatureUrl() || undefined, company)
      const w = window.open('', '_blank', 'width=900,height=1100')
      if (!w) {
        toast('瀏覽器已封鎖彈出視窗，請允許後再列印', 'error')
        return
      }
      w.document.write(html)
      w.document.close()
      setTimeout(() => w.print(), 500)
    } catch (e: any) {
      toast(`列印失敗：${e.message}`, 'error')
    }
  }

  const exportCsv = async () => {
    try {
      const qs = new URLSearchParams()
      qs.set('type', invoiceType)
      const token = getToken()
      const res = await fetch(`${API}/api/invoices/export/csv?${qs.toString()}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      if (!res.ok) throw new Error('匯出失敗')
      const csv = await res.text()
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `invoices_${invoiceType}_${new Date().toISOString().slice(0, 10)}.csv`
      a.click()
      URL.revokeObjectURL(url)
      toast('CSV 已下載')
    } catch (e: any) {
      toast(`匯出失敗：${e.message}`, 'error')
    }
  }

  const removeInvoice = async (id: number) => {
    if (!await confirm('確定刪除草稿發票？', '刪除後不可恢復。', '刪除')) return
    try {
      await apiFetch(`/api/invoices/${id}`, { method: 'DELETE' })
      if (expandedId === id) setExpandedId(null)
      toast('草稿已刪除')
      await Promise.all([loadHeaders(), loadPending()])
    } catch (e: any) {
      toast(`刪除失敗：${e.message}`, 'error')
    }
  }

  const verifyInvoiceCode = async (id: number) => {
    const code = verifyCodeInput.trim()
    if (!code) {
      toast('請輸入驗證碼', 'error')
      return
    }
    try {
      const res = await apiFetch<{ ok: boolean; invoice_no: string }>(`/api/invoices/${id}/verify?code=${encodeURIComponent(code)}`)
      setVerifyResult(res)
      if (res.ok) toast('驗證成功')
      else toast('驗證失敗', 'error')
    } catch (e: any) {
      toast(`驗證失敗：${e.message}`, 'error')
    }
  }

  const pendingPg = usePagination(pending, 10)
  const headerPg = usePagination(headers, 20)

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-slate-800">發票管理</h1>
          <p className="text-xs text-slate-500 mt-1">對已核對出貨建立客戶/供應商發票，形成結算閉環。</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-lg border border-slate-200 overflow-hidden text-xs">
            <button className={`px-3 py-1.5 ${invoiceType === 'customer' ? 'bg-blue-600 text-white' : 'bg-white text-slate-600'}`} onClick={() => setInvoiceType('customer')}>客戶發票</button>
            <button className={`px-3 py-1.5 ${invoiceType === 'supplier' ? 'bg-blue-600 text-white' : 'bg-white text-slate-600'}`} onClick={() => setInvoiceType('supplier')}>供應商發票</button>
          </div>
          <button className="btn-ghost" onClick={exportCsv}>匯出 CSV</button>
          {canWrite && <button className="btn-primary" onClick={() => setCreating((v) => !v)}>{creating ? '收起建立區' : '+ 新建發票'}</button>}
        </div>
      </div>

      <div className="rubber-card p-3 mb-4">
        <div className="grid md:grid-cols-6 gap-2">
          <input className="rubber-input md:col-span-2" placeholder="搜尋發票號/對象/驗證碼" value={search} onChange={(e) => setSearch(e.target.value)} />
          <select className="rubber-input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">全部狀態</option>
            <option value="draft">草稿</option>
            <option value="confirmed">已確認</option>
          </select>
          <input type="date" className="rubber-input" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          <input type="date" className="rubber-input" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          <input className="rubber-input" placeholder="待開票列表搜尋" value={pendingSearch} onChange={(e) => setPendingSearch(e.target.value)} />
        </div>
      </div>

      {creating && canWrite && (
        <div className="rubber-card p-4 mb-5 space-y-4">
          <div className="grid md:grid-cols-4 gap-3">
            <div>
              <label className="block text-xs text-slate-500 mb-1">發票日期</label>
              <input type="date" className="rubber-input" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} />
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">稅率 %</label>
              <input type="number" className="rubber-input" value={taxRate} onChange={(e) => setTaxRate(Number(e.target.value || 0))} />
            </div>
            <div className="md:col-span-2">
              <label className="block text-xs text-slate-500 mb-1">備註</label>
              <input className="rubber-input" value={remark} onChange={(e) => setRemark(e.target.value)} />
            </div>
          </div>

          <div className="table-scroll-x border border-slate-200 rounded-xl">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-3 py-2 text-left">選取</th>
                  <th className="px-3 py-2 text-left">核對單 / PO</th>
                  <th className="px-3 py-2 text-left">對象 / 品項</th>
                  <th className="px-3 py-2 text-right">可開量</th>
                  <th className="px-3 py-2 text-right">本次開票量</th>
                  <th className="px-3 py-2 text-right">單價</th>
                  <th className="px-3 py-2 text-right">金額</th>
                </tr>
              </thead>
              <tbody>
                {pendingPg.paged.map((p) => {
                  const checked = !!selected[p.reconciliation_item_id]
                  const row = selected[p.reconciliation_item_id]
                  const amount = Number(row?.qty || 0) * Number(row?.unit_price || 0)
                  return (
                    <tr key={p.reconciliation_item_id} className="border-t border-slate-100">
                      <td className="px-3 py-2"><input type="checkbox" checked={checked} onChange={(e) => toggleSelect(p, e.target.checked)} /></td>
                      <td className="px-3 py-2 text-xs text-slate-700">{p.reconciliation_no}<div className="text-slate-500 mt-1">{p.po_number || '-'}</div></td>
                      <td className="px-3 py-2 text-xs text-slate-700">{invoiceType === 'supplier' ? (p.supplier_name || '-') : (p.customer_name || '-')}<div className="text-slate-800 mt-1">{p.material_code || '-'} {p.material_name || ''}</div></td>
                      <td className="px-3 py-2 text-right">{p.remaining_qty}</td>
                      <td className="px-3 py-2 text-right">
                        <input
                          type="number"
                          step="0.0001"
                          className="rubber-input text-right w-28 ml-auto"
                          disabled={!checked}
                          value={row?.qty ?? ''}
                          onChange={(e) => {
                            const qty = Number(e.target.value || 0)
                            setSelected((prev) => ({ ...prev, [p.reconciliation_item_id]: { qty, unit_price: prev[p.reconciliation_item_id]?.unit_price ?? p.unit_price } }))
                          }}
                        />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <input
                          type="number"
                          className="rubber-input text-right w-28 ml-auto"
                          disabled={!checked}
                          value={row?.unit_price ?? ''}
                          onChange={(e) => {
                            const unitPrice = Number(e.target.value || 0)
                            setSelected((prev) => ({ ...prev, [p.reconciliation_item_id]: { qty: prev[p.reconciliation_item_id]?.qty ?? p.remaining_qty, unit_price: unitPrice } }))
                          }}
                        />
                      </td>
                      <td className="px-3 py-2 text-right font-semibold text-slate-700">{amount.toLocaleString()}</td>
                    </tr>
                  )
                })}
                {!loading && pendingPg.paged.length === 0 && <tr><td colSpan={7} className="px-3 py-8 text-center text-slate-500">目前無待開票項目</td></tr>}
              </tbody>
            </table>
          </div>

          {pendingPg.total > 0 && <Pagination page={pendingPg.page} totalPages={pendingPg.totalPages} setPage={pendingPg.setPage} total={pendingPg.total} pageSize={10} />}

          <div className="flex items-center justify-between text-sm">
            <div className="text-slate-600">已選 {selectedCount} 筆，未稅小計 {selectedTotal.toLocaleString()}</div>
            <button className="btn-primary" disabled={saving !== null} onClick={createInvoice}>建立發票草稿</button>
          </div>
        </div>
      )}

      <div className="rubber-card overflow-hidden">
        <div className="table-scroll-x">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-3 py-2 text-left">發票號</th>
                <th className="px-3 py-2 text-left">對象</th>
                <th className="px-3 py-2 text-left">日期</th>
                <th className="px-3 py-2 text-right">項目數</th>
                <th className="px-3 py-2 text-right">未稅</th>
                <th className="px-3 py-2 text-right">稅額</th>
                <th className="px-3 py-2 text-right">含稅總額</th>
                <th className="px-3 py-2 text-left">狀態</th>
                <th className="px-3 py-2 text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {headerPg.paged.map((h) => {
                const sm = STATUS_MAP[h.status] || { label: h.status, badge: 'badge-gray' }
                const detail = details[h.id]
                return (
                  <Fragment key={h.id}>
                    <tr className="border-t border-slate-100">
                      <td className="px-3 py-2 font-semibold text-slate-800">{h.invoice_no}</td>
                      <td className="px-3 py-2">{h.party_name || '-'}</td>
                      <td className="px-3 py-2">{h.invoice_date ? String(h.invoice_date).slice(0, 10) : '-'}</td>
                      <td className="px-3 py-2 text-right">{h.item_count}</td>
                      <td className="px-3 py-2 text-right">{Number(h.total_amount || 0).toLocaleString()}</td>
                      <td className="px-3 py-2 text-right">{Number(h.tax_amount || 0).toLocaleString()}</td>
                      <td className="px-3 py-2 text-right font-semibold text-slate-800">{Number(h.grand_total || 0).toLocaleString()}</td>
                      <td className="px-3 py-2"><span className={sm.badge}>{sm.label}</span></td>
                      <td className="px-3 py-2 text-right space-x-2">
                        <button className="btn-ghost" onClick={() => printInvoice(h.id)}>列印</button>
                        <button className="btn-ghost" onClick={() => openDetail(h.id)}>明細</button>
                        <button className="btn-ghost" onClick={() => { setVerifyTargetId(h.id); setVerifyResult(null); setVerifyCodeInput('') }}>驗證</button>
                        {h.status === 'draft' && canWrite && <button className="btn-primary" disabled={saving === h.id} onClick={() => confirmInvoice(h.id)}>確認</button>}
                        {h.status === 'draft' && canWrite && <button className="btn-danger" disabled={saving === h.id} onClick={() => removeInvoice(h.id)}>刪除</button>}
                      </td>
                    </tr>
                    {expandedId === h.id && detail && (
                      <tr>
                        <td colSpan={9} className="bg-slate-50 border-t border-slate-100 p-3">
                          <div className="grid md:grid-cols-2 gap-3 mb-3">
                            <div className="text-xs text-slate-700">驗證碼：<span className="font-mono font-semibold">{detail.verification_code || '-'}</span></div>
                            <div className="text-xs text-slate-500 truncate">QR Payload：{detail.qr_payload || '-'}</div>
                          </div>
                          <div className="grid md:grid-cols-3 gap-3 mb-3">
                            <div>
                              <label className="block text-xs text-slate-500 mb-1">發票日期</label>
                              <input
                                type="date"
                                className="rubber-input"
                                disabled={detail.status !== 'draft'}
                                value={detail.invoice_date ? String(detail.invoice_date).slice(0, 10) : ''}
                                onChange={(e) => setDetails((prev) => ({ ...prev, [h.id]: { ...detail, invoice_date: e.target.value } }))}
                              />
                            </div>
                            <div>
                              <label className="block text-xs text-slate-500 mb-1">稅率 %</label>
                              <input
                                type="number"
                                className="rubber-input"
                                disabled={detail.status !== 'draft'}
                                value={detail.tax_rate || 0}
                                onChange={(e) => setDetails((prev) => ({ ...prev, [h.id]: { ...detail, tax_rate: Number(e.target.value || 0) } }))}
                              />
                            </div>
                            <div>
                              <label className="block text-xs text-slate-500 mb-1">備註</label>
                              <input
                                className="rubber-input"
                                disabled={detail.status !== 'draft'}
                                value={detail.remark || ''}
                                onChange={(e) => setDetails((prev) => ({ ...prev, [h.id]: { ...detail, remark: e.target.value } }))}
                              />
                            </div>
                          </div>

                          <div className="table-scroll-x border border-slate-200 rounded-xl">
                            <table className="min-w-full text-sm bg-white">
                              <thead className="bg-slate-50 text-slate-600">
                                <tr>
                                  <th className="px-3 py-2 text-left">PO</th>
                                  <th className="px-3 py-2 text-left">品項</th>
                                  <th className="px-3 py-2 text-right">數量</th>
                                  <th className="px-3 py-2 text-right">單價</th>
                                  <th className="px-3 py-2 text-right">金額</th>
                                </tr>
                              </thead>
                              <tbody>
                                {detail.items.map((i) => (
                                  <tr key={i.id} className="border-t border-slate-100">
                                    <td className="px-3 py-2 text-xs text-slate-700">{i.po_number || '-'}</td>
                                    <td className="px-3 py-2 text-xs text-slate-800">{i.material_code || '-'} {i.material_name || ''}</td>
                                    <td className="px-3 py-2 text-right">
                                      <input
                                        type="number"
                                        step="0.0001"
                                        className="rubber-input text-right w-24 ml-auto"
                                        disabled={detail.status !== 'draft'}
                                        value={i.qty}
                                        onChange={(e) => {
                                          const qty = Number(e.target.value || 0)
                                          setDetails((prev) => ({ ...prev, [h.id]: { ...detail, items: detail.items.map((row) => row.id === i.id ? { ...row, qty, amount: qty * Number(row.unit_price || 0) } : row) } }))
                                        }}
                                      />
                                    </td>
                                    <td className="px-3 py-2 text-right">
                                      <input
                                        type="number"
                                        className="rubber-input text-right w-28 ml-auto"
                                        disabled={detail.status !== 'draft'}
                                        value={i.unit_price}
                                        onChange={(e) => {
                                          const unitPrice = Number(e.target.value || 0)
                                          setDetails((prev) => ({ ...prev, [h.id]: { ...detail, items: detail.items.map((row) => row.id === i.id ? { ...row, unit_price: unitPrice, amount: Number(row.qty || 0) * unitPrice } : row) } }))
                                        }}
                                      />
                                    </td>
                                    <td className="px-3 py-2 text-right">{Number(i.amount || 0).toLocaleString()}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>

                          {detail.status === 'draft' && canWrite && (
                            <div className="mt-3 flex justify-end">
                              <button className="btn-primary" disabled={saving === h.id} onClick={() => saveDraft(h.id)}>儲存草稿</button>
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
              {!loading && headerPg.paged.length === 0 && <tr><td colSpan={9} className="px-3 py-8 text-center text-slate-500">尚無發票</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {!loading && headerPg.total > 0 && (
        <div className="mt-4">
          <Pagination page={headerPg.page} totalPages={headerPg.totalPages} setPage={headerPg.setPage} total={headerPg.total} pageSize={20} />
        </div>
      )}

      {verifyTargetId !== null && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white border border-slate-200 rounded-2xl shadow-xl p-6 w-full max-w-md">
            <h3 className="text-sm font-semibold text-slate-800 mb-3">發票驗證</h3>
            <label className="block text-xs text-slate-500 mb-1">驗證碼</label>
            <input className="rubber-input mb-3" value={verifyCodeInput} onChange={(e) => setVerifyCodeInput(e.target.value)} placeholder="輸入 12 碼驗證碼" />
            {verifyResult && (
              <div className={`text-xs mb-3 ${verifyResult.ok ? 'text-emerald-700' : 'text-red-600'}`}>
                {verifyResult.ok ? `驗證成功：${verifyResult.invoice_no}` : '驗證失敗：驗證碼不匹配'}
              </div>
            )}
            <div className="flex gap-2">
              <button className="btn-primary flex-1 justify-center" onClick={() => verifyInvoiceCode(verifyTargetId)}>驗證</button>
              <button className="btn-ghost flex-1 justify-center border border-slate-200" onClick={() => setVerifyTargetId(null)}>關閉</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
