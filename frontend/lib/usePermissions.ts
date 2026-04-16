'use client'
import { normalizeRole } from './permissions'

function getCurrentRole(): string | null {
  if (typeof window === 'undefined') return null
  try {
    const user = JSON.parse(localStorage.getItem('oms_user') || 'null')
    return user?.role ? normalizeRole(user.role) : null
  } catch {
    return null
  }
}

// Get permissions array from localStorage (set at login)
export function getPermissions(): string[] {
  if (typeof window === 'undefined') return []
  try {
    return JSON.parse(localStorage.getItem('oms_permissions') || '[]')
  } catch { return [] }
}

// Check if current user has a specific permission
export function can(permission: string): boolean {
  const role = getCurrentRole()
  if (role === 'manager') return true
  return getPermissions().includes(permission)
}

// Hook-style helper for use in components
export function usePermissions() {
  const perms = getPermissions()
  const role = getCurrentRole()
  return {
    can: (permission: string) => role === 'manager' ? true : perms.includes(permission),
    perms,
  }
}
