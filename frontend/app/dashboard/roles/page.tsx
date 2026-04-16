'use client'
import { useDialog } from '@/components/Dialog'
import { useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api'
import { getUser } from '@/lib/permissions'
import { can } from '@/lib/usePermissions'
import { useRouter } from 'next/navigation'

type PermDef = { key: string; label: string }
type PermMap = Record<string, Record<string, boolean>>

const EDITABLE_ROLES = ['employee']
const ROLE_LABELS: Record<string, string> = {
  manager: '主管',
  employee: '員工',
}
const ROLE_COLORS: Record<string, string> = {
  manager: 'bg-violet-100 text-violet-700',
  employee: 'bg-blue-100 text-blue-700',
}

const PERM_GROUPS = [
  {
    label: '客戶訂單',
    perms: ['customer_order.create', 'customer_order.delete'],
  },
  {
    label: 'BOM 材料明細',
    perms: ['bom.create', 'bom.edit', 'bom.delete'],
  },
  {
    label: '採購單',
    perms: ['po.create', 'po.approve', 'po.delete'],
  },
  {
    label: '生產單',
    perms: ['production.create', 'production.delete'],
  },
  {
    label: '出貨單',
    perms: ['delivery.create', 'delivery.delete'],
  },
  {
    label: '基礎資料',
    perms: ['customer.manage', 'supplier.manage'],
  },
  {
    label: '倉庫管理',
    perms: ['stock.adjust'],
  },
  {
    label: '系統管理（主管固定）',
    perms: ['company.manage', 'user.manage', 'audit.view'],
    adminOnly: true,
  },
]

export default function RolesPage() {
  const router = useRouter()
  const { toast } = useDialog()

  const [permMap, setPermMap] = useState<PermMap>({})
  const [allPerms, setAllPerms] = useState<PermDef[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)

  useEffect(() => {
    if (!can('user.manage')) { router.replace('/dashboard'); return }
    load()
  }, [router])

  const load = async () => {
    try {
      const data = await apiFetch<{ permissions: PermMap; allPermissions: PermDef[] }>('/api/role-permissions')
      setPermMap(data.permissions)
      setAllPerms(data.allPermissions)
    } catch (e: any) {
      toast('載入失敗：' + e.message, 'error')
    } finally { setLoading(false) }
  }

  const toggle = async (role: string, permission: string, current: boolean) => {
    const key = `${role}:${permission}`
    setSaving(key)
    try {
      await apiFetch('/api/role-permissions', {
        method: 'PUT',
        body: JSON.stringify({ role, permission, allowed: !current })
      })
      setPermMap(prev => ({ ...prev, [role]: { ...prev[role], [permission]: !current } }))
    } catch (e: any) {
      toast('更新失敗：' + e.message, 'error')
    } finally { setSaving(null) }
  }

  const permLabelMap = Object.fromEntries(allPerms.map(p => [p.key, p.label]))

  const CheckBox = ({ checked, isSaving, onClick, disabled }: { checked: boolean; isSaving: boolean; onClick: () => void; disabled?: boolean }) => (
    <div className="flex justify-center">
      {isSaving ? (
        <div className="w-5 h-5 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
      ) : disabled ? (
        <div className="w-5 h-5 rounded bg-green-500 flex items-center justify-center opacity-60">
          <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7"/></svg>
        </div>
      ) : (
        <button onClick={onClick}
          className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-all ${
            checked ? 'bg-blue-500 border-blue-500 hover:bg-blue-600' : 'bg-white border-slate-300 hover:border-blue-400'
          }`}>
          {checked && <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7"/></svg>}
        </button>
      )}
    </div>
  )

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-slate-800">角色權限管理</h1>
        <p className="text-xs text-slate-400 mt-0.5">主管固定為全部權限；此頁僅需設定員工權限</p>
      </div>

      {/* Role cards */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        {['manager', 'employee'].map(role => (
          <div key={role} className={`oms-card p-4 border-l-4 ${role === 'manager' ? 'border-violet-400' : 'border-blue-400'}`}>
            <div className="flex items-center gap-2 mb-2">
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${ROLE_COLORS[role]}`}>{ROLE_LABELS[role]}</span>
              {role === 'manager' && <span className="text-[10px] text-slate-400">固定全權限</span>}
            </div>
            <div className="text-xs text-slate-400">
              {role === 'manager' && '主管預設擁有全部權限，無需額外賦權'}
              {role === 'employee' && '可設定：基本新增/檢視操作'}
            </div>
          </div>
        ))}
      </div>

      {/* Permissions table */}
      {loading ? (
        <div className="flex justify-center py-16"><div className="w-5 h-5 border-2 border-blue-200 border-t-blue-600 rounded-full animate-spin" /></div>
      ) : (
        <div className="oms-card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200">
                <th className="px-5 py-4 text-left font-semibold text-slate-600 w-52">功能權限</th>
                {['manager', 'employee'].map(role => (
                  <th key={role} className="px-4 py-4 text-center min-w-[120px]">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${ROLE_COLORS[role]}`}>
                      {ROLE_LABELS[role]}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {PERM_GROUPS.map(group => (
                <>
                  <tr key={group.label} className="bg-slate-50 border-y border-slate-200">
                    <td colSpan={3} className="px-5 py-2 text-xs font-bold text-slate-400 uppercase tracking-wider">
                      {group.label}
                    </td>
                  </tr>
                  {group.perms.map(permKey => {
                    const label = permLabelMap[permKey] || permKey
                    return (
                      <tr key={permKey} className="border-b border-slate-100 hover:bg-slate-50">
                        <td className="px-5 py-3 text-slate-600 text-sm">{label}</td>
                        {/* Manager: always checked, not editable */}
                        <td className="px-4 py-3">
                          <CheckBox checked={true} isSaving={false} onClick={() => {}} disabled={true} />
                        </td>
                        {/* Employee: editable */}
                        {EDITABLE_ROLES.map(role => {
                          if ((group as any).adminOnly) {
                            return (
                              <td key={role} className="px-4 py-3">
                                  <div className="flex justify-center">
                                  <div className="w-5 h-5 rounded border-2 border-slate-200 bg-slate-50" title="系統管理權限由主管固定擁有" />
                                </div>
                              </td>
                            )
                          }
                          const allowed = permMap[role]?.[permKey] ?? false
                          const isSaving = saving === `${role}:${permKey}`
                          return (
                            <td key={role} className="px-4 py-3">
                              <CheckBox checked={allowed} isSaving={isSaving} onClick={() => toggle(role, permKey, allowed)} />
                            </td>
                          )
                        })}
                      </tr>
                    )
                  })}
                </>
              ))}
            </tbody>
          </table>
          <div className="px-5 py-3 border-t border-slate-100 text-xs text-slate-400 flex items-center gap-4">
            <div className="flex items-center gap-1.5"><div className="w-4 h-4 rounded bg-blue-500" /><span>已授權</span></div>
            <div className="flex items-center gap-1.5"><div className="w-4 h-4 rounded border-2 border-slate-300" /><span>未授權</span></div>
            <span className="ml-auto">員工權限可即時切換，主管固定全權限</span>
          </div>
        </div>
      )}
    </div>
  )
}
