'use client'
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { apiFetch } from '@/lib/api'
import { getCompany, getCompanyDisplayName } from '@/lib/useCompany'
import { formatInteger } from '@/lib/numberFormat'
import { useReviewBadge } from '@/lib/useReviewBadge'

type ProcessHealth = {
  generated_at: string
  pending_reconciliation_items: number
  pending_customer_invoice_items: number
  pending_customer_invoice_qty: number
  pending_supplier_invoice_items: number
  pending_supplier_invoice_qty: number
  overdue_receivables: { invoice_count: number; outstanding_amount: number }
  overdue_payables: { invoice_count: number; outstanding_amount: number }
}

const fmt = (n: number) => formatInteger(n || 0)
const formatPurchaseTotals = (rows: Array<{ currency?: string; total?: number }> | undefined, fallback: number) => {
  if (!Array.isArray(rows) || rows.length === 0) return fmt(fallback)
  return rows.map((row) => `${row.currency || 'VND'} ${fmt(Number(row.total || 0))}`).join(' · ')
}

export default function DashboardPage() {
  const [stats, setStats] = useState<any>(null)
  const [health, setHealth] = useState<ProcessHealth | null>(null)
  const [companyName, setCompanyName] = useState('')
  const { canApprovePo, poDraftCount } = useReviewBadge()

  useEffect(() => {
    apiFetch<any>('/api/stats').then(setStats).catch(() => {})
    apiFetch<ProcessHealth>('/api/process-health').then(setHealth).catch(() => {})
    getCompany().then((c) => setCompanyName(getCompanyDisplayName(c))).catch(() => {})
  }, [])

  const flow = useMemo(() => {
    const invoicePending = (health?.pending_customer_invoice_items || 0) + (health?.pending_supplier_invoice_items || 0)
    return [
      { step: '01', title: '客戶下單', desc: '建立客戶訂單與交期', href: '/dashboard/customer-orders', metric: fmt(stats?.orders_count || 0), tag: '訂單數' },
      { step: '02', title: '交期進度', desc: '依客戶通知進度追蹤需求', href: '/dashboard/order-intake', metric: fmt(stats?.progress_count || 0), tag: '進度數' },
      { step: '03', title: '採購下單', desc: '依交期進度生成採購單', href: '/dashboard/po', metric: fmt(stats?.po_count || 0), tag: '有效 PO', secondaryLabel: '採購總額', secondaryMetric: formatPurchaseTotals(stats?.po_totals_by_currency, stats?.po_total || 0) },
      { step: '04', title: '安排出貨', desc: '建立出貨單並回寫數量', href: '/dashboard/delivery-notes', metric: fmt(stats?.delivery_count || 0), tag: '出貨單' },
      { step: '05', title: '數量核對', desc: '自動記錄實際出貨與訂單', href: '/dashboard/shipment-reconciliation', metric: fmt(stats?.reconciliation_count || 0), tag: '記錄數' },
      { step: '06', title: '開立發票', desc: '客戶/供應商雙向發票', href: '/dashboard/invoices', metric: fmt(invoicePending), tag: '待開票' },
      { step: '07', title: '供應商付款', desc: '處理應付並追蹤狀態', href: '/dashboard/payables', metric: fmt(health?.overdue_payables?.invoice_count || 0), tag: '逾期筆數' },
    ]
  }, [stats, health])

  return (
    <div className="space-y-6">
      {canApprovePo && poDraftCount > 0 ? (
        <Link
          href="/dashboard/po"
          className="block overflow-hidden rounded-3xl border border-[#f0b3a9] bg-[linear-gradient(135deg,#fff0ed_0%,#ffd7cf_52%,#ffc2b4_100%)] p-5 shadow-[0_18px_45px_rgba(163,48,25,0.18)] transition-all hover:-translate-y-0.5 hover:shadow-[0_24px_55px_rgba(163,48,25,0.24)]"
        >
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="inline-flex rounded-full bg-white/70 px-3 py-1 text-[11px] font-black tracking-[0.14em] text-[#aa3722]">
                REVIEW ALERT
              </div>
              <h2 className="mt-3 text-2xl font-extrabold text-[#6b2317]">你有 {fmt(poDraftCount)} 筆採購單待審核</h2>
              <p className="mt-2 text-sm text-[#8f4330]">登入後優先處理尚未審核的 PO，避免後續送出與收貨流程卡住。</p>
            </div>
            <div className="flex items-center gap-3">
              <div className="rounded-2xl border border-white/70 bg-white/65 px-5 py-3 text-center">
                <div className="text-[12px] font-semibold text-[#9b4b36]">尚未審核</div>
                <div className="mt-1 text-4xl font-black leading-none text-[#c73622]">{fmt(poDraftCount)}</div>
              </div>
              <div className="inline-flex items-center rounded-2xl bg-[#c73622] px-4 py-3 text-sm font-bold text-white shadow-[0_12px_24px_rgba(199,54,34,0.28)]">
                立即前往 →
              </div>
            </div>
          </div>
        </Link>
      ) : null}

      <section className="overflow-hidden rounded-3xl border border-[#d7c8b4] bg-[linear-gradient(140deg,#fff7ec_0%,#f5e7d5_48%,#ecd6bd_100%)] p-6 shadow-[0_20px_50px_rgba(113,80,45,0.2)]">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="mb-2 inline-flex rounded-full border border-[#d8b58f] bg-[#fff2e1] px-3 py-1 text-[11px] font-semibold tracking-[0.12em] text-[#7d5832]">
              FLOW ONLY MODE
            </div>
            <h1 className="brand-font text-3xl font-bold text-[#3a2b1d]">{companyName ? `${companyName} 流程控制臺` : '流程控制臺'}</h1>
            <p className="mt-2 text-sm text-[#6c5440]">
              僅保留與參考流程相關頁面：客戶訂單 → 交期進度 → PO 下單 → 出貨 → 核對 → 開票 → 付款
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 text-right">
            <div className="rounded-xl border border-[#dcc5a7] bg-white/70 px-3 py-2">
              <div className="text-[11px] text-[#8a6b49]">總銷售額</div>
              <div className="text-lg font-bold text-[#4f351d]">{fmt(stats?.total_sales || 0)}</div>
            </div>
            <div className="rounded-xl border border-[#dcc5a7] bg-white/70 px-3 py-2">
              <div className="text-[11px] text-[#8a6b49]">本月訂單</div>
              <div className="text-lg font-bold text-[#4f351d]">{fmt(stats?.month_orders || 0)}</div>
            </div>
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        {flow.map((item) => (
          <Link
            key={item.step}
            href={item.href}
            className="group rounded-2xl border border-[#dccfbe] bg-[linear-gradient(180deg,#fffdfa_0%,#f5eee4_100%)] p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:border-[#c59e70] hover:shadow-[0_16px_26px_rgba(86,63,39,0.18)]"
          >
            <div className="mb-2 flex items-center justify-between">
              <span className="rounded-full border border-[#e2c6a3] bg-[#fff4e6] px-2 py-0.5 text-[10px] font-bold text-[#9b632b]">STEP {item.step}</span>
              <span className="text-[11px] font-semibold text-[#7c6a57]">{item.tag}</span>
            </div>
            <div className="text-base font-bold text-[#372c21]">{item.title}</div>
            <div className="mt-1 text-xs leading-5 text-[#7d6d5a]">{item.desc}</div>
            <div className="mt-3 text-2xl font-extrabold text-[#4f351d]">{item.metric}</div>
            {item.secondaryMetric ? (
              <div className="mt-2 flex items-center justify-between border-t border-[#e4d7c5] pt-2">
                <span className="text-[11px] font-semibold text-[#7c6a57]">{item.secondaryLabel}</span>
                <span className="text-sm font-bold text-[#6f4b29]">{item.secondaryMetric}</span>
              </div>
            ) : null}
          </Link>
        ))}
      </section>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="rubber-card p-5 xl:col-span-2">
          <h2 className="brand-font text-lg font-bold text-[#3c2f24]">流程異常提醒</h2>
          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
            <Link href="/dashboard/shipment-reconciliation" className="rounded-xl border border-[#e7c4ba] bg-[#fff4f1] p-3">
              <div className="text-xs text-[#9f5946]">未生成核對記錄</div>
              <div className="mt-1 text-xl font-bold text-[#8b3f2a]">{fmt(health?.pending_reconciliation_items || 0)}</div>
            </Link>
            <Link href="/dashboard/invoices" className="rounded-xl border border-[#e4cfb3] bg-[#fff7eb] p-3">
              <div className="text-xs text-[#8f6941]">待開票項目</div>
              <div className="mt-1 text-xl font-bold text-[#744b1f]">
                {fmt((health?.pending_customer_invoice_items || 0) + (health?.pending_supplier_invoice_items || 0))}
              </div>
            </Link>
            <Link href="/dashboard/payables" className="rounded-xl border border-[#e6d0c3] bg-[#fff6ef] p-3">
              <div className="text-xs text-[#95624c]">逾期應付</div>
              <div className="mt-1 text-xl font-bold text-[#7e4027]">{fmt(health?.overdue_payables?.outstanding_amount || 0)}</div>
            </Link>
            <Link href="/dashboard/invoices" className="rounded-xl border border-[#d9d0be] bg-[#f9f5ee] p-3">
              <div className="text-xs text-[#756652]">逾期應收</div>
              <div className="mt-1 text-xl font-bold text-[#5a4d3b]">{fmt(health?.overdue_receivables?.outstanding_amount || 0)}</div>
            </Link>
          </div>
        </div>

        <div className="rubber-card p-5">
          <h2 className="brand-font text-lg font-bold text-[#3c2f24]">主檔維護</h2>
          <p className="mt-1 text-xs text-[#7d6d5a]">流程依賴主資料，保留最小必要頁面。</p>
          <div className="mt-4 space-y-2">
            <Link href="/dashboard/bom" className="btn-ghost w-full justify-between">產品規格/BOM <span>→</span></Link>
            <Link href="/dashboard/customers" className="btn-ghost w-full justify-between">客戶資料 <span>→</span></Link>
            <Link href="/dashboard/suppliers" className="btn-ghost w-full justify-between">供應商資料 <span>→</span></Link>
          </div>
        </div>
      </section>
    </div>
  )
}
