import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { query, queryOne, execute } from './db'
import { hashPw, signJwt, verifyJwt, now8 } from './auth'
import fs from 'fs'
import path from 'path'

type Variables = { user: any }
const app = new Hono<{ Variables: Variables }>()
const normalizeUserRole = (role: any): 'manager' | 'employee' => (role === 'manager' || role === 'admin' ? 'manager' : 'employee')

app.use('/api/*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowHeaders: ['Content-Type', 'Authorization'],
}))

app.use('/api/*', async (_c, next) => {
  await ensureSoftDeleteColumns()
  await next()
})

// ── Auth middleware ──────────────────────────────────────────────────────────
const authMiddleware = async (c: any, next: () => Promise<void>) => {
  const auth = c.req.header('Authorization') || ''
  const token = auth.replace('Bearer ', '')
  if (!token) return c.json({ error: 'Unauthorized' }, 401)
  const payload = await verifyJwt(token)
  if (!payload) return c.json({ error: 'Invalid token' }, 401)
  c.set('user', payload)
  await next()
}

const isAdmin = async (c: any, next: () => Promise<void>) => {
  const user = c.get('user')
  if (user?.role !== 'admin') return c.json({ error: 'Forbidden' }, 403)
  await next()
}

// Dynamic RBAC permission check — manager always pass, employee checks role_permissions
function requirePerm(permKey: string) {
  return async (c: any, next: () => Promise<void>) => {
    const user = c.get('user')
    if (!user) return c.json({ error: 'Unauthorized' }, 401)
    if (user.role === 'manager') return next()
    const row = await queryOne<any>(
      'SELECT allowed FROM role_permissions WHERE role=? AND permission=? AND allowed=1',
      [normalizeUserRole(user.role), permKey]
    )
    if (!row) return c.json({ error: `無此操作權限（${permKey}）` }, 403)
    return next()
  }
}

// Convenience wrappers — kept for any remaining legacy usage
const canWrite = requirePerm('po.create')
const canApprove = requirePerm('po.approve')
const requireManager = async (c: any, next: () => Promise<void>) => {
  const user = c.get('user')
  if (!user) return c.json({ error: 'Unauthorized' }, 401)
  if (normalizeUserRole(user.role) !== 'manager') return c.json({ error: 'Forbidden' }, 403)
  await next()
}

const PROFIT_ENTRY_CATEGORIES = [
  'operating_cost',
  'logistics',
  'platform_fee',
  'other_cost',
  'sales_tax',
  'income_tax',
  'manual_adjustment',
] as const

const toAmount = (value: any): number => {
  const num = Number(value)
  if (!Number.isFinite(num)) return 0
  return Math.round(num * 100) / 100
}

const calcMargin = (netProfit: number, revenue: number): number => {
  if (revenue <= 0) return 0
  return Math.round((netProfit / revenue) * 10000) / 100
}

const toRate = (value: any): number => {
  const num = Number(value)
  if (!Number.isFinite(num)) return 0
  if (num < 0) return 0
  if (num > 100) return 100
  return Math.round(num * 10000) / 10000
}

const pctAmount = (base: number, ratePct: number): number => toAmount(base * (ratePct / 100))

const AUTO_RATE_PREFIX = '【自動比例】'

type MoqTier = { moq: number; price: number }
const normalizeMoqTiers = (raw: any): MoqTier[] => {
  const src = Array.isArray(raw) ? raw : []
  return src
    .map((row: any) => ({
      moq: Math.max(0, Number(row?.moq) || 0),
      price: Math.max(0, Number(row?.price) || 0),
    }))
    .filter((row: MoqTier) => row.moq > 0 || row.price > 0)
    .sort((a: MoqTier, b: MoqTier) => a.moq - b.moq)
}
const parseMoqTiersFromDb = (raw: any): MoqTier[] => {
  if (!raw) return []
  try {
    return normalizeMoqTiers(JSON.parse(String(raw)))
  } catch {
    return []
  }
}

let ensureProfitTrackingTablePromise: Promise<void> | null = null
const ensureProfitTrackingTable = async () => {
  if (!ensureProfitTrackingTablePromise) {
    ensureProfitTrackingTablePromise = (async () => {
      await execute(`
        CREATE TABLE IF NOT EXISTS order_profit_entries (
          id INT AUTO_INCREMENT PRIMARY KEY,
          order_id INT NOT NULL,
          category VARCHAR(50) NOT NULL,
          description VARCHAR(255) DEFAULT '',
          amount DECIMAL(15,2) NOT NULL DEFAULT 0,
          remark TEXT,
          created_by INT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          INDEX idx_order_profit_entries_order_id (order_id),
          CONSTRAINT fk_order_profit_entries_order FOREIGN KEY (order_id) REFERENCES customer_orders(id) ON DELETE CASCADE
        )
      `)
    })().catch((e) => {
      ensureProfitTrackingTablePromise = null
      throw e
    })
  }
  await ensureProfitTrackingTablePromise
}

let ensureBomMoqTiersPromise: Promise<void> | null = null
const ensureBomMoqTiersColumn = async () => {
  if (!ensureBomMoqTiersPromise) {
    ensureBomMoqTiersPromise = (async () => {
      try {
        await execute('ALTER TABLE bom ADD COLUMN moq_tiers TEXT NULL')
      } catch (e: any) {
        const msg = String(e?.message || '').toLowerCase()
        if (!msg.includes('duplicate column')) throw e
      }
    })().catch((e) => {
      ensureBomMoqTiersPromise = null
      throw e
    })
  }
  await ensureBomMoqTiersPromise
}

let ensureCompanyProfitRatesPromise: Promise<void> | null = null
const ensureCompanyProfitRatesColumns = async () => {
  if (!ensureCompanyProfitRatesPromise) {
    ensureCompanyProfitRatesPromise = (async () => {
      const alterSafe = async (sql: string) => {
        try {
          await execute(sql)
        } catch (e: any) {
          const msg = String(e?.message || '').toLowerCase()
          if (!msg.includes('duplicate column')) throw e
        }
      }
      await alterSafe('ALTER TABLE company_settings ADD COLUMN operating_cost_rate DECIMAL(8,4) NOT NULL DEFAULT 0')
      await alterSafe('ALTER TABLE company_settings ADD COLUMN vat_rate DECIMAL(8,4) NOT NULL DEFAULT 0')
      await alterSafe('ALTER TABLE company_settings ADD COLUMN cit_rate DECIMAL(8,4) NOT NULL DEFAULT 0')
    })().catch((e) => {
      ensureCompanyProfitRatesPromise = null
      throw e
    })
  }
  await ensureCompanyProfitRatesPromise
}

const SOFT_DELETE_TABLES = [
  'suppliers',
  'customers',
  'materials',
  'bom',
  'purchase_orders',
  'customer_orders',
  'quotations',
  'delivery_notes',
  'delivery_sheets',
  'inventory',
  'users',
  'goods_receipts',
  'production_orders',
  'stock_adjustments',
  'order_profit_entries',
] as const

let ensureSoftDeleteColumnsPromise: Promise<void> | null = null
const ensureSoftDeleteColumns = async () => {
  if (!ensureSoftDeleteColumnsPromise) {
    ensureSoftDeleteColumnsPromise = (async () => {
      const alterSafe = async (sql: string) => {
        try {
          await execute(sql)
        } catch (e: any) {
          const msg = String(e?.message || '').toLowerCase()
          if (msg.includes('duplicate column')) return
          if (msg.includes("doesn't exist") || msg.includes('unknown table')) return
          throw e
        }
      }
      await ensureProfitTrackingTable()
      for (const table of SOFT_DELETE_TABLES) {
        await alterSafe(`ALTER TABLE ${table} ADD COLUMN deleted_at DATETIME NULL`)
        await alterSafe(`ALTER TABLE ${table} ADD COLUMN deleted_by INT NULL`)
      }
    })().catch((e) => {
      ensureSoftDeleteColumnsPromise = null
      throw e
    })
  }
  await ensureSoftDeleteColumnsPromise
}

const softDeleteById = async (table: string, id: any, userId: any) => {
  await execute(`UPDATE ${table} SET deleted_at=?, deleted_by=? WHERE id=? AND deleted_at IS NULL`, [now8(), userId || null, id])
}

// ── Audit ────────────────────────────────────────────────────────────────────
async function audit(user: any, action: string, resource: string, resourceId: any, detail?: string) {
  try {
    await execute(
      'INSERT INTO audit_logs (user_id, user_name, user_email, action, resource, resource_id, detail, created_at) VALUES (?,?,?,?,?,?,?,?)',
      [user?.userId || 0, user?.name || 'system', user?.email || '', action, resource, String(resourceId), detail || '', now8()]
    )
  } catch {}
}

app.get('/', c => c.json({ name: 'OMS Backend', version: '2.0.0' }))

// ── All Permissions (defined early, used in login + role-permissions) ─────────
const ALL_PERMISSIONS = [
  { key: 'customer_order.create', label: '新增客戶訂單' },
  { key: 'customer_order.delete', label: '刪除客戶訂單' },
  { key: 'bom.create', label: '新增BOM' },
  { key: 'bom.edit', label: '編輯BOM' },
  { key: 'bom.delete', label: '刪除BOM' },
  { key: 'po.create', label: '新增採購單' },
  { key: 'po.approve', label: '核准採購單' },
  { key: 'po.delete', label: '刪除採購單' },
  { key: 'production.create', label: '新增生產單' },
  { key: 'production.delete', label: '刪除生產單' },
  { key: 'delivery.create', label: '新增出貨單' },
  { key: 'delivery.delete', label: '刪除出貨單' },
  { key: 'customer.manage', label: '管理客戶' },
  { key: 'supplier.manage', label: '管理供應商' },
  { key: 'stock.adjust', label: '庫存調整' },
  { key: 'company.manage', label: '公司設定' },
  { key: 'user.manage', label: '使用者管理' },
  { key: 'audit.view', label: '檢視操作日誌' },
]

// ── Auth ─────────────────────────────────────────────────────────────────────
app.post('/api/auth/login', async c => {
  try {
    const { email, password } = await c.req.json()
    if (!email || !password) return c.json({ error: 'Missing fields' }, 400)
    const user = await queryOne<any>('SELECT * FROM users WHERE email=? AND deleted_at IS NULL', [email])
    if (!user) return c.json({ error: 'Invalid credentials' }, 401)
    if (hashPw(password) !== user.password_hash) return c.json({ error: 'Invalid credentials' }, 401)
    const normalizedRole = normalizeUserRole(user.role)
    const token = await signJwt({ userId: user.id, email: user.email, name: user.name, role: normalizedRole })
    // Load role permissions
    let permissions: string[] = []
    if (normalizedRole === 'manager') {
      permissions = ALL_PERMISSIONS.map((p: any) => p.key)
    } else {
      const rows = await query<any>('SELECT permission FROM role_permissions WHERE role=? AND allowed=1', ['employee'])
      permissions = rows.map((r: any) => r.permission)
    }
    return c.json({ token, user: { id: user.id, email: user.email, name: user.name, role: normalizedRole, signature_url: user.signature_url || null }, permissions })
  } catch (e: any) { return c.json({ error: String(e.message) }, 500) }
})

app.get('/api/auth/me', authMiddleware, async c => {
  const u = c.get('user')
  const user = await queryOne<any>('SELECT id,email,name,role,signature_url FROM users WHERE id=? AND deleted_at IS NULL', [u.userId])
  if (!user) return c.json({ error: 'Not found' }, 404)
  return c.json({ user: { ...user, role: normalizeUserRole(user.role) } })
})

// Save signature URL for current user
app.post('/api/auth/signature', authMiddleware, async c => {
  try {
    const u = c.get('user')
    const { signature_url } = await c.req.json()
    await execute('UPDATE users SET signature_url=? WHERE id=?', [signature_url || null, u.userId])
    const user = await queryOne<any>('SELECT id,email,name,role,signature_url FROM users WHERE id=? AND deleted_at IS NULL', [u.userId])
    return c.json({ ok: true, user: user ? { ...user, role: normalizeUserRole(user.role) } : null })
  } catch (e: any) { return c.json({ error: String(e.message) }, 500) }
})

// Change own password
app.post('/api/auth/change-password', authMiddleware, async c => {
  try {
    const u = c.get('user')
    const { currentPassword, newPassword } = await c.req.json()
    if (!currentPassword || !newPassword) return c.json({ error: 'Missing fields' }, 400)
    if (newPassword.length < 6) return c.json({ error: '新密碼至少需要6個字元' }, 400)
    const user = await queryOne<any>('SELECT password_hash FROM users WHERE id=? AND deleted_at IS NULL', [u.userId])
    if (!user || hashPw(currentPassword) !== user.password_hash) return c.json({ error: '目前密碼不正確' }, 400)
    await execute('UPDATE users SET password_hash=? WHERE id=?', [hashPw(newPassword), u.userId])
    await audit(u, 'UPDATE', '使用者', u.userId, '修改密碼')
    return c.json({ ok: true })
  } catch (e: any) { return c.json({ error: String(e.message) }, 500) }
})

// Reset password for any user
app.post('/api/users/:id/reset-password', authMiddleware, requirePerm('user.manage'), async c => {
  try {
    const u = c.get('user'); const id = c.req.param('id')
    const row = await queryOne<any>('SELECT name,email,role FROM users WHERE id=? AND deleted_at IS NULL', [id])
    if (!row) return c.json({ error: 'User not found' }, 404)
    await execute('UPDATE users SET password_hash=? WHERE id=?', [hashPw('admin123'), id])
    await audit(u, 'UPDATE', '使用者', id, `重設密碼: ${row.email}`)
    return c.json({ ok: true })
  } catch (e: any) { return c.json({ error: String(e.message) }, 500) }
})

// ── Suppliers ────────────────────────────────────────────────────────────────
app.get('/api/suppliers', authMiddleware, async c => {
  const rows = await query('SELECT * FROM suppliers WHERE deleted_at IS NULL ORDER BY created_at DESC')
  return c.json(rows)
})
app.post('/api/suppliers', authMiddleware, requirePerm('supplier.manage'), async c => {
  try {
    const b = await c.req.json()
    if (!b.name) return c.json({ error: 'name required' }, 400)
    const r = await execute('INSERT INTO suppliers (name,supplier_code,tax_id,contact,phone,email,address,main_items,payment_terms,currency,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
      [b.name,b.supplier_code||'',b.tax_id||'',b.contact||'',b.phone||'',b.email||'',b.address||'',b.main_items||'',b.payment_terms||'',b.currency||'VND',b.status||'active',now8()])
    await audit(c.get('user'), 'CREATE', '供應商', r.insertId, b.name)
    return c.json({ id: r.insertId, ...b }, 201)
  } catch (e: any) { return c.json({ error: String(e.message) }, 500) }
})
app.put('/api/suppliers/:id', authMiddleware, requirePerm('supplier.manage'), async c => {
  try {
    const id = c.req.param('id')
    const b = await c.req.json()
    const existing = await queryOne<any>('SELECT supplier_code FROM suppliers WHERE id=? AND deleted_at IS NULL', [id])
    if (!existing) return c.json({ error: 'Not found' }, 404)
    await execute('UPDATE suppliers SET name=?,supplier_code=?,tax_id=?,contact=?,phone=?,email=?,address=?,main_items=?,payment_terms=?,currency=?,status=? WHERE id=?',
      [b.name,existing.supplier_code||'',b.tax_id||'',b.contact||'',b.phone||'',b.email||'',b.address||'',b.main_items||'',b.payment_terms||'',b.currency||'VND',b.status||'active',id])
    await audit(c.get('user'), 'UPDATE', '供應商', id, b.name)
    return c.json({ ok: true })
  } catch (e: any) { return c.json({ error: String(e.message) }, 500) }
})
app.delete('/api/suppliers/:id', authMiddleware, requirePerm('supplier.manage'), async c => {
  const id = c.req.param('id')
  // Check for linked POs before deleting
  const linked = await queryOne<any>('SELECT COUNT(*) as cnt FROM purchase_orders WHERE supplier_id=? AND deleted_at IS NULL', [id])
  if ((linked?.cnt || 0) > 0) return c.json({ error: `此供應商有 ${linked.cnt} 筆採購單，無法刪除` }, 400)
  const row = await queryOne<any>('SELECT name FROM suppliers WHERE id=? AND deleted_at IS NULL', [id])
  if (!row) return c.json({ error: 'Not found' }, 404)
  await softDeleteById('suppliers', id, c.get('user')?.userId)
  await audit(c.get('user'), 'DELETE', '供應商', id, row?.name)
  return c.json({ ok: true })
})

