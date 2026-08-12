'use client'
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { apiFetch, clearToken, getToken } from '@/lib/api'
import { getUser, type Role } from '@/lib/permissions'
import { useReviewBadge } from '@/lib/useReviewBadge'
import { clearSessionActivity, useIdleTimeout } from '@/lib/useIdleTimeout'
import StickyTableHeaderBridge from '@/components/StickyTableHeaderBridge'
import { getCompany, getCompanyDisplayName, getCompanyInitial, type CompanySettings } from '@/lib/useCompany'

type NavItem = { href: string; label: string; icon: React.ReactNode; exact?: boolean }
type NavGroup = { label: string; icon: React.ReactNode; children: NavItem[]; defaultOpen?: boolean }
type NavEntry = NavItem | NavGroup

const isGroup = (n: NavEntry): n is NavGroup => 'children' in n

const NAV: NavEntry[] = [
  { href: '/dashboard', label: '流程總覽', icon: <IconGrid />, exact: true },
  {
    label: '流程執行',
    icon: <IconFlow />,
    defaultOpen: true,
    children: [
      { href: '/dashboard/customer-orders', label: '客戶訂單', icon: <IconDoc /> },
      { href: '/dashboard/order-intake', label: '交期進度', icon: <IconList /> },
      { href: '/dashboard/po', label: '採購下單', icon: <IconCart /> },
      { href: '/dashboard/delivery-notes', label: '出貨單', icon: <IconTruck /> },
      { href: '/dashboard/quotations', label: '報價單', icon: <IconDoc /> },
      { href: '/dashboard/shipment-reconciliation', label: '數量核對', icon: <IconCheck /> },
      { href: '/dashboard/invoices', label: '發票管理', icon: <IconInvoice /> },
      { href: '/dashboard/payables', label: '供應商付款', icon: <IconPay /> },
    ],
  },
  {
    label: '基礎主檔',
    icon: <IconBox />,
    children: [
      { href: '/dashboard/materials', label: '材料管理', icon: <IconLayers /> },
      { href: '/dashboard/bom', label: '產品規格/BOM', icon: <IconLayers /> },
      { href: '/dashboard/customers', label: '客戶資料', icon: <IconUsers /> },
      { href: '/dashboard/suppliers', label: '供應商資料', icon: <IconBuilding /> },
    ],
  },
  {
    label: '系統管理',
    icon: <IconSetting />,
    children: [
      { href: '/dashboard/company', label: '公司設定', icon: <IconBuilding /> },
      { href: '/dashboard/role-permissions', label: '權限設定', icon: <IconCheck /> },
      { href: '/dashboard/users', label: '使用者管理', icon: <IconUserCog /> },
      { href: '/dashboard/audit-logs', label: '操作日誌', icon: <IconList /> },
    ],
  },
]

const BASE_DASHBOARD_ROUTES = new Set<string>([
  '/dashboard',
  '/dashboard/order-intake',
  '/dashboard/customer-orders',
  '/dashboard/po',
  '/dashboard/delivery-notes',
  '/dashboard/quotations',
  '/dashboard/shipment-reconciliation',
  '/dashboard/invoices',
  '/dashboard/payables',
  '/dashboard/materials',
  '/dashboard/bom',
  '/dashboard/customers',
  '/dashboard/suppliers',
  '/dashboard/profile',
])

const MANAGER_ONLY_ROUTES = new Set<string>([
  '/dashboard/company',
  '/dashboard/role-permissions',
  '/dashboard/users',
  '/dashboard/audit-logs',
])

