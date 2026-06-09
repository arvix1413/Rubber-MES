'use client'

import { useEffect, useRef } from 'react'

type ActiveTableState = {
  wrapper: HTMLElement
  table: HTMLTableElement
  thead: HTMLTableSectionElement
}

function clampWidth(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function getStickyWidthBudget(wrapper: HTMLElement, firstWidth: number, secondWidth: number) {
  const viewportWidth = Math.max(wrapper.clientWidth, 320)
  const firstMin = 140
  const secondMin = 170
  const firstMax = Math.max(firstMin, Math.min(280, Math.floor(viewportWidth * 0.24)))
  const secondMax = Math.max(secondMin, Math.min(360, Math.floor(viewportWidth * 0.32)))
  const totalMax = Math.max(firstMin + secondMin, Math.min(560, Math.floor(viewportWidth * 0.52)))

  let nextFirst = clampWidth(firstWidth, firstMin, firstMax)
  let nextSecond = clampWidth(secondWidth, secondMin, secondMax)

  const overflow = nextFirst + nextSecond - totalMax
  if (overflow > 0) {
    const shrinkSecond = Math.min(overflow, nextSecond - secondMin)
    nextSecond -= shrinkSecond
    nextFirst = Math.max(firstMin, nextFirst - (overflow - shrinkSecond))
  }

  return { first: nextFirst, second: nextSecond }
}

function syncStickyColumnMetrics(table: HTMLTableElement, thead: HTMLTableSectionElement, wrapper: HTMLElement) {
  if (table.closest('.no-sticky-cols')) return
  const headerCells = Array.from(thead.querySelectorAll<HTMLElement>('th'))
  const first = headerCells[0]
  const second = headerCells[1]
  if (!first || !second) return

  const firstWidth = Math.ceil(first.getBoundingClientRect().width)
  const secondWidth = Math.ceil(second.getBoundingClientRect().width)
  const widths = getStickyWidthBudget(wrapper, firstWidth, secondWidth)

  if (widths.first > 0) {
    table.style.setProperty('--sticky-col-1-width', `${widths.first}px`)
  }
  if (widths.second > 0) {
    table.style.setProperty('--sticky-col-2-width', `${widths.second}px`)
  }
}

function normalizeTableColumns(table: HTMLTableElement, thead: HTMLTableSectionElement) {
  const headerCells = Array.from(thead.querySelectorAll<HTMLElement>('th'))
  const bodyRows = Array.from(table.tBodies).flatMap((tbody) => Array.from(tbody.rows))
  if (!headerCells.length || !bodyRows.length) return

  headerCells.forEach((headerCell, columnIndex) => {
    const computed = window.getComputedStyle(headerCell)
    const align = computed.textAlign

    bodyRows.forEach((row) => {
      const cell = row.cells[columnIndex] as HTMLTableCellElement | undefined
      if (!cell || cell.colSpan > 1) return
      cell.style.textAlign = align
      cell.style.verticalAlign = computed.verticalAlign || 'middle'
    })
  })
}

function getWrapperForTable(table: HTMLTableElement): HTMLElement | null {
  return (
    table.closest<HTMLElement>('.table-scroll-x') ||
    table.closest<HTMLElement>('.overflow-x-auto') ||
    table.parentElement
  )
}

function getCandidateTables(root: ParentNode): ActiveTableState[] {
  const tables = Array.from(root.querySelectorAll<HTMLTableElement>('table'))
  const candidates: ActiveTableState[] = []

  for (const table of tables) {
    if (table.closest('.mes-sticky-header-host')) continue

    const thead = table.querySelector('thead')
    const wrapper = getWrapperForTable(table)
    if (!thead || !wrapper) continue

    const rect = table.getBoundingClientRect()
    const headerCells = thead.querySelectorAll('th')
    if (rect.width < 320 || headerCells.length < 3) continue

    candidates.push({ wrapper, table, thead })
  }

  return candidates
}

export default function StickyTableHeaderBridge() {
  const hostRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const main = host.closest('main') as HTMLElement | null
    const content = main?.querySelector('.dashboard-content') as HTMLElement | null
    if (!main || !content) return

    let active: ActiveTableState | null = null
    let wrapperScrollListener: (() => void) | null = null

    const clearActive = () => {
      if (wrapperScrollListener && active) {
        active.wrapper.removeEventListener('scroll', wrapperScrollListener)
      }
      wrapperScrollListener = null
      active = null
      host.innerHTML = ''
      host.style.display = 'none'
      host.style.height = '0px'
    }

    const syncHeader = () => {
      if (!active) return

      const { wrapper, table, thead } = active
      syncStickyColumnMetrics(table, thead, wrapper)
      normalizeTableColumns(table, thead)
      const mainRect = main.getBoundingClientRect()
      const wrapperRect = wrapper.getBoundingClientRect()
      const theadRect = thead.getBoundingClientRect()

      if (wrapperRect.bottom <= mainRect.top || wrapperRect.top >= mainRect.bottom) {
        clearActive()
        return
      }

      const viewport = host.firstElementChild as HTMLDivElement | null
      const cloneTable = viewport?.firstElementChild as HTMLTableElement | null
      const cloneHead = cloneTable?.querySelector('thead')
      if (!viewport || !cloneTable || !cloneHead) {
        clearActive()
        return
      }

      host.style.display = 'block'
      host.style.height = `${Math.ceil(theadRect.height)}px`
      viewport.style.width = `${wrapper.clientWidth}px`
      viewport.style.marginLeft = `${Math.max(0, wrapperRect.left - mainRect.left)}px`
      cloneTable.style.width = `${table.scrollWidth}px`
      cloneTable.style.minWidth = `${table.scrollWidth}px`
      cloneTable.style.setProperty('--sticky-col-1-width', table.style.getPropertyValue('--sticky-col-1-width'))
      cloneTable.style.setProperty('--sticky-col-2-width', table.style.getPropertyValue('--sticky-col-2-width'))
      cloneTable.style.transform = `translateX(${-wrapper.scrollLeft}px)`

      const sourceCells = Array.from(thead.querySelectorAll<HTMLElement>('th'))
      const cloneCells = Array.from(cloneHead.querySelectorAll<HTMLElement>('th'))
      sourceCells.forEach((cell, idx) => {
        const width = `${Math.ceil(cell.getBoundingClientRect().width)}px`
        const cloneCell = cloneCells[idx]
        if (!cloneCell) return
        cloneCell.style.width = width
        cloneCell.style.minWidth = width
        cloneCell.style.maxWidth = width
      })
    }

    const activate = (next: ActiveTableState) => {
      if (active?.wrapper === next.wrapper && active.table === next.table && active.thead === next.thead) {
        syncHeader()
        return
      }

      clearActive()
      active = next

      const viewport = document.createElement('div')
      viewport.className = 'mes-sticky-header-viewport'

      const cloneTable = next.table.cloneNode(false) as HTMLTableElement
      cloneTable.className = `${next.table.className} mes-sticky-header-table`
      cloneTable.setAttribute('aria-hidden', 'true')
      cloneTable.appendChild(next.thead.cloneNode(true))
      viewport.appendChild(cloneTable)
      host.appendChild(viewport)

      wrapperScrollListener = () => syncHeader()
      next.wrapper.addEventListener('scroll', wrapperScrollListener, { passive: true })
      syncHeader()
    }

    const update = () => {
      const hostRect = host.getBoundingClientRect()
      const candidates = getCandidateTables(content)
      candidates.forEach(({ wrapper, table, thead }) => {
        syncStickyColumnMetrics(table, thead, wrapper)
        normalizeTableColumns(table, thead)
      })
      const next = candidates
        .map(({ wrapper, table, thead }) => {
          const wrapperRect = wrapper.getBoundingClientRect()
          const theadRect = thead.getBoundingClientRect()
          const pastTop = theadRect.top <= hostRect.top + 1
          const stillInView = wrapperRect.bottom - theadRect.height > hostRect.top + 1
          if (!pastTop || !stillInView) return null
          return {
            wrapper,
            table,
            thead,
            distance: Math.abs(wrapperRect.top - hostRect.top),
          }
        })
        .filter((item): item is ActiveTableState & { distance: number } => Boolean(item))
        .sort((a, b) => a.distance - b.distance)[0]

      if (!next) {
        clearActive()
        return
      }

      activate(next)
    }

    const resizeObserver = new ResizeObserver(() => update())
    resizeObserver.observe(main)
    resizeObserver.observe(content)

    const mutationObserver = new MutationObserver(() => {
      requestAnimationFrame(update)
    })
    mutationObserver.observe(content, { childList: true, subtree: true, attributes: true })

    main.addEventListener('scroll', update, { passive: true })
    window.addEventListener('resize', update)

    update()

    return () => {
      clearActive()
      main.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
      resizeObserver.disconnect()
      mutationObserver.disconnect()
    }
  }, [])

  return <div ref={hostRef} className="mes-sticky-header-host" aria-hidden="true" />
}
