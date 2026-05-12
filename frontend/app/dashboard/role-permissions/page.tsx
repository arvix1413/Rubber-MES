'use client'

import { useDialog } from '@/components/Dialog'
import { useEffect, useMemo, useState } from 'react'
import { apiFetch } from '@/lib/api'
import { getUser } from '@/lib/permissions'
import { useRouter } from 'next/navigation'

type PermissionItem = { key: string; label: string }
type RolePermissionResponse = {
  permissions: Record<string, Record<string, boolean>>
  allPermissions: PermissionItem[]
}

const GROUP_TITLES: Record<string, string> = {
  customer_order: '客戶訂單',
  bom: 'BOM / 產品規格',
  po: '採購單',
  production: '生產單',
  delivery: '出貨單',
  customer: '客戶主檔',
  supplier: '供應商主檔',
  stock: '庫存',
  company: '公司設定',
  user: '使用者管理',
  audit: '操作日誌',
}

const MANAGER_RESERVED_PERMISSIONS = new Set(['company.manage', 'user.manage'])

export default function RolePermissionsPage() {
  const router = useRouter()
  const { toast } = useDialog()
  const [loading, setLoading] = useState(true)
  const [permissions, setPermissions] = useState<Record<string, boolean>>({})
  const [allPermissions, setAllPermissions] = useState<PermissionItem[]>([])
  const [savingKey, setSavingKey] = useState<string | null>(null)

  useEffect(() => {
    const me = getUser()
    if (!me || me.role !== 'manager') {
      router.replace('/dashboard')
      return
    }
    load()
  }, [router])

  const load = () =>
    apiFetch<RolePermissionResponse>('/api/role-permissions')
      .then((data) => {
        setPermissions(data.permissions?.employee || {})
        setAllPermissions(data.allPermissions || [])
      })
      .catch((e: any) => toast(`載入失敗：${e.message}`, 'error'))
      .finally(() => setLoading(false))

  const groups = useMemo(() => {
    const editablePermissions = allPermissions.filter((item) => !MANAGER_RESERVED_PERMISSIONS.has(item.key))
    const grouped = new Map<string, PermissionItem[]>()
    for (const item of editablePermissions) {
      const groupKey = item.key.split('.')[0]
      const list = grouped.get(groupKey) || []
      list.push(item)
      grouped.set(groupKey, list)
    }
    return Array.from(grouped.entries()).map(([groupKey, items]) => ({
      groupKey,
      title: GROUP_TITLES[groupKey] || groupKey,
      items,
    }))
  }, [allPermissions])

  const editableCount = allPermissions.filter((item) => !MANAGER_RESERVED_PERMISSIONS.has(item.key)).length
  const enabledCount = allPermissions.filter((item) => !MANAGER_RESERVED_PERMISSIONS.has(item.key) && permissions[item.key]).length

  const updatePermission = async (permission: string, allowed: boolean) => {
    setSavingKey(permission)
    const prev = permissions[permission] || false
    setPermissions((p) => ({ ...p, [permission]: allowed }))
    try {
      await apiFetch('/api/role-permissions', {
        method: 'PUT',
        body: JSON.stringify({ role: 'employee', permission, allowed }),
      })
      toast(`${allowed ? '已開啟' : '已關閉'}員工權限`)
    } catch (e: any) {
      setPermissions((p) => ({ ...p, [permission]: prev }))
      toast(`更新失敗：${e.message}`, 'error')
    } finally {
      setSavingKey(null)
    }
  }

  if (loading) return <div className="text-xs text-slate-500">載入中...</div>

  return (
    <div>
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-xl font-bold text-slate-800">權限設定</h1>
          <p className="text-xs text-slate-400 mt-0.5">主管可調整員工角色可執行的功能；主管本身維持全權限。</p>
        </div>
        <div className="rubber-card px-4 py-3 min-w-[220px]">
          <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">員工權限總覽</div>
          <div className="mt-2 text-2xl font-bold text-slate-800">{enabledCount} / {editableCount}</div>
          <div className="text-xs text-slate-400 mt-1">已啟用的員工權限數量</div>
        </div>
      </div>

      <div className="rubber-card px-5 py-4 mb-4 border border-amber-200 bg-amber-50/60">
        <div className="text-sm font-semibold text-amber-800">主管保留權限</div>
        <p className="text-xs text-amber-700 mt-1">
          `公司設定`、`使用者管理` 目前仍是主管專屬路由與 API，不開放指派給員工。
        </p>
      </div>

      <div className="grid gap-4">
        {groups.map((group) => (
          <div key={group.groupKey} className="rubber-card overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 bg-slate-50">
              <h2 className="text-sm font-semibold text-slate-700">{group.title}</h2>
              <p className="text-[11px] text-slate-400 mt-1">以下开关针对 `employee` 角色生效。</p>
            </div>
            <div className="divide-y divide-slate-100">
              {group.items.map((item) => {
                const checked = !!permissions[item.key]
                const saving = savingKey === item.key
                return (
                  <label key={item.key} className="flex items-center justify-between gap-4 px-5 py-4 cursor-pointer">
                    <div>
                      <div className="text-sm font-medium text-slate-800">{item.label}</div>
                      <div className="text-[11px] text-slate-400 mt-1 font-mono">{item.key}</div>
                    </div>
                    <div className="flex items-center gap-3">
                      {saving && <span className="text-[11px] text-slate-400">儲存中...</span>}
                      <button
                        type="button"
                        role="switch"
                        aria-checked={checked}
                        disabled={saving}
                        onClick={() => updatePermission(item.key, !checked)}
                        className={`relative inline-flex h-7 w-12 items-center rounded-full transition ${
                          checked ? 'bg-emerald-500' : 'bg-slate-300'
                        } ${saving ? 'opacity-70 cursor-not-allowed' : ''}`}
                      >
                        <span
                          className={`inline-block h-5 w-5 transform rounded-full bg-white transition ${
                            checked ? 'translate-x-6' : 'translate-x-1'
                          }`}
                        />
                      </button>
                    </div>
                  </label>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
