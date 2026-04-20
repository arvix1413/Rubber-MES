'use client'

import { Fragment, useEffect, useMemo, useState } from 'react'
import { API, apiFetch, getToken } from '@/lib/api'
import { useDialog } from '@/components/Dialog'
import { can } from '@/lib/usePermissions'
import { usePagination, Pagination } from '@/lib/usePagination'

type PendingItem = {
  delivery_note_item_id: number
  delivery_note_id: number
  dn_number: string
  delivery_date: string
  customer_order_id: number
  po_number: string
  customer_name: string
  material_code: string
  material_name: string
  unit: string
  shipped_qty: number
}

type ReconciliationHeader = {
  id: number
  reconciliation_no: string
  reconcile_date: string
  status: 'draft' | 'confirmed' | string
  remark: string
  created_at: string
  confirmed_at: string
  item_count: number
  total_shipped_qty: number
  total_accepted_qty: number
  total_difference_qty: number
}

type ReconciliationDetailItem = {
  id: number
  delivery_note_item_id: number
  dn_number: string
  po_number: string
  material_code: string
  material_name: string
  unit: string
  shipped_qty: number
  accepted_qty: number
  difference_qty: number
  difference_reason: string
}

type ReconciliationDetail = ReconciliationHeader & {
  items: ReconciliationDetailItem[]
}

const STATUS_MAP: Record<string, { label: string; badge: string }> = {
  draft: { label: '草稿', badge: 'badge-gray' },
  confirmed: { label: '已確認', badge: 'badge-green' },
}

