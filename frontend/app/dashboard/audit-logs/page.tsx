'use client'
import { useEffect, useState, useCallback } from 'react'
import { apiFetch } from '@/lib/api'
import { usePagination, Pagination } from '@/lib/usePagination'

type Log = {
  id: number
  user_name: string
  user_email: string
  action: string
  resource: string
  resource_id: string
  detail: string
  created_at: string
}

const ACTION_BADGE: Record<string, string> = {
  CREATE: 'badge-green',
  UPDATE: 'badge-blue',
  DELETE: 'badge-red',
  APPROVE: 'badge-purple',
  STATUS_CHANGE: 'badge-yellow',
}
const ACTION_LABEL: Record<string, string> = {
  CREATE: '新增',
  UPDATE: '修改',
  DELETE: '刪除',
  APPROVE: '核准',
  STATUS_CHANGE: '狀態變更',
}

const RESOURCES = ['', '供應商', '客戶', '料號', 'BOM', '採購單', '客戶訂單', '報價單', '出貨單', '送貨單', '庫存', '使用者']

export default function AuditLogsPage() {
  const [logs, setLogs] = useState<Log[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [filterResource, setFilterResource] = useState('')
  const [filterEmail, setFilterEmail] = useState('')
  const [filterAction, setFilterAction] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ limit: '500', offset: '0' })
      if (filterResource) params.set('resource', filterResource)
      if (filterEmail) params.set('user_email', filterEmail)
      const data = await apiFetch<{ logs: Log[]; total: number }>(`/api/audit-logs?${params}`)
      setLogs(data.logs || [])
      setTotal(data.total || 0)
    } catch {}
    setLoading(false)
  }, [filterResource, filterEmail])

  useEffect(() => { load() }, [load])

  const filtered = filterAction ? logs.filter(l => l.action === filterAction) : logs
  const { page, setPage, totalPages, paged, total: filteredTotal } = usePagination(filtered, 50)

  const stats = {
    total: logs.length,
    creates: logs.filter(l => l.action === 'CREATE').length,
    updates: logs.filter(l => l.action === 'UPDATE').length,
    deletes: logs.filter(l => l.action === 'DELETE').length,
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-slate-800">操作日誌</h1>
          <p className="text-xs text-slate-500 mt-0.5">記錄所有使用者的新增、修改、刪除操作</p>
        </div>
        <button onClick={load} className="btn-ghost">↻ 重新整理</button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        {[
          { label: '全部操作', value: stats.total, color: 'text-slate-700', bg: 'bg-slate-100' },
          { label: '新增', value: stats.creates, color: 'text-emerald-700', bg: 'bg-emerald-100' },
          { label: '修改', value: stats.updates, color: 'text-blue-700', bg: 'bg-blue-100' },
          { label: '刪除', value: stats.deletes, color: 'text-red-700', bg: 'bg-red-100' },
        ].map(s => (
          <div key={s.label} className="oms-card p-4">
            <div className={`w-8 h-8 rounded-lg ${s.bg} flex items-center justify-center text-sm font-bold ${s.color} mb-2`}>
              {s.value}
            </div>
            <div className="text-xs text-slate-500 font-medium">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex gap-3 mb-4 flex-wrap">
        <select className="oms-input w-36" value={filterResource} onChange={e => { setFilterResource(e.target.value); setPage(1) }}>
          <option value="">全部模組</option>
          {RESOURCES.filter(Boolean).map(r => <option key={r} value={r}>{r}</option>)}
        </select>
        <select className="oms-input w-36" value={filterAction} onChange={e => { setFilterAction(e.target.value); setPage(1) }}>
          <option value="">全部操作</option>
          {Object.entries(ACTION_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <input className="oms-input w-52" placeholder="搜尋使用者電子郵件..." value={filterEmail}
          onChange={e => setFilterEmail(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && load()} />
        <button onClick={load} className="btn-primary">搜尋</button>
        {(filterResource || filterEmail || filterAction) && (
          <button onClick={() => { setFilterResource(''); setFilterEmail(''); setFilterAction(''); }} className="btn-ghost">清除篩選</button>
        )}
      </div>

      <div className="oms-card overflow-hidden">
        {loading ? (
          <div className="flex justify-center py-16"><div className="w-5 h-5 border-2 border-blue-200 border-t-blue-600 rounded-full animate-spin" /></div>
        ) : (
          <>
            <table className="oms-table">
              <thead>
                <tr>
                  <th>時間</th>
                  <th>操作者</th>
                  <th>操作</th>
                  <th>模組</th>
                  <th>ID</th>
                  <th>詳情</th>
                </tr>
              </thead>
              <tbody>
                {paged.map(log => (
                  <tr key={log.id}>
                    <td className="text-xs text-slate-500 whitespace-nowrap">{log.created_at ? String(log.created_at).slice(0,16).replace('T',' ') : '—'}</td>
                    <td>
                      <div className="text-sm font-medium text-slate-700">{log.user_name}</div>
                      <div className="text-xs text-slate-400">{log.user_email}</div>
                    </td>
                    <td>
                      <span className={ACTION_BADGE[log.action] || 'badge-gray'}>
                        {ACTION_LABEL[log.action] || log.action}
                      </span>
                    </td>
                    <td className="font-medium text-slate-700">{log.resource}</td>
                    <td className="font-mono text-xs text-slate-400">{log.resource_id}</td>
                    <td className="text-slate-600 max-w-[280px] truncate" title={log.detail}>{log.detail}</td>
                  </tr>
                ))}
                {paged.length === 0 && (
                  <tr><td colSpan={6} className="text-center py-12 text-slate-400">尚無操作記錄</td></tr>
                )}
              </tbody>
            </table>
            <Pagination page={page} totalPages={totalPages} setPage={setPage} total={filteredTotal} pageSize={50} />
          </>
        )}
      </div>
    </div>
  )
}
