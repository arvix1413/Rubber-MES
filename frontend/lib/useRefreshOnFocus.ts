import { useEffect, useRef } from 'react'

export function useRefreshOnFocus(refresh: () => void | Promise<void>) {
  const refreshRef = useRef(refresh)

  useEffect(() => {
    refreshRef.current = refresh
  }, [refresh])

  useEffect(() => {
    const runRefresh = () => {
      void refreshRef.current()
    }

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') runRefresh()
    }

    window.addEventListener('focus', runRefresh)
    document.addEventListener('visibilitychange', handleVisibility)
    return () => {
      window.removeEventListener('focus', runRefresh)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [])
}