export default function ShipmentReconciliationPage() {
  const { toast, confirm } = useDialog()
  const canWrite = can('delivery.create')

  const [pending, setPending] = useState<PendingItem[]>([])
  const [headers, setHeaders] = useState<ReconciliationHeader[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [selected, setSelected] = useState<Record<number, { accepted_qty: number; difference_reason: string }>>({})
  const [reconcileDate, setReconcileDate] = useState('')
  const [remark, setRemark] = useState('')
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [details, setDetails] = useState<Record<number, ReconciliationDetail>>({})
  const [saving, setSaving] = useState<number | null>(null)

  const loadAll = async () => {
    setLoading(true)
    const [pendingRows, headerRows] = await Promise.all([
      apiFetch<PendingItem[]>('/api/reconciliations/pending-items?page_size=1000'),
      apiFetch<ReconciliationHeader[]>('/api/reconciliations?page_size=1000'),
    ])
    setPending(pendingRows)
    setHeaders(headerRows)
    setLoading(false)
  }

  useEffect(() => {
    loadAll().catch((e) => {
      toast(`載入失敗：${e.message}`, 'error')
      setLoading(false)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const selectedCount = useMemo(() => Object.keys(selected).length, [selected])

  const toggleSelect = (row: PendingItem, checked: boolean) => {
    setSelected((prev) => {
      const next = { ...prev }
      if (!checked) {
        delete next[row.delivery_note_item_id]
      } else {
        next[row.delivery_note_item_id] = { accepted_qty: row.shipped_qty, difference_reason: '' }
      }
      return next
    })
  }

  const createReconciliation = async () => {
    const itemIds = Object.keys(selected)
    if (!itemIds.length) {
      toast('請先選擇至少一筆出貨項目', 'error')
      return
    }
    try {
      setSaving(0)
      await apiFetch('/api/reconciliations', {
        method: 'POST',
        body: JSON.stringify({
          reconcile_date: reconcileDate || null,
          remark,
          items: itemIds.map((id) => ({
            delivery_note_item_id: Number(id),
            accepted_qty: selected[Number(id)].accepted_qty,
            difference_reason: selected[Number(id)].difference_reason,
          })),
        }),
      })
      toast('出貨核對單建立成功')
      setCreating(false)
      setSelected({})
      setReconcileDate('')
      setRemark('')
      await loadAll()
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
      const d = await apiFetch<ReconciliationDetail>(`/api/reconciliations/${id}`)
      setDetails((prev) => ({ ...prev, [id]: d }))
    }
  }

  const saveDraftDetail = async (id: number) => {
    const detail = details[id]
    if (!detail) return
    try {
      setSaving(id)
      await apiFetch(`/api/reconciliations/${id}`, {
        method: 'PUT',
        body: JSON.stringify({
          reconcile_date: detail.reconcile_date,
          remark: detail.remark,
          items: detail.items.map((i) => ({ id: i.id, accepted_qty: i.accepted_qty, difference_reason: i.difference_reason })),
        }),
      })
      toast('草稿已更新')
      await loadAll()
      const latest = await apiFetch<ReconciliationDetail>(`/api/reconciliations/${id}`)
      setDetails((prev) => ({ ...prev, [id]: latest }))
    } catch (e: any) {
      toast(`儲存失敗：${e.message}`, 'error')
    } finally {
      setSaving(null)
    }
  }

  const confirmReconciliation = async (id: number) => {
    if (!await confirm('確認核對完成？', '確認後將回寫客戶訂單已核對數量。', '確認核對')) return
    try {
      setSaving(id)
      await apiFetch(`/api/reconciliations/${id}/confirm`, { method: 'PATCH' })
      toast('核對單已確認')
      await loadAll()
      if (expandedId === id) {
        const latest = await apiFetch<ReconciliationDetail>(`/api/reconciliations/${id}`)
        setDetails((prev) => ({ ...prev, [id]: latest }))
      }
    } catch (e: any) {
      toast(`確認失敗：${e.message}`, 'error')
    } finally {
      setSaving(null)
    }
  }

  const removeDraft = async (id: number) => {
    if (!await confirm('確定刪除草稿核對單？', '刪除後不可恢復。', '刪除')) return
    try {
      setSaving(id)
      await apiFetch(`/api/reconciliations/${id}`, { method: 'DELETE' })
      if (expandedId === id) setExpandedId(null)
      toast('核對單已刪除')
      await loadAll()
    } catch (e: any) {
      toast(`刪除失敗：${e.message}`, 'error')
    } finally {
      setSaving(null)
    }
  }

  const exportCsv = async () => {
    try {
      const token = getToken()
      const res = await fetch(`${API}/api/reconciliations/export/csv`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      if (!res.ok) throw new Error('匯出失敗')
      const csv = await res.text()
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `reconciliations_${new Date().toISOString().slice(0, 10)}.csv`
      a.click()
      URL.revokeObjectURL(url)
      toast('CSV 已下載')
    } catch (e: any) {
      toast(`匯出失敗：${e.message}`, 'error')
    }
  }

  const pendingPaged = usePagination(pending, 10)
  const headerPaged = usePagination(headers, 15)

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-slate-800">出貨核對</h1>
          <p className="text-xs text-slate-500 mt-1">將已出貨項目建立核對單，確認到貨差異並回寫訂單核對量。</p>
        </div>
        <div className="flex items-center gap-2">
          <button className="btn-ghost" onClick={exportCsv}>匯出 CSV</button>
          {canWrite && (
            <button className="btn-primary" onClick={() => setCreating(v => !v)}>
              {creating ? '收起建立區' : '+ 新建核對單'}
            </button>
          )}
        </div>
      </div>

      {creating && canWrite && (
        <div className="rubber-card p-4 mb-5 space-y-4">
          <div className="grid md:grid-cols-4 gap-3">
            <div>
              <label className="block text-xs text-slate-500 mb-1">核對日期</label>
              <input type="date" className="rubber-input" value={reconcileDate} onChange={(e) => setReconcileDate(e.target.value)} />
            </div>
            <div className="md:col-span-2">
              <label className="block text-xs text-slate-500 mb-1">備註</label>
              <input className="rubber-input" value={remark} onChange={(e) => setRemark(e.target.value)} placeholder="可選" />
            </div>
            <div className="flex items-end justify-end text-xs text-slate-600">已選 {selectedCount} 筆</div>
          </div>

          <div className="table-scroll-x border border-slate-200 rounded-xl">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-3 py-2 text-left">選取</th>
                  <th className="px-3 py-2 text-left">出貨單 / 訂單</th>
                  <th className="px-3 py-2 text-left">客戶 / 品項</th>
                  <th className="px-3 py-2 text-right">已出貨</th>
                  <th className="px-3 py-2 text-right">驗收量</th>
                  <th className="px-3 py-2 text-left">差異原因</th>
                </tr>
              </thead>
              <tbody>
                {pendingPaged.paged.map((p) => {
                  const checked = !!selected[p.delivery_note_item_id]
                  const selectedRow = selected[p.delivery_note_item_id]
                  return (
                    <tr key={p.delivery_note_item_id} className="border-t border-slate-100">
                      <td className="px-3 py-2"><input type="checkbox" checked={checked} onChange={(e) => toggleSelect(p, e.target.checked)} /></td>
                      <td className="px-3 py-2">
                        <div className="font-medium text-slate-800">{p.dn_number}</div>
                        <div className="text-xs text-slate-500">{p.po_number || '-'} / {p.delivery_date ? String(p.delivery_date).slice(0, 10) : '-'}</div>
                      </td>
                      <td className="px-3 py-2">
                        <div className="text-slate-700">{p.customer_name || '-'}</div>
                        <div className="text-slate-800 text-xs mt-0.5">{p.material_code || '-'} {p.material_name || ''}</div>
                      </td>
                      <td className="px-3 py-2 text-right">{p.shipped_qty}</td>
                      <td className="px-3 py-2 text-right">
                        <input
                          type="number"
                          step="0.0001"
                          className="rubber-input text-right w-28 ml-auto"
                          disabled={!checked}
                          value={selectedRow?.accepted_qty ?? ''}
                          onChange={(e) => {
                            const value = Number(e.target.value || 0)
                            setSelected((prev) => ({
                              ...prev,
                              [p.delivery_note_item_id]: {
                                ...(prev[p.delivery_note_item_id] || { difference_reason: '' }),
                                accepted_qty: Number.isFinite(value) ? value : 0,
                              },
                            }))
                          }}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          className="rubber-input"
                          disabled={!checked}
                          value={selectedRow?.difference_reason || ''}
                          onChange={(e) => {
                            setSelected((prev) => ({
                              ...prev,
                              [p.delivery_note_item_id]: {
                                ...(prev[p.delivery_note_item_id] || { accepted_qty: p.shipped_qty }),
                                difference_reason: e.target.value,
                              },
                            }))
                          }}
                          placeholder="可選"
                        />
                      </td>
                    </tr>
                  )
                })}
                {!loading && pendingPaged.paged.length === 0 && (
                  <tr><td colSpan={6} className="px-3 py-8 text-center text-slate-500">目前沒有待核對出貨項目</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {pendingPaged.total > 0 && (
            <Pagination page={pendingPaged.page} totalPages={pendingPaged.totalPages} setPage={pendingPaged.setPage} total={pendingPaged.total} pageSize={10} />
          )}

          <div className="flex justify-end">
            <button className="btn-primary" disabled={saving !== null} onClick={createReconciliation}>建立核對單</button>
          </div>
        </div>
      )}

      <div className="rubber-card overflow-hidden">
        <div className="table-scroll-x">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-3 py-2 text-left">核對單號</th>
                <th className="px-3 py-2 text-left">日期</th>
                <th className="px-3 py-2 text-right">項目數</th>
                <th className="px-3 py-2 text-right">出貨量</th>
                <th className="px-3 py-2 text-right">驗收量</th>
                <th className="px-3 py-2 text-right">差異量</th>
                <th className="px-3 py-2 text-left">狀態</th>
                <th className="px-3 py-2 text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {headerPaged.paged.map((h) => {
                const detail = details[h.id]
                const sm = STATUS_MAP[h.status] || { label: h.status, badge: 'badge-gray' }
                return (
                  <Fragment key={h.id}>
                    <tr className="border-t border-slate-100">
                      <td className="px-3 py-2 font-semibold text-slate-800">{h.reconciliation_no}</td>
                      <td className="px-3 py-2">{h.reconcile_date ? String(h.reconcile_date).slice(0, 10) : '-'}</td>
                      <td className="px-3 py-2 text-right">{h.item_count}</td>
                      <td className="px-3 py-2 text-right">{h.total_shipped_qty}</td>
                      <td className="px-3 py-2 text-right">{h.total_accepted_qty}</td>
                      <td className="px-3 py-2 text-right text-amber-700">{h.total_difference_qty}</td>
                      <td className="px-3 py-2"><span className={sm.badge}>{sm.label}</span></td>
                      <td className="px-3 py-2 text-right space-x-2">
                        <button className="btn-ghost" onClick={() => openDetail(h.id)}>明細</button>
                        {h.status === 'draft' && canWrite && (
                          <button className="btn-primary" disabled={saving === h.id} onClick={() => confirmReconciliation(h.id)}>確認</button>
                        )}
                        {h.status === 'draft' && canWrite && (
                          <button className="btn-danger" disabled={saving === h.id} onClick={() => removeDraft(h.id)}>刪除</button>
                        )}
                      </td>
                    </tr>
                    {expandedId === h.id && detail && (
                      <tr>
                        <td colSpan={8} className="bg-slate-50 border-t border-slate-100 p-3">
                          <div className="grid md:grid-cols-3 gap-3 mb-3">
                            <div>
                              <label className="block text-xs text-slate-500 mb-1">核對日期</label>
                              <input
                                type="date"
                                className="rubber-input"
                                disabled={detail.status !== 'draft'}
                                value={detail.reconcile_date ? String(detail.reconcile_date).slice(0, 10) : ''}
                                onChange={(e) => setDetails((prev) => ({ ...prev, [h.id]: { ...detail, reconcile_date: e.target.value } }))}
                              />
                            </div>
                            <div className="md:col-span-2">
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
                                  <th className="px-3 py-2 text-left">出貨單/訂單</th>
                                  <th className="px-3 py-2 text-left">品項</th>
                                  <th className="px-3 py-2 text-right">出貨</th>
                                  <th className="px-3 py-2 text-right">驗收</th>
                                  <th className="px-3 py-2 text-right">差異</th>
                                  <th className="px-3 py-2 text-left">原因</th>
                                </tr>
                              </thead>
                              <tbody>
                                {detail.items.map((i) => (
                                  <tr key={i.id} className="border-t border-slate-100">
                                    <td className="px-3 py-2 text-xs text-slate-700">{i.dn_number} / {i.po_number || '-'}</td>
                                    <td className="px-3 py-2 text-xs text-slate-800">{i.material_code || '-'} {i.material_name || ''}</td>
                                    <td className="px-3 py-2 text-right">{i.shipped_qty}</td>
                                    <td className="px-3 py-2 text-right">
                                      <input
                                        type="number"
                                        step="0.0001"
                                        className="rubber-input text-right w-28 ml-auto"
                                        disabled={detail.status !== 'draft'}
                                        value={i.accepted_qty}
                                        onChange={(e) => {
                                          const accepted = Number(e.target.value || 0)
                                          setDetails((prev) => ({
                                            ...prev,
                                            [h.id]: {
                                              ...detail,
                                              items: detail.items.map((row) => row.id === i.id ? {
                                                ...row,
                                                accepted_qty: accepted,
                                                difference_qty: Number((row.shipped_qty - accepted).toFixed(4)),
                                              } : row),
                                            },
                                          }))
                                        }}
                                      />
                                    </td>
                                    <td className="px-3 py-2 text-right text-amber-700">{i.difference_qty}</td>
                                    <td className="px-3 py-2">
                                      <input
                                        className="rubber-input"
                                        disabled={detail.status !== 'draft'}
                                        value={i.difference_reason || ''}
                                        onChange={(e) => {
                                          const text = e.target.value
                                          setDetails((prev) => ({
                                            ...prev,
                                            [h.id]: {
                                              ...detail,
                                              items: detail.items.map((row) => row.id === i.id ? { ...row, difference_reason: text } : row),
                                            },
                                          }))
                                        }}
                                      />
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                          {detail.status === 'draft' && canWrite && (
                            <div className="mt-3 flex justify-end">
                              <button className="btn-primary" disabled={saving === h.id} onClick={() => saveDraftDetail(h.id)}>儲存草稿</button>
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
              {!loading && headerPaged.paged.length === 0 && (
                <tr><td colSpan={8} className="px-3 py-8 text-center text-slate-500">尚無核對單</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {!loading && headerPaged.total > 0 && (
        <div className="mt-4">
          <Pagination page={headerPaged.page} totalPages={headerPaged.totalPages} setPage={headerPaged.setPage} total={headerPaged.total} pageSize={15} />
        </div>
      )}
    </div>
  )
}
