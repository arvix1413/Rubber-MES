'use client'
import { useDialog } from '@/components/Dialog'
import { useState, useRef } from 'react'
import { apiFetch, API } from '@/lib/api'
import { getUser, ROLE_LABELS, ROLE_COLORS, type Role } from '@/lib/permissions'

export default function ProfilePage() {
  const { toast } = useDialog()
  const me = getUser()
  const [pwForm, setPwForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' })
  const [saving, setSaving] = useState(false)
  const [showCurrent, setShowCurrent] = useState(false)
  const [showNew, setShowNew] = useState(false)
  const storedUser = typeof window !== 'undefined' ? JSON.parse(localStorage.getItem('oms_user') || 'null') : null
  const [signatureUrl, setSignatureUrl] = useState<string>(storedUser?.signature_url || '')
  const [uploadingSign, setUploadingSign] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleChangePw = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!pwForm.currentPassword || !pwForm.newPassword) { toast('請填寫所有欄位', 'error'); return }
    if (pwForm.newPassword.length < 6) { toast('新密碼至少需要6個字元', 'error'); return }
    if (pwForm.newPassword !== pwForm.confirmPassword) { toast('兩次輸入的新密碼不一致', 'error'); return }
    setSaving(true)
    try {
      await apiFetch('/api/auth/change-password', { method: 'POST', body: JSON.stringify({ currentPassword: pwForm.currentPassword, newPassword: pwForm.newPassword }) })
      toast('密碼已更新')
      setPwForm({ currentPassword: '', newPassword: '', confirmPassword: '' })
    } catch (e: any) { toast(e.message || '更新失敗', 'error') }
    finally { setSaving(false) }
  }

  const handleSignatureUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) { toast('請上傳圖片檔案', 'error'); return }
    if (file.size > 2 * 1024 * 1024) { toast('圖片大小不能超過 2MB', 'error'); return }
    setUploadingSign(true)
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await apiFetch<{ url: string }>('/api/upload', { method: 'POST', body: form })
      const result = await apiFetch<{ ok: boolean; user: any }>('/api/auth/signature', { method: 'POST', body: JSON.stringify({ signature_url: res.url }) })
      setSignatureUrl(res.url)
      if (result.user) localStorage.setItem('oms_user', JSON.stringify(result.user))
      toast('簽名已儲存')
    } catch (e: any) { toast(e.message || '上傳失敗', 'error') }
    finally { setUploadingSign(false); if (fileInputRef.current) fileInputRef.current.value = '' }
  }

  const handleRemoveSignature = async () => {
    try {
      const result = await apiFetch<{ ok: boolean; user: any }>('/api/auth/signature', { method: 'POST', body: JSON.stringify({ signature_url: null }) })
      setSignatureUrl('')
      if (result.user) localStorage.setItem('oms_user', JSON.stringify(result.user))
      toast('簽名已移除')
    } catch (e: any) { toast(e.message, 'error') }
  }

  if (!me) return null
  const inp = 'oms-input'
  const apiBase = API || 'https://oms-backend.arvix1413.workers.dev'
  const fullSignUrl = signatureUrl ? (signatureUrl.startsWith('http') ? signatureUrl : `${apiBase}${signatureUrl}`) : ''

  return (
    <div className="max-w-4xl">
      <div className="flex items-center gap-5 mb-8 pb-6 border-b border-slate-200">
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center text-white text-2xl font-bold shadow-lg shadow-blue-500/25 select-none">
          {me.name.charAt(0).toUpperCase()}
        </div>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-slate-800">{me.name}</h1>
          <div className="flex items-center gap-3 mt-1">
            <span className="text-sm text-slate-400">{me.email}</span>
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${ROLE_COLORS[me.role as Role]}`}>
              {ROLE_LABELS[me.role as Role] || me.role}
            </span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="oms-card p-6">
          <div className="flex items-center gap-2 mb-1">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-4 h-4 text-blue-500">
              <path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
            </svg>
            <h2 className="text-sm font-semibold text-slate-800">電子簽名</h2>
          </div>
          <p className="text-xs text-slate-400 mb-5">列印採購單、出貨單、送貨單時自動顯示在簽名欄</p>
          {fullSignUrl ? (
            <div className="space-y-4">
              <div className="rounded-xl border-2 border-slate-100 bg-slate-50 flex items-center justify-center p-6" style={{ minHeight: 100 }}>
                <img src={fullSignUrl} alt="簽名預覽" className="max-h-24 max-w-full object-contain"
                  onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
              </div>
              <div className="flex gap-2">
                <button onClick={() => fileInputRef.current?.click()} disabled={uploadingSign}
                  className="flex-1 btn-ghost border border-slate-200 text-xs">更換簽名</button>
                <button onClick={handleRemoveSignature}
                  className="flex-1 btn-ghost text-red-500 hover:bg-red-50 border border-red-100 text-xs">移除</button>
              </div>
            </div>
          ) : (
            <div onClick={() => fileInputRef.current?.click()}
              className="rounded-xl border-2 border-dashed border-slate-200 p-8 text-center cursor-pointer hover:border-blue-300 hover:bg-blue-50/40 transition-all group">
              {uploadingSign ? (
                <div className="flex flex-col items-center gap-2">
                  <div className="w-6 h-6 border-2 border-blue-200 border-t-blue-600 rounded-full animate-spin" />
                  <span className="text-xs text-slate-400">上傳中...</span>
                </div>
              ) : (
                <>
                  <div className="w-12 h-12 rounded-full bg-slate-100 group-hover:bg-blue-100 flex items-center justify-center mx-auto mb-3 transition-colors">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-6 h-6 text-slate-400 group-hover:text-blue-500 transition-colors">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                      <polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
                    </svg>
                  </div>
                  <p className="text-sm font-medium text-slate-600 group-hover:text-blue-600 transition-colors">點選上傳簽名圖片</p>
                  <p className="text-xs text-slate-400 mt-1">PNG / JPG，最大 2MB</p>
                </>
              )}
            </div>
          )}
          <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleSignatureUpload} />
        </div>

        <div className="oms-card p-6">
          <div className="flex items-center gap-2 mb-1">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-4 h-4 text-blue-500">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
              <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
            </svg>
            <h2 className="text-sm font-semibold text-slate-800">修改密碼</h2>
          </div>
          <p className="text-xs text-slate-400 mb-5">定期更換密碼以保護帳號安全</p>
          <form onSubmit={handleChangePw} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1.5">目前密碼</label>
              <div className="relative">
                <input type={showCurrent ? 'text' : 'password'} className={`${inp} pr-10`}
                  value={pwForm.currentPassword} onChange={e => setPwForm(p => ({ ...p, currentPassword: e.target.value }))}
                  placeholder="輸入目前密碼" autoComplete="current-password" />
                <button type="button" onClick={() => setShowCurrent(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                  {showCurrent ? <EyeOff /> : <Eye />}
                </button>
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1.5">新密碼</label>
              <div className="relative">
                <input type={showNew ? 'text' : 'password'} className={`${inp} pr-10`}
                  value={pwForm.newPassword} onChange={e => setPwForm(p => ({ ...p, newPassword: e.target.value }))}
                  placeholder="至少 6 個字元" autoComplete="new-password" />
                <button type="button" onClick={() => setShowNew(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                  {showNew ? <EyeOff /> : <Eye />}
                </button>
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1.5">確認新密碼</label>
              <input type="password" className={inp} value={pwForm.confirmPassword}
                onChange={e => setPwForm(p => ({ ...p, confirmPassword: e.target.value }))}
                placeholder="再次輸入新密碼" autoComplete="new-password" />
            </div>
            <button type="submit" disabled={saving} className="btn-primary w-full mt-2">
              {saving ? '更新中...' : '更新密碼'}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}

function Eye() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
}
function EyeOff() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
}
