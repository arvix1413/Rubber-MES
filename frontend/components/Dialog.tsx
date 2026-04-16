'use client'
import { createContext, useContext, useState, useCallback, ReactNode } from 'react'

// ── Toast ─────────────────────────────────────────────────────────────────────
type ToastType = 'success' | 'error' | 'info'
type Toast = { id: number; msg: string; type: ToastType }

// ── Confirm ───────────────────────────────────────────────────────────────────
type ConfirmState = { open: boolean; title: string; desc: string; confirmLabel: string; resolve: (v: boolean) => void }

type DialogCtx = {
  toast: (msg: string, type?: ToastType) => void
  confirm: (title: string, desc?: string, confirmLabel?: string) => Promise<boolean>
}

const Ctx = createContext<DialogCtx>({ toast: () => {}, confirm: async () => false })

export function useDialog() { return useContext(Ctx) }

export function DialogProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const [confirmState, setConfirmState] = useState<ConfirmState>({
    open: false, title: '', desc: '', confirmLabel: '確認', resolve: () => {}
  })

  const toast = useCallback((msg: string, type: ToastType = 'success') => {
    const id = Date.now()
    setToasts(p => [...p, { id, msg, type }])
    setTimeout(() => setToasts(p => p.filter(t => t.id !== id)), 3500)
  }, [])

  const confirm = useCallback((title: string, desc = '', confirmLabel = '確認刪除') => {
    return new Promise<boolean>(resolve => {
      setConfirmState({ open: true, title, desc, confirmLabel, resolve })
    })
  }, [])

  const handleConfirm = (val: boolean) => {
    confirmState.resolve(val)
    setConfirmState(p => ({ ...p, open: false }))
  }

  const ICONS = {
    success: (
      <div className="w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center flex-shrink-0">
        <svg className="w-4 h-4 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/>
        </svg>
      </div>
    ),
    error: (
      <div className="w-8 h-8 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
        <svg className="w-4 h-4 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/>
        </svg>
      </div>
    ),
    info: (
      <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
        <svg className="w-4 h-4 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01"/>
        </svg>
      </div>
    ),
  }

  return (
    <Ctx.Provider value={{ toast, confirm }}>
      {children}

      {/* Toast stack - errors top center, success bottom right */}
      <div className="fixed top-5 left-1/2 -translate-x-1/2 z-[9999] flex flex-col gap-2 pointer-events-none items-center">
        {toasts.filter(t => t.type === 'error').map(t => (
          <div key={t.id}
            className="flex items-center gap-3 bg-white border border-red-200 rounded-xl px-4 py-3 shadow-xl shadow-red-100/60 pointer-events-auto animate-slide-down min-w-[280px] max-w-[420px]">
            {ICONS.error}
            <span className="text-sm font-semibold text-red-700 flex-1">{t.msg}</span>
          </div>
        ))}
      </div>
      <div className="fixed bottom-6 right-6 z-[9999] flex flex-col gap-2 pointer-events-none">
        {toasts.filter(t => t.type !== 'error').map(t => (
          <div key={t.id}
            className="flex items-center gap-3 bg-white border border-slate-200 rounded-xl px-4 py-3 shadow-lg shadow-slate-200/60 pointer-events-auto animate-slide-up min-w-[260px] max-w-[360px]">
            {ICONS[t.type]}
            <span className="text-sm font-medium text-slate-700 flex-1">{t.msg}</span>
          </div>
        ))}
      </div>

      {/* Confirm dialog */}
      {confirmState.open && (
        <div className="fixed inset-0 z-[9998] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/30 backdrop-blur-[2px]" onClick={() => handleConfirm(false)} />
          <div className="relative bg-white rounded-2xl shadow-2xl shadow-slate-300/50 w-full max-w-sm p-6 border border-slate-200">
            <div className="flex items-start gap-4 mb-5">
              <div className="w-10 h-10 rounded-full bg-red-50 flex items-center justify-center flex-shrink-0 mt-0.5">
                <svg className="w-5 h-5 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
                </svg>
              </div>
              <div>
                <h3 className="text-base font-semibold text-slate-800">{confirmState.title}</h3>
                {confirmState.desc && <p className="text-sm text-slate-500 mt-1">{confirmState.desc}</p>}
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={() => handleConfirm(false)}
                className="flex-1 px-4 py-2.5 rounded-xl border border-slate-200 text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors">
                取消
              </button>
              <button onClick={() => handleConfirm(true)}
                className="flex-1 px-4 py-2.5 rounded-xl bg-red-500 hover:bg-red-600 text-sm font-semibold text-white transition-colors shadow-sm">
                {confirmState.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </Ctx.Provider>
  )
}
