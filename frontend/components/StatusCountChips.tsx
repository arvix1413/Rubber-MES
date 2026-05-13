'use client'

type StatusCountChip = {
  value: string
  label: string
  count: number
}

export default function StatusCountChips({
  items,
  value,
  onChange,
}: {
  items: StatusCountChip[]
  value: string
  onChange: (value: string) => void
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((item) => {
        const active = value === item.value
        return (
          <button
            key={item.value}
            type="button"
            onClick={() => onChange(item.value)}
            className={`inline-flex items-center gap-2 rounded-2xl border px-4 py-2 text-sm font-semibold transition-all ${
              active
                ? 'border-[#1d5a70] bg-[#1f5b70] text-white shadow-[0_10px_22px_rgba(31,91,112,0.22)]'
                : 'border-[#d8c5aa] bg-white/70 text-[#6d5a46] hover:border-[#c7af8b] hover:bg-white'
            }`}
          >
            <span>{item.label}</span>
            <span
              className={`inline-flex min-w-[24px] items-center justify-center rounded-full px-2 py-0.5 text-[11px] font-black leading-none ${
                active ? 'bg-white/16 text-white' : 'bg-[#efe4d2] text-[#7a654c]'
              }`}
            >
              {item.count > 99 ? '99+' : item.count}
            </span>
          </button>
        )
      })}
    </div>
  )
}
