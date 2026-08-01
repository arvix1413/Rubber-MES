'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { apiFetch } from '@/lib/api'
import { formatDateTime, todayYMD } from '@/lib/datetime'
import { getUser } from '@/lib/permissions'
import { Pagination } from '@/lib/usePagination'

type AuditLog = {
  id: number
  user_id: number
  user_name: string
  user_email: string
  action: string
  resource: string
  resource_id: string
  detail: string
  created_at: string
}

type AuditResponse = {
  logs: AuditLog[]
  total: number
  options: { resources: string[]; actions: string[] }
}

type Filters = {
  search: string
  userEmail: string
  resource: string
  action: string
  dateFrom: string
  dateTo: string
}

const PAGE_SIZE = 20
const emptyFilters = (): Filters => ({ search: '', userEmail: '', resource: '', action: '', dateFrom: '', dateTo: '' })

const ACTION_LABELS: Record<string, string> = {
  CREATE: '新增', UPDATE: '修改', DELETE: '刪除', APPROVE: '審核', CONFIRM: '確認',
  RECEIVE: '收貨', PAYMENT: '收付款', STATUS_CHANGE: '狀態變更', STATUS_REPAIR: '狀態修復',
  LOGIN: '登入', LOGIN_FAILED: '登入失敗', LOGOUT: '登出', MIGRATE: '資料遷移',
  FIX: '資料修復', SYNC: '同步', BACKFILL: '資料補齊',
}

const ACTION_TONES: Record<string, string> = {
  CREATE: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  UPDATE: 'bg-blue-50 text-blue-700 border-blue-200',
  DELETE: 'bg-red-50 text-red-700 border-red-200',
  APPROVE: 'bg-violet-50 text-violet-700 border-violet-200',
  LOGIN: 'bg-cyan-50 text-cyan-700 border-cyan-200',
  LOGIN_FAILED: 'bg-rose-50 text-rose-700 border-rose-200',
  LOGOUT: 'bg-slate-100 text-slate-600 border-slate-200',
}

