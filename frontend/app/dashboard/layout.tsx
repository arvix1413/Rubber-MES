'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { getToken, clearToken } from '@/lib/api'
import { getUser, ROLE_LABELS, type Role } from '@/lib/permissions'
import { can } from '@/lib/usePermissions'

type NavItem = { href: string; label: string; icon: React.ReactNode }
type NavGroup = { label: string; icon: React.ReactNode; children: NavItem[] }
type NavEntry = NavItem | NavGroup

const isGroup = (n: NavEntry): n is NavGroup => 'children' in n

const NAV: NavEntry[] = [
  { href: '/dashboard', label: '總覽', icon: <IconGrid />, exact: true } as any,
  {
    label: '業務流程', icon: <IconClipboard />,
    children: [
      { href: '/dashboard/customer-orders', label: '客戶訂單', icon: <IconDoc /> },
      { href: '/dashboard/order-intake', label: '訂單收集池', icon: <IconList /> },
      { href: '/dashboard/quotations', label: '報價單', icon: <IconQuote /> },
      { href: '/dashboard/bom', label: '材料明細', icon: <IconList /> },
      { href: '/dashboard/po', label: '採購單', icon: <IconCart /> },
      { href: '/dashboard/production', label: '生產單', icon: <IconFactory /> },
      { href: '/dashboard/delivery-notes', label: '出貨單', icon: <IconTruck /> },
      { href: '/dashboard/shipment-reconciliation', label: '出貨核對', icon: <IconReceive /> },
      { href: '/dashboard/invoices', label: '發票管理', icon: <IconDoc /> },
      { href: '/dashboard/delivery-sheets', label: '送貨單', icon: <IconTruck /> },
    ],
    defaultOpen: true
  },
  {
    label: '基礎資料', icon: <IconBox />,
    children: [
      { href: '/dashboard/customers', label: '客戶管理', icon: <IconUsers /> },
      { href: '/dashboard/suppliers', label: '供應商管理', icon: <IconBuilding2 /> },
      // 料號管理暫時隱藏
      // { href: '/dashboard/materials', label: '料號管理', icon: <IconBox /> },
    ]
  },
  {
    label: '倉庫管理', icon: <IconWarehouse />,
    children: [
      { href: '/dashboard/inventory', label: '庫存查詢', icon: <IconWarehouse /> },
      { href: '/dashboard/stock-ledger', label: '庫存流水', icon: <IconList /> },
      { href: '/dashboard/stock-adjustments', label: '庫存調整', icon: <IconAdjust /> },
    ]
  },
]
const NAV_ADMIN: NavEntry[] = [
  {
    label: '使用者帳號與權限管理', icon: <IconUserCog />,
    children: [
      { href: '/dashboard/company', label: '公司設定', icon: <IconBuilding /> },
      { href: '/dashboard/roles', label: '角色管理', icon: <IconShield /> },
      { href: '/dashboard/users', label: '使用者管理', icon: <IconUserCog /> },
    ]
  },
  { href: '/dashboard/audit-logs', label: '操作日誌', icon: <IconAudit /> },
]

