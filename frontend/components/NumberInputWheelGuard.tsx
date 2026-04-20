'use client'

import { useEffect } from 'react'

export default function NumberInputWheelGuard() {
  useEffect(() => {
    const onWheel = (event: WheelEvent) => {
      const target = event.target
      if (!(target instanceof HTMLElement)) return
      const numberInput = target.closest('input[type="number"]')
      if (!numberInput) return
      event.preventDefault()
    }

    document.addEventListener('wheel', onWheel, { passive: false, capture: true })
    return () => {
      document.removeEventListener('wheel', onWheel, true)
    }
  }, [])

  return null
}
