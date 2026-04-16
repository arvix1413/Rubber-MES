'use client'
import { useDialog } from '@/components/Dialog'
import { useEffect, useState, useRef } from 'react'
import { apiFetch, API, getToken } from '@/lib/api'
import { can } from '@/lib/usePermissions'
import { useRouter } from 'next/navigation'
import { clearCompanyCache, type CompanySettings } from '@/lib/useCompany'

const DEFAULT: CompanySettings = {
  id: 1,
  company_name: 'FAN YONG CO., LTD',
  company_name_local: 'CÔNG TY TNHH FAN YONG VIỆT NAM',
  address: '152 Hà Huy Tập, P. Tân Hưng, TP. HCM',
  phone: '0909883372 Danny Lin / 0909042239 Mỹ Linh',
  contact_person: 'Danny Lin / Mỹ Linh Ellachen',
  email: '',
  tax_id: '',
  logo_url: null,
}

export default function CompanyPage() {
  const router = useRouter()
  const { toast } = useDialog()
  const [form, setForm] = useState<CompanySettings>(DEFAULT)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!can('company.manage')) { router.replace('/dashboard'); return }
    apiFetch<CompanySettings>('/api/company')
      .then(d => setForm({ ...DEFAULT, ...d }))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [router])

  const uploadLogo = async (file: File) => {
    if (!file.type.startsWith('image/')) { toast('請上傳圖片', 'error'); return }
    setUploading(true)
    try {
      const fd = new FormData(); fd.append('file', file)
      const res = await fetch(`${API}/api/upload`, { method: 'POST', headers: { Authorization: `Bearer ${getToken()}` }, body: fd })
      const data = await res.json()
      setForm(p => ({ ...p, logo_url: data.url || null }))
      toast('Logo 已上傳')
    } catch (e: any) { toast('上傳失敗：' + e.message, 'error') }
    finally { setUploading(false) }
  }

  const save = async () => {
    if (!form.company_name) { toast('請填寫公司名稱', 'error'); return }
    setSaving(true)
    try {
      await apiFetch('/api/company', { method: 'PUT', body: JSON.stringify(form) })
      clearCompanyCache()
      toast('公司設定已儲存，所有列印表單將使用新資訊')
    } catch (e: any) { toast('儲存失敗：' + e.message, 'error') }
    finally { setSaving(false) }
  }

  const logoFullUrl = form.logo_url
    ? (form.logo_url.startsWith('http') ? form.logo_url : `${API}${form.logo_url}`)
    : null

  if (loading) return <div className="flex justify-center py-16"><div className="w-5 h-5 border-2 border-blue-200 border-t-blue-600 rounded-full animate-spin"/></div>

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-slate-800">公司設定</h1>
        <p className="text-xs text-slate-400 mt-0.5">修改後將套用到所有列印表單（採購單、出貨單、送貨單、報價單、客戶訂單）</p>
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,2fr)_minmax(360px,1fr)] gap-6 items-start">
        <div className="oms-card p-6 space-y-5">
          {/* Logo */}
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-2">公司 Logo</label>
            <div className="flex items-center gap-4">
              {logoFullUrl ? (
                <div className="w-24 h-16 border border-slate-200 rounded-lg flex items-center justify-center bg-slate-50 overflow-hidden">
                  <img src={logoFullUrl} alt="Logo" className="max-w-full max-h-full object-contain"
                    onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
                </div>
              ) : (
                <div className="w-24 h-16 border-2 border-dashed border-slate-200 rounded-lg flex items-center justify-center text-slate-300 text-xs">無 Logo</div>
              )}
              <div className="flex flex-col gap-2">
                <button onClick={() => fileRef.current?.click()} disabled={uploading}
                  className="btn-ghost border border-slate-200 text-xs">
                  {uploading ? '上傳中...' : '上傳 Logo'}
                </button>
                {form.logo_url && (
                  <button onClick={() => setForm(p => ({ ...p, logo_url: null }))} className="text-xs text-red-500 hover:underline">移除</button>
                )}
              </div>
            </div>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) uploadLogo(f) }} />
            <p className="text-[11px] text-slate-400 mt-1">建議尺寸：200×80px，PNG/JPG，最大 2MB</p>
          </div>

          {/* Fields */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {[
              { key: 'company_name', label: '公司名稱（英文）*', placeholder: 'FAN YONG CO., LTD' },
              { key: 'company_name_local', label: '公司名稱（當地語言）', placeholder: 'CÔNG TY TNHH FAN YONG VIỆT NAM' },
              { key: 'address', label: '地址', placeholder: '152 Hà Huy Tập, P. Tân Hưng, TP. HCM', wide: true },
              { key: 'phone', label: '電話 / 聯絡方式', placeholder: '0909883372 Danny Lin / 0909042239 Mỹ Linh', wide: true },
              { key: 'contact_person', label: '聯絡人', placeholder: 'Danny Lin / Mỹ Linh Ellachen' },
              { key: 'email', label: '電子郵件', placeholder: 'info@fanyong.com' },
              { key: 'tax_id', label: '統一編號 / 稅號', placeholder: '' },
            ].map(({ key, label, placeholder, wide }) => (
              <div key={key} className={wide ? 'lg:col-span-2' : ''}>
                <label className="block text-xs font-semibold text-slate-600 mb-1.5">{label}</label>
                <input
                  className="oms-input"
                  value={(form as any)[key] || ''}
                  placeholder={placeholder}
                  onChange={e => setForm(p => ({ ...p, [key]: e.target.value }))}
                />
              </div>
            ))}
          </div>

          <div className="pt-2">
            <button onClick={save} disabled={saving} className="btn-primary">
              {saving ? '儲存中...' : '儲存設定'}
            </button>
          </div>
        </div>

        {/* Preview */}
        <div className="oms-card p-5 xl:sticky xl:top-6">
          <div className="text-xs font-semibold text-slate-500 mb-3 uppercase tracking-wider">列印預覽</div>
          <div className="border border-slate-200 rounded-lg p-4 bg-white text-xs">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3 mb-3">
              <div>
                {logoFullUrl && <img src={logoFullUrl} alt="" className="h-8 mb-1 object-contain" onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />}
                <div className="font-bold text-sm">{form.company_name || '—'}</div>
                <div className="text-slate-400">{form.company_name_local}</div>
              </div>
              <div className="text-right">
                <div className="text-lg font-bold text-blue-600">採購單</div>
                <div className="text-slate-400 text-[10px]">PURCHASE ORDER</div>
              </div>
            </div>
            <div className="text-slate-500 space-y-0.5">
              {form.address && <div>地址：{form.address}</div>}
              {form.phone && <div>電話：{form.phone}</div>}
              {form.contact_person && <div>聯絡人：{form.contact_person}</div>}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
