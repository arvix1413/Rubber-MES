export const API =
  process.env.NEXT_PUBLIC_API_URL ||
  (typeof window !== 'undefined' ? window.location.origin : 'https://rubber-backend.arvix1413.workers.dev')
type ReloadMode = 'auto' | 'always' | 'never'
type RubberRequestInit = RequestInit & { reloadOnSuccess?: ReloadMode }
type MutationPhase = 'start' | 'end'

export function getToken() {
  if (typeof window === 'undefined') return null
  return localStorage.getItem('rubber_token')
}

export function setToken(t: string) { localStorage.setItem('rubber_token', t) }
export function clearToken() { localStorage.removeItem('rubber_token') }

function redirectToLoginOnUnauthorized() {
  if (typeof window === 'undefined') return
  clearToken()
  localStorage.removeItem('rubber_user')
  localStorage.removeItem('rubber_permissions')
  if (window.location.pathname !== '/login') {
    window.location.replace('/login')
  }
}

const NETWORK_BUSY_MSG = '目前連線較忙碌，請稍後再試一次'

const isInfraError = (msg: string): boolean => {
  const lower = msg.toLowerCase()
  return (
    lower.includes('sql') ||
    lower.includes('mysql') ||
    lower.includes('database') ||
    lower.includes('syntax') ||
    lower.includes('econn') ||
    lower.includes('timeout') ||
    lower.includes('deadlock') ||
    lower.includes('internal server error')
  )
}

const softenBusinessMessage = (msg: string): string => {
  const remainingMatch = msg.match(/BOM\s+(\S+)\s+剩餘可建立數量不足，最多\s*(\d+(?:\.\d+)?)/)
  if (remainingMatch) {
    const [, bom, max] = remainingMatch
    if (Number(max) <= 0) {
      return `BOM ${bom} 可建立數量已用完，請關閉視窗後重新選擇明細`
    }
    return `BOM ${bom} 本次最多可建立 ${max}，請調整數量後再試`
  }
  if (msg.includes('部分客戶訂單不存在')) return '部分關聯訂單已變更，請重新整理頁面後再試'
  if (msg.includes('BOM 明細資料無效')) return '部分 BOM 明細已變更，請重新整理頁面後再選擇'
  if (msg.includes('已採購完成')) return '此交期進度已完成採購，無需重複建立'
  if (msg.includes('採購單號') && msg.includes('已存在')) return '採購單號重複，請更換編號後再試'
  return msg
}

function mapApiErrorMessage(raw: string, status: number): string {
  const msg = String(raw || '').trim()
  const lower = msg.toLowerCase()

  if (!msg) {
    if (status === 401) return '登入狀態已過期，請重新登入'
    if (status === 403) return '目前帳號沒有此操作權限'
    return NETWORK_BUSY_MSG
  }

  if (status === 401) return '登入狀態已過期，請重新登入'
  if (status === 403) return '目前帳號沒有此操作權限'

  if (msg.includes('無法刪除：此資料目前仍被其他業務單據或主檔引用。')) {
    return msg
  }

  if (msg.includes('已經被使用了：')) {
    const usage = msg.replace('已經被使用了：', '').trim()
    return `此資料仍被其他單據使用中（${usage}），請先解除關聯或改用封存後再操作`
  }

  if (
    lower.includes('duplicate entry') ||
    lower.includes('er_dup_entry') ||
    (lower.includes('unique') && lower.includes('constraint'))
  ) {
    return '此編號或關鍵欄位已存在，請更換後再試'
  }

  if (
    lower.includes('foreign key') ||
    lower.includes('cannot delete or update a parent row') ||
    lower.includes('a foreign key constraint fails')
  ) {
    return '此資料已被其他單據引用，暫時無法修改或刪除'
  }

  if (isInfraError(msg) || (status >= 500 && !/[\u4e00-\u9fff]/.test(msg))) {
    return NETWORK_BUSY_MSG
  }

  return softenBusinessMessage(msg)
}

