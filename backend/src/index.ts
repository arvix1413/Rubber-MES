import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { query, queryOne, execute } from './db'
import { hashPw, signJwt, verifyJwt, now8 } from './auth'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'

type Variables = { user: any }
const app = new Hono<{ Variables: Variables }>()
const normalizeUserRole = (role: any): 'manager' | 'employee' => (role === 'manager' || role === 'admin' ? 'manager' : 'employee')

app.use('/api/*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowHeaders: ['Content-Type', 'Authorization'],
}))

app.use('/api/*', async (_c, next) => {
  await ensureDeliveryProgressTable()
  await ensureShipmentReconciliationTables()
  await ensureInvoiceTables()
  await ensureCustomerOrderTrackingColumns()
  await ensureBomStockColumns()
  await ensureStockLedgerTable()
  await ensureMaterialExtraColumns()
  await ensureBomExtraColumns()
  await ensureBomItemsExtraColumns()
  await ensurePoItemReceivedQtyColumn()
  await ensurePoItemMaterialIdColumn()
  await ensurePoItemProgressIdColumn()
  await ensurePoItemProgressItemIdColumn()
  await ensureMaterialReferenceColumns()
  await ensureUserSignatureColumn()
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

const addIndexSafe = async (sql: string) => {
  try {
    await execute(sql)
  } catch (e: any) {
    const msg = String(e?.message || '').toLowerCase()
    if (msg.includes('duplicate key name') || msg.includes('already exists')) return
    throw e
  }
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

let ensureCustomerOrderTrackingColumnsPromise: Promise<void> | null = null
const ensureCustomerOrderTrackingColumns = async () => {
  if (!ensureCustomerOrderTrackingColumnsPromise) {
    ensureCustomerOrderTrackingColumnsPromise = (async () => {
      const alterSafe = async (sql: string) => {
        try {
          await execute(sql)
        } catch (e: any) {
          const msg = String(e?.message || '').toLowerCase()
          if (!msg.includes('duplicate column')) throw e
        }
      }
      await alterSafe('ALTER TABLE customer_order_items ADD COLUMN reconciled_qty DECIMAL(15,4) NOT NULL DEFAULT 0')
      await alterSafe('ALTER TABLE customer_order_items ADD COLUMN settled_qty DECIMAL(15,4) NOT NULL DEFAULT 0')
      await alterSafe("ALTER TABLE customer_order_items ADD COLUMN po_no VARCHAR(100) NOT NULL DEFAULT ''")
      await addIndexSafe('CREATE INDEX idx_customer_orders_status_created ON customer_orders (status, created_at)')
      await addIndexSafe('CREATE INDEX idx_customer_orders_customer ON customer_orders (customer_id)')
      await addIndexSafe('CREATE INDEX idx_customer_order_items_order ON customer_order_items (order_id)')
      await addIndexSafe('CREATE INDEX idx_customer_order_items_reconcile ON customer_order_items (arrived_qty, reconciled_qty, qty)')
      await addIndexSafe('CREATE INDEX idx_bom_product_sku ON bom (product_sku)')
    })().catch((e) => {
      ensureCustomerOrderTrackingColumnsPromise = null
      throw e
    })
  }
  await ensureCustomerOrderTrackingColumnsPromise
}

let ensureShipmentReconciliationTablesPromise: Promise<void> | null = null
const ensureShipmentReconciliationTables = async () => {
  if (!ensureShipmentReconciliationTablesPromise) {
    ensureShipmentReconciliationTablesPromise = (async () => {
      await execute(`
        CREATE TABLE IF NOT EXISTS shipment_reconciliations (
          id INT AUTO_INCREMENT PRIMARY KEY,
          reconciliation_no VARCHAR(100) NOT NULL UNIQUE,
          reconcile_date DATE,
          status VARCHAR(50) NOT NULL DEFAULT 'draft',
          remark TEXT,
          created_by INT,
          confirmed_by INT,
          confirmed_at DATETIME NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `)
      await execute(`
        CREATE TABLE IF NOT EXISTS shipment_reconciliation_items (
          id INT AUTO_INCREMENT PRIMARY KEY,
          reconciliation_id INT NOT NULL,
          delivery_note_id INT,
          delivery_note_item_id INT,
          customer_order_id INT,
          order_item_id INT NULL,
          po_number VARCHAR(100),
          material_code VARCHAR(100),
          material_name VARCHAR(255),
          supplier_id INT NULL,
          supplier_name VARCHAR(255),
          unit VARCHAR(50) DEFAULT 'PCS',
          shipped_qty DECIMAL(15,4) NOT NULL DEFAULT 0,
          accepted_qty DECIMAL(15,4) NOT NULL DEFAULT 0,
          difference_qty DECIMAL(15,4) NOT NULL DEFAULT 0,
          difference_reason TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          UNIQUE KEY uq_delivery_note_item (delivery_note_item_id),
          INDEX idx_reconcile_id (reconciliation_id),
          CONSTRAINT fk_reconcile_items_header FOREIGN KEY (reconciliation_id) REFERENCES shipment_reconciliations(id) ON DELETE CASCADE
        )
      `)
      await addIndexSafe('CREATE INDEX idx_reconcile_status_created ON shipment_reconciliations (status, created_at)')
      await addIndexSafe('CREATE INDEX idx_reconcile_confirmed_at ON shipment_reconciliations (confirmed_at)')
      await addIndexSafe('CREATE INDEX idx_reconcile_items_delivery_note ON shipment_reconciliation_items (delivery_note_id)')
      await addIndexSafe('CREATE INDEX idx_reconcile_items_order_material ON shipment_reconciliation_items (customer_order_id, material_code)')
    })().catch((e) => {
      ensureShipmentReconciliationTablesPromise = null
      throw e
    })
  }
  await ensureShipmentReconciliationTablesPromise
}

let ensureBomStockColumnsPromise: Promise<void> | null = null
const ensureBomStockColumns = async () => {
  if (!ensureBomStockColumnsPromise) {
    ensureBomStockColumnsPromise = (async () => {
      const alterSafe = async (sql: string) => {
        try {
          await execute(sql)
        } catch (e: any) {
          const msg = String(e?.message || '').toLowerCase()
          if (!msg.includes('duplicate column')) throw e
        }
      }
      await alterSafe('ALTER TABLE bom ADD COLUMN current_stock DECIMAL(15,4) NOT NULL DEFAULT 0')
    })().catch((e) => {
      ensureBomStockColumnsPromise = null
      throw e
    })
  }
  await ensureBomStockColumnsPromise
}

let ensureStockLedgerTablePromise: Promise<void> | null = null
const ensureStockLedgerTable = async () => {
  if (!ensureStockLedgerTablePromise) {
    ensureStockLedgerTablePromise = (async () => {
      const alterSafe = async (sql: string) => {
        try {
          await execute(sql)
        } catch (e: any) {
          const msg = String(e?.message || '').toLowerCase()
          if (!msg.includes('duplicate column')) throw e
        }
      }

      await execute(`
        CREATE TABLE IF NOT EXISTS stock_ledger (
          id INT AUTO_INCREMENT PRIMARY KEY,
          material_code VARCHAR(100) NOT NULL,
          material_name TEXT,
          transaction_type VARCHAR(30) NOT NULL,
          ref_type VARCHAR(30),
          ref_id INT,
          ref_number VARCHAR(100),
          qty_change DECIMAL(15,4) NOT NULL,
          qty_before DECIMAL(15,4) DEFAULT 0,
          qty_after DECIMAL(15,4) DEFAULT 0,
          unit VARCHAR(50) DEFAULT 'PCS',
          batch_no VARCHAR(100),
          remark TEXT,
          created_by INT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `)
      await alterSafe('ALTER TABLE stock_ledger ADD COLUMN batch_no VARCHAR(100) DEFAULT NULL')
      await addIndexSafe('CREATE INDEX idx_stock_ledger_material_time ON stock_ledger (material_code, created_at)')
      await addIndexSafe('CREATE INDEX idx_stock_ledger_ref ON stock_ledger (ref_type, ref_id)')
      await addIndexSafe('CREATE INDEX idx_stock_ledger_txn ON stock_ledger (transaction_type, created_at)')
    })().catch((e) => {
      ensureStockLedgerTablePromise = null
      throw e
    })
  }
  await ensureStockLedgerTablePromise
}

let ensureMaterialExtraColumnsPromise: Promise<void> | null = null
const ensureMaterialExtraColumns = async () => {
  if (!ensureMaterialExtraColumnsPromise) {
    ensureMaterialExtraColumnsPromise = (async () => {
      const alterSafe = async (sql: string) => {
        try {
          await execute(sql)
        } catch (e: any) {
          const msg = String(e?.message || '').toLowerCase()
          if (!msg.includes('duplicate column')) throw e
        }
      }
      await alterSafe('ALTER TABLE materials ADD COLUMN color VARCHAR(100) DEFAULT NULL')
      await alterSafe('ALTER TABLE materials ADD COLUMN leadtime_days INT DEFAULT NULL')
      await alterSafe('ALTER TABLE materials ADD COLUMN leadtime_text VARCHAR(100) DEFAULT NULL')
      await alterSafe('ALTER TABLE materials ADD COLUMN moq DECIMAL(15,4) DEFAULT NULL')
      await alterSafe('ALTER TABLE materials ADD COLUMN moq_tiers TEXT NULL')
      await alterSafe('ALTER TABLE materials ADD COLUMN remark TEXT')
    })().catch((e) => {
      ensureMaterialExtraColumnsPromise = null
      throw e
    })
  }
  await ensureMaterialExtraColumnsPromise
}

let ensureBomExtraColumnsPromise: Promise<void> | null = null
const ensureBomExtraColumns = async () => {
  if (!ensureBomExtraColumnsPromise) {
    ensureBomExtraColumnsPromise = (async () => {
      const alterSafe = async (sql: string) => {
        try {
          await execute(sql)
        } catch (e: any) {
          const msg = String(e?.message || '').toLowerCase()
          if (!msg.includes('duplicate column')) throw e
        }
      }
      await alterSafe('ALTER TABLE bom ADD COLUMN color VARCHAR(100) DEFAULT NULL')
      await alterSafe('ALTER TABLE bom ADD COLUMN lt VARCHAR(100) DEFAULT NULL')
      await alterSafe('ALTER TABLE bom ADD COLUMN moq DECIMAL(15,4) DEFAULT NULL')
    })().catch((e) => {
      ensureBomExtraColumnsPromise = null
      throw e
    })
  }
  await ensureBomExtraColumnsPromise
}

let ensureBomItemsExtraColumnsPromise: Promise<void> | null = null
const ensureBomItemsExtraColumns = async () => {
  if (!ensureBomItemsExtraColumnsPromise) {
    ensureBomItemsExtraColumnsPromise = (async () => {
      const alterSafe = async (sql: string) => {
        try {
          await execute(sql)
        } catch (e: any) {
          const msg = String(e?.message || '').toLowerCase()
          if (!msg.includes('duplicate column')) throw e
        }
      }
      await alterSafe('ALTER TABLE bom_items ADD COLUMN color VARCHAR(100) DEFAULT NULL')
      await alterSafe('ALTER TABLE bom_items ADD COLUMN lt VARCHAR(100) DEFAULT NULL')
      await alterSafe('ALTER TABLE bom_items ADD COLUMN moq DECIMAL(15,4) DEFAULT NULL')
    })().catch((e) => {
      ensureBomItemsExtraColumnsPromise = null
      throw e
    })
  }
  await ensureBomItemsExtraColumnsPromise
}

let ensurePoItemReceivedQtyColumnPromise: Promise<void> | null = null
const ensurePoItemReceivedQtyColumn = async () => {
  if (!ensurePoItemReceivedQtyColumnPromise) {
    ensurePoItemReceivedQtyColumnPromise = (async () => {
      try {
        await execute('ALTER TABLE po_items ADD COLUMN received_qty DECIMAL(15,4) NOT NULL DEFAULT 0')
      } catch (e: any) {
        const msg = String(e?.message || '').toLowerCase()
        if (!msg.includes('duplicate column')) throw e
      }
    })().catch((e) => {
      ensurePoItemReceivedQtyColumnPromise = null
      throw e
    })
  }
  await ensurePoItemReceivedQtyColumnPromise
}

let ensurePoItemMaterialIdColumnPromise: Promise<void> | null = null
const ensurePoItemMaterialIdColumn = async () => {
  if (!ensurePoItemMaterialIdColumnPromise) {
    ensurePoItemMaterialIdColumnPromise = (async () => {
      const alterSafe = async (sql: string) => {
        try {
          await execute(sql)
        } catch (e: any) {
          const msg = String(e?.message || '').toLowerCase()
          if (!msg.includes('duplicate column') && !msg.includes('duplicate key name') && !msg.includes('duplicate index')) throw e
        }
      }
      await alterSafe('ALTER TABLE po_items ADD COLUMN material_id INT NULL AFTER po_id')
      await alterSafe('ALTER TABLE po_items ADD INDEX idx_po_items_material_id (material_id)')
    })().catch((e) => {
      ensurePoItemMaterialIdColumnPromise = null
      throw e
    })
  }
  await ensurePoItemMaterialIdColumnPromise
}

let ensurePoItemProgressIdColumnPromise: Promise<void> | null = null
const ensurePoItemProgressIdColumn = async () => {
  if (!ensurePoItemProgressIdColumnPromise) {
    ensurePoItemProgressIdColumnPromise = (async () => {
      const alterSafe = async (sql: string) => {
        try {
          await execute(sql)
        } catch (e: any) {
          const msg = String(e?.message || '').toLowerCase()
          if (!msg.includes('duplicate column') && !msg.includes('duplicate key name') && !msg.includes('duplicate index')) throw e
        }
      }
      await alterSafe('ALTER TABLE po_items ADD COLUMN progress_id INT NULL AFTER po_id')
      await alterSafe('ALTER TABLE po_items ADD INDEX idx_po_items_progress_id (progress_id)')
    })().catch((e) => {
      ensurePoItemProgressIdColumnPromise = null
      throw e
    })
  }
  await ensurePoItemProgressIdColumnPromise
}

let ensurePoItemProgressItemIdColumnPromise: Promise<void> | null = null
const ensurePoItemProgressItemIdColumn = async () => {
  if (!ensurePoItemProgressItemIdColumnPromise) {
    ensurePoItemProgressItemIdColumnPromise = (async () => {
      const alterSafe = async (sql: string) => {
        try {
          await execute(sql)
        } catch (e: any) {
          const msg = String(e?.message || '').toLowerCase()
          if (!msg.includes('duplicate column') && !msg.includes('duplicate key name') && !msg.includes('duplicate index')) throw e
        }
      }
      await alterSafe('ALTER TABLE po_items ADD COLUMN progress_item_id INT NULL AFTER progress_id')
      await alterSafe('ALTER TABLE po_items ADD INDEX idx_po_items_progress_item_id (progress_item_id)')
    })().catch((e) => {
      ensurePoItemProgressItemIdColumnPromise = null
      throw e
    })
  }
  await ensurePoItemProgressItemIdColumnPromise
}

let ensureDeliveryProgressTablePromise: Promise<void> | null = null
const ensureDeliveryProgressTable = async () => {
  if (!ensureDeliveryProgressTablePromise) {
    ensureDeliveryProgressTablePromise = (async () => {
      const alterSafe = async (sql: string) => {
        try {
          await execute(sql)
        } catch (e: any) {
          const msg = String(e?.message || '').toLowerCase()
          if (!msg.includes('duplicate column') && !msg.includes('duplicate key name') && !msg.includes('duplicate index')) throw e
        }
      }
      await execute(`
        CREATE TABLE IF NOT EXISTS delivery_progress (
          id INT AUTO_INCREMENT PRIMARY KEY,
          progress_no VARCHAR(100) NOT NULL UNIQUE,
          customer_id INT NULL,
          customer_name VARCHAR(255) DEFAULT '',
          customer_order_id INT NULL,
          order_item_id INT NULL,
          order_po_number VARCHAR(100) DEFAULT '',
          delivery_location VARCHAR(255) DEFAULT '',
          material_code VARCHAR(255) DEFAULT '',
          material_name VARCHAR(255) DEFAULT '',
          spec VARCHAR(255) DEFAULT '',
          unit VARCHAR(50) DEFAULT 'PCS',
          planned_qty DECIMAL(15,4) NOT NULL DEFAULT 0,
          due_date DATE NULL,
          status VARCHAR(50) NOT NULL DEFAULT 'pending',
          remark TEXT,
          created_by INT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          deleted_at DATETIME NULL,
          deleted_by INT NULL
        )
      `)
      await execute(`
        CREATE TABLE IF NOT EXISTS delivery_progress_po_links (
          id INT AUTO_INCREMENT PRIMARY KEY,
          progress_id INT NOT NULL,
          customer_order_id INT NULL,
          order_po_number VARCHAR(100) NOT NULL DEFAULT '',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          deleted_at DATETIME NULL,
          deleted_by INT NULL
        )
      `)
      await execute(`
        CREATE TABLE IF NOT EXISTS delivery_progress_items (
          id INT AUTO_INCREMENT PRIMARY KEY,
          progress_id INT NOT NULL,
          order_po_number VARCHAR(100) DEFAULT '',
          material_code VARCHAR(255) DEFAULT '',
          material_name VARCHAR(255) DEFAULT '',
          spec VARCHAR(255) DEFAULT '',
          unit VARCHAR(50) DEFAULT 'PCS',
          planned_qty DECIMAL(15,4) NOT NULL DEFAULT 0,
          due_date DATE NULL,
          status VARCHAR(50) NOT NULL DEFAULT 'pending',
          remark TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          deleted_at DATETIME NULL,
          deleted_by INT NULL
        )
      `)
      await alterSafe('ALTER TABLE delivery_progress ADD COLUMN delivery_location VARCHAR(255) DEFAULT \'\' AFTER order_po_number')
      await addIndexSafe('CREATE INDEX idx_delivery_progress_order_item ON delivery_progress (customer_order_id, order_item_id)')
      await addIndexSafe('CREATE INDEX idx_delivery_progress_status_created ON delivery_progress (status, created_at)')
      await addIndexSafe('CREATE INDEX idx_delivery_progress_material ON delivery_progress (material_code)')
      await addIndexSafe('CREATE INDEX idx_delivery_progress_po_links_progress ON delivery_progress_po_links (progress_id)')
      await addIndexSafe('CREATE INDEX idx_delivery_progress_po_links_order ON delivery_progress_po_links (customer_order_id)')
      await addIndexSafe('CREATE INDEX idx_delivery_progress_po_links_po ON delivery_progress_po_links (order_po_number)')
      await addIndexSafe('CREATE INDEX idx_delivery_progress_items_progress ON delivery_progress_items (progress_id)')
      await addIndexSafe('CREATE INDEX idx_delivery_progress_items_status ON delivery_progress_items (status)')
      await alterSafe("ALTER TABLE delivery_progress_items ADD COLUMN order_po_number VARCHAR(100) DEFAULT '' AFTER progress_id")
      await execute(`
        INSERT INTO delivery_progress_items (progress_id, order_po_number, material_code, material_name, spec, unit, planned_qty, due_date, status, remark, created_at)
        SELECT
          dp.id,
          COALESCE(dp.order_po_number, ''),
          COALESCE(dp.material_code, ''),
          COALESCE(dp.material_name, ''),
          COALESCE(dp.spec, ''),
          COALESCE(NULLIF(dp.unit, ''), 'PCS'),
          COALESCE(dp.planned_qty, 0),
          dp.due_date,
          COALESCE(NULLIF(dp.status, ''), 'pending'),
          COALESCE(dp.remark, ''),
          COALESCE(dp.created_at, CURRENT_TIMESTAMP)
        FROM delivery_progress dp
        WHERE dp.deleted_at IS NULL
          AND (
            COALESCE(dp.material_code, '') <> ''
            OR COALESCE(dp.material_name, '') <> ''
            OR COALESCE(dp.planned_qty, 0) > 0
          )
          AND NOT EXISTS (
            SELECT 1
            FROM delivery_progress_items dpi
            WHERE dpi.progress_id = dp.id
          )
      `)
    })().catch((e) => {
      ensureDeliveryProgressTablePromise = null
      throw e
    })
  }
  await ensureDeliveryProgressTablePromise
}

let ensureMaterialReferenceColumnsPromise: Promise<void> | null = null
const ensureMaterialReferenceColumns = async () => {
  if (!ensureMaterialReferenceColumnsPromise) {
    ensureMaterialReferenceColumnsPromise = (async () => {
      const alterSafe = async (sql: string) => {
        try {
          await execute(sql)
        } catch (e: any) {
          const msg = String(e?.message || '').toLowerCase()
          if (
            !msg.includes('duplicate column') &&
            !msg.includes('duplicate key name') &&
            !msg.includes('duplicate index') &&
            !msg.includes("doesn't exist")
          ) throw e
        }
      }
      await alterSafe('ALTER TABLE bom_items ADD COLUMN material_id INT NULL AFTER bom_id')
      await alterSafe('ALTER TABLE bom_items ADD INDEX idx_bom_items_material_id (material_id)')
      await alterSafe('ALTER TABLE quotation_items ADD COLUMN material_id INT NULL AFTER quotation_id')
      await alterSafe('ALTER TABLE quotation_items ADD INDEX idx_quotation_items_material_id (material_id)')
      await alterSafe('ALTER TABLE delivery_note_items ADD COLUMN material_id INT NULL AFTER dn_id')
      await alterSafe('ALTER TABLE delivery_note_items ADD INDEX idx_delivery_note_items_material_id (material_id)')
      await alterSafe('ALTER TABLE delivery_sheet_items ADD COLUMN material_id INT NULL AFTER ds_id')
      await alterSafe('ALTER TABLE delivery_sheet_items ADD INDEX idx_delivery_sheet_items_material_id (material_id)')
      await alterSafe('ALTER TABLE goods_receipt_items ADD COLUMN material_id INT NULL AFTER po_item_id')
      await alterSafe('ALTER TABLE goods_receipt_items ADD INDEX idx_goods_receipt_items_material_id (material_id)')
      await alterSafe('ALTER TABLE production_materials ADD COLUMN material_id INT NULL AFTER prod_id')
      await alterSafe('ALTER TABLE production_materials ADD INDEX idx_production_materials_material_id (material_id)')
      await alterSafe('ALTER TABLE stock_adjustment_items ADD COLUMN material_id INT NULL AFTER adj_id')
      await alterSafe('ALTER TABLE stock_adjustment_items ADD INDEX idx_stock_adjustment_items_material_id (material_id)')

      const backfillSafe = async (sql: string) => {
        try {
          await execute(sql)
        } catch (e: any) {
          const msg = String(e?.message || '').toLowerCase()
          if (!msg.includes("doesn't exist")) throw e
        }
      }
      await backfillSafe(`
        UPDATE po_items pi
        JOIN materials m ON m.material_code = pi.material_code AND m.deleted_at IS NULL
        SET pi.material_id = m.id
        WHERE pi.material_id IS NULL AND COALESCE(pi.material_code, '') <> ''
      `)
      await backfillSafe(`
        UPDATE bom_items bi
        JOIN materials m ON m.material_code = bi.material_code AND m.deleted_at IS NULL
        SET bi.material_id = m.id
        WHERE bi.material_id IS NULL AND COALESCE(bi.material_code, '') <> ''
      `)
      await backfillSafe(`
        UPDATE quotation_items qi
        JOIN materials m ON m.material_code = qi.material_code AND m.deleted_at IS NULL
        SET qi.material_id = m.id
        WHERE qi.material_id IS NULL AND COALESCE(qi.material_code, '') <> ''
      `)
      await backfillSafe(`
        UPDATE delivery_note_items dni
        JOIN materials m ON m.material_code = dni.material_code AND m.deleted_at IS NULL
        SET dni.material_id = m.id
        WHERE dni.material_id IS NULL AND COALESCE(dni.material_code, '') <> ''
      `)
      await backfillSafe(`
        UPDATE delivery_sheet_items dsi
        JOIN materials m ON m.material_code = dsi.material_code AND m.deleted_at IS NULL
        SET dsi.material_id = m.id
        WHERE dsi.material_id IS NULL AND COALESCE(dsi.material_code, '') <> ''
      `)
      await backfillSafe(`
        UPDATE goods_receipt_items gri
        JOIN materials m ON m.material_code = gri.material_code AND m.deleted_at IS NULL
        SET gri.material_id = m.id
        WHERE gri.material_id IS NULL AND COALESCE(gri.material_code, '') <> ''
      `)
      await backfillSafe(`
        UPDATE production_materials pm
        JOIN materials m ON m.material_code = pm.material_code AND m.deleted_at IS NULL
        SET pm.material_id = m.id
        WHERE pm.material_id IS NULL AND COALESCE(pm.material_code, '') <> ''
      `)
      await backfillSafe(`
        UPDATE stock_adjustment_items sai
        JOIN materials m ON m.material_code = sai.material_code AND m.deleted_at IS NULL
        SET sai.material_id = m.id
        WHERE sai.material_id IS NULL AND COALESCE(sai.material_code, '') <> ''
      `)
    })().catch((e) => {
      ensureMaterialReferenceColumnsPromise = null
      throw e
    })
  }
  await ensureMaterialReferenceColumnsPromise
}

const resolveMaterialId = async (materialIdRaw: any, materialCodeRaw: any): Promise<number | null> => {
  const materialId = Number(materialIdRaw || 0)
  if (Number.isFinite(materialId) && materialId > 0) return materialId
  const materialCode = String(materialCodeRaw || '').trim()
  if (!materialCode) return null
  const row = await queryOne<any>('SELECT id FROM materials WHERE material_code=? AND deleted_at IS NULL LIMIT 1', [materialCode])
  const resolved = Number(row?.id || 0)
  return Number.isFinite(resolved) && resolved > 0 ? resolved : null
}

let ensureInvoiceTablesPromise: Promise<void> | null = null
const ensureInvoiceTables = async () => {
  if (!ensureInvoiceTablesPromise) {
    ensureInvoiceTablesPromise = (async () => {
      const alterSafe = async (sql: string) => {
        try {
          await execute(sql)
        } catch (e: any) {
          const msg = String(e?.message || '').toLowerCase()
          if (!msg.includes('duplicate column')) throw e
        }
      }
      const alterIndexSafe = async (sql: string) => {
        try {
          await execute(sql)
        } catch (e: any) {
          const msg = String(e?.message || '').toLowerCase()
          if (msg.includes('duplicate key name') || msg.includes('duplicate index')) return
          throw e
        }
      }
      await execute(`
        CREATE TABLE IF NOT EXISTS invoice_headers (
          id INT AUTO_INCREMENT PRIMARY KEY,
          invoice_no VARCHAR(100) NOT NULL UNIQUE,
          invoice_type VARCHAR(50) NOT NULL DEFAULT 'customer',
          invoice_period CHAR(6) NULL,
          invoice_seq INT NULL,
          invoice_date DATE,
          status VARCHAR(50) NOT NULL DEFAULT 'draft',
          party_id INT NULL,
          party_name VARCHAR(255),
          currency VARCHAR(20) DEFAULT 'VND',
          total_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
          tax_rate DECIMAL(8,4) NOT NULL DEFAULT 0,
          tax_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
          grand_total DECIMAL(15,2) NOT NULL DEFAULT 0,
          payment_status VARCHAR(50) NOT NULL DEFAULT 'pending',
          received_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
          paid_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
          payment_date DATE NULL,
          payment_note TEXT,
          verification_code VARCHAR(32) NULL,
          qr_payload TEXT NULL,
          remark TEXT,
          created_by INT,
          confirmed_by INT,
          confirmed_at DATETIME NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_invoice_type_status (invoice_type, status)
        )
      `)
      await execute(`
        CREATE TABLE IF NOT EXISTS invoice_items (
          id INT AUTO_INCREMENT PRIMARY KEY,
          invoice_id INT NOT NULL,
          reconciliation_id INT NULL,
          reconciliation_item_id INT NULL,
          customer_order_id INT NULL,
          order_item_id INT NULL,
          po_number VARCHAR(100),
          delivery_note_id INT NULL,
          delivery_note_item_id INT NULL,
          material_code VARCHAR(100),
          material_name VARCHAR(255),
          spec TEXT,
          unit VARCHAR(50) DEFAULT 'PCS',
          qty DECIMAL(15,4) NOT NULL DEFAULT 0,
          unit_price DECIMAL(15,2) NOT NULL DEFAULT 0,
          amount DECIMAL(15,2) NOT NULL DEFAULT 0,
          supplier_id INT NULL,
          supplier_name VARCHAR(255),
          customer_id INT NULL,
          customer_name VARCHAR(255),
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_invoice_item_invoice_id (invoice_id),
          INDEX idx_invoice_item_reconcile_item (reconciliation_item_id),
          CONSTRAINT fk_invoice_items_header FOREIGN KEY (invoice_id) REFERENCES invoice_headers(id) ON DELETE CASCADE
        )
      `)
      await alterSafe("ALTER TABLE invoice_headers ADD COLUMN payment_status VARCHAR(50) NOT NULL DEFAULT 'pending'")
      await alterSafe('ALTER TABLE invoice_headers ADD COLUMN received_amount DECIMAL(15,2) NOT NULL DEFAULT 0')
      await alterSafe('ALTER TABLE invoice_headers ADD COLUMN paid_amount DECIMAL(15,2) NOT NULL DEFAULT 0')
      await alterSafe('ALTER TABLE invoice_headers ADD COLUMN payment_date DATE NULL')
      await alterSafe('ALTER TABLE invoice_headers ADD COLUMN payment_note TEXT')
      await alterSafe('ALTER TABLE invoice_headers ADD COLUMN invoice_period CHAR(6) NULL')
      await alterSafe('ALTER TABLE invoice_headers ADD COLUMN invoice_seq INT NULL')
      await alterSafe('ALTER TABLE invoice_headers ADD COLUMN verification_code VARCHAR(32) NULL')
      await alterSafe('ALTER TABLE invoice_headers ADD COLUMN qr_payload TEXT NULL')
      await alterIndexSafe('ALTER TABLE invoice_headers ADD INDEX idx_invoice_period_seq (invoice_type, invoice_period, invoice_seq)')
      await alterIndexSafe('ALTER TABLE invoice_headers ADD INDEX idx_invoice_payment (invoice_type, payment_status)')
      await alterIndexSafe('ALTER TABLE invoice_headers ADD INDEX idx_invoice_date (invoice_date)')
      await alterIndexSafe('ALTER TABLE invoice_headers ADD INDEX idx_invoice_verify (verification_code)')
      await alterIndexSafe('ALTER TABLE invoice_items ADD INDEX idx_invoice_reconciliation (reconciliation_id)')
      await alterIndexSafe('ALTER TABLE invoice_items ADD INDEX idx_invoice_reconciliation_item (reconciliation_item_id)')
      await alterIndexSafe('ALTER TABLE invoice_items ADD INDEX idx_invoice_order_item (order_item_id)')
    })().catch((e) => {
      ensureInvoiceTablesPromise = null
      throw e
    })
  }
  await ensureInvoiceTablesPromise
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
  'delivery_progress',
  'delivery_progress_po_links',
  'delivery_progress_items',
  'shipment_reconciliations',
  'shipment_reconciliation_items',
  'invoice_headers',
  'invoice_items',
] as const

let ensureSoftDeleteColumnsPromise: Promise<void> | null = null
let ensureUserSignatureColumnPromise: Promise<void> | null = null
const ensureUserSignatureColumn = async () => {
  if (!ensureUserSignatureColumnPromise) {
    ensureUserSignatureColumnPromise = (async () => {
      try {
        await execute('ALTER TABLE users ADD COLUMN signature_url TEXT NULL')
      } catch (e: any) {
        const msg = String(e?.message || '').toLowerCase()
        if (msg.includes('duplicate column')) return
        if (msg.includes("doesn't exist") || msg.includes('unknown table')) return
        throw e
      }
    })().catch((e) => {
      ensureUserSignatureColumnPromise = null
      throw e
    })
  }
  await ensureUserSignatureColumnPromise
}

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

const toQty = (value: any): number => {
  const num = Number(value)
  if (!Number.isFinite(num)) return 0
  return Math.round(num * 10000) / 10000
}

const toMoney = (value: any): number => {
  const num = Number(value)
  if (!Number.isFinite(num)) return 0
  return Math.round(num * 100) / 100
}

const uniquePoNumbers = (values: any[]): string[] => {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of values) {
    const text = String(raw || '')
      .split(/[\n,;|]+/)
      .map((v) => v.trim())
      .filter(Boolean)
    for (const po of text) {
      const key = po.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      out.push(po)
    }
  }
  return out
}

const uniqueNumberList = (values: any[]): number[] => {
  const out: number[] = []
  const seen = new Set<number>()
  for (const raw of values) {
    const num = Number(raw || 0)
    if (!Number.isFinite(num) || num <= 0 || seen.has(num)) continue
    seen.add(num)
    out.push(num)
  }
  return out
}

const syncDeliveryProgressPoLinks = async (
  progressId: number,
  customerOrderIds: number[],
  poNumbers: string[],
  userId: number | null,
) => {
  await execute('UPDATE delivery_progress_po_links SET deleted_at=?, deleted_by=? WHERE progress_id=? AND deleted_at IS NULL', [now8(), userId || null, progressId])

  const normalizedOrderIds = Array.from(new Set(customerOrderIds.filter((id) => Number.isFinite(id) && id > 0)))
  const linkedOrders = normalizedOrderIds.length
    ? await query<any>(
        `SELECT id, po_number FROM customer_orders WHERE id IN (${normalizedOrderIds.map(() => '?').join(',')}) AND deleted_at IS NULL`,
        normalizedOrderIds,
      )
    : []

  const inserted = new Set<string>()
  for (const order of linkedOrders) {
    const poNumber = String(order.po_number || '').trim()
    if (!poNumber) continue
    const key = `${Number(order.id)}::${poNumber.toLowerCase()}`
    if (inserted.has(key)) continue
    inserted.add(key)
    await execute(
      'INSERT INTO delivery_progress_po_links (progress_id, customer_order_id, order_po_number, created_at) VALUES (?,?,?,?)',
      [progressId, Number(order.id), poNumber, now8()],
    )
  }

  for (const poNumber of poNumbers) {
    const key = `0::${poNumber.toLowerCase()}`
    const alreadyLinked = linkedOrders.some((order) => String(order.po_number || '').trim().toLowerCase() === poNumber.toLowerCase())
    if (alreadyLinked || inserted.has(key)) continue
    inserted.add(key)
    await execute(
      'INSERT INTO delivery_progress_po_links (progress_id, customer_order_id, order_po_number, created_at) VALUES (?,?,?,?)',
      [progressId, null, poNumber, now8()],
    )
  }
}

const syncDeliveryProgressItems = async (
  progressId: number,
  items: Array<{
    order_po_number?: any
    material_code?: any
    material_name?: any
    spec?: any
    unit?: any
    planned_qty?: any
    due_date?: any
    status?: any
    remark?: any
  }>,
  userId: number | null,
) => {
  await execute('UPDATE delivery_progress_items SET deleted_at=?, deleted_by=? WHERE progress_id=? AND deleted_at IS NULL', [now8(), userId || null, progressId])
  for (const item of items) {
    const orderPoNumber = String(item?.order_po_number || '').trim()
    const materialCode = String(item?.material_code || '').trim()
    const materialName = String(item?.material_name || '').trim()
    const plannedQty = toQty(item?.planned_qty)
    if (!materialName || plannedQty <= 0) continue
    await execute(
      `INSERT INTO delivery_progress_items
        (progress_id, order_po_number, material_code, material_name, spec, unit, planned_qty, due_date, status, remark, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [
        progressId,
        orderPoNumber,
        materialCode || materialName,
        materialName,
        String(item?.spec || '').trim(),
        String(item?.unit || 'PCS').trim() || 'PCS',
        plannedQty,
        item?.due_date ? toDateStr(item.due_date) : null,
        ['pending', 'partial', 'completed'].includes(String(item?.status || '')) ? String(item?.status) : 'pending',
        String(item?.remark || '').trim(),
        now8(),
      ]
    )
  }
}

const toDateStr = (value: any): string => {
  const raw = String(value || '').trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) return now8().slice(0, 10)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

const toPeriod = (dateStr: string): string => {
  return dateStr.slice(0, 7).replace('-', '')
}

const genVerifyCode = (invoiceNo: string): string => {
  const seed = `${invoiceNo}|${Date.now()}|${Math.random()}`
  return crypto.createHash('sha256').update(seed).digest('hex').slice(0, 12).toUpperCase()
}

const buildQrPayload = (invoiceNo: string, verifyCode: string, grandTotal: number): string => {
  return `INV:${invoiceNo}|VC:${verifyCode}|AMT:${toMoney(grandTotal).toFixed(2)}`
}

const nextInvoiceIdentity = async (invoiceType: 'customer' | 'supplier', invoiceDate: string) => {
  const period = toPeriod(invoiceDate)
  const row = await queryOne<any>(`
    SELECT COALESCE(MAX(invoice_seq), 0) as max_seq
    FROM invoice_headers
    WHERE invoice_type=? AND invoice_period=?
  `, [invoiceType, period])
  const seq = Number(row?.max_seq || 0) + 1
  const prefix = invoiceType === 'supplier' ? 'SINV' : 'CINV'
  const invoiceNo = `${prefix}-${period}-${String(seq).padStart(4, '0')}`
  return { invoiceNo, period, seq }
}

const parsePositiveInt = (raw: any, fallback: number, max: number): number => {
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) return fallback
  const v = Math.floor(n)
  if (v <= 0) return fallback
  return Math.min(v, max)
}

const buildOrderItemIdMap = async (pairs: Array<{ customer_order_id: number; material_code: string }>): Promise<Map<string, number>> => {
  const keyMap = new Map<string, number>()
  const orderIds = Array.from(new Set(pairs.map((p) => Number(p.customer_order_id)).filter((x) => Number.isFinite(x) && x > 0)))
  const materialCodes = Array.from(new Set(pairs.map((p) => String(p.material_code || '').trim()).filter(Boolean)))
  if (!orderIds.length || !materialCodes.length) return keyMap

  const orderPlaceholders = orderIds.map(() => '?').join(',')
  const codePlaceholders = materialCodes.map(() => '?').join(',')
  const rows = await query<any>(`
    SELECT
      ci.id as order_item_id,
      ci.order_id as customer_order_id,
      COALESCE(NULLIF(ci.material_code, ''), b.product_sku, '') as material_code
    FROM customer_order_items ci
    LEFT JOIN bom b ON b.id = ci.bom_id
    WHERE ci.order_id IN (${orderPlaceholders})
      AND (
        ci.material_code IN (${codePlaceholders})
        OR b.product_sku IN (${codePlaceholders})
      )
    ORDER BY ci.id ASC
  `, [...orderIds, ...materialCodes, ...materialCodes])
  for (const row of rows) {
    const orderId = Number(row.customer_order_id || 0)
    const materialCode = String(row.material_code || '').trim()
    if (!orderId || !materialCode) continue
    const key = `${orderId}::${materialCode}`
    if (!keyMap.has(key)) keyMap.set(key, Number(row.order_item_id))
  }
  return keyMap
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

app.get('/', c => c.json({ name: 'RUBBER MES Backend', version: '2.0.0' }))

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
app.post('/api/users/:id/reset-password', authMiddleware, requireManager, async c => {
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
  await ensureMaterialExtraColumns()
  const url = new URL(c.req.url)
  const supplierId = url.searchParams.get('supplier_id')
  const supplierName = url.searchParams.get('supplier_name')
  let sql = `SELECT
               m.*,
               COALESCE(NULLIF(m.leadtime_text, ''), CASE WHEN m.leadtime_days IS NULL THEN '' ELSE CAST(m.leadtime_days AS CHAR) END) as leadtime,
               s.name as supplier_name, s.supplier_code, s.currency as supplier_currency
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
  const rows = await query<any>(sql, params.length ? params : undefined)
  return c.json(rows.map((row: any) => ({ ...row, moq_tiers: parseMoqTiersFromDb(row.moq_tiers) })))
})
app.post('/api/materials', authMiddleware, requirePerm('bom.create'), async c => {
  try {
    await ensureMaterialExtraColumns()
    const b = await c.req.json()
    if (!b.material_code || !b.material_name) return c.json({ error: 'material_code and material_name required' }, 400)
    const moqTiers = normalizeMoqTiers(b.moq_tiers)
    const singleMoq = moqTiers.length ? moqTiers[0].moq : (b.moq ? Number(b.moq) : null)
    const leadtimeText = String(b.leadtime_text ?? b.leadtime ?? '').trim()
    const leadtimeDays = leadtimeText
      ? (/^\d+$/.test(leadtimeText) ? Number(leadtimeText) : null)
      : (b.leadtime_days ? Number(b.leadtime_days) : null)
    const r = await execute(
      'INSERT INTO materials (material_code,material_name,spec,unit,category,product_category,supplier_id,supplier_price,company_price,currency,stock,image_url,color,leadtime_days,leadtime_text,moq,moq_tiers,remark,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      [
        b.material_code, b.material_name, b.spec || '', b.unit || 'PCS', b.category || '', b.product_category || '',
        b.supplier_id || null, b.supplier_price || 0, b.company_price || 0, b.currency || 'VND', b.stock || 0, b.image_url || '',
        b.color || '', leadtimeDays, leadtimeText || null, singleMoq, moqTiers.length ? JSON.stringify(moqTiers) : null, b.remark || '', now8(),
      ]
    )
    return c.json({ id: r.insertId, ...b }, 201)
  } catch (e: any) { return c.json({ error: String(e.message) }, 500) }
})
app.put('/api/materials/:id', authMiddleware, requirePerm('bom.edit'), async c => {
  try {
    await ensureMaterialExtraColumns()
    const id = c.req.param('id')
    const b = await c.req.json()
    const existing = await queryOne<any>('SELECT material_code FROM materials WHERE id=? AND deleted_at IS NULL', [id])
    if (!existing) return c.json({ error: 'Not found' }, 404)
    const moqTiers = normalizeMoqTiers(b.moq_tiers)
    const singleMoq = moqTiers.length ? moqTiers[0].moq : (b.moq ? Number(b.moq) : null)
    const leadtimeText = String(b.leadtime_text ?? b.leadtime ?? '').trim()
    const leadtimeDays = leadtimeText
      ? (/^\d+$/.test(leadtimeText) ? Number(leadtimeText) : null)
      : (b.leadtime_days ? Number(b.leadtime_days) : null)
    await execute(
      'UPDATE materials SET material_code=?,material_name=?,spec=?,unit=?,category=?,product_category=?,supplier_id=?,supplier_price=?,company_price=?,currency=?,stock=?,image_url=?,color=?,leadtime_days=?,leadtime_text=?,moq=?,moq_tiers=?,remark=? WHERE id=?',
      [
        existing.material_code, b.material_name, b.spec || '', b.unit || 'PCS', b.category || '', b.product_category || '',
        b.supplier_id || null, b.supplier_price || 0, b.company_price || 0, b.currency || 'VND', b.stock || 0, b.image_url || '',
        b.color || '', leadtimeDays, leadtimeText || null, singleMoq, moqTiers.length ? JSON.stringify(moqTiers) : null, b.remark || '', id,
      ]
    )
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
    await ensureMaterialExtraColumns()
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
          const leadtimeText = String(item.leadtime_text ?? item.leadtime ?? '').trim()
          const leadtimeDays = leadtimeText
            ? (/^\d+$/.test(leadtimeText) ? Number(leadtimeText) : null)
            : (item.leadtime_days ? Number(item.leadtime_days) : null)
          await execute(
            'UPDATE materials SET material_name=?,spec=?,unit=?,category=?,product_category=?,supplier_id=?,supplier_price=?,currency=?,color=?,leadtime_days=?,leadtime_text=?,moq=?,remark=? WHERE material_code=?',
            [
              item.material_name, item.spec || '', item.unit || 'PCS', item.category || '', item.product_category || '',
              supplierId, item.supplier_price || 0, item.currency || 'VND', item.color || '',
              leadtimeDays, leadtimeText || null, item.moq ? Number(item.moq) : null, item.remark || '', item.material_code,
            ]
          )
          updated++
        } else {
          const leadtimeText = String(item.leadtime_text ?? item.leadtime ?? '').trim()
          const leadtimeDays = leadtimeText
            ? (/^\d+$/.test(leadtimeText) ? Number(leadtimeText) : null)
            : (item.leadtime_days ? Number(item.leadtime_days) : null)
          await execute(
            'INSERT INTO materials (material_code,material_name,spec,unit,category,product_category,supplier_id,supplier_price,currency,stock,color,leadtime_days,leadtime_text,moq,remark,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
            [
              item.material_code, item.material_name, item.spec || '', item.unit || 'PCS', item.category || '', item.product_category || '',
              supplierId, item.supplier_price || 0, item.currency || 'VND', 0, item.color || '',
              leadtimeDays, leadtimeText || null, item.moq ? Number(item.moq) : null, item.remark || '', now8(),
            ]
          )
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
  await ensureBomExtraColumns()
  await ensureMaterialExtraColumns()
  await ensureBomItemsExtraColumns()
  await ensureMaterialReferenceColumns()
  const rows = await query<any>(`
    SELECT
      b.*,
      COALESCE(ms.name, s.name, b.supplier_name, '') as supplier_display_name,
      COALESCE(ms.id, b.supplier_id) as linked_supplier_id,
      COALESCE(NULLIF(m.material_name, ''), NULLIF(b.material_name, ''), '') as live_material_name,
      COALESCE(NULLIF(m.spec, ''), NULLIF(b.spec, ''), '') as live_spec,
      COALESCE(NULLIF(m.unit, ''), NULLIF(b.unit, ''), 'PCS') as live_unit,
      COALESCE(NULLIF(m.currency, ''), NULLIF(b.currency, ''), 'VND') as live_currency,
      COALESCE(NULLIF(m.color, ''), NULLIF(b.color, ''), '') as live_color,
      COALESCE(NULLIF(m.leadtime_text, ''), NULLIF(b.lt, ''), '') as live_lt,
      COALESCE(m.moq, b.moq) as live_moq,
      COALESCE(m.moq_tiers, b.moq_tiers) as live_moq_tiers,
      COALESCE(m.supplier_price, b.supplier_price, 0) as live_base_supplier_price,
      COALESCE(m.company_price, b.company_price, 0) as live_base_company_price,
      COALESCE(bs.item_count, 0) as item_count,
      COALESCE(bs.agg_supplier_price, 0) as agg_supplier_price,
      COALESCE(bs.agg_company_price, 0) as agg_company_price
    FROM bom b
    LEFT JOIN suppliers s ON b.supplier_id = s.id AND s.deleted_at IS NULL
    LEFT JOIN materials m ON m.material_code = b.product_sku AND m.deleted_at IS NULL
    LEFT JOIN suppliers ms ON m.supplier_id = ms.id AND ms.deleted_at IS NULL
    LEFT JOIN (
      SELECT
        bom_id,
        COUNT(*) as item_count,
        COALESCE(SUM(COALESCE(m2.supplier_price, bi.supplier_price, 0) * COALESCE(NULLIF(bi.quantity, 0), 1)), 0) as agg_supplier_price,
        COALESCE(SUM(COALESCE(m2.company_price, bi.company_price, 0) * COALESCE(NULLIF(bi.quantity, 0), 1)), 0) as agg_company_price
      FROM bom_items bi
      LEFT JOIN materials m2 ON (
        (bi.material_id IS NOT NULL AND bi.material_id > 0 AND m2.id = bi.material_id)
        OR ((bi.material_id IS NULL OR bi.material_id = 0) AND m2.material_code = bi.material_code)
      ) AND m2.deleted_at IS NULL
      GROUP BY bom_id
    ) bs ON bs.bom_id = b.id
    WHERE b.deleted_at IS NULL
    ORDER BY b.category, b.created_at DESC
  `)
  return c.json(rows.map((row: any) => {
    const itemCount = Number(row.item_count || 0)
    const baseSupplierPrice = toAmount(row.live_base_supplier_price || 0)
    const baseCompanyPrice = toAmount(row.live_base_company_price || 0)
    const effectiveSupplier = itemCount > 0 ? toAmount(row.agg_supplier_price || 0) : baseSupplierPrice
    const effectiveCompany = itemCount > 0 ? toAmount(row.agg_company_price || 0) : baseCompanyPrice
    return {
      ...row,
      supplier_id: row.linked_supplier_id ?? row.supplier_id ?? null,
      supplier_name: row.supplier_display_name || row.supplier_name || '',
      material_name: row.live_material_name || row.material_name || '',
      spec: row.live_spec || row.spec || '',
      unit: row.live_unit || row.unit || 'PCS',
      currency: row.live_currency || row.currency || 'VND',
      color: row.live_color || row.color || '',
      lt: row.live_lt || row.lt || '',
      moq: row.live_moq ?? row.moq ?? null,
      base_supplier_price: baseSupplierPrice,
      base_company_price: baseCompanyPrice,
      supplier_price: effectiveSupplier,
      company_price: effectiveCompany,
      moq_tiers: parseMoqTiersFromDb(row.live_moq_tiers),
    }
  }))
})
app.get('/api/bom/:id', authMiddleware, async c => {
  await ensureBomMoqTiersColumn()
  await ensureBomExtraColumns()
  await ensureMaterialExtraColumns()
  await ensureBomItemsExtraColumns()
  await ensureMaterialReferenceColumns()
  const bom = await queryOne<any>(`
    SELECT
      b.*,
      COALESCE(ms.name, s.name, b.supplier_name, '') as supplier_display_name,
      COALESCE(ms.id, b.supplier_id) as linked_supplier_id,
      COALESCE(NULLIF(m.material_name, ''), NULLIF(b.material_name, ''), '') as live_material_name,
      COALESCE(NULLIF(m.spec, ''), NULLIF(b.spec, ''), '') as live_spec,
      COALESCE(NULLIF(m.unit, ''), NULLIF(b.unit, ''), 'PCS') as live_unit,
      COALESCE(NULLIF(m.currency, ''), NULLIF(b.currency, ''), 'VND') as live_currency,
      COALESCE(NULLIF(m.color, ''), NULLIF(b.color, ''), '') as live_color,
      COALESCE(NULLIF(m.leadtime_text, ''), NULLIF(b.lt, ''), '') as live_lt,
      COALESCE(m.moq, b.moq) as live_moq,
      COALESCE(m.moq_tiers, b.moq_tiers) as live_moq_tiers,
      COALESCE(m.supplier_price, b.supplier_price, 0) as live_base_supplier_price,
      COALESCE(m.company_price, b.company_price, 0) as live_base_company_price,
      COALESCE(bs.item_count, 0) as item_count,
      COALESCE(bs.agg_supplier_price, 0) as agg_supplier_price,
      COALESCE(bs.agg_company_price, 0) as agg_company_price
    FROM bom b
    LEFT JOIN suppliers s ON b.supplier_id = s.id AND s.deleted_at IS NULL
    LEFT JOIN materials m ON m.material_code = b.product_sku AND m.deleted_at IS NULL
    LEFT JOIN suppliers ms ON m.supplier_id = ms.id AND ms.deleted_at IS NULL
    LEFT JOIN (
      SELECT
        bom_id,
        COUNT(*) as item_count,
        COALESCE(SUM(COALESCE(m2.supplier_price, bi.supplier_price, 0) * COALESCE(NULLIF(bi.quantity, 0), 1)), 0) as agg_supplier_price,
        COALESCE(SUM(COALESCE(m2.company_price, bi.company_price, 0) * COALESCE(NULLIF(bi.quantity, 0), 1)), 0) as agg_company_price
      FROM bom_items bi
      LEFT JOIN materials m2 ON (
        (bi.material_id IS NOT NULL AND bi.material_id > 0 AND m2.id = bi.material_id)
        OR ((bi.material_id IS NULL OR bi.material_id = 0) AND m2.material_code = bi.material_code)
      ) AND m2.deleted_at IS NULL
      GROUP BY bom_id
    ) bs ON bs.bom_id = b.id
    WHERE b.id=? AND b.deleted_at IS NULL`, [c.req.param('id')])
  if (!bom) return c.json({ error: 'Not found' }, 404)
  const items = await query(`
    SELECT
      bi.*,
      COALESCE(NULLIF(m.material_name, ''), NULLIF(bi.material_name, ''), '') as material_name,
      COALESCE(NULLIF(m.spec, ''), NULLIF(bi.spec, ''), '') as spec,
      COALESCE(NULLIF(m.unit, ''), NULLIF(bi.unit, ''), 'PCS') as unit,
      COALESCE(NULLIF(ms.name, ''), NULLIF(bi.supplier_name, ''), '') as supplier_name,
      COALESCE(m.supplier_price, bi.supplier_price, 0) as supplier_price,
      COALESCE(m.company_price, bi.company_price, 0) as company_price,
      COALESCE(NULLIF(m.currency, ''), NULLIF(bi.currency, ''), 'VND') as currency,
      COALESCE(NULLIF(m.color, ''), NULLIF(bi.color, ''), '') as color,
      COALESCE(NULLIF(m.leadtime_text, ''), NULLIF(bi.lt, ''), '') as lt,
      COALESCE(m.moq, bi.moq) as moq,
      bi.material_name as mat_name,
      bi.spec as mat_spec,
      bi.unit as mat_unit
    FROM bom_items bi
    LEFT JOIN materials m ON (
      (bi.material_id IS NOT NULL AND bi.material_id > 0 AND m.id = bi.material_id)
      OR ((bi.material_id IS NULL OR bi.material_id = 0) AND m.material_code = bi.material_code)
    ) AND m.deleted_at IS NULL
    LEFT JOIN suppliers ms ON m.supplier_id = ms.id AND ms.deleted_at IS NULL
    WHERE bi.bom_id=?`, [c.req.param('id')])
  const itemCount = Number(bom.item_count || 0)
  const baseSupplierPrice = toAmount(bom.live_base_supplier_price || 0)
  const baseCompanyPrice = toAmount(bom.live_base_company_price || 0)
  const effectiveSupplier = itemCount > 0 ? toAmount(bom.agg_supplier_price || 0) : baseSupplierPrice
  const effectiveCompany = itemCount > 0 ? toAmount(bom.agg_company_price || 0) : baseCompanyPrice
  return c.json({
    ...bom,
    supplier_id: bom.linked_supplier_id ?? bom.supplier_id ?? null,
    supplier_name: bom.supplier_display_name || bom.supplier_name || '',
    material_name: bom.live_material_name || bom.material_name || '',
    spec: bom.live_spec || bom.spec || '',
    unit: bom.live_unit || bom.unit || 'PCS',
    currency: bom.live_currency || bom.currency || 'VND',
    color: bom.live_color || bom.color || '',
    lt: bom.live_lt || bom.lt || '',
    moq: bom.live_moq ?? bom.moq ?? null,
    base_supplier_price: baseSupplierPrice,
    base_company_price: baseCompanyPrice,
    supplier_price: effectiveSupplier,
    company_price: effectiveCompany,
    moq_tiers: parseMoqTiersFromDb(bom.live_moq_tiers),
    items,
  })
})

const parseRequiredMoney = (value: any): number | null => {
  if (value === null || value === undefined || value === '') return null
  const num = Number(value)
  if (!Number.isFinite(num) || num < 0) return null
  return toAmount(num)
}

const calcBomTotals = (rawItems: any): { hasItems: boolean; supplierTotal: number; companyTotal: number } => {
  const items = Array.isArray(rawItems) ? rawItems : []
  if (!items.length) return { hasItems: false, supplierTotal: 0, companyTotal: 0 }
  let supplierTotal = 0
  let companyTotal = 0
  for (const item of items) {
    const qty = Number(item?.quantity)
    const qtyFactor = Number.isFinite(qty) && qty > 0 ? qty : 1
    supplierTotal += (Number(item?.supplier_price) || 0) * qtyFactor
    companyTotal += (Number(item?.company_price) || 0) * qtyFactor
  }
  return { hasItems: true, supplierTotal: toAmount(supplierTotal), companyTotal: toAmount(companyTotal) }
}

const normalizeRequiredText = (value: any): string => String(value ?? '').trim()

app.post('/api/bom', authMiddleware, requirePerm('bom.create'), async c => {
  try {
    await ensureBomMoqTiersColumn()
    await ensureBomExtraColumns()
    const b = await c.req.json()
    const productSku = normalizeRequiredText(b.product_sku)
    const productName = normalizeRequiredText(b.product_name)
    const unit = normalizeRequiredText(b.unit)
    const currency = normalizeRequiredText(b.currency)
    const totals = calcBomTotals(b.items)
    const supplierPrice = totals.hasItems ? totals.supplierTotal : parseRequiredMoney(b.supplier_price)
    const companyPrice = totals.hasItems ? totals.companyTotal : parseRequiredMoney(b.company_price)
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
    const r = await execute(`INSERT INTO bom (product_sku,product_name,material_name,spec,unit,supplier_id,supplier_name,supplier_price,company_price,currency,category,color,lt,moq,cert_code,brand,image_url,version,moq_tiers,status,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [productSku, productName, b.material_name||'', b.spec||'', unit,
       b.supplier_id||null, b.supplier_name||'', supplierPrice, companyPrice,
       currency, b.category||'', b.color||'', b.lt||'', b.moq||null, b.cert_code||'', b.brand||'', b.image_url||'', b.version||'V1',
       moqTiers.length ? JSON.stringify(moqTiers) : null,
       'active', u.userId, now8()])
    const bomId = r.insertId
    if (b.items?.length) {
      for (const item of b.items) {
        const materialId = await resolveMaterialId(item.material_id, item.material_code)
        await execute('INSERT INTO bom_items (bom_id,material_id,material_code,material_name,spec,unit,quantity,supplier_name,supplier_price,company_price,currency,remark,color,lt,moq) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
          [bomId,materialId,item.material_code,item.material_name,item.spec||'',item.unit||'PCS',item.quantity||null,item.supplier_name||'',item.supplier_price||0,item.company_price||0,item.currency||'VND',item.remark||'',item.color||'',item.lt||'',item.moq||null])
      }
    }
    await audit(u, 'CREATE', 'BOM', bomId, `${productSku} ${productName}`)
    return c.json({ id: bomId }, 201)
  } catch (e: any) { return c.json({ error: String(e.message) }, 500) }
})
app.put('/api/bom/:id', authMiddleware, requirePerm('bom.edit'), async c => {
  try {
    await ensureBomMoqTiersColumn()
    await ensureBomExtraColumns()
    const id = c.req.param('id'); const b = await c.req.json(); const u = c.get('user')
    const existing = await queryOne<any>('SELECT product_sku FROM bom WHERE id=? AND deleted_at IS NULL', [id])
    if (!existing) return c.json({ error: 'Not found' }, 404)
    const productName = normalizeRequiredText(b.product_name)
    const unit = normalizeRequiredText(b.unit)
    const currency = normalizeRequiredText(b.currency)
    const totals = calcBomTotals(b.items)
    const supplierPrice = totals.hasItems ? totals.supplierTotal : parseRequiredMoney(b.supplier_price)
    const companyPrice = totals.hasItems ? totals.companyTotal : parseRequiredMoney(b.company_price)
    if (!productName) return c.json({ error: 'product_name required' }, 400)
    if (!unit) return c.json({ error: 'unit required' }, 400)
    if (!currency) return c.json({ error: 'currency required' }, 400)
    if (supplierPrice === null) return c.json({ error: 'supplier_price required and must be >= 0' }, 400)
    if (companyPrice === null) return c.json({ error: 'company_price required and must be >= 0' }, 400)
    const moqTiers = normalizeMoqTiers(b.moq_tiers)
    await execute(`UPDATE bom SET product_sku=?,product_name=?,material_name=?,spec=?,unit=?,supplier_id=?,supplier_name=?,supplier_price=?,company_price=?,currency=?,category=?,color=?,lt=?,moq=?,cert_code=?,brand=?,image_url=?,version=?,moq_tiers=? WHERE id=?`,
      [existing.product_sku, productName, b.material_name||'', b.spec||'', unit,
       b.supplier_id||null, b.supplier_name||'', supplierPrice, companyPrice,
       currency, b.category||'', b.color||'', b.lt||'', b.moq||null, b.cert_code||'', b.brand||'', b.image_url||'', b.version||'V1',
       moqTiers.length ? JSON.stringify(moqTiers) : null,
       id])
    await execute('DELETE FROM bom_items WHERE bom_id=?', [id])
    if (b.items?.length) {
      for (const item of b.items) {
        const materialId = await resolveMaterialId(item.material_id, item.material_code)
        await execute('INSERT INTO bom_items (bom_id,material_id,material_code,material_name,spec,unit,quantity,supplier_name,supplier_price,company_price,currency,remark,color,lt,moq) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
          [id,materialId,item.material_code,item.material_name,item.spec||'',item.unit||'PCS',item.quantity||null,item.supplier_name||'',item.supplier_price||0,item.company_price||0,item.currency||'VND',item.remark||'',item.color||'',item.lt||'',item.moq||null])
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
           COALESCE(NULLIF(m.material_name, ''), NULLIF(pi.material_name, ''), b.product_name, '') as material_name,
           COALESCE(NULLIF(m.spec, ''), NULLIF(pi.spec, ''), b.spec, '') as spec,
           COALESCE(NULLIF(m.unit, ''), NULLIF(pi.unit, ''), b.unit, 'PCS') as unit,
           COALESCE(m.image_url, b.image_url, '') as image_url
    FROM po_items pi 
    LEFT JOIN materials m ON (
      (pi.material_id IS NOT NULL AND pi.material_id > 0 AND pi.material_id = m.id)
      OR ((pi.material_id IS NULL OR pi.material_id = 0) AND pi.material_code = m.material_code)
    ) AND m.deleted_at IS NULL
    LEFT JOIN bom b ON pi.material_code = b.product_sku AND b.deleted_at IS NULL
    WHERE pi.po_id=?`, [c.req.param('id')])
  return c.json({ ...po, items })
})
app.get('/api/po/materials-from-order-po/:poNumber', authMiddleware, requirePerm('po.create'), async c => {
  try {
    const poNumber = String(c.req.param('poNumber') || '').trim()
    if (!poNumber) return c.json({ error: '客戶訂單號不可為空' }, 400)

    const order = await queryOne<any>(`
      SELECT id, po_number, customer_name
      FROM customer_orders
      WHERE po_number=? AND deleted_at IS NULL
      ORDER BY id DESC
      LIMIT 1
    `, [poNumber])
    if (!order) return c.json({ error: `找不到客戶訂單：${poNumber}` }, 404)

    const orderItems = await query<any>(`
      SELECT ci.id as order_item_id, ci.bom_id, ci.qty, ci.po_no, ci.remark,
             b.product_sku, b.product_name, b.spec as bom_spec, b.unit as bom_unit,
             b.supplier_id as bom_supplier_id, b.supplier_name as bom_supplier_name,
             b.supplier_price as bom_supplier_price, b.currency as bom_currency
      FROM customer_order_items ci
      LEFT JOIN bom b ON b.id = ci.bom_id AND b.deleted_at IS NULL
      WHERE ci.order_id=?
      ORDER BY ci.id ASC
    `, [order.id])

    const items: any[] = []
    for (const oi of orderItems) {
      const orderQty = toQty(oi.qty)
      if (orderQty <= 0) continue

      const bomItems = oi.bom_id ? await query<any>(`
        SELECT
          bi.material_id,
          bi.material_code,
          COALESCE(NULLIF(m.material_name, ''), NULLIF(bi.material_name, ''), '') as material_name,
          COALESCE(NULLIF(m.spec, ''), NULLIF(bi.spec, ''), '') as spec,
          COALESCE(NULLIF(m.unit, ''), NULLIF(bi.unit, ''), 'PCS') as unit,
          bi.quantity as bom_qty,
          COALESCE(NULLIF(s.name, ''), NULLIF(bi.supplier_name, ''), '') as bom_supplier_name,
          bi.supplier_price as bom_supplier_price,
          COALESCE(NULLIF(m.currency, ''), NULLIF(bi.currency, ''), 'VND') as bom_currency,
          bi.remark,
          COALESCE(m.supplier_id, NULL) as supplier_id,
          COALESCE(NULLIF(s.name, ''), NULLIF(bi.supplier_name, ''), '') as supplier_name,
          m.supplier_price as material_supplier_price,
          m.currency as material_currency,
          m.moq_tiers,
          m.image_url
        FROM bom_items bi
        LEFT JOIN materials m ON (
          (bi.material_id IS NOT NULL AND bi.material_id > 0 AND bi.material_id = m.id)
          OR ((bi.material_id IS NULL OR bi.material_id = 0) AND bi.material_code = m.material_code)
        ) AND m.deleted_at IS NULL
        LEFT JOIN suppliers s ON m.supplier_id = s.id AND s.deleted_at IS NULL
        WHERE bi.bom_id=?
        ORDER BY bi.id ASC
      `, [oi.bom_id]) : []

      if (bomItems.length > 0) {
        for (const bi of bomItems) {
          const lineQty = toQty(orderQty * toQty(bi.bom_qty || 1))
          if (lineQty <= 0) continue
          const unitPrice = toMoney(
            bi.material_supplier_price ?? bi.bom_supplier_price ?? oi.bom_supplier_price ?? 0
          )
          const supplierName = String(bi.supplier_name || bi.bom_supplier_name || oi.bom_supplier_name || '')
          const supplierId = bi.supplier_id ? Number(bi.supplier_id) : null
          items.push({
            source_order_id: Number(order.id),
            source_order_item_id: Number(oi.order_item_id),
            source_order_po_number: String(order.po_number || ''),
            po_ref: String(oi.po_no || order.po_number || ''),
            bom_id: oi.bom_id ? Number(oi.bom_id) : null,
            bom_sku: String(oi.product_sku || ''),
            bom_name: String(oi.product_name || ''),
            material_id: bi.material_id ? Number(bi.material_id) : null,
            material_code: String(bi.material_code || ''),
            material_name: String(bi.material_name || ''),
            spec: String(bi.spec || ''),
            unit: String(bi.unit || 'PCS'),
            quantity: lineQty,
            unit_price: unitPrice,
            total_price: toMoney(lineQty * unitPrice),
            currency: String(bi.material_currency || bi.bom_currency || oi.bom_currency || 'VND'),
            remark: String(bi.remark || oi.remark || ''),
            supplier_id: supplierId,
            supplier_name: supplierName,
            moq_tiers: parseMoqTiersFromDb(bi.moq_tiers),
            image_url: String(bi.image_url || ''),
          })
        }
      } else {
        const unitPrice = toMoney(oi.bom_supplier_price || 0)
        items.push({
          source_order_id: Number(order.id),
          source_order_item_id: Number(oi.order_item_id),
          source_order_po_number: String(order.po_number || ''),
          po_ref: String(oi.po_no || order.po_number || ''),
          bom_id: oi.bom_id ? Number(oi.bom_id) : null,
          bom_sku: String(oi.product_sku || ''),
          bom_name: String(oi.product_name || ''),
          material_id: null,
          material_code: String(oi.product_sku || ''),
          material_name: String(oi.product_name || ''),
          spec: String(oi.bom_spec || ''),
          unit: String(oi.bom_unit || 'PCS'),
          quantity: orderQty,
          unit_price: unitPrice,
          total_price: toMoney(orderQty * unitPrice),
          currency: String(oi.bom_currency || 'VND'),
          remark: String(oi.remark || ''),
          supplier_id: oi.bom_supplier_id ? Number(oi.bom_supplier_id) : null,
          supplier_name: String(oi.bom_supplier_name || ''),
          moq_tiers: [],
          image_url: '',
        })
      }
    }

    const supplierMap = new Map<number, { supplier_id: number; supplier_name: string; count: number }>()
    for (const row of items) {
      if (!row.supplier_id) continue
      if (!supplierMap.has(row.supplier_id)) supplierMap.set(row.supplier_id, { supplier_id: row.supplier_id, supplier_name: row.supplier_name || '', count: 0 })
      supplierMap.get(row.supplier_id)!.count += 1
    }

    return c.json({
      order: { id: Number(order.id), po_number: String(order.po_number || ''), customer_name: String(order.customer_name || '') },
      items,
      suppliers: Array.from(supplierMap.values()),
    })
  } catch (e: any) {
    return c.json({ error: String(e.message) }, 500)
  }
})
app.post('/api/po', authMiddleware, requirePerm('po.create'), async c => {
  try {
    const b = await c.req.json()
    const u = c.get('user')
    const customPoNumber = String(b.po_number || '').trim()
    const poNum = customPoNumber || `PO${Date.now()}`
    const existingPo = await queryOne<any>('SELECT id FROM purchase_orders WHERE po_number=? AND deleted_at IS NULL', [poNum])
    if (existingPo) return c.json({ error: `採購單號「${poNum}」已存在，請使用不同編號` }, 409)
    const subTotal = (b.items||[]).reduce((s: number, i: any) => s + (i.total_price||0), 0)
    const taxRate = Math.min(25, Math.max(1, Number(b.tax_rate) || 8))
    const total = Math.round(subTotal * (1 + taxRate / 100) * 100) / 100
    const r = await execute('INSERT INTO purchase_orders (po_number,supplier_id,supplier_name,status,total_amount,tax_rate,currency,created_by,remark,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
      [poNum,b.supplier_id||null,b.supplier_name,'draft',total,taxRate,b.currency||'VND',u.userId,b.remark||'',now8()])
    const poId = r.insertId
    if (b.items?.length) {
      for (const item of b.items) {
        const tp = (item.quantity||0)*(item.unit_price||0)
        await execute('INSERT INTO po_items (po_id,material_id,material_code,material_name,spec,unit,quantity,unit_price,total_price,currency,remark,po_ref,thickness) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
          [poId,item.material_id||null,item.material_code,item.material_name,item.spec||'',item.unit||'PCS',item.quantity,item.unit_price||0,tp,item.currency||'VND',item.remark||'',item.po_ref||'',item.thickness||null])
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
        await execute('INSERT INTO po_items (po_id,material_id,material_code,material_name,spec,unit,quantity,unit_price,total_price,currency,remark,po_ref,thickness) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
          [id,item.material_id||null,item.material_code,item.material_name,item.spec||'',item.unit||'PCS',item.quantity,item.unit_price||0,tp,item.currency||'VND',item.remark||'',item.po_ref||'',item.thickness||null])
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
             COALESCE(SUM(ci.qty), 0) as order_total_qty,
             COALESCE(SUM(ci.arrived_qty), 0) as shipped_total_qty,
             GREATEST(0, COALESCE(SUM(ci.qty), 0) - COALESCE(SUM(ci.arrived_qty), 0)) as balance_total_qty,
             CASE
               WHEN COALESCE(SUM(ci.qty), 0) <= 0 THEN 0
               ELSE ROUND(COALESCE(SUM(ci.arrived_qty), 0) / COALESCE(SUM(ci.qty), 0) * 100, 2)
             END as completion_rate,
             c.customer_name, c.customer_code
      FROM customer_orders co
      LEFT JOIN customers c ON co.customer_id = c.id AND c.deleted_at IS NULL
      LEFT JOIN customer_order_items ci ON ci.order_id = co.id
      ${whereClause}
      GROUP BY co.id
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
app.get('/api/customer-orders/material-options', authMiddleware, async c => {
  const orderIds = uniqueNumberList(String(c.req.query('order_ids') || '').split(','))
  if (!orderIds.length) return c.json([])

  const rows = await query<any>(`
    SELECT
      COALESCE(bi.material_id, 0) as material_id,
      TRIM(COALESCE(bi.material_code, '')) as material_code,
      TRIM(COALESCE(NULLIF(m.material_name, ''), bi.material_name, '')) as material_name,
      TRIM(COALESCE(NULLIF(m.spec, ''), bi.spec, '')) as spec,
      TRIM(COALESCE(NULLIF(m.unit, ''), NULLIF(bi.unit, ''), 'PCS')) as unit,
      COALESCE(SUM(COALESCE(ci.qty, 0) * COALESCE(bi.quantity, 0)), 0) as suggested_qty,
      MIN(ci.rta_date) as due_date,
      GROUP_CONCAT(DISTINCT co.po_number ORDER BY co.po_number SEPARATOR ', ') as order_po_numbers,
      GROUP_CONCAT(DISTINCT NULLIF(ci.po_no, '') ORDER BY ci.po_no SEPARATOR ', ') as customer_po_numbers,
      GROUP_CONCAT(DISTINCT b.product_sku ORDER BY b.product_sku SEPARATOR ', ') as bom_skus,
      GROUP_CONCAT(DISTINCT b.product_name ORDER BY b.product_name SEPARATOR ', ') as bom_names,
      COUNT(DISTINCT ci.id) as order_item_count
    FROM customer_order_items ci
    JOIN customer_orders co ON co.id = ci.order_id AND co.deleted_at IS NULL
    JOIN bom b ON b.id = ci.bom_id AND b.deleted_at IS NULL
    JOIN bom_items bi ON bi.bom_id = b.id
    LEFT JOIN materials m ON (
      (bi.material_id IS NOT NULL AND bi.material_id > 0 AND bi.material_id = m.id)
      OR ((bi.material_id IS NULL OR bi.material_id = 0) AND bi.material_code = m.material_code)
    ) AND m.deleted_at IS NULL
    WHERE ci.order_id IN (${orderIds.map(() => '?').join(',')})
    GROUP BY
      COALESCE(bi.material_id, 0),
      TRIM(COALESCE(bi.material_code, '')),
      TRIM(COALESCE(NULLIF(m.material_name, ''), bi.material_name, '')),
      TRIM(COALESCE(NULLIF(m.spec, ''), bi.spec, '')),
      TRIM(COALESCE(NULLIF(m.unit, ''), NULLIF(bi.unit, ''), 'PCS'))
    ORDER BY material_name ASC, material_code ASC, spec ASC
  `, orderIds)

  return c.json(rows.map((row: any, index: number) => ({
    id: `${Number(row.material_id || 0)}::${String(row.material_code || '').trim()}::${String(row.spec || '').trim()}::${String(row.unit || '').trim()}::${index}`,
    material_id: Number(row.material_id || 0) || null,
    material_code: String(row.material_code || '').trim(),
    material_name: String(row.material_name || '').trim(),
    spec: String(row.spec || '').trim(),
    unit: String(row.unit || 'PCS').trim() || 'PCS',
    suggested_qty: toQty(row.suggested_qty),
    due_date: row.due_date || null,
    order_po_numbers: uniquePoNumbers(String(row.order_po_numbers || '').split(',')),
    customer_po_numbers: uniquePoNumbers(String(row.customer_po_numbers || '').split(',')),
    bom_skus: uniquePoNumbers(String(row.bom_skus || '').split(',')),
    bom_names: String(row.bom_names || '').split(',').map((it: string) => it.trim()).filter(Boolean),
    order_item_count: Number(row.order_item_count || 0),
  })))
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
    SELECT ci.id, ci.order_id, ci.bom_id, ci.qty, ci.unit_price, ci.rta_date, ci.po_no, ci.remark,
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
    const customerName = cust?.customer_name || b.customer_name || ''
    // No tax for customer orders
    const subtotal = (b.items||[]).reduce((s: number, i: any) => s + (i.qty||0) * (i.unit_price||0), 0)
    const taxRate = 0
    const taxAmount = 0
    const totalAmount = subtotal
    const firstItemRta = (b.items || []).find((i: any) => i?.rta_date)?.rta_date || null
    const r = await execute('INSERT INTO customer_orders (po_date,po_number,customer_id,customer_name,status,remark,tax_rate,tax_amount,total_amount,currency,delivery_date,delivery_address,person_in_charge,payment_terms,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      [b.po_date||null, b.po_number, b.customer_id, customerName, b.status||'pending', b.remark||'',
       taxRate, taxAmount, totalAmount, b.currency||'VND',
       b.delivery_date||firstItemRta, b.delivery_address||'', b.person_in_charge||'', b.payment_terms||cust?.payment_terms||'',
       now8()])
    const orderId = r.insertId
    if (b.items?.length) {
      for (const item of b.items) {
        if (!item.bom_id) continue  // skip items without BOM
        await execute('INSERT INTO customer_order_items (order_id,bom_id,qty,unit_price,rta_date,po_no,remark,arrived_qty,balance,status) VALUES (?,?,?,?,?,?,?,?,?,?)',
          [orderId, item.bom_id, item.qty||0, item.unit_price||0, item.rta_date||null, item.po_no||'', item.remark||'', 0, item.qty||0, 'pending'])
      }
    }
    await audit(c.get('user'), 'CREATE', '客戶訂單', orderId, `${b.po_number} / ${cust?.customer_name||b.customer_id}`)

    // Auto-create a draft delivery note with same items
    const dnNum = `DN${Date.now()}`
    const dnR = await execute(
      'INSERT INTO delivery_notes (dn_number,customer_id,customer_name,customer_order_id,delivery_date,status,remark,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?)',
      [dnNum, b.customer_id, customerName, orderId, b.po_date||null, 'draft', b.remark||'', c.get('user').userId, now8()]
    )
    const dnId = dnR.insertId
    if (b.items?.length) {
      for (const item of b.items) {
        if (!item.bom_id) continue
        // Get BOM info for item_name, material_code, spec, unit
        const bom = await queryOne<any>('SELECT product_sku, product_name, spec, unit FROM bom WHERE id=? AND deleted_at IS NULL', [item.bom_id])
        const materialId = await resolveMaterialId(null, bom?.product_sku || '')
        await execute(
          'INSERT INTO delivery_note_items (dn_id,material_id,item_name,material_code,spec,unit,qty,remark,po_ref,thickness) VALUES (?,?,?,?,?,?,?,?,?,?)',
          [dnId, materialId, bom?.product_name||'', bom?.product_sku||'', bom?.spec||'', bom?.unit||'PCS', item.qty||0, '', item.po_no||b.po_number||'', null]
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
    const cust = b.customer_id
      ? await queryOne<any>('SELECT customer_name, payment_terms FROM customers WHERE id=? AND deleted_at IS NULL', [b.customer_id])
      : null
    const customerName = cust?.customer_name || b.customer_name || ''
    const subtotal = (b.items||[]).reduce((s: number, i: any) => s + (i.qty||0) * (i.unit_price||0), 0)
    const taxRate = 0
    const taxAmount = 0
    const totalAmount = subtotal
    const firstItemRta = (b.items || []).find((i: any) => i?.rta_date)?.rta_date || null
    await execute('UPDATE customer_orders SET po_date=?,po_number=?,customer_id=?,customer_name=?,remark=?,tax_rate=?,tax_amount=?,total_amount=?,currency=?,delivery_date=?,delivery_address=?,person_in_charge=?,payment_terms=? WHERE id=?',
      [b.po_date||null, existing.po_number, b.customer_id, customerName, b.remark||'', taxRate, taxAmount, totalAmount, b.currency||'VND', b.delivery_date||firstItemRta, b.delivery_address||'', b.person_in_charge||'', b.payment_terms||cust?.payment_terms||'', id])
    // Replace items
    await execute('DELETE FROM customer_order_items WHERE order_id=?', [id])
    if (b.items?.length) {
      for (const item of b.items) {
        if (!item.bom_id) continue
        await execute('INSERT INTO customer_order_items (order_id,bom_id,qty,unit_price,rta_date,po_no,remark,arrived_qty,balance,status) VALUES (?,?,?,?,?,?,?,?,?,?)',
          [id, item.bom_id, item.qty||0, item.unit_price||0, item.rta_date||null, item.po_no||'', item.remark||'', 0, item.qty||0, 'pending'])
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
  SELECT q.*, COALESCE(c.customer_name, q.customer_name) as customer_name, c.customer_code
  FROM quotations q LEFT JOIN customers c ON q.customer_id = c.id AND c.deleted_at IS NULL
  WHERE q.deleted_at IS NULL
  ORDER BY q.created_at DESC
`)))
app.get('/api/quotations/:id', authMiddleware, async c => {
  const q = await queryOne<any>(`
    SELECT q.*, COALESCE(c.customer_name, q.customer_name) as customer_name, c.customer_code
    FROM quotations q LEFT JOIN customers c ON q.customer_id = c.id AND c.deleted_at IS NULL
    WHERE q.id=? AND q.deleted_at IS NULL`, [c.req.param('id')])
  if (!q) return c.json({ error: 'Not found' }, 404)
  const rawItems = await query<any>(`
    SELECT
      qi.*,
      COALESCE(NULLIF(m.material_name, ''), NULLIF(qi.item_name, ''), '') as item_name,
      COALESCE(NULLIF(m.spec, ''), NULLIF(qi.spec, ''), '') as spec,
      COALESCE(NULLIF(m.unit, ''), NULLIF(qi.unit, ''), 'PCS') as unit,
      COALESCE(m.image_url, qi.image_url, '') as image_url,
      COALESCE(m.moq_tiers, qi.moq) as moq_source
    FROM quotation_items qi
    LEFT JOIN materials m ON (
      (qi.material_id IS NOT NULL AND qi.material_id > 0 AND qi.material_id = m.id)
      OR ((qi.material_id IS NULL OR qi.material_id = 0) AND qi.material_code = m.material_code)
    ) AND m.deleted_at IS NULL
    WHERE qi.quotation_id=?
  `, [c.req.param('id')])
  // Parse moq JSON into moq_tiers array
  const items = rawItems.map((item: any) => {
    let moq_tiers: {moq:number;price:number}[] = []
    if (item.moq_source) {
      try {
        const parsed = JSON.parse(String(item.moq_source))
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
        const materialId = await resolveMaterialId(item.material_id, item.material_code)
        await execute('INSERT INTO quotation_items (quotation_id,material_id,item_name,material_code,spec,unit,qty,unit_price,total_price,remark,moq,image_url) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
          [qId,materialId,item.item_name,item.material_code||'',item.spec||'',item.unit||'PCS',item.qty,item.unit_price||0,(item.qty||0)*(item.unit_price||0),item.remark||'',item.moq||null,item.image_url||null])
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
        const materialId = await resolveMaterialId(item.material_id, item.material_code)
        await execute('INSERT INTO quotation_items (quotation_id,material_id,item_name,material_code,spec,unit,qty,unit_price,total_price,remark,moq,image_url) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
          [id,materialId,item.item_name,item.material_code||'',item.spec||'',item.unit||'PCS',item.qty,item.unit_price||0,(item.qty||0)*(item.unit_price||0),item.remark||'',item.moq||null,item.image_url||null])
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

// ── Order Intake Pool + Shipment Reconciliation ─────────────────────────────
app.get('/api/order-intake', authMiddleware, async c => {
  try {
    const url = new URL(c.req.url)
    const search = (url.searchParams.get('search') || '').trim()
    const status = (url.searchParams.get('status') || '').trim()
    const customerId = (url.searchParams.get('customer_id') || '').trim()
    const page = parsePositiveInt(url.searchParams.get('page'), 1, 1000000)
    const pageSize = parsePositiveInt(url.searchParams.get('page_size'), 200, 1000)
    const offset = (page - 1) * pageSize
    const where: string[] = ['dp.deleted_at IS NULL']
    const params: any[] = []

    if (customerId) { where.push('dp.customer_id=?'); params.push(customerId) }
    if (search) {
      where.push('(COALESCE(po_links.po_numbers, dp.order_po_number, \'\') LIKE ? OR dp.customer_name LIKE ? OR COALESCE(item_stats.material_names, \'\') LIKE ? OR dp.progress_no LIKE ?)')
      const term = `%${search}%`
      params.push(term, term, term, term)
    }
    if (status === 'open') {
      where.push("dp.status IN ('pending','partial')")
    } else if (status) {
      where.push('dp.status=?')
      params.push(status)
    }

    const rows = await query<any>(`
      SELECT
        dp.id,
        dp.progress_no,
        dp.customer_id,
        dp.customer_name,
        dp.customer_order_id,
        COALESCE(po_links.po_numbers, dp.order_po_number, '') as po_number,
        dp.status,
        dp.remark,
        dp.created_at,
        COALESCE(item_stats.item_count, 0) as item_count,
        COALESCE(item_stats.material_names, '') as material_names,
        COALESCE(item_stats.total_planned_qty, 0) as planned_qty,
        item_stats.due_date,
        COALESCE(item_stats.purchase_gap_qty, 0) as purchase_gap_qty,
        COALESCE(item_stats.purchased_qty, 0) as purchased_qty,
        COALESCE(po_links.linked_po_count, 0) as linked_po_count,
        COALESCE(po_links.order_count, 0) as order_count
      FROM delivery_progress dp
      LEFT JOIN (
        SELECT
          progress_id,
          GROUP_CONCAT(DISTINCT order_po_number ORDER BY order_po_number SEPARATOR ', ') as po_numbers,
          COUNT(DISTINCT order_po_number) as linked_po_count,
          COUNT(DISTINCT customer_order_id) as order_count
        FROM delivery_progress_po_links
        WHERE deleted_at IS NULL
        GROUP BY progress_id
      ) po_links ON po_links.progress_id = dp.id
      LEFT JOIN (
        SELECT
          dpi.progress_id,
          COUNT(*) as item_count,
          GROUP_CONCAT(DISTINCT dpi.material_name ORDER BY dpi.material_name SEPARATOR ', ') as material_names,
          GROUP_CONCAT(DISTINCT NULLIF(dpi.order_po_number, '') ORDER BY dpi.order_po_number SEPARATOR ', ') as item_po_numbers,
          COALESCE(SUM(dpi.planned_qty), 0) as total_planned_qty,
          MIN(dpi.due_date) as due_date,
          COALESCE(SUM(COALESCE(purchased.qty, 0)), 0) as purchased_qty,
          COALESCE(SUM(GREATEST(COALESCE(dpi.planned_qty, 0) - COALESCE(purchased.qty, 0), 0)), 0) as purchase_gap_qty
        FROM delivery_progress_items dpi
        LEFT JOIN (
          SELECT
            pi.progress_item_id,
            COALESCE(SUM(pi.quantity), 0) as qty
          FROM po_items pi
          JOIN purchase_orders po ON po.id = pi.po_id
          WHERE po.deleted_at IS NULL
            AND po.status <> 'cancelled'
            AND pi.progress_item_id IS NOT NULL
          GROUP BY pi.progress_item_id
        ) purchased ON purchased.progress_item_id = dpi.id
        WHERE dpi.deleted_at IS NULL
        GROUP BY dpi.progress_id
      ) item_stats ON item_stats.progress_id = dp.id
      WHERE ${where.join(' AND ')}
      ORDER BY dp.created_at DESC, dp.id DESC
      LIMIT ${pageSize} OFFSET ${offset}
    `, params)

    return c.json(rows.map((row: any) => {
      const fallbackPoCount = uniquePoNumbers([row.po_number]).length
      const fallbackOrderCount = Number(row.customer_order_id || 0) > 0 ? 1 : 0
      return {
        ...row,
        material_name: String(row.material_names || '').trim(),
        po_number: String(row.item_po_numbers || row.po_number || '').trim(),
        material_code: '',
        spec: '',
        unit: '',
        planned_qty: toQty(row.planned_qty),
        purchased_qty: toQty(row.purchased_qty),
        purchase_gap_qty: toQty(row.purchase_gap_qty),
        linked_po_count: Math.max(Number(row.linked_po_count || 0), fallbackPoCount),
        order_count: Math.max(Number(row.order_count || 0), fallbackOrderCount),
        item_count: Number(row.item_count || 0),
        due_date: row.due_date || null,
      }
    }))
  } catch (e: any) {
    return c.json({ error: String(e.message) }, 500)
  }
})

app.get('/api/order-intake/:id', authMiddleware, async c => {
  const id = c.req.param('id')
  const row = await queryOne<any>(`
    SELECT dp.*
    FROM delivery_progress dp
    WHERE dp.id=? AND dp.deleted_at IS NULL
  `, [id])
  if (!row) return c.json({ error: 'Not found' }, 404)

  const poLinks = await query<any>(
    'SELECT customer_order_id, order_po_number FROM delivery_progress_po_links WHERE progress_id=? AND deleted_at IS NULL ORDER BY id ASC',
    [id],
  )
  const items = await query<any>(`
    SELECT
      dpi.*,
      COALESCE(purchased.qty, 0) as purchased_qty
    FROM delivery_progress_items dpi
    LEFT JOIN (
      SELECT
        pi.progress_item_id,
        COALESCE(SUM(pi.quantity), 0) as qty
      FROM po_items pi
      JOIN purchase_orders po ON po.id = pi.po_id
      WHERE po.deleted_at IS NULL
        AND po.status <> 'cancelled'
        AND pi.progress_item_id IS NOT NULL
      GROUP BY pi.progress_item_id
    ) purchased ON purchased.progress_item_id = dpi.id
    WHERE dpi.progress_id=? AND dpi.deleted_at IS NULL
    ORDER BY dpi.id ASC
  `, [id])
  const poNumbers = uniquePoNumbers(poLinks.map((it) => it.order_po_number).concat(row.order_po_number ? [row.order_po_number] : []))
  const customerOrderIds = uniqueNumberList(poLinks.map((it) => it.customer_order_id))
  const normalizedItems = items.map((item: any) => {
    const plannedQty = toQty(item.planned_qty)
    const purchasedQty = toQty(item.purchased_qty)
    return {
      ...item,
      order_po_number: String(item.order_po_number || '').trim(),
      planned_qty: plannedQty,
      purchased_qty: purchasedQty,
      purchase_gap_qty: toQty(Math.max(0, plannedQty - purchasedQty)),
    }
  })
  const totalPlannedQty = normalizedItems.reduce((sum, item) => sum + toQty(item.planned_qty), 0)
  const totalPurchasedQty = normalizedItems.reduce((sum, item) => sum + toQty(item.purchased_qty), 0)
  return c.json({
    ...row,
    po_numbers: poNumbers,
    customer_order_ids: customerOrderIds,
    items: normalizedItems,
    planned_qty: toQty(totalPlannedQty),
    purchased_qty: toQty(totalPurchasedQty),
    purchase_gap_qty: toQty(Math.max(0, totalPlannedQty - totalPurchasedQty)),
    linked_po_count: poNumbers.length,
    order_count: customerOrderIds.length || (Number(row.customer_order_id || 0) > 0 ? 1 : 0),
    item_count: normalizedItems.length,
  })
})

app.post('/api/order-intake', authMiddleware, requirePerm('customer_order.create'), async c => {
  try {
    const b = await c.req.json()
    const u = c.get('user')
    const customerOrderIds: number[] = Array.isArray(b?.customer_order_ids)
      ? Array.from(new Set<number>(b.customer_order_ids.map((it: any) => Number(it)).filter((it: number) => Number.isFinite(it) && it > 0)))
      : []
    let customerId: number | null = b?.customer_id ? Number(b.customer_id) : null
    let customerName = String(b?.customer_name || '').trim()
    const itemsInput = Array.isArray(b?.items) ? b.items : []
    const items = itemsInput
      .map((item: any) => ({
        order_po_number: String(item?.order_po_number || '').trim(),
        material_code: String(item?.material_code || item?.material_name || '').trim(),
        material_name: String(item?.material_name || '').trim(),
        spec: String(item?.spec || '').trim(),
        unit: String(item?.unit || 'PCS').trim() || 'PCS',
        planned_qty: toQty(item?.planned_qty),
        due_date: item?.due_date || null,
        status: ['pending', 'partial', 'completed'].includes(String(item?.status || '')) ? String(item?.status) : 'pending',
        remark: String(item?.remark || '').trim(),
      }))
      .filter((item: any) => item.material_name && item.planned_qty > 0)
    let poNumbers = uniquePoNumbers(items.map((item: any) => item.order_po_number))

    if (!items.length) return c.json({ error: 'items required' }, 400)
    if (!customerName && customerId) {
      const cust = await queryOne<any>('SELECT customer_name FROM customers WHERE id=? AND deleted_at IS NULL', [customerId])
      customerName = String(cust?.customer_name || '')
    }
    if (!customerName) return c.json({ error: 'customer_name 必填' }, 400)

    if (customerOrderIds.length) {
      const linkedOrders = await query<any>(
        `SELECT id, po_number, customer_id FROM customer_orders WHERE id IN (${customerOrderIds.map(() => '?').join(',')}) AND deleted_at IS NULL`,
        customerOrderIds,
      )
      if (linkedOrders.length !== customerOrderIds.length) return c.json({ error: '部分客戶訂單不存在' }, 400)
      const linkedCustomerIds = uniqueNumberList(linkedOrders.map((it) => it.customer_id))
      if (linkedCustomerIds.length > 1) return c.json({ error: '關聯客戶訂單必須屬於同一客戶' }, 400)
      if (customerId && linkedCustomerIds.length && customerId !== linkedCustomerIds[0]) return c.json({ error: '所選客戶與關聯客戶訂單不一致' }, 400)
      poNumbers = uniquePoNumbers([...poNumbers, ...linkedOrders.map((it) => it.po_number)])
      if (!customerId && linkedCustomerIds[0]) customerId = linkedCustomerIds[0]
      if (!customerName && customerId) {
        const cust = await queryOne<any>('SELECT customer_name FROM customers WHERE id=? AND deleted_at IS NULL', [customerId])
        customerName = String(cust?.customer_name || customerName || '')
      }
    }

    const progressNo = `DP${Date.now()}`
    const firstItem = items[0]
    const r = await execute(`
      INSERT INTO delivery_progress
        (progress_no, customer_id, customer_name, customer_order_id, order_item_id, order_po_number, delivery_location, material_code, material_name, spec, unit, planned_qty, due_date, status, remark, created_by, created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `, [
      progressNo,
      customerId,
      customerName,
      customerOrderIds[0] || null,
      null,
      firstItem.order_po_number || poNumbers[0] || '',
      '',
      firstItem.material_code || '',
      firstItem.material_name || '',
      firstItem.spec || '',
      firstItem.unit || 'PCS',
      items.reduce((sum: number, item: any) => sum + toQty(item.planned_qty), 0),
      firstItem.due_date ? toDateStr(firstItem.due_date) : null,
      'pending',
      String(b?.remark || ''),
      u?.userId || null,
      now8(),
    ])
    await syncDeliveryProgressPoLinks(
      r.insertId,
      customerOrderIds,
      poNumbers,
      u?.userId || null,
    )
    await syncDeliveryProgressItems(r.insertId, items, u?.userId || null)
    await audit(u, 'CREATE', '交期進度', r.insertId, `${progressNo} / ${customerName}`)
    return c.json({ id: r.insertId, progress_no: progressNo }, 201)
  } catch (e: any) {
    return c.json({ error: String(e.message) }, 500)
  }
})

app.put('/api/order-intake/:id', authMiddleware, requirePerm('customer_order.create'), async c => {
  try {
    const id = c.req.param('id')
    const b = await c.req.json()
    const row = await queryOne<any>('SELECT id FROM delivery_progress WHERE id=? AND deleted_at IS NULL', [id])
    if (!row) return c.json({ error: 'Not found' }, 404)
    const customerOrderIds: number[] = Array.isArray(b?.customer_order_ids)
      ? Array.from(new Set<number>(b.customer_order_ids.map((it: any) => Number(it)).filter((it: number) => Number.isFinite(it) && it > 0)))
      : []
    const itemsInput = Array.isArray(b?.items) ? b.items : []
    const items = itemsInput
      .map((item: any) => ({
        order_po_number: String(item?.order_po_number || '').trim(),
        material_code: String(item?.material_code || item?.material_name || '').trim(),
        material_name: String(item?.material_name || '').trim(),
        spec: String(item?.spec || '').trim(),
        unit: String(item?.unit || 'PCS').trim() || 'PCS',
        planned_qty: toQty(item?.planned_qty),
        due_date: item?.due_date || null,
        status: ['pending', 'partial', 'completed'].includes(String(item?.status || '')) ? String(item?.status) : 'pending',
        remark: String(item?.remark || '').trim(),
      }))
      .filter((item: any) => item.material_name && item.planned_qty > 0)
    const poNumbers = uniquePoNumbers(items.map((item: any) => item.order_po_number))
    if (!items.length) return c.json({ error: 'items required' }, 400)
    const firstItem = items[0]
    await execute(`
      UPDATE delivery_progress
      SET due_date=?, planned_qty=?, remark=?, status=?, order_po_number=?, material_name=?, spec=?, unit=?, delivery_location=?
      WHERE id=? AND deleted_at IS NULL
    `, [
      firstItem.due_date ? toDateStr(firstItem.due_date) : null,
      items.reduce((sum: number, item: any) => sum + toQty(item.planned_qty), 0),
      b?.remark || '',
      ['pending', 'partial', 'completed'].includes(String(b?.status || '')) ? String(b.status) : 'pending',
      firstItem.order_po_number || poNumbers[0] || '',
      firstItem.material_name || '',
      firstItem.spec || '',
      firstItem.unit || 'PCS',
      '',
      id,
    ])
    await syncDeliveryProgressPoLinks(Number(id), customerOrderIds, poNumbers, c.get('user')?.userId || null)
    await syncDeliveryProgressItems(Number(id), items, c.get('user')?.userId || null)
    await audit(c.get('user'), 'UPDATE', '交期進度', id, `id=${id}`)
    return c.json({ ok: true })
  } catch (e: any) {
    return c.json({ error: String(e.message) }, 500)
  }
})

app.delete('/api/order-intake/:id', authMiddleware, requirePerm('customer_order.delete'), async c => {
  const id = c.req.param('id')
  const userId = c.get('user')?.userId || null
  const row = await queryOne<any>('SELECT progress_no, customer_name FROM delivery_progress WHERE id=? AND deleted_at IS NULL', [id])
  if (!row) return c.json({ error: 'Not found' }, 404)
  await softDeleteById('delivery_progress', id, userId)
  await execute('UPDATE delivery_progress_po_links SET deleted_at=?, deleted_by=? WHERE progress_id=? AND deleted_at IS NULL', [now8(), userId, id])
  await execute('UPDATE delivery_progress_items SET deleted_at=?, deleted_by=? WHERE progress_id=? AND deleted_at IS NULL', [now8(), userId, id])
  await audit(c.get('user'), 'DELETE', '交期進度', id, `${row?.progress_no} / ${row?.customer_name}`)
  return c.json({ ok: true })
})

app.post('/api/order-intake/:id/generate-po', authMiddleware, requirePerm('po.create'), async c => {
  try {
    const id = c.req.param('id')
    const u = c.get('user')
    const progress = await queryOne<any>(`
      SELECT *
      FROM delivery_progress
      WHERE id=? AND deleted_at IS NULL
    `, [id])
    if (!progress) return c.json({ error: '交期進度不存在' }, 404)

    const progressItems = await query<any>(`
      SELECT
        dpi.*,
        COALESCE(purchased.qty, 0) as purchased_qty
      FROM delivery_progress_items dpi
      LEFT JOIN (
        SELECT
          pi.progress_item_id,
          COALESCE(SUM(pi.quantity), 0) as qty
        FROM po_items pi
        JOIN purchase_orders po ON po.id = pi.po_id
        WHERE po.deleted_at IS NULL
          AND po.status <> 'cancelled'
          AND pi.progress_item_id IS NOT NULL
        GROUP BY pi.progress_item_id
      ) purchased ON purchased.progress_item_id = dpi.id
      WHERE dpi.progress_id=? AND dpi.deleted_at IS NULL
      ORDER BY dpi.id ASC
    `, [id])
    if (!progressItems.length) return c.json({ error: '交期進度明細不存在' }, 404)

    let payload: any = {}
    try { payload = await c.req.json() } catch { payload = {} }
    const poBaseNumber = String(payload?.po_number_base || '').trim()
    const poRefs = await query<any>(
      'SELECT order_po_number FROM delivery_progress_po_links WHERE progress_id=? AND deleted_at IS NULL ORDER BY id ASC',
      [id],
    )
    const poRef = uniquePoNumbers(poRefs.map((it) => it.order_po_number).concat(progress.order_po_number ? [progress.order_po_number] : [])).join(', ') || String(progress.progress_no || '')
    const grouped = new Map<string, { supplierId: number | null; supplierName: string; items: any[] }>()

    for (const item of progressItems) {
      const plannedQty = toQty(item.planned_qty)
      const purchasedQty = toQty(item.purchased_qty)
      const remainingQty = toQty(Math.max(0, plannedQty - purchasedQty))
      if (remainingQty <= 0) continue

      const bom = await queryOne<any>(`
        SELECT
          COALESCE(m.supplier_id, b.supplier_id) as supplier_id,
          COALESCE(ms.name, b.supplier_name, '') as supplier_name,
          COALESCE(m.supplier_price, b.supplier_price, 0) as supplier_price,
          COALESCE(m.company_price, b.company_price, 0) as company_price
        FROM bom b
        LEFT JOIN materials m ON m.material_code = b.product_sku AND m.deleted_at IS NULL
        LEFT JOIN suppliers ms ON ms.id = m.supplier_id AND ms.deleted_at IS NULL
        WHERE b.product_sku=? AND b.deleted_at IS NULL
        LIMIT 1
      `, [item.material_code])
      const supplierId = bom?.supplier_id ? Number(bom.supplier_id) : null
      const supplierName = String(bom?.supplier_name || '待分配供應商')
      const unitPrice = toMoney(bom?.supplier_price || bom?.company_price || 0)
      const key = `${supplierId || 0}::${supplierName}`
      const group = grouped.get(key) || { supplierId, supplierName, items: [] }
      group.items.push({
        progressItemId: Number(item.id),
        materialId: await resolveMaterialId(null, item.material_code),
        materialCode: String(item.material_code || ''),
        materialName: String(item.material_name || ''),
        spec: String(item.spec || ''),
        unit: String(item.unit || 'PCS') || 'PCS',
        quantity: remainingQty,
        unitPrice,
        totalPrice: toMoney(remainingQty * unitPrice),
      })
      grouped.set(key, group)
    }

    if (!grouped.size) return c.json({ error: `進度 ${progress.progress_no} 已採購完成` }, 409)

    const created: Array<{ id: number; po_number: string; supplier_name: string }> = []
    let seq = 1
    for (const group of grouped.values()) {
      const poNum = grouped.size > 1
        ? `${poBaseNumber || `PO${Date.now()}`}-${String(seq).padStart(2, '0')}`
        : (poBaseNumber || `PO${Date.now()}`)
      seq += 1
      const duplicated = await queryOne<any>('SELECT id FROM purchase_orders WHERE po_number=? AND deleted_at IS NULL', [poNum])
      if (duplicated) return c.json({ error: `採購單號「${poNum}」已存在，請更換編號` }, 409)
      const taxRate = 8
      const totalPrice = toMoney(group.items.reduce((sum, item) => sum + toMoney(item.totalPrice), 0))
      const total = toMoney(totalPrice * (1 + taxRate / 100))
      const remark = `由交期進度自動生成，來源 ${progress.progress_no}`
      const r = await execute(
        'INSERT INTO purchase_orders (po_number,supplier_id,supplier_name,status,total_amount,tax_rate,currency,created_by,remark,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
        [poNum, group.supplierId, group.supplierName, 'draft', total, taxRate, 'VND', u.userId, remark, now8()]
      )
      const poId = r.insertId
      for (const item of group.items) {
        await execute(
          'INSERT INTO po_items (po_id,progress_id,progress_item_id,material_id,material_code,material_name,spec,unit,quantity,unit_price,total_price,currency,remark,po_ref,thickness) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
          [poId, id, item.progressItemId, item.materialId, item.materialCode, item.materialName, item.spec, item.unit, item.quantity, item.unitPrice, item.totalPrice, 'VND', remark, poRef, null]
        )
      }
      created.push({ id: poId, po_number: poNum, supplier_name: group.supplierName })
      await audit(u, 'CREATE', '採購單', poId, `${poNum} ← ${progress.progress_no}`)
    }

    return c.json({ created, count: created.length }, 201)
  } catch (e: any) {
    return c.json({ error: String(e.message) }, 500)
  }
})

app.get('/api/order-intake/export/csv', authMiddleware, async c => {
  try {
    const rows = await query<any>(`
      SELECT
        dp.progress_no,
        COALESCE(po_links.po_numbers, dp.order_po_number, '') as po_number,
        dp.customer_name,
        COALESCE(item_stats.material_names, '') as material_name,
        COALESCE(item_stats.item_count, 0) as item_count,
        COALESCE(item_stats.total_planned_qty, 0) as planned_qty,
        item_stats.due_date,
        dp.status,
        dp.created_at
      FROM delivery_progress dp
      LEFT JOIN (
        SELECT
          progress_id,
          GROUP_CONCAT(DISTINCT order_po_number ORDER BY order_po_number SEPARATOR ', ') as po_numbers
        FROM delivery_progress_po_links
        WHERE deleted_at IS NULL
        GROUP BY progress_id
      ) po_links ON po_links.progress_id = dp.id
      LEFT JOIN (
        SELECT
          progress_id,
          GROUP_CONCAT(DISTINCT material_name ORDER BY material_name SEPARATOR ', ') as material_names,
          COUNT(*) as item_count,
          COALESCE(SUM(planned_qty), 0) as total_planned_qty,
          MIN(due_date) as due_date
        FROM delivery_progress_items
        WHERE deleted_at IS NULL
        GROUP BY progress_id
      ) item_stats ON item_stats.progress_id = dp.id
      WHERE dp.deleted_at IS NULL
      ORDER BY dp.created_at DESC
      LIMIT 5000
    `)
    const esc = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const header = ['progress_no', 'po_number', 'customer_name', 'material_name', 'item_count', 'planned_qty', 'due_date', 'status', 'created_at']
    const lines = [header.join(',')]
    for (const row of rows) {
      lines.push([
        row.progress_no,
        row.po_number,
        row.customer_name,
        row.material_name,
        Number(row.item_count || 0),
        toQty(row.planned_qty),
        row.due_date,
        row.status,
        row.created_at,
      ].map(esc).join(','))
    }
    return c.text(lines.join('\n'))
  } catch (e: any) {
    return c.json({ error: String(e.message) }, 500)
  }
})

app.get('/api/reconciliations/pending-items', authMiddleware, async c => {
  try {
    const page = parsePositiveInt(c.req.query('page'), 1, 1000000)
    const pageSize = parsePositiveInt(c.req.query('page_size'), 200, 1000)
    const offset = (page - 1) * pageSize
    const rows = await query<any>(`
      SELECT
        dni.id as delivery_note_item_id,
        dn.id as delivery_note_id,
        dn.dn_number,
        dn.delivery_date,
        dn.customer_order_id,
        co.po_number,
        dn.customer_name,
        dni.material_code,
        COALESCE(NULLIF(m.material_name, ''), NULLIF(dni.item_name, ''), '') as material_name,
        COALESCE(NULLIF(m.spec, ''), NULLIF(dni.spec, ''), '') as spec,
        COALESCE(NULLIF(m.unit, ''), NULLIF(dni.unit, ''), 'PCS') as unit,
        COALESCE(dni.qty, 0) as shipped_qty
      FROM delivery_note_items dni
      JOIN delivery_notes dn ON dn.id = dni.dn_id
      LEFT JOIN customer_orders co ON co.id = dn.customer_order_id AND co.deleted_at IS NULL
      LEFT JOIN shipment_reconciliation_items sri ON sri.delivery_note_item_id = dni.id AND sri.deleted_at IS NULL
      LEFT JOIN materials m ON (
        (dni.material_id IS NOT NULL AND dni.material_id > 0 AND dni.material_id = m.id)
        OR ((dni.material_id IS NULL OR dni.material_id = 0) AND dni.material_code = m.material_code)
      ) AND m.deleted_at IS NULL
      WHERE dn.status = 'shipped'
        AND dn.deleted_at IS NULL
        AND sri.id IS NULL
      ORDER BY dn.delivery_date DESC, dn.id DESC, dni.id ASC
      LIMIT ${pageSize} OFFSET ${offset}
    `)

    const orderItemIdMap = await buildOrderItemIdMap(
      rows.map((row: any) => ({
        customer_order_id: Number(row.customer_order_id || 0),
        material_code: String(row.material_code || ''),
      }))
    )

    const enriched: any[] = []
    for (const row of rows) {
      const key = `${Number(row.customer_order_id || 0)}::${String(row.material_code || '').trim()}`
      const orderItemId = orderItemIdMap.get(key) || null
      enriched.push({
        ...row,
        order_item_id: orderItemId,
        shipped_qty: toQty(row.shipped_qty),
      })
    }
    return c.json(enriched)
  } catch (e: any) {
    return c.json({ error: String(e.message) }, 500)
  }
})

app.get('/api/reconciliations', authMiddleware, async c => {
  const page = parsePositiveInt(c.req.query('page'), 1, 1000000)
  const pageSize = parsePositiveInt(c.req.query('page_size'), 200, 1000)
  const offset = (page - 1) * pageSize
  const status = String(c.req.query('status') || '').trim()
  const search = String(c.req.query('search') || '').trim()
  const where: string[] = ['sr.deleted_at IS NULL']
  const params: any[] = []
  if (status) { where.push('sr.status=?'); params.push(status) }
  if (search) {
    where.push('(sr.reconciliation_no LIKE ? OR sr.remark LIKE ?)')
    const term = `%${search}%`
    params.push(term, term)
  }
  const rows = await query<any>(`
    SELECT
      sr.id,
      sr.reconciliation_no,
      sr.reconcile_date,
      sr.status,
      sr.remark,
      sr.created_at,
      sr.confirmed_at,
      uc.name as created_by_name,
      ucf.name as confirmed_by_name,
      COUNT(sri.id) as item_count,
      COALESCE(SUM(sri.shipped_qty), 0) as total_shipped_qty,
      COALESCE(SUM(sri.accepted_qty), 0) as total_accepted_qty,
      COALESCE(SUM(sri.difference_qty), 0) as total_difference_qty
    FROM shipment_reconciliations sr
    LEFT JOIN shipment_reconciliation_items sri ON sri.reconciliation_id = sr.id AND sri.deleted_at IS NULL
    LEFT JOIN users uc ON uc.id = sr.created_by
    LEFT JOIN users ucf ON ucf.id = sr.confirmed_by
    WHERE ${where.join(' AND ')}
    GROUP BY sr.id
    ORDER BY sr.created_at DESC
    LIMIT ${pageSize} OFFSET ${offset}
  `, params)
  return c.json(rows.map((r: any) => ({
    ...r,
    total_shipped_qty: toQty(r.total_shipped_qty),
    total_accepted_qty: toQty(r.total_accepted_qty),
    total_difference_qty: toQty(r.total_difference_qty),
  })))
})

app.get('/api/reconciliations/:id', authMiddleware, async c => {
  const id = c.req.param('id')
  const header = await queryOne<any>(`
    SELECT sr.*, uc.name as created_by_name, ucf.name as confirmed_by_name
    FROM shipment_reconciliations sr
    LEFT JOIN users uc ON uc.id = sr.created_by
    LEFT JOIN users ucf ON ucf.id = sr.confirmed_by
    WHERE sr.id=? AND sr.deleted_at IS NULL
  `, [id])
  if (!header) return c.json({ error: 'Not found' }, 404)

  const items = await query<any>(`
    SELECT
      sri.*,
      dn.dn_number,
      dn.delivery_date,
      co.po_number,
      co.status as order_status
    FROM shipment_reconciliation_items sri
    LEFT JOIN delivery_notes dn ON dn.id = sri.delivery_note_id AND dn.deleted_at IS NULL
    LEFT JOIN customer_orders co ON co.id = sri.customer_order_id AND co.deleted_at IS NULL
    WHERE sri.reconciliation_id=? AND sri.deleted_at IS NULL
    ORDER BY sri.id ASC
  `, [id])

  return c.json({
    ...header,
    items: items.map((row: any) => ({
      ...row,
      shipped_qty: toQty(row.shipped_qty),
      accepted_qty: toQty(row.accepted_qty),
      difference_qty: toQty(row.difference_qty),
    })),
  })
})

app.get('/api/reconciliations/export/csv', authMiddleware, async c => {
  try {
    const rows = await query<any>(`
      SELECT
        sr.reconciliation_no,
        sr.reconcile_date,
        sr.status,
        sri.po_number,
        sri.material_code,
        sri.material_name,
        sri.shipped_qty,
        sri.accepted_qty,
        sri.difference_qty,
        sri.difference_reason
      FROM shipment_reconciliation_items sri
      JOIN shipment_reconciliations sr ON sr.id = sri.reconciliation_id
      WHERE sr.deleted_at IS NULL AND sri.deleted_at IS NULL
      ORDER BY sr.created_at DESC, sri.id ASC
      LIMIT 5000
    `)
    const esc = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const header = ['reconciliation_no', 'reconcile_date', 'status', 'po_number', 'material_code', 'material_name', 'shipped_qty', 'accepted_qty', 'difference_qty', 'difference_reason']
    const lines = [header.join(',')]
    for (const row of rows) {
      lines.push([
        row.reconciliation_no, row.reconcile_date, row.status, row.po_number, row.material_code, row.material_name,
        toQty(row.shipped_qty), toQty(row.accepted_qty), toQty(row.difference_qty), row.difference_reason,
      ].map(esc).join(','))
    }
    return c.text(lines.join('\n'))
  } catch (e: any) {
    return c.json({ error: String(e.message) }, 500)
  }
})

app.post('/api/reconciliations', authMiddleware, requirePerm('delivery.create'), async c => {
  try {
    const b = await c.req.json()
    const items = Array.isArray(b?.items) ? b.items : []
    if (!items.length) return c.json({ error: 'items required' }, 400)
    const deliveryNoteItemIds = Array.from(
      new Set<number>(
        items
          .map((it: any) => Number(it?.delivery_note_item_id || 0))
          .filter((id: number) => Number.isFinite(id) && id > 0)
      )
    )
    if (!deliveryNoteItemIds.length) return c.json({ error: 'no valid delivery_note_item_id' }, 400)

    const reconciliationNo = `RC${Date.now()}`
    const reconcileDate = b?.reconcile_date ? toDateStr(b.reconcile_date) : null
    const r = await execute(`
      INSERT INTO shipment_reconciliations (reconciliation_no, reconcile_date, status, remark, created_by, created_at)
      VALUES (?,?,?,?,?,?)
    `, [reconciliationNo, reconcileDate, 'draft', b.remark || '', c.get('user')?.userId || null, now8()])
    const reconciliationId = r.insertId

    const placeholders = deliveryNoteItemIds.map(() => '?').join(',')
    const sources = await query<any>(`
      SELECT
        dni.id as delivery_note_item_id,
        dn.id as delivery_note_id,
        dn.customer_order_id,
        co.po_number,
        dni.material_code,
        COALESCE(NULLIF(m.material_name, ''), NULLIF(dni.item_name, ''), b.product_name, '') as material_name,
        COALESCE(m.supplier_id, b.supplier_id) as supplier_id,
        COALESCE(ms.name, s.name, '') as supplier_name,
        COALESCE(NULLIF(m.unit, ''), NULLIF(dni.unit, ''), 'PCS') as unit,
        COALESCE(dni.qty, 0) as shipped_qty
      FROM delivery_note_items dni
      JOIN delivery_notes dn ON dn.id = dni.dn_id
      LEFT JOIN customer_orders co ON co.id = dn.customer_order_id AND co.deleted_at IS NULL
      LEFT JOIN shipment_reconciliation_items sri ON sri.delivery_note_item_id = dni.id AND sri.deleted_at IS NULL
      LEFT JOIN materials m ON (
        (dni.material_id IS NOT NULL AND dni.material_id > 0 AND dni.material_id = m.id)
        OR ((dni.material_id IS NULL OR dni.material_id = 0) AND dni.material_code = m.material_code)
      ) AND m.deleted_at IS NULL
      LEFT JOIN bom b ON b.product_sku = dni.material_code AND b.deleted_at IS NULL
      LEFT JOIN suppliers ms ON ms.id = m.supplier_id AND ms.deleted_at IS NULL
      LEFT JOIN suppliers s ON s.id = b.supplier_id AND s.deleted_at IS NULL
      WHERE dni.id IN (${placeholders})
        AND dn.status = 'shipped'
        AND dn.deleted_at IS NULL
        AND sri.id IS NULL
    `, deliveryNoteItemIds)
    const sourceMap = new Map<number, any>()
    for (const src of sources) sourceMap.set(Number(src.delivery_note_item_id), src)
    const orderItemIdMap = await buildOrderItemIdMap(
      sources.map((src: any) => ({
        customer_order_id: Number(src.customer_order_id || 0),
        material_code: String(src.material_code || ''),
      }))
    )

    for (const inputItem of items) {
      const deliveryNoteItemId = Number(inputItem?.delivery_note_item_id || 0)
      if (!deliveryNoteItemId) continue
      const src = sourceMap.get(deliveryNoteItemId)
      if (!src) continue

      const shippedQty = toQty(src.shipped_qty)
      let acceptedQty = inputItem?.accepted_qty === undefined ? shippedQty : toQty(inputItem.accepted_qty)
      if (acceptedQty < 0) acceptedQty = 0
      if (acceptedQty > shippedQty) acceptedQty = shippedQty
      const differenceQty = toQty(shippedQty - acceptedQty)
      const orderItemId = orderItemIdMap.get(`${Number(src.customer_order_id || 0)}::${String(src.material_code || '').trim()}`) || null

      await execute(`
        INSERT INTO shipment_reconciliation_items
          (reconciliation_id, delivery_note_id, delivery_note_item_id, customer_order_id, order_item_id, po_number,
           material_code, material_name, supplier_id, supplier_name, unit, shipped_qty, accepted_qty, difference_qty, difference_reason, created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `, [
        reconciliationId, src.delivery_note_id, src.delivery_note_item_id, src.customer_order_id || null, orderItemId,
        src.po_number || '', src.material_code || '', src.material_name || '', src.supplier_id || null, src.supplier_name || '',
        src.unit || 'PCS', shippedQty, acceptedQty, differenceQty, inputItem?.difference_reason || '', now8(),
      ])
    }

    const createdItems = await queryOne<any>(
      'SELECT COUNT(*) as cnt FROM shipment_reconciliation_items WHERE reconciliation_id=? AND deleted_at IS NULL',
      [reconciliationId]
    )
    if (!createdItems || Number(createdItems.cnt) <= 0) {
      await softDeleteById('shipment_reconciliations', reconciliationId, c.get('user')?.userId)
      return c.json({ error: 'no valid items to reconcile' }, 400)
    }

    await audit(c.get('user'), 'CREATE', '出貨核對單', reconciliationId, reconciliationNo)
    return c.json({ id: reconciliationId, reconciliation_no: reconciliationNo }, 201)
  } catch (e: any) {
    return c.json({ error: String(e.message) }, 500)
  }
})

app.put('/api/reconciliations/:id', authMiddleware, requirePerm('delivery.create'), async c => {
  try {
    const id = c.req.param('id')
    const b = await c.req.json()
    const header = await queryOne<any>('SELECT status FROM shipment_reconciliations WHERE id=? AND deleted_at IS NULL', [id])
    if (!header) return c.json({ error: 'Not found' }, 404)
    if (header.status !== 'draft') return c.json({ error: 'only draft reconciliation can be edited' }, 400)
    const locked = await queryOne<any>(`
      SELECT COUNT(*) as cnt
      FROM invoice_items ii
      JOIN invoice_headers ih ON ih.id = ii.invoice_id
      WHERE ii.reconciliation_id = ?
        AND ih.status = 'confirmed'
        AND ih.deleted_at IS NULL
        AND ii.deleted_at IS NULL
    `, [id])
    if (Number(locked?.cnt || 0) > 0) return c.json({ error: 'reconciliation already used by confirmed invoice' }, 400)

    const reconcileDate = b?.reconcile_date ? toDateStr(b.reconcile_date) : null
    await execute('UPDATE shipment_reconciliations SET reconcile_date=?, remark=? WHERE id=?', [reconcileDate, b.remark || '', id])
    const items = Array.isArray(b?.items) ? b.items : []
    for (const item of items) {
      const itemId = Number(item?.id || 0)
      if (!itemId) continue
      const existing = await queryOne<any>('SELECT id, shipped_qty FROM shipment_reconciliation_items WHERE id=? AND reconciliation_id=? AND deleted_at IS NULL', [itemId, id])
      if (!existing) continue
      let acceptedQty = item?.accepted_qty === undefined ? toQty(existing.shipped_qty) : toQty(item.accepted_qty)
      if (acceptedQty < 0) acceptedQty = 0
      if (acceptedQty > toQty(existing.shipped_qty)) acceptedQty = toQty(existing.shipped_qty)
      const differenceQty = toQty(toQty(existing.shipped_qty) - acceptedQty)
      await execute(
        'UPDATE shipment_reconciliation_items SET accepted_qty=?, difference_qty=?, difference_reason=? WHERE id=?',
        [acceptedQty, differenceQty, item?.difference_reason || '', itemId]
      )
    }
    await audit(c.get('user'), 'UPDATE', '出貨核對單', id, `id=${id}`)
    return c.json({ ok: true })
  } catch (e: any) {
    return c.json({ error: String(e.message) }, 500)
  }
})

app.patch('/api/reconciliations/:id/confirm', authMiddleware, requirePerm('delivery.create'), async c => {
  try {
    const id = c.req.param('id')
    const u = c.get('user')
    const header = await queryOne<any>('SELECT id, status, reconciliation_no FROM shipment_reconciliations WHERE id=? AND deleted_at IS NULL', [id])
    if (!header) return c.json({ error: 'Not found' }, 404)
    if (header.status !== 'draft') return c.json({ error: 'already confirmed' }, 400)

    const items = await query<any>(`
      SELECT id, customer_order_id, order_item_id, accepted_qty
      FROM shipment_reconciliation_items
      WHERE reconciliation_id=? AND deleted_at IS NULL
    `, [id])
    if (!items.length) return c.json({ error: 'no items' }, 400)

    const reconcileMap = new Map<number, number>()
    const orderIdsFromReconcile = new Set<number>()
    for (const item of items) {
      const orderItemId = Number(item.order_item_id || 0)
      const qty = toQty(item.accepted_qty)
      const orderId = Number(item.customer_order_id || 0)
      if (orderId > 0) orderIdsFromReconcile.add(orderId)
      if (!orderItemId || qty <= 0) continue
      reconcileMap.set(orderItemId, toQty((reconcileMap.get(orderItemId) || 0) + qty))
    }
    const orderItemIds = Array.from(reconcileMap.keys())
    if (orderItemIds.length) {
      const inClause = orderItemIds.map(() => '?').join(',')
      const orderItems = await query<any>(
        `SELECT id, order_id, qty, arrived_qty, reconciled_qty FROM customer_order_items WHERE id IN (${inClause})`,
        [...orderItemIds]
      )

      const arrivedCase: string[] = []
      const reconciledCase: string[] = []
      const balanceCase: string[] = []
      const statusCase: string[] = []
      const params: any[] = []
      const touchedOrderIds = new Set<number>(Array.from(orderIdsFromReconcile))

      for (const row of orderItems) {
        const itemId = Number(row.id || 0)
        const delta = toQty(reconcileMap.get(itemId) || 0)
        if (!itemId || delta <= 0) continue
        const qty = toQty(row.qty)
        const nextArrived = toQty(Math.min(qty, toQty(row.arrived_qty) + delta))
        const nextReconciled = toQty(Math.min(qty, toQty(row.reconciled_qty) + delta))
        const nextBalance = toQty(Math.max(0, qty - nextArrived))
        const nextStatus = nextArrived >= qty && qty > 0 ? 'completed' : nextArrived > 0 ? 'partial' : 'pending'
        const orderId = Number(row.order_id || 0)
        if (orderId > 0) touchedOrderIds.add(orderId)

        arrivedCase.push('WHEN ? THEN ?')
        params.push(itemId, nextArrived)
        reconciledCase.push('WHEN ? THEN ?')
        params.push(itemId, nextReconciled)
        balanceCase.push('WHEN ? THEN ?')
        params.push(itemId, nextBalance)
        statusCase.push('WHEN ? THEN ?')
        params.push(itemId, nextStatus)
      }

      if (arrivedCase.length > 0) {
        await execute(`
          UPDATE customer_order_items
          SET
            arrived_qty = CASE id ${arrivedCase.join(' ')} ELSE arrived_qty END,
            reconciled_qty = CASE id ${reconciledCase.join(' ')} ELSE reconciled_qty END,
            balance = CASE id ${balanceCase.join(' ')} ELSE balance END,
            status = CASE id ${statusCase.join(' ')} ELSE status END
          WHERE id IN (${inClause})
        `, [...params, ...orderItemIds])
      }

      for (const orderId of Array.from(touchedOrderIds)) {
        const summary = await queryOne<any>(
          'SELECT COALESCE(SUM(qty),0) as total_qty, COALESCE(SUM(arrived_qty),0) as arrived_qty FROM customer_order_items WHERE order_id=?',
          [orderId]
        )
        const totalQty = toQty(summary?.total_qty || 0)
        const arrivedQty = toQty(summary?.arrived_qty || 0)
        const nextOrderStatus = totalQty <= 0 ? 'pending' : arrivedQty >= totalQty ? 'completed' : arrivedQty > 0 ? 'partial' : 'pending'
        await execute('UPDATE customer_orders SET status=? WHERE id=? AND deleted_at IS NULL', [nextOrderStatus, orderId])
      }
    }

    await execute(
      'UPDATE shipment_reconciliations SET status=?, confirmed_by=?, confirmed_at=? WHERE id=?',
      ['confirmed', u?.userId || null, now8(), id]
    )
    await audit(u, 'CONFIRM', '出貨核對單', id, header.reconciliation_no || `id=${id}`)
    return c.json({ ok: true })
  } catch (e: any) {
    return c.json({ error: String(e.message) }, 500)
  }
})

app.delete('/api/reconciliations/:id', authMiddleware, requirePerm('delivery.create'), async c => {
  try {
    const id = c.req.param('id')
    const header = await queryOne<any>('SELECT id, status, reconciliation_no FROM shipment_reconciliations WHERE id=? AND deleted_at IS NULL', [id])
    if (!header) return c.json({ error: 'Not found' }, 404)
    if (header.status !== 'draft') return c.json({ error: 'only draft reconciliation can be deleted' }, 400)
    await softDeleteById('shipment_reconciliations', id, c.get('user')?.userId)
    await audit(c.get('user'), 'DELETE', '出貨核對單', id, header.reconciliation_no || `id=${id}`)
    return c.json({ ok: true })
  } catch (e: any) {
    return c.json({ error: String(e.message) }, 500)
  }
})

const getInvoicedQtyMapByReconciliationItems = async (reconciliationItemIds: number[], invoiceType: string): Promise<Map<number, number>> => {
  const map = new Map<number, number>()
  const ids = Array.from(new Set(reconciliationItemIds.filter((x) => Number.isFinite(x) && x > 0)))
  if (!ids.length) return map
  const placeholders = ids.map(() => '?').join(',')
  const rows = await query<any>(`
    SELECT ii.reconciliation_item_id, COALESCE(SUM(ii.qty), 0) as qty
    FROM invoice_items ii
    JOIN invoice_headers ih ON ih.id = ii.invoice_id
    WHERE ii.reconciliation_item_id IN (${placeholders})
      AND ih.invoice_type = ?
      AND ih.status = 'confirmed'
      AND ih.deleted_at IS NULL
      AND ii.deleted_at IS NULL
    GROUP BY ii.reconciliation_item_id
  `, [...ids, invoiceType])
  for (const row of rows) {
    map.set(Number(row.reconciliation_item_id), toQty(row.qty))
  }
  return map
}

app.get('/api/invoices/pending-items', authMiddleware, async c => {
  try {
    const invoiceType = (c.req.query('type') || 'customer').trim() === 'supplier' ? 'supplier' : 'customer'
    const search = String(c.req.query('search') || '').trim().toLowerCase()
    const rows = await query<any>(`
      SELECT
        sri.id as reconciliation_item_id,
        sri.reconciliation_id,
        sri.delivery_note_id,
        sri.delivery_note_item_id,
        sri.customer_order_id,
        sri.order_item_id,
        sri.po_number,
        sri.material_code,
        sri.material_name,
        sri.unit,
        sri.accepted_qty,
        sri.supplier_id,
        sri.supplier_name,
        sr.reconciliation_no,
        sr.reconcile_date,
        co.customer_id,
        co.customer_name,
        COALESCE(ci.unit_price, 0) as customer_unit_price,
        COALESCE(m.supplier_price, b.supplier_price, 0) as supplier_unit_price
      FROM shipment_reconciliation_items sri
      JOIN shipment_reconciliations sr ON sr.id = sri.reconciliation_id
      LEFT JOIN customer_orders co ON co.id = sri.customer_order_id AND co.deleted_at IS NULL
      LEFT JOIN customer_order_items ci ON ci.id = sri.order_item_id
      LEFT JOIN materials m ON sri.material_code = m.material_code AND m.deleted_at IS NULL
      LEFT JOIN bom b ON b.product_sku = sri.material_code AND b.deleted_at IS NULL
      WHERE sr.status = 'confirmed'
        AND sr.deleted_at IS NULL
        AND sri.deleted_at IS NULL
      ORDER BY sr.confirmed_at DESC, sri.id ASC
      LIMIT 2000
    `)
    const invoicedQtyMap = await getInvoicedQtyMapByReconciliationItems(rows.map((r: any) => Number(r.reconciliation_item_id)), invoiceType)

    const pending: any[] = []
    for (const row of rows) {
      const acceptedQty = toQty(row.accepted_qty)
      const invoicedQty = toQty(invoicedQtyMap.get(Number(row.reconciliation_item_id)) || 0)
      const remainingQty = toQty(Math.max(0, acceptedQty - invoicedQty))
      if (remainingQty <= 0) continue
      const unitPrice = invoiceType === 'supplier' ? toMoney(row.supplier_unit_price) : toMoney(row.customer_unit_price)
      const rowOut = {
        reconciliation_item_id: Number(row.reconciliation_item_id),
        reconciliation_id: Number(row.reconciliation_id),
        reconciliation_no: row.reconciliation_no,
        reconcile_date: row.reconcile_date,
        customer_order_id: row.customer_order_id ? Number(row.customer_order_id) : null,
        order_item_id: row.order_item_id ? Number(row.order_item_id) : null,
        po_number: row.po_number || '',
        delivery_note_id: row.delivery_note_id ? Number(row.delivery_note_id) : null,
        delivery_note_item_id: row.delivery_note_item_id ? Number(row.delivery_note_item_id) : null,
        material_code: row.material_code || '',
        material_name: row.material_name || '',
        unit: row.unit || 'PCS',
        accepted_qty: acceptedQty,
        invoiced_qty: invoicedQty,
        remaining_qty: remainingQty,
        supplier_id: row.supplier_id ? Number(row.supplier_id) : null,
        supplier_name: row.supplier_name || '',
        customer_id: row.customer_id ? Number(row.customer_id) : null,
        customer_name: row.customer_name || '',
        unit_price: unitPrice,
      }
      const text = `${rowOut.reconciliation_no} ${rowOut.po_number} ${rowOut.material_code} ${rowOut.material_name} ${rowOut.customer_name} ${rowOut.supplier_name}`.toLowerCase()
      if (search && !text.includes(search)) continue
      pending.push(rowOut)
    }
    return c.json(pending)
  } catch (e: any) {
    return c.json({ error: String(e.message) }, 500)
  }
})

app.get('/api/invoices', authMiddleware, async c => {
  try {
    const page = parsePositiveInt(c.req.query('page'), 1, 1000000)
    const pageSize = parsePositiveInt(c.req.query('page_size'), 200, 1000)
    const offset = (page - 1) * pageSize
    const invoiceType = (c.req.query('type') || '').trim()
    const status = (c.req.query('status') || '').trim()
    const search = (c.req.query('search') || '').trim()
    const dateFrom = (c.req.query('date_from') || '').trim()
    const dateTo = (c.req.query('date_to') || '').trim()
    const where: string[] = ['ih.deleted_at IS NULL']
    const params: any[] = []
    if (invoiceType) { where.push('ih.invoice_type=?'); params.push(invoiceType) }
    if (status) { where.push('ih.status=?'); params.push(status) }
    if (dateFrom) { where.push('ih.invoice_date>=?'); params.push(dateFrom) }
    if (dateTo) { where.push('ih.invoice_date<=?'); params.push(dateTo) }
    if (search) {
      where.push('(ih.invoice_no LIKE ? OR ih.party_name LIKE ? OR ih.verification_code LIKE ?)')
      const term = `%${search}%`
      params.push(term, term, term)
    }
    const rows = await query<any>(`
      SELECT
        ih.*,
        uc.name as created_by_name,
        ucf.name as confirmed_by_name,
        COUNT(ii.id) as item_count,
        COALESCE(SUM(ii.qty), 0) as total_qty
      FROM invoice_headers ih
      LEFT JOIN invoice_items ii ON ii.invoice_id = ih.id AND ii.deleted_at IS NULL
      LEFT JOIN users uc ON uc.id = ih.created_by
      LEFT JOIN users ucf ON ucf.id = ih.confirmed_by
      WHERE ${where.join(' AND ')}
      GROUP BY ih.id
      ORDER BY ih.created_at DESC
      LIMIT ${pageSize} OFFSET ${offset}
    `, params)
    return c.json(rows.map((r: any) => ({ ...r, total_qty: toQty(r.total_qty) })))
  } catch (e: any) {
    return c.json({ error: String(e.message) }, 500)
  }
})

app.get('/api/invoices/:id', authMiddleware, async c => {
  const id = c.req.param('id')
  const header = await queryOne<any>('SELECT * FROM invoice_headers WHERE id=? AND deleted_at IS NULL', [id])
  if (!header) return c.json({ error: 'Not found' }, 404)
  const items = await query<any>(`
    SELECT *
    FROM invoice_items
    WHERE invoice_id=? AND deleted_at IS NULL
    ORDER BY id ASC
  `, [id])
  return c.json({
    ...header,
    items: items.map((it: any) => ({ ...it, qty: toQty(it.qty), unit_price: toMoney(it.unit_price), amount: toMoney(it.amount) })),
  })
})

app.get('/api/invoices/:id/verify', authMiddleware, async c => {
  const id = c.req.param('id')
  const code = String(c.req.query('code') || '').trim().toUpperCase()
  if (!code) return c.json({ error: 'code required' }, 400)
  const header = await queryOne<any>('SELECT id, invoice_no, verification_code, status, party_name, grand_total, invoice_date FROM invoice_headers WHERE id=? AND deleted_at IS NULL', [id])
  if (!header) return c.json({ error: 'Not found' }, 404)
  const ok = String(header.verification_code || '').toUpperCase() === code
  return c.json({
    ok,
    invoice_no: header.invoice_no,
    status: header.status,
    party_name: header.party_name,
    grand_total: toMoney(header.grand_total),
    invoice_date: header.invoice_date,
  })
})

app.get('/api/public/invoices/verify', async c => {
  try {
    const invoiceNo = String(c.req.query('invoice_no') || '').trim()
    const code = String(c.req.query('code') || '').trim().toUpperCase()
    if (!invoiceNo || !code) return c.json({ error: 'invoice_no and code required' }, 400)
    const header = await queryOne<any>(`
      SELECT invoice_no, verification_code, status, party_name, grand_total, invoice_date
      FROM invoice_headers
      WHERE invoice_no=? AND deleted_at IS NULL
      LIMIT 1
    `, [invoiceNo])
    if (!header) return c.json({ ok: false, reason: 'not_found' }, 404)
    const ok = String(header.verification_code || '').toUpperCase() === code
    return c.json({
      ok,
      invoice_no: header.invoice_no,
      status: header.status,
      party_name: header.party_name,
      grand_total: toMoney(header.grand_total),
      invoice_date: header.invoice_date,
    })
  } catch (e: any) {
    return c.json({ error: String(e.message) }, 500)
  }
})

app.get('/api/invoices/export/csv', authMiddleware, async c => {
  try {
    const invoiceType = (c.req.query('type') || '').trim()
    const where: string[] = ['ih.deleted_at IS NULL']
    const params: any[] = []
    if (invoiceType) { where.push('ih.invoice_type=?'); params.push(invoiceType) }
    const rows = await query<any>(`
      SELECT ih.invoice_no, ih.invoice_type, ih.invoice_date, ih.status, ih.party_name, ih.currency,
             ih.total_amount, ih.tax_rate, ih.tax_amount, ih.grand_total, ih.payment_status,
             ih.received_amount, ih.paid_amount, ih.verification_code, ih.created_at
      FROM invoice_headers ih
      WHERE ${where.join(' AND ')}
      ORDER BY ih.created_at DESC
      LIMIT 5000
    `, params.length ? params : undefined)
    const esc = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const header = ['invoice_no', 'invoice_type', 'invoice_date', 'status', 'party_name', 'currency', 'total_amount', 'tax_rate', 'tax_amount', 'grand_total', 'payment_status', 'received_amount', 'paid_amount', 'verification_code', 'created_at']
    const lines = [header.join(',')]
    for (const row of rows) {
      lines.push([
        row.invoice_no, row.invoice_type, row.invoice_date, row.status, row.party_name, row.currency,
        toMoney(row.total_amount), row.tax_rate, toMoney(row.tax_amount), toMoney(row.grand_total),
        row.payment_status, toMoney(row.received_amount), toMoney(row.paid_amount), row.verification_code, row.created_at,
      ].map(esc).join(','))
    }
    return c.text(lines.join('\n'))
  } catch (e: any) {
    return c.json({ error: String(e.message) }, 500)
  }
})

app.post('/api/invoices', authMiddleware, requirePerm('customer_order.create'), async c => {
  try {
    const b = await c.req.json()
    const invoiceType = String(b?.invoice_type || 'customer').trim() === 'supplier' ? 'supplier' : 'customer'
    const items = Array.isArray(b?.items) ? b.items : []
    if (!items.length) return c.json({ error: 'items required' }, 400)
    const reconciliationItemIds: number[] = Array.from(
      new Set<number>(
        items
          .map((it: any) => Number(it?.reconciliation_item_id || 0))
          .filter((id: number) => Number.isFinite(id) && id > 0)
      )
    )
    if (!reconciliationItemIds.length) return c.json({ error: 'no valid reconciliation item ids' }, 400)

    const placeholders = reconciliationItemIds.map(() => '?').join(',')
    const sources = await query<any>(`
      SELECT
        sri.*,
        co.customer_id,
        co.customer_name,
        COALESCE(coi.unit_price, 0) as customer_unit_price,
        COALESCE(m.supplier_price, b.supplier_price, 0) as supplier_unit_price,
        s.name as supplier_name_resolved
      FROM shipment_reconciliation_items sri
      JOIN shipment_reconciliations sr ON sr.id = sri.reconciliation_id
      LEFT JOIN customer_orders co ON co.id = sri.customer_order_id AND co.deleted_at IS NULL
      LEFT JOIN customer_order_items coi ON coi.id = sri.order_item_id
      LEFT JOIN materials m ON sri.material_code = m.material_code AND m.deleted_at IS NULL
      LEFT JOIN bom b ON b.product_sku = sri.material_code AND b.deleted_at IS NULL
      LEFT JOIN suppliers s ON s.id = sri.supplier_id AND s.deleted_at IS NULL
      WHERE sri.id IN (${placeholders})
        AND sri.deleted_at IS NULL
        AND sr.status = 'confirmed'
        AND sr.deleted_at IS NULL
    `, reconciliationItemIds)
    const sourceMap = new Map<number, any>()
    for (const src of sources) sourceMap.set(Number(src.id), src)
    const invoicedQtyMap = await getInvoicedQtyMapByReconciliationItems(reconciliationItemIds, invoiceType)

    let partyId: number | null = null
    let partyName = ''
    let totalAmount = 0
    const validatedItems: any[] = []
    const dedupe = new Set<number>()
    for (const item of items) {
      const reconciliationItemId = Number(item?.reconciliation_item_id || 0)
      if (!reconciliationItemId) continue
      if (dedupe.has(reconciliationItemId)) continue
      dedupe.add(reconciliationItemId)
      const source = sourceMap.get(reconciliationItemId)
      if (!source) continue
      const acceptedQty = toQty(source.accepted_qty)
      const alreadyInvoicedQty = toQty(invoicedQtyMap.get(reconciliationItemId) || 0)
      const remainingQty = toQty(Math.max(0, acceptedQty - alreadyInvoicedQty))
      let qty = toQty(item?.qty)
      if (qty <= 0) continue
      if (qty > remainingQty) qty = remainingQty
      if (qty <= 0) continue

      const unitPrice = toMoney(item?.unit_price === undefined ? (invoiceType === 'supplier' ? source.supplier_unit_price : source.customer_unit_price) : item?.unit_price)
      const amount = toMoney(qty * unitPrice)

      if (invoiceType === 'customer') {
        partyId = source?.customer_id ? Number(source.customer_id) : partyId
        partyName = source?.customer_name || partyName
      } else {
        partyId = source?.supplier_id ? Number(source.supplier_id) : partyId
        partyName = source?.supplier_name_resolved || partyName || source.supplier_name || ''
      }

      totalAmount += amount
      validatedItems.push({
        reconciliation_id: source.reconciliation_id,
        reconciliation_item_id: source.id,
        customer_order_id: source.customer_order_id,
        order_item_id: source.order_item_id,
        po_number: source.po_number || '',
        delivery_note_id: source.delivery_note_id,
        delivery_note_item_id: source.delivery_note_item_id,
        material_code: source.material_code || '',
        material_name: source.material_name || '',
        spec: source.spec || '',
        unit: source.unit || 'PCS',
        qty,
        unit_price: unitPrice,
        amount,
        supplier_id: source.supplier_id || null,
        supplier_name: source.supplier_name_resolved || source.supplier_name || '',
        customer_id: source.customer_id || null,
        customer_name: source.customer_name || '',
      })
    }

    if (!validatedItems.length) return c.json({ error: 'no valid items' }, 400)
    const taxRate = toMoney(b?.tax_rate || 0)
    const taxAmount = toMoney(totalAmount * (taxRate / 100))
    const grandTotal = toMoney(totalAmount + taxAmount)
    const invoiceDate = toDateStr(b?.invoice_date || now8())
    const identity = await nextInvoiceIdentity(invoiceType, invoiceDate)
    const verifyCode = genVerifyCode(identity.invoiceNo)
    const qrPayload = buildQrPayload(identity.invoiceNo, verifyCode, grandTotal)

    const r = await execute(`
      INSERT INTO invoice_headers
        (invoice_no, invoice_type, invoice_period, invoice_seq, invoice_date, status, party_id, party_name, currency, total_amount, tax_rate, tax_amount, grand_total, verification_code, qr_payload, remark, created_by, created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `, [
      identity.invoiceNo, invoiceType, identity.period, identity.seq, invoiceDate, 'draft', partyId, partyName, b?.currency || 'VND',
      toMoney(totalAmount), taxRate, taxAmount, grandTotal, verifyCode, qrPayload, b?.remark || '', c.get('user')?.userId || null, now8(),
    ])
    const invoiceId = r.insertId

    for (const it of validatedItems) {
      await execute(`
        INSERT INTO invoice_items
          (invoice_id, reconciliation_id, reconciliation_item_id, customer_order_id, order_item_id, po_number, delivery_note_id, delivery_note_item_id,
           material_code, material_name, spec, unit, qty, unit_price, amount, supplier_id, supplier_name, customer_id, customer_name, created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `, [
        invoiceId, it.reconciliation_id, it.reconciliation_item_id, it.customer_order_id, it.order_item_id, it.po_number,
        it.delivery_note_id, it.delivery_note_item_id, it.material_code, it.material_name, it.spec, it.unit, it.qty, it.unit_price, it.amount,
        it.supplier_id, it.supplier_name, it.customer_id, it.customer_name, now8(),
      ])
    }

    await audit(c.get('user'), 'CREATE', invoiceType === 'supplier' ? '供應商發票' : '客戶發票', invoiceId, identity.invoiceNo)
    return c.json({ id: invoiceId, invoice_no: identity.invoiceNo, verification_code: verifyCode }, 201)
  } catch (e: any) {
    return c.json({ error: String(e.message) }, 500)
  }
})

app.put('/api/invoices/:id', authMiddleware, requirePerm('customer_order.create'), async c => {
  try {
    const id = c.req.param('id')
    const b = await c.req.json()
    const header = await queryOne<any>('SELECT status FROM invoice_headers WHERE id=? AND deleted_at IS NULL', [id])
    if (!header) return c.json({ error: 'Not found' }, 404)
    if (header.status !== 'draft') return c.json({ error: 'only draft invoice can be edited' }, 400)
    const invoiceDate = b?.invoice_date ? toDateStr(b.invoice_date) : null
    await execute('UPDATE invoice_headers SET invoice_date=?, remark=?, tax_rate=? WHERE id=?', [invoiceDate, b?.remark || '', toMoney(b?.tax_rate || 0), id])

    const items = Array.isArray(b?.items) ? b.items : []
    let totalAmount = 0
    for (const item of items) {
      const itemId = Number(item?.id || 0)
      if (!itemId) continue
      const row = await queryOne<any>('SELECT id, qty, unit_price FROM invoice_items WHERE id=? AND invoice_id=? AND deleted_at IS NULL', [itemId, id])
      if (!row) continue
      const qty = Math.max(0, toQty(item?.qty))
      const unitPrice = toMoney(item?.unit_price === undefined ? row.unit_price : item?.unit_price)
      const amount = toMoney(qty * unitPrice)
      totalAmount += amount
      await execute('UPDATE invoice_items SET qty=?, unit_price=?, amount=? WHERE id=?', [qty, unitPrice, amount, itemId])
    }

    const latestItems = await query<any>('SELECT amount FROM invoice_items WHERE invoice_id=? AND deleted_at IS NULL', [id])
    totalAmount = latestItems.reduce((sum: number, x: any) => sum + toMoney(x.amount), 0)
    const latestHeader = await queryOne<any>('SELECT tax_rate FROM invoice_headers WHERE id=?', [id])
    const taxRate = toMoney(latestHeader?.tax_rate || 0)
    const taxAmount = toMoney(totalAmount * (taxRate / 100))
    const grandTotal = toMoney(totalAmount + taxAmount)
    await execute('UPDATE invoice_headers SET total_amount=?, tax_amount=?, grand_total=? WHERE id=?', [toMoney(totalAmount), taxAmount, grandTotal, id])
    return c.json({ ok: true })
  } catch (e: any) {
    return c.json({ error: String(e.message) }, 500)
  }
})

app.patch('/api/invoices/:id/confirm', authMiddleware, requirePerm('customer_order.create'), async c => {
  try {
    const id = c.req.param('id')
    const u = c.get('user')
    const header = await queryOne<any>('SELECT id, status, invoice_type, invoice_no FROM invoice_headers WHERE id=? AND deleted_at IS NULL', [id])
    if (!header) return c.json({ error: 'Not found' }, 404)
    if (header.status !== 'draft') return c.json({ error: 'already confirmed' }, 400)
    const items = await query<any>('SELECT order_item_id, qty FROM invoice_items WHERE invoice_id=? AND deleted_at IS NULL', [id])
    if (!items.length) return c.json({ error: 'no items' }, 400)

    if (header.invoice_type === 'customer') {
      const settleMap = new Map<number, number>()
      for (const item of items) {
        const orderItemId = Number(item.order_item_id || 0)
        const qty = toQty(item.qty)
        if (!orderItemId || qty <= 0) continue
        settleMap.set(orderItemId, toQty((settleMap.get(orderItemId) || 0) + qty))
      }
      const orderItemIds = Array.from(settleMap.keys())
      if (orderItemIds.length) {
        const caseClause = orderItemIds.map(() => 'WHEN ? THEN ?').join(' ')
        const inClause = orderItemIds.map(() => '?').join(',')
        const params: any[] = []
        for (const oid of orderItemIds) {
          params.push(oid, settleMap.get(oid) || 0)
        }
        params.push(...orderItemIds)
        await execute(`
          UPDATE customer_order_items
          SET settled_qty = LEAST(COALESCE(reconciled_qty, qty), COALESCE(settled_qty, 0) + CASE id ${caseClause} ELSE 0 END)
          WHERE id IN (${inClause})
        `, params)
      }
    }

    await execute('UPDATE invoice_headers SET status=?, confirmed_by=?, confirmed_at=? WHERE id=?', ['confirmed', u?.userId || null, now8(), id])
    await audit(u, 'CONFIRM', header.invoice_type === 'supplier' ? '供應商發票' : '客戶發票', id, header.invoice_no || `id=${id}`)
    return c.json({ ok: true })
  } catch (e: any) {
    return c.json({ error: String(e.message) }, 500)
  }
})

app.delete('/api/invoices/:id', authMiddleware, requirePerm('customer_order.create'), async c => {
  try {
    const id = c.req.param('id')
    const row = await queryOne<any>('SELECT invoice_no, status, invoice_type FROM invoice_headers WHERE id=? AND deleted_at IS NULL', [id])
    if (!row) return c.json({ error: 'Not found' }, 404)
    if (row.status !== 'draft') return c.json({ error: 'only draft invoice can be deleted' }, 400)
    await softDeleteById('invoice_headers', id, c.get('user')?.userId)
    await audit(c.get('user'), 'DELETE', row.invoice_type === 'supplier' ? '供應商發票' : '客戶發票', id, row.invoice_no)
    return c.json({ ok: true })
  } catch (e: any) {
    return c.json({ error: String(e.message) }, 500)
  }
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
           COALESCE(NULLIF(m.material_name,''), NULLIF(dni.item_name,''), b.product_name, '') as item_name,
           COALESCE(NULLIF(m.spec,''), NULLIF(dni.spec,''), b.spec) as spec,
           COALESCE(NULLIF(m.unit,''), NULLIF(dni.unit,''), b.unit, 'PCS') as unit
    FROM delivery_note_items dni
    LEFT JOIN materials m ON (
      (dni.material_id IS NOT NULL AND dni.material_id > 0 AND dni.material_id = m.id)
      OR ((dni.material_id IS NULL OR dni.material_id = 0) AND dni.material_code = m.material_code)
    ) AND m.deleted_at IS NULL
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
        const materialId = await resolveMaterialId(item.material_id, item.material_code)
        await execute('INSERT INTO delivery_note_items (dn_id,material_id,item_name,material_code,spec,unit,qty,remark,po_ref,thickness) VALUES (?,?,?,?,?,?,?,?,?,?)',
          [dnId, materialId, item.item_name||'', item.material_code||'', item.spec||'', item.unit||'PCS', item.qty||0, item.remark||'', item.po_ref||'', item.thickness||null])
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
        const materialId = await resolveMaterialId(item.material_id, item.material_code)
        await execute('INSERT INTO delivery_note_items (dn_id,material_id,item_name,material_code,spec,unit,qty,remark,po_ref,thickness) VALUES (?,?,?,?,?,?,?,?,?,?)',
          [id, materialId, item.item_name||'', item.material_code||'', item.spec||'', item.unit||'PCS', item.qty||0, item.remark||'', item.po_ref||'', item.thickness||null])
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

    await execute('UPDATE delivery_notes SET status=? WHERE id=?', [status, id])

    // 客戶訂單數量回寫改為在「數量核對確認」階段執行，出貨確認僅更新出貨單狀態。

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
           COALESCE(NULLIF(m.material_name,''), NULLIF(dsi.item_name,''), b.product_name, '') as item_name,
           COALESCE(NULLIF(m.spec,''), NULLIF(dsi.spec,''), b.spec) as spec,
           COALESCE(NULLIF(m.unit,''), NULLIF(dsi.unit,''), b.unit, 'PCS') as unit
    FROM delivery_sheet_items dsi
    LEFT JOIN materials m ON (
      (dsi.material_id IS NOT NULL AND dsi.material_id > 0 AND dsi.material_id = m.id)
      OR ((dsi.material_id IS NULL OR dsi.material_id = 0) AND dsi.material_code = m.material_code)
    ) AND m.deleted_at IS NULL
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
        const materialId = await resolveMaterialId(item.material_id, item.material_code)
        await execute('INSERT INTO delivery_sheet_items (ds_id,material_id,item_name,material_code,spec,unit,qty,remark,po_ref,thickness) VALUES (?,?,?,?,?,?,?,?,?,?)',
          [dsId, materialId, item.item_name||'', item.material_code||'', item.spec||'', item.unit||'PCS', item.qty||0, item.remark||'', item.po_ref||'', item.thickness||null])
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
        const materialId = await resolveMaterialId(item.material_id, item.material_code)
        await execute('INSERT INTO delivery_sheet_items (ds_id,material_id,item_name,material_code,spec,unit,qty,remark,po_ref,thickness) VALUES (?,?,?,?,?,?,?,?,?,?)',
          [id, materialId, item.item_name||'', item.material_code||'', item.spec||'', item.unit||'PCS', item.qty||0, item.remark||'', item.po_ref||'', item.thickness||null])
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
app.get('/api/users', authMiddleware, requireManager, async c => {
  return c.json(await query(`
    SELECT id,email,name,
           CASE WHEN role IN ('manager','admin') THEN 'manager' ELSE 'employee' END as role,
           created_at
    FROM users
    WHERE deleted_at IS NULL
    ORDER BY created_at DESC
  `))
})
app.post('/api/users', authMiddleware, requireManager, async c => {
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
app.put('/api/users/:id', authMiddleware, requireManager, async c => {
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
app.delete('/api/users/:id', authMiddleware, requireManager, async c => {
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
app.get('/api/role-permissions', authMiddleware, requireManager, async c => {
  try {
    const rows = await query<any>('SELECT role,permission,allowed FROM role_permissions')
    const map: any = {}
    rows.forEach(r => { if (!map[r.role]) map[r.role] = {}; map[r.role][r.permission] = r.allowed === 1 })
    return c.json({ permissions: map, allPermissions: ALL_PERMISSIONS })
  } catch (e: any) { return c.json({ error: String(e.message) }, 500) }
})
app.put('/api/role-permissions', authMiddleware, requireManager, async c => {
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
// 來源：已確認客戶發票 → 待收款；可標記已收款
app.get('/api/receivables', authMiddleware, async c => {
  try {
    const rows = await query<any>(`
      SELECT
        ih.id,
        ih.invoice_no as dn_number,
        ih.party_name as customer_name,
        ih.invoice_date as delivery_date,
        ih.status,
        ih.remark,
        ih.created_at,
        COALESCE(ih.received_amount, 0) as received_amount,
        COALESCE(ih.grand_total, 0) as invoice_amount,
        ih.payment_status,
        ih.payment_date,
        ih.payment_note,
        (
          SELECT GROUP_CONCAT(DISTINCT ii.po_number ORDER BY ii.po_number SEPARATOR ', ')
          FROM invoice_items ii
          WHERE ii.invoice_id = ih.id AND ii.deleted_at IS NULL
        ) as customer_po
      FROM invoice_headers ih
      WHERE ih.invoice_type = 'customer'
        AND ih.status = 'confirmed'
        AND ih.deleted_at IS NULL
      ORDER BY ih.created_at DESC
    `)
    return c.json(rows)
  } catch (e: any) { return c.json({ error: String(e.message) }, 500) }
})
app.patch('/api/receivables/:id/payment', authMiddleware, async c => {
  try {
    const id = c.req.param('id')
    const { payment_status, received_amount, payment_date, payment_note } = await c.req.json()
    const header = await queryOne<any>('SELECT grand_total FROM invoice_headers WHERE id=? AND invoice_type=\'customer\' AND deleted_at IS NULL', [id])
    if (!header) return c.json({ error: 'Not found' }, 404)
    const total = toMoney(header.grand_total)
    const received = Math.max(0, toMoney(received_amount || 0))
    const status = received <= 0 ? 'pending' : received >= total ? 'paid' : 'partial'
    await execute(
      'UPDATE invoice_headers SET payment_status=?, received_amount=?, payment_date=?, payment_note=? WHERE id=? AND invoice_type=\'customer\'',
      [status || payment_status, received, payment_date||null, payment_note||'', id]
    )
    const row = await queryOne<any>('SELECT invoice_no, party_name FROM invoice_headers WHERE id=? AND deleted_at IS NULL', [id])
    await audit(c.get('user'), 'PAYMENT', '應收帳款', id, `${row?.invoice_no} ${status}`)
    return c.json({ ok: true })
  } catch (e: any) { return c.json({ error: String(e.message) }, 500) }
})

app.get('/api/receivables/export/csv', authMiddleware, async c => {
  try {
    const rows = await query<any>(`
      SELECT
        ih.invoice_no,
        ih.party_name as customer_name,
        ih.invoice_date,
        ih.grand_total as invoice_amount,
        ih.received_amount,
        ih.payment_status,
        ih.payment_date,
        ih.payment_note
      FROM invoice_headers ih
      WHERE ih.invoice_type='customer' AND ih.status='confirmed' AND ih.deleted_at IS NULL
      ORDER BY ih.created_at DESC
      LIMIT 5000
    `)
    const esc = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const header = ['invoice_no', 'customer_name', 'invoice_date', 'invoice_amount', 'received_amount', 'payment_status', 'payment_date', 'payment_note']
    const lines = [header.join(',')]
    for (const row of rows) {
      lines.push([
        row.invoice_no, row.customer_name, row.invoice_date, toMoney(row.invoice_amount), toMoney(row.received_amount), row.payment_status, row.payment_date, row.payment_note,
      ].map(esc).join(','))
    }
    return c.text(lines.join('\n'))
  } catch (e: any) {
    return c.json({ error: String(e.message) }, 500)
  }
})

// ── 應付帳款 (Payables) ───────────────────────────────────────────────────────
// 來源：已確認供應商發票 → 待付款；可標記已付款
app.get('/api/payables', authMiddleware, async c => {
  try {
    const rows = await query<any>(`
      SELECT
        ih.id,
        ih.invoice_no as po_number,
        ih.party_name as supplier_name,
        ih.grand_total as total_amount,
        ih.currency,
        ih.status,
        COALESCE(ih.paid_amount, 0) as paid_amount,
        ih.payment_status,
        ih.payment_date,
        ih.payment_note,
        ih.created_at,
        ih.confirmed_at as approved_at
      FROM invoice_headers ih
      WHERE ih.invoice_type = 'supplier'
        AND ih.status = 'confirmed'
        AND ih.deleted_at IS NULL
      ORDER BY ih.created_at DESC
    `)
    return c.json(rows)
  } catch (e: any) { return c.json({ error: String(e.message) }, 500) }
})
app.patch('/api/payables/:id/payment', authMiddleware, async c => {
  try {
    const id = c.req.param('id')
    const { payment_status, paid_amount, payment_date, payment_note } = await c.req.json()
    const header = await queryOne<any>('SELECT grand_total FROM invoice_headers WHERE id=? AND invoice_type=\'supplier\' AND deleted_at IS NULL', [id])
    if (!header) return c.json({ error: 'Not found' }, 404)
    const total = toMoney(header.grand_total)
    const paid = Math.max(0, toMoney(paid_amount || 0))
    const status = paid <= 0 ? 'pending' : paid >= total ? 'paid' : 'partial'
    await execute(
      'UPDATE invoice_headers SET payment_status=?, paid_amount=?, payment_date=?, payment_note=? WHERE id=? AND invoice_type=\'supplier\'',
      [status || payment_status, paid, payment_date||null, payment_note||'', id]
    )
    const row = await queryOne<any>('SELECT invoice_no, party_name FROM invoice_headers WHERE id=? AND deleted_at IS NULL', [id])
    await audit(c.get('user'), 'PAYMENT', '應付帳款', id, `${row?.invoice_no} ${status}`)
    return c.json({ ok: true })
  } catch (e: any) { return c.json({ error: String(e.message) }, 500) }
})

app.get('/api/payables/export/csv', authMiddleware, async c => {
  try {
    const rows = await query<any>(`
      SELECT
        ih.invoice_no,
        ih.party_name as supplier_name,
        ih.invoice_date,
        ih.grand_total as payable_amount,
        ih.paid_amount,
        ih.payment_status,
        ih.payment_date,
        ih.payment_note
      FROM invoice_headers ih
      WHERE ih.invoice_type='supplier' AND ih.status='confirmed' AND ih.deleted_at IS NULL
      ORDER BY ih.created_at DESC
      LIMIT 5000
    `)
    const esc = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const header = ['invoice_no', 'supplier_name', 'invoice_date', 'payable_amount', 'paid_amount', 'payment_status', 'payment_date', 'payment_note']
    const lines = [header.join(',')]
    for (const row of rows) {
      lines.push([
        row.invoice_no, row.supplier_name, row.invoice_date, toMoney(row.payable_amount), toMoney(row.paid_amount), row.payment_status, row.payment_date, row.payment_note,
      ].map(esc).join(','))
    }
    return c.text(lines.join('\n'))
  } catch (e: any) {
    return c.json({ error: String(e.message) }, 500)
  }
})

// ── 報表 (Reports) ────────────────────────────────────────────────────────────
app.get('/api/reports', authMiddleware, async c => {
  try {
    const url = new URL(c.req.url)
    const year = url.searchParams.get('year') || new Date().getFullYear().toString()

    // 應收：客戶發票金額，按月
    const receivables = await query<any>(`
      SELECT DATE_FORMAT(COALESCE(ih.invoice_date, ih.created_at), '%Y-%m') as month,
             SUM(COALESCE(ih.grand_total, 0)) as invoiced,
             SUM(CASE WHEN ih.payment_status='paid' THEN COALESCE(ih.received_amount, 0) ELSE 0 END) as received,
             COUNT(DISTINCT ih.id) as count
      FROM invoice_headers ih
      WHERE ih.invoice_type='customer'
        AND ih.status='confirmed'
        AND DATE_FORMAT(COALESCE(ih.invoice_date, ih.created_at), '%Y') = ?
        AND ih.deleted_at IS NULL
      GROUP BY month ORDER BY month
    `, [year])

    // 應付：供應商發票金額，按月
    const payables = await query<any>(`
      SELECT DATE_FORMAT(COALESCE(invoice_date, created_at), '%Y-%m') as month,
             SUM(grand_total) as total,
             SUM(CASE WHEN payment_status='paid' THEN COALESCE(paid_amount, 0) ELSE 0 END) as paid,
             COUNT(*) as count
      FROM invoice_headers
      WHERE invoice_type='supplier'
        AND status='confirmed'
        AND deleted_at IS NULL
        AND DATE_FORMAT(COALESCE(invoice_date, created_at), '%Y') = ?
      GROUP BY month ORDER BY month
    `, [year])

    // 匯總
    const summary = await queryOne<any>(`
      SELECT
        (SELECT COALESCE(SUM(grand_total), 0) FROM invoice_headers WHERE invoice_type='customer' AND status='confirmed' AND deleted_at IS NULL) as total_invoiced,
        (SELECT COALESCE(SUM(received_amount), 0) FROM invoice_headers WHERE invoice_type='customer' AND status='confirmed' AND payment_status='paid' AND deleted_at IS NULL) as total_received,
        (SELECT COALESCE(SUM(grand_total - received_amount), 0) FROM invoice_headers WHERE invoice_type='customer' AND status='confirmed' AND payment_status!='paid' AND deleted_at IS NULL) as total_outstanding_receivable,
        (SELECT COALESCE(SUM(grand_total), 0) FROM invoice_headers WHERE invoice_type='supplier' AND status='confirmed' AND deleted_at IS NULL) as total_payable,
        (SELECT COALESCE(SUM(paid_amount), 0) FROM invoice_headers WHERE invoice_type='supplier' AND status='confirmed' AND payment_status='paid' AND deleted_at IS NULL) as total_paid,
        (SELECT COALESCE(SUM(grand_total - paid_amount), 0) FROM invoice_headers WHERE invoice_type='supplier' AND status='confirmed' AND payment_status!='paid' AND deleted_at IS NULL) as total_outstanding_payable
    `)

    return c.json({ receivables, payables, summary, year })
  } catch (e: any) { return c.json({ error: String(e.message) }, 500) }
})

// ── Process Health (流程健康度) ──────────────────────────────────────────────
app.get('/api/process-health', authMiddleware, async c => {
  try {
    const overdueDays = Math.min(parsePositiveInt(c.req.query('overdue_days'), 30, 365), 365)

    const [pendingReconcile, pendingCustomerInvoice, pendingSupplierInvoice, overdueReceivable, overduePayable, draftCounts] = await Promise.all([
      queryOne<any>(`
        SELECT COUNT(*) as cnt
        FROM delivery_note_items dni
        JOIN delivery_notes dn ON dn.id = dni.dn_id
        LEFT JOIN shipment_reconciliation_items sri ON sri.delivery_note_item_id = dni.id AND sri.deleted_at IS NULL
        WHERE dn.status = 'shipped'
          AND dn.deleted_at IS NULL
          AND sri.id IS NULL
      `),
      queryOne<any>(`
        SELECT
          COUNT(*) as item_count,
          COALESCE(SUM(GREATEST(0, COALESCE(sri.accepted_qty, 0) - COALESCE(inv.qty, 0))), 0) as remaining_qty
        FROM shipment_reconciliation_items sri
        JOIN shipment_reconciliations sr ON sr.id = sri.reconciliation_id
        LEFT JOIN (
          SELECT ii.reconciliation_item_id, COALESCE(SUM(ii.qty), 0) as qty
          FROM invoice_items ii
          JOIN invoice_headers ih ON ih.id = ii.invoice_id
          WHERE ih.invoice_type = 'customer'
            AND ih.status = 'confirmed'
            AND ih.deleted_at IS NULL
            AND ii.deleted_at IS NULL
          GROUP BY ii.reconciliation_item_id
        ) inv ON inv.reconciliation_item_id = sri.id
        WHERE sr.status = 'confirmed'
          AND sr.deleted_at IS NULL
          AND sri.deleted_at IS NULL
          AND GREATEST(0, COALESCE(sri.accepted_qty, 0) - COALESCE(inv.qty, 0)) > 0
      `),
      queryOne<any>(`
        SELECT
          COUNT(*) as item_count,
          COALESCE(SUM(GREATEST(0, COALESCE(sri.accepted_qty, 0) - COALESCE(inv.qty, 0))), 0) as remaining_qty
        FROM shipment_reconciliation_items sri
        JOIN shipment_reconciliations sr ON sr.id = sri.reconciliation_id
        LEFT JOIN (
          SELECT ii.reconciliation_item_id, COALESCE(SUM(ii.qty), 0) as qty
          FROM invoice_items ii
          JOIN invoice_headers ih ON ih.id = ii.invoice_id
          WHERE ih.invoice_type = 'supplier'
            AND ih.status = 'confirmed'
            AND ih.deleted_at IS NULL
            AND ii.deleted_at IS NULL
          GROUP BY ii.reconciliation_item_id
        ) inv ON inv.reconciliation_item_id = sri.id
        WHERE sr.status = 'confirmed'
          AND sr.deleted_at IS NULL
          AND sri.deleted_at IS NULL
          AND GREATEST(0, COALESCE(sri.accepted_qty, 0) - COALESCE(inv.qty, 0)) > 0
      `),
      queryOne<any>(`
        SELECT
          COUNT(*) as invoice_count,
          COALESCE(SUM(GREATEST(0, COALESCE(ih.grand_total, 0) - COALESCE(ih.received_amount, 0))), 0) as outstanding_amount
        FROM invoice_headers ih
        WHERE ih.invoice_type = 'customer'
          AND ih.status = 'confirmed'
          AND ih.deleted_at IS NULL
          AND COALESCE(ih.payment_status, 'pending') != 'paid'
          AND DATEDIFF(CURDATE(), COALESCE(ih.invoice_date, DATE(ih.created_at))) > ?
      `, [overdueDays]),
      queryOne<any>(`
        SELECT
          COUNT(*) as invoice_count,
          COALESCE(SUM(GREATEST(0, COALESCE(ih.grand_total, 0) - COALESCE(ih.paid_amount, 0))), 0) as outstanding_amount
        FROM invoice_headers ih
        WHERE ih.invoice_type = 'supplier'
          AND ih.status = 'confirmed'
          AND ih.deleted_at IS NULL
          AND COALESCE(ih.payment_status, 'pending') != 'paid'
          AND DATEDIFF(CURDATE(), COALESCE(ih.invoice_date, DATE(ih.created_at))) > ?
      `, [overdueDays]),
      queryOne<any>(`
        SELECT
          (SELECT COUNT(*) FROM shipment_reconciliations sr WHERE sr.status='draft' AND sr.deleted_at IS NULL) as draft_reconciliations,
          (SELECT COUNT(*) FROM invoice_headers ih WHERE ih.status='draft' AND ih.deleted_at IS NULL) as draft_invoices
      `),
    ])

    return c.json({
      generated_at: now8(),
      overdue_days: overdueDays,
      pending_reconciliation_items: Number(pendingReconcile?.cnt || 0),
      pending_customer_invoice_items: Number(pendingCustomerInvoice?.item_count || 0),
      pending_customer_invoice_qty: toQty(pendingCustomerInvoice?.remaining_qty || 0),
      pending_supplier_invoice_items: Number(pendingSupplierInvoice?.item_count || 0),
      pending_supplier_invoice_qty: toQty(pendingSupplierInvoice?.remaining_qty || 0),
      overdue_receivables: {
        invoice_count: Number(overdueReceivable?.invoice_count || 0),
        outstanding_amount: toMoney(overdueReceivable?.outstanding_amount || 0),
      },
      overdue_payables: {
        invoice_count: Number(overduePayable?.invoice_count || 0),
        outstanding_amount: toMoney(overduePayable?.outstanding_amount || 0),
      },
      draft_reconciliations: Number(draftCounts?.draft_reconciliations || 0),
      draft_invoices: Number(draftCounts?.draft_invoices || 0),
    })
  } catch (e: any) {
    return c.json({ error: String(e.message) }, 500)
  }
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
    SELECT gri.*,
           COALESCE(NULLIF(m.material_name,''), NULLIF(gri.material_name,''), b.product_name, '') as material_name,
           COALESCE(NULLIF(m.spec,''), NULLIF(gri.spec,''), b.spec) as spec,
           COALESCE(NULLIF(m.unit,''), NULLIF(gri.unit,''), b.unit, 'PCS') as unit
    FROM goods_receipt_items gri
    LEFT JOIN materials m ON (
      (gri.material_id IS NOT NULL AND gri.material_id > 0 AND gri.material_id = m.id)
      OR ((gri.material_id IS NULL OR gri.material_id = 0) AND gri.material_code = m.material_code)
    ) AND m.deleted_at IS NULL
    LEFT JOIN bom b ON gri.material_code = b.product_sku AND b.deleted_at IS NULL
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
        const materialId = await resolveMaterialId(item.material_id, item.material_code)
        await execute(
          'INSERT INTO goods_receipt_items (gr_id,po_item_id,material_id,material_code,material_name,spec,unit,ordered_qty,received_qty,unit_price,currency,batch_no,remark) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
          [grId,item.po_item_id||null,materialId,item.material_code,item.material_name,item.spec||'',item.unit||'PCS',item.ordered_qty||0,item.received_qty,item.unit_price||0,item.currency||'VND',item.batch_no||'',item.remark||'']
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
        const materialId = await resolveMaterialId(mat.material_id, mat.material_code)
        await execute(
          'INSERT INTO production_materials (prod_id,material_id,material_code,material_name,spec,unit,planned_qty,issued_qty,batch_no,remark) VALUES (?,?,?,?,?,?,?,?,?,?)',
          [prodId,materialId,mat.material_code,mat.material_name,mat.spec||'',mat.unit||'PCS',mat.planned_qty||0,0,mat.batch_no||'',mat.remark||'']
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
        const materialId = await resolveMaterialId(mat.material_id, mat.material_code)
        await execute('INSERT INTO production_materials (prod_id,material_id,material_code,material_name,spec,unit,planned_qty,issued_qty,batch_no,remark) VALUES (?,?,?,?,?,?,?,?,?,?)',
          [id,materialId,mat.material_code,mat.material_name,mat.spec||'',mat.unit||'PCS',mat.planned_qty||0,0,mat.batch_no||'',mat.remark||''])
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
        const materialId = await resolveMaterialId(item.material_id, item.material_code)
        const bom = await queryOne<any>('SELECT current_stock FROM bom WHERE product_sku=?', [item.material_code])
        const systemQty = parseFloat(bom?.current_stock) || 0
        const diff = (item.actual_qty || 0) - systemQty
        await execute(
          'INSERT INTO stock_adjustment_items (adj_id,material_id,material_code,material_name,unit,system_qty,actual_qty,diff_qty,batch_no,remark) VALUES (?,?,?,?,?,?,?,?,?,?)',
          [adjId,materialId,item.material_code,item.material_name||'',item.unit||'PCS',systemQty,item.actual_qty||0,diff,item.batch_no||'',item.remark||'']
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
app.put('/api/company', authMiddleware, requireManager, async c => {
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
console.log(`RUBBER MES Backend starting on port ${port}`)
serve({ fetch: app.fetch, port }, info => {
  console.log(`✓ Server running at http://localhost:${info.port}`)
})
