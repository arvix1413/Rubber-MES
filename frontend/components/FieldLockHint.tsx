type FieldLockHintProps = {
  title?: string
}

export default function FieldLockHint({ title = '建立後不可修改' }: FieldLockHintProps) {
  return (
    <span
      title={title}
      className="inline-flex items-center justify-center w-4 h-4 rounded border border-slate-300 bg-slate-100 text-slate-500"
      aria-label={title}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-2.5 h-2.5">
        <rect x="5" y="11" width="14" height="10" rx="2" />
        <path d="M8 11V8a4 4 0 1 1 8 0v3" />
      </svg>
    </span>
  )
}
