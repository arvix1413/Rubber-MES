'use client'

import { useEffect, useState } from 'react'
import { apiFetch } from './api'
import { can } from './usePermissions'

type PoSummary = { status: string }
type QuotationSummary = { status: string }

export function useReviewBadge() {
  // Counts documents awaiting approval (status=pending_review), not drafts.
  const [poDraftCount, setPoDraftCount] = useState(0)
  const [quotationDraftCount, setQuotationDraftCount] = useState(0)
  const [loading, setLoading] = useState(false)
  const canApprovePo = can('po.approve')
  const canReviewQuotation = can('quotation.approve')

  const load = async () => {
    if (!canApprovePo) setPoDraftCount(0)
    if (!canReviewQuotation) setQuotationDraftCount(0)
    if (!canApprovePo && !canReviewQuotation) return

    setLoading(true)
    try {
      const [poRows, quotationRows] = await Promise.all([
        canApprovePo ? apiFetch<PoSummary[]>('/api/po') : Promise.resolve([]),
        canReviewQuotation ? apiFetch<QuotationSummary[]>('/api/quotations') : Promise.resolve([]),
      ])
      setPoDraftCount((poRows || []).filter((row) => row.status === 'pending_review').length)
      setQuotationDraftCount((quotationRows || []).filter((row) => row.status === 'pending_review').length)
    } catch {
      setPoDraftCount(0)
      setQuotationDraftCount(0)
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
  }, [canApprovePo, canReviewQuotation])

  return {
    canApprovePo,
    canReviewQuotation,
    poDraftCount,
    quotationDraftCount,
    loading,
    refresh: load,
  }
}
