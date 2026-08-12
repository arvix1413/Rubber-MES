'use client'

import { useEffect, useState } from 'react'
import { apiFetch } from './api'
import { can } from './usePermissions'

type PoSummary = { status: string }
type QuotationSummary = { status: string }

export function useReviewBadge() {
  // pending_review = awaiting manager approval
  // draft = awaiting employee submit (送審)
  const [poPendingReviewCount, setPoPendingReviewCount] = useState(0)
  const [quotationPendingReviewCount, setQuotationPendingReviewCount] = useState(0)
  const [poPendingSubmitCount, setPoPendingSubmitCount] = useState(0)
  const [quotationPendingSubmitCount, setQuotationPendingSubmitCount] = useState(0)
  const [loading, setLoading] = useState(false)

  const canApprovePo = can('po.approve')
  const canReviewQuotation = can('quotation.approve')
  const canSubmitPo = can('po.create')
  const canSubmitQuotation = can('customer_order.create')

  const load = async () => {
    if (!canApprovePo) setPoPendingReviewCount(0)
    if (!canReviewQuotation) setQuotationPendingReviewCount(0)
    if (!canSubmitPo) setPoPendingSubmitCount(0)
    if (!canSubmitQuotation) setQuotationPendingSubmitCount(0)
    if (!canApprovePo && !canReviewQuotation && !canSubmitPo && !canSubmitQuotation) return

    setLoading(true)
    try {
      const [poRows, quotationRows] = await Promise.all([
        (canApprovePo || canSubmitPo) ? apiFetch<PoSummary[]>('/api/po') : Promise.resolve([]),
        (canReviewQuotation || canSubmitQuotation) ? apiFetch<QuotationSummary[]>('/api/quotations') : Promise.resolve([]),
      ])
      const pos = poRows || []
      const quotations = quotationRows || []
      setPoPendingReviewCount(canApprovePo ? pos.filter((row) => row.status === 'pending_review').length : 0)
      setQuotationPendingReviewCount(canReviewQuotation ? quotations.filter((row) => row.status === 'pending_review').length : 0)
      setPoPendingSubmitCount(canSubmitPo ? pos.filter((row) => row.status === 'draft').length : 0)
      setQuotationPendingSubmitCount(canSubmitQuotation ? quotations.filter((row) => row.status === 'draft').length : 0)
    } catch {
      setPoPendingReviewCount(0)
      setQuotationPendingReviewCount(0)
      setPoPendingSubmitCount(0)
      setQuotationPendingSubmitCount(0)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
    const onMutation = (event: Event) => {
      const detail = (event as CustomEvent).detail || {}
      const path = String(detail.path || '')
      if (detail.phase === 'end' && detail.ok && (path.startsWith('/api/po') || path.startsWith('/api/quotations'))) {
        void load()
      }
    }
    const onFocus = () => void load()
    window.addEventListener('rubber:mutation', onMutation as EventListener)
    window.addEventListener('focus', onFocus)
    return () => {
      window.removeEventListener('rubber:mutation', onMutation as EventListener)
      window.removeEventListener('focus', onFocus)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canApprovePo, canReviewQuotation, canSubmitPo, canSubmitQuotation])

  return {
    canApprovePo,
    canReviewQuotation,
    canSubmitPo,
    canSubmitQuotation,
    // legacy aliases used by existing dashboard/layout
    poDraftCount: poPendingReviewCount,
    quotationDraftCount: quotationPendingReviewCount,
    poPendingReviewCount,
    quotationPendingReviewCount,
    poPendingSubmitCount,
    quotationPendingSubmitCount,
    loading,
    refresh: load,
  }
}