// ── Customers ────────────────────────────────────────────────────────────────
app.get('/api/customers', authMiddleware, async c => c.json(await query('SELECT * FROM customers WHERE deleted_at IS NULL ORDER BY created_at DESC')))
app.post('/api/customers', authMiddleware, requirePerm('customer.manage'), async c => {
  try {
    const b = await c.req.json()
    if (!b.customer_code || !b.customer_name) return c.json({ error: 'customer_code and customer_name required' }, 400)
    const r = await execute('INSERT INTO customers (customer_code,customer_name,tax_id,contact,phone,email,address,main_products,payment_terms,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      [b.customer_code,b.customer_name,b.tax_id||'',b.contact||'',b.phone||'',b.email||'',b.address||'',b.main_products||'',b.payment_terms||'',b.status||'active',now8()])
    await audit(c.get('user'), 'CREATE', '客戶', r.insertId, `${b.customer_code} ${b.customer_name}`)
    return c.json({ id: r.insertId }, 201)
  } catch (e: any) { return c.json({ error: String(e.message) }, 500) }
})
app.put('/api/customers/:id', authMiddleware, requirePerm('customer.manage'), async c => {
  try {
    const id = c.req.param('id')
    const b = await c.req.json()
    const existing = await queryOne<any>('SELECT customer_code FROM customers WHERE id=? AND deleted_at IS NULL', [id])
    if (!existing) return c.json({ error: 'Not found' }, 404)
    await execute('UPDATE customers SET customer_code=?,customer_name=?,tax_id=?,contact=?,phone=?,email=?,address=?,main_products=?,payment_terms=?,status=? WHERE id=?',
      [existing.customer_code,b.customer_name,b.tax_id||'',b.contact||'',b.phone||'',b.email||'',b.address||'',b.main_products||'',b.payment_terms||'',b.status||'active',id])
    await audit(c.get('user'), 'UPDATE', '客戶', id, b.customer_name)
    return c.json({ ok: true })
  } catch (e: any) { return c.json({ error: String(e.message) }, 500) }
})
app.delete('/api/customers/:id', authMiddleware, requirePerm('customer.manage'), async c => {
  const id = c.req.param('id')
  // Check for linked orders before deleting
  const linked = await queryOne<any>('SELECT COUNT(*) as cnt FROM customer_orders WHERE customer_id=? AND deleted_at IS NULL', [id])
  if ((linked?.cnt || 0) > 0) return c.json({ error: `此客戶有 ${linked.cnt} 筆訂單，無法刪除` }, 400)
  const row = await queryOne<any>('SELECT customer_name FROM customers WHERE id=? AND deleted_at IS NULL', [id])
  if (!row) return c.json({ error: 'Not found' }, 404)
  await softDeleteById('customers', id, c.get('user')?.userId)
  await audit(c.get('user'), 'DELETE', '客戶', id, row?.customer_name)
  return c.json({ ok: true })
})

// ── Materials ────────────────────────────────────────────────────────────────
app.get('/api/materials', authMiddleware, async c => {
  const url = new URL(c.req.url)
  const supplierId = url.searchParams.get('supplier_id')
  const supplierName = url.searchParams.get('supplier_name')
  let sql = `SELECT m.*, s.name as supplier_name, s.supplier_code, s.currency as supplier_currency
             FROM materials m LEFT JOIN suppliers s ON m.supplier_id = s.id AND s.deleted_at IS NULL`
  const params: any[] = []
  const where: string[] = ['m.deleted_at IS NULL']
  if (supplierId) {
    where.push('m.supplier_id=?')
    params.push(supplierId)
  } else if (supplierName) {
    where.push('(s.name=? OR s.supplier_code=?)')
    params.push(supplierName, supplierName)
  }
  sql += ` WHERE ${where.join(' AND ')}`
  sql += ' ORDER BY m.created_at DESC'
  const rows = await query(sql, params.length ? params : undefined)
  return c.json(rows)
})
app.post('/api/materials', authMiddleware, requirePerm('bom.create'), async c => {
  try {
    const b = await c.req.json()
    if (!b.material_code || !b.material_name) return c.json({ error: 'material_code and material_name required' }, 400)
    const r = await execute('INSERT INTO materials (material_code,material_name,spec,unit,category,product_category,supplier_id,supplier_price,company_price,currency,stock,image_url,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
      [b.material_code,b.material_name,b.spec||'',b.unit||'PCS',b.category||'',b.product_category||'',b.supplier_id||null,b.supplier_price||0,b.company_price||0,b.currency||'VND',b.stock||0,b.image_url||'',now8()])
    return c.json({ id: r.insertId, ...b }, 201)
  } catch (e: any) { return c.json({ error: String(e.message) }, 500) }
})
app.put('/api/materials/:id', authMiddleware, requirePerm('bom.edit'), async c => {
  try {
    const id = c.req.param('id')
    const b = await c.req.json()
    const existing = await queryOne<any>('SELECT material_code FROM materials WHERE id=? AND deleted_at IS NULL', [id])
    if (!existing) return c.json({ error: 'Not found' }, 404)
    await execute('UPDATE materials SET material_code=?,material_name=?,spec=?,unit=?,category=?,product_category=?,supplier_id=?,supplier_price=?,company_price=?,currency=?,stock=?,image_url=? WHERE id=?',
      [existing.material_code,b.material_name,b.spec||'',b.unit||'PCS',b.category||'',b.product_category||'',b.supplier_id||null,b.supplier_price||0,b.company_price||0,b.currency||'VND',b.stock||0,b.image_url||'',id])
    return c.json({ ok: true })
  } catch (e: any) { return c.json({ error: String(e.message) }, 500) }
})
app.delete('/api/materials/:id', authMiddleware, requirePerm('bom.delete'), async c => {
  const id = c.req.param('id')
  const row = await queryOne<any>('SELECT material_code, material_name FROM materials WHERE id=? AND deleted_at IS NULL', [id])
  if (!row) return c.json({ error: 'Not found' }, 404)
  await softDeleteById('materials', id, c.get('user')?.userId)
  await audit(c.get('user'), 'DELETE', '材料', id, `${row.material_code} ${row.material_name}`)
  return c.json({ ok: true })
})
app.post('/api/materials/bulk', authMiddleware, requirePerm('bom.create'), async c => {
  try {
    const items = await c.req.json()
    let success = 0, updated = 0, newSuppliers = 0
    const errors: string[] = []
    for (const item of items) {
      try {
        let supplierId = null
        if (item.supplier_name) {
          let sup = await queryOne<any>('SELECT id FROM suppliers WHERE name=? AND deleted_at IS NULL', [item.supplier_name])
          if (!sup) {
            const r = await execute('INSERT INTO suppliers (name,currency,status,created_at) VALUES (?,?,?,?)', [item.supplier_name,'VND','active',now8()])
            supplierId = r.insertId; newSuppliers++
          } else { supplierId = sup.id }
        }
        const existing = await queryOne<any>('SELECT id FROM materials WHERE material_code=? AND deleted_at IS NULL', [item.material_code])
        if (existing) {
          await execute('UPDATE materials SET material_name=?,spec=?,unit=?,category=?,product_category=?,supplier_id=?,supplier_price=?,currency=? WHERE material_code=?',
            [item.material_name,item.spec||'',item.unit||'PCS',item.category||'',item.product_category||'',supplierId,item.supplier_price||0,item.currency||'VND',item.material_code])
          updated++
        } else {
          await execute('INSERT INTO materials (material_code,material_name,spec,unit,category,product_category,supplier_id,supplier_price,currency,stock,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
            [item.material_code,item.material_name,item.spec||'',item.unit||'PCS',item.category||'',item.product_category||'',supplierId,item.supplier_price||0,item.currency||'VND',0,now8()])
          success++
        }
      } catch (e: any) { errors.push(`${item.material_code}: ${e.message}`) }
    }
    return c.json({ success, updated, new_suppliers: newSuppliers, errors })
  } catch (e: any) { return c.json({ error: String(e.message) }, 500) }
})

// ── BOM ──────────────────────────────────────────────────────────────────────
app.get('/api/bom', authMiddleware, async c => {
  await ensureBomMoqTiersColumn()
  const rows = await query<any>(`
    SELECT b.*, s.name as supplier_display_name
    FROM bom b LEFT JOIN suppliers s ON b.supplier_id = s.id AND s.deleted_at IS NULL
    WHERE b.deleted_at IS NULL
    ORDER BY b.category, b.created_at DESC
  `)
  return c.json(rows.map((row: any) => ({ ...row, moq_tiers: parseMoqTiersFromDb(row.moq_tiers) })))
})
app.get('/api/bom/:id', authMiddleware, async c => {
  await ensureBomMoqTiersColumn()
  const bom = await queryOne<any>(`
    SELECT b.*, s.name as supplier_display_name
    FROM bom b LEFT JOIN suppliers s ON b.supplier_id = s.id AND s.deleted_at IS NULL
    WHERE b.id=? AND b.deleted_at IS NULL`, [c.req.param('id')])
  if (!bom) return c.json({ error: 'Not found' }, 404)
  const items = await query(`
    SELECT bi.*, bi.material_name as mat_name, bi.spec as mat_spec, bi.unit as mat_unit
    FROM bom_items bi
    WHERE bi.bom_id=?`, [c.req.param('id')])
  return c.json({ ...bom, moq_tiers: parseMoqTiersFromDb(bom.moq_tiers), items })
})

const parseRequiredMoney = (value: any): number | null => {
  if (value === null || value === undefined || value === '') return null
  const num = Number(value)
  if (!Number.isFinite(num) || num < 0) return null
  return toAmount(num)
}

const normalizeRequiredText = (value: any): string => String(value ?? '').trim()

app.post('/api/bom', authMiddleware, requirePerm('bom.create'), async c => {
  try {
    await ensureBomMoqTiersColumn()
    const b = await c.req.json()
    const productSku = normalizeRequiredText(b.product_sku)
    const productName = normalizeRequiredText(b.product_name)
    const unit = normalizeRequiredText(b.unit)
    const currency = normalizeRequiredText(b.currency)
    const supplierPrice = parseRequiredMoney(b.supplier_price)
    const companyPrice = parseRequiredMoney(b.company_price)
    if (!productSku) return c.json({ error: 'product_sku required' }, 400)
    if (!productName) return c.json({ error: 'product_name required' }, 400)
    if (!unit) return c.json({ error: 'unit required' }, 400)
    if (!currency) return c.json({ error: 'currency required' }, 400)
    if (supplierPrice === null) return c.json({ error: 'supplier_price required and must be >= 0' }, 400)
    if (companyPrice === null) return c.json({ error: 'company_price required and must be >= 0' }, 400)
    const existing = await queryOne<any>('SELECT id FROM bom WHERE product_sku=? AND deleted_at IS NULL', [productSku])
    if (existing) return c.json({ error: `SKU「${productSku}」已存在，請使用不同的 SKU` }, 409)
    const u = c.get('user')
    const moqTiers = normalizeMoqTiers(b.moq_tiers)
    const r = await execute(`INSERT INTO bom (product_sku,product_name,material_name,spec,unit,supplier_id,supplier_name,supplier_price,company_price,currency,category,cert_code,brand,image_url,version,moq_tiers,status,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [productSku, productName, b.material_name||'', b.spec||'', unit,
       b.supplier_id||null, b.supplier_name||'', supplierPrice, companyPrice,
       currency, b.category||'', b.cert_code||'', b.brand||'', b.image_url||'', b.version||'V1',
       moqTiers.length ? JSON.stringify(moqTiers) : null,
       'active', u.userId, now8()])
    const bomId = r.insertId
    if (b.items?.length) {
      for (const item of b.items) {
        await execute('INSERT INTO bom_items (bom_id,material_code,material_name,spec,unit,quantity,supplier_name,supplier_price,company_price,currency,remark,color,lt,moq) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
          [bomId,item.material_code,item.material_name,item.spec||'',item.unit||'PCS',item.quantity||null,item.supplier_name||'',item.supplier_price||0,item.company_price||0,item.currency||'VND',item.remark||'',item.color||'',item.lt||'',item.moq||null])
      }
    }
    await audit(u, 'CREATE', 'BOM', bomId, `${productSku} ${productName}`)
    return c.json({ id: bomId }, 201)
  } catch (e: any) { return c.json({ error: String(e.message) }, 500) }
})
app.put('/api/bom/:id', authMiddleware, requirePerm('bom.edit'), async c => {
  try {
    await ensureBomMoqTiersColumn()
    const id = c.req.param('id'); const b = await c.req.json(); const u = c.get('user')
    const existing = await queryOne<any>('SELECT product_sku FROM bom WHERE id=? AND deleted_at IS NULL', [id])
    if (!existing) return c.json({ error: 'Not found' }, 404)
    const productName = normalizeRequiredText(b.product_name)
    const unit = normalizeRequiredText(b.unit)
    const currency = normalizeRequiredText(b.currency)
    const supplierPrice = parseRequiredMoney(b.supplier_price)
    const companyPrice = parseRequiredMoney(b.company_price)
    if (!productName) return c.json({ error: 'product_name required' }, 400)
    if (!unit) return c.json({ error: 'unit required' }, 400)
    if (!currency) return c.json({ error: 'currency required' }, 400)
    if (supplierPrice === null) return c.json({ error: 'supplier_price required and must be >= 0' }, 400)
    if (companyPrice === null) return c.json({ error: 'company_price required and must be >= 0' }, 400)
    const moqTiers = normalizeMoqTiers(b.moq_tiers)
    await execute(`UPDATE bom SET product_sku=?,product_name=?,material_name=?,spec=?,unit=?,supplier_id=?,supplier_name=?,supplier_price=?,company_price=?,currency=?,category=?,cert_code=?,brand=?,image_url=?,version=?,moq_tiers=? WHERE id=?`,
      [existing.product_sku, productName, b.material_name||'', b.spec||'', unit,
       b.supplier_id||null, b.supplier_name||'', supplierPrice, companyPrice,
       currency, b.category||'', b.cert_code||'', b.brand||'', b.image_url||'', b.version||'V1',
       moqTiers.length ? JSON.stringify(moqTiers) : null,
       id])
    await execute('DELETE FROM bom_items WHERE bom_id=?', [id])
    if (b.items?.length) {
      for (const item of b.items) {
        await execute('INSERT INTO bom_items (bom_id,material_code,material_name,spec,unit,quantity,supplier_name,supplier_price,company_price,currency,remark,color,lt,moq) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
          [id,item.material_code,item.material_name,item.spec||'',item.unit||'PCS',item.quantity||null,item.supplier_name||'',item.supplier_price||0,item.company_price||0,item.currency||'VND',item.remark||'',item.color||'',item.lt||'',item.moq||null])
      }
    }
    await audit(u, 'UPDATE', 'BOM', id, `${existing.product_sku} ${productName}`)
    return c.json({ ok: true })
  } catch (e: any) { return c.json({ error: String(e.message) }, 500) }
})
app.delete('/api/bom/:id', authMiddleware, requirePerm('bom.delete'), async c => {
  const id = c.req.param('id')
  // Only active (non-soft-deleted) customer orders should block BOM deletion.
  const linkedCO = await queryOne<any>(`
    SELECT COUNT(*) as cnt
    FROM customer_order_items coi
    JOIN customer_orders co ON co.id = coi.order_id
    WHERE coi.bom_id=? AND co.deleted_at IS NULL
  `, [id])
  if ((linkedCO?.cnt || 0) > 0) return c.json({ error: `此 BOM 有 ${linkedCO.cnt} 筆客戶訂單明細，無法刪除` }, 400)
  const row = await queryOne<any>('SELECT product_sku,product_name FROM bom WHERE id=? AND deleted_at IS NULL', [id])
  if (!row) return c.json({ error: 'Not found' }, 404)
  await softDeleteById('bom', id, c.get('user')?.userId)
  await audit(c.get('user'), 'DELETE', 'BOM', id, `${row?.product_sku} ${row?.product_name}`)
  return c.json({ ok: true })
})

// ── Purchase Orders ───────────────────────────────────────────────────────────
app.get('/api/po', authMiddleware, async c => {
  const url = new URL(c.req.url)
  const status = url.searchParams.get('status') || ''
  const supplierId = url.searchParams.get('supplier_id') || ''
  let sql = `SELECT po.*, s.name as supplier_name, s.supplier_code
    FROM purchase_orders po LEFT JOIN suppliers s ON po.supplier_id = s.id AND s.deleted_at IS NULL`
  const params: any[] = []
  const where: string[] = ['po.deleted_at IS NULL']
  if (status) { where.push('po.status=?'); params.push(status) }
  if (supplierId) { where.push('po.supplier_id=?'); params.push(supplierId) }
  if (where.length) sql += ' WHERE ' + where.join(' AND ')
  sql += ' ORDER BY po.created_at DESC'
  return c.json(await query(sql, params.length ? params : undefined))
})
app.get('/api/po/:id', authMiddleware, async c => {
  const po = await queryOne<any>(`
    SELECT po.*, s.name as supplier_name, s.supplier_code
    FROM purchase_orders po LEFT JOIN suppliers s ON po.supplier_id = s.id AND s.deleted_at IS NULL
    WHERE po.id=? AND po.deleted_at IS NULL`, [c.req.param('id')])
  if (!po) return c.json({ error: 'Not found' }, 404)
  const items = await query(`
    SELECT pi.*,
           COALESCE(pi.material_name, b.product_name, '') as material_name,
           COALESCE(pi.spec, b.spec, '') as spec,
           COALESCE(pi.unit, b.unit, 'PCS') as unit,
           b.image_url
    FROM po_items pi 
    LEFT JOIN bom b ON pi.material_code = b.product_sku
    WHERE pi.po_id=?`, [c.req.param('id')])
  return c.json({ ...po, items })
})
app.post('/api/po', authMiddleware, requirePerm('po.create'), async c => {
  try {
    const b = await c.req.json()
    const u = c.get('user')
    const poNum = `PO${Date.now()}`
    const subTotal = (b.items||[]).reduce((s: number, i: any) => s + (i.total_price||0), 0)
    const taxRate = Math.min(25, Math.max(1, Number(b.tax_rate) || 8))
    const total = Math.round(subTotal * (1 + taxRate / 100) * 100) / 100
    const r = await execute('INSERT INTO purchase_orders (po_number,supplier_id,supplier_name,status,total_amount,tax_rate,currency,created_by,remark,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
      [poNum,b.supplier_id||null,b.supplier_name,'draft',total,taxRate,b.currency||'VND',u.userId,b.remark||'',now8()])
    const poId = r.insertId
    if (b.items?.length) {
      for (const item of b.items) {
        const tp = (item.quantity||0)*(item.unit_price||0)
        await execute('INSERT INTO po_items (po_id,material_code,material_name,spec,unit,quantity,unit_price,total_price,currency,remark,po_ref,thickness) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
          [poId,item.material_code,item.material_name,item.spec||'',item.unit||'PCS',item.quantity,item.unit_price||0,tp,item.currency||'VND',item.remark||'',item.po_ref||'',item.thickness||null])
      }
    }
    await audit(u, 'CREATE', '採購單', poId, poNum)
    return c.json({ id: poId, po_number: poNum }, 201)
  } catch (e: any) { return c.json({ error: String(e.message) }, 500) }
})
app.put('/api/po/:id', authMiddleware, requirePerm('po.create'), async c => {
  try {
    const id = c.req.param('id'); const b = await c.req.json(); const u = c.get('user')
    const po = await queryOne<any>('SELECT status FROM purchase_orders WHERE id=? AND deleted_at IS NULL', [id])
    if (!po) return c.json({ error: 'Not found' }, 404)
    if (po.status !== 'draft') return c.json({ error: '只能編輯草稿狀態的採購單' }, 400)
    const subTotal = (b.items||[]).reduce((s: number, i: any) => s + (i.total_price||0), 0)
    const taxRate = Math.min(25, Math.max(1, Number(b.tax_rate) || 8))
    const total = Math.round(subTotal * (1 + taxRate / 100) * 100) / 100
    await execute('UPDATE purchase_orders SET supplier_id=?,supplier_name=?,total_amount=?,tax_rate=?,currency=?,remark=? WHERE id=?',
      [b.supplier_id||null, b.supplier_name, total, taxRate, b.currency||'VND', b.remark||'', id])
    await execute('DELETE FROM po_items WHERE po_id=?', [id])
    if (b.items?.length) {
      for (const item of b.items) {
        const tp = (item.quantity||0)*(item.unit_price||0)
        await execute('INSERT INTO po_items (po_id,material_code,material_name,spec,unit,quantity,unit_price,total_price,currency,remark,po_ref,thickness) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
          [id,item.material_code,item.material_name,item.spec||'',item.unit||'PCS',item.quantity,item.unit_price||0,tp,item.currency||'VND',item.remark||'',item.po_ref||'',item.thickness||null])
      }
    }
    await audit(u, 'UPDATE', '採購單', id, b.supplier_name)
    return c.json({ ok: true })
  } catch (e: any) { return c.json({ error: String(e.message) }, 500) }
})
app.patch('/api/po/:id/approve', authMiddleware, requirePerm('po.approve'), async c => {
  try {
    const id = c.req.param('id'); const u = c.get('user')
    const row = await queryOne<any>('SELECT po_number, status FROM purchase_orders WHERE id=? AND deleted_at IS NULL', [id])
    if (!row) return c.json({ error: 'Not found' }, 404)
    if (row.status !== 'draft') return c.json({ error: '只有草稿狀態的採購單才能核准' }, 400)
    await execute('UPDATE purchase_orders SET status=?,approved_by=?,approved_at=? WHERE id=?', ['approved',u.userId,now8(),id])
    await audit(u, 'APPROVE', '採購單', id, row?.po_number)
    return c.json({ ok: true })
  } catch (e: any) { return c.json({ error: String(e.message) }, 500) }
})
app.patch('/api/po/:id/status', authMiddleware, requirePerm('po.create'), async c => {
  try {
    const id = c.req.param('id'); const { status } = await c.req.json()
    const validStatuses = ['sent', 'cancelled']
    if (!validStatuses.includes(status)) return c.json({ error: 'Invalid status' }, 400)
    const row = await queryOne<any>('SELECT po_number FROM purchase_orders WHERE id=? AND deleted_at IS NULL', [id])
    await execute('UPDATE purchase_orders SET status=? WHERE id=?', [status,id])
    await audit(c.get('user'), 'STATUS_CHANGE', '採購單', id, `${row?.po_number} → ${status}`)
    return c.json({ ok: true })
  } catch (e: any) { return c.json({ error: String(e.message) }, 500) }
})
app.delete('/api/po/:id', authMiddleware, requirePerm('po.delete'), async c => {
  try {
    const id = c.req.param('id')
    const row = await queryOne<any>('SELECT po_number, status FROM purchase_orders WHERE id=? AND deleted_at IS NULL', [id])
    if (!row) return c.json({ error: 'Not found' }, 404)
    await softDeleteById('purchase_orders', id, c.get('user')?.userId)
    await audit(c.get('user'), 'DELETE', '採購單', id, row?.po_number)
    return c.json({ ok: true })
  } catch (e: any) { return c.json({ error: String(e.message) }, 500) }
})

// 採購單收貨：更新材料庫存
app.patch('/api/po/:id/receive', authMiddleware, requirePerm('po.approve'), async c => {
  try {
    const id = c.req.param('id'); const u = c.get('user')
    const po = await queryOne<any>('SELECT * FROM purchase_orders WHERE id=? AND deleted_at IS NULL', [id])
    if (!po) return c.json({ error: 'Not found' }, 404)
    if (po.status === 'received') return c.json({ error: '此採購單已收貨，不可重複操作' }, 400)
    if (!['approved', 'sent'].includes(po.status)) return c.json({ error: '只有已核准或已送出的採購單才能收貨' }, 400)
    const items = await query<any>('SELECT * FROM po_items WHERE po_id=?', [id])
    for (const item of items) {
      const qty = parseFloat(item.quantity) || 0
      const bom = await queryOne<any>('SELECT id, current_stock FROM bom WHERE product_sku=?', [item.material_code])
      const before = parseFloat(bom?.current_stock) || 0
      const after = before + qty
      if (bom) {
        await execute('UPDATE bom SET current_stock=? WHERE product_sku=?', [after, item.material_code])
      }
      await execute(
        'INSERT INTO stock_ledger (material_code,material_name,transaction_type,ref_type,ref_id,ref_number,qty_change,qty_before,qty_after,unit,remark,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
        [item.material_code, item.material_name, 'GR_IN', 'purchase_order', id, po.po_number, qty, before, after, item.unit||'PCS', `採購收貨 ${po.po_number}`, u.userId, now8()]
      )
      await execute('UPDATE po_items SET received_qty=? WHERE id=?', [qty, item.id])
    }
    await execute('UPDATE purchase_orders SET status=? WHERE id=?', ['received', id])
    await audit(u, 'RECEIVE', '採購單', id, `${po.po_number} 收貨完成，庫存已更新`)
    return c.json({ ok: true })
  } catch (e: any) { return c.json({ error: String(e.message) }, 500) }
})

// ── Customer Orders ───────────────────────────────────────────────────────────
app.get('/api/customer-orders', authMiddleware, async c => {
  try {
    const url = new URL(c.req.url)
    const status = url.searchParams.get('status') || ''
    const customerId = url.searchParams.get('customer_id') || ''
    const dateFrom = url.searchParams.get('date_from') || ''
    const dateTo = url.searchParams.get('date_to') || ''
    const where: string[] = []
    const params: any[] = []
    if (status) { where.push('co.status=?'); params.push(status) }
    if (customerId) { where.push('co.customer_id=?'); params.push(customerId) }
    if (dateFrom) { where.push('co.po_date>=?'); params.push(dateFrom) }
    if (dateTo) { where.push('co.po_date<=?'); params.push(dateTo) }
    where.unshift('co.deleted_at IS NULL')
    const whereClause = where.length ? ' WHERE ' + where.join(' AND ') : ''
    const orders = await query(`
      SELECT co.id, co.po_date, co.po_number, co.customer_id, co.status, co.remark, co.created_at,
             COALESCE(co.tax_rate, 0) as tax_rate,
             COALESCE(co.tax_amount, 0) as tax_amount, 
             COALESCE(co.total_amount, 0) as total_amount, 
             COALESCE(co.currency, 'VND') as currency,
             co.delivery_date, co.delivery_address, co.person_in_charge, co.payment_terms,
             COALESCE(co.received_amount, 0) as received_amount, 
             COALESCE(co.payment_status, 'unpaid') as payment_status, 
             co.payment_date, co.payment_note,
             c.customer_name, c.customer_code
      FROM customer_orders co LEFT JOIN customers c ON co.customer_id = c.id AND c.deleted_at IS NULL
      ${whereClause}
      ORDER BY co.created_at DESC
    `, params.length ? params : undefined)
    return c.json(orders)
  } catch (e: any) {
    console.error('Error fetching customer orders:', e.message)
    try {
      const orders = await query(`
        SELECT co.id, co.po_date, co.po_number, co.customer_id, co.status, co.remark, co.created_at,
               c.customer_name, c.customer_code
        FROM customer_orders co LEFT JOIN customers c ON co.customer_id = c.id AND c.deleted_at IS NULL
        WHERE co.deleted_at IS NULL
        ORDER BY co.created_at DESC
      `)
      return c.json(orders)
    } catch (fallbackError: any) {
      return c.json({ error: fallbackError.message }, 500)
    }
  }
})
// Must be before /:id to avoid 'pending' being treated as an id
app.get('/api/customer-orders/pending', authMiddleware, async c => {
  const customerId = c.req.query('customer_id')
  const poSearch = c.req.query('po_search')
  if (!customerId && !poSearch) return c.json([])

  let sql = `
    SELECT co.id, co.po_number, co.po_date, co.status, co.customer_id,
           c.customer_name,
           GROUP_CONCAT(b.product_name ORDER BY ci.id SEPARATOR ', ') as items_summary
    FROM customer_orders co
    LEFT JOIN customers c ON co.customer_id = c.id AND c.deleted_at IS NULL
    LEFT JOIN customer_order_items ci ON ci.order_id = co.id
    LEFT JOIN bom b ON ci.bom_id = b.id
    WHERE co.status = 'pending' AND co.deleted_at IS NULL
  `
  const params: any[] = []
  if (customerId) { sql += ' AND co.customer_id = ?'; params.push(customerId) }
  if (poSearch) { sql += ' AND co.po_number LIKE ?'; params.push(`%${poSearch}%`) }
  sql += ' GROUP BY co.id ORDER BY co.created_at DESC'

  return c.json(await query(sql, params))
})
app.get('/api/customer-orders/:id', authMiddleware, async c => {
  const order = await queryOne<any>(`
    SELECT co.id, co.po_date, co.po_number, co.customer_id, co.status, co.remark, co.created_at,
           co.tax_rate, co.tax_amount, co.total_amount, co.currency,
           co.delivery_date, co.delivery_address, co.person_in_charge, co.payment_terms,
           co.received_amount, co.payment_status, co.payment_date, co.payment_note,
           c.customer_name, c.customer_code, c.address, c.phone, c.fax, c.email, c.tax_id
    FROM customer_orders co LEFT JOIN customers c ON co.customer_id = c.id AND c.deleted_at IS NULL
    WHERE co.id=? AND co.deleted_at IS NULL`, [c.req.param('id')])
  if (!order) return c.json({ error: 'Not found' }, 404)
  const items = await query(`
    SELECT ci.id, ci.order_id, ci.bom_id, ci.qty, ci.unit_price, ci.rta_date, ci.remark,
           ci.arrived_qty, ci.arrived_date, ci.balance, ci.status,
           b.product_sku, b.product_name, b.version, b.spec, b.unit
    FROM customer_order_items ci
    LEFT JOIN bom b ON ci.bom_id = b.id
    WHERE ci.order_id=?`, [c.req.param('id')])
  return c.json({ ...order, items })
})
app.post('/api/customer-orders', authMiddleware, requirePerm('customer_order.create'), async c => {
  try {
    const b = await c.req.json()
    if (!b.po_number || !b.customer_id) return c.json({ error: 'po_number and customer_id required' }, 400)
    const duplicated = await queryOne<any>('SELECT id FROM customer_orders WHERE po_number=? AND deleted_at IS NULL', [b.po_number])
    if (duplicated) return c.json({ error: `訂單編號「${b.po_number}」已存在，請使用不同編號` }, 409)
    const cust = await queryOne<any>('SELECT customer_name, payment_terms FROM customers WHERE id=? AND deleted_at IS NULL', [b.customer_id])
    // No tax for customer orders
    const subtotal = (b.items||[]).reduce((s: number, i: any) => s + (i.qty||0) * (i.unit_price||0), 0)
    const taxRate = 0
    const taxAmount = 0
    const totalAmount = subtotal
    const r = await execute('INSERT INTO customer_orders (po_date,po_number,customer_id,status,remark,tax_rate,tax_amount,total_amount,currency,delivery_date,delivery_address,person_in_charge,payment_terms,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      [b.po_date||null, b.po_number, b.customer_id, b.status||'pending', b.remark||'',
       taxRate, taxAmount, totalAmount, b.currency||'VND',
       b.delivery_date||null, b.delivery_address||'', b.person_in_charge||'', b.payment_terms||cust?.payment_terms||'',
       now8()])
    const orderId = r.insertId
    if (b.items?.length) {
      for (const item of b.items) {
        if (!item.bom_id) continue  // skip items without BOM
        await execute('INSERT INTO customer_order_items (order_id,bom_id,qty,unit_price,rta_date,remark,arrived_qty,balance,status) VALUES (?,?,?,?,?,?,?,?,?)',
          [orderId, item.bom_id, item.qty||0, item.unit_price||0, null, item.remark||'', 0, item.qty||0, 'pending'])
      }
    }
    await audit(c.get('user'), 'CREATE', '客戶訂單', orderId, `${b.po_number} / ${cust?.customer_name||b.customer_id}`)

    // Auto-create a draft delivery note with same items
    const dnNum = `DN${Date.now()}`
    const dnR = await execute(
      'INSERT INTO delivery_notes (dn_number,customer_id,customer_name,customer_order_id,delivery_date,status,remark,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?)',
      [dnNum, b.customer_id, cust?.customer_name||'', orderId, b.po_date||null, 'draft', b.remark||'', c.get('user').userId, now8()]
    )
    const dnId = dnR.insertId
    if (b.items?.length) {
      for (const item of b.items) {
        if (!item.bom_id) continue
        // Get BOM info for item_name, material_code, spec, unit
        const bom = await queryOne<any>('SELECT product_sku, product_name, spec, unit FROM bom WHERE id=? AND deleted_at IS NULL', [item.bom_id])
        await execute(
          'INSERT INTO delivery_note_items (dn_id,item_name,material_code,spec,unit,qty,remark,po_ref,thickness) VALUES (?,?,?,?,?,?,?,?,?)',
          [dnId, bom?.product_name||'', bom?.product_sku||'', bom?.spec||'', bom?.unit||'PCS', item.qty||0, '', b.po_number||'', null]
        )
      }
    }
    await audit(c.get('user'), 'CREATE', '出貨單(自動)', dnId, `${dnNum} ← ${b.po_number}`)

    return c.json({ id: orderId, dn_id: dnId, dn_number: dnNum }, 201)
  } catch (e: any) { return c.json({ error: String(e.message) }, 500) }
})
app.patch('/api/customer-orders/:id/status', authMiddleware, requirePerm('customer_order.create'), async c => {
  try {
    const id = c.req.param('id')
    const { status } = await c.req.json()
    const valid = ['pending', 'partial', 'completed', 'delay']
    if (!valid.includes(status)) return c.json({ error: 'Invalid status' }, 400)
    await execute('UPDATE customer_orders SET status=? WHERE id=?', [status, id])
    const row = await queryOne<any>('SELECT po_number FROM customer_orders WHERE id=? AND deleted_at IS NULL', [id])
    await audit(c.get('user'), 'STATUS_CHANGE', '客戶訂單', id, `${row?.po_number} → ${status}`)
    return c.json({ ok: true })
  } catch (e: any) { return c.json({ error: String(e.message) }, 500) }
})
app.put('/api/customer-orders/:id', authMiddleware, requirePerm('customer_order.create'), async c => {
  try {
    const id = c.req.param('id'); const b = await c.req.json(); const u = c.get('user')
    const existing = await queryOne<any>('SELECT status, po_number FROM customer_orders WHERE id=? AND deleted_at IS NULL', [id])
    if (!existing) return c.json({ error: 'Not found' }, 404)
    if (existing.status === 'completed') return c.json({ error: '已完成的訂單不能修改' }, 400)
    const subtotal = (b.items||[]).reduce((s: number, i: any) => s + (i.qty||0) * (i.unit_price||0), 0)
    const taxRate = 0
    const taxAmount = 0
    const totalAmount = subtotal
    await execute('UPDATE customer_orders SET po_date=?,po_number=?,customer_id=?,remark=?,tax_rate=?,tax_amount=?,total_amount=?,currency=?,delivery_date=?,delivery_address=?,person_in_charge=?,payment_terms=? WHERE id=?',
      [b.po_date||null, existing.po_number, b.customer_id, b.remark||'', taxRate, taxAmount, totalAmount, b.currency||'VND', b.delivery_date||null, b.delivery_address||'', b.person_in_charge||'', b.payment_terms||'', id])
    // Replace items
    await execute('DELETE FROM customer_order_items WHERE order_id=?', [id])
    if (b.items?.length) {
      for (const item of b.items) {
        if (!item.bom_id) continue
        await execute('INSERT INTO customer_order_items (order_id,bom_id,qty,unit_price,rta_date,remark,arrived_qty,balance,status) VALUES (?,?,?,?,?,?,?,?,?)',
          [id, item.bom_id, item.qty||0, item.unit_price||0, null, item.remark||'', 0, item.qty||0, 'pending'])
      }
    }
    await audit(u, 'UPDATE', '客戶訂單', id, existing.po_number)
    return c.json({ ok: true })
  } catch (e: any) { return c.json({ error: String(e.message) }, 500) }
})
app.delete('/api/customer-orders/:id', authMiddleware, requirePerm('customer_order.delete'), async c => {
  try {
    const id = c.req.param('id')
    const row = await queryOne<any>(`
      SELECT co.po_number, c.customer_name
      FROM customer_orders co LEFT JOIN customers c ON co.customer_id = c.id AND c.deleted_at IS NULL
      WHERE co.id=? AND co.deleted_at IS NULL`, [id])
    if (!row) return c.json({ error: 'Not found' }, 404)
    await execute('UPDATE delivery_notes SET deleted_at=?, deleted_by=? WHERE customer_order_id=? AND deleted_at IS NULL', [now8(), c.get('user')?.userId || null, id])
    await execute('UPDATE delivery_sheets SET deleted_at=?, deleted_by=? WHERE customer_order_id=? AND deleted_at IS NULL', [now8(), c.get('user')?.userId || null, id])
    await softDeleteById('customer_orders', id, c.get('user')?.userId)
    await audit(c.get('user'), 'DELETE', '客戶訂單', id, `${row?.po_number} / ${row?.customer_name}`)
    return c.json({ ok: true })
  } catch (e: any) { return c.json({ error: String(e.message) }, 500) }
})

// ── Profit Tracking (Manager only) ───────────────────────────────────────────
app.get('/api/profit-tracking/orders', authMiddleware, requireManager, async c => {
  try {
    await ensureProfitTrackingTable()
    const url = new URL(c.req.url)
    const search = (url.searchParams.get('search') || '').trim()
    const status = (url.searchParams.get('status') || '').trim()
    const where: string[] = []
    const params: any[] = []
    if (status) { where.push('co.status=?'); params.push(status) }
    if (search) {
      where.push('(co.po_number LIKE ? OR c.customer_name LIKE ? OR c.customer_code LIKE ?)')
      const term = `%${search}%`
      params.push(term, term, term)
    }
    where.unshift('co.deleted_at IS NULL')
    const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : ''

    const orders = await query<any>(`
      SELECT co.id, co.po_number, co.po_date, co.status, co.created_at, co.currency,
             c.customer_name, c.customer_code
      FROM customer_orders co
      LEFT JOIN customers c ON co.customer_id = c.id AND c.deleted_at IS NULL
      ${whereClause}
      ORDER BY co.created_at DESC
      LIMIT 500
    `, params.length ? params : undefined)

    if (!orders.length) return c.json({ orders: [] })

    const orderIds = orders.map((o: any) => Number(o.id))
    const idPlaceholders = orderIds.map(() => '?').join(',')
    const itemSums = await query<any>(`
      SELECT ci.order_id,
             COALESCE(SUM(ci.qty * ci.unit_price), 0) as revenue,
             COALESCE(SUM(ci.qty * COALESCE(b.company_price, b.supplier_price, 0)), 0) as cogs
      FROM customer_order_items ci
      LEFT JOIN bom b ON b.id = ci.bom_id
      WHERE ci.order_id IN (${idPlaceholders})
      GROUP BY ci.order_id
    `, orderIds)
    const entrySums = await query<any>(`
      SELECT ope.order_id,
             COALESCE(SUM(CASE WHEN ope.category IN ('operating_cost','logistics','platform_fee','other_cost') THEN ope.amount ELSE 0 END), 0) as operating_cost,
             COALESCE(SUM(CASE WHEN ope.category='sales_tax' THEN ope.amount ELSE 0 END), 0) as sales_tax,
             COALESCE(SUM(CASE WHEN ope.category='income_tax' THEN ope.amount ELSE 0 END), 0) as income_tax,
             COALESCE(SUM(CASE WHEN ope.category='manual_adjustment' THEN ope.amount ELSE 0 END), 0) as manual_adjustment
      FROM order_profit_entries ope
      WHERE ope.order_id IN (${idPlaceholders}) AND ope.deleted_at IS NULL
      GROUP BY ope.order_id
    `, orderIds)

    const itemMap = new Map<number, any>()
    const entryMap = new Map<number, any>()
    itemSums.forEach((row: any) => itemMap.set(Number(row.order_id), row))
    entrySums.forEach((row: any) => entryMap.set(Number(row.order_id), row))

    const result = orders.map((o: any) => {
      const item = itemMap.get(Number(o.id)) || {}
      const entry = entryMap.get(Number(o.id)) || {}
      const revenue = toAmount(item.revenue)
      const cogs = toAmount(item.cogs)
      const operating_cost = toAmount(entry.operating_cost)
      const sales_tax = toAmount(entry.sales_tax)
      const income_tax = toAmount(entry.income_tax)
      const manual_adjustment = toAmount(entry.manual_adjustment)
      const gross_profit = toAmount(revenue - cogs)
      const net_profit = toAmount(gross_profit - operating_cost - sales_tax - income_tax + manual_adjustment)
      const net_margin = calcMargin(net_profit, revenue)
      return {
        ...o,
        revenue,
        cogs,
        gross_profit,
        operating_cost,
        sales_tax,
        income_tax,
        manual_adjustment,
        net_profit,
        net_margin,
      }
    })
    return c.json({ orders: result })
  } catch (e: any) { return c.json({ error: String(e.message) }, 500) }
})

app.get('/api/profit-tracking/orders/:id', authMiddleware, requireManager, async c => {
  try {
    await ensureProfitTrackingTable()
    const orderId = Number(c.req.param('id'))
    if (!Number.isFinite(orderId)) return c.json({ error: 'Invalid order id' }, 400)
    const order = await queryOne<any>(`
      SELECT co.id, co.po_number, co.po_date, co.status, co.remark, co.currency,
             co.delivery_date, co.delivery_address, co.person_in_charge, co.payment_terms,
             c.customer_name, c.customer_code
      FROM customer_orders co
      LEFT JOIN customers c ON c.id = co.customer_id AND c.deleted_at IS NULL
      WHERE co.id=? AND co.deleted_at IS NULL
    `, [orderId])
    if (!order) return c.json({ error: 'Not found' }, 404)

    const items = await query<any>(`
      SELECT ci.id, ci.bom_id, ci.qty, ci.unit_price, ci.remark,
             b.product_sku, b.product_name, b.spec, b.unit,
             COALESCE(b.company_price, b.supplier_price, 0) as standard_cost
      FROM customer_order_items ci
      LEFT JOIN bom b ON b.id = ci.bom_id
      WHERE ci.order_id=?
      ORDER BY ci.id ASC
    `, [orderId])

    const entries = await query<any>(`
      SELECT id, order_id, category, description, amount, remark, created_by, created_at, updated_at
      FROM order_profit_entries
      WHERE order_id=? AND deleted_at IS NULL
      ORDER BY created_at DESC, id DESC
    `, [orderId])

    let revenue = 0
    let cogs = 0
    const itemRows = items.map((item: any) => {
      const qty = toAmount(item.qty)
      const unit_price = toAmount(item.unit_price)
      const standard_cost = toAmount(item.standard_cost)
      const line_revenue = toAmount(qty * unit_price)
      const line_cost = toAmount(qty * standard_cost)
      revenue += line_revenue
      cogs += line_cost
      return { ...item, qty, unit_price, standard_cost, line_revenue, line_cost, line_gross: toAmount(line_revenue - line_cost) }
    })
    revenue = toAmount(revenue)
    cogs = toAmount(cogs)
    const gross_profit = toAmount(revenue - cogs)

    const entryTotals = { operating_cost: 0, sales_tax: 0, income_tax: 0, manual_adjustment: 0 }
    const normalizedEntries = entries.map((entry: any) => {
      const amount = toAmount(entry.amount)
      if (['operating_cost', 'logistics', 'platform_fee', 'other_cost'].includes(entry.category)) {
        entryTotals.operating_cost += amount
      } else if (entry.category === 'sales_tax') {
        entryTotals.sales_tax += amount
      } else if (entry.category === 'income_tax') {
        entryTotals.income_tax += amount
      } else if (entry.category === 'manual_adjustment') {
        entryTotals.manual_adjustment += amount
      }
      return { ...entry, amount }
    })

    entryTotals.operating_cost = toAmount(entryTotals.operating_cost)
    entryTotals.sales_tax = toAmount(entryTotals.sales_tax)
    entryTotals.income_tax = toAmount(entryTotals.income_tax)
    entryTotals.manual_adjustment = toAmount(entryTotals.manual_adjustment)

    const net_profit = toAmount(
      gross_profit
      - entryTotals.operating_cost
      - entryTotals.sales_tax
      - entryTotals.income_tax
      + entryTotals.manual_adjustment
    )

    return c.json({
      order,
      items: itemRows,
      entries: normalizedEntries,
      summary: {
        revenue,
        cogs,
        gross_profit,
        operating_cost: entryTotals.operating_cost,
        sales_tax: entryTotals.sales_tax,
        income_tax: entryTotals.income_tax,
        manual_adjustment: entryTotals.manual_adjustment,
        net_profit,
        net_margin: calcMargin(net_profit, revenue),
      },
    })
  } catch (e: any) { return c.json({ error: String(e.message) }, 500) }
})

app.get('/api/profit-tracking/config', authMiddleware, requireManager, async c => {
  try {
    await ensureCompanyProfitRatesColumns()
    const row = await queryOne<any>(`
      SELECT operating_cost_rate, vat_rate, cit_rate
      FROM company_settings
      WHERE id=1
    `)
    return c.json({
      operating_cost_rate: toRate(row?.operating_cost_rate),
      vat_rate: toRate(row?.vat_rate),
      cit_rate: toRate(row?.cit_rate),
    })
  } catch (e: any) { return c.json({ error: String(e.message) }, 500) }
})

app.put('/api/profit-tracking/config', authMiddleware, requireManager, async c => {
  try {
    await ensureCompanyProfitRatesColumns()
    const b = await c.req.json()
    const operating_cost_rate = toRate(b.operating_cost_rate)
    const vat_rate = toRate(b.vat_rate)
    const cit_rate = toRate(b.cit_rate)
    await execute(
      `INSERT INTO company_settings (id, operating_cost_rate, vat_rate, cit_rate)
       VALUES (1, ?, ?, ?)
       ON DUPLICATE KEY UPDATE operating_cost_rate=?, vat_rate=?, cit_rate=?`,
      [operating_cost_rate, vat_rate, cit_rate, operating_cost_rate, vat_rate, cit_rate]
    )
    await audit(c.get('user'), 'UPDATE', '利潤參數', 1, `op=${operating_cost_rate} vat=${vat_rate} cit=${cit_rate}`)
    return c.json({ ok: true, operating_cost_rate, vat_rate, cit_rate })
  } catch (e: any) { return c.json({ error: String(e.message) }, 500) }
})

app.post('/api/profit-tracking/orders/:id/apply-rates', authMiddleware, requireManager, async c => {
  try {
    await ensureProfitTrackingTable()
    await ensureCompanyProfitRatesColumns()
    const orderId = Number(c.req.param('id'))
    if (!Number.isFinite(orderId)) return c.json({ error: 'Invalid order id' }, 400)
    const order = await queryOne<any>('SELECT id, po_number FROM customer_orders WHERE id=? AND deleted_at IS NULL', [orderId])
    if (!order) return c.json({ error: 'Order not found' }, 404)

    const row = await queryOne<any>(`
      SELECT
        COALESCE(SUM(ci.qty * ci.unit_price), 0) as revenue,
        COALESCE(SUM(ci.qty * COALESCE(b.company_price, b.supplier_price, 0)), 0) as cogs
      FROM customer_order_items ci
      LEFT JOIN bom b ON b.id = ci.bom_id
      WHERE ci.order_id=?
    `, [orderId])
    const revenue = toAmount(row?.revenue)
    const cogs = toAmount(row?.cogs)
    const grossProfit = toAmount(revenue - cogs)
    const cfg = await queryOne<any>(`
      SELECT operating_cost_rate, vat_rate, cit_rate
      FROM company_settings
      WHERE id=1
    `)
    const operating_cost_rate = toRate(cfg?.operating_cost_rate)
    const vat_rate = toRate(cfg?.vat_rate)
    const cit_rate = toRate(cfg?.cit_rate)

    // Danny confirmed formula:
    // 1) taxes are calculated on gross profit
    // 2) operating cost is calculated on after-tax gross profit
    const salesTax = pctAmount(grossProfit, vat_rate)
    const incomeTax = pctAmount(grossProfit, cit_rate)
    const afterTaxGross = toAmount(grossProfit - salesTax - incomeTax)
    const operatingCost = pctAmount(afterTaxGross, operating_cost_rate)

    await execute(
      `UPDATE order_profit_entries
       SET deleted_at=?, deleted_by=?
       WHERE order_id=? AND category IN ('operating_cost','sales_tax','income_tax') AND description LIKE ? AND deleted_at IS NULL`,
      [now8(), c.get('user')?.userId || null, orderId, `${AUTO_RATE_PREFIX}%`]
    )

    const u = c.get('user')
    let inserted = 0
    const insertRow = async (category: string, amount: number, description: string) => {
      if (amount <= 0) return
      inserted += 1
      await execute(
        'INSERT INTO order_profit_entries (order_id,category,description,amount,remark,created_by,created_at) VALUES (?,?,?,?,?,?,?)',
        [orderId, category, description, amount, '', u.userId, now8()]
      )
    }
    await insertRow('operating_cost', operatingCost, `${AUTO_RATE_PREFIX}營運成本 (${operating_cost_rate}%)`)
    await insertRow('sales_tax', salesTax, `${AUTO_RATE_PREFIX}營業稅 (${vat_rate}%)`)
    await insertRow('income_tax', incomeTax, `${AUTO_RATE_PREFIX}所得稅 (${cit_rate}%)`)

    await audit(
      u,
      'UPDATE',
      '利潤追蹤',
      orderId,
      `${order.po_number} auto-rates revenue=${revenue} cogs=${cogs} gross=${grossProfit} after_tax_gross=${afterTaxGross} op=${operatingCost} vat=${salesTax} cit=${incomeTax}`
    )
    return c.json({
      ok: true,
      inserted,
      revenue,
      cogs,
      gross_profit: grossProfit,
      after_tax_gross: afterTaxGross,
      rates: { operating_cost_rate, vat_rate, cit_rate },
      amounts: { operating_cost: operatingCost, sales_tax: salesTax, income_tax: incomeTax },
    })
  } catch (e: any) { return c.json({ error: String(e.message) }, 500) }
})

app.post('/api/profit-tracking/orders/:id/entries', authMiddleware, requireManager, async c => {
  try {
    await ensureProfitTrackingTable()
    const orderId = Number(c.req.param('id'))
    if (!Number.isFinite(orderId)) return c.json({ error: 'Invalid order id' }, 400)
    const order = await queryOne<any>('SELECT id, po_number FROM customer_orders WHERE id=? AND deleted_at IS NULL', [orderId])
    if (!order) return c.json({ error: 'Order not found' }, 404)

    const b = await c.req.json()
    const category = String(b.category || '')
    if (!PROFIT_ENTRY_CATEGORIES.includes(category as any)) return c.json({ error: 'Invalid category' }, 400)
    const description = String(b.description || '').trim()
    if (!description) return c.json({ error: 'description required' }, 400)
    const amount = toAmount(b.amount)
    if (category !== 'manual_adjustment' && amount < 0) return c.json({ error: 'amount must be >= 0' }, 400)
    if (amount === 0) return c.json({ error: 'amount must not be 0' }, 400)

    const u = c.get('user')
    const r = await execute(
      'INSERT INTO order_profit_entries (order_id,category,description,amount,remark,created_by,created_at) VALUES (?,?,?,?,?,?,?)',
      [orderId, category, description, amount, String(b.remark || ''), u.userId, now8()]
    )
    await audit(u, 'CREATE', '利潤追蹤', r.insertId, `${order.po_number} / ${category} / ${amount}`)
    return c.json({ ok: true, id: r.insertId }, 201)
  } catch (e: any) { return c.json({ error: String(e.message) }, 500) }
})

app.delete('/api/profit-tracking/entries/:entryId', authMiddleware, requireManager, async c => {
  try {
    await ensureProfitTrackingTable()
    const entryId = Number(c.req.param('entryId'))
    if (!Number.isFinite(entryId)) return c.json({ error: 'Invalid entry id' }, 400)
    const row = await queryOne<any>(`
      SELECT ope.id, ope.order_id, ope.category, ope.amount, co.po_number
      FROM order_profit_entries ope
      LEFT JOIN customer_orders co ON co.id = ope.order_id
      WHERE ope.id=? AND ope.deleted_at IS NULL
    `, [entryId])
    if (!row) return c.json({ error: 'Not found' }, 404)
    await softDeleteById('order_profit_entries', entryId, c.get('user')?.userId)
    await audit(c.get('user'), 'DELETE', '利潤追蹤', entryId, `${row.po_number || row.order_id} / ${row.category} / ${row.amount}`)
    return c.json({ ok: true })
  } catch (e: any) { return c.json({ error: String(e.message) }, 500) }
})

// ── Quotations ────────────────────────────────────────────────────────────────
app.get('/api/quotations', authMiddleware, async c => c.json(await query(`
  SELECT q.*, c.customer_name, c.customer_code
  FROM quotations q LEFT JOIN customers c ON q.customer_id = c.id AND c.deleted_at IS NULL
  WHERE q.deleted_at IS NULL
  ORDER BY q.created_at DESC
`)))
app.get('/api/quotations/:id', authMiddleware, async c => {
  const q = await queryOne<any>(`
    SELECT q.*, c.customer_name, c.customer_code
    FROM quotations q LEFT JOIN customers c ON q.customer_id = c.id AND c.deleted_at IS NULL
    WHERE q.id=? AND q.deleted_at IS NULL`, [c.req.param('id')])
  if (!q) return c.json({ error: 'Not found' }, 404)
  const rawItems = await query<any>('SELECT * FROM quotation_items WHERE quotation_id=?', [c.req.param('id')])
  // Parse moq JSON into moq_tiers array
  const items = rawItems.map((item: any) => {
    let moq_tiers: {moq:number;price:number}[] = []
    if (item.moq) {
      try {
        const parsed = JSON.parse(String(item.moq))
        if (Array.isArray(parsed)) moq_tiers = parsed
      } catch { /* legacy number */ }
    }
    return { ...item, moq_tiers }
  })
  return c.json({ ...q, items })
})
app.post('/api/quotations', authMiddleware, requirePerm('customer_order.create'), async c => {
  try {
    const b = await c.req.json(); const u = c.get('user')
    const qNum = `QT${Date.now()}`
    const total = (b.items||[]).reduce((s: number, i: any) => s + (i.total_price||0), 0)
    const r = await execute('INSERT INTO quotations (quotation_number,customer_id,customer_name,status,total_amount,currency,valid_until,remark,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
      [qNum,b.customer_id||null,b.customer_name,'draft',total,b.currency||'VND',b.valid_until||null,b.remark||'',u.userId,now8()])
    const qId = r.insertId
    if (b.items?.length) {
      for (const item of b.items) {
        await execute('INSERT INTO quotation_items (quotation_id,item_name,material_code,spec,unit,qty,unit_price,total_price,remark,moq,image_url) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
          [qId,item.item_name,item.material_code||'',item.spec||'',item.unit||'PCS',item.qty,item.unit_price||0,(item.qty||0)*(item.unit_price||0),item.remark||'',item.moq||null,item.image_url||null])
      }
    }
    await audit(u, 'CREATE', '報價單', qId, `${qNum} / ${b.customer_name}`)
    return c.json({ id: qId, quotation_number: qNum }, 201)
  } catch (e: any) { return c.json({ error: String(e.message) }, 500) }
})
app.put('/api/quotations/:id', authMiddleware, requirePerm('customer_order.create'), async c => {
  try {
    const id = c.req.param('id'); const b = await c.req.json(); const u = c.get('user')
    const existing = await queryOne<any>('SELECT status FROM quotations WHERE id=? AND deleted_at IS NULL', [id])
    if (!existing) return c.json({ error: 'Not found' }, 404)
    if (existing.status !== 'draft') return c.json({ error: '只能編輯草稿狀態的報價單' }, 400)
    const total = (b.items||[]).reduce((s: number, i: any) => s + (i.total_price||0), 0)
    await execute('UPDATE quotations SET customer_id=?,customer_name=?,currency=?,valid_until=?,remark=?,total_amount=? WHERE id=?',
      [b.customer_id||null, b.customer_name, b.currency||'VND', b.valid_until||null, b.remark||'', total, id])
    await execute('DELETE FROM quotation_items WHERE quotation_id=?', [id])
    if (b.items?.length) {
      for (const item of b.items) {
        await execute('INSERT INTO quotation_items (quotation_id,item_name,material_code,spec,unit,qty,unit_price,total_price,remark,moq,image_url) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
          [id,item.item_name,item.material_code||'',item.spec||'',item.unit||'PCS',item.qty,item.unit_price||0,(item.qty||0)*(item.unit_price||0),item.remark||'',item.moq||null,item.image_url||null])
      }
    }
    await audit(u, 'UPDATE', '報價單', id, b.customer_name)
    return c.json({ ok: true })
  } catch (e: any) { return c.json({ error: String(e.message) }, 500) }
})
app.patch('/api/quotations/:id/status', authMiddleware, requirePerm('customer_order.create'), async c => {
  try {
    const id = c.req.param('id'); const { status } = await c.req.json()
    const validStatuses = ['sent', 'accepted', 'rejected']
    if (!validStatuses.includes(status)) return c.json({ error: 'Invalid status' }, 400)
    const row = await queryOne<any>('SELECT quotation_number,customer_name FROM quotations WHERE id=? AND deleted_at IS NULL', [id])
    if (!row) return c.json({ error: 'Not found' }, 404)
    await execute('UPDATE quotations SET status=? WHERE id=?', [status,id])
    await audit(c.get('user'), 'STATUS_CHANGE', '報價單', id, `${row?.quotation_number} → ${status}`)
    return c.json({ ok: true })
  } catch (e: any) { return c.json({ error: String(e.message) }, 500) }
})
app.delete('/api/quotations/:id', authMiddleware, requirePerm('customer_order.delete'), async c => {
  const id = c.req.param('id')
  const row = await queryOne<any>('SELECT quotation_number,customer_name FROM quotations WHERE id=? AND deleted_at IS NULL', [id])
  if (!row) return c.json({ error: 'Not found' }, 404)
  await softDeleteById('quotations', id, c.get('user')?.userId)
  await audit(c.get('user'), 'DELETE', '報價單', id, `${row?.quotation_number} / ${row?.customer_name}`)
  return c.json({ ok: true })
})

// ── Delivery Notes ────────────────────────────────────────────────────────────
app.get('/api/delivery-notes', authMiddleware, async c => c.json(await query(`
  SELECT dn.*, c.customer_name, c.customer_code,
         co.po_number as order_po_number
  FROM delivery_notes dn 
  LEFT JOIN customers c ON dn.customer_id = c.id AND c.deleted_at IS NULL
  LEFT JOIN customer_orders co ON dn.customer_order_id = co.id AND co.deleted_at IS NULL
  WHERE dn.deleted_at IS NULL
  ORDER BY dn.created_at DESC
`)))
app.get('/api/delivery-notes/:id', authMiddleware, async c => {
  const dn = await queryOne<any>(`
    SELECT dn.*, c.customer_name, c.customer_code, c.address,
           co.po_number as po_ref
    FROM delivery_notes dn 
    LEFT JOIN customers c ON dn.customer_id = c.id AND c.deleted_at IS NULL
    LEFT JOIN customer_orders co ON dn.customer_order_id = co.id AND co.deleted_at IS NULL
    WHERE dn.id=? AND dn.deleted_at IS NULL`, [c.req.param('id')])
  if (!dn) return c.json({ error: 'Not found' }, 404)
  const items = await query(`
    SELECT dni.*, 
           COALESCE(NULLIF(dni.spec,''), b.spec) as spec,
           COALESCE(NULLIF(dni.unit,''), b.unit, 'PCS') as unit
    FROM delivery_note_items dni
    LEFT JOIN (
      SELECT bom.id, bom.product_sku, bom.product_name, 
             COALESCE(bom.spec, GROUP_CONCAT(DISTINCT bi.spec SEPARATOR ', ')) as spec,
             COALESCE(bom.unit, MAX(bi.unit)) as unit
      FROM bom
      LEFT JOIN bom_items bi ON bom.id = bi.bom_id
      GROUP BY bom.id, bom.product_sku, bom.product_name
    ) b ON dni.material_code = b.product_sku
    WHERE dni.dn_id=?`, [c.req.param('id')])
  return c.json({ ...dn, items })
})
app.post('/api/delivery-notes', authMiddleware, requirePerm('delivery.create'), async c => {
  try {
    const b = await c.req.json(); const u = c.get('user')
    // Get customer name from customer_id if not provided
    let customerName = b.customer_name || ''
    if (!customerName && b.customer_id) {
      const cust = await queryOne<any>('SELECT customer_name FROM customers WHERE id=? AND deleted_at IS NULL', [b.customer_id])
      customerName = cust?.customer_name || ''
    }
    const dnNum = `DN${Date.now()}`
    const r = await execute('INSERT INTO delivery_notes (dn_number,customer_id,customer_name,customer_order_id,delivery_date,status,remark,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?)',
      [dnNum, b.customer_id||null, customerName, b.customer_order_id||null, b.delivery_date||null, 'draft', b.remark||'', u.userId, now8()])
    const dnId = r.insertId
    if (b.items?.length) {
      for (const item of b.items) {
        await execute('INSERT INTO delivery_note_items (dn_id,item_name,material_code,spec,unit,qty,remark,po_ref,thickness) VALUES (?,?,?,?,?,?,?,?,?)',
          [dnId, item.item_name||'', item.material_code||'', item.spec||'', item.unit||'PCS', item.qty||0, item.remark||'', item.po_ref||'', item.thickness||null])
      }
    }
    await audit(u, 'CREATE', '出貨單', dnId, `${dnNum} / ${customerName}`)
    return c.json({ id: dnId, dn_number: dnNum }, 201)
  } catch (e: any) { return c.json({ error: String(e.message) }, 500) }
})
app.put('/api/delivery-notes/:id', authMiddleware, requirePerm('delivery.create'), async c => {
  try {
    const id = c.req.param('id'); const b = await c.req.json(); const u = c.get('user')
    const existing = await queryOne<any>('SELECT status FROM delivery_notes WHERE id=? AND deleted_at IS NULL', [id])
    if (!existing) return c.json({ error: 'Not found' }, 404)
    if (existing.status !== 'draft') return c.json({ error: '只能編輯草稿狀態的出貨單' }, 400)
    await execute('UPDATE delivery_notes SET delivery_date=?,remark=? WHERE id=?',
      [b.delivery_date||null, b.remark||'', id])
    await execute('DELETE FROM delivery_note_items WHERE dn_id=?', [id])
    if (b.items?.length) {
      for (const item of b.items) {
        await execute('INSERT INTO delivery_note_items (dn_id,item_name,material_code,spec,unit,qty,remark,po_ref,thickness) VALUES (?,?,?,?,?,?,?,?,?)',
          [id, item.item_name||'', item.material_code||'', item.spec||'', item.unit||'PCS', item.qty||0, item.remark||'', item.po_ref||'', item.thickness||null])
      }
    }
    await audit(u, 'UPDATE', '出貨單', id, `id=${id}`)
    return c.json({ ok: true })
  } catch (e: any) { return c.json({ error: String(e.message) }, 500) }
})
app.patch('/api/delivery-notes/:id/status', authMiddleware, requirePerm('delivery.create'), async c => {
  try {
    const id = c.req.param('id'); const { status } = await c.req.json()
    const u = c.get('user')
    const row = await queryOne<any>('SELECT dn_number,customer_name,status as current_status FROM delivery_notes WHERE id=? AND deleted_at IS NULL', [id])
    if (!row) return c.json({ error: 'Not found' }, 404)
    if (row.current_status === 'shipped') return c.json({ error: '此出貨單已出貨，不可重複操作' }, 400)
    if (status === 'shipped' && row.current_status !== 'confirmed') return c.json({ error: '出貨前需先確認出貨單' }, 400)

    // When shipped: deduct stock from BOM
    if (status === 'shipped') {
      const items = await query<any>('SELECT * FROM delivery_note_items WHERE dn_id=?', [id])
      for (const item of items) {
        if (!item.material_code) continue
        const qty = parseFloat(item.qty) || 0
        const bom = await queryOne<any>('SELECT id, current_stock, product_name FROM bom WHERE product_sku=?', [item.material_code])
        const before = parseFloat(bom?.current_stock) || 0
        const after = Math.max(0, before - qty)
        if (bom) {
          await execute('UPDATE bom SET current_stock=? WHERE product_sku=?', [after, item.material_code])
        }
        await execute(
          'INSERT INTO stock_ledger (material_code,material_name,transaction_type,ref_type,ref_id,ref_number,qty_change,qty_before,qty_after,unit,remark,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
          [item.material_code, item.item_name || bom?.product_name || '', 'DN_OUT', 'delivery_note', id, row.dn_number, -qty, before, after, item.unit || 'PCS', `出貨 ${row.dn_number}`, u.userId, now8()]
        )
      }
    }

    await execute('UPDATE delivery_notes SET status=? WHERE id=?', [status, id])

    // When shipped: update linked customer order shipped qty and status
    if (status === 'shipped') {
      const dn = await queryOne<any>('SELECT customer_order_id FROM delivery_notes WHERE id=? AND deleted_at IS NULL', [id])
      if (dn?.customer_order_id) {
        const coId = dn.customer_order_id
        // Sum all shipped delivery note items for this customer order
        const shippedItems = await query<any>(`
          SELECT dni.material_code, SUM(dni.qty) as shipped_qty
          FROM delivery_note_items dni
          JOIN delivery_notes dn2 ON dni.dn_id = dn2.id
          WHERE dn2.customer_order_id = ? AND dn2.status = 'shipped' AND dn2.deleted_at IS NULL
          GROUP BY dni.material_code
        `, [coId])
        // Update arrived_qty on each customer_order_item
        for (const s of shippedItems) {
          await execute(`
            UPDATE customer_order_items ci
            JOIN bom b ON ci.bom_id = b.id
            SET ci.arrived_qty = ?, ci.balance = ci.qty - ?
            WHERE ci.order_id = ? AND b.product_sku = ?
          `, [s.shipped_qty, s.shipped_qty, coId, s.material_code])
        }
        // Check if all items fully shipped → mark completed, else partial
        const coItems = await query<any>('SELECT qty, arrived_qty FROM customer_order_items WHERE order_id=?', [coId])
        const allDone = coItems.every((ci: any) => Number(ci.arrived_qty) >= Number(ci.qty))
        const anyDone = coItems.some((ci: any) => Number(ci.arrived_qty) > 0)
        const newCoStatus = allDone ? 'completed' : anyDone ? 'partial' : 'pending'
        await execute('UPDATE customer_orders SET status=? WHERE id=?', [newCoStatus, coId])
        await audit(u, 'AUTO_UPDATE', '客戶訂單', coId, `出貨後自動更新狀態 → ${newCoStatus}`)
      }
    }

    await audit(u, 'STATUS_CHANGE', '出貨單', id, `${row.dn_number} → ${status}`)
    return c.json({ ok: true })
  } catch (e: any) { return c.json({ error: String(e.message) }, 500) }
})
app.delete('/api/delivery-notes/:id', authMiddleware, requirePerm('delivery.delete'), async c => {
  const id = c.req.param('id')
  const row = await queryOne<any>('SELECT dn_number,customer_name FROM delivery_notes WHERE id=? AND deleted_at IS NULL', [id])
  if (!row) return c.json({ error: 'Not found' }, 404)
  await softDeleteById('delivery_notes', id, c.get('user')?.userId)
  await audit(c.get('user'), 'DELETE', '出貨單', id, `${row?.dn_number} / ${row?.customer_name}`)
  return c.json({ ok: true })
})

// ── Delivery Sheets (送貨單) ────────────────────────────────────────────────
app.get('/api/delivery-sheets', authMiddleware, async c => c.json(await query(`
  SELECT ds.*, c.customer_name, c.customer_code,
         co.po_number as order_po_number
  FROM delivery_sheets ds
  LEFT JOIN customers c ON ds.customer_id = c.id AND c.deleted_at IS NULL
  LEFT JOIN customer_orders co ON ds.customer_order_id = co.id AND co.deleted_at IS NULL
  WHERE ds.deleted_at IS NULL
  ORDER BY ds.created_at DESC
`)))
app.get('/api/delivery-sheets/:id', authMiddleware, async c => {
  const ds = await queryOne<any>(`
    SELECT ds.*, c.customer_name, c.customer_code, c.address,
           co.po_number as po_ref
    FROM delivery_sheets ds
    LEFT JOIN customers c ON ds.customer_id = c.id AND c.deleted_at IS NULL
    LEFT JOIN customer_orders co ON ds.customer_order_id = co.id AND co.deleted_at IS NULL
    WHERE ds.id=? AND ds.deleted_at IS NULL`, [c.req.param('id')])
  if (!ds) return c.json({ error: 'Not found' }, 404)
  const items = await query(`
    SELECT dsi.*,
           COALESCE(NULLIF(dsi.spec,''), b.spec) as spec,
           COALESCE(NULLIF(dsi.unit,''), b.unit, 'PCS') as unit
    FROM delivery_sheet_items dsi
    LEFT JOIN (
      SELECT bom.id, bom.product_sku, bom.product_name,
             COALESCE(bom.spec, GROUP_CONCAT(DISTINCT bi.spec SEPARATOR ', ')) as spec,
             COALESCE(bom.unit, MAX(bi.unit)) as unit
      FROM bom
      LEFT JOIN bom_items bi ON bom.id = bi.bom_id
      GROUP BY bom.id, bom.product_sku, bom.product_name
    ) b ON dsi.material_code = b.product_sku
    WHERE dsi.ds_id=?`, [c.req.param('id')])
  return c.json({ ...ds, items })
})
app.post('/api/delivery-sheets', authMiddleware, requirePerm('delivery.create'), async c => {
  try {
    const b = await c.req.json(); const u = c.get('user')
    let customerName = b.customer_name || ''
    if (!customerName && b.customer_id) {
      const cust = await queryOne<any>('SELECT customer_name FROM customers WHERE id=? AND deleted_at IS NULL', [b.customer_id])
      customerName = cust?.customer_name || ''
    }
    const dsNum = `DS${Date.now()}`
    const r = await execute('INSERT INTO delivery_sheets (ds_number,customer_id,customer_name,customer_order_id,delivery_date,status,remark,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?)',
      [dsNum, b.customer_id||null, customerName, b.customer_order_id||null, b.delivery_date||null, 'draft', b.remark||'', u.userId, now8()])
    const dsId = r.insertId
    if (b.items?.length) {
      for (const item of b.items) {
        await execute('INSERT INTO delivery_sheet_items (ds_id,item_name,material_code,spec,unit,qty,remark,po_ref,thickness) VALUES (?,?,?,?,?,?,?,?,?)',
          [dsId, item.item_name||'', item.material_code||'', item.spec||'', item.unit||'PCS', item.qty||0, item.remark||'', item.po_ref||'', item.thickness||null])
      }
    }
    await audit(u, 'CREATE', '送貨單', dsId, `${dsNum} / ${customerName}`)
    return c.json({ id: dsId, ds_number: dsNum }, 201)
  } catch (e: any) { return c.json({ error: String(e.message) }, 500) }
})
app.put('/api/delivery-sheets/:id', authMiddleware, requirePerm('delivery.create'), async c => {
  try {
    const id = c.req.param('id'); const b = await c.req.json(); const u = c.get('user')
    const existing = await queryOne<any>('SELECT status FROM delivery_sheets WHERE id=? AND deleted_at IS NULL', [id])
    if (!existing) return c.json({ error: 'Not found' }, 404)
    if (existing.status !== 'draft') return c.json({ error: '只能編輯草稿狀態的送貨單' }, 400)
    await execute('UPDATE delivery_sheets SET delivery_date=?,remark=? WHERE id=?',
      [b.delivery_date||null, b.remark||'', id])
    await execute('DELETE FROM delivery_sheet_items WHERE ds_id=?', [id])
    if (b.items?.length) {
      for (const item of b.items) {
        await execute('INSERT INTO delivery_sheet_items (ds_id,item_name,material_code,spec,unit,qty,remark,po_ref,thickness) VALUES (?,?,?,?,?,?,?,?,?)',
          [id, item.item_name||'', item.material_code||'', item.spec||'', item.unit||'PCS', item.qty||0, item.remark||'', item.po_ref||'', item.thickness||null])
      }
    }
    await audit(u, 'UPDATE', '送貨單', id, `id=${id}`)
    return c.json({ ok: true })
  } catch (e: any) { return c.json({ error: String(e.message) }, 500) }
})
app.delete('/api/delivery-sheets/:id', authMiddleware, requirePerm('delivery.delete'), async c => {
  const id = c.req.param('id')
  const row = await queryOne<any>('SELECT ds_number,customer_name FROM delivery_sheets WHERE id=? AND deleted_at IS NULL', [id])
  if (!row) return c.json({ error: 'Not found' }, 404)
  await softDeleteById('delivery_sheets', id, c.get('user')?.userId)
  await audit(c.get('user'), 'DELETE', '送貨單', id, `${row?.ds_number} / ${row?.customer_name}`)
  return c.json({ ok: true })
})

// ── Inventory ─────────────────────────────────────────────────────────────────
// Real-time inventory from bom.current_stock
app.get('/api/inventory', authMiddleware, async c => c.json(await query(`
  SELECT b.id, b.product_sku as product_code, b.product_name,
         b.spec, b.unit, COALESCE(b.current_stock, 0) as closing_balance,
         b.category, s.name as supplier_name, b.currency, b.image_url
  FROM bom b
  LEFT JOIN suppliers s ON b.supplier_id = s.id AND s.deleted_at IS NULL
  WHERE b.deleted_at IS NULL
  ORDER BY b.category, b.product_sku
`)))

// BOM-based inventory: only show stock for items that exist in BOM
app.get('/api/inventory/bom', authMiddleware, async c => c.json(await query(`
  SELECT b.id, b.product_sku as product_code, b.product_name,
         b.spec, b.unit, b.category,
         COALESCE(b.current_stock, 0) as closing_balance,
         s.name as supplier_name, b.currency,
         b.image_url
  FROM bom b
  LEFT JOIN suppliers s ON b.supplier_id = s.id AND s.deleted_at IS NULL
  WHERE b.deleted_at IS NULL
  ORDER BY b.category, b.product_sku
`)))
app.post('/api/inventory', authMiddleware, requirePerm('stock.adjust'), async c => {
  try {
    const b = await c.req.json()
    const closing = (b.opening_balance||0)+(b.inbound_qty||0)-(b.outbound_qty||0)
    const r = await execute('INSERT INTO inventory (product_code,product_name,spec,unit,opening_balance,inbound_qty,outbound_qty,closing_balance,warehouse_location,remark) VALUES (?,?,?,?,?,?,?,?,?,?)',
      [b.product_code,b.product_name,b.spec||'',b.unit||'PCS',b.opening_balance||0,b.inbound_qty||0,b.outbound_qty||0,closing,b.warehouse_location||'',b.remark||''])
    await audit(c.get('user'), 'CREATE', '庫存', r.insertId, `${b.product_code} ${b.product_name}`)
    return c.json({ id: r.insertId }, 201)
  } catch (e: any) { return c.json({ error: String(e.message) }, 500) }
})
app.put('/api/inventory/:id', authMiddleware, requirePerm('stock.adjust'), async c => {
  try {
    const b = await c.req.json()
    const closing = (b.opening_balance||0)+(b.inbound_qty||0)-(b.outbound_qty||0)
    await execute('UPDATE inventory SET product_code=?,product_name=?,spec=?,unit=?,opening_balance=?,inbound_qty=?,outbound_qty=?,closing_balance=?,warehouse_location=?,remark=? WHERE id=?',
      [b.product_code,b.product_name,b.spec||'',b.unit||'PCS',b.opening_balance||0,b.inbound_qty||0,b.outbound_qty||0,closing,b.warehouse_location||'',b.remark||'',c.req.param('id')])
    await audit(c.get('user'), 'UPDATE', '庫存', c.req.param('id'), `${b.product_code} ${b.product_name}`)
    return c.json({ ok: true })
  } catch (e: any) { return c.json({ error: String(e.message) }, 500) }
})
app.delete('/api/inventory/:id', authMiddleware, requirePerm('stock.adjust'), async c => {
  const id = c.req.param('id')
  const row = await queryOne<any>('SELECT product_code,product_name FROM inventory WHERE id=? AND deleted_at IS NULL', [id])
  if (!row) return c.json({ error: 'Not found' }, 404)
  await softDeleteById('inventory', id, c.get('user')?.userId)
  await audit(c.get('user'), 'DELETE', '庫存', id, `${row?.product_code} ${row?.product_name}`)
  return c.json({ ok: true })
})

// ── Users ─────────────────────────────────────────────────────────────────────
app.get('/api/users', authMiddleware, requirePerm('user.manage'), async c => {
  return c.json(await query(`
    SELECT id,email,name,
           CASE WHEN role IN ('manager','admin') THEN 'manager' ELSE 'employee' END as role,
           created_at
    FROM users
    WHERE deleted_at IS NULL
    ORDER BY created_at DESC
  `))
})
app.post('/api/users', authMiddleware, requirePerm('user.manage'), async c => {
  try {
    const u = c.get('user')
    const { email, password, name, role } = await c.req.json()
    if (!email || !password || !name) return c.json({ error: 'Missing fields' }, 400)
    const safeRole = role === 'manager' ? 'manager' : 'employee'
    const existing = await queryOne('SELECT id FROM users WHERE email=? AND deleted_at IS NULL', [email])
    if (existing) return c.json({ error: 'Email already exists' }, 409)
    const r = await execute('INSERT INTO users (email,password_hash,name,role) VALUES (?,?,?,?)', [email,hashPw(password),name,safeRole])
    await audit(u, 'CREATE', '使用者', r.insertId, `${email} (${safeRole})`)
    return c.json({ id: r.insertId, email, name, role: safeRole }, 201)
  } catch (e: any) { return c.json({ error: String(e.message) }, 500) }
})
app.put('/api/users/:id', authMiddleware, requirePerm('user.manage'), async c => {
  try {
    const u = c.get('user'); const id = c.req.param('id')
    const { name, role, password } = await c.req.json()
    const target = await queryOne<any>('SELECT role FROM users WHERE id=? AND deleted_at IS NULL', [id])
    if (!target) return c.json({ error: 'User not found' }, 404)
    const safeRole = role === 'manager' ? 'manager' : 'employee'
    if (password) {
      await execute('UPDATE users SET name=?,role=?,password_hash=? WHERE id=?', [name,safeRole,hashPw(password),id])
    } else {
      await execute('UPDATE users SET name=?,role=? WHERE id=?', [name,safeRole,id])
    }
    await audit(u, 'UPDATE', '使用者', id, `${name} → ${safeRole}`)
    return c.json({ ok: true })
  } catch (e: any) { return c.json({ error: String(e.message) }, 500) }
})
app.delete('/api/users/:id', authMiddleware, requirePerm('user.manage'), async c => {
  try {
    const u = c.get('user'); const id = c.req.param('id')
    if (String(u.userId) === id) return c.json({ error: 'Cannot delete yourself' }, 400)
    const target = await queryOne<any>('SELECT email,name,role FROM users WHERE id=? AND deleted_at IS NULL', [id])
    if (!target) return c.json({ error: 'User not found' }, 404)
    await softDeleteById('users', id, u.userId)
    await audit(u, 'DELETE', '使用者', id, `${target.email} (${target.name})`)
    return c.json({ ok: true })
  } catch (e: any) { return c.json({ error: String(e.message) }, 500) }
})

// ── Role Permissions ──────────────────────────────────────────────────────────
app.get('/api/role-permissions', authMiddleware, async c => {
  try {
    const rows = await query<any>('SELECT role,permission,allowed FROM role_permissions')
    const map: any = {}
    rows.forEach(r => { if (!map[r.role]) map[r.role] = {}; map[r.role][r.permission] = r.allowed === 1 })
    return c.json({ permissions: map, allPermissions: ALL_PERMISSIONS })
  } catch (e: any) { return c.json({ error: String(e.message) }, 500) }
})
app.put('/api/role-permissions', authMiddleware, requirePerm('user.manage'), async c => {
  try {
    const { role, permission, allowed } = await c.req.json()
    if (role !== 'employee') return c.json({ error: 'Only employee role can be modified' }, 400)
    await execute('INSERT INTO role_permissions (role,permission,allowed) VALUES (?,?,?) ON DUPLICATE KEY UPDATE allowed=?', ['employee',permission,allowed?1:0,allowed?1:0])
    return c.json({ ok: true })
  } catch (e: any) { return c.json({ error: String(e.message) }, 500) }
})

// ── Audit Logs ────────────────────────────────────────────────────────────────
app.get('/api/audit-logs', authMiddleware, requirePerm('audit.view'), async c => {
  try {
    const url = new URL(c.req.url)
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '100'), 500)
    const offset = parseInt(url.searchParams.get('offset') || '0')
    const resource = url.searchParams.get('resource') || ''
    const user_email = url.searchParams.get('user_email') || ''
    const params: any[] = []
    const where: string[] = []
    if (resource) { where.push('resource=?'); params.push(resource) }
    if (user_email) { where.push('user_email LIKE ?'); params.push(`%${user_email}%`) }
    const whereClause = where.length ? ' WHERE ' + where.join(' AND ') : ''
    // Embed LIMIT/OFFSET directly to avoid mysql2 prepared statement issues
    const sql = `SELECT * FROM audit_logs${whereClause} ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`
    const countSql = `SELECT COUNT(*) as cnt FROM audit_logs${whereClause}`
    const [logs, totalRow] = await Promise.all([
      query(sql, params),
      queryOne<any>(countSql, params)
    ])
    return c.json({ logs, total: totalRow?.cnt || 0 })
  } catch (e: any) { return c.json({ error: String(e.message) }, 500) }
})

// ── 應收帳款 (Receivables) ────────────────────────────────────────────────────
// 來源：客戶訂單（所有狀態）→ 待收款；可標記已收款
app.get('/api/receivables', authMiddleware, async c => {
  try {
    const rows = await query<any>(`
      SELECT co.id, co.po_number as dn_number, co.customer_name,
             co.po_date as delivery_date, co.status, co.remark, co.created_at,
             COALESCE(co.received_amount, 0) as received_amount,
             COALESCE(
               (SELECT SUM(qty * unit_price) FROM customer_order_items WHERE order_id = co.id), 0
             ) as invoice_amount,
             co.payment_status, co.payment_date, co.payment_note,
             co.po_number as customer_po
      FROM customer_orders co
      WHERE co.deleted_at IS NULL
      ORDER BY co.created_at DESC
    `)
    return c.json(rows)
  } catch (e: any) { return c.json({ error: String(e.message) }, 500) }
})
app.patch('/api/receivables/:id/payment', authMiddleware, async c => {
  try {
    const id = c.req.param('id')
    const { payment_status, received_amount, payment_date, payment_note } = await c.req.json()
    await execute(
      'UPDATE customer_orders SET payment_status=?, received_amount=?, payment_date=?, payment_note=? WHERE id=?',
      [payment_status, received_amount||0, payment_date||null, payment_note||'', id]
    )
    const row = await queryOne<any>('SELECT po_number, customer_name FROM customer_orders WHERE id=? AND deleted_at IS NULL', [id])
    await audit(c.get('user'), 'PAYMENT', '應收帳款', id, `${row?.po_number} ${payment_status}`)
    return c.json({ ok: true })
  } catch (e: any) { return c.json({ error: String(e.message) }, 500) }
})

// ── 應付帳款 (Payables) ───────────────────────────────────────────────────────
// 來源：採購單（所有非草稿狀態）→ 待付款；可標記已付款
app.get('/api/payables', authMiddleware, async c => {
  try {
    const rows = await query<any>(`
      SELECT id, po_number, supplier_name, total_amount, currency, status,
             COALESCE(paid_amount, 0) as paid_amount,
             payment_status, payment_date, payment_note, created_at, approved_at
      FROM purchase_orders
      WHERE status != 'cancelled' AND deleted_at IS NULL
      ORDER BY created_at DESC
    `)
    return c.json(rows)
  } catch (e: any) { return c.json({ error: String(e.message) }, 500) }
})
app.patch('/api/payables/:id/payment', authMiddleware, async c => {
  try {
    const id = c.req.param('id')
    const { payment_status, paid_amount, payment_date, payment_note } = await c.req.json()
    await execute(
      'UPDATE purchase_orders SET payment_status=?, paid_amount=?, payment_date=?, payment_note=? WHERE id=?',
      [payment_status, paid_amount||0, payment_date||null, payment_note||'', id]
    )
    const row = await queryOne<any>('SELECT po_number, supplier_name FROM purchase_orders WHERE id=? AND deleted_at IS NULL', [id])
    await audit(c.get('user'), 'PAYMENT', '應付帳款', id, `${row?.po_number} ${payment_status}`)
    return c.json({ ok: true })
  } catch (e: any) { return c.json({ error: String(e.message) }, 500) }
})

// ── 報表 (Reports) ────────────────────────────────────────────────────────────
app.get('/api/reports', authMiddleware, async c => {
  try {
    const url = new URL(c.req.url)
    const year = url.searchParams.get('year') || new Date().getFullYear().toString()

    // 應收：客戶訂單金額，按月（用 po_date 或 created_at）
    const receivables = await query<any>(`
      SELECT DATE_FORMAT(COALESCE(co.po_date, co.created_at), '%Y-%m') as month,
             SUM(COALESCE(ci.qty * ci.unit_price, 0)) as invoiced,
             SUM(CASE WHEN co.payment_status='paid' THEN COALESCE(co.received_amount, 0) ELSE 0 END) as received,
             COUNT(DISTINCT co.id) as count
      FROM customer_orders co
      LEFT JOIN customer_order_items ci ON ci.order_id = co.id
      WHERE DATE_FORMAT(COALESCE(co.po_date, co.created_at), '%Y') = ? AND co.deleted_at IS NULL
      GROUP BY month ORDER BY month
    `, [year])

    // 應付：採購單金額，按月
    const payables = await query<any>(`
      SELECT DATE_FORMAT(created_at, '%Y-%m') as month,
             SUM(total_amount) as total,
             SUM(CASE WHEN payment_status='paid' THEN COALESCE(paid_amount, 0) ELSE 0 END) as paid,
             COUNT(*) as count
      FROM purchase_orders
      WHERE status != 'cancelled' AND deleted_at IS NULL AND DATE_FORMAT(created_at, '%Y') = ?
      GROUP BY month ORDER BY month
    `, [year])

    // 匯總
    const summary = await queryOne<any>(`
      SELECT
        (SELECT COALESCE(SUM(ci.qty * ci.unit_price), 0) FROM customer_orders co LEFT JOIN customer_order_items ci ON ci.order_id = co.id WHERE co.deleted_at IS NULL) as total_invoiced,
        (SELECT COALESCE(SUM(received_amount), 0) FROM customer_orders WHERE payment_status='paid' AND deleted_at IS NULL) as total_received,
        (SELECT COALESCE(SUM(ci.qty * ci.unit_price), 0) FROM customer_orders co LEFT JOIN customer_order_items ci ON ci.order_id = co.id WHERE co.deleted_at IS NULL AND (co.payment_status IS NULL OR co.payment_status != 'paid')) as total_outstanding_receivable,
        (SELECT COALESCE(SUM(total_amount), 0) FROM purchase_orders WHERE status != 'cancelled' AND deleted_at IS NULL) as total_payable,
        (SELECT COALESCE(SUM(paid_amount), 0) FROM purchase_orders WHERE payment_status='paid' AND deleted_at IS NULL) as total_paid,
        (SELECT COALESCE(SUM(total_amount), 0) FROM purchase_orders WHERE status != 'cancelled' AND deleted_at IS NULL AND (payment_status IS NULL OR payment_status != 'paid')) as total_outstanding_payable
    `)

    return c.json({ receivables, payables, summary, year })
  } catch (e: any) { return c.json({ error: String(e.message) }, 500) }
})

// ── Goods Receipts (進貨單) ───────────────────────────────────────────────────
app.get('/api/goods-receipts', authMiddleware, async c => {
  const rows = await query(`
    SELECT gr.*, s.name as supplier_name, s.supplier_code
    FROM goods_receipts gr LEFT JOIN suppliers s ON gr.supplier_id = s.id AND s.deleted_at IS NULL
    WHERE gr.deleted_at IS NULL
    ORDER BY gr.created_at DESC`)
  return c.json(rows)
})
app.get('/api/goods-receipts/:id', authMiddleware, async c => {
  const gr = await queryOne<any>(`
    SELECT gr.*, s.name as supplier_name
    FROM goods_receipts gr LEFT JOIN suppliers s ON gr.supplier_id = s.id AND s.deleted_at IS NULL
    WHERE gr.id=? AND gr.deleted_at IS NULL`, [c.req.param('id')])
  if (!gr) return c.json({ error: 'Not found' }, 404)
  const items = await query(`
    SELECT gri.*, b.product_name as material_name, b.spec, b.unit
    FROM goods_receipt_items gri LEFT JOIN bom b ON gri.material_code = b.product_sku
    WHERE gri.gr_id=?`, [c.req.param('id')])
  return c.json({ ...gr, items })
})
app.post('/api/goods-receipts', authMiddleware, requirePerm('po.create'), async c => {
  try {
    const b = await c.req.json(); const u = c.get('user')
    const grNum = `GR${Date.now()}`
    const r = await execute(
      'INSERT INTO goods_receipts (gr_number,po_id,po_number,supplier_id,supplier_name,status,received_date,remark,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
      [grNum,b.po_id||null,b.po_number||'',b.supplier_id||null,b.supplier_name,'draft',b.received_date||null,b.remark||'',u.userId,now8()]
    )
    const grId = r.insertId
    if (b.items?.length) {
      for (const item of b.items) {
        await execute(
          'INSERT INTO goods_receipt_items (gr_id,po_item_id,material_code,material_name,spec,unit,ordered_qty,received_qty,unit_price,currency,batch_no,remark) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
          [grId,item.po_item_id||null,item.material_code,item.material_name,item.spec||'',item.unit||'PCS',item.ordered_qty||0,item.received_qty,item.unit_price||0,item.currency||'VND',item.batch_no||'',item.remark||'']
        )
      }
    }
    await audit(u, 'CREATE', '進貨單', grId, grNum)
    return c.json({ id: grId, gr_number: grNum }, 201)
  } catch (e: any) { return c.json({ error: String(e.message) }, 500) }
})
app.patch('/api/goods-receipts/:id/confirm', authMiddleware, requirePerm('po.approve'), async c => {
  try {
    const id = c.req.param('id'); const u = c.get('user')
    const gr = await queryOne<any>('SELECT * FROM goods_receipts WHERE id=? AND deleted_at IS NULL', [id])
    if (!gr) return c.json({ error: 'Not found' }, 404)
    if (gr.status === 'confirmed') return c.json({ error: 'Already confirmed' }, 400)
    const items = await query<any>('SELECT * FROM goods_receipt_items WHERE gr_id=?', [id])
    // Update stock for each item
    for (const item of items) {
      const bom = await queryOne<any>('SELECT id, current_stock FROM bom WHERE product_sku=?', [item.material_code])
      const before = parseFloat(bom?.current_stock) || 0
      const after = before + parseFloat(item.received_qty)
      if (bom) {
        await execute('UPDATE bom SET current_stock=? WHERE product_sku=?', [after, item.material_code])
      }
      // Write stock ledger
      await execute(
        'INSERT INTO stock_ledger (material_code,material_name,transaction_type,ref_type,ref_id,ref_number,qty_change,qty_before,qty_after,unit,batch_no,remark,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        [item.material_code,item.material_name,'GR_IN','goods_receipt',id,gr.gr_number,item.received_qty,before,after,item.unit||'PCS',item.batch_no||'',`進貨確認 ${gr.gr_number}`,u.userId,now8()]
      )
      // Update po_item received_qty if linked
      if (item.po_item_id) {
        await execute('UPDATE po_items SET received_qty = received_qty + ? WHERE id=?', [item.received_qty, item.po_item_id])
      }
    }
    await execute('UPDATE goods_receipts SET status=? WHERE id=?', ['confirmed', id])
    await audit(u, 'CONFIRM', '進貨單', id, gr.gr_number)
    return c.json({ ok: true })
  } catch (e: any) { return c.json({ error: String(e.message) }, 500) }
})
app.delete('/api/goods-receipts/:id', authMiddleware, requirePerm('po.delete'), async c => {
  const id = c.req.param('id')
  const row = await queryOne<any>('SELECT gr_number,status FROM goods_receipts WHERE id=? AND deleted_at IS NULL', [id])
  if (!row) return c.json({ error: 'Not found' }, 404)
  await softDeleteById('goods_receipts', id, c.get('user')?.userId)
  await audit(c.get('user'), 'DELETE', '進貨單', id, row?.gr_number)
  return c.json({ ok: true })
})

// ── Production Orders (生產單) ────────────────────────────────────────────────
app.get('/api/production', authMiddleware, async c => {
  const rows = await query('SELECT * FROM production_orders WHERE deleted_at IS NULL ORDER BY created_at DESC')
  return c.json(rows)
})
// 庫存檢查：傳入 bom_id + planned_qty，返回每個材料的庫存狀況
app.post('/api/production/check-stock', authMiddleware, async c => {
  try {
    const { bom_id, planned_qty } = await c.req.json()
    if (!bom_id) return c.json({ error: 'bom_id required' }, 400)
    const qty = planned_qty || 1
    const bomItems = await query<any>('SELECT * FROM bom_items WHERE bom_id=?', [bom_id])
    const result = []
    let hasShortage = false
    for (const item of bomItems) {
      const needed = (item.quantity || 0) * qty
      const bom = await queryOne<any>('SELECT current_stock, product_name FROM bom WHERE product_sku=?', [item.material_code])
      const stock = parseFloat(bom?.current_stock) || 0
      const shortage = Math.max(0, needed - stock)
      if (shortage > 0) hasShortage = true
      result.push({
        material_code: item.material_code,
        material_name: item.material_name || bom?.product_name || '',
        spec: item.spec || '',
        unit: item.unit || 'PCS',
        planned_qty: needed,
        current_stock: stock,
        shortage,
        sufficient: shortage === 0,
      })
    }
    return c.json({ items: result, has_shortage: hasShortage, status: hasShortage ? 'shortage' : 'ready' })
  } catch (e: any) { return c.json({ error: String(e.message) }, 500) }
})
app.get('/api/production/:id', authMiddleware, async c => {
  const prod = await queryOne<any>('SELECT * FROM production_orders WHERE id=? AND deleted_at IS NULL', [c.req.param('id')])
  if (!prod) return c.json({ error: 'Not found' }, 404)
  const materials = await query('SELECT * FROM production_materials WHERE prod_id=?', [c.req.param('id')])
  return c.json({ ...prod, materials })
})
app.post('/api/production', authMiddleware, requirePerm('production.create'), async c => {
  try {
    const b = await c.req.json(); const u = c.get('user')
    const prodNum = `WO${Date.now()}`
    const r = await execute(
      'INSERT INTO production_orders (prod_number,customer_order_id,bom_id,product_sku,product_name,planned_qty,status,planned_start,planned_end,remark,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
      [prodNum,b.customer_order_id||null,b.bom_id||null,b.product_sku||'',b.product_name,b.planned_qty,b.initial_status||'draft',b.planned_start||null,b.planned_end||null,b.remark||'',u.userId,now8()]
    )
    const prodId = r.insertId
    if (b.materials?.length) {
      for (const mat of b.materials) {
        await execute(
          'INSERT INTO production_materials (prod_id,material_code,material_name,spec,unit,planned_qty,issued_qty,batch_no,remark) VALUES (?,?,?,?,?,?,?,?,?)',
          [prodId,mat.material_code,mat.material_name,mat.spec||'',mat.unit||'PCS',mat.planned_qty||0,0,mat.batch_no||'',mat.remark||'']
        )
      }
    }
    await audit(u, 'CREATE', '生產單', prodId, prodNum)
    return c.json({ id: prodId, prod_number: prodNum }, 201)
  } catch (e: any) { return c.json({ error: String(e.message) }, 500) }
})
app.put('/api/production/:id', authMiddleware, requirePerm('production.create'), async c => {
  try {
    const id = c.req.param('id'); const b = await c.req.json(); const u = c.get('user')
    const existing = await queryOne<any>('SELECT status FROM production_orders WHERE id=? AND deleted_at IS NULL', [id])
    if (!existing) return c.json({ error: 'Not found' }, 404)
    if (!['draft', 'confirmed', 'shortage'].includes(existing.status)) return c.json({ error: '此狀態的生產單不能修改' }, 400)
    await execute('UPDATE production_orders SET bom_id=?,product_sku=?,product_name=?,planned_qty=?,planned_start=?,planned_end=?,remark=? WHERE id=?',
      [b.bom_id||null, b.product_sku||'', b.product_name, b.planned_qty, b.planned_start||null, b.planned_end||null, b.remark||'', id])
    if (b.materials?.length) {
      await execute('DELETE FROM production_materials WHERE prod_id=?', [id])
      for (const mat of b.materials) {
        await execute('INSERT INTO production_materials (prod_id,material_code,material_name,spec,unit,planned_qty,issued_qty,batch_no,remark) VALUES (?,?,?,?,?,?,?,?,?)',
          [id,mat.material_code,mat.material_name,mat.spec||'',mat.unit||'PCS',mat.planned_qty||0,0,mat.batch_no||'',mat.remark||''])
      }
    }
    await audit(u, 'UPDATE', '生產單', id, b.product_name)
    return c.json({ ok: true })
  } catch (e: any) { return c.json({ error: String(e.message) }, 500) }
})
app.patch('/api/production/:id/status', authMiddleware, requirePerm('production.create'), async c => {
  try {
    const id = c.req.param('id'); const { status, produced_qty } = await c.req.json(); const u = c.get('user')
    const validStatuses = ['confirmed', 'shortage', 'ready', 'in_progress', 'completed', 'cancelled']
    if (!validStatuses.includes(status)) return c.json({ error: 'Invalid status' }, 400)
    const prod = await queryOne<any>('SELECT * FROM production_orders WHERE id=? AND deleted_at IS NULL', [id])
    if (!prod) return c.json({ error: 'Not found' }, 404)
    if (prod.status === 'completed') return c.json({ error: '已完工的生產單不能再變更狀態' }, 400)
    const updates: any = { status }
    if (status === 'in_progress' && !prod.actual_start) updates.actual_start = now8().slice(0,10)
    if (status === 'completed') {
      updates.actual_end = now8().slice(0,10)
      if (produced_qty) updates.produced_qty = produced_qty
      // Issue materials from stock only on completion
      const mats = await query<any>('SELECT * FROM production_materials WHERE prod_id=?', [id])
      for (const mat of mats) {
        const qty = parseFloat(mat.issued_qty) > 0 ? parseFloat(mat.issued_qty) : parseFloat(mat.planned_qty) || 0
        const bom = await queryOne<any>('SELECT current_stock FROM bom WHERE product_sku=?', [mat.material_code])
        const before = parseFloat(bom?.current_stock) || 0
        const after = Math.max(0, before - qty)
        await execute('UPDATE bom SET current_stock=? WHERE product_sku=?', [after, mat.material_code])
        await execute('UPDATE production_materials SET issued_qty=? WHERE id=?', [qty, mat.id])
        await execute(
          'INSERT INTO stock_ledger (material_code,material_name,transaction_type,ref_type,ref_id,ref_number,qty_change,qty_before,qty_after,unit,remark,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
          [mat.material_code,mat.material_name,'PROD_OUT','production',id,prod.prod_number,-qty,before,after,mat.unit||'PCS',`生產領料 ${prod.prod_number}`,u.userId,now8()]
        )
      }
    }
    const setClause = Object.keys(updates).map(k => `${k}=?`).join(',')
    await execute(`UPDATE production_orders SET ${setClause} WHERE id=?`, [...Object.values(updates), id])
    await audit(u, 'STATUS_CHANGE', '生產單', id, `${prod.prod_number} → ${status}`)
    return c.json({ ok: true })
  } catch (e: any) { return c.json({ error: String(e.message) }, 500) }
})
app.delete('/api/production/:id', authMiddleware, requirePerm('production.delete'), async c => {
  const id = c.req.param('id')
  const row = await queryOne<any>('SELECT prod_number,status FROM production_orders WHERE id=? AND deleted_at IS NULL', [id])
  if (!row) return c.json({ error: 'Not found' }, 404)
  await softDeleteById('production_orders', id, c.get('user')?.userId)
  await audit(c.get('user'), 'DELETE', '生產單', id, row?.prod_number)
  return c.json({ ok: true })
})

// ── Stock Ledger (庫存流水) ───────────────────────────────────────────────────
app.get('/api/stock-ledger', authMiddleware, async c => {
  const url = new URL(c.req.url)
  const materialCode = url.searchParams.get('material_code') || ''
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '200'), 500)
  let sql = 'SELECT * FROM stock_ledger'
  const params: any[] = []
  if (materialCode) { sql += ' WHERE material_code=?'; params.push(materialCode) }
  sql += ` ORDER BY created_at DESC LIMIT ${limit}`
  const rows = await query(sql, params.length ? params : undefined)
  return c.json(rows)
})

// ── Stock Adjustments (庫存調整) ──────────────────────────────────────────────
app.get('/api/stock-adjustments', authMiddleware, async c => {
  const rows = await query('SELECT * FROM stock_adjustments WHERE deleted_at IS NULL ORDER BY created_at DESC')
  return c.json(rows)
})
app.get('/api/stock-adjustments/:id', authMiddleware, async c => {
  const adj = await queryOne<any>('SELECT * FROM stock_adjustments WHERE id=? AND deleted_at IS NULL', [c.req.param('id')])
  if (!adj) return c.json({ error: 'Not found' }, 404)
  const items = await query('SELECT * FROM stock_adjustment_items WHERE adj_id=?', [c.req.param('id')])
  return c.json({ ...adj, items })
})
app.post('/api/stock-adjustments', authMiddleware, requirePerm('stock.adjust'), async c => {
  try {
    const b = await c.req.json(); const u = c.get('user')
    const adjNum = `ADJ${Date.now()}`
    const r = await execute(
      'INSERT INTO stock_adjustments (adj_number,adj_type,status,adj_date,remark,created_by,created_at) VALUES (?,?,?,?,?,?,?)',
      [adjNum,b.adj_type||'count','draft',b.adj_date||null,b.remark||'',u.userId,now8()]
    )
    const adjId = r.insertId
    if (b.items?.length) {
      for (const item of b.items) {
        const bom = await queryOne<any>('SELECT current_stock FROM bom WHERE product_sku=?', [item.material_code])
        const systemQty = parseFloat(bom?.current_stock) || 0
        const diff = (item.actual_qty || 0) - systemQty
        await execute(
          'INSERT INTO stock_adjustment_items (adj_id,material_code,material_name,unit,system_qty,actual_qty,diff_qty,batch_no,remark) VALUES (?,?,?,?,?,?,?,?,?)',
          [adjId,item.material_code,item.material_name||'',item.unit||'PCS',systemQty,item.actual_qty||0,diff,item.batch_no||'',item.remark||'']
        )
      }
    }
    await audit(u, 'CREATE', '庫存調整', adjId, adjNum)
    return c.json({ id: adjId, adj_number: adjNum }, 201)
  } catch (e: any) { return c.json({ error: String(e.message) }, 500) }
})
app.patch('/api/stock-adjustments/:id/approve', authMiddleware, requirePerm('stock.adjust'), async c => {
  try {
    const id = c.req.param('id'); const u = c.get('user')
    const adj = await queryOne<any>('SELECT * FROM stock_adjustments WHERE id=? AND deleted_at IS NULL', [id])
    if (!adj) return c.json({ error: 'Not found' }, 404)
    if (adj.status === 'approved') return c.json({ error: 'Already approved' }, 400)
    const items = await query<any>('SELECT * FROM stock_adjustment_items WHERE adj_id=?', [id])
    for (const item of items) {
      if (item.diff_qty === 0) continue
      const bom = await queryOne<any>('SELECT current_stock FROM bom WHERE product_sku=?', [item.material_code])
      const before = parseFloat(bom?.current_stock) || 0
      const after = item.actual_qty
      await execute('UPDATE bom SET current_stock=? WHERE product_sku=?', [after, item.material_code])
      const txType = item.diff_qty > 0 ? 'ADJ_IN' : 'ADJ_OUT'
      await execute(
        'INSERT INTO stock_ledger (material_code,material_name,transaction_type,ref_type,ref_id,ref_number,qty_change,qty_before,qty_after,unit,remark,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
        [item.material_code,item.material_name,txType,'adjustment',id,adj.adj_number,item.diff_qty,before,after,item.unit||'PCS',`庫存調整 ${adj.adj_number}`,u.userId,now8()]
      )
    }
    await execute('UPDATE stock_adjustments SET status=?,approved_by=?,approved_at=? WHERE id=?', ['approved',u.userId,now8(),id])
    await audit(u, 'APPROVE', '庫存調整', id, adj.adj_number)
    return c.json({ ok: true })
  } catch (e: any) { return c.json({ error: String(e.message) }, 500) }
})
app.delete('/api/stock-adjustments/:id', authMiddleware, requirePerm('stock.adjust'), async c => {
  const id = c.req.param('id')
  const row = await queryOne<any>('SELECT adj_number,status FROM stock_adjustments WHERE id=? AND deleted_at IS NULL', [id])
  if (!row) return c.json({ error: 'Not found' }, 404)
  await softDeleteById('stock_adjustments', id, c.get('user')?.userId)
  await audit(c.get('user'), 'DELETE', '庫存調整', id, row?.adj_number)
  return c.json({ ok: true })
})

// ── Company Settings ──────────────────────────────────────────────────────────
app.get('/api/company', authMiddleware, async c => {
  try {
    const row = await queryOne<any>('SELECT * FROM company_settings WHERE id=1')
    if (!row) {
      // Return defaults if not set
      return c.json({ id: 1, company_name: 'FAN YONG CO., LTD', company_name_local: 'CÔNG TY TNHH FAN YONG VIỆT NAM', address: '', phone: '', contact_person: '', email: '', tax_id: '', logo_url: null })
    }
    return c.json(row)
  } catch (e: any) { return c.json({ error: String(e.message) }, 500) }
})
app.put('/api/company', authMiddleware, requirePerm('company.manage'), async c => {
  try {
    const b = await c.req.json(); const u = c.get('user')
    // Upsert
    await execute(`INSERT INTO company_settings (id,company_name,company_name_local,address,phone,contact_person,email,tax_id,logo_url)
      VALUES (1,?,?,?,?,?,?,?,?)
      ON DUPLICATE KEY UPDATE company_name=?,company_name_local=?,address=?,phone=?,contact_person=?,email=?,tax_id=?,logo_url=?`,
      [b.company_name,b.company_name_local||'',b.address||'',b.phone||'',b.contact_person||'',b.email||'',b.tax_id||'',b.logo_url||null,
       b.company_name,b.company_name_local||'',b.address||'',b.phone||'',b.contact_person||'',b.email||'',b.tax_id||'',b.logo_url||null])
    await audit(u, 'UPDATE', '公司設定', 1, b.company_name)
    return c.json({ ok: true })
  } catch (e: any) { return c.json({ error: String(e.message) }, 500) }
})

// ── Stats ─────────────────────────────────────────────────────────────────────
app.get('/api/stats', authMiddleware, async c => {
  try {
    const now = new Date()
    const monthStart = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-01`
    const [materials, suppliers, customers, po, orders, monthOrders, allSales, lowStock] = await Promise.all([
      queryOne<any>('SELECT COUNT(*) as cnt FROM bom WHERE deleted_at IS NULL'),
      queryOne<any>('SELECT COUNT(*) as cnt FROM suppliers WHERE deleted_at IS NULL'),
      queryOne<any>('SELECT COUNT(*) as cnt FROM customers WHERE deleted_at IS NULL'),
      queryOne<any>("SELECT COUNT(*) as cnt, COALESCE(SUM(total_amount),0) as total FROM purchase_orders WHERE status='received' AND deleted_at IS NULL"),
      queryOne<any>('SELECT COUNT(*) as cnt FROM customer_orders WHERE deleted_at IS NULL'),
      queryOne<any>('SELECT COUNT(*) as cnt, COALESCE(SUM(ci.qty*ci.unit_price),0) as total FROM customer_orders co JOIN customer_order_items ci ON ci.order_id=co.id WHERE co.deleted_at IS NULL AND co.po_date>=?', [monthStart]),
      queryOne<any>('SELECT COALESCE(SUM(ci.qty*ci.unit_price),0) as total, MIN(co.po_date) as earliest, MAX(co.po_date) as latest FROM customer_orders co JOIN customer_order_items ci ON ci.order_id=co.id WHERE co.deleted_at IS NULL'),
      queryOne<any>('SELECT COUNT(*) as cnt FROM bom WHERE deleted_at IS NULL AND COALESCE(current_stock,0) <= 0'),
    ])
    return c.json({
      materials: materials?.cnt||0, suppliers: suppliers?.cnt||0, customers: customers?.cnt||0,
      po_count: po?.cnt||0, po_total: po?.total||0, orders_count: orders?.cnt||0,
      month_orders: monthOrders?.cnt||0, month_sales: monthOrders?.total||0,
      total_sales: allSales?.total||0,
      sales_date_range: allSales?.earliest ? `${allSales.earliest} ~ ${allSales.latest}` : '',
      low_stock_count: lowStock?.cnt||0,
    })
  } catch (e: any) { return c.json({ error: String(e.message) }, 500) }
})

// ── Upload ────────────────────────────────────────────────────────────────────
app.post('/api/upload', authMiddleware, async c => {
  try {
    const formData = await c.req.formData()
    const file = formData.get('file') as File
    if (!file) return c.json({ error: 'No file' }, 400)
    const uploadDir = process.env.UPLOAD_DIR || '/app/uploads'
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true })
    const ext = path.extname(file.name) || '.bin'
    const filename = `${Date.now()}${ext}`
    const filepath = path.join(uploadDir, filename)
    const buffer = Buffer.from(await file.arrayBuffer())
    fs.writeFileSync(filepath, buffer)
    // Return relative URL so it works through Nginx proxy
    return c.json({ url: `/uploads/${filename}` })
  } catch (e: any) { return c.json({ error: String(e.message) }, 500) }
})

// Serve uploaded files
app.get('/uploads/*', async c => {
  const filename = c.req.path.replace('/uploads/', '')
  const uploadDir = process.env.UPLOAD_DIR || '/app/uploads'
  const filepath = path.join(uploadDir, filename)
  if (!fs.existsSync(filepath)) return c.json({ error: 'Not found' }, 404)
  const data = fs.readFileSync(filepath)
  const ext = path.extname(filename).toLowerCase()
  const mimeTypes: Record<string,string> = { '.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.gif':'image/gif','.webp':'image/webp' }
  return new Response(data, { headers: { 'Content-Type': mimeTypes[ext]||'application/octet-stream', 'Cache-Control': 'public, max-age=31536000' } })
})

// ── Start server ──────────────────────────────────────────────────────────────
const port = parseInt(process.env.PORT || '3001')
console.log(`OMS Backend starting on port ${port}`)
serve({ fetch: app.fetch, port }, info => {
  console.log(`✓ Server running at http://localhost:${info.port}`)
})
