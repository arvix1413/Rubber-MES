import { useState, useMemo, useEffect } from 'react'

export function usePagination<T>(items: T[], pageSize = 20) {
  const [page, setPage] = useState(1)
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize))

  // Clamp page to valid range (handles filter reducing totalPages)
  const safePage = Math.max(1, Math.min(page, totalPages))

  // Auto-reset to page 1 when items change (e.g. after filtering)
  useEffect(() => {
    setPage(1)
  }, [items.length])

  const paged = useMemo(() => items.slice((safePage - 1) * pageSize, safePage * pageSize), [items, safePage, pageSize])
  const reset = () => setPage(1)
  return { page: safePage, setPage, totalPages, paged, reset, total: items.length }
}

export function Pagination({ page, totalPages, setPage, total, pageSize = 20 }: {
  page: number; totalPages: number; setPage: (p: number) => void; total: number; pageSize?: number
}) {
  const start = (page - 1) * pageSize + 1
  const end = Math.min(page * pageSize, total)

  // Generate page numbers: show up to 5 pages centered around current page
  const pages: number[] = []
  if (totalPages <= 5) {
    for (let i = 1; i <= totalPages; i++) pages.push(i)
  } else {
    let lo = Math.max(1, page - 2)
    let hi = lo + 4
    if (hi > totalPages) { hi = totalPages; lo = hi - 4 }
    for (let i = lo; i <= hi; i++) pages.push(i)
  }

  const btn = 'px-2.5 py-1 rounded text-xs transition-colors'
  const active = `${btn} bg-blue-600 text-white font-semibold`
  const normal = `${btn} text-slate-500 hover:text-slate-800 hover:bg-slate-100`
  const nav = `px-2 py-1 rounded text-xs text-slate-400 hover:text-slate-700 hover:bg-slate-100 disabled:opacity-30 transition-colors`

  return (
    <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100 text-sm">
      <span className="text-slate-400 text-xs">顯示 {total === 0 ? 0 : start}–{end}，共 {total} 筆</span>
      {totalPages > 1 && (
        <div className="flex items-center gap-1">
          <button onClick={() => setPage(1)} disabled={page === 1} className={nav}>«</button>
          <button onClick={() => setPage(page - 1)} disabled={page === 1} className={nav}>‹</button>
          {pages.map(p => (
            <button key={p} onClick={() => setPage(p)} className={p === page ? active : normal}>
              {p}
            </button>
          ))}
          <button onClick={() => setPage(page + 1)} disabled={page === totalPages} className={nav}>›</button>
          <button onClick={() => setPage(totalPages)} disabled={page === totalPages} className={nav}>»</button>
        </div>
      )}
    </div>
  )
}
