export type Role = 'manager' | 'employee'

export function normalizeRole(role: any): Role {
  return role === 'manager' || role === 'admin' ? 'manager' : 'employee'
}

export const ROLE_LABELS: Record<string, string> = {
  manager: '主管',
  employee: '員工',
}

export const ROLE_COLORS: Record<string, string> = {
  manager: 'bg-violet-100 text-violet-700 border border-violet-200',
  employee: 'bg-blue-100 text-blue-700 border border-blue-200',
}

// Legacy hardcoded permissions (kept for backward compatibility)
// New system uses dynamic permissions from role_permissions table via usePermissions hook
export const PERMISSIONS = {
  canCreateCustomerOrder: (role: Role) => ['manager', 'employee'].includes(role),
  canDeleteCustomerOrder: (role: Role) => ['manager'].includes(role),
  canCreateBOM: (role: Role) => ['manager', 'employee'].includes(role),
  canEditBOM:   (role: Role) => ['manager', 'employee'].includes(role),
  canDeleteBOM: (role: Role) => ['manager'].includes(role),
  canCreatePO:  (role: Role) => ['manager', 'employee'].includes(role),
  canApprovePO: (role: Role) => ['manager'].includes(role),
  canDeletePO:  (role: Role) => ['manager'].includes(role),
  canCreateProduction: (role: Role) => ['manager', 'employee'].includes(role),
  canDeleteProduction: (role: Role) => ['manager'].includes(role),
  canCreateDelivery: (role: Role) => ['manager', 'employee'].includes(role),
  canDeleteDelivery: (role: Role) => ['manager'].includes(role),
  canManageCustomers:  (role: Role) => ['manager', 'employee'].includes(role),
  canManageSuppliers:  (role: Role) => ['manager', 'employee'].includes(role),
  canManageMaterials:  (role: Role) => ['manager'].includes(role),
  canViewInventory:    (role: Role) => true,
  canAdjustStock:      (role: Role) => ['manager'].includes(role),
  canManageUsers: (role: Role) => role === 'manager',
  canViewAuditLog: (role: Role) => role === 'manager',
}

export function getUser(): { id: number; email: string; name: string; role: Role; signature_url?: string } | null {
  if (typeof window === 'undefined') return null
  try {
    const u = JSON.parse(localStorage.getItem('oms_user') || 'null')
    if (!u) return null
    return { ...u, role: normalizeRole(u.role) }
  } catch { return null }
}
