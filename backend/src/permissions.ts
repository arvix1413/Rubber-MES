export type PermissionItem = { key: string; label: string }

/** Full catalog used by login + role-permissions UI. */
export const ALL_PERMISSIONS: PermissionItem[] = [
  { key: 'customer_order.create', label: '新增客戶訂單' },
  { key: 'customer_order.delete', label: '刪除客戶訂單' },
  { key: 'quotation.approve', label: '審核報價單' },
  { key: 'bom.create', label: '新增BOM' },
  { key: 'bom.edit', label: '編輯BOM' },
  { key: 'bom.delete', label: '刪除BOM' },
  { key: 'po.create', label: '新增採購單' },
  { key: 'po.approve', label: '審核採購單' },
  { key: 'po.receive', label: '確認收貨（已送出→已收貨）' },
  { key: 'po.delete', label: '刪除採購單' },
  { key: 'production.create', label: '新增生產單' },
  { key: 'production.delete', label: '刪除生產單' },
  { key: 'delivery.create', label: '新增出貨單' },
  { key: 'delivery.approve', label: '審核出貨單' },
  { key: 'delivery.delete', label: '刪除出貨單' },
  { key: 'reconciliation.approve', label: '審核數量核對單' },
  { key: 'invoice.approve', label: '審核發票' },
  { key: 'goods_receipt.approve', label: '審核進貨單' },
  { key: 'customer.manage', label: '管理客戶' },
  { key: 'supplier.manage', label: '管理供應商' },
  { key: 'stock.adjust', label: '庫存調整' },
  { key: 'stock.approve', label: '審核庫存調整' },
  { key: 'company.manage', label: '公司設定' },
  { key: 'user.manage', label: '使用者管理' },
  { key: 'audit.view', label: '檢視操作日誌' },
]

/** Approval / review actions — reserved for manager (e.g. DANNY). */
export const APPROVE_PERMISSIONS = new Set(
  ALL_PERMISSIONS.filter((p) => p.key.endsWith('.approve')).map((p) => p.key),
)

/**
 * Admin surface still gated by manager role in routes.
 * Employees get everything else except approve.
 */
export const MANAGER_ONLY_PERMISSIONS = new Set([
  'company.manage',
  'user.manage',
  ...APPROVE_PERMISSIONS,
])

export function isApprovePermission(key: string): boolean {
  return APPROVE_PERMISSIONS.has(key) || key.endsWith('.approve')
}

/** Employee default: all operational rights, no approve / company / user admin. */
export function defaultEmployeeAllowed(key: string): boolean {
  if (MANAGER_ONLY_PERMISSIONS.has(key)) return false
  if (isApprovePermission(key)) return false
  return true
}

export function employeePermissionDefaults(): Record<string, boolean> {
  const map: Record<string, boolean> = {}
  for (const item of ALL_PERMISSIONS) {
    map[item.key] = defaultEmployeeAllowed(item.key)
  }
  return map
}
