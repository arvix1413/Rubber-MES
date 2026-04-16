'use client'
import { useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api'
import Link from 'next/link'

type ReportData = {
  receivables: { month: string; invoiced: number; received: number; count: number }[]
  payables: { month: string; total: number; paid: number; count: number }[]
  summary: {
    total_invoiced: number; total_received: number; total_outstanding_receivable: number
    total_payable: number; total_paid: number; total_outstanding_payable: number
  }
  year: string
}

const MONTHS = ['01','02','03','04','05','06','07','08','09','10','11','12']

export default function DashboardPage() {
  const [stats, setStats] = useState<any>(null)
  const [report, setReport] = useState<ReportData | null>(null)
  const [tab, setTab] = useState<'overview' | 'report'>('overview')
  const [year, setYear] = useState(new Date().getFullYear().toString())
  const now = new Date()
  const monthLabel = `${now.getFullYear()}年${now.getMonth()+1}月`

  useEffect(() => {
    apiFetch<any>('/api/stats').then(setStats).catch(() => {})
  }, [])

  useEffect(() => {
    if (tab === 'report') {
      apiFetch<ReportData>(`/api/reports?year=${year}`).then(setReport).catch(() => {})
    }
  }, [tab, year])

  const fmt = (n: number) => {
    if (!n) return '0'
    if (n >= 1_000_000_000) return (n/1_000_000_000).toFixed(2)+'B'
    if (n >= 1_000_000) return (n/1_000_000).toFixed(1)+'M'
    if (n >= 1000) return (n/1000).toFixed(0)+'K'
    return n.toLocaleString()
  }

  const kpis = [
    { label: '客戶數', value: stats?.customers ?? '—', icon: '👥', color: 'text-blue-700', bg: 'bg-blue-100', border: 'border-blue-200' },
    { label: '料號數', value: stats?.materials ?? '—', icon: '🔩', color: 'text-violet-700', bg: 'bg-violet-100', border: 'border-violet-200' },
    { label: '供應商', value: stats?.suppliers ?? '—', icon: '🏭', color: 'text-amber-700', bg: 'bg-amber-100', border: 'border-amber-200' },
    { label: '客戶訂單', value: stats?.orders_count ?? '—', icon: '📦', color: 'text-emerald-700', bg: 'bg-emerald-100', border: 'border-emerald-200' },
    { label: '零庫存品項', value: stats?.low_stock_count ?? '—', icon: '⚠️', color: stats?.low_stock_count > 0 ? 'text-red-600' : 'text-emerald-700', bg: stats?.low_stock_count > 0 ? 'bg-red-100' : 'bg-emerald-100', border: stats?.low_stock_count > 0 ? 'border-red-200' : 'border-emerald-200', href: '/dashboard/inventory' },
  ]

  const quick = [
    // { href: '/dashboard/materials', label: '新增料號', desc: '建立物料主檔' }, // 暫時隱藏
    { href: '/dashboard/bom', label: '建立 BOM', desc: '產品物料清單' },
    { href: '/dashboard/po', label: '建立採購單', desc: '向供應商採購' },
    { href: '/dashboard/customer-orders', label: '新增客戶訂單', desc: '記錄客戶需求' },
  ]

  const hasMonthSales = stats?.month_sales > 0
  const salesValue = hasMonthSales ? stats.month_sales : stats?.total_sales
  const salesLabel = hasMonthSales ? `${monthLabel} 銷售金額` : '累計銷售金額'
  const salesSub = hasMonthSales
    ? `本月共 ${stats.month_orders} 筆訂單`
    : stats?.sales_date_range ? `訂單期間：${stats.sales_date_range}` : `共 ${stats?.orders_count ?? 0} 筆訂單`

  const s = report?.summary

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-slate-800">系統總覽</h1>
          <p className="text-sm text-slate-500 mt-0.5">FAN YONG CO., LTD · 歡迎回來</p>
        </div>
        {/* Tabs */}
        <div className="flex bg-slate-100 rounded-lg p-1 gap-1">
          <button onClick={() => setTab('overview')}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${tab === 'overview' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
            概覽
          </button>
          <button onClick={() => setTab('report')}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${tab === 'report' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
            財務報表
          </button>
        </div>
      </div>

      {tab === 'overview' && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <div className="md:col-span-2 rounded-xl p-6 bg-gradient-to-br from-blue-600 to-blue-700 text-white shadow-sm">
              <div className="text-xs font-semibold text-blue-200 uppercase tracking-wider mb-1">{salesLabel}</div>
              <div className="text-4xl font-bold mb-1">
                {stats ? fmt(salesValue || 0) : '—'}
                <span className="text-lg font-normal text-blue-200 ml-2">VND</span>
              </div>
              <div className="text-sm text-blue-200">{stats ? salesSub : '載入中...'}</div>
              <div className="mt-4 pt-4 border-t border-blue-500/40 flex items-center justify-between text-xs text-blue-200">
                <span>已收貨採購額：{stats ? fmt(stats.po_total || 0) : '—'} VND</span>
                <Link href="/dashboard/customer-orders" className="hover:text-white transition-colors">檢視訂單 →</Link>
              </div>
            </div>
            <div className="oms-card p-5 flex flex-col justify-between">
              <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">採購概況</div>
              <div>
                <div className="text-3xl font-bold text-slate-800 mb-0.5">{stats?.po_count ?? '—'}</div>
                <div className="text-sm text-slate-600">已確認採購單</div>
              </div>
              <div className="mt-4 pt-4 border-t border-slate-100">
                <div className="text-xs text-slate-500 font-medium">採購總額</div>
                <div className="text-lg font-bold text-slate-800">{stats ? fmt(stats.po_total || 0) : '—'} <span className="text-xs font-normal text-slate-500">VND</span></div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
            {kpis.map(c => (
              <div key={c.label} className={`oms-card p-4 border ${c.border} ${(c as any).href ? 'cursor-pointer hover:shadow-md transition-shadow' : ''}`}
                onClick={() => (c as any).href && (window.location.href = (c as any).href)}>
                <div className={`w-9 h-9 rounded-lg ${c.bg} flex items-center justify-center text-lg mb-3`}>{c.icon}</div>
                <div className={`text-2xl font-bold ${c.color} mb-0.5`}>{c.value}</div>
                <div className="text-xs text-slate-600 font-semibold">{c.label}</div>
              </div>
            ))}
          </div>

          <div className="oms-card p-5">
            <div className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-4">快速操作</div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {quick.map(a => (
                <Link key={a.href} href={a.href}
                  className="group p-4 rounded-lg border border-slate-200 hover:border-blue-300 hover:bg-blue-50 transition-all">
                  <div className="text-sm font-semibold text-slate-700 group-hover:text-blue-700 mb-1">{a.label}</div>
                  <div className="text-xs text-slate-500">{a.desc}</div>
                </Link>
              ))}
            </div>
          </div>
        </>
      )}

      {tab === 'report' && (
        <>
          <div className="flex items-center justify-between mb-4">
            <span className="text-sm font-semibold text-slate-700">財務收支報表</span>
            <select className="oms-input w-28" value={year} onChange={e => setYear(e.target.value)}>
              {[2024, 2025, 2026, 2027].map(y => <option key={y}>{y}</option>)}
            </select>
          </div>

          {/* Summary cards */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
            <div className="oms-card p-5">
              <div className="text-xs text-slate-400 mb-1">應收總額（客戶訂單）</div>
              <div className="text-2xl font-bold text-slate-800">{(s?.total_invoiced||0).toLocaleString()}</div>
              <div className="text-xs text-slate-400 mt-1">已收 {(s?.total_received||0).toLocaleString()}</div>
            </div>
            <div className="oms-card p-5">
              <div className="text-xs text-slate-400 mb-1">待收款</div>
              <div className="text-2xl font-bold text-amber-500">{(s?.total_outstanding_receivable||0).toLocaleString()}</div>
            </div>
            <div className="oms-card p-5">
              <div className="text-xs text-slate-400 mb-1">應付總額（採購單）</div>
              <div className="text-2xl font-bold text-slate-800">{(s?.total_payable||0).toLocaleString()}</div>
              <div className="text-xs text-slate-400 mt-1">已付 {(s?.total_paid||0).toLocaleString()}</div>
            </div>
            <div className="oms-card p-5">
              <div className="text-xs text-slate-400 mb-1">待付款</div>
              <div className="text-2xl font-bold text-red-500">{(s?.total_outstanding_payable||0).toLocaleString()}</div>
            </div>
            <div className="oms-card p-5 col-span-2">
              <div className="text-xs text-slate-400 mb-1">淨收益（已收 - 已付）</div>
              <div className={`text-2xl font-bold ${(s?.total_received||0)-(s?.total_paid||0) >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                {((s?.total_received||0)-(s?.total_paid||0)).toLocaleString()}
              </div>
            </div>
          </div>

          {/* Monthly table */}
          <div className="oms-card overflow-hidden">
            <div className="px-5 py-3 border-b border-slate-100">
              <span className="text-sm font-semibold text-slate-700">{year} 年月度明細</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200">
                    <th className="px-4 py-3 text-left text-[11px] font-semibold text-slate-500 uppercase">月份</th>
                    <th className="px-4 py-3 text-right text-[11px] font-semibold text-slate-500 uppercase">應收（訂單）</th>
                    <th className="px-4 py-3 text-right text-[11px] font-semibold text-emerald-600 uppercase">已收款</th>
                    <th className="px-4 py-3 text-right text-[11px] font-semibold text-slate-500 uppercase">應付（採購）</th>
                    <th className="px-4 py-3 text-right text-[11px] font-semibold text-red-500 uppercase">已付款</th>
                    <th className="px-4 py-3 text-right text-[11px] font-semibold text-blue-600 uppercase">月淨收益</th>
                  </tr>
                </thead>
                <tbody>
                  {MONTHS.map(m => {
                    const ar = report?.receivables.find(r => r.month === `${year}-${m}`)
                    const ap = report?.payables.find(r => r.month === `${year}-${m}`)
                    const invoiced = ar?.invoiced || 0
                    const received = ar?.received || 0
                    const payable = ap?.total || 0
                    const paid = ap?.paid || 0
                    const net = received - paid
                    const hasData = invoiced > 0 || payable > 0
                    return (
                      <tr key={m} className={`border-b border-slate-100 ${hasData ? '' : 'opacity-40'}`}>
                        <td className="px-4 py-3 font-medium text-slate-700">{year}-{m}</td>
                        <td className="px-4 py-3 text-right text-slate-600">{invoiced > 0 ? invoiced.toLocaleString() : '—'}</td>
                        <td className="px-4 py-3 text-right text-emerald-600 font-medium">{received > 0 ? received.toLocaleString() : '—'}</td>
                        <td className="px-4 py-3 text-right text-slate-600">{payable > 0 ? payable.toLocaleString() : '—'}</td>
                        <td className="px-4 py-3 text-right text-red-500 font-medium">{paid > 0 ? paid.toLocaleString() : '—'}</td>
                        <td className={`px-4 py-3 text-right font-bold ${net > 0 ? 'text-emerald-600' : net < 0 ? 'text-red-500' : 'text-slate-400'}`}>
                          {hasData ? net.toLocaleString() : '—'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-slate-200 bg-slate-50">
                    <td className="px-4 py-3 font-bold text-slate-700">全年合計</td>
                    <td className="px-4 py-3 text-right font-bold text-slate-700">{(s?.total_invoiced||0).toLocaleString()}</td>
                    <td className="px-4 py-3 text-right font-bold text-emerald-600">{(s?.total_received||0).toLocaleString()}</td>
                    <td className="px-4 py-3 text-right font-bold text-slate-700">{(s?.total_payable||0).toLocaleString()}</td>
                    <td className="px-4 py-3 text-right font-bold text-red-500">{(s?.total_paid||0).toLocaleString()}</td>
                    <td className={`px-4 py-3 text-right font-bold ${(s?.total_received||0)-(s?.total_paid||0) >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                      {((s?.total_received||0)-(s?.total_paid||0)).toLocaleString()}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