function IconGrid() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-4 h-4"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg> }
function IconBox() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-4 h-4"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg> }
function IconList() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-4 h-4"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg> }
function IconBuilding() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-4 h-4"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg> }
function IconUsers() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-4 h-4"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg> }
function IconClipboard() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-4 h-4"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/></svg> }
function IconCart() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-4 h-4"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg> }
function IconDoc() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-4 h-4"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg> }
function IconQuote() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-4 h-4"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg> }
function IconTruck() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-4 h-4"><rect x="1" y="3" width="15" height="13" rx="1"/><path d="M16 8h4l3 3v5h-7V8z"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg> }
function IconWarehouse() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-4 h-4"><path d="M22 8.35V20a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8.35A2 2 0 0 1 3.26 6.5l8-3.2a2 2 0 0 1 1.48 0l8 3.2A2 2 0 0 1 22 8.35z"/><path d="M6 18h12"/><path d="M6 14h12"/><rect x="8" y="10" width="8" height="8"/></svg> }
function IconUserCog() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-4 h-4"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg> }
function IconShield() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-4 h-4"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg> }
function IconAudit() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-4 h-4"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="12" y2="17"/></svg> }
function IconReceive() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-4 h-4"><path d="M12 2v20M17 7l-5 5-5-5"/><path d="M3 12h18"/></svg> }
function IconPay() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-4 h-4"><path d="M12 22V2M7 17l5-5 5 5"/><path d="M3 12h18"/></svg> }
function IconChart() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-4 h-4"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/><line x1="2" y1="20" x2="22" y2="20"/></svg> }
function IconBuilding2() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-4 h-4"><rect x="2" y="7" width="20" height="14" rx="1"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg> }
function IconFactory() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-4 h-4"><path d="M2 20V8l6-4v4l6-4v4l6-4v16H2z"/><path d="M6 20v-4h4v4"/></svg> }
function IconAdjust() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-4 h-4"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg> }
function IconChevron({ open }: { open: boolean }) { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={`w-3 h-3 transition-transform duration-200 ${open ? 'rotate-90' : ''}`}><polyline points="9 18 15 12 9 6"/></svg> }
function IconLogout() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-4 h-4"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg> }
function IconMenu() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg> }
function IconClose() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg> }
const ROLE_DOT: Record<string, string> = {
  manager: 'bg-orange-500',
  employee: 'bg-emerald-500',
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const [user, setUser] = useState<any>(null)
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set(['業務流程']))
  const [sidebarOpen, setSidebarOpen] = useState(false)

  useEffect(() => {
    if (!getToken()) { router.replace('/login'); return }
    setUser(getUser())
  }, [router])

  // Auto-open group if current path matches a child
  useEffect(() => {
    const allNavs = [...NAV, ...NAV_ADMIN]
    allNavs.forEach(n => {
      if (isGroup(n)) {
        const hasActive = n.children.some(c => pathname === c.href || pathname.startsWith(c.href + '/'))
        if (hasActive) setOpenGroups(prev => new Set([...Array.from(prev), n.label]))
      }
    })
    setSidebarOpen(false)
  }, [pathname])

  const logout = () => {
    clearToken()
    localStorage.removeItem('oms_user')
    localStorage.removeItem('oms_permissions')
    window.location.href = '/login'
  }
  const role = user?.role as Role
  const isAdmin = can('user.manage')

  const isActive = (href: string, exact?: boolean) =>
    exact ? pathname === href : pathname === href || pathname.startsWith(href + '/')

  const toggleGroup = (label: string) => {
    setOpenGroups(prev => {
      const arr = Array.from(prev)
      const next = arr.includes(label) ? arr.filter(x => x !== label) : [...arr, label]
      return new Set(next)
    })
  }

  const linkClass = (active: boolean) =>
    `flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] font-medium transition-all duration-150 ${
      active ? 'bg-[#f6e4d8] text-[#8b3510] border border-[#e5b79f] shadow-sm' : 'text-[#d8c2a9] hover:text-white hover:bg-white/10'
    }`

  return (
    <div className="relative flex h-screen bg-[#f6f6f0] text-[#2b241a]">
      {sidebarOpen && (
        <button
          aria-label="close sidebar backdrop"
          onClick={() => setSidebarOpen(false)}
          className="fixed inset-0 z-30 bg-black/25 md:hidden"
        />
      )}
      {/* Sidebar */}
      <aside className={`fixed inset-y-0 left-0 z-40 w-[266px] flex-col border-r border-[#2d2316] bg-[#1b1510] transition-transform duration-200 md:relative md:z-0 md:translate-x-0 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'} md:flex`}>
        {/* Logo */}
        <div className="px-5 py-4 border-b border-white/10">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#c4591f] to-[#8e320c] flex items-center justify-center text-sm font-black text-white shadow-sm brand-font">R</div>
            <div>
              <div className="text-sm font-bold text-[#f7e5cd] leading-tight brand-font tracking-wide">RUBBER MES</div>
              <div className="text-[10px] text-[#ac9378] leading-none">PRODUCTION SYSTEM</div>
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-3 space-y-1 overflow-y-auto bg-gradient-to-b from-[#1b1510] to-[#241a11]">
          {NAV.map(n => {
            if (isGroup(n)) {
              const open = openGroups.has(n.label)
              const hasActive = n.children.some(c => isActive(c.href))
              return (
                <div key={n.label}>
                  <button
                    onClick={() => toggleGroup(n.label)}
                    className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] font-medium transition-all duration-150 ${
                      hasActive ? 'text-[#ffd2b8] bg-white/10' : 'text-[#c9b096] hover:text-white hover:bg-white/10'
                    }`}>
                    <span className={hasActive ? 'text-[#f4a174]' : 'text-[#9a836b]'}>{n.icon}</span>
                    <span className="flex-1 text-left">{n.label}</span>
                    <span className={hasActive ? 'text-[#e8a882]' : 'text-[#8e7760]'}><IconChevron open={open} /></span>
                  </button>
                  {open && (
                    <div className="ml-3 pl-3 border-l border-white/15 mt-1 space-y-0.5">
                      {n.children.map(c => (
                        <Link key={c.href} href={c.href} className={linkClass(isActive(c.href))}>
                          <span className={isActive(c.href) ? 'text-[#c24d16]' : 'text-[#9f8c79]'}>{c.icon}</span>
                          {c.label}
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              )
            }
            const item = n as any
            return (
            <Link key={item.href} href={item.href} className={linkClass(isActive(item.href, item.exact))}>
                <span className={isActive(item.href, item.exact) ? 'text-[#c24d16]' : 'text-[#9f8c79]'}>{item.icon}</span>
                {item.label}
              </Link>
            )
          })}

          {isAdmin && (
            <>
              <div className="pt-3 pb-1 px-3">
                <span className="text-[10px] font-semibold text-[#8f7a64] uppercase tracking-widest">系統管理</span>
              </div>
              {NAV_ADMIN.map(n => {
                if (isGroup(n)) {
                  const open = openGroups.has(n.label)
                  const hasActive = n.children.some(c => isActive(c.href))
                  return (
                    <div key={n.label}>
                      <button onClick={() => toggleGroup(n.label)}
                        className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] font-medium transition-all duration-150 ${hasActive ? 'text-[#ffd2b8] bg-white/10' : 'text-[#c9b096] hover:text-white hover:bg-white/10'}`}>
                        <span className={hasActive ? 'text-[#f4a174]' : 'text-[#9a836b]'}>{n.icon}</span>
                        <span className="flex-1 text-left">{n.label}</span>
                        <span className={hasActive ? 'text-[#e8a882]' : 'text-[#8e7760]'}><IconChevron open={open} /></span>
                      </button>
                      {open && (
                        <div className="ml-3 pl-3 border-l border-white/15 mt-1 space-y-0.5">
                          {n.children.map(c => (
                            <Link key={c.href} href={c.href} className={linkClass(isActive(c.href))}>
                              <span className={isActive(c.href) ? 'text-[#c24d16]' : 'text-[#9f8c79]'}>{c.icon}</span>
                              {c.label}
                            </Link>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                }
                const item = n as NavItem
                return (
                <Link key={item.href} href={item.href} className={linkClass(isActive(item.href))}>
                    <span className={isActive(item.href) ? 'text-[#c24d16]' : 'text-[#9f8c79]'}>{item.icon}</span>
                    {item.label}
                  </Link>
                )
              })}

              <div className="mx-3 my-2 border-t border-white/10" />
              <Link href="/dashboard/profit-tracking" className={linkClass(isActive('/dashboard/profit-tracking'))}>
                <span className={isActive('/dashboard/profit-tracking') ? 'text-[#c24d16]' : 'text-[#9f8c79]'}><IconChart /></span>
                利潤追蹤
              </Link>
            </>
          )}
        </nav>

        {/* User */}
        <div className="px-3 py-3 border-t border-white/10 bg-[#22180f]">
          <Link href="/dashboard/profile" className="flex items-center gap-2.5 p-2 rounded-lg hover:bg-white/10 transition-colors group mb-1">
            <div className="w-8 h-8 rounded-full bg-[#f2ddc9] flex items-center justify-center text-xs font-bold text-[#8a3710] flex-shrink-0">
              {user?.name?.charAt(0) || 'U'}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-semibold text-[#f6e3ce] truncate group-hover:text-white transition-colors">{user?.name}</div>
              <div className="text-[10px] text-[#ad9378] truncate">{user?.email}</div>
            </div>
            {role && <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${ROLE_DOT[role] || 'bg-slate-400'}`} />}
          </Link>
          <button onClick={logout}
            className="w-full flex items-center gap-1.5 px-2 py-1.5 text-[12px] text-[#b4987d] hover:text-[#ffcfb0] hover:bg-white/10 rounded-lg transition-colors">
            <IconLogout />登出系統
          </button>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-auto bg-transparent">
        <div className="sticky top-0 z-20 flex items-center justify-between border-b border-[#d9ccb4] bg-[#fff9ec]/95 backdrop-blur px-4 py-2.5 md:hidden">
          <button onClick={() => setSidebarOpen(v => !v)} className="btn-ghost px-2.5 py-1.5">
            {sidebarOpen ? <IconClose /> : <IconMenu />}
            {sidebarOpen ? '關閉選單' : '選單'}
          </button>
          <div className="text-[11px] font-semibold tracking-wide text-[#6f604f] brand-font">RUBBER MES</div>
        </div>
        <div className="p-5 md:p-6 xl:p-7">{children}</div>
      </main>
    </div>
  )
}
