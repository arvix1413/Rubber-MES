'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { apiFetch } from '@/lib/api'
import { getUser } from '@/lib/permissions'
import { useDialog } from '@/components/Dialog'

type ProfitOrder = {
  id: number
  po_number: string
  po_date: string | null
  status: string
  currency: string
  customer_name: string
  customer_code?: string
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

type ProfitItem = {
  id: number
  bom_id: number | null
  product_sku?: string
  product_name?: string
  spec?: string
  unit?: string
  qty: number
  unit_price: number
  standard_cost: number
  line_revenue: number
  line_cost: number
  line_gross: number
}

type ProfitEntry = {
  id: number
  category: string
  description: string
  amount: number
  remark?: string
  created_at: string
}

type ProfitSummary = {
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

type ProfitDetail = {
  order: {
    id: number
    po_number: string
    po_date: string | null
    status: string
    currency: string
    customer_name: string
    customer_code?: string
    remark?: string
  }
  items: ProfitItem[]
  entries: ProfitEntry[]
  summary: ProfitSummary
}

type ProfitRateConfig = {
  operating_cost_rate: number
  vat_rate: number
  cit_rate: number
}

const STATUS_LABEL: Record<string, string> = {
  pending: '待出貨',
  partial: '部分出貨',
  completed: '已完成',
  delay: '延遲',
}

const CATEGORY_OPTIONS = [
  { value: 'operating_cost', label: '營運成本' },
  { value: 'logistics', label: '運費/物流' },
  { value: 'platform_fee', label: '平台/手續費' },
  { value: 'other_cost', label: '其他成本' },
  { value: 'sales_tax', label: '營業稅' },
  { value: 'income_tax', label: '所得稅' },
  { value: 'manual_adjustment', label: '手動調整(+/-)' },
]

const money = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 })