/** Get the current user's full signature URL (handles relative paths) */
export function getSignatureUrl(): string | null {
  if (typeof window === 'undefined') return null
  try {
    const user = JSON.parse(localStorage.getItem('rubber_user') || 'null')
    if (!user?.signature_url) return null
    return user.signature_url.startsWith('http') ? user.signature_url : `${API}${user.signature_url}`
  } catch { return null }
}

function shouldReloadOnSuccess(_path: string, _method: string, mode: ReloadMode): boolean {
  if (mode === 'never') return false
  if (mode === 'always') return true
  // Default mode: no hard refresh. Each page should refresh its own local data
  // by calling load()/refetch after mutation for better UX.
  return false
}

function dispatchMutationEvent(phase: MutationPhase, detail: Record<string, any>) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent('rubber:mutation', { detail: { phase, ...detail } }))
}

function normalizeDateString(value: string): string {
  const s = String(value).trim()
  const midnightDate =
    /^(\d{4}-\d{2}-\d{2})[T\s]00:00:00(?:\.000)?(?:Z|[+-]00:00)?$/.exec(s)
  if (midnightDate) return midnightDate[1]
  return s
}

function normalizeApiDates<T>(input: T): T {
  if (input === null || input === undefined) return input
  if (Array.isArray(input)) {
    return input.map((v) => normalizeApiDates(v)) as T
  }
  if (typeof input === 'string') {
    return normalizeDateString(input) as T
  }
  if (typeof input === 'object') {
    const out: Record<string, any> = {}
    for (const [k, v] of Object.entries(input as Record<string, any>)) {
      out[k] = normalizeApiDates(v)
    }
    return out as T
  }
  return input
}

export async function apiFetchRaw(path: string, opts: RequestInit = {}): Promise<Response> {
  const token = getToken()
  const isGet = String(opts.method || 'GET').toUpperCase() === 'GET'
  try {
    const res = await fetch(`${API}${path}`, {
      ...opts,
      cache: isGet ? 'no-store' : opts.cache,
      headers: {
        ...(isGet ? { 'Cache-Control': 'no-cache' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(opts.headers || {}),
      },
    })
    if (!res.ok && res.status === 401) {
      redirectToLoginOnUnauthorized()
    }
    return res
  } catch (e: any) {
    if (e?.name === 'TypeError' && String(e.message || '').toLowerCase().includes('fetch')) {
      throw new Error(NETWORK_BUSY_MSG)
    }
    throw e
  }
}

export async function apiFetch<T>(path: string, opts: RubberRequestInit = {}): Promise<T> {
  // Don't set Content-Type for FormData (let browser set multipart boundary)
  const isFormData = opts.body instanceof FormData
  try {
    const method = String(opts.method || 'GET').toUpperCase()
    const reloadOnSuccess = opts.reloadOnSuccess || 'auto'
    const isMutation = !['GET', 'HEAD', 'OPTIONS'].includes(method)
    if (isMutation) dispatchMutationEvent('start', { path, method })
    const res = await apiFetchRaw(path, {
      ...opts,
      headers: {
        ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
        ...(opts.headers || {}),
      },
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }))
      const raw = (err as any).error || res.statusText
      throw new Error(mapApiErrorMessage(raw, res.status))
    }
    const data = await res.json().catch(() => ({} as T))
    const normalized = normalizeApiDates(data)
    if (isMutation) dispatchMutationEvent('end', { path, method, ok: true })
    if (typeof window !== 'undefined' && shouldReloadOnSuccess(path, method, reloadOnSuccess)) {
      setTimeout(() => window.location.reload(), 180)
    }
    return normalized as T
  } catch (e: any) {
    const method = String(opts.method || 'GET').toUpperCase()
    const isMutation = !['GET', 'HEAD', 'OPTIONS'].includes(method)
    if (isMutation) dispatchMutationEvent('end', { path, method, ok: false })
    throw e
  }
}
