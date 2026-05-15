'use client'

import { useDialog } from '@/components/Dialog'
import { useEffect, useRef, useState } from 'react'
import { apiFetch, apiFetchRaw, API } from '@/lib/api'
import { useRouter } from 'next/navigation'
import { clearCompanyCache, type CompanySettings } from '@/lib/useCompany'
import { getUser } from '@/lib/permissions'

const DEFAULT: CompanySettings = {
  id: 1,
  company_name: 'RUBBER MES CO., LTD',
  company_name_local: '',
  address: '',
  phone: '',
  contact_person: '',
  email: '',
  tax_id: '',
  logo_url: null,
  signature_url: null,
}

export default function CompanyPage() {
  const router = useRouter()
  const { toast } = useDialog()
  const [form, setForm] = useState<CompanySettings>(DEFAULT)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadingSignature, setUploadingSignature] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const signatureFileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const me = getUser()
    if (!me || me.role !== 'manager') {
      router.replace('/dashboard')
      return
    }
    apiFetch<CompanySettings>('/api/company')
      .then((d) => setForm({ ...DEFAULT, ...d }))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [router])

  const uploadLogo = async (file: File) => {
    if (!file.type.startsWith('image/')) { toast('請上傳圖片', 'error'); return }
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await apiFetchRaw('/api/upload', { method: 'POST', body: fd })
      if (!res.ok) throw new Error('上傳失敗')
      const data = await res.json()
      setForm((p) => ({ ...p, logo_url: data.url || null }))
      toast('Logo 已上傳')
    } catch (e: any) {
      toast(`上傳失敗：${e.message}`, 'error')
    } finally {
      setUploading(false)
    }
  }

  const uploadSignature = async (file: File) => {
    if (!file.type.startsWith('image/')) { toast('請上傳圖片', 'error'); return }
    setUploadingSignature(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await apiFetchRaw('/api/upload', { method: 'POST', body: fd })
      if (!res.ok) throw new Error('上傳失敗')
      const data = await res.json()
      setForm((p) => ({ ...p, signature_url: data.url || null }))
      toast('主管簽名已上傳')
    } catch (e: any) {
      toast(`上傳失敗：${e.message}`, 'error')
    } finally {
      setUploadingSignature(false)
    }
  }

  const save = async () => {
    if (!form.company_name) { toast('請填寫公司名稱', 'error'); return }
    setSaving(true)
    try {
      await apiFetch('/api/company', { method: 'PUT', body: JSON.stringify(form) })
      clearCompanyCache()
      toast('公司設定已儲存')
    } catch (e: any) {
      toast(`儲存失敗：${e.message}`, 'error')
    } finally {
      setSaving(false)
    }
  }

  const logoFullUrl = form.logo_url
    ? (form.logo_url.startsWith('http') ? form.logo_url : `${API}${form.logo_url}`)
    : null
  const signatureFullUrl = form.signature_url
    ? (form.signature_url.startsWith('http') ? form.signature_url : `${API}${form.signature_url}`)
    : null

  if (loading) return <div className="text-xs text-slate-500">載入中...</div>

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-slate-800">公司設定</h1>
        <p className="text-xs text-slate-400 mt-0.5">僅主管可修改，將套用到所有列印單據</p>
      </div>

      <div className="rubber-card p-5 space-y-5 max-w-4xl">
        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-2">公司 Logo</label>
          <div className="flex items-center gap-4">
            {logoFullUrl ? (
              <div className="w-24 h-16 border border-slate-200 rounded-lg flex items-center justify-center bg-slate-50 overflow-hidden">
                <img src={logoFullUrl} alt="Logo" className="max-w-full max-h-full object-contain" />
              </div>
            ) : (
              <div className="w-24 h-16 border-2 border-dashed border-slate-200 rounded-lg flex items-center justify-center text-slate-300 text-xs">無 Logo</div>
            )}
            <div className="flex flex-col gap-2">
              <button onClick={() => fileRef.current?.click()} disabled={uploading} className="btn-ghost border border-slate-200 text-xs">
                {uploading ? '上傳中...' : '上傳 Logo'}
              </button>
              {form.logo_url && <button onClick={() => setForm((p) => ({ ...p, logo_url: null }))} className="text-xs text-red-500 hover:underline">移除</button>}
            </div>
          </div>
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadLogo(f) }} />
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-2">統一主管簽名</label>
          <div className="flex items-center gap-4">
            {signatureFullUrl ? (
              <div className="w-36 h-20 border border-slate-200 rounded-lg flex items-center justify-center bg-slate-50 overflow-hidden">
                <img src={signatureFullUrl} alt="Manager Signature" className="max-w-full max-h-full object-contain" />
              </div>
            ) : (
              <div className="w-36 h-20 border-2 border-dashed border-slate-200 rounded-lg flex items-center justify-center text-slate-300 text-xs">無主管簽名</div>
            )}
            <div className="flex flex-col gap-2">
              <button onClick={() => signatureFileRef.current?.click()} disabled={uploadingSignature} className="btn-ghost border border-slate-200 text-xs">
                {uploadingSignature ? '上傳中...' : '上傳主管簽名'}
              </button>
              {form.signature_url && <button onClick={() => setForm((p) => ({ ...p, signature_url: null }))} className="text-xs text-red-500 hover:underline">移除</button>}
            </div>
          </div>
          <input ref={signatureFileRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadSignature(f) }} />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[
            { key: 'company_name', label: '公司名稱（英文）*', placeholder: 'RUBBER MES CO., LTD' },
            { key: 'company_name_local', label: '公司名稱（當地語言）', placeholder: '' },
            { key: 'address', label: '地址', placeholder: '', wide: true },
            { key: 'phone', label: '電話', placeholder: '' },
            { key: 'contact_person', label: '聯絡人', placeholder: '' },
            { key: 'email', label: '電子郵件', placeholder: '' },
            { key: 'tax_id', label: '統編 / 稅號', placeholder: '' },
          ].map(({ key, label, placeholder, wide }) => (
            <div key={key} className={wide ? 'md:col-span-2' : ''}>
              <label className="block text-xs font-semibold text-slate-600 mb-1.5">{label}</label>
              <input
                className="rubber-input"
                value={(form as any)[key] || ''}
                placeholder={placeholder}
                onChange={(e) => setForm((p) => ({ ...p, [key]: e.target.value }))}
              />
            </div>
          ))}
        </div>

        <div>
          <button onClick={save} disabled={saving} className="btn-primary">
            {saving ? '儲存中...' : '儲存設定'}
          </button>
        </div>
      </div>
    </div>
  )
}