function IconGrid() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4"><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></svg> }
function IconFlow() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4"><circle cx="5" cy="6" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="18" r="2" /><path d="M7 7.2l3.5 3.4M13.5 13.4l3.6 3.4" /></svg> }
function IconList() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4"><line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" /><line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" /></svg> }
function IconDoc() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg> }
function IconCart() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4"><circle cx="9" cy="21" r="1" /><circle cx="20" cy="21" r="1" /><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" /></svg> }
function IconTruck() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4"><rect x="1" y="3" width="15" height="13" rx="1" /><path d="M16 8h4l3 3v5h-7V8z" /><circle cx="5.5" cy="18.5" r="2.5" /><circle cx="18.5" cy="18.5" r="2.5" /></svg> }
function IconCheck() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4"><circle cx="12" cy="12" r="9" /><path d="M8 12l2.6 2.6L16 9.5" /></svg> }
function IconInvoice() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4"><path d="M7 3h10a2 2 0 0 1 2 2v14l-2-1-2 1-2-1-2 1-2-1-2 1V5a2 2 0 0 1 2-2z" /><line x1="9" y1="8" x2="15" y2="8" /><line x1="9" y1="12" x2="15" y2="12" /></svg> }
function IconPay() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4"><path d="M12 2v20" /><path d="M7 8c0-2 1.8-3 5-3s5 1 5 3-1.5 2.8-5 3-5 1.2-5 3 1.8 3 5 3 5-1 5-3" /></svg> }
function IconBox() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" /></svg> }
function IconLayers() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4"><polygon points="12 2 22 7 12 12 2 7 12 2" /><polyline points="2 17 12 22 22 17" /><polyline points="2 12 12 17 22 12" /></svg> }
function IconUsers() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /></svg> }
function IconBuilding() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4"><rect x="3" y="7" width="18" height="14" rx="1" /><path d="M8 21V3h8v18" /></svg> }
function IconUserCog() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg> }
function IconSetting() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.65 1.65 0 0 0 15 19.4a1.65 1.65 0 0 0-1 .6 1.65 1.65 0 0 0-.33 1v.17a2 2 0 1 1-4 0V21a1.65 1.65 0 0 0-.33-1 1.65 1.65 0 0 0-1-.6 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-.6-1 1.65 1.65 0 0 0-1-.33H2.83a2 2 0 1 1 0-4H3a1.65 1.65 0 0 0 1-.33 1.65 1.65 0 0 0 .6-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-.6 1.65 1.65 0 0 0 .33-1V2.83a2 2 0 1 1 4 0V3a1.65 1.65 0 0 0 .33 1 1.65 1.65 0 0 0 1 .6 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9c.26.3.45.65.6 1 .1.3.13.66.13 1v.17a2 2 0 1 1 0 4H20a1.65 1.65 0 0 0-.6.13z"/></svg> }
function IconChevron({ open }: { open: boolean }) { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={`h-3 w-3 transition-transform duration-200 ${open ? 'rotate-90' : ''}`}><polyline points="9 18 15 12 9 6" /></svg> }
function IconLogout() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></svg> }
function IconMenu() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4"><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" /></svg> }
function IconClose() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg> }

const ROLE_DOT: Record<string, string> = {
  manager: 'bg-emerald-400',
  employee: 'bg-amber-400',
}

