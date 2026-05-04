'use client'
import { useState } from 'react'
import { apiFetch, setToken } from '@/lib/api'

export default function LoginPage() {
  const [form, setForm] = useState({ email: '', password: '' })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [showPw, setShowPw] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(''); setLoading(true)
    try {
      const data = await apiFetch<{ token: string; user: any; permissions: string[] }>('/api/auth/login', {
        method: 'POST', body: JSON.stringify(form)
      })
      setToken(data.token)
      localStorage.setItem('rubber_user', JSON.stringify(data.user))
      localStorage.setItem('rubber_permissions', JSON.stringify(data.permissions || []))
      window.location.href = '/dashboard'
    } catch (e: any) {
      setError(e.message || '登入失敗')
    } finally { setLoading(false) }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-8">
      <div className="pointer-events-none absolute -left-24 -top-24 h-80 w-80 rounded-full bg-[#d98a46]/20 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-32 right-[-4rem] h-96 w-96 rounded-full bg-[#3d7687]/20 blur-3xl" />

      <div className="grid w-full max-w-5xl overflow-hidden rounded-3xl border border-[#d9cbbb] bg-[#fffaf3] shadow-[0_28px_70px_rgba(80,57,32,0.2)] lg:grid-cols-5">
        <div className="relative hidden bg-[linear-gradient(160deg,#2a6070_0%,#1f4f5f_52%,#1f3943_100%)] p-10 text-[#e9f3f8] lg:col-span-2 lg:block">
          <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-[#dc833f] text-xl font-black text-white shadow-[0_12px_24px_rgba(0,0,0,0.18)] brand-font">
            R
          </div>
          <h1 className="mt-5 text-3xl font-bold leading-tight brand-font">Rubber MES</h1>
          <p className="mt-2 text-sm text-[#b7d4df]">Factory Workflow Command Station</p>
          <div className="mt-8 space-y-3 text-xs">
            <div className="rounded-xl border border-white/20 bg-white/10 p-3">
              即時監控接單、生產、出貨與收付款狀態
            </div>
            <div className="rounded-xl border border-white/20 bg-white/10 p-3">
              單據與庫存連動，流程中斷點可追蹤
            </div>
          </div>
        </div>

        <div className="p-6 sm:p-10 lg:col-span-3">
          <div className="mb-8 lg:hidden">
            <div className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-[#c46b2d] text-lg font-black text-white brand-font">R</div>
            <h1 className="mt-3 text-2xl font-bold text-[#2b261f] brand-font">Rubber MES</h1>
            <p className="mt-1 text-sm text-[#776c5d]">Factory Workflow Command Station</p>
          </div>

          {error && (
            <div className="mb-5 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-xs font-medium text-red-700">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-[#6f665b]">Email</label>
              <input
                type="email"
                required
                value={form.email}
                onChange={e => setForm(p => ({ ...p, email: e.target.value }))}
                className="rubber-input"
                placeholder="name@company.com"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-[#6f665b]">密碼</label>
              <div className="relative">
                <input
                  type={showPw ? 'text' : 'password'}
                  required
                  value={form.password}
                  onChange={e => setForm(p => ({ ...p, password: e.target.value }))}
                  className="rubber-input pr-12"
                  placeholder="••••••••"
                />
                <button
                  type="button"
                  onClick={() => setShowPw(!showPw)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[#8b7d6d] transition-colors hover:text-[#4f463a]"
                >
                  {showPw ? '隱藏' : '顯示'}
                </button>
              </div>
            </div>
            <button type="submit" disabled={loading} className="btn-primary mt-2 w-full justify-center py-2.5">
              {loading ? '登入中...' : '進入系統'}
            </button>
          </form>

          <div className="mt-7 rounded-xl border border-[#e5d7c6] bg-[#faf3e9] p-3 text-[11px] text-[#7a6d5f]">
            請使用個人帳號登入。如未開通，請聯絡管理員。
          </div>
        </div>
      </div>
    </div>
  )
}
