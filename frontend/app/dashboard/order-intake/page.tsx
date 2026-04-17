'use client'

import { useEffect, useMemo, useState } from 'react'
import { API, apiFetch, getToken } from '@/lib/api'
import { usePagination, Pagination } from '@/lib/usePagination'
import Link from 'next/link'

type IntakeItem = {
  order_id: number
  po_number: string
  po_date: string
  order_status: string
  customer_name: string
  order_item_id: number
  material_code: string
  material_name: string
  spec: string
  unit: string
  ordered_qty: number
  shipped_qty: number
  reconciled_qty: number
  pending_reconcile_qty: number
  fulfillment_rate: number
  reconcile_rate: number
}

const STATUS_LABEL: Record<string, string> = {
  pending: '待處理',
  partial: '部分完成',
  completed: '已完成',
  delay: '延遲',
}

export default function OrderIntakePage() {
  const [rows, setRows] = useState<IntakeItem[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')

  const load = async (nextStatus = status) => {
    setLoading(true)
    const params = new URLSearchParams()
    if (search.trim()) params.set('search', search.trim())
    if (nextStatus) params.set('status', nextStatus)
    params.set('page_size', '1000')
    const data = await apiFetch<IntakeItem[]>(`/api/order-intake${params.toString() ? `?${params.toString()}` : ''}`)
    setRows(data)
    setLoading(false)
  }

  useEffect(() => {
    load('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const summary = useMemo(() => {
    const total = rows.length
    const open = rows.filter(r => r.pending_reconcile_qty > 0 || r.shipped_qty < r.ordered_qty).length
    const completed = total - open
    return { total, open, completed }
  }, [rows])

  const { page, setPage, totalPages, paged, total } = usePagination(rows, 20)

  const exportCsv = async () => {
    try {
      const token = getToken()
      const res = await fetch(`${API}/api/order-intake/export/csv`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      if (!res.ok) throw new Error('匯出失敗')
      const csv = await res.text()
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `order_intake_${new Date().toISOString().slice(0, 10)}.csv`
      a.click()
      URL.revokeObjectURL(url)
    } catch {}
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-slate-800">訂單收集池</h1>
          <p className="text-xs text-slate-500 mt-1">彙總客戶訂單到出貨與核對的在製進度。</p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <button className="btn-ghost" onClick={exportCsv}>匯出 CSV</button>
          <span className="badge-gray">總項目 {summary.total}</span>
          <span className="badge-yellow">待處理 {summary.open}</span>
          <span className="badge-green">已完成 {summary.completed}</span>
        </div>
      </div>

      <div className="rubber-card p-4 mb-4">
        <div className="grid md:grid-cols-5 gap-3">
          <input
            className="rubber-input md:col-span-3"
            placeholder="搜尋客戶、訂單號、料號、品名"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select className="rubber-input" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">全部狀態</option>
            <option value="open">進行中</option>
            <option value="completed">已完成</option>
          </select>
          <button className="btn-primary" onClick={() => { setPage(1); load(status) }}>查詢</button>
        </div>
      </div>

      <div className="rubber-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-3 py-2 text-left">訂單</th>
                <th className="px-3 py-2 text-left">客戶 / 品項</th>
                <th className="px-3 py-2 text-right">訂單量</th>
                <th className="px-3 py-2 text-right">已出貨</th>
                <th className="px-3 py-2 text-right">已核對</th>
                <th className="px-3 py-2 text-right">待核對</th>
                <th className="px-3 py-2 text-left">進度</th>
              </tr>
            </thead>
            <tbody>
              {paged.map((r) => (
                <tr key={r.order_item_id} className="border-t border-slate-100">
                  <td className="px-3 py-2 align-top">
                    <div className="font-semibold text-slate-800">{r.po_number}</div>
                    <div className="text-xs text-slate-500">{r.po_date ? String(r.po_date).slice(0, 10) : '-'}</div>
                    <div className="text-[11px] mt-1 inline-flex px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">{STATUS_LABEL[r.order_status] || r.order_status}</div>
                  </td>
                  <td className="px-3 py-2 align-top">
                    <div className="text-slate-700">{r.customer_name || '-'}</div>
                    <div className="font-medium text-slate-800 mt-1">{r.material_code || '-'} {r.material_name || ''}</div>
                    <div className="text-xs text-slate-500">{r.spec || '-'}</div>
                  </td>
                  <td className="px-3 py-2 text-right">{r.ordered_qty}</td>
                  <td className="px-3 py-2 text-right">{r.shipped_qty}</td>
                  <td className="px-3 py-2 text-right">{r.reconciled_qty}</td>
                  <td className="px-3 py-2 text-right font-semibold text-amber-700">{r.pending_reconcile_qty}</td>
                  <td className="px-3 py-2 align-top min-w-[180px]">
                    <div className="text-xs text-slate-600 mb-1">出貨 {r.fulfillment_rate}% / 核對 {r.reconcile_rate}%</div>
                    <div className="w-full h-2 rounded-full bg-slate-100 overflow-hidden">
                      <div className="h-full bg-blue-500" style={{ width: `${r.fulfillment_rate}%` }} />
                    </div>
                    <div className="w-full h-2 rounded-full bg-slate-100 overflow-hidden mt-1">
                      <div className="h-full bg-emerald-500" style={{ width: `${r.reconcile_rate}%` }} />
                    </div>
                    <div className="mt-2 text-xs">
                      <Link href="/dashboard/shipment-reconciliation" className="text-orange-700 hover:text-orange-800">前往出貨核對</Link>
                    </div>
                  </td>
                </tr>
              ))}
              {!loading && paged.length === 0 && (
                <tr>
                  <td className="px-3 py-8 text-center text-slate-500" colSpan={7}>目前無資料</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {loading && <div className="text-xs text-slate-500 mt-3">載入中...</div>}
      {!loading && total > 0 && (
        <div className="mt-4">
          <Pagination page={page} totalPages={totalPages} setPage={setPage} total={total} pageSize={20} />
        </div>
      )}
    </div>
  )
}
