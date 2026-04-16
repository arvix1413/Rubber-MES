'use client'

import { useState } from 'react'
import { API } from '@/lib/api'

type VerifyResp = {
  ok: boolean
  invoice_no: string
  status: string
  party_name: string
  grand_total: number
  invoice_date: string
}

export default function InvoiceVerifyPage() {
  const [invoiceNo, setInvoiceNo] = useState('')
  const [code, setCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<VerifyResp | null>(null)
  const [error, setError] = useState('')

  const verify = async () => {
    const no = invoiceNo.trim()
    const vc = code.trim()
    if (!no || !vc) {
      setError('請輸入發票號與驗證碼')
      return
    }
    setLoading(true)
    setError('')
    setResult(null)
    try {
      const res = await fetch(`${API}/api/public/invoices/verify?invoice_no=${encodeURIComponent(no)}&code=${encodeURIComponent(vc)}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || '驗證失敗')
      setResult(data as VerifyResp)
    } catch (e: any) {
      setError(e.message || '驗證失敗')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-slate-800">發票驗證</h1>
        <p className="text-xs text-slate-500 mt-1">輸入發票號與防偽驗證碼，驗證發票真偽。</p>
      </div>

      <div className="oms-card p-6 max-w-2xl">
        <div className="grid md:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-slate-500 mb-1">發票號</label>
            <input className="oms-input" value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} placeholder="例如 CINV-202604-0001" />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">驗證碼</label>
            <input className="oms-input" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="12位驗證碼" />
          </div>
        </div>
        <div className="mt-4">
          <button className="btn-primary" disabled={loading} onClick={verify}>{loading ? '驗證中...' : '驗證發票'}</button>
        </div>

        {error && <div className="mt-4 text-sm text-red-600">{error}</div>}

        {result && (
          <div className={`mt-4 p-4 rounded-xl border ${result.ok ? 'border-emerald-300 bg-emerald-50' : 'border-red-300 bg-red-50'}`}>
            <div className={`text-sm font-semibold ${result.ok ? 'text-emerald-700' : 'text-red-700'}`}>{result.ok ? '驗證成功' : '驗證失敗'}</div>
            <div className="text-xs text-slate-700 mt-2 space-y-1">
              <div>發票號：<span className="font-mono">{result.invoice_no}</span></div>
              <div>對象：{result.party_name || '-'}</div>
              <div>日期：{result.invoice_date ? String(result.invoice_date).slice(0, 10) : '-'}</div>
              <div>狀態：{result.status || '-'}</div>
              <div>金額：{Number(result.grand_total || 0).toLocaleString()}</div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