export default function ProfitTrackingPage() {
  const router = useRouter()
  const { toast, confirm } = useDialog()

  const [loading, setLoading] = useState(true)
  const [orders, setOrders] = useState<ProfitOrder[]>([])
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')

  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detail, setDetail] = useState<ProfitDetail | null>(null)

  const [entryForm, setEntryForm] = useState({
    category: 'operating_cost',
    description: '',
    amount: '',
    remark: '',
  })
  const [savingEntry, setSavingEntry] = useState(false)
  const [rateConfig, setRateConfig] = useState<ProfitRateConfig>({ operating_cost_rate: 0, vat_rate: 0, cit_rate: 0 })
  const [savingConfig, setSavingConfig] = useState(false)
  const [applyingRates, setApplyingRates] = useState(false)

  const loadOrders = async (nextSearch = search, nextStatus = status) => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (nextSearch.trim()) params.set('search', nextSearch.trim())
      if (nextStatus) params.set('status', nextStatus)
      const data = await apiFetch<{ orders: ProfitOrder[] }>(`/api/profit-tracking/orders?${params.toString()}`)
      setOrders(data.orders || [])
      if ((data.orders || []).length === 0) {
        setSelectedId(null)
        setDetail(null)
      }
    } catch (e: any) {
      toast('載入失敗：' + e.message, 'error')
    } finally {
      setLoading(false)
    }
  }

  const loadDetail = async (id: number) => {
    setDetailLoading(true)
    try {
      const data = await apiFetch<ProfitDetail>(`/api/profit-tracking/orders/${id}`)
      setDetail(data)
      setSelectedId(id)
    } catch (e: any) {
      toast('載入訂單追蹤失敗：' + e.message, 'error')
    } finally {
      setDetailLoading(false)
    }
  }

  const loadRateConfig = async () => {
    try {
      const data = await apiFetch<ProfitRateConfig>('/api/profit-tracking/config')
      setRateConfig({
        operating_cost_rate: Number(data.operating_cost_rate || 0),
        vat_rate: Number(data.vat_rate || 0),
        cit_rate: Number(data.cit_rate || 0),
      })
    } catch (e: any) {
      toast('載入比例參數失敗：' + e.message, 'error')
    }
  }

  useEffect(() => {
    const user = getUser()
    if (!user || user.role !== 'manager') {
      router.replace('/dashboard')
      return
    }
    loadOrders()
    loadRateConfig()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router])

  const summary = useMemo(() => {
    return orders.reduce((acc, order) => {
      acc.revenue += order.revenue || 0
      acc.cogs += order.cogs || 0
      acc.net += order.net_profit || 0
      return acc
    }, { revenue: 0, cogs: 0, net: 0 })
  }, [orders])
  const detailCalc = useMemo(() => {
    if (!detail) return null
    const revenue = Number(detail.summary.revenue || 0)
    const cogs = Number(detail.summary.cogs || 0)
    const gross = Number(detail.summary.gross_profit || 0)
    const salesTax = Number(detail.summary.sales_tax || 0)
    const incomeTax = Number(detail.summary.income_tax || 0)
    const taxTotal = salesTax + incomeTax
    const afterTaxGross = gross - taxTotal
    const operatingCost = Number(detail.summary.operating_cost || 0)
    const manualAdjustment = Number(detail.summary.manual_adjustment || 0)
    const netBeforeManual = afterTaxGross - operatingCost
    const finalNet = netBeforeManual + manualAdjustment
    const vatRateOnGross = gross !== 0 ? (salesTax / gross) * 100 : 0
    const citRateOnGross = gross !== 0 ? (incomeTax / gross) * 100 : 0
    const opRateOnAfterTaxGross = afterTaxGross !== 0 ? (operatingCost / afterTaxGross) * 100 : 0
    return {
      revenue,
      cogs,
      gross,
      salesTax,
      incomeTax,
      taxTotal,
      afterTaxGross,
      operatingCost,
      manualAdjustment,
      netBeforeManual,
      finalNet,
      vatRateOnGross,
      citRateOnGross,
      opRateOnAfterTaxGross,
    }
  }, [detail])

  const onSearch = async () => {
    await loadOrders(search, status)
  }

  const addEntry = async () => {
    if (!selectedId || !detail) return
    const amount = Number(entryForm.amount)
    if (!entryForm.description.trim()) { toast('請填寫項目名稱', 'error'); return }
    if (!Number.isFinite(amount) || amount === 0) { toast('請輸入有效金額（不可為 0）', 'error'); return }

    setSavingEntry(true)
    try {
      await apiFetch(`/api/profit-tracking/orders/${selectedId}/entries`, {
        method: 'POST',
        body: JSON.stringify({
          category: entryForm.category,
          description: entryForm.description.trim(),
          amount,
          remark: entryForm.remark.trim(),
        }),
      })
      setEntryForm({ category: 'operating_cost', description: '', amount: '', remark: '' })
      await Promise.all([loadDetail(selectedId), loadOrders()])
      toast('已新增追蹤項目')
    } catch (e: any) {
      toast('新增失敗：' + e.message, 'error')
    } finally {
      setSavingEntry(false)
    }
  }

  const removeEntry = async (entry: ProfitEntry) => {
    if (!await confirm('確定刪除此追蹤項目？', `${entry.description} (${money(entry.amount)})`, '刪除')) return
    try {
      await apiFetch(`/api/profit-tracking/entries/${entry.id}`, { method: 'DELETE' })
      if (selectedId) {
        await Promise.all([loadDetail(selectedId), loadOrders()])
      }
      toast('已刪除')
    } catch (e: any) {
      toast('刪除失敗：' + e.message, 'error')
    }
  }

  const saveRateConfig = async () => {
    setSavingConfig(true)
    try {
      const payload = {
        operating_cost_rate: Math.max(0, Math.min(100, Number(rateConfig.operating_cost_rate) || 0)),
        vat_rate: Math.max(0, Math.min(100, Number(rateConfig.vat_rate) || 0)),
        cit_rate: Math.max(0, Math.min(100, Number(rateConfig.cit_rate) || 0)),
      }
      const data = await apiFetch<ProfitRateConfig & { ok: boolean }>('/api/profit-tracking/config', {
        method: 'PUT',
        body: JSON.stringify(payload),
      })
      setRateConfig({
        operating_cost_rate: Number(data.operating_cost_rate || 0),
        vat_rate: Number(data.vat_rate || 0),
        cit_rate: Number(data.cit_rate || 0),
      })
      toast('比例參數已儲存')
    } catch (e: any) {
      toast('儲存比例參數失敗：' + e.message, 'error')
    } finally {
      setSavingConfig(false)
    }
  }

  const applyRatesToOrder = async () => {
    if (!selectedId) { toast('請先選擇訂單', 'error'); return }
    setApplyingRates(true)
    try {
      const data = await apiFetch<{
        ok: boolean
        inserted: number
        amounts: { operating_cost: number; sales_tax: number; income_tax: number }
      }>(`/api/profit-tracking/orders/${selectedId}/apply-rates`, { method: 'POST' })
      await Promise.all([loadDetail(selectedId), loadOrders()])
      toast(`已自動帶入 ${data.inserted} 項：營運 ${money(data.amounts.operating_cost)} / VAT ${money(data.amounts.sales_tax)} / CIT ${money(data.amounts.income_tax)}`)
    } catch (e: any) {
      toast('自動帶入失敗：' + e.message, 'error')
    } finally {
      setApplyingRates(false)
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-800">利潤追蹤</h1>
          <p className="section-hint">僅主管可見，追蹤每筆訂單收入、成本、稅金與淨利</p>
        </div>
        <button className="btn-ghost" onClick={() => loadOrders()}>↻ 重新整理</button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="oms-card p-4">
          <div className="text-xs text-slate-400 mb-1">追蹤訂單數</div>
          <div className="text-2xl font-bold text-slate-800">{orders.length}</div>
        </div>
        <div className="oms-card p-4">
          <div className="text-xs text-slate-400 mb-1">總收入</div>
          <div className="text-2xl font-bold text-slate-800">{money(summary.revenue)}</div>
        </div>
        <div className="oms-card p-4">
          <div className="text-xs text-slate-400 mb-1">總淨利</div>
          <div className={`text-2xl font-bold ${summary.net >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>{money(summary.net)}</div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-5 gap-5">
        <div className="xl:col-span-3 space-y-3">
          <div className="list-controls">
            <input className="list-search" placeholder="搜尋訂單編號 / 客戶" value={search} onChange={e => setSearch(e.target.value)} onKeyDown={e => e.key === 'Enter' && onSearch()} />
            <select className="oms-input w-40" value={status} onChange={e => setStatus(e.target.value)}>
              <option value="">全部狀態</option>
              <option value="pending">待出貨</option>
              <option value="partial">部分出貨</option>
              <option value="delay">延遲</option>
              <option value="completed">已完成</option>
            </select>
            <button className="btn-primary" onClick={onSearch}>搜尋</button>
          </div>

          <div className="oms-card overflow-hidden">
            {loading ? (
              <div className="flex justify-center py-14"><div className="w-5 h-5 border-2 border-blue-200 border-t-blue-600 rounded-full animate-spin"/></div>
            ) : (
              <div className="overflow-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200">
                      <th className="px-4 py-3 text-left text-[11px] font-semibold text-slate-500 uppercase">訂單</th>
                      <th className="px-4 py-3 text-left text-[11px] font-semibold text-slate-500 uppercase">客戶</th>
                      <th className="px-4 py-3 text-right text-[11px] font-semibold text-slate-500 uppercase">收入</th>
                      <th className="px-4 py-3 text-right text-[11px] font-semibold text-slate-500 uppercase">成本+稅</th>
                      <th className="px-4 py-3 text-right text-[11px] font-semibold text-slate-500 uppercase">淨利</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orders.map(order => {
                      const totalOut = (order.cogs || 0) + (order.operating_cost || 0) + (order.sales_tax || 0) + (order.income_tax || 0) - (order.manual_adjustment || 0)
                      const active = selectedId === order.id
                      return (
                        <tr key={order.id} className={`border-b border-slate-100 cursor-pointer ${active ? 'bg-blue-50/70' : 'hover:bg-slate-50'}`} onClick={() => loadDetail(order.id)}>
                          <td className="px-4 py-3">
                            <div className="font-mono text-xs text-blue-700">{order.po_number}</div>
                            <div className="text-[11px] text-slate-400">{order.po_date ? String(order.po_date).slice(0, 10) : '—'} · {STATUS_LABEL[order.status] || order.status}</div>
                          </td>
                          <td className="px-4 py-3 text-slate-700">{order.customer_name || '—'}</td>
                          <td className="px-4 py-3 text-right text-slate-700 font-medium">{money(order.revenue || 0)}</td>
                          <td className="px-4 py-3 text-right text-slate-600">{money(totalOut)}</td>
                          <td className={`px-4 py-3 text-right font-bold ${(order.net_profit || 0) >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>{money(order.net_profit || 0)}</td>
                        </tr>
                      )
                    })}
                    {!orders.length && (
                      <tr><td colSpan={5} className="px-4 py-12 text-center text-slate-400">查無資料</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        <div className="xl:col-span-2">
          <div className="oms-card p-4 min-h-[500px]">
            {detailLoading ? (
              <div className="flex justify-center py-20"><div className="w-5 h-5 border-2 border-blue-200 border-t-blue-600 rounded-full animate-spin"/></div>
            ) : !detail ? (
              <div className="text-sm text-slate-400 py-16 text-center">請先選擇左側訂單</div>
            ) : (
              <div className="space-y-4">
                <div>
                  <div className="text-xs text-slate-400">{detail.order.customer_name || '—'}</div>
                  <div className="font-mono text-sm font-semibold text-blue-700">{detail.order.po_number}</div>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-lg border border-slate-200 p-2"><span className="text-slate-400">收入</span><div className="font-semibold text-slate-800">{money(detail.summary.revenue)}</div></div>
                  <div className="rounded-lg border border-slate-200 p-2"><span className="text-slate-400">商品成本</span><div className="font-semibold text-slate-800">{money(detail.summary.cogs)}</div></div>
                  <div className="rounded-lg border border-slate-200 p-2"><span className="text-slate-400">營運成本</span><div className="font-semibold text-slate-800">{money(detail.summary.operating_cost)}</div></div>
                  <div className="rounded-lg border border-slate-200 p-2"><span className="text-slate-400">稅金</span><div className="font-semibold text-slate-800">{money((detail.summary.sales_tax || 0) + (detail.summary.income_tax || 0))}</div></div>
                </div>

                <div className="rounded-xl border border-slate-200 p-3 bg-slate-50">
                  <div className="text-xs text-slate-500">淨利</div>
                  <div className={`text-2xl font-bold ${(detail.summary.net_profit || 0) >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>{money(detail.summary.net_profit)}</div>
                  <div className="text-xs text-slate-400 mt-1">Margin {detail.summary.net_margin.toFixed(2)}%</div>
                </div>

                {detailCalc && (
                  <div className="rounded-xl border border-blue-100 bg-blue-50/40 p-3">
                    <div className="text-xs font-semibold text-blue-800">淨利計算邏輯與步驟</div>
                    <div className="text-[11px] text-slate-600 mt-1">
                      公式：淨利 = （毛利 - VAT - CIT） - 營運成本 + 手動調整
                    </div>
                    <div className="text-[11px] text-slate-500 mt-1">
                      其中 VAT/CIT 以毛利為基礎，營運成本以稅後毛利為基礎
                    </div>
                    <div className="mt-2 rounded-lg border border-slate-200 bg-white overflow-hidden">
                      <div className="px-3 py-2 border-b border-slate-100 text-[11px] text-slate-600">
                        1. 毛利 = 收入 - 商品成本 = {money(detailCalc.revenue)} - {money(detailCalc.cogs)} = <span className="font-semibold text-slate-800">{money(detailCalc.gross)}</span>
                      </div>
                      <div className="px-3 py-2 border-b border-slate-100 text-[11px] text-slate-600">
                        2. VAT = 毛利 × VAT% = {money(detailCalc.gross)} × {detailCalc.vatRateOnGross.toFixed(2)}% = <span className="font-semibold text-slate-800">{money(detailCalc.salesTax)}</span>
                      </div>
                      <div className="px-3 py-2 border-b border-slate-100 text-[11px] text-slate-600">
                        3. CIT = 毛利 × CIT% = {money(detailCalc.gross)} × {detailCalc.citRateOnGross.toFixed(2)}% = <span className="font-semibold text-slate-800">{money(detailCalc.incomeTax)}</span>
                      </div>
                      <div className="px-3 py-2 border-b border-slate-100 text-[11px] text-slate-600">
                        4. 稅後毛利 = 毛利 - VAT - CIT = {money(detailCalc.gross)} - {money(detailCalc.salesTax)} - {money(detailCalc.incomeTax)} = <span className="font-semibold text-slate-800">{money(detailCalc.afterTaxGross)}</span>
                      </div>
                      <div className="px-3 py-2 border-b border-slate-100 text-[11px] text-slate-600">
                        5. 營運成本 = 稅後毛利 × 營運% = {money(detailCalc.afterTaxGross)} × {detailCalc.opRateOnAfterTaxGross.toFixed(2)}% = <span className="font-semibold text-slate-800">{money(detailCalc.operatingCost)}</span>
                      </div>
                      <div className="px-3 py-2 text-[11px] text-slate-700">
                        6. 淨利 = 稅後毛利 - 營運成本 + 手動調整 = {money(detailCalc.afterTaxGross)} - {money(detailCalc.operatingCost)} + {money(detailCalc.manualAdjustment)} = <span className={`font-bold ${detailCalc.finalNet >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>{money(detailCalc.finalNet)}</span>
                      </div>
                    </div>
                  </div>
                )}

                <div className="space-y-2">
                  <div className="text-xs font-semibold text-slate-600">自動比例帶入（VAT/CIT 以毛利計，營運成本以稅後毛利計）</div>
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label className="block text-[11px] text-slate-400 mb-1">營運成本%</label>
                      <input
                        className="oms-input text-sm"
                        type="number"
                        min={0}
                        max={100}
                        step="0.01"
                        value={rateConfig.operating_cost_rate}
                        onChange={e => setRateConfig(p => ({ ...p, operating_cost_rate: Number(e.target.value) }))}
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] text-slate-400 mb-1">VAT%</label>
                      <input
                        className="oms-input text-sm"
                        type="number"
                        min={0}
                        max={100}
                        step="0.01"
                        value={rateConfig.vat_rate}
                        onChange={e => setRateConfig(p => ({ ...p, vat_rate: Number(e.target.value) }))}
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] text-slate-400 mb-1">CIT%</label>
                      <input
                        className="oms-input text-sm"
                        type="number"
                        min={0}
                        max={100}
                        step="0.01"
                        value={rateConfig.cit_rate}
                        onChange={e => setRateConfig(p => ({ ...p, cit_rate: Number(e.target.value) }))}
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <button className="btn-ghost border border-slate-200 justify-center" disabled={savingConfig} onClick={saveRateConfig}>
                      {savingConfig ? '儲存中...' : '儲存比例參數'}
                    </button>
                    <button className="btn-primary justify-center" disabled={applyingRates || !selectedId} onClick={applyRatesToOrder}>
                      {applyingRates ? '帶入中...' : '套用到目前訂單'}
                    </button>
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="text-xs font-semibold text-slate-600">新增追蹤項目</div>
                  <select className="oms-input text-sm" value={entryForm.category} onChange={e => setEntryForm(p => ({ ...p, category: e.target.value }))}>
                    {CATEGORY_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                  </select>
                  <input className="oms-input text-sm" placeholder="項目名稱（例：3月物流費）" value={entryForm.description} onChange={e => setEntryForm(p => ({ ...p, description: e.target.value }))} />
                  <input className="oms-input text-sm" type="number" placeholder="金額（manual_adjustment 可負數）" value={entryForm.amount} onChange={e => setEntryForm(p => ({ ...p, amount: e.target.value }))} />
                  <input className="oms-input text-sm" placeholder="備註（可選）" value={entryForm.remark} onChange={e => setEntryForm(p => ({ ...p, remark: e.target.value }))} />
                  <button className="btn-primary w-full justify-center" disabled={savingEntry} onClick={addEntry}>{savingEntry ? '儲存中...' : '加入追蹤'}</button>
                </div>

                <div>
                  <div className="text-xs font-semibold text-slate-600 mb-2">成本/稅金追蹤紀錄</div>
                  <div className="max-h-64 overflow-auto rounded-lg border border-slate-200">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-slate-200 bg-slate-50">
                          <th className="px-2 py-2 text-left text-slate-500">項目</th>
                          <th className="px-2 py-2 text-right text-slate-500">金額</th>
                          <th className="w-10" />
                        </tr>
                      </thead>
                      <tbody>
                        {detail.entries.map(entry => (
                          <tr key={entry.id} className="border-b border-slate-100 last:border-0">
                            <td className="px-2 py-2">
                              <div className="font-medium text-slate-700">{entry.description}</div>
                              <div className="text-[11px] text-slate-400">{CATEGORY_OPTIONS.find(c => c.value === entry.category)?.label || entry.category}</div>
                            </td>
                            <td className={`px-2 py-2 text-right font-semibold ${entry.amount >= 0 ? 'text-slate-700' : 'text-emerald-700'}`}>{money(entry.amount)}</td>
                            <td className="px-2 py-2 text-right"><button className="text-slate-300 hover:text-red-500" onClick={() => removeEntry(entry)}>✕</button></td>
                          </tr>
                        ))}
                        {!detail.entries.length && (
                          <tr><td colSpan={3} className="px-2 py-8 text-center text-slate-400">尚無紀錄</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div>
                  <div className="text-xs font-semibold text-slate-600 mb-2">訂單品項毛利</div>
                  <div className="max-h-56 overflow-auto rounded-lg border border-slate-200">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-slate-200 bg-slate-50">
                          <th className="px-2 py-2 text-left text-slate-500">品項</th>
                          <th className="px-2 py-2 text-right text-slate-500">收入</th>
                          <th className="px-2 py-2 text-right text-slate-500">成本</th>
                          <th className="px-2 py-2 text-right text-slate-500">毛利</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.items.map(item => (
                          <tr key={item.id} className="border-b border-slate-100 last:border-0">
                            <td className="px-2 py-2 text-slate-700">
                              <div className="font-medium">{item.product_name || '—'}</div>
                              <div className="text-[11px] text-slate-400">{item.product_sku || '—'} · Qty {money(item.qty)}</div>
                            </td>
                            <td className="px-2 py-2 text-right">{money(item.line_revenue)}</td>
                            <td className="px-2 py-2 text-right">{money(item.line_cost)}</td>
                            <td className={`px-2 py-2 text-right font-semibold ${item.line_gross >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>{money(item.line_gross)}</td>
                          </tr>
                        ))}
                        {!detail.items.length && (
                          <tr><td colSpan={4} className="px-2 py-8 text-center text-slate-400">尚無品項</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
