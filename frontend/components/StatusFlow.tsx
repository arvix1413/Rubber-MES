'use client'

export type StatusStep = {
  key: string
  label: string
  color: 'gray' | 'blue' | 'green' | 'yellow' | 'red' | 'purple'
}

export type StatusAction = {
  label: string
  toStatus: string
  color?: 'primary' | 'danger' | 'warning'
  icon?: string
}

const COLOR_MAP: Record<string, { dot: string; text: string; ring: string; bg: string }> = {
  gray:   { dot: 'bg-slate-300',   text: 'text-slate-500',   ring: 'ring-slate-200',   bg: 'bg-slate-50'   },
  blue:   { dot: 'bg-blue-500',    text: 'text-blue-600',    ring: 'ring-blue-200',    bg: 'bg-blue-50'    },
  green:  { dot: 'bg-emerald-500', text: 'text-emerald-600', ring: 'ring-emerald-200', bg: 'bg-emerald-50' },
  yellow: { dot: 'bg-amber-400',   text: 'text-amber-600',   ring: 'ring-amber-200',   bg: 'bg-amber-50'   },
  red:    { dot: 'bg-red-500',     text: 'text-red-600',     ring: 'ring-red-200',     bg: 'bg-red-50'     },
  purple: { dot: 'bg-violet-500',  text: 'text-violet-600',  ring: 'ring-violet-200',  bg: 'bg-violet-50'  },
}

const ACTION_STYLE: Record<string, string> = {
  primary: 'bg-blue-600 hover:bg-blue-700 text-white',
  danger:  'bg-red-500 hover:bg-red-600 text-white',
  warning: 'bg-amber-500 hover:bg-amber-600 text-white',
}

interface Props {
  steps: StatusStep[]
  current: string
  actions: StatusAction[]
  onAction: (toStatus: string) => void
  compact?: boolean
}

