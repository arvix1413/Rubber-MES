'use client'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { apiFetch } from '@/lib/api'

type Material = {
  id: number; material_code: string; material_name: string
  spec: string; unit: string; supplier_price: number; company_price: number
  currency: string; supplier_name: string; supplier_id: number | null
}

type Props = {
  value: string
  onChange: (m: Material | null, code: string) => void
  placeholder?: string
  className?: string
}

export function MaterialSelect({ value, onChange, placeholder = '輸入料號或品名搜尋...', className = '' }: Props) {
  const [materials, setMaterials] = useState<Material[]>([])
  const [query, setQuery] = useState(value || '')
  const [open, setOpen] = useState(false)
  const [dropPos, setDropPos] = useState({ top: 0, left: 0, width: 0 })
  const inputRef = useRef<HTMLInputElement>(null)
  const dropRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    apiFetch<Material[]>('/api/materials').then(setMaterials).catch(() => {})
  }, [])

  useEffect(() => { setQuery(value || '') }, [value])

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        inputRef.current && !inputRef.current.contains(e.target as Node) &&
        dropRef.current && !dropRef.current.contains(e.target as Node)
      ) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const updatePos = () => {
    if (!inputRef.current) return
    const rect = inputRef.current.getBoundingClientRect()
    const spaceBelow = window.innerHeight - rect.bottom
    const spaceAbove = rect.top
    const dropHeight = Math.min(224, filtered.length * 52)
    // Show above if not enough space below
    if (spaceBelow < dropHeight && spaceAbove > spaceBelow) {
      setDropPos({ top: rect.top - dropHeight - 4, left: rect.left, width: rect.width })
    } else {
      setDropPos({ top: rect.bottom + 4, left: rect.left, width: rect.width })
    }
  }

  const filtered = materials.filter(m =>
    !query
      ? true
      : m.material_code.toLowerCase().includes(query.toLowerCase()) ||
        m.material_name.toLowerCase().includes(query.toLowerCase())
  ).slice(0, 30)

  const handleFocus = () => {
    updatePos()
    setOpen(true)
  }

  const select = (m: Material) => {
    setQuery(m.material_code)
    setOpen(false)
    onChange(m, m.material_code)
  }

  const dropdown = open && filtered.length > 0 ? (
    <div
      ref={dropRef}
      style={{ position: 'fixed', top: dropPos.top, left: dropPos.left, width: dropPos.width, zIndex: 9999 }}
      className="bg-white border border-slate-200 rounded-lg shadow-xl max-h-56 overflow-y-auto"
    >
      {filtered.map(m => (
        <button key={m.id} type="button"
          className="w-full text-left px-3 py-2 hover:bg-blue-50 transition-colors border-b border-slate-100 last:border-0"
          onMouseDown={() => select(m)}>
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs text-blue-600 shrink-0 w-24 truncate">{m.material_code}</span>
            <span className="text-xs text-slate-600 truncate flex-1">{m.material_name}</span>
            <span className="text-[10px] text-slate-400 shrink-0">{m.unit}</span>
          </div>
          {m.spec && <div className="text-[10px] text-slate-400 mt-0.5 pl-0">{m.spec}</div>}
        </button>
      ))}
    </div>
  ) : null

  return (
    <div className="relative">
      <input
        ref={inputRef}
        className={`oms-input ${className}`}
        value={query}
        placeholder={placeholder}
        onChange={e => { setQuery(e.target.value); updatePos(); setOpen(true); onChange(null, e.target.value) }}
        onFocus={handleFocus}
        autoComplete="off"
      />
      {typeof window !== 'undefined' && dropdown ? createPortal(dropdown, document.body) : null}
    </div>
  )
}
