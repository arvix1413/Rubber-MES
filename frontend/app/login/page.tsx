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
      localStorage.setItem('oms_user', JSON.stringify(data.user))
      localStorage.setItem('oms_permissions', JSON.stringify(data.permissions || []))
      window.location.href = '/dashboard'
    } catch (e: any) {
      setError(e.message || '登入失敗')
    } finally { setLoading(false) }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-transparent relative overflow-hidden">
      <div className="absolute -top-20 -left-24 w-72 h-72 rounded-full bg-orange-300/25 blur-3xl pointer-events-none" />
      <div className="absolute -bottom-24 -right-24 w-80 h-80 rounded-full bg-emerald-300/20 blur-3xl pointer-events-none" />
      <div className="w-full max-w-sm px-4">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-[#a73f11] mb-4 shadow-lg shadow-orange-700/30">
            <span className="text-xl font-black text-white brand-font">R</span>
          </div>
          <h1 className="text-2xl font-bold text-[#2f261c] brand-font">RUBBER MES</h1>
          <p className="text-sm text-[#7b6f5d] mt-1">Production & Fulfillment Control</p>
        </div>

        <div className="oms-card p-8">
          {error && (
            <div className="mb-5 px-4 py-2.5 rounded-lg text-xs font-medium bg-red-50 text-red-700 border border-red-200">
              {error}
            </div>
          )}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wider">Email</label>
              <input type="email" required value={form.email}
                onChange={e => setForm(p => ({...p, email: e.target.value}))}
                className="oms-input" placeholder="admin@oms.com" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wider">密碼</label>
              <div className="relative">
                <input type={showPw ? 'text' : 'password'} required value={form.password}
                  onChange={e => setForm(p => ({...p, password: e.target.value}))}
                  className="oms-input pr-12" placeholder="••••••••" />
                <button type="button" onClick={()=>setShowPw(!showPw)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs transition-colors">
                  {showPw ? '隱藏' : '顯示'}
                </button>
              </div>
            </div>
            <button type="submit" disabled={loading}
              className="w-full mt-2 py-2.5 bg-[#b54b19] hover:bg-[#9f3f13] disabled:opacity-50 text-white text-sm font-semibold rounded-lg transition-colors shadow-sm">
              {loading ? '登入中...' : '登入'}
            </button>
          </form>
          <p className="text-center text-[11px] text-[#a4947a] mt-6">admin@oms.com · admin123</p>
        </div>
      </div>
    </div>
  )
}
