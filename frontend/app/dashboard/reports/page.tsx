'use client'
import { useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api'

type MonthData = { month: string; invoiced?: number; received?: number; total?: number; paid?: number; count: number }
type Summary = {
  total_invoiced: number; total_received: number; total_outstanding_receivable: number
  total_payable: number; total_paid: number; total_outstanding_payable: number
}
type ReportData = { receivables: MonthData[]; payables: MonthData[]; summary: Summary; year: string }

const MONTHS = ['01','02','03','04','05','06','07','08','09','10','11','12']

export default function ReportsPage() {
  const [data, setData] = useState<ReportData | null>(null)
  const [loading, setLoading] = useState(true)
  const [year, setYear] = useState(new Date().getFullYear().toString())

  const load = (y: string) => {
    setLoading(true)
    apiFetch<ReportData>(`/api/reports?year=${y}`).then(setData).finally(() => setLoading(false))
  }
  useEffect(() => { load(year) }, [year])

  const getMonthAR = (m: string) => data?.receivables.find(r => r.month === `${year}-${m}`)
  const getMonthAP = (m: string) => data?.payables.find(r => r.month === `${year}-${m}`)

  const s = data?.summary

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-slate-800">報表功能</h1>
          <p className="text-xs text-slate-400 mt-0.5">收入支出匯總</p>
        </div>
        <select className="oms-input w-28" value={year} onChange={e => setYear(e.target.value)}>
          {[2024, 2025, 2026, 2027].map(y => <option key={y}>{y}</option>)}
        </select>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-8">
        <div className="oms-card p-5">
          <div className="text-xs text-slate-400 mb-1">應收總額</div>
          <div className="text-2xl font-bold text-slate-800">{(s?.total_invoiced||0).toLocaleString()}</div>
          <div className="text-xs text-slate-400 mt-1">已收 {(s?.total_received||0).toLocaleString()}</div>
        </div>
        <div className="oms-card p-5">
          <div className="text-xs text-slate-400 mb-1">待收款</div>
          <div className="text-2xl font-bold text-amber-500">{(s?.total_outstanding_receivable||0).toLocaleString()}</div>
          <div className="text-xs text-slate-400 mt-1">未收回款項</div>
        </div>
        <div className="oms-card p-5">
          <div className="text-xs text-slate-400 mb-1">應付總額</div>
          <div className="text-2xl font-bold text-slate-800">{(s?.total_payable||0).toLocaleString()}</div>
          <div className="text-xs text-slate-400 mt-1">已付 {(s?.total_paid||0).toLocaleString()}</div>
        </div>
        <div className="oms-card p-5">
          <div className="text-xs text-slate-400 mb-1">待付款</div>
          <div className="text-2xl font-bold text-red-500">{(s?.total_outstanding_payable||0).toLocaleString()}</div>
          <div className="text-xs text-slate-400 mt-1">未付供應商款項</div>
        </div>
        <div className="oms-card p-5 col-span-2">
          <div className="text-xs text-slate-400 mb-1">淨收益（已收 - 已付）</div>
          <div className={`text-2xl font-bold ${(s?.total_received||0)-(s?.total_paid||0) >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
            {((s?.total_received||0) - (s?.total_paid||0)).toLocaleString()}
          </div>
        </div>
      </div>

      {/* Monthly table */}
      {loading ? (
        <div className="flex justify-center py-16"><div className="w-5 h-5 border-2 border-blue-200 border-t-blue-600 rounded-full animate-spin" /></div>
      ) : (
        <div className="oms-card overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-100">
            <span className="text-sm font-semibold text-slate-700">{year} 年月度明細</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200">
                  <th className="px-4 py-3 text-left text-[11px] font-semibold text-slate-500 uppercase">月份</th>
                  <th className="px-4 py-3 text-right text-[11px] font-semibold text-slate-500 uppercase">應收（出貨）</th>
                  <th className="px-4 py-3 text-right text-[11px] font-semibold text-emerald-600 uppercase">已收款</th>
                  <th className="px-4 py-3 text-right text-[11px] font-semibold text-slate-500 uppercase">應付（採購）</th>
                  <th className="px-4 py-3 text-right text-[11px] font-semibold text-red-500 uppercase">已付款</th>
                  <th className="px-4 py-3 text-right text-[11px] font-semibold text-blue-600 uppercase">月淨收益</th>
                </tr>
              </thead>
              <tbody>
                {MONTHS.map(m => {
                  const ar = getMonthAR(m)
                  const ap = getMonthAP(m)
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
      )}
    </div>
  )
}
