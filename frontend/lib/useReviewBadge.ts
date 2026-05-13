'use client'

import { useEffect, useState } from 'react'
import { apiFetch } from './api'
import { can } from './usePermissions'

type PoSummary = { status: string }

export function useReviewBadge() {
  const [poDraftCount, setPoDraftCount] = useState(0)
  const [loading, setLoading] = useState(false)
  const canApprovePo = can('po.approve')

  const load = async () => {
    if (!canApprovePo) {
      setPoDraftCount(0)
      return
    }
    setLoading(true)
    try {
      const rows = await apiFetch<PoSummary[]>('/api/po')
      setPoDraftCount((rows || []).filter((row) => row.status === 'draft').length)
    } catch {
      setPoDraftCount(0)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
    const onMutation = (event: Event) => {
      const detail = (event as CustomEvent).detail || {}
      if (detail.phase === 'end' && detail.ok && String(detail.path || '').startsWith('/api/po')) {
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
  }, [canApprovePo])

  return {
    canApprovePo,
    poDraftCount,
    loading,
    refresh: load,
  }
}
