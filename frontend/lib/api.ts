export const API = process.env.NEXT_PUBLIC_API_URL || 'https://oms-backend.arvix1413.workers.dev'

export function getToken() {
  if (typeof window === 'undefined') return null
  return localStorage.getItem('oms_token')
}

export function setToken(t: string) { localStorage.setItem('oms_token', t) }
export function clearToken() { localStorage.removeItem('oms_token') }

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
    const user = JSON.parse(localStorage.getItem('oms_user') || 'null')
    if (!user?.signature_url) return null
    return user.signature_url.startsWith('http') ? user.signature_url : `${API}${user.signature_url}`
  } catch { return null }
}

export async function apiFetch<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const token = getToken()
  // Don't set Content-Type for FormData (let browser set multipart boundary)
  const isFormData = opts.body instanceof FormData
  try {
    const res = await fetch(`${API}${path}`, {
      ...opts,
      headers: {
        ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(opts.headers || {}),
      },
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }))
      const raw = (err as any).error || res.statusText
      throw new Error(mapApiErrorMessage(raw, res.status))
    }
    return res.json()
  } catch (e: any) {
    // Network/CORS/timeout
    if (e?.name === 'TypeError' && String(e.message || '').toLowerCase().includes('fetch')) {
      throw new Error('網路連線異常，請檢查網路後重試')
    }
    throw e
  }
}
