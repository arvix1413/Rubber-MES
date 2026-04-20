'use client'

import { useDialog } from '@/components/Dialog'
import { useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api'
import { ROLE_LABELS, ROLE_COLORS, getUser, type Role } from '@/lib/permissions'
import { useRouter } from 'next/navigation'
import { usePagination, Pagination } from '@/lib/usePagination'
import { validate } from '@/lib/validate'
import FieldLockHint from '@/components/FieldLockHint'
import { formatDateYMD } from '@/lib/datetime'

type User = { id: number; email: string; name: string; role: Role; created_at: string }
const empty = (): Partial<User> & { password?: string } => ({ email: '', name: '', role: 'employee', password: '' })
const DISPLAY_ROLES: Role[] = ['manager', 'employee']

export default function UsersPage() {
  const router = useRouter()
  const { toast, confirm: confirmDialog } = useDialog()
  const [users, setUsers] = useState<User[]>([])
  const [editing, setEditing] = useState<(Partial<User> & { password?: string }) | null>(null)
  const [loading, setLoading] = useState(true)
  const [changingRole, setChangingRole] = useState<number | null>(null)
  const [search, setSearch] = useState('')

  useEffect(() => {
    const me = getUser()
    if (!me || me.role !== 'manager') {
      router.replace('/dashboard')
      return
    }
    load()
  }, [router])

  const load = () => apiFetch<User[]>('/api/users').then(setUsers).finally(() => setLoading(false))

  const save = async () => {
    if (!editing) return
    const err = validate(editing, [
      { field: 'email', label: '電子郵件', required: true, email: true },
      { field: 'name', label: '姓名', required: true },
      ...(!editing.id ? [{ field: 'password', label: '密碼', required: true, minLen: 6 }] : []),
    ])
    if (err) { toast(err, 'error'); return }
    try {
      if (editing.id) {
        await apiFetch(`/api/users/${editing.id}`, { method: 'PUT', body: JSON.stringify(editing) })
      } else {
        await apiFetch('/api/users', { method: 'POST', body: JSON.stringify(editing) })
      }
      toast('儲存成功')
      setEditing(null)
      await load()
    } catch (e: any) { toast(`錯誤：${e.message}`, 'error') }
  }

  const changeRole = async (userId: number, newRole: Role) => {
    setChangingRole(userId)
    try {
      const user = users.find((u) => u.id === userId)
      if (!user) return
      await apiFetch(`/api/users/${userId}`, { method: 'PUT', body: JSON.stringify({ name: user.name, role: newRole }) })
      toast(`已將 ${user.name} 更新為「${ROLE_LABELS[newRole]}」`)
      await load()
    } catch (e: any) {
      toast(`更新失敗：${e.message}`, 'error')
    } finally {
      setChangingRole(null)
    }
  }

  const del = async (id: number, name: string) => {
    if (!await confirmDialog(`確定刪除使用者「${name}」？`, '此操作無法復原')) return
    try {
      await apiFetch(`/api/users/${id}`, { method: 'DELETE' })
      toast('使用者已刪除')
      await load()
    } catch (e: any) { toast(`刪除失敗：${e.message}`, 'error') }
  }

  const resetPassword = async (id: number, name: string) => {
    if (!await confirmDialog(`重置「${name}」密碼？`, '密碼將重置為 admin123，請通知使用者盡快修改', '確認重置')) return
    try {
      await apiFetch(`/api/users/${id}/reset-password`, { method: 'POST' })
      toast(`已重置 ${name} 密碼為 admin123`)
    } catch (e: any) { toast(`重置失敗：${e.message}`, 'error') }
  }

  const me = getUser()
  const inp = 'rubber-input'
  const lockedInp = `${inp} bg-slate-100 text-slate-500 border-slate-200 cursor-not-allowed`
  const filtered = users.filter((u) => !search || u.name.toLowerCase().includes(search.toLowerCase()) || u.email.toLowerCase().includes(search.toLowerCase()))
  const { page, setPage, totalPages, paged, total } = usePagination(filtered, 20)

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-slate-800">使用者管理</h1>
          <p className="text-xs text-slate-400 mt-0.5">僅主管可管理帳號、角色與密碼重置</p>
        </div>
        <button onClick={() => setEditing(empty())} className="btn-primary">+ 新增使用者</button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        {DISPLAY_ROLES.map((role) => (
          <div key={role} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <span className={`inline-block text-xs px-2 py-0.5 rounded-full font-medium mb-2 ${ROLE_COLORS[role]}`}>{ROLE_LABELS[role]}</span>
            <div className="text-xs text-slate-400">{role === 'manager' ? '可管理全系統設定' : '僅可執行日常作業'}</div>
            <div className="text-xs font-semibold mt-2">{users.filter((u) => u.role === role).length} 人</div>
          </div>
        ))}
      </div>

      {editing && (
        <div className="rubber-card p-6 mb-5">
          <h2 className="font-semibold mb-4 text-lg">{editing.id ? '編輯使用者資料' : '新增使用者'}</h2>
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium mb-1 text-gray-700 flex items-center gap-1.5">
                電子郵件 *
                {editing.id && <FieldLockHint title="帳號建立後不可修改" />}
              </label>
              <input
                type="email"
                className={editing.id ? lockedInp : inp}
                value={editing.email || ''}
                onChange={(e) => setEditing((p) => ({ ...p, email: e.target.value }))}
                disabled={!!editing.id}
                placeholder="user@company.com"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1 text-gray-700">姓名 *</label>
              <input className={inp} value={editing.name || ''} onChange={(e) => setEditing((p) => ({ ...p, name: e.target.value }))} placeholder="使用者姓名" />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1 text-gray-700">角色 *</label>
              <select className={inp} value={editing.role || 'employee'} onChange={(e) => setEditing((p) => ({ ...p, role: e.target.value as Role }))}>
                <option value="manager">主管</option>
                <option value="employee">員工</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1 text-gray-700">{editing.id ? '新密碼（留空不修改）' : '密碼 *'}</label>
              <input
                type="password"
                className={inp}
                value={editing.password || ''}
                onChange={(e) => setEditing((p) => ({ ...p, password: e.target.value }))}
                placeholder={editing.id ? '留空則不修改密碼' : '至少 6 個字元'}
              />
            </div>
          </div>
          <div className="flex gap-3 mt-5">
            <button onClick={save} className="btn-primary">{editing.id ? '儲存變更' : '建立使用者'}</button>
            <button onClick={() => setEditing(null)} className="btn-ghost border border-slate-200">取消</button>
          </div>
        </div>
      )}

      <div className="rubber-card overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
          <span className="text-sm font-semibold text-slate-600">共 {users.length} 位使用者</span>
          <input className="rubber-input w-56" placeholder="搜尋姓名或Email..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        {loading ? (
          <div className="text-xs text-slate-500 p-6">載入中...</div>
        ) : (
          <>
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-4 py-3 text-left">使用者</th>
                  <th className="px-4 py-3 text-left">角色</th>
                  <th className="px-4 py-3 text-left">建立日期</th>
                  <th className="px-4 py-3 text-left">操作</th>
                </tr>
              </thead>
              <tbody>
                {paged.map((u) => (
                  <tr key={u.id} className="border-t border-slate-100">
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-800">{u.name}</div>
                      <div className="text-xs text-slate-400">{u.email}</div>
                    </td>
                    <td className="px-4 py-3">
                      {me?.id !== u.id ? (
                        <div className="flex items-center gap-2">
                          <select value={u.role} onChange={(e) => changeRole(u.id, e.target.value as Role)} disabled={changingRole === u.id} className="rubber-input text-xs py-1.5">
                            <option value="manager">主管</option>
                            <option value="employee">員工</option>
                          </select>
                        </div>
                      ) : (
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${ROLE_COLORS[u.role]}`}>{ROLE_LABELS[u.role]}（自己）</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500">{formatDateYMD(u.created_at) || '—'}</td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2">
                        <button onClick={() => setEditing({ ...u, password: '' })} className="btn-ghost">編輯</button>
                        {me?.id !== u.id && <button onClick={() => resetPassword(u.id, u.name)} className="btn-ghost text-amber-600">重置密碼</button>}
                        {me?.id !== u.id && <button onClick={() => del(u.id, u.name)} className="btn-danger">刪除</button>}
                      </div>
                    </td>
                  </tr>
                ))}
                {paged.length === 0 && <tr><td colSpan={4} className="px-4 py-10 text-center text-slate-400">尚無使用者</td></tr>}
              </tbody>
            </table>
            <Pagination page={page} totalPages={totalPages} setPage={setPage} total={total} />
          </>
        )}
      </div>
    </div>
  )
}