export default function AuditLogsPage() {
  const router = useRouter()
  const [draft, setDraft] = useState<Filters>(emptyFilters)
  const [filters, setFilters] = useState<Filters>(emptyFilters)
  const [logs, setLogs] = useState<AuditLog[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [options, setOptions] = useState<AuditResponse['options']>({ resources: [], actions: [] })

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String((page - 1) * PAGE_SIZE) })
      if (filters.search) params.set('search', filters.search)
      if (filters.userEmail) params.set('user_email', filters.userEmail)
      if (filters.resource) params.set('resource', filters.resource)
      if (filters.action) params.set('action', filters.action)
      if (filters.dateFrom) params.set('date_from', filters.dateFrom)
      if (filters.dateTo) params.set('date_to', filters.dateTo)
      const data = await apiFetch<AuditResponse>(`/api/audit-logs?${params.toString()}`)
      setLogs(data.logs || [])
      setTotal(Number(data.total || 0))
      setOptions(data.options || { resources: [], actions: [] })
    } catch (e: any) {
      setError(e.message || '操作日誌載入失敗')
    } finally {
      setLoading(false)
    }
  }, [filters, page])

  useEffect(() => {
    const me = getUser()
    if (!me || me.role !== 'manager') {
      router.replace('/dashboard')
      return
    }
    load()
  }, [load, router])

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const activeFilterCount = useMemo(() => Object.values(filters).filter(Boolean).length, [filters])

  const applyFilters = () => {
    if (draft.dateFrom && draft.dateTo && draft.dateFrom > draft.dateTo) {
      setError('開始日期不可晚於結束日期')
      return
    }
    setError('')
    setPage(1)
    setFilters({ ...draft })
  }

  const resetFilters = () => {
    const reset = emptyFilters()
    setDraft(reset)
    setPage(1)
    setFilters(reset)
  }

  return (
    <div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-slate-800">操作日誌</h1>
          <p className="text-xs text-slate-400 mt-0.5">追蹤登入、資料異動、審核與狀態變更；僅主管可查看</p>
        </div>
        <button onClick={load} className="btn-ghost border border-slate-200" disabled={loading}>重新整理</button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5">
        <div className="rubber-card p-4">
          <div className="text-xs text-slate-400">符合條件的記錄</div>
          <div className="text-2xl font-bold text-slate-800 mt-1">{total.toLocaleString()}</div>
        </div>
        <div className="rubber-card p-4">
          <div className="text-xs text-slate-400">目前篩選條件</div>
          <div className="text-2xl font-bold text-slate-800 mt-1">{activeFilterCount}</div>
        </div>
        <div className="rubber-card p-4">
          <div className="text-xs text-slate-400">系統日期</div>
          <div className="text-lg font-semibold text-slate-700 mt-2">{todayYMD()}</div>
        </div>
      </div>

      <div className="rubber-card p-4 mb-5">
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-6 gap-3">
          <div className="xl:col-span-2">
            <label className="block text-xs font-medium text-slate-600 mb-1">關鍵字</label>
            <input className="rubber-input" placeholder="姓名、單號、明細或模組" value={draft.search} onChange={(e) => setDraft((p) => ({ ...p, search: e.target.value }))} onKeyDown={(e) => e.key === 'Enter' && applyFilters()} />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">操作人 Email</label>
            <input className="rubber-input" placeholder="name@company.com" value={draft.userEmail} onChange={(e) => setDraft((p) => ({ ...p, userEmail: e.target.value }))} onKeyDown={(e) => e.key === 'Enter' && applyFilters()} />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">業務模組</label>
            <select className="rubber-input" value={draft.resource} onChange={(e) => setDraft((p) => ({ ...p, resource: e.target.value }))}>
              <option value="">全部模組</option>
              {options.resources.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">操作類型</label>
            <select className="rubber-input" value={draft.action} onChange={(e) => setDraft((p) => ({ ...p, action: e.target.value }))}>
              <option value="">全部操作</option>
              {options.actions.map((value) => <option key={value} value={value}>{ACTION_LABELS[value] || value}</option>)}
            </select>
          </div>
          <div className="flex items-end gap-2">
            <button className="btn-primary flex-1" onClick={applyFilters}>查詢</button>
            <button className="btn-ghost border border-slate-200" onClick={resetFilters}>清除</button>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">開始日期</label>
            <input type="date" className="rubber-input" value={draft.dateFrom} onChange={(e) => setDraft((p) => ({ ...p, dateFrom: e.target.value }))} />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">結束日期</label>
            <input type="date" className="rubber-input" value={draft.dateTo} onChange={(e) => setDraft((p) => ({ ...p, dateTo: e.target.value }))} />
          </div>
        </div>
        {error && <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}
      </div>

      <div className="rubber-card overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
          <span className="text-sm font-semibold text-slate-600">日誌明細</span>
          <span className="text-xs text-slate-400">資料依時間由新到舊排列</span>
        </div>
        {loading ? (
          <div className="p-10 text-center text-sm text-slate-400">正在載入操作日誌…</div>
        ) : (
          <>
            <div className="table-scroll-x">
              <table className="min-w-full text-sm" style={{ minWidth: 1120 }}>
                <thead className="bg-slate-50 text-slate-600">
                  <tr>
                    <th className="px-4 py-3 text-left">時間</th>
                    <th className="px-4 py-3 text-left">操作人</th>
                    <th className="px-4 py-3 text-left">操作</th>
                    <th className="px-4 py-3 text-left">模組 / 記錄</th>
                    <th className="px-4 py-3 text-left">內容</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((log) => (
                    <tr key={log.id} className="border-t border-slate-100 align-top hover:bg-slate-50/60">
                      <td className="px-4 py-3 whitespace-nowrap text-xs text-slate-500">{formatDateTime(log.created_at) || '—'}</td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-800">{log.user_name || '系統'}</div>
                        <div className="text-xs text-slate-400 mt-0.5">{log.user_email || '—'}</div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${ACTION_TONES[log.action] || 'bg-amber-50 text-amber-700 border-amber-200'}`}>
                          {ACTION_LABELS[log.action] || log.action}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-700">{log.resource || '—'}</div>
                        <div className="text-xs text-slate-400 mt-0.5">記錄：{log.resource_id || '—'}</div>
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-600 whitespace-normal break-words max-w-md">{log.detail || '—'}</td>
                    </tr>
                  ))}
                  {logs.length === 0 && <tr><td colSpan={5} className="px-4 py-12 text-center text-slate-400">沒有符合條件的操作記錄</td></tr>}
                </tbody>
              </table>
            </div>
            <Pagination page={page} totalPages={totalPages} setPage={setPage} total={total} pageSize={PAGE_SIZE} />
          </>
        )}
      </div>
    </div>
  )
}
