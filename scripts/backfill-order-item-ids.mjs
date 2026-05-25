/**
 * Backfill missing order_item_id on Rubber MES historical rows.
 *
 * Usage:
 *   API=http://43.160.199.226:10102 EMAIL=admin@rubber.local PASSWORD='...' node scripts/backfill-order-item-ids.mjs
 */
const API = (process.env.API || 'http://43.160.199.226:10102').replace(/\/$/, '')
const EMAIL = process.env.EMAIL || 'admin@rubber.local'
const PASSWORD = process.env.PASSWORD || ''

async function req(method, path, token, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  let data
  try { data = text ? JSON.parse(text) : null } catch { data = text }
  if (!res.ok) {
    throw new Error(`${method} ${path} -> ${res.status} ${typeof data === 'string' ? data : JSON.stringify(data)}`)
  }
  return data
}

async function main() {
  if (!PASSWORD) {
    console.error('Set PASSWORD env (admin account).')
    process.exit(1)
  }
  const login = await req('POST', '/api/auth/login', null, { email: EMAIL, password: PASSWORD })
  const token = login.token
  if (!token) throw new Error('login returned no token')

  const result = await req('POST', '/api/admin/backfill-order-item-ids', token)
  console.log(JSON.stringify(result, null, 2))

  const unresolved =
    (result.stats?.delivery_progress_items?.unresolved || 0)
    + (result.stats?.delivery_note_items?.unresolved || 0)
    + (result.stats?.shipment_reconciliation_items?.unresolved || 0)
    + (result.stats?.invoice_items?.unresolved || 0)
    + (result.stats?.delivery_progress?.unresolved || 0)
  if (unresolved > 0) {
    console.warn(`Warning: ${unresolved} row(s) still missing order_item_id (no matching customer order line).`)
    process.exit(2)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