export function StatusFlow({ steps, current, actions, onAction, compact = false }: Props) {
  const currentStep = steps.find(s => s.key === current)
  const c = COLOR_MAP[currentStep?.color || 'gray']

  if (compact) {
    return (
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ring-1 ${c.ring} ${c.bg} ${c.text}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${c.dot}`} />
          {currentStep?.label || current}
        </span>
        {actions.map(a => (
          <button key={a.toStatus} onClick={() => onAction(a.toStatus)}
            className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all shadow-sm ${ACTION_STYLE[a.color || 'primary']}`}>
            {a.icon ? <span className="mr-1">{a.icon}</span> : null}{a.label}
          </button>
        ))}
      </div>
    )
  }

  const currentIdx = steps.findIndex(s => s.key === current)

  return (
    <div>
      <div className="flex items-center mb-4 overflow-x-auto pb-1">
        {steps.map((step, i) => {
          const sc = COLOR_MAP[step.color]
          const isDone = i < currentIdx
          const isCurrent = step.key === current
          const cls = isCurrent
            ? `ring-2 ${sc.ring} ${sc.bg} ${sc.text}`
            : isDone ? 'text-slate-400 bg-slate-50' : 'text-slate-300 bg-white'
          return (
            <div key={step.key} className="flex items-center min-w-0">
              <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-all ${cls}`}>
                <span className={`w-2 h-2 rounded-full flex-shrink-0 ${isCurrent ? sc.dot : isDone ? 'bg-slate-300' : 'bg-slate-200'}`} />
                {step.label}
                {isDone ? <span className="text-slate-300 ml-0.5">&#10003;</span> : null}
              </div>
              {i < steps.length - 1 ? (
                <div className={`h-px w-4 flex-shrink-0 mx-1 ${i < currentIdx ? 'bg-slate-300' : 'bg-slate-100'}`} />
              ) : null}
            </div>
          )
        })}
      </div>
      {actions.length > 0 ? (
        <div className="flex gap-2 flex-wrap">
          {actions.map(a => (
            <button key={a.toStatus} onClick={() => onAction(a.toStatus)}
              className={`px-4 py-2 rounded-xl text-sm font-semibold transition-all shadow-sm ${ACTION_STYLE[a.color || 'primary']}`}>
              {a.icon ? <span className="mr-1.5">{a.icon}</span> : null}{a.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

export const PO_STEPS: StatusStep[] = [
  { key: 'draft',     label: '草稿',   color: 'gray'  },
  { key: 'approved',  label: '已核准', color: 'blue'  },
  { key: 'sent',      label: '已送出', color: 'blue'  },
  { key: 'received',  label: '已收貨', color: 'green' },
  { key: 'cancelled', label: '已取消', color: 'red'   },
]

export const DN_STEPS: StatusStep[] = [
  { key: 'draft',     label: '草稿',   color: 'gray'  },
  { key: 'confirmed', label: '已確認', color: 'blue'  },
  { key: 'shipped',   label: '已出貨', color: 'green' },
]

export const PROD_STEPS: StatusStep[] = [
  { key: 'draft',       label: '待確認', color: 'gray'   },
  { key: 'confirmed',   label: '已建立', color: 'blue'   },
  { key: 'shortage',    label: '缺料',   color: 'red'    },
  { key: 'ready',       label: '材料齊', color: 'yellow' },
  { key: 'in_progress', label: '生產中', color: 'purple' },
  { key: 'completed',   label: '完工',   color: 'green'  },
]

export const ADJ_STEPS: StatusStep[] = [
  { key: 'draft',    label: '草稿',   color: 'gray'  },
  { key: 'approved', label: '已核准', color: 'green' },
]

export const GR_STEPS: StatusStep[] = [
  { key: 'draft',     label: '草稿',   color: 'gray'  },
  { key: 'confirmed', label: '已確認', color: 'green' },
]

export const CO_STEPS: StatusStep[] = [
  { key: 'pending',   label: '待出貨',   color: 'yellow' },
  { key: 'partial',   label: '部分出貨', color: 'blue'   },
  { key: 'completed', label: '已完成',   color: 'green'  },
  { key: 'delay',     label: '延遲',     color: 'red'    },
]

export function getPOActions(status: string): StatusAction[] {
  if (status === 'draft')    return [{ label: '核准', toStatus: 'approved', icon: '✓' }]
  if (status === 'approved') return [{ label: '送出', toStatus: 'sent', icon: '📤' }]
  if (status === 'sent')     return [{ label: '確認收貨', toStatus: 'received', icon: '📦' }]
  return []
}

export function getDNActions(status: string): StatusAction[] {
  if (status === 'draft')     return [{ label: '確認', toStatus: 'confirmed', icon: '✓' }]
  if (status === 'confirmed') return [{ label: '出貨', toStatus: 'shipped', icon: '�' }]
  return []
}

export function getProdActions(status: string): StatusAction[] {
  if (status === 'draft')       return [{ label: '確認建立', toStatus: 'confirmed', icon: '✓' }]
  if (status === 'confirmed')   return [
    { label: '材料齊', toStatus: 'ready', icon: '✓', color: 'primary' },
    { label: '缺料', toStatus: 'shortage', icon: '⚠', color: 'warning' },
  ]
  if (status === 'shortage')    return [{ label: '已補齊', toStatus: 'ready', icon: '✓' }]
  if (status === 'ready')       return [{ label: '開始生產', toStatus: 'in_progress', icon: '▶' }]
  if (status === 'in_progress') return [{ label: '完工', toStatus: 'completed', icon: '✓', color: 'primary' }]
  return []
}

export function getAdjActions(status: string): StatusAction[] {
  if (status === 'draft') return [{ label: '核准', toStatus: 'approved', icon: '✓' }]
  return []
}

export function getGRActions(status: string): StatusAction[] {
  if (status === 'draft') return [{ label: '確認進貨', toStatus: 'confirmed', icon: '✓' }]
  return []
}
