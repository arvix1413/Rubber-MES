'use client'

import { useEffect } from 'react'

function getScrollWrapper(target: HTMLElement) {
  const wrappers = target.closest('.table-scroll-x, .overflow-x-auto') as HTMLElement | null
  if (!wrappers) return null
  if (!wrappers.querySelector('table')) return null
  return wrappers
}

function canScrollHorizontally(wrapper: HTMLElement) {
  return wrapper.scrollWidth - wrapper.clientWidth > 4
}

function canAdvance(wrapper: HTMLElement, delta: number) {
  if (delta < 0) return wrapper.scrollLeft > 0
  if (delta > 0) return wrapper.scrollLeft + wrapper.clientWidth < wrapper.scrollWidth - 1
  return false
}

export default function HorizontalTableWheelBridge() {
  useEffect(() => {
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey) return
      if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) return

      const target = event.target
      if (!(target instanceof HTMLElement)) return

      const wrapper = getScrollWrapper(target)
      if (!wrapper || !canScrollHorizontally(wrapper)) return

      const interactive = target.closest('input, textarea, select, [contenteditable="true"]')
      if (interactive) return

      const delta = event.deltaY
      if (!canAdvance(wrapper, delta)) return

      wrapper.scrollLeft += delta
      event.preventDefault()
    }

    document.addEventListener('wheel', onWheel, { passive: false, capture: true })
    return () => {
      document.removeEventListener('wheel', onWheel, true)
    }
  }, [])

  return null
}
