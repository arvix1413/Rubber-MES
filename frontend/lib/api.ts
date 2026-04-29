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

function mapApiErrorMessage(raw: string, status: number): string {
  const msg = String(raw || '').trim()
  const lower = msg.toLowerCase()

  if (!msg) {
    if (status === 401) return '登入已失效，請重新登入'
    if (status === 403) return '你沒有執行此操作的權限'
    if (status >= 500) return '系統暫時異常，請稍後再試'
    return '操作失敗，請稍後再試'
  }

  if (status === 401) return '登入已失效，請重新登入'
  if (status === 403) return '你沒有執行此操作的權限'

  // MySQL duplicate key / unique constraint
  if (
    lower.includes('duplicate entry') ||
    lower.includes('er_dup_entry') ||
    lower.includes('unique') && lower.includes('constraint')
  ) {
    return '資料重複：此編號或關鍵欄位已存在，請更換後再試'
  }

  // FK constraints
  if (
    lower.includes('foreign key') ||
    lower.includes('cannot delete or update a parent row') ||
    lower.includes('a foreign key constraint fails')
  ) {
    return '此資料已被其他單據使用，無法修改或刪除'
  }

  // DB/infra generic
  if (
    lower.includes('sql') ||
    lower.includes('mysql') ||
    lower.includes('database') ||
    lower.includes('constraint') ||
    lower.includes('syntax')
  ) {
    return '資料處理失敗，請檢查輸入內容或聯絡管理員'
  }

  if (status >= 500) return '系統暫時異常，請稍後再試'
  return msg
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

export async function apiFetch<T>(path: string, opts: RubberRequestInit = {}): Promise<T> {
  const token = getToken()
  // Don't set Content-Type for FormData (let browser set multipart boundary)
  const isFormData = opts.body instanceof FormData
  try {
    const method = String(opts.method || 'GET').toUpperCase()
    const reloadOnSuccess = opts.reloadOnSuccess || 'auto'
    const isGet = method === 'GET'
    const isMutation = !['GET', 'HEAD', 'OPTIONS'].includes(method)
    if (isMutation) dispatchMutationEvent('start', { path, method })
    const res = await fetch(`${API}${path}`, {
      ...opts,
      cache: isGet ? 'no-store' : opts.cache,
      headers: {
        ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
        ...(isGet ? { 'Cache-Control': 'no-cache' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
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
    // Network/CORS/timeout
    if (e?.name === 'TypeError' && String(e.message || '').toLowerCase().includes('fetch')) {
      throw new Error('網路連線異常，請檢查網路後重試')
    }
    throw e
  }
}