const isAllowedDashboardRoute = (pathname: string, role?: Role) => {
  if (!pathname.startsWith('/dashboard')) return true
  if (BASE_DASHBOARD_ROUTES.has(pathname)) return true
  if (role === 'manager' && MANAGER_ONLY_ROUTES.has(pathname)) return true
  return false
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const [user, setUser] = useState<any>(null)
  const [company, setCompany] = useState<CompanySettings | null>(null)
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set(['流程執行']))
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const { canApprovePo, canReviewQuotation, poDraftCount, quotationDraftCount } = useReviewBadge()

  useIdleTimeout(() => {
    clearToken()
    clearSessionActivity()
    localStorage.removeItem('rubber_user')
    localStorage.removeItem('rubber_permissions')
    window.location.replace('/login?reason=idle')
  })

  useEffect(() => {
    if (!getToken()) {
      router.replace('/login')
      return
    }
    setUser(getUser())
    // Load company settings for sidebar display
    getCompany().then(setCompany).catch(() => {})
  }, [router])

  useEffect(() => {
    const name = getCompanyDisplayName(company)
    document.title = name ? `${name} — ERP` : 'ERP'
  }, [company])

  useEffect(() => {
    const syncUser = () => setUser(getUser())
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'rubber_user') syncUser()
    }
    window.addEventListener('rubber:user-updated', syncUser as EventListener)
    window.addEventListener('storage', onStorage)
    return () => {
      window.removeEventListener('rubber:user-updated', syncUser as EventListener)
      window.removeEventListener('storage', onStorage)
    }
  }, [])

  useEffect(() => {
    if (!user) return
    if (!isAllowedDashboardRoute(pathname, user.role)) {
      router.replace('/dashboard')
      return
    }
    NAV.forEach((n) => {
      if (isGroup(n)) {
        const hasActive = n.children.some((c) => pathname === c.href || pathname.startsWith(c.href + '/'))
        if (hasActive) setOpenGroups((prev) => new Set([...Array.from(prev), n.label]))
      }
    })
    setSidebarOpen(false)
  }, [pathname, router, user])

  const logout = async () => {
    try {
      await apiFetch('/api/auth/logout', { method: 'POST', reloadOnSuccess: 'never' })
    } catch {
      // Local logout must still succeed if the network is unavailable.
    }
    clearToken()
    clearSessionActivity()
    localStorage.removeItem('rubber_user')
    localStorage.removeItem('rubber_permissions')
    window.location.href = '/login'
  }

  const role = user?.role as Role

  const isActive = (href: string, exact?: boolean) => (exact ? pathname === href : pathname === href || pathname.startsWith(href + '/'))

  const toggleGroup = (label: string) => {
    setOpenGroups((prev) => {
      const arr = Array.from(prev)
      return arr.includes(label) ? new Set(arr.filter((x) => x !== label)) : new Set([...arr, label])
    })
  }

  const linkClass = (active: boolean) =>
    `flex items-center gap-2.5 rounded-xl px-3 py-2 text-[13px] font-medium transition-all ${
      active
        ? 'border border-[#736146] bg-[#f1d9b8] text-[#2f271d] shadow-[0_6px_14px_rgba(86,62,28,0.2)]'
        : 'text-[#dacbb8] hover:bg-white/8 hover:text-[#fff6ea]'
    }`

  const currentPageLabel = useMemo(() => {
    const allItems: NavItem[] = []
    NAV.forEach((n) => {
      if (isGroup(n)) allItems.push(...n.children)
      else allItems.push(n)
    })
    const hit = allItems.find((i) => isActive(i.href, i.exact))
    return hit?.label || '流程總覽'
  }, [pathname])

  const renderNavBadge = (href: string) => {
    if (href === '/dashboard/po' && canApprovePo && poDraftCount > 0) {
      return (
        <span className="ml-auto inline-flex min-w-[26px] items-center justify-center rounded-full bg-[#d93d2f] px-2 py-0.5 text-[11px] font-extrabold text-white shadow-[0_8px_18px_rgba(217,61,47,0.35)] ring-2 ring-[#ffd9cf]">
          {poDraftCount > 99 ? '99+' : poDraftCount}
        </span>
      )
    }
    if (href === '/dashboard/quotations' && canReviewQuotation && quotationDraftCount > 0) {
      return (
        <span className="ml-auto inline-flex min-w-[26px] items-center justify-center rounded-full bg-[#c46b1f] px-2 py-0.5 text-[11px] font-extrabold text-white shadow-[0_8px_18px_rgba(196,107,31,0.35)] ring-2 ring-[#ffe2bf]">
          {quotationDraftCount > 99 ? '99+' : quotationDraftCount}
        </span>
      )
    }
    return null
  }

  const renderTopReviewBadges = () => {
    const badges = [
      canApprovePo && poDraftCount > 0
        ? { href: '/dashboard/po?status=pending_review', label: '採購單待審核', count: poDraftCount, tone: 'bg-[#d93d2f] text-white ring-[#ffd9cf]' }
        : null,
      canReviewQuotation && quotationDraftCount > 0
        ? { href: '/dashboard/quotations?status=pending_review', label: '報價單待審核', count: quotationDraftCount, tone: 'bg-[#c46b1f] text-white ring-[#ffe2bf]' }
        : null,
    ].filter(Boolean) as Array<{ href: string; label: string; count: number; tone: string }>
    if (!badges.length) return null
    return (
      <div className="flex flex-wrap items-center gap-2">
        {badges.map((badge) => (
          <Link
            key={badge.href}
            href={badge.href}
            className={`inline-flex items-center gap-2.5 rounded-full px-4 py-2 text-[16px] font-black shadow-[0_10px_20px_rgba(41,30,20,0.12)] ring-2 ${badge.tone}`}
          >
            <span>{badge.label}</span>
            <span className="rounded-full bg-white/18 px-2.5 py-1 text-[14px] font-black leading-none">
              {badge.count > 99 ? '99+' : badge.count}
            </span>
          </Link>
        ))}
      </div>
    )
  }

  return (
    <div className="relative flex h-screen bg-[#f2ede4] text-[#2a241d]">
      {sidebarOpen && <button aria-label="close sidebar backdrop" onClick={() => setSidebarOpen(false)} className="fixed inset-0 z-30 bg-black/30 md:hidden" />}

      <aside className={`fixed inset-y-0 left-0 z-40 w-[292px] flex-col border-r border-[#2a2217] bg-[linear-gradient(180deg,#362a1f_0%,#221a14_100%)] transition-transform duration-200 md:relative md:z-0 md:translate-x-0 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'} md:flex`}>
        <div className="border-b border-white/10 px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="brand-font flex h-9 w-9 items-center justify-center rounded-xl bg-[linear-gradient(135deg,#d9853f_0%,#b55a1b_100%)] text-sm font-black text-[#fff6ed] shadow-[0_10px_20px_rgba(0,0,0,0.2)]">
              {getCompanyInitial(company) || '·'}
            </div>
            <div>
              <div className="brand-font text-sm font-bold tracking-wide text-[#fff3e3]">
                {getCompanyDisplayName(company) || '載入中...'}
              </div>
              <div className="text-[10px] uppercase tracking-[0.16em] text-[#b89f85]">Flow-Driven Workspace</div>
            </div>
          </div>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-3">
          {NAV.map((n) => {
            if (isGroup(n)) {
              if (n.label === '系統管理' && role !== 'manager') return null
              const open = openGroups.has(n.label)
              const hasActive = n.children.some((c) => isActive(c.href))
              return (
                <div key={n.label}>
                  <button
                    onClick={() => toggleGroup(n.label)}
                    className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-[13px] font-medium transition-all ${hasActive ? 'bg-white/10 text-[#ffeedb]' : 'text-[#d2c0ab] hover:bg-white/5 hover:text-[#fff0df]'}`}
                  >
                    <span className={hasActive ? 'text-[#ffc385]' : 'text-[#a88f78]'}>{n.icon}</span>
                    <span className="flex-1 text-left">{n.label}</span>
                    <span className={hasActive ? 'text-[#ffc385]' : 'text-[#a88f78]'}><IconChevron open={open} /></span>
                  </button>
                  {open && (
                    <div className="ml-3 mt-1 space-y-0.5 border-l border-white/10 pl-3">
                      {n.children.map((c) => (
                        <Link key={c.href} href={c.href} className={linkClass(isActive(c.href))}>
                          <span className={isActive(c.href) ? 'text-[#734613]' : 'text-[#a88f78]'}>{c.icon}</span>
                          <span>{c.label}</span>
                          {renderNavBadge(c.href)}
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              )
            }
            const item = n as NavItem
            return (
              <Link key={item.href} href={item.href} className={linkClass(isActive(item.href, item.exact))}>
                <span className={isActive(item.href, item.exact) ? 'text-[#734613]' : 'text-[#a88f78]'}>{item.icon}</span>
                {item.label}
              </Link>
            )
          })}
        </nav>

        <div className="border-t border-white/10 bg-black/15 px-3 py-3">
          <Link href="/dashboard/profile" className="group mb-1 flex items-center gap-2.5 rounded-lg p-2 transition-colors hover:bg-white/7">
            <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-[#4b3727] text-xs font-bold text-[#ffd8ad]">
              {user?.name?.charAt(0) || 'U'}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-semibold text-[#f2deca] transition-colors group-hover:text-white">{user?.name}</div>
              <div className="truncate text-[10px] text-[#bda48a]">{user?.email}</div>
            </div>
            {role && <span className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${ROLE_DOT[role] || 'bg-slate-400'}`} />}
          </Link>
          <button onClick={logout} className="flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-[12px] text-[#ccb59f] transition-colors hover:bg-white/7 hover:text-[#ffe4c2]">
            <IconLogout />
            登出系統
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-auto bg-transparent">
        <div className="sticky top-0 z-20 hidden border-b border-[#ccbca8] bg-[#f7f0e6]/95 px-6 py-3 backdrop-blur md:block">
          <div className="flex items-center justify-between gap-4">
            <div className="brand-font text-[12px] font-semibold tracking-[0.12em] text-[#4d3c2c]">{currentPageLabel}</div>
            {renderTopReviewBadges()}
          </div>
        </div>
        <div className="sticky top-0 z-20 border-b border-[#ccbca8] bg-[#f7f0e6]/95 px-4 py-2.5 backdrop-blur md:hidden">
          <div className="flex items-center justify-between">
            <button onClick={() => setSidebarOpen((v) => !v)} className="btn-ghost px-2.5 py-1.5">
              {sidebarOpen ? <IconClose /> : <IconMenu />}
              {sidebarOpen ? '關閉' : '選單'}
            </button>
            <div className="brand-font text-[11px] font-semibold tracking-[0.12em] text-[#4d3c2c]">{currentPageLabel}</div>
            <div className="max-w-[46vw]">{renderTopReviewBadges()}</div>
          </div>
        </div>
        <StickyTableHeaderBridge />
        <div className="dashboard-content p-5 md:p-6 xl:p-7">{children}</div>
      </main>
    </div>
  )
}
