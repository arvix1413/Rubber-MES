'use client'
import { useEffect, useState, useRef } from 'react'

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      className={`w-3.5 h-3.5 text-slate-400 transition-transform duration-200 flex-shrink-0 ${open ? 'rotate-180' : ''}`}>
      <polyline points="6 9 12 15 18 9" />
    </svg>
  )
}

interface SearchableSelectProps<T = any> {
  options: T[]
  value: string
  onChange: (val: string) => void
  placeholder?: string
  renderOption: (opt: T) => string
  filterFn: (opt: T, search: string) => boolean
  disabled?: boolean
  className?: string
}

export function SearchableSelect<T extends { id: number | string }>({
  options,
  value,
  onChange,
  placeholder = '-- 選擇 --',
  renderOption,
  filterFn,
  disabled = false,
  className = ''
}: SearchableSelectProps<T>) {
  const [isOpen, setIsOpen] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({})
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const selected = options.find(opt => String(opt.id) === value)

  // Close on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false)
        setSearchTerm('')
      }
    }
    if (isOpen) document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen])

  const openDropdown = () => {
    if (disabled || !containerRef.current) return
    const rect = containerRef.current.getBoundingClientRect()
    const spaceBelow = window.innerHeight - rect.bottom
    const style: React.CSSProperties = {
      position: 'fixed',
      left: rect.left,
      width: rect.width,
      maxHeight: 280,
      zIndex: 9999
    }
    if (spaceBelow < 150) {
      style.bottom = window.innerHeight - rect.top + 4
    } else {
      style.top = rect.bottom + 4
    }
    setDropdownStyle(style)
    setIsOpen(true)
  }

  const handleFocus = () => {
    if (!isOpen) openDropdown()
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchTerm(e.target.value)
    if (!isOpen) openDropdown()
  }

  const handleSelect = (opt: T) => {
    onChange(String(opt.id))
    setIsOpen(false)
    setSearchTerm('')
    inputRef.current?.blur()
  }

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation()
    onChange('')
    setSearchTerm('')
    setIsOpen(false)
  }

  // What to show in the input
  const displayValue = isOpen ? searchTerm : (selected ? renderOption(selected) : '')

  const filtered = searchTerm
    ? options.filter(opt => filterFn(opt, searchTerm.toLowerCase()))
    : options

  return (
    <>
      <div className="relative" ref={containerRef}>
        <input
          ref={inputRef}
          type="text"
          className={`oms-input pr-8 ${disabled ? 'bg-slate-100 cursor-not-allowed' : 'cursor-text'} ${className}`}
          placeholder={placeholder}
          value={displayValue}
          disabled={disabled}
          onFocus={handleFocus}
          onChange={handleInputChange}
          onMouseDown={() => { if (!isOpen) openDropdown() }}
          autoComplete="off"
        />
        <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1 pointer-events-none">
          {selected && !isOpen && (
            <button
              type="button"
              className="pointer-events-auto text-slate-300 hover:text-slate-500 transition-colors"
              onMouseDown={handleClear}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3 h-3">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )}
          <ChevronIcon open={isOpen} />
        </div>
      </div>

      {isOpen && !disabled && (
        <div
          className="bg-white border border-slate-300 rounded-md shadow-lg overflow-y-auto"
          style={dropdownStyle}
        >
          {filtered.length === 0 ? (
            <div className="px-3 py-3 text-xs text-slate-400 text-center">無符合結果</div>
          ) : (
            filtered.map(opt => (
              <div
                key={opt.id}
                className={`px-3 py-2 text-xs cursor-pointer transition-colors ${
                  String(opt.id) === value
                    ? 'bg-blue-50 text-blue-700 font-medium'
                    : 'text-slate-700 hover:bg-slate-100'
                }`}
                onMouseDown={(e) => {
                  e.preventDefault()
                  handleSelect(opt)
                }}
              >
                {renderOption(opt)}
              </div>
            ))
          )}
        </div>
      )}
    </>
  )
}
