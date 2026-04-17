'use client'
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { apiFetch } from '@/lib/api'

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

const fmt = (n: number) => Number(n || 0).toLocaleString()

export default function DashboardPage() {
  const [stats, setStats] = useState<any>(null)
  const [health, setHealth] = useState<ProcessHealth | null>(null)

  useEffect(() => {
    apiFetch<any>('/api/stats').then(setStats).catch(() => {})
    apiFetch<ProcessHealth>('/api/process-health').then(setHealth).catch(() => {})
  }, [])

  const flow = useMemo(() => {
    const invoicePending = (health?.pending_customer_invoice_items || 0) + (health?.pending_supplier_invoice_items || 0)
    return [
      { step: '01', title: '客戶下單', desc: '建立客戶訂單與交期', href: '/dashboard/customer-orders', metric: fmt(stats?.orders_count || 0), tag: '訂單數' },
      { step: '02', title: '收集訂單', desc: '統一訂單收集池追蹤', href: '/dashboard/order-intake', metric: fmt(stats?.orders_count || 0), tag: '追蹤中' },
      { step: '03', title: '採購下單', desc: '按客戶進度切分 PO', href: '/dashboard/po', metric: fmt(stats?.po_count || 0), tag: 'PO 數' },
      { step: '04', title: '安排出貨', desc: '建立出貨單並回寫數量', href: '/dashboard/delivery-notes', metric: fmt(stats?.delivery_count || 0), tag: '出貨單' },
      { step: '05', title: '數量核對', desc: '核對實際出貨與訂單', href: '/dashboard/shipment-reconciliation', metric: fmt(health?.pending_reconciliation_items || 0), tag: '待核對' },
      { step: '06', title: '開立發票', desc: '客戶/供應商雙向發票', href: '/dashboard/invoices', metric: fmt(invoicePending), tag: '待開票' },
      { step: '07', title: '供應商付款', desc: '處理應付並追蹤狀態', href: '/dashboard/payables', metric: fmt(health?.overdue_payables?.invoice_count || 0), tag: '逾期筆數' },
      { step: '08', title: '庫存扣減', desc: '依出貨數量更新庫存', href: '/dashboard/inventory', metric: fmt(stats?.low_stock_count || 0), tag: '低庫存' },
    ]
  }, [stats, health])

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-3xl border border-[#d7c8b4] bg-[linear-gradient(140deg,#fff7ec_0%,#f5e7d5_48%,#ecd6bd_100%)] p-6 shadow-[0_20px_50px_rgba(113,80,45,0.2)]">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="mb-2 inline-flex rounded-full border border-[#d8b58f] bg-[#fff2e1] px-3 py-1 text-[11px] font-semibold tracking-[0.12em] text-[#7d5832]">
              FLOW ONLY MODE
            </div>
            <h1 className="brand-font text-3xl font-bold text-[#3a2b1d]">Rubber 流程控制臺</h1>
            <p className="mt-2 text-sm text-[#6c5440]">
              僅保留與參考流程相關頁面：客戶訂單 → 訂單收集 → PO 下單 → 出貨 → 核對 → 開票 → 付款 → 庫存扣減
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
          </Link>
        ))}
      </section>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="rubber-card p-5 xl:col-span-2">
          <h2 className="brand-font text-lg font-bold text-[#3c2f24]">流程異常提醒</h2>
          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
            <Link href="/dashboard/shipment-reconciliation" className="rounded-xl border border-[#e7c4ba] bg-[#fff4f1] p-3">
              <div className="text-xs text-[#9f5946]">待核對數量</div>
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
