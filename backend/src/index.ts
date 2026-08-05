import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { query, queryOne, execute, withTransaction, type DbExecutor } from './db'
import { hashPw, signJwt, verifyJwt, now8 } from './auth'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { sendNotificationEmail, buildPendingApprovalEmail } from './mailer'
import { buildOrderQuantityCaseUpdate, type OrderQuantityUpdate } from './order-quantity-sync'
import { validateDeliveryStatusTransition } from './delivery-status'

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
  await ensureOrderReferenceColumns()
  await ensureBomStockColumns()
  await ensureStockLedgerTable()
  await ensureMaterialExtraColumns()
  await ensureBomExtraColumns()
  await ensureBomItemsExtraColumns()
  await ensurePoItemReceivedQtyColumn()
  await ensurePoItemMaterialIdColumn()
  await ensurePoItemProgressIdColumn()
  await ensurePoItemProgressItemIdColumn()
  await ensurePoItemProgressItemMaterialIdColumn()
  await ensureMaterialReferenceColumns()
  await ensureQuotationItemMoqColumn()
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
  // Login normalizes legacy `admin` accounts to `manager` in the JWT.
  if (normalizeUserRole(user?.role) !== 'manager') return c.json({ error: 'Forbidden' }, 403)
  await next()
}

// Dynamic RBAC permission check — manager always pass, employee checks role_permissions
async function hasPermission(user: any, permKey: string) {
  if (!user) return false
  if (user.role === 'manager') return true
  const row = await queryOne<any>(
    'SELECT allowed FROM role_permissions WHERE role=? AND permission=? AND allowed=1',
    [normalizeUserRole(user.role), permKey]
  )
  return !!row
}

function requirePerm(permKey: string) {
  return async (c: any, next: () => Promise<void>) => {
    const user = c.get('user')
    if (!user) return c.json({ error: 'Unauthorized' }, 401)
    if (!await hasPermission(user, permKey)) return c.json({ error: `無此操作權限（${permKey}）` }, 403)
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

let ensureCompanySignatureColumnPromise: Promise<void> | null = null
const ensureCompanySignatureColumn = async () => {
  if (!ensureCompanySignatureColumnPromise) {
    ensureCompanySignatureColumnPromise = (async () => {
      try {
        await execute('ALTER TABLE company_settings ADD COLUMN signature_url TEXT NULL')
      } catch (e: any) {
        const msg = String(e?.message || '').toLowerCase()
        if (!msg.includes('duplicate column')) throw e
      }
    })().catch((e) => {
      ensureCompanySignatureColumnPromise = null
      throw e
    })
  }
  await ensureCompanySignatureColumnPromise
}

let ensureCompanySignaturePrintColumnsPromise: Promise<void> | null = null
const ensureCompanySignaturePrintColumns = async () => {
  if (!ensureCompanySignaturePrintColumnsPromise) {
    ensureCompanySignaturePrintColumnsPromise = (async () => {
      const alterSafe = async (sql: string) => {
        try {
          await execute(sql)
        } catch (e: any) {
          const msg = String(e?.message || '').toLowerCase()
          if (!msg.includes('duplicate column')) throw e
        }
      }
      await alterSafe('ALTER TABLE company_settings ADD COLUMN signature_print_width INT NOT NULL DEFAULT 220')
      await alterSafe('ALTER TABLE company_settings ADD COLUMN signature_print_height INT NOT NULL DEFAULT 72')
    })().catch((e) => {
      ensureCompanySignaturePrintColumnsPromise = null
      throw e
    })
  }
  await ensureCompanySignaturePrintColumnsPromise
}

let ensureCompanyNotificationEmailPromise: Promise<void> | null = null
const ensureCompanyNotificationEmail = async () => {
  if (!ensureCompanyNotificationEmailPromise) {
    ensureCompanyNotificationEmailPromise = (async () => {
      try {
        await execute("ALTER TABLE company_settings ADD COLUMN notification_email VARCHAR(255) NOT NULL DEFAULT ''")
      } catch (e: any) {
        const msg = String(e?.message || '').toLowerCase()
        if (!msg.includes('duplicate column')) throw e
      }
    })().catch((e) => {
      ensureCompanyNotificationEmailPromise = null
      throw e
    })
  }
  await ensureCompanyNotificationEmailPromise
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
      await alterSafe("ALTER TABLE customer_order_items ADD COLUMN po_no VARCHAR(255) NOT NULL DEFAULT ''")
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

let ensureOrderReferenceColumnsPromise: Promise<void> | null = null
const ensureOrderReferenceColumns = async () => {
  if (!ensureOrderReferenceColumnsPromise) {
    ensureOrderReferenceColumnsPromise = (async () => {
      const alterSafe = async (sql: string) => {
        try {
          await execute(sql)
        } catch (e: any) {
          const msg = String(e?.message || '').toLowerCase()
          if (
            !msg.includes('duplicate column') &&
            !msg.includes("doesn't exist") &&
            !msg.includes('unknown column')
          ) throw e
        }
      }

      await alterSafe("ALTER TABLE customer_orders MODIFY COLUMN po_number VARCHAR(255) NOT NULL")
      await alterSafe("ALTER TABLE customer_order_items MODIFY COLUMN po_no VARCHAR(255) NOT NULL DEFAULT ''")
      await alterSafe("ALTER TABLE delivery_progress MODIFY COLUMN order_po_number VARCHAR(255) DEFAULT ''")
      await alterSafe("ALTER TABLE delivery_progress_po_links MODIFY COLUMN order_po_number VARCHAR(255) NOT NULL DEFAULT ''")
      await alterSafe("ALTER TABLE delivery_progress_items MODIFY COLUMN order_po_number VARCHAR(255) DEFAULT ''")
      await alterSafe("ALTER TABLE delivery_progress_items MODIFY COLUMN customer_po_number VARCHAR(255) DEFAULT ''")
      await alterSafe("ALTER TABLE shipment_reconciliation_items MODIFY COLUMN po_number VARCHAR(255) NULL")
      await alterSafe("ALTER TABLE invoice_items MODIFY COLUMN po_number VARCHAR(255) NULL")
      await alterSafe("ALTER TABLE delivery_note_items MODIFY COLUMN po_ref TEXT")
      await alterSafe("ALTER TABLE delivery_sheet_items MODIFY COLUMN po_ref TEXT")
      await alterSafe("ALTER TABLE po_items MODIFY COLUMN po_ref TEXT")
    })().catch((e) => {
      ensureOrderReferenceColumnsPromise = null
      throw e
    })
  }
  await ensureOrderReferenceColumnsPromise
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
          po_number VARCHAR(255),
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

let ensurePoItemProgressItemMaterialIdColumnPromise: Promise<void> | null = null
const ensurePoItemProgressItemMaterialIdColumn = async () => {
  if (!ensurePoItemProgressItemMaterialIdColumnPromise) {
    ensurePoItemProgressItemMaterialIdColumnPromise = (async () => {
      const alterSafe = async (sql: string) => {
        try {
          await execute(sql)
        } catch (e: any) {
          const msg = String(e?.message || '').toLowerCase()
          if (!msg.includes('duplicate column') && !msg.includes('duplicate key name') && !msg.includes('duplicate index')) throw e
        }
      }
      await alterSafe('ALTER TABLE po_items ADD COLUMN progress_item_material_id INT NULL AFTER progress_item_id')
      await alterSafe('ALTER TABLE po_items ADD INDEX idx_po_items_progress_item_material_id (progress_item_material_id)')
    })().catch((e) => {
      ensurePoItemProgressItemMaterialIdColumnPromise = null
      throw e
    })
  }
  await ensurePoItemProgressItemMaterialIdColumnPromise
}

let ensureDeliveryNoteProgressIdColumnPromise: Promise<void> | null = null
const ensureDeliveryNoteProgressIdColumn = async () => {
  if (!ensureDeliveryNoteProgressIdColumnPromise) {
    ensureDeliveryNoteProgressIdColumnPromise = (async () => {
      const alterSafe = async (sql: string) => {
        try {
          await execute(sql)
        } catch (e: any) {
          const msg = String(e?.message || '').toLowerCase()
          if (!msg.includes('duplicate column') && !msg.includes('duplicate key name') && !msg.includes('duplicate index')) throw e
        }
      }
      await alterSafe('ALTER TABLE delivery_notes ADD COLUMN progress_id INT NULL AFTER customer_order_id')
      await alterSafe('ALTER TABLE delivery_notes ADD INDEX idx_delivery_notes_progress_id (progress_id)')
      await alterSafe('ALTER TABLE delivery_note_items MODIFY COLUMN po_ref TEXT')
      await alterSafe('ALTER TABLE delivery_note_items ADD COLUMN order_item_id INT NULL AFTER dn_id')
      await alterSafe('ALTER TABLE delivery_note_items ADD INDEX idx_delivery_note_items_order_item_id (order_item_id)')
    })().catch((e) => {
      ensureDeliveryNoteProgressIdColumnPromise = null
      throw e
    })
  }
  await ensureDeliveryNoteProgressIdColumnPromise
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
          order_po_number VARCHAR(255) DEFAULT '',
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
          order_po_number VARCHAR(255) NOT NULL DEFAULT '',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          deleted_at DATETIME NULL,
          deleted_by INT NULL
        )
      `)
      await execute(`
        CREATE TABLE IF NOT EXISTS delivery_progress_items (
          id INT AUTO_INCREMENT PRIMARY KEY,
          progress_id INT NOT NULL,
          line_type VARCHAR(20) NOT NULL DEFAULT 'material',
          customer_order_id INT NULL,
          order_item_id INT NULL,
          order_po_number VARCHAR(255) DEFAULT '',
          customer_po_number VARCHAR(255) DEFAULT '',
          bom_id INT NULL,
          bom_code VARCHAR(255) DEFAULT '',
          bom_name VARCHAR(255) DEFAULT '',
          material_id INT NULL,
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
      await execute(`
        CREATE TABLE IF NOT EXISTS delivery_progress_item_materials (
          id INT AUTO_INCREMENT PRIMARY KEY,
          progress_id INT NOT NULL,
          progress_item_id INT NOT NULL,
          bom_item_id INT NULL,
          material_id INT NULL,
          material_code VARCHAR(255) DEFAULT '',
          material_name VARCHAR(255) DEFAULT '',
          spec VARCHAR(255) DEFAULT '',
          unit VARCHAR(50) DEFAULT 'PCS',
          bom_unit_qty DECIMAL(15,4) NOT NULL DEFAULT 0,
          supplier_id INT NULL,
          supplier_name VARCHAR(255) DEFAULT '',
          due_date DATE NULL,
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
      await alterSafe("ALTER TABLE delivery_progress_items ADD COLUMN order_po_number VARCHAR(255) DEFAULT '' AFTER progress_id")
      await alterSafe("ALTER TABLE delivery_progress_items ADD COLUMN line_type VARCHAR(20) NOT NULL DEFAULT 'material' AFTER progress_id")
      await alterSafe('ALTER TABLE delivery_progress_items ADD COLUMN customer_order_id INT NULL AFTER line_type')
      await alterSafe('ALTER TABLE delivery_progress_items ADD COLUMN order_item_id INT NULL AFTER customer_order_id')
      await alterSafe("ALTER TABLE delivery_progress_items ADD COLUMN customer_po_number VARCHAR(255) DEFAULT '' AFTER order_po_number")
      await alterSafe('ALTER TABLE delivery_progress_items ADD COLUMN bom_id INT NULL AFTER customer_po_number')
      await alterSafe("ALTER TABLE delivery_progress_items ADD COLUMN bom_code VARCHAR(255) DEFAULT '' AFTER bom_id")
      await alterSafe("ALTER TABLE delivery_progress_items ADD COLUMN bom_name VARCHAR(255) DEFAULT '' AFTER bom_code")
      await alterSafe('ALTER TABLE delivery_progress_items ADD COLUMN material_id INT NULL AFTER order_po_number')
      await addIndexSafe('CREATE INDEX idx_delivery_progress_items_line_type ON delivery_progress_items (line_type)')
      await addIndexSafe('CREATE INDEX idx_delivery_progress_items_order_item_id ON delivery_progress_items (order_item_id)')
      await addIndexSafe('CREATE INDEX idx_delivery_progress_items_bom_id ON delivery_progress_items (bom_id)')
      await addIndexSafe('CREATE INDEX idx_delivery_progress_items_material_id ON delivery_progress_items (material_id)')
      await addIndexSafe('CREATE INDEX idx_delivery_progress_item_materials_progress ON delivery_progress_item_materials (progress_id)')
      await addIndexSafe('CREATE INDEX idx_delivery_progress_item_materials_item ON delivery_progress_item_materials (progress_item_id)')
      await addIndexSafe('CREATE INDEX idx_delivery_progress_item_materials_material_id ON delivery_progress_item_materials (material_id)')
      await execute(`
        INSERT INTO delivery_progress_items (progress_id, order_po_number, material_id, material_code, material_name, spec, unit, planned_qty, due_date, status, remark, created_at)
        SELECT
          dp.id,
          COALESCE(dp.order_po_number, ''),
          NULL,
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
      await execute(`
        UPDATE delivery_progress_items dpi
        JOIN materials m ON m.material_code = dpi.material_code AND m.deleted_at IS NULL
        SET dpi.material_id = m.id
        WHERE dpi.material_id IS NULL
          AND COALESCE(dpi.material_code, '') <> ''
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
      await alterSafe('ALTER TABLE bom ADD COLUMN material_id INT NULL AFTER product_name')
      await alterSafe('ALTER TABLE bom ADD INDEX idx_bom_material_id (material_id)')
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
        UPDATE bom b
        JOIN materials m ON m.material_code = b.product_sku AND m.deleted_at IS NULL
        SET b.material_id = m.id
        WHERE b.material_id IS NULL AND COALESCE(b.product_sku, '') <> ''
      `)
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

let ensureQuotationItemMoqColumnPromise: Promise<void> | null = null
const ensureQuotationItemMoqColumn = async () => {
  if (!ensureQuotationItemMoqColumnPromise) {
    ensureQuotationItemMoqColumnPromise = (async () => {
      try {
        await execute('ALTER TABLE quotation_items MODIFY COLUMN moq TEXT NULL')
      } catch (e: any) {
        const msg = String(e?.message || '').toLowerCase()
        if (
          msg.includes("doesn't exist") ||
          msg.includes('unknown table') ||
          msg.includes('check that column/key exists')
        ) return
        throw e
      }
    })().catch((e) => {
      ensureQuotationItemMoqColumnPromise = null
      throw e
    })
  }
  await ensureQuotationItemMoqColumnPromise
}

const resolveMaterialId = async (materialIdRaw: any, materialCodeRaw: any, db?: DbExecutor): Promise<number | null> => {
  const materialId = Number(materialIdRaw || 0)
  if (Number.isFinite(materialId) && materialId > 0) return materialId
  const materialCode = String(materialCodeRaw || '').trim()
  if (!materialCode) return null
  const row = await queryOne<any>('SELECT id FROM materials WHERE material_code=? AND deleted_at IS NULL LIMIT 1', [materialCode], db)
  const resolved = Number(row?.id || 0)
  return Number.isFinite(resolved) && resolved > 0 ? resolved : null
}

const resolveMaterialSnapshot = async (materialIdRaw: any, materialCodeRaw: any) => {
  const resolvedId = await resolveMaterialId(materialIdRaw, materialCodeRaw)
  const material = resolvedId
    ? await queryOne<any>('SELECT * FROM materials WHERE id=? AND deleted_at IS NULL LIMIT 1', [resolvedId])
    : null
  return { resolvedId, material }
}

const liveFirst = (...exprs: string[]) => `COALESCE(${exprs.join(', ')})`

const isMissingSchemaError = (error: any) => {
  const msg = String(error?.message || '').toLowerCase()
  return (
    msg.includes("doesn't exist") ||
    msg.includes('unknown table') ||
    msg.includes('unknown column')
  )
}

const getActiveReferenceCount = async (sql: string, params: any[]) => {
  try {
    const row = await queryOne<any>(sql, params)
    return Number(row?.cnt || 0)
  } catch (e: any) {
    if (isMissingSchemaError(e)) return 0
    throw e
  }
}

const getActiveReferenceDetails = async (sql: string, params: any[]): Promise<string[]> => {
  try {
    const rows = await query<any>(sql, params)
    return rows
      .map((row: any) => String(row?.reference || '').trim())
      .filter(Boolean)
      .slice(0, 3)
  } catch (e: any) {
    if (isMissingSchemaError(e)) return []
    throw e
  }
}

const blockIfReferenced = async (
  id: any,
  checks: Array<{ sql: string; label: string }>,
): Promise<string | null> => {
  const hits: string[] = []
  for (const check of checks) {
    const count = await getActiveReferenceCount(check.sql, [id])
    if (count > 0) hits.push(`${check.label} ${count} 筆`)
  }
  if (!hits.length) return null
  return `無法刪除：此資料目前仍被其他業務單據或主檔引用。使用情況：${hits.join('、')}。請先解除關聯、刪除相關單據，或改用停用 / 封存後再操作。`
}

type MaterialReferenceCheck = {
  label: string
  sql: string
  detailSql: string
  params: (id: any, materialCode: string) => any[]
}

const materialReferenceChecks: MaterialReferenceCheck[] = [
  {
    label: 'BOM 用料',
    sql: 'SELECT COUNT(*) as cnt FROM bom_items bi JOIN bom b ON b.id = bi.bom_id WHERE (bi.material_id=? OR bi.material_code=?) AND bi.deleted_at IS NULL AND b.deleted_at IS NULL',
    detailSql: `SELECT DISTINCT CONCAT('BOM ', COALESCE(NULLIF(b.product_sku, ''), CONCAT('#', b.id))) AS reference
      FROM bom_items bi JOIN bom b ON b.id = bi.bom_id
      WHERE (bi.material_id=? OR bi.material_code=?) AND bi.deleted_at IS NULL AND b.deleted_at IS NULL
      ORDER BY reference LIMIT 3`,
    params: (id, code) => [id, code],
  },
  {
    label: 'BOM 主檔',
    sql: 'SELECT COUNT(*) as cnt FROM bom b WHERE (b.material_id=? OR b.product_sku=?) AND b.deleted_at IS NULL',
    detailSql: `SELECT DISTINCT CONCAT('BOM ', COALESCE(NULLIF(b.product_sku, ''), CONCAT('#', b.id))) AS reference
      FROM bom b
      WHERE (b.material_id=? OR b.product_sku=?) AND b.deleted_at IS NULL
      ORDER BY reference LIMIT 3`,
    params: (id, code) => [id, code],
  },
  {
    label: '採購單',
    sql: 'SELECT COUNT(*) as cnt FROM po_items pi JOIN purchase_orders po ON po.id = pi.po_id WHERE (pi.material_id=? OR pi.material_code=?) AND pi.deleted_at IS NULL AND po.deleted_at IS NULL',
    detailSql: `SELECT DISTINCT CONCAT('採購單 ', COALESCE(NULLIF(po.po_number, ''), CONCAT('#', po.id))) AS reference
      FROM po_items pi JOIN purchase_orders po ON po.id = pi.po_id
      WHERE (pi.material_id=? OR pi.material_code=?) AND pi.deleted_at IS NULL AND po.deleted_at IS NULL
      ORDER BY reference LIMIT 3`,
    params: (id, code) => [id, code],
  },
  {
    label: '報價單',
    sql: 'SELECT COUNT(*) as cnt FROM quotation_items qi JOIN quotations q ON q.id = qi.quotation_id WHERE (qi.material_id=? OR qi.material_code=?) AND qi.deleted_at IS NULL AND q.deleted_at IS NULL',
    detailSql: `SELECT DISTINCT CONCAT('報價單 ', COALESCE(NULLIF(q.quotation_number, ''), CONCAT('#', q.id))) AS reference
      FROM quotation_items qi JOIN quotations q ON q.id = qi.quotation_id
      WHERE (qi.material_id=? OR qi.material_code=?) AND qi.deleted_at IS NULL AND q.deleted_at IS NULL
      ORDER BY reference LIMIT 3`,
    params: (id, code) => [id, code],
  },
  {
    label: '出貨單',
    sql: 'SELECT COUNT(*) as cnt FROM delivery_note_items dni JOIN delivery_notes dn ON dn.id = dni.dn_id WHERE (dni.material_id=? OR dni.material_code=?) AND dni.deleted_at IS NULL AND dn.deleted_at IS NULL',
    detailSql: `SELECT DISTINCT CONCAT('出貨單 ', COALESCE(NULLIF(dn.dn_number, ''), CONCAT('#', dn.id))) AS reference
      FROM delivery_note_items dni JOIN delivery_notes dn ON dn.id = dni.dn_id
      WHERE (dni.material_id=? OR dni.material_code=?) AND dni.deleted_at IS NULL AND dn.deleted_at IS NULL
      ORDER BY reference LIMIT 3`,
    params: (id, code) => [id, code],
  },
  {
    label: '送貨單',
    sql: 'SELECT COUNT(*) as cnt FROM delivery_sheet_items dsi JOIN delivery_sheets ds ON ds.id = dsi.ds_id WHERE (dsi.material_id=? OR dsi.material_code=?) AND dsi.deleted_at IS NULL AND ds.deleted_at IS NULL',
    detailSql: `SELECT DISTINCT CONCAT('送貨單 ', COALESCE(NULLIF(ds.ds_number, ''), CONCAT('#', ds.id))) AS reference
      FROM delivery_sheet_items dsi JOIN delivery_sheets ds ON ds.id = dsi.ds_id
      WHERE (dsi.material_id=? OR dsi.material_code=?) AND dsi.deleted_at IS NULL AND ds.deleted_at IS NULL
      ORDER BY reference LIMIT 3`,
    params: (id, code) => [id, code],
  },
  {
    label: '進貨單',
    sql: 'SELECT COUNT(*) as cnt FROM goods_receipt_items gri JOIN goods_receipts gr ON gr.id = gri.gr_id WHERE (gri.material_id=? OR gri.material_code=?) AND gri.deleted_at IS NULL AND gr.deleted_at IS NULL',
    detailSql: `SELECT DISTINCT CONCAT('進貨單 ', COALESCE(NULLIF(gr.gr_number, ''), CONCAT('#', gr.id))) AS reference
      FROM goods_receipt_items gri JOIN goods_receipts gr ON gr.id = gri.gr_id
      WHERE (gri.material_id=? OR gri.material_code=?) AND gri.deleted_at IS NULL AND gr.deleted_at IS NULL
      ORDER BY reference LIMIT 3`,
    params: (id, code) => [id, code],
  },
  {
    label: '生產領料',
    sql: 'SELECT COUNT(*) as cnt FROM production_materials pm JOIN production_orders po ON po.id = pm.prod_id WHERE (pm.material_id=? OR pm.material_code=?) AND pm.deleted_at IS NULL AND po.deleted_at IS NULL',
    detailSql: `SELECT DISTINCT CONCAT('生產單 ', COALESCE(NULLIF(po.prod_number, ''), CONCAT('#', po.id))) AS reference
      FROM production_materials pm JOIN production_orders po ON po.id = pm.prod_id
      WHERE (pm.material_id=? OR pm.material_code=?) AND pm.deleted_at IS NULL AND po.deleted_at IS NULL
      ORDER BY reference LIMIT 3`,
    params: (id, code) => [id, code],
  },
  {
    label: '庫存調整',
    sql: 'SELECT COUNT(*) as cnt FROM stock_adjustment_items sai JOIN stock_adjustments sa ON sa.id = sai.adj_id WHERE (sai.material_id=? OR sai.material_code=?) AND sai.deleted_at IS NULL AND sa.deleted_at IS NULL',
    detailSql: `SELECT DISTINCT CONCAT('庫存調整 ', COALESCE(NULLIF(sa.adj_number, ''), CONCAT('#', sa.id))) AS reference
      FROM stock_adjustment_items sai JOIN stock_adjustments sa ON sa.id = sai.adj_id
      WHERE (sai.material_id=? OR sai.material_code=?) AND sai.deleted_at IS NULL AND sa.deleted_at IS NULL
      ORDER BY reference LIMIT 3`,
    params: (id, code) => [id, code],
  },
  {
    label: '交期進度',
    sql: 'SELECT COUNT(*) as cnt FROM delivery_progress dp WHERE dp.material_code=? AND dp.deleted_at IS NULL',
    detailSql: `SELECT DISTINCT CONCAT('交期進度 ', COALESCE(NULLIF(dp.progress_no, ''), CONCAT('#', dp.id))) AS reference
      FROM delivery_progress dp
      WHERE dp.material_code=? AND dp.deleted_at IS NULL
      ORDER BY reference LIMIT 3`,
    params: (_id, code) => [code],
  },
  {
    label: '交期進度明細',
    sql: 'SELECT COUNT(*) as cnt FROM delivery_progress_items dpi JOIN delivery_progress dp ON dp.id = dpi.progress_id WHERE (dpi.material_id=? OR dpi.material_code=?) AND dpi.deleted_at IS NULL AND dp.deleted_at IS NULL',
    detailSql: `SELECT DISTINCT CONCAT('交期進度 ', COALESCE(NULLIF(dp.progress_no, ''), CONCAT('#', dp.id))) AS reference
      FROM delivery_progress_items dpi JOIN delivery_progress dp ON dp.id = dpi.progress_id
      WHERE (dpi.material_id=? OR dpi.material_code=?) AND dpi.deleted_at IS NULL AND dp.deleted_at IS NULL
      ORDER BY reference LIMIT 3`,
    params: (id, code) => [id, code],
  },
  {
    label: '交期進度用料',
    sql: 'SELECT COUNT(*) as cnt FROM delivery_progress_item_materials dpim JOIN delivery_progress_items dpi ON dpi.id = dpim.progress_item_id AND dpi.deleted_at IS NULL JOIN delivery_progress dp ON dp.id = dpim.progress_id WHERE (dpim.material_id=? OR dpim.material_code=?) AND dpim.deleted_at IS NULL AND dp.deleted_at IS NULL',
    detailSql: `SELECT DISTINCT CONCAT('交期進度 ', COALESCE(NULLIF(dp.progress_no, ''), CONCAT('#', dp.id))) AS reference
      FROM delivery_progress_item_materials dpim
      JOIN delivery_progress_items dpi ON dpi.id = dpim.progress_item_id AND dpi.deleted_at IS NULL
      JOIN delivery_progress dp ON dp.id = dpim.progress_id
      WHERE (dpim.material_id=? OR dpim.material_code=?) AND dpim.deleted_at IS NULL AND dp.deleted_at IS NULL
      ORDER BY reference LIMIT 3`,
    params: (id, code) => [id, code],
  },
  {
    label: '庫存流水',
    sql: 'SELECT COUNT(*) as cnt FROM stock_ledger WHERE material_code=?',
    detailSql: "SELECT DISTINCT CONCAT('庫存流水 #', id) AS reference FROM stock_ledger WHERE material_code=? ORDER BY id DESC LIMIT 3",
    params: (_id, code) => [code],
  },
  {
    label: '出貨對帳',
    sql: 'SELECT COUNT(*) as cnt FROM shipment_reconciliation_items WHERE material_code=?',
    detailSql: `SELECT DISTINCT CONCAT('出貨對帳 ', COALESCE(NULLIF(sr.reconciliation_no, ''), CONCAT('#', sr.id))) AS reference
      FROM shipment_reconciliation_items sri JOIN shipment_reconciliations sr ON sr.id = sri.reconciliation_id
      WHERE sri.material_code=?
      ORDER BY reference LIMIT 3`,
    params: (_id, code) => [code],
  },
  {
    label: '發票',
    sql: 'SELECT COUNT(*) as cnt FROM invoice_items WHERE material_code=?',
    detailSql: `SELECT DISTINCT CONCAT('發票 ', COALESCE(NULLIF(ih.invoice_no, ''), CONCAT('#', ih.id))) AS reference
      FROM invoice_items ii JOIN invoice_headers ih ON ih.id = ii.invoice_id
      WHERE ii.material_code=?
      ORDER BY reference LIMIT 3`,
    params: (_id, code) => [code],
  },
]

const findMaterialReferenceUsage = async (id: any, materialCode: string): Promise<string | null> => {
  const hits: string[] = []
  for (const check of materialReferenceChecks) {
    const params = check.params(id, materialCode)
    const count = await getActiveReferenceCount(check.sql, params)
    if (count <= 0) continue
    const details = await getActiveReferenceDetails(check.detailSql, params)
    if (!details.length) {
      hits.push(`${check.label}（共 ${count} 筆）`)
      continue
    }
    const suffix = count > details.length ? ` 等，共 ${count} 筆` : ''
    hits.push(`${check.label}（${details.join('、')}${suffix}）`)
  }
  return hits.length ? hits.join('、') : null
}

const executeIfSchemaAvailable = async (sql: string, params: any[], db?: DbExecutor) => {
  try {
    return await execute(sql, params, db)
  } catch (e: any) {
    if (isMissingSchemaError(e)) return { insertId: 0, affectedRows: 0 }
    throw e
  }
}

/**
 * Material IDs are the durable relation key, but several current business
 * tables also keep a material_code snapshot for display and search. When a
 * code changes, keep those active records in sync while leaving historical
 * accounting/stock snapshots untouched.
 */
const syncActiveMaterialCodeReferences = async (
  db: DbExecutor,
  materialId: any,
  previousCode: string,
  nextCode: string,
) => {
  const statements: Array<{ sql: string; params: any[] }> = [
    {
      sql: `UPDATE bom
        SET material_id=?, product_sku=?
        WHERE deleted_at IS NULL
          AND (material_id=? OR (COALESCE(material_id, 0)=0 AND product_sku=?))`,
      params: [materialId, nextCode, materialId, previousCode],
    },
    {
      sql: `UPDATE bom_items
        SET material_id=?, material_code=?
        WHERE deleted_at IS NULL
          AND (material_id=? OR (COALESCE(material_id, 0)=0 AND material_code=?))`,
      params: [materialId, nextCode, materialId, previousCode],
    },
    {
      sql: `UPDATE customer_order_items
        SET material_code=?
        WHERE deleted_at IS NULL AND material_code=?`,
      params: [nextCode, previousCode],
    },
    {
      sql: `UPDATE po_items
        SET material_id=?, material_code=?
        WHERE deleted_at IS NULL
          AND (material_id=? OR (COALESCE(material_id, 0)=0 AND material_code=?))`,
      params: [materialId, nextCode, materialId, previousCode],
    },
    {
      sql: `UPDATE quotation_items
        SET material_id=?, material_code=?
        WHERE deleted_at IS NULL
          AND (material_id=? OR (COALESCE(material_id, 0)=0 AND material_code=?))`,
      params: [materialId, nextCode, materialId, previousCode],
    },
    {
      sql: `UPDATE delivery_note_items
        SET material_id=?, material_code=?
        WHERE deleted_at IS NULL
          AND (material_id=? OR (COALESCE(material_id, 0)=0 AND material_code=?))`,
      params: [materialId, nextCode, materialId, previousCode],
    },
    {
      sql: `UPDATE delivery_sheet_items
        SET material_id=?, material_code=?
        WHERE deleted_at IS NULL
          AND (material_id=? OR (COALESCE(material_id, 0)=0 AND material_code=?))`,
      params: [materialId, nextCode, materialId, previousCode],
    },
    {
      sql: `UPDATE goods_receipt_items
        SET material_id=?, material_code=?
        WHERE deleted_at IS NULL
          AND (material_id=? OR (COALESCE(material_id, 0)=0 AND material_code=?))`,
      params: [materialId, nextCode, materialId, previousCode],
    },
    {
      sql: `UPDATE production_materials
        SET material_id=?, material_code=?
        WHERE deleted_at IS NULL
          AND (material_id=? OR (COALESCE(material_id, 0)=0 AND material_code=?))`,
      params: [materialId, nextCode, materialId, previousCode],
    },
    {
      sql: `UPDATE stock_adjustment_items
        SET material_id=?, material_code=?
        WHERE deleted_at IS NULL
          AND (material_id=? OR (COALESCE(material_id, 0)=0 AND material_code=?))`,
      params: [materialId, nextCode, materialId, previousCode],
    },
    {
      sql: `UPDATE delivery_progress
        SET material_code=?
        WHERE deleted_at IS NULL AND material_code=?`,
      params: [nextCode, previousCode],
    },
    {
      sql: `UPDATE delivery_progress_items
        SET material_id=?, material_code=?
        WHERE deleted_at IS NULL
          AND (material_id=? OR (COALESCE(material_id, 0)=0 AND material_code=?))`,
      params: [materialId, nextCode, materialId, previousCode],
    },
    {
      sql: `UPDATE delivery_progress_items
        SET bom_code=?
        WHERE deleted_at IS NULL AND bom_id=?`,
      params: [nextCode, materialId],
    },
    {
      sql: `UPDATE delivery_progress_item_materials
        SET material_id=?, material_code=?
        WHERE deleted_at IS NULL
          AND (material_id=? OR (COALESCE(material_id, 0)=0 AND material_code=?))`,
      params: [materialId, nextCode, materialId, previousCode],
    },
  ]

  for (const statement of statements) {
    await executeIfSchemaAvailable(statement.sql, statement.params, db)
  }
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
          po_number VARCHAR(255),
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
  'bom_items',
  'purchase_orders',
  'po_items',
  'customer_orders',
  'customer_order_items',
  'quotations',
  'quotation_items',
  'delivery_notes',
  'delivery_note_items',
  'delivery_sheets',
  'delivery_sheet_items',
  'inventory',
  'users',
  'goods_receipts',
  'goods_receipt_items',
  'production_orders',
  'production_materials',
  'stock_adjustments',
  'stock_adjustment_items',
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

const softDeleteById = async (table: string, id: any, userId: any, db?: DbExecutor) => {
  await execute(`UPDATE ${table} SET deleted_at=?, deleted_by=? WHERE id=? AND deleted_at IS NULL`, [now8(), userId || null, id], db)
}

const softDeleteByWhere = async (table: string, whereSql: string, params: any[], userId?: number | null, db?: DbExecutor) => {
  await execute(
    `UPDATE ${table} SET deleted_at=?, deleted_by=? WHERE ${whereSql} AND deleted_at IS NULL`,
    [now8(), userId || null, ...params],
    db,
  )
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

const businessErrorStatus = (message: string): 400 | 500 => {
  const msg = String(message || '').trim()
  if (!msg) return 500
  if (/sql|mysql|database|er_|syntax|econn|timeout|deadlock/i.test(msg)) return 500
  return 400
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

const normalizeProgressItemLineType = (value: any): 'material' | 'bom' =>
  String(value || '').trim().toLowerCase() === 'bom' ? 'bom' : 'material'

type ProgressBomContextMaterial = {
  bom_item_id: number | null
  material_id: number | null
  material_code: string
  material_name: string
  spec: string
  unit: string
  bom_unit_qty: number
  supplier_id: number | null
  supplier_name: string
  due_date: string | null
}

type ProgressBomContext = {
  customer_order_id: number
  order_item_id: number
  order_qty: number
  order_po_number: string
  customer_po_number: string
  due_date: string | null
  bom_id: number
  bom_code: string
  bom_name: string
  materials: ProgressBomContextMaterial[]
}

const loadProgressBomContexts = async (orderItemIds: number[], db?: DbExecutor) => {
  const ids = uniqueNumberList(orderItemIds)
  const out = new Map<number, ProgressBomContext>()
  if (!ids.length) return out
  const rows = await query<any>(`
    SELECT
      ci.order_id as customer_order_id,
      ci.id as order_item_id,
      ci.qty as order_qty,
      co.po_number as order_po_number,
      ci.po_no as customer_po_number,
      ci.rta_date,
      b.id as bom_id,
      TRIM(COALESCE(b.product_sku, '')) as bom_code,
      TRIM(COALESCE(b.product_name, '')) as bom_name,
      COALESCE(bi.id, 0) as bom_item_id,
      COALESCE(bi.material_id, 0) as material_id,
      TRIM(COALESCE(bi.material_code, '')) as material_code,
      TRIM(COALESCE(NULLIF(m.material_name, ''), bi.material_name, '')) as material_name,
      TRIM(COALESCE(NULLIF(m.spec, ''), bi.spec, '')) as spec,
      TRIM(COALESCE(NULLIF(m.unit, ''), NULLIF(bi.unit, ''), 'PCS')) as unit,
      COALESCE(bi.quantity, 0) as bom_unit_qty,
      m.supplier_id,
      COALESCE(s.name, m.supplier_name, '') as supplier_name
    FROM customer_order_items ci
    JOIN customer_orders co ON co.id = ci.order_id AND co.deleted_at IS NULL
    JOIN bom b ON b.id = ci.bom_id AND b.deleted_at IS NULL
    JOIN bom_items bi ON bi.bom_id = b.id AND bi.deleted_at IS NULL
    LEFT JOIN materials m
      ON bi.material_id IS NOT NULL
      AND bi.material_id > 0
      AND bi.material_id = m.id
      AND m.deleted_at IS NULL
    LEFT JOIN suppliers s ON s.id = m.supplier_id AND s.deleted_at IS NULL
    WHERE ci.id IN (${ids.map(() => '?').join(',')})
      AND ci.deleted_at IS NULL
    ORDER BY ci.id ASC, bi.id ASC
  `, ids, db)
  for (const row of rows) {
    const orderItemId = Number(row.order_item_id || 0)
    if (!out.has(orderItemId)) {
      out.set(orderItemId, {
        customer_order_id: Number(row.customer_order_id || 0),
        order_item_id: orderItemId,
        order_qty: 0,
        order_po_number: String(row.order_po_number || '').trim(),
        customer_po_number: String(row.customer_po_number || '').trim(),
        due_date: row.rta_date ? toDateStr(row.rta_date) : null,
        bom_id: Number(row.bom_id || 0),
        bom_code: String(row.bom_code || '').trim(),
        bom_name: String(row.bom_name || '').trim(),
        materials: [],
      })
    }
    out.get(orderItemId)!.order_qty = toQty(row.order_qty || out.get(orderItemId)!.order_qty || 0)
    out.get(orderItemId)?.materials.push({
      bom_item_id: Number(row.bom_item_id || 0) || null,
      material_id: Number(row.material_id || 0) || null,
      material_code: String(row.material_code || '').trim(),
      material_name: String(row.material_name || '').trim(),
      spec: String(row.spec || '').trim(),
      unit: String(row.unit || 'PCS').trim() || 'PCS',
      bom_unit_qty: toQty(row.bom_unit_qty),
      supplier_id: Number(row.supplier_id || 0) || null,
      supplier_name: String(row.supplier_name || '').trim(),
      due_date: row.rta_date ? toDateStr(row.rta_date) : null,
    })
  }
  return out
}

const loadProgressItemMaterialSnapshots = async (progressItemIds: number[], db?: DbExecutor) => {
  const ids = uniqueNumberList(progressItemIds)
  const out = new Map<number, any[]>()
  if (!ids.length) return out
  const rows = await query<any>(
    `SELECT *
     FROM delivery_progress_item_materials
     WHERE deleted_at IS NULL
       AND progress_item_id IN (${ids.map(() => '?').join(',')})
     ORDER BY id ASC`,
    ids,
    db,
  )
  for (const row of rows) {
    const itemId = Number(row.progress_item_id || 0)
    if (!out.has(itemId)) out.set(itemId, [])
    out.get(itemId)?.push(row)
  }
  return out
}

// ── Daily Patrol (ERP 每日巡檢) ────────────────────────────────────────────────
type PatrolIssue = {
  type: string
  ref: string
  reason: string
  impact: string
  suggestion: string
}

type PatrolReview = {
  type: string
  ref: string
  reason: string
  suggestion: string
}

type PatrolStuck = {
  flow: string
  ref: string
  status: string
  cause: string
  next: string
}

type PatrolConsistency = {
  item: string
  ok: boolean
  detail: string
  suggestion: string
}

type PatrolSummary = {
  generated_at: string
  date: string
  time: string
  severe: PatrolIssue[]
  need_review: PatrolReview[]
  stuck: PatrolStuck[]
  consistency: PatrolConsistency[]
  normals: string[]
  priorities: PatrolIssue[]
}

const buildDailyPatrolReport = async (): Promise<PatrolSummary> => {
  const now = new Date()
  const date = toDateStr(now)
  const time = now8()

  const severe: PatrolIssue[] = []
  const needReview: PatrolReview[] = []
  const stuck: PatrolStuck[] = []
  const consistency: PatrolConsistency[] = []

  // 1) 訂單與出貨數量一致性（使用現有出貨回寫邏輯）
  const shippedMap = await buildShippedQtyByOrderItemId()
  const orderItemIds = Array.from(shippedMap.keys())
  if (orderItemIds.length) {
    const rows = await query<any>(
      `SELECT ci.id, ci.order_id, co.po_number, ci.qty, ci.arrived_qty, ci.status
       FROM customer_order_items ci
       JOIN customer_orders co ON co.id = ci.order_id AND co.deleted_at IS NULL
       WHERE ci.id IN (${orderItemIds.map(() => '?').join(',')})
         AND ci.deleted_at IS NULL`,
      orderItemIds,
    )
    for (const row of rows) {
      const totalQty = toQty(row.qty)
      const arrived = toQty(row.arrived_qty)
      const shipped = toQty(shippedMap.get(row.id) || 0)
      if (Math.abs(arrived - shipped) > 0.0001) {
        severe.push({
          type: '訂單與出貨數量不一致',
          ref: `訂單 ${row.order_id} / 客戶 PO ${row.po_number} / 明細 ${row.id}`,
          reason: `出貨累計數量 ${shipped} 與訂單到貨數量 ${arrived} 不一致`,
          impact: '可能導致訂單完成狀態錯誤，影響後續對帳與出貨判斷',
          suggestion: '請核對出貨單與訂單明細數量，如為歷史資料問題可由管理者人工調整 arrived_qty',
        })
      }
      if (shipped > totalQty + 0.0001) {
        severe.push({
          type: '出貨數量超過訂單數量',
          ref: `訂單 ${row.order_id} / 客戶 PO ${row.po_number} / 明細 ${row.id}`,
          reason: `訂單數量 ${totalQty}，出貨累計 ${shipped}`,
          impact: '可能出現超量出貨或重複出貨的情況，導致客戶與庫存不一致',
          suggestion: '請檢查關聯出貨單，確認是否有重複出貨或錯誤數量，必要時作退貨或更正',
        })
      }
    }
  }

  // 2) 交期進度與訂單剩餘可建立數量
  const progressOverRows = await query<any>(
    `SELECT
       ci.id as order_item_id,
       ci.order_id,
       co.po_number,
       ci.qty as order_qty,
       COALESCE(SUM(CASE WHEN dpi.deleted_at IS NULL THEN dpi.planned_qty ELSE 0 END), 0) as planned_qty
     FROM customer_order_items ci
     JOIN customer_orders co ON co.id = ci.order_id AND co.deleted_at IS NULL
     LEFT JOIN delivery_progress_items dpi
       ON dpi.order_item_id = ci.id AND dpi.deleted_at IS NULL
     WHERE ci.deleted_at IS NULL
     GROUP BY ci.id, ci.order_id, co.po_number, ci.qty
     HAVING planned_qty - order_qty > 0.0001
     LIMIT 20`,
    [],
  )
  for (const row of progressOverRows) {
    severe.push({
      type: '交期進度超過訂單數量',
      ref: `訂單 ${row.order_id} / 客戶 PO ${row.po_number} / 明細 ${row.order_item_id}`,
      reason: `訂單數量 ${toQty(row.order_qty)}，交期進度累計 ${toQty(row.planned_qty)}`,
      impact: '可能導致後續採購與出貨超量，影響成本與庫存',
      suggestion: '請檢查交期進度設定，調整多餘的進度或確認是否為特殊分批需求',
    })
  }

  // 3) BOM / 料號資料完整性
  const missingBomItems = await queryOne<any>(
    `SELECT COUNT(*) as cnt
     FROM bom b
     LEFT JOIN bom_items bi ON bi.bom_id = b.id AND bi.deleted_at IS NULL
     WHERE b.deleted_at IS NULL
     GROUP BY b.id
     HAVING cnt = 0
     LIMIT 1`,
  ).catch(() => null as any)
  if (missingBomItems?.cnt > 0) {
    severe.push({
      type: 'BOM 無任何材料',
      ref: '部分 BOM',
      reason: '存在至少 1 筆 BOM 沒有任何 bom_items 記錄',
      impact: '無法正確展開材料需求，影響採購與缺料計算',
      suggestion: '請檢查 BOM 設定，補齊對應商品的材料明細',
    })
  }

  const bomQtyAnomalies = await queryOne<any>(
    `SELECT COUNT(*) as cnt
     FROM bom_items
     WHERE deleted_at IS NULL
       AND (quantity IS NULL OR quantity <= 0)`,
  ).catch(() => null as any)
  if (bomQtyAnomalies?.cnt > 0) {
    severe.push({
      type: 'BOM 材料數量為 0 或空值',
      ref: '部分 BOM 材料',
      reason: `至少 ${bomQtyAnomalies.cnt} 筆 BOM 材料數量異常`,
      impact: '導致材料需求低估或無法正確生成採購與發料數量',
      suggestion: '請過濾 BOM 材料清單，修正數量為正確值',
    })
  }

  // 4) 庫存資料（負庫存與流水對帳）
  const negativeStock = await queryOne<any>(
    `SELECT COUNT(*) as cnt
     FROM bom
     WHERE deleted_at IS NULL
       AND COALESCE(current_stock, 0) < 0`,
  ).catch(() => null as any)
  if (negativeStock?.cnt > 0) {
    severe.push({
      type: '庫存為負數',
      ref: '部分 BOM.current_stock',
      reason: `至少 ${negativeStock.cnt} 筆 BOM 現有庫存為負數`,
      impact: '顯示系統庫存與實際狀態不一致，可能影響缺料判斷與出貨可行性',
      suggestion: '請比對庫存調整、進貨與領料紀錄，修正異常庫存',
    })
  }

  // 5) 採購 / 缺料：依進度材料需求與採購數量推估
  const shortageRows = await query<any>(
    `SELECT
       pb.material_code,
       pb.material_name,
       SUM(pb.required_qty) as required_qty,
       SUM(pb.purchased_qty) as purchased_qty
     FROM (
       SELECT
         m.material_code,
         m.material_name,
         COALESCE(pm.planned_qty, 0) as required_qty,
         0 as purchased_qty
       FROM production_materials pm
       JOIN materials m ON m.material_code = pm.material_code
       WHERE pm.deleted_at IS NULL
     ) pb
     GROUP BY pb.material_code, pb.material_name
     HAVING SUM(pb.required_qty) - SUM(pb.purchased_qty) > 0.0001
     LIMIT 20`,
    [],
  ).catch(() => [] as any[])
  for (const row of shortageRows) {
    needReview.push({
      type: '可能缺料（依生產領料需求推估）',
      ref: `料號 ${row.material_code}`,
      reason: `推估需求量 ${toQty(row.required_qty)}，已採購量 ${toQty(row.purchased_qty)}`,
      suggestion: '請在缺料 / 採購頁面確認是否需補採，並核對實際庫存與 BOM 設定',
    })
  }

  // 6) 流程卡住篩選（僅做輕量版，避免一次回傳過多）
  const staleOrders = await query<any>(
    `SELECT id, po_number, created_at
     FROM customer_orders
     WHERE status='pending'
       AND deleted_at IS NULL
       AND created_at < DATE_SUB(NOW(), INTERVAL 14 DAY)
     ORDER BY created_at ASC
     LIMIT 5`,
    [],
  )
  for (const row of staleOrders) {
    stuck.push({
      flow: '客戶訂單',
      ref: `訂單 ${row.id} / 客戶 PO ${row.po_number}`,
      status: 'pending',
      cause: '訂單建立已超過 14 天，仍未建立交期進度或後續作業',
      next: '請與業務或客戶確認此訂單是否仍需生產 / 出貨，必要時更新狀態或取消',
    })
  }

  const staleProgress = await query<any>(
    `SELECT id, progress_no, customer_order_id, due_date, status
     FROM delivery_progress
     WHERE status IN ('pending','partial')
       AND deleted_at IS NULL
       AND due_date IS NOT NULL
       AND due_date < DATE_SUB(CURDATE(), INTERVAL 3 DAY)
     ORDER BY due_date ASC
     LIMIT 5`,
    [],
  )
  for (const row of staleProgress) {
    stuck.push({
      flow: '交期進度',
      ref: `進度 ${row.progress_no} / 訂單 ${row.customer_order_id || '-'}`,
      status: row.status || 'pending',
      cause: '預計交期已超過 3 天，進度仍為未完成狀態',
      next: '請確認此批次是否已實際完成 / 出貨，或需更新交期與後續流程',
    })
  }

  // 7) 一致性檢查項目標記
  consistency.push({
    item: '訂單 vs 出貨數量',
    ok: !severe.some((s) => s.type === '訂單與出貨數量不一致' || s.type === '出貨數量超過訂單數量'),
    detail: severe.some((s) => s.type.startsWith('訂單與出貨') || s.type.startsWith('出貨數量超過'))
      ? '發現訂單與出貨累計數量不一致或超量的情況'
      : '訂單數量與出貨累計整體看起來合理',
    suggestion: '如為異常，請由出貨對帳或歷史資料調整功能修正數量',
  })

  consistency.push({
    item: 'BOM / 材料設定',
    ok: !(missingBomItems?.cnt > 0) && !(bomQtyAnomalies?.cnt > 0),
    detail:
      missingBomItems?.cnt > 0 || bomQtyAnomalies?.cnt > 0
        ? '部分 BOM 缺少材料或材料數量為 0 / 空值'
        : '目前 BOM 與材料設定未發現明顯異常',
    suggestion: '建議定期抽查主要產品的 BOM 結構，避免後續採購 / 生產流程出錯',
  })

  consistency.push({
    item: '庫存現有量',
    ok: !(negativeStock?.cnt > 0),
    detail:
      negativeStock?.cnt > 0
        ? `有 ${negativeStock.cnt} 筆 BOM.current_stock 為負數`
        : 'BOM.current_stock 未發現負數庫存',
    suggestion: '如有負庫存，請檢查調整單、進貨與領料紀錄並修正',
  })

  // 8) 今日正常項目與優先處理清單
  const normals: string[] = []
  if (!severe.length) {
    normals.push('訂單、生產進度、BOM、庫存、採購、出貨資料整體狀態：正常')
  } else {
    if (!negativeStock?.cnt) normals.push('庫存資料：未發現負庫存')
    if (!missingBomItems?.cnt && !bomQtyAnomalies?.cnt) normals.push('BOM / 料號資料：主要結構正常')
  }

  const priorities = severe.slice(0, 5)

  return {
    generated_at: time,
    date,
    time,
    // Telegram 訊息可能過長：只回傳前 N 筆重點
    severe: severe.slice(0, 5),
    need_review: needReview.slice(0, 10),
    stuck: stuck.slice(0, 10),
    consistency,
    normals,
    priorities,
  }
}

const loadPurchasedQtyByProgressItemIds = async (progressItemIds: number[], db?: DbExecutor) => {
  const ids = uniqueNumberList(progressItemIds)
  const out = new Map<number, number>()
  if (!ids.length) return out
  const rows = await query<any>(
    `SELECT
       pi.progress_item_id,
       COALESCE(SUM(pi.quantity), 0) as qty
     FROM po_items pi
     JOIN purchase_orders po ON po.id = pi.po_id
     WHERE po.deleted_at IS NULL
       AND pi.deleted_at IS NULL
       AND po.status <> 'cancelled'
       AND pi.progress_item_id IN (${ids.map(() => '?').join(',')})
     GROUP BY pi.progress_item_id`,
    ids,
    db,
  )
  for (const row of rows) out.set(Number(row.progress_item_id || 0), toQty(row.qty))
  return out
}

const loadPurchasedQtyByProgressItemMaterialIds = async (progressItemMaterialIds: number[], db?: DbExecutor) => {
  const ids = uniqueNumberList(progressItemMaterialIds)
  const out = new Map<number, number>()
  if (!ids.length) return out
  const rows = await query<any>(
    `SELECT
       pi.progress_item_material_id,
       COALESCE(SUM(pi.quantity), 0) as qty
     FROM po_items pi
     JOIN purchase_orders po ON po.id = pi.po_id
     WHERE po.deleted_at IS NULL
       AND pi.deleted_at IS NULL
       AND po.status <> 'cancelled'
       AND pi.progress_item_material_id IN (${ids.map(() => '?').join(',')})
     GROUP BY pi.progress_item_material_id`,
    ids,
    db,
  )
  for (const row of rows) out.set(Number(row.progress_item_material_id || 0), toQty(row.qty))
  return out
}

const loadAllocatedBomQtyByOrderItems = async (orderItemIds: number[], excludeProgressId?: number | null, db?: DbExecutor) => {
  const ids = uniqueNumberList(orderItemIds)
  const out = new Map<string, number>()
  if (!ids.length) return out
  const params: any[] = [...ids]
  const excludeSql = excludeProgressId ? ' AND dpi.progress_id<>?' : ''
  if (excludeProgressId) params.push(excludeProgressId)
  const rows = await query<any>(
    `SELECT
       dpi.order_item_id,
       dpi.bom_id,
       COALESCE(SUM(dpi.planned_qty), 0) as qty
     FROM delivery_progress_items dpi
     WHERE dpi.deleted_at IS NULL
       AND dpi.line_type='bom'
       AND dpi.order_item_id IN (${ids.map(() => '?').join(',')})
       ${excludeSql}
     GROUP BY dpi.order_item_id, dpi.bom_id`,
    params,
    db,
  )
  for (const row of rows) {
    const key = `${Number(row.order_item_id || 0)}::${Number(row.bom_id || 0)}`
    out.set(key, toQty(row.qty))
  }
  return out
}

const enrichDeliveryProgressItems = async (items: any[], db?: DbExecutor) => {
  const materialLineIds = uniqueNumberList(items.filter((item) => normalizeProgressItemLineType(item.line_type) !== 'bom').map((item) => item.id))
  const bomLineIds = uniqueNumberList(items.filter((item) => normalizeProgressItemLineType(item.line_type) === 'bom').map((item) => item.id))
  const purchasedByLineId = await loadPurchasedQtyByProgressItemIds(materialLineIds, db)
  const materialSnapshots = await loadProgressItemMaterialSnapshots(bomLineIds, db)
  const snapshotIds = uniqueNumberList(Array.from(materialSnapshots.values()).flat().map((row: any) => row.id))
  const purchasedBySnapshotId = await loadPurchasedQtyByProgressItemMaterialIds(snapshotIds, db)

  return items.map((item: any) => {
    const lineType = normalizeProgressItemLineType(item.line_type)
    const plannedQty = toQty(item.planned_qty)
    let purchasedQty = 0
    if (lineType === 'bom') {
      const snapshots = materialSnapshots.get(Number(item.id || 0)) || []
      const ratios = snapshots
        .map((snapshot: any) => {
          const bomUnitQty = toQty(snapshot.bom_unit_qty)
          if (bomUnitQty <= 0) return null
          return toQty((purchasedBySnapshotId.get(Number(snapshot.id || 0)) || 0) / bomUnitQty)
        })
        .filter((value: number | null): value is number => value != null)
      purchasedQty = ratios.length ? toQty(Math.min(...ratios)) : 0
    } else {
      purchasedQty = toQty(purchasedByLineId.get(Number(item.id || 0)) || 0)
    }
    return {
      ...item,
      line_type: lineType,
      order_po_number: String(item.order_po_number || '').trim(),
      customer_po_number: String(item.customer_po_number || '').trim(),
      bom_code: String(item.bom_code || '').trim(),
      bom_name: String(item.bom_name || '').trim(),
      material_code: String(item.material_code || '').trim(),
      material_name: String(item.material_name || '').trim(),
      spec: String(item.spec || '').trim(),
      unit: String(item.unit || 'PCS').trim() || 'PCS',
      planned_qty: plannedQty,
      purchased_qty: purchasedQty,
      purchase_gap_qty: toQty(Math.max(0, plannedQty - purchasedQty)),
      display_name: lineType === 'bom'
        ? (String(item.bom_name || item.material_name || '').trim() || String(item.bom_code || item.material_code || '').trim())
        : String(item.material_name || '').trim(),
      material_snapshots: materialSnapshots.get(Number(item.id || 0)) || [],
    }
  })
}

const syncDeliveryProgressPoLinks = async (
  progressId: number,
  customerOrderIds: number[],
  poNumbers: string[],
  userId: number | null,
  db?: DbExecutor,
) => {
  await execute('UPDATE delivery_progress_po_links SET deleted_at=?, deleted_by=? WHERE progress_id=? AND deleted_at IS NULL', [now8(), userId || null, progressId], db)

  const normalizedOrderIds = Array.from(new Set(customerOrderIds.filter((id) => Number.isFinite(id) && id > 0)))
  const linkedOrders = normalizedOrderIds.length
    ? await query<any>(
        `SELECT id, po_number FROM customer_orders WHERE id IN (${normalizedOrderIds.map(() => '?').join(',')}) AND deleted_at IS NULL`,
        normalizedOrderIds,
        db,
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
      db,
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
      db,
    )
  }
}

const syncDeliveryProgressItems = async (
  progressId: number,
  items: Array<{
    id?: any
    line_type?: any
    customer_order_id?: any
    order_item_id?: any
    order_po_number?: any
    customer_po_number?: any
    bom_id?: any
    bom_code?: any
    bom_name?: any
    material_id?: any
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
  db?: DbExecutor,
) => {
  const existingItems = await query<any>(
    'SELECT id, line_type, order_item_id, bom_id FROM delivery_progress_items WHERE progress_id=? AND deleted_at IS NULL ORDER BY id ASC',
    [progressId],
    db,
  )
  const existingMap = new Map(existingItems.map((item) => [Number(item.id), item]))
  const existingIds = new Set(Array.from(existingMap.keys()).filter((id) => Number.isFinite(id) && id > 0))
  const keptIds = new Set<number>()
  const bomContexts = await loadProgressBomContexts(items.map((item) => Number(item?.order_item_id || 0)), db)
  const allocatedBomQty = await loadAllocatedBomQtyByOrderItems(
    items.filter((item) => normalizeProgressItemLineType(item?.line_type) === 'bom').map((item) => Number(item?.order_item_id || 0)),
    progressId,
    db,
  )

  const syncBomMaterialSnapshots = async (
    progressItemId: number,
    dueDate: string | null,
    materials: ProgressBomContextMaterial[],
  ) => {
      await execute(
        'UPDATE delivery_progress_item_materials SET deleted_at=?, deleted_by=? WHERE progress_item_id=? AND deleted_at IS NULL',
        [now8(), userId || null, progressItemId],
        db,
      )
    for (const material of materials) {
      await execute(
        `INSERT INTO delivery_progress_item_materials
          (progress_id, progress_item_id, bom_item_id, material_id, material_code, material_name, spec, unit, bom_unit_qty, supplier_id, supplier_name, due_date, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          progressId,
          progressItemId,
          material.bom_item_id,
          material.material_id,
          material.material_code,
          material.material_name,
          material.spec,
          material.unit,
          toQty(material.bom_unit_qty),
          material.supplier_id,
          material.supplier_name,
          dueDate,
          now8(),
        ],
        db,
      )
    }
  }

  const hasGeneratedPoItems = async (progressItemId: number) => {
      const row = await queryOne<any>(
      `SELECT pi.id
       FROM po_items pi
       JOIN purchase_orders po ON po.id = pi.po_id
       WHERE pi.progress_item_id=?
         AND pi.deleted_at IS NULL
         AND po.deleted_at IS NULL
         AND po.status <> 'cancelled'
       LIMIT 1`,
        [progressItemId],
        db,
      )
    return !!row
  }

  for (const item of items) {
    const itemId = Number(item?.id || 0)
    const lineType = normalizeProgressItemLineType(item?.line_type)
    const orderPoNumber = String(item?.order_po_number || '').trim()
    const customerPoNumber = String(item?.customer_po_number || '').trim()
    const customerOrderId = Number(item?.customer_order_id || 0) || null
    const orderItemId = Number(item?.order_item_id || 0) || null
    const bomId = Number(item?.bom_id || 0) || null
    const bomCode = String(item?.bom_code || '').trim()
    const bomName = String(item?.bom_name || '').trim()
    const materialId = await resolveMaterialId(item?.material_id, item?.material_code, db)
    const materialCode = String(item?.material_code || '').trim()
    const materialName = String(item?.material_name || '').trim()
    const plannedQty = toQty(item?.planned_qty)
    if (plannedQty <= 0) continue
    const spec = String(item?.spec || '').trim()
    const unit = String(item?.unit || 'PCS').trim() || 'PCS'
    const dueDate = item?.due_date ? toDateStr(item.due_date) : null
    const status = ['pending', 'partial', 'completed'].includes(String(item?.status || '')) ? String(item?.status) : 'pending'
    const remark = String(item?.remark || '').trim()
    const existingItem = existingMap.get(itemId)
    if (lineType === 'bom') {
      const context = orderItemId ? bomContexts.get(orderItemId) : null
      if (!context || !bomId || context.bom_id !== bomId) {
        throw new Error(`BOM 明細資料無效：${bomCode || bomName || orderPoNumber || orderItemId || 'unknown'}`)
      }
      const allocatedElsewhere = toQty(allocatedBomQty.get(`${context.order_item_id}::${context.bom_id}`) || 0)
      const remainingQty = toQty(Math.max(0, toQty(context.order_qty) - allocatedElsewhere))
      if (plannedQty > remainingQty) {
        throw new Error(`BOM ${context.bom_code || context.bom_name || context.order_item_id} 剩餘可建立數量不足，最多 ${remainingQty}`)
      }
      const effectiveDueDate = dueDate || context.due_date || null
      const effectivePoNumber = orderPoNumber || context.order_po_number || ''
      const effectiveCustomerPoNumber = customerPoNumber || context.customer_po_number || ''
      const changedSnapshotSource = !!existingItem && (
        normalizeProgressItemLineType(existingItem.line_type) !== 'bom'
        || Number(existingItem.order_item_id || 0) !== context.order_item_id
        || Number(existingItem.bom_id || 0) !== context.bom_id
      )
      if (changedSnapshotSource && existingItem && await hasGeneratedPoItems(itemId)) {
        throw new Error(`交期明細已有採購記錄，不能直接更換 BOM：${context.bom_code || context.bom_name || itemId}`)
      }
      let targetItemId = itemId
      if (existingIds.has(itemId) && !keptIds.has(itemId)) {
        await execute(
          `UPDATE delivery_progress_items
           SET line_type='bom', customer_order_id=?, order_item_id=?, order_po_number=?, customer_po_number=?, bom_id=?, bom_code=?, bom_name=?, material_id=NULL, material_code=?, material_name=?, spec='', unit=?, planned_qty=?, due_date=?, status=?, remark=?, deleted_at=NULL, deleted_by=NULL
           WHERE id=? AND progress_id=? AND deleted_at IS NULL`,
          [
            context.customer_order_id,
            context.order_item_id,
            effectivePoNumber,
            effectiveCustomerPoNumber,
            context.bom_id,
            context.bom_code,
            context.bom_name,
            context.bom_code,
            context.bom_name,
            unit,
            plannedQty,
            effectiveDueDate,
            status,
            remark || (context.bom_code ? `BOM ${context.bom_code}${context.bom_name ? ` / ${context.bom_name}` : ''}` : ''),
            itemId,
            progressId,
          ],
          db,
        )
        keptIds.add(itemId)
      } else {
        const created = await execute(
          `INSERT INTO delivery_progress_items
            (progress_id, line_type, customer_order_id, order_item_id, order_po_number, customer_po_number, bom_id, bom_code, bom_name, material_id, material_code, material_name, spec, unit, planned_qty, due_date, status, remark, created_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [
            progressId,
            'bom',
            context.customer_order_id,
            context.order_item_id,
            effectivePoNumber,
            effectiveCustomerPoNumber,
            context.bom_id,
            context.bom_code,
            context.bom_name,
            null,
            context.bom_code,
            context.bom_name,
            '',
            unit,
            plannedQty,
            effectiveDueDate,
            status,
            remark || (context.bom_code ? `BOM ${context.bom_code}${context.bom_name ? ` / ${context.bom_name}` : ''}` : ''),
            now8(),
          ],
          db,
        )
        targetItemId = Number(created.insertId || 0)
        if (targetItemId > 0) keptIds.add(targetItemId)
      }
      if (!existingItem || changedSnapshotSource) {
        await syncBomMaterialSnapshots(targetItemId, effectiveDueDate, context.materials)
      }
      continue
    }
    if (!materialName) continue
    let materialOrderItemId: number | null = orderItemId
    if (!materialOrderItemId && customerOrderId) {
      materialOrderItemId = await resolveOrderItemIdForDnLine(customerOrderId, {
        materialCode: materialCode || materialName,
        itemName: materialName,
      }, db)
    }
    if (existingIds.has(itemId) && !keptIds.has(itemId)) {
      await execute(
        `UPDATE delivery_progress_items
         SET line_type='material', customer_order_id=?, order_item_id=?, order_po_number=?, customer_po_number='', bom_id=NULL, bom_code='', bom_name='', material_id=?, material_code=?, material_name=?, spec=?, unit=?, planned_qty=?, due_date=?, status=?, remark=?, deleted_at=NULL, deleted_by=NULL
         WHERE id=? AND progress_id=? AND deleted_at IS NULL`,
        [
          customerOrderId,
          materialOrderItemId,
          orderPoNumber,
          materialId,
          materialCode || materialName,
          materialName,
          spec,
          unit,
          plannedQty,
          dueDate,
          status,
          remark,
          itemId,
          progressId,
        ],
        db,
      )
      await execute(
        'UPDATE delivery_progress_item_materials SET deleted_at=?, deleted_by=? WHERE progress_item_id=? AND deleted_at IS NULL',
        [now8(), userId || null, itemId],
        db,
      )
      keptIds.add(itemId)
      continue
    }
    const created = await execute(
      `INSERT INTO delivery_progress_items
        (progress_id, line_type, customer_order_id, order_item_id, order_po_number, material_id, material_code, material_name, spec, unit, planned_qty, due_date, status, remark, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        progressId,
        'material',
        customerOrderId,
        materialOrderItemId,
        orderPoNumber,
        materialId,
        materialCode || materialName,
        materialName,
        spec,
        unit,
        plannedQty,
        dueDate,
        status,
        remark,
        now8(),
      ],
      db,
    )
    const createdId = Number(created.insertId || 0)
    if (createdId > 0) keptIds.add(createdId)
  }
  const removedIds = existingItems
    .map((item) => Number(item.id))
    .filter((existingId) => Number.isFinite(existingId) && existingId > 0 && !keptIds.has(existingId))
  if (removedIds.length) {
    await execute(
      `UPDATE delivery_progress_items
       SET deleted_at=?, deleted_by=?
       WHERE progress_id=? AND deleted_at IS NULL AND id IN (${removedIds.map(() => '?').join(',')})`,
      [now8(), userId || null, progressId, ...removedIds],
      db,
    )
    await execute(
      `UPDATE delivery_progress_item_materials
       SET deleted_at=?, deleted_by=?
       WHERE progress_id=? AND deleted_at IS NULL AND progress_item_id IN (${removedIds.map(() => '?').join(',')})`,
      [now8(), userId || null, progressId, ...removedIds],
      db,
    )
  }
}

const syncDeliveryNoteFromProgress = async (
  progressId: number,
  user: { userId?: number | null } | null | undefined,
  db?: DbExecutor,
) => {
  await ensureDeliveryProgressTable()
  await ensureDeliveryNoteProgressIdColumn()

  const progress = await queryOne<any>(`
    SELECT
      dp.*,
      COALESCE(po_links.po_numbers, dp.order_po_number, '') as linked_po_numbers,
      po_links.first_customer_order_id
    FROM delivery_progress dp
    LEFT JOIN (
      SELECT
        progress_id,
        GROUP_CONCAT(DISTINCT order_po_number ORDER BY order_po_number SEPARATOR ', ') as po_numbers,
        MIN(customer_order_id) as first_customer_order_id
      FROM delivery_progress_po_links
      WHERE deleted_at IS NULL
      GROUP BY progress_id
    ) po_links ON po_links.progress_id = dp.id
    WHERE dp.id=? AND dp.deleted_at IS NULL
  `, [progressId], db)
  if (!progress) return null

  const items = await query<any>(`
    SELECT *
    FROM delivery_progress_items
    WHERE progress_id=? AND deleted_at IS NULL
    ORDER BY id ASC
  `, [progressId], db)
  if (!items.length) return null
  const normalizedItems = await enrichDeliveryProgressItems(items, db)

  const customerName = String(progress.customer_name || '').trim()
  const progressPoRef = String(progress.linked_po_numbers || progress.order_po_number || '').trim()
  const deliveryDate = progress.due_date ? toDateStr(progress.due_date) : null
  const customerOrderId = Number(progress.first_customer_order_id || progress.customer_order_id || 0) || null
  const existing = await queryOne<any>(
    'SELECT id, dn_number, status FROM delivery_notes WHERE progress_id=? AND deleted_at IS NULL ORDER BY id DESC LIMIT 1',
    [progressId],
    db,
  )

  let dnId = Number(existing?.id || 0)
  let dnNumber = String(existing?.dn_number || '')
  const canRewrite = !existing || String(existing.status || '') === 'draft'
  if (!canRewrite) return { id: dnId, dn_number: dnNumber, skipped: true }

  if (existing) {
    await execute(
      'UPDATE delivery_notes SET customer_id=?, customer_name=?, customer_order_id=?, delivery_date=?, remark=? WHERE id=?',
      [progress.customer_id || null, customerName, customerOrderId, deliveryDate, progress.remark || '', dnId],
      db,
    )
    await softDeleteByWhere('delivery_note_items', 'dn_id=?', [dnId], user?.userId || null, db)
  } else {
    dnNumber = `DN${Date.now()}`
    const created = await execute(
      'INSERT INTO delivery_notes (dn_number,customer_id,customer_name,customer_order_id,progress_id,delivery_date,status,remark,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
      [dnNumber, progress.customer_id || null, customerName, customerOrderId, progressId, deliveryDate, 'draft', progress.remark || '', user?.userId || null, now8()],
      db,
    )
    dnId = Number(created.insertId || 0)
  }

  for (const item of normalizedItems) {
    const lineType = normalizeProgressItemLineType(item.line_type)
    const itemCode = String(lineType === 'bom' ? (item.bom_code || item.material_code || '') : (item.material_code || '')).trim()
    const itemName = String(lineType === 'bom' ? (item.bom_name || item.material_name || '') : (item.material_name || '')).trim()
    const materialId = lineType === 'bom' ? null : await resolveMaterialId(null, itemCode, db)
    const itemPoRef = String(item.order_po_number || progressPoRef || '').trim()
    let orderItemId = Number(item.order_item_id || 0) || null
    if (!orderItemId && customerOrderId) {
      orderItemId = await resolveOrderItemIdForDnLine(customerOrderId, {
        orderItemId: null,
        materialCode: itemCode,
        itemName: itemName,
      }, db)
    }
    await execute(
      'INSERT INTO delivery_note_items (dn_id,order_item_id,material_id,item_name,material_code,spec,unit,qty,remark,po_ref,thickness) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      [
        dnId,
        orderItemId,
        materialId,
        itemName,
        itemCode,
        lineType === 'bom' ? '' : (item.spec || ''),
        item.unit || 'PCS',
        toQty(item.planned_qty),
        item.remark || '',
        itemPoRef,
        null,
      ],
      db,
    )
  }

  if (!existing) {
    await audit(user, 'CREATE', '出貨單(自動)', dnId, `${dnNumber} ← ${progress.progress_no}`, db)
  }

  return { id: dnId, dn_number: dnNumber, skipped: false }
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

const addMonthsDateStr = (dateText: string, months: number): string => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateText || '').trim())
  if (!match) return toDateStr(dateText)
  const base = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  if (Number.isNaN(base.getTime())) return toDateStr(dateText)
  const next = new Date(base)
  next.setMonth(next.getMonth() + months)
  const y = next.getFullYear()
  const m = String(next.getMonth() + 1).padStart(2, '0')
  const day = String(next.getDate()).padStart(2, '0')
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

const buildOrderItemIdMap = async (
  pairs: Array<{ customer_order_id: number; material_code: string }>,
  db?: DbExecutor,
): Promise<Map<string, number>> => {
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
      AND ci.deleted_at IS NULL
      AND (
        ci.material_code IN (${codePlaceholders})
        OR b.product_sku IN (${codePlaceholders})
        OR EXISTS (
          SELECT 1 FROM bom_items bi
          WHERE bi.bom_id = ci.bom_id
            AND bi.deleted_at IS NULL
            AND TRIM(COALESCE(bi.material_code, '')) IN (${codePlaceholders})
        )
      )
    ORDER BY ci.id ASC
  `, [...orderIds, ...materialCodes, ...materialCodes, ...materialCodes], db)
  for (const row of rows) {
    const orderId = Number(row.customer_order_id || 0)
    const materialCode = String(row.material_code || '').trim()
    if (!orderId || !materialCode) continue
    const key = `${orderId}::${materialCode}`
    if (!keyMap.has(key)) keyMap.set(key, Number(row.order_item_id))
  }
  return keyMap
}

/** Resolve customer_order_items.id for a DN line missing order_item_id (e.g. material-only 交期進度). */
const resolveOrderItemIdForDnLine = async (
  customerOrderId: number,
  params: { orderItemId?: number | null; materialCode?: string; itemName?: string; bomId?: number | null },
  db?: DbExecutor,
): Promise<number | null> => {
  const direct = Number(params.orderItemId || 0)
  if (direct > 0) return direct
  const orderId = Number(customerOrderId || 0)
  if (orderId <= 0) return null
  const bomId = Number(params.bomId || 0)
  if (bomId > 0) {
    const byBom = await queryOne<any>(`
      SELECT ci.id
      FROM customer_order_items ci
      WHERE ci.order_id=? AND ci.bom_id=? AND ci.deleted_at IS NULL
      ORDER BY ci.id ASC
      LIMIT 1
    `, [orderId, bomId], db)
    if (byBom?.id) return Number(byBom.id)
  }
  const code = String(params.materialCode || '').trim()
  const name = String(params.itemName || '').trim()
  if (!code && !name) return null

  if (code) {
    const bySku = await queryOne<any>(`
      SELECT ci.id
      FROM customer_order_items ci
      JOIN bom b ON b.id = ci.bom_id AND b.deleted_at IS NULL
      WHERE ci.order_id=? AND ci.deleted_at IS NULL
        AND TRIM(COALESCE(b.product_sku, '')) = ?
      ORDER BY ci.id ASC
      LIMIT 1
    `, [orderId, code], db)
    if (bySku?.id) return Number(bySku.id)

    const byBomMaterial = await queryOne<any>(`
      SELECT ci.id
      FROM customer_order_items ci
      JOIN bom_items bi ON bi.bom_id = ci.bom_id AND bi.deleted_at IS NULL
      WHERE ci.order_id=? AND ci.deleted_at IS NULL
        AND TRIM(COALESCE(bi.material_code, '')) = ?
      ORDER BY ci.id ASC
      LIMIT 1
    `, [orderId, code], db)
    if (byBomMaterial?.id) return Number(byBomMaterial.id)
  }

  if (name) {
    const byName = await queryOne<any>(`
      SELECT ci.id
      FROM customer_order_items ci
      JOIN bom b ON b.id = ci.bom_id AND b.deleted_at IS NULL
      WHERE ci.order_id=? AND ci.deleted_at IS NULL
        AND TRIM(COALESCE(b.product_name, '')) = ?
      ORDER BY ci.id ASC
      LIMIT 1
    `, [orderId, name], db)
    if (byName?.id) return Number(byName.id)
  }

  return null
}

/** Material line match between DN item and 交期進度 row (multi-order batches may share bom_code). */
const dnProgressMaterialMatchSql = `
  TRIM(COALESCE(dpi.bom_code, dpi.material_code, '')) = TRIM(COALESCE(dni.material_code, ''))
`

/** When DN po_ref is set, only match the progress line for that PO (avoids wrong order_item_id). */
const dnProgressPoMatchSql = `
  (
    TRIM(COALESCE(dni.po_ref, '')) = ''
    OR TRIM(COALESCE(dpi.order_po_number, '')) = TRIM(COALESCE(dni.po_ref, ''))
    OR TRIM(COALESCE(dpi.customer_po_number, '')) = TRIM(COALESCE(dni.po_ref, ''))
  )
`

/** Match DN line to order_item_id via linked 交期進度 (multi-order progress). */
const resolveOrderItemIdFromProgress = async (
  deliveryNoteItemId: number,
  db?: DbExecutor,
): Promise<number | null> => {
  const row = await queryOne<any>(`
    SELECT dpi.order_item_id
    FROM delivery_note_items dni
    JOIN delivery_notes dn ON dn.id = dni.dn_id AND dn.deleted_at IS NULL AND dn.progress_id IS NOT NULL
    JOIN delivery_progress_items dpi ON dpi.progress_id = dn.progress_id AND dpi.deleted_at IS NULL
      AND dpi.order_item_id IS NOT NULL AND dpi.order_item_id > 0
      AND ${dnProgressMaterialMatchSql}
      AND ${dnProgressPoMatchSql}
    WHERE dni.id=? AND dni.deleted_at IS NULL
    ORDER BY
      CASE
        WHEN TRIM(COALESCE(dni.po_ref, '')) <> ''
          AND TRIM(COALESCE(dpi.order_po_number, '')) = TRIM(COALESCE(dni.po_ref, '')) THEN 0
        ELSE 1
      END,
      dpi.id ASC
    LIMIT 1
  `, [deliveryNoteItemId], db)
  const id = Number(row?.order_item_id || 0)
  return id > 0 ? id : null
}

const recalcCustomerOrderStatus = async (orderIds: number[], db?: DbExecutor) => {
  const normalized = Array.from(new Set(orderIds.map((id) => Number(id || 0)).filter((id) => id > 0)))
  for (const orderId of normalized) {
    const summary = await queryOne<any>(
      'SELECT COALESCE(SUM(qty),0) as total_qty, COALESCE(SUM(arrived_qty),0) as arrived_qty FROM customer_order_items WHERE order_id=? AND deleted_at IS NULL',
      [orderId],
      db,
    )
    const totalQty = toQty(summary?.total_qty || 0)
    const arrivedQty = toQty(summary?.arrived_qty || 0)
    const nextOrderStatus = totalQty <= 0 ? 'pending' : arrivedQty >= totalQty ? 'completed' : arrivedQty > 0 ? 'partial' : 'pending'
    await execute('UPDATE customer_orders SET status=? WHERE id=? AND deleted_at IS NULL', [nextOrderStatus, orderId], db)
  }
}

/** Sum shipped qty per order line from ALL shipped DNs (supports multi-order 交期進度). */
const buildShippedQtyByOrderItemId = async (db?: DbExecutor): Promise<Map<number, number>> => {
  const shippedByOrderItem = new Map<number, number>()
  const dniRows = await query<any>(`
    SELECT dni.id, dni.order_item_id, dni.material_code, dni.item_name, dni.po_ref,
           COALESCE(dni.qty, 0) as qty, dn.customer_order_id
    FROM delivery_note_items dni
    JOIN delivery_notes dn ON dn.id = dni.dn_id AND dn.deleted_at IS NULL
    WHERE dn.status='shipped' AND dni.deleted_at IS NULL
  `, [], db)

  for (const row of dniRows) {
    let orderItemId = Number(row.order_item_id || 0)
    // Multi-PO delivery notes may have been linked to the header order by legacy
    // code. When a line carries its own PO reference, the progress-line mapping
    // is authoritative and must also replace a stale, non-zero order_item_id.
    const progressOrderItemId = String(row.po_ref || '').trim()
      ? await resolveOrderItemIdFromProgress(Number(row.id), db)
      : null
    if (progressOrderItemId && progressOrderItemId !== orderItemId) {
      orderItemId = progressOrderItemId
      await execute('UPDATE delivery_note_items SET order_item_id=? WHERE id=?', [orderItemId, row.id], db)
    } else if (!orderItemId) {
      orderItemId = progressOrderItemId
        || (await resolveOrderItemIdForDnLine(Number(row.customer_order_id || 0), {
          materialCode: row.material_code,
          itemName: row.item_name,
        }, db))
        || 0
      if (orderItemId) {
        await execute('UPDATE delivery_note_items SET order_item_id=? WHERE id=?', [orderItemId, row.id], db)
      }
    }
    if (!orderItemId) continue
    shippedByOrderItem.set(orderItemId, toQty((shippedByOrderItem.get(orderItemId) || 0) + toQty(row.qty)))
  }
  return shippedByOrderItem
}

const applyShippedQtyToOrderItems = async (
  shippedByOrderItem: Map<number, number>,
  filterOrderIds?: number[],
  db?: DbExecutor,
): Promise<number[]> => {
  const orderItemIds = Array.from(shippedByOrderItem.keys()).filter((id) => id > 0)
  if (!orderItemIds.length) return []

  const inClause = orderItemIds.map(() => '?').join(',')
  const orderItems = await query<any>(`
    SELECT id, order_id, qty, COALESCE(arrived_qty, 0) as arrived_qty, COALESCE(reconciled_qty, 0) as reconciled_qty
    FROM customer_order_items
    WHERE id IN (${inClause}) AND deleted_at IS NULL
  `, orderItemIds, db)

  const updates: OrderQuantityUpdate[] = []
  const touchedOrderIds = new Set<number>()

  for (const row of orderItems) {
    const itemId = Number(row.id || 0)
    const orderId = Number(row.order_id || 0)
    if (!itemId || !orderId) continue
    if (filterOrderIds?.length && !filterOrderIds.includes(orderId)) continue

    const totalQty = toQty(row.qty)
    const shippedSum = toQty(shippedByOrderItem.get(itemId) || 0)
    const reconciledQty = toQty(row.reconciled_qty)
    const nextArrived = toQty(Math.min(totalQty, Math.max(shippedSum, reconciledQty)))
    const nextBalance = toQty(Math.max(0, totalQty - nextArrived))
    const nextStatus = nextArrived >= totalQty && totalQty > 0 ? 'completed' : nextArrived > 0 ? 'partial' : 'pending'

    if (toQty(row.arrived_qty) === nextArrived) continue

    updates.push({ itemId, arrivedQty: nextArrived, balance: nextBalance, status: nextStatus })
    touchedOrderIds.add(orderId)
  }

  if (updates.length > 0) {
    const updateSql = buildOrderQuantityCaseUpdate(updates)
    const idClause = updates.map(() => '?').join(',')
    await execute(`
      UPDATE customer_order_items
      SET
        arrived_qty = CASE id ${updateSql.arrivedCase} ELSE arrived_qty END,
        balance = CASE id ${updateSql.balanceCase} ELSE balance END,
        status = CASE id ${updateSql.statusCase} ELSE status END
      WHERE id IN (${idClause})
    `, updateSql.params, db)
    await recalcCustomerOrderStatus(Array.from(touchedOrderIds), db)
  }
  return Array.from(touchedOrderIds)
}

/** Recompute arrived_qty from shipped DNs by order_item_id (not only dn.customer_order_id). */
const syncCustomerOrderArrivedFromShippedDns = async (customerOrderId: number, db?: DbExecutor) => {
  const orderId = Number(customerOrderId || 0)
  if (orderId <= 0) return
  // 先補全該訂單關聯的 delivery_note_items 中缺失的 order_item_id
  const missingRows = await query<any>(`
    SELECT dni.id, dni.material_code, dni.item_name
    FROM delivery_note_items dni
    JOIN delivery_notes dn ON dn.id = dni.dn_id AND dn.deleted_at IS NULL
    WHERE dn.customer_order_id=? AND dn.status='shipped' AND dni.deleted_at IS NULL
      AND (dni.order_item_id IS NULL OR dni.order_item_id = 0)
  `, [orderId], db)
  for (const row of missingRows) {
    const orderItemId = (await resolveOrderItemIdFromProgress(Number(row.id), db))
      || (await resolveOrderItemIdForDnLine(orderId, { materialCode: row.material_code, itemName: row.item_name }, db))
      || 0
    if (orderItemId) {
      await execute('UPDATE delivery_note_items SET order_item_id=? WHERE id=?', [orderItemId, row.id], db)
    }
  }
  const shippedMap = await buildShippedQtyByOrderItemId(db)
  await applyShippedQtyToOrderItems(shippedMap, [orderId], db)
}

/** Full historical repair: all order lines referenced by any shipped DN. */
const syncAllCustomerOrdersArrivedFromShippedDns = async (db?: DbExecutor): Promise<{ orders_synced: number; order_items_updated: number }> => {
  const shippedMap = await buildShippedQtyByOrderItemId(db)
  const before = shippedMap.size
  const touchedOrderIds = await applyShippedQtyToOrderItems(shippedMap, undefined, db)
  const updated = await queryOne<any>(`
    SELECT COUNT(*) as cnt FROM customer_order_items ci
    JOIN delivery_note_items dni ON dni.order_item_id = ci.id AND dni.deleted_at IS NULL
    JOIN delivery_notes dn ON dn.id = dni.dn_id AND dn.status='shipped' AND dn.deleted_at IS NULL
    WHERE ci.deleted_at IS NULL AND ci.arrived_qty > 0
  `, [], db)
  return {
    orders_synced: touchedOrderIds.length,
    order_items_updated: Number(updated?.cnt || before),
  }
}

type OrderItemIdBackfillStats = {
  delivery_progress_items: { sql: number; js: number; unresolved: number }
  delivery_note_items: { sql: number; js: number; unresolved: number }
  shipment_reconciliation_items: { sql: number; js: number; unresolved: number }
  invoice_items: { sql: number; js: number; unresolved: number }
  delivery_progress: { sql: number; unresolved: number }
  arrived_qty_orders_synced: number
}

const countMissingOrderItemId = async (table: string, db?: DbExecutor): Promise<number> => {
  const row = await queryOne<any>(
    `SELECT COUNT(*) as cnt FROM ${table} WHERE deleted_at IS NULL AND (order_item_id IS NULL OR order_item_id = 0)`,
    [],
    db,
  )
  return Number(row?.cnt || 0)
}

/** Backfill order_item_id on progress/DN/reconcile/invoice rows and refresh arrived_qty from shipped DNs. */
const backfillAllOrderItemIds = async (db?: DbExecutor): Promise<OrderItemIdBackfillStats> => {
  const stats: OrderItemIdBackfillStats = {
    delivery_progress_items: { sql: 0, js: 0, unresolved: 0 },
    delivery_note_items: { sql: 0, js: 0, unresolved: 0 },
    shipment_reconciliation_items: { sql: 0, js: 0, unresolved: 0 },
    invoice_items: { sql: 0, js: 0, unresolved: 0 },
    delivery_progress: { sql: 0, unresolved: 0 },
    arrived_qty_orders_synced: 0,
  }
  const missing = '(order_item_id IS NULL OR order_item_id = 0)'

  const runSql = async (sql: string) => {
    const r = await execute(sql, [], db)
    return Number(r.affectedRows || 0)
  }

  stats.delivery_progress_items.sql += await runSql(`
    UPDATE delivery_progress_items dpi
    JOIN customer_order_items ci
      ON ci.order_id = dpi.customer_order_id AND ci.bom_id = dpi.bom_id AND ci.deleted_at IS NULL
    SET dpi.order_item_id = ci.id
    WHERE dpi.deleted_at IS NULL AND ${missing}
      AND dpi.customer_order_id IS NOT NULL AND dpi.bom_id IS NOT NULL
  `)

  stats.delivery_progress_items.sql += await runSql(`
    UPDATE delivery_progress_items dpi
    JOIN customer_order_items ci ON ci.order_id = dpi.customer_order_id AND ci.deleted_at IS NULL
    JOIN bom b ON b.id = ci.bom_id AND b.deleted_at IS NULL
    SET dpi.order_item_id = ci.id
    WHERE dpi.deleted_at IS NULL AND ${missing}
      AND dpi.customer_order_id IS NOT NULL
      AND TRIM(COALESCE(dpi.bom_code, '')) <> ''
      AND TRIM(COALESCE(b.product_sku, '')) = TRIM(dpi.bom_code)
  `)

  stats.delivery_progress_items.sql += await runSql(`
    UPDATE delivery_progress_items dpi
    JOIN customer_order_items ci ON ci.order_id = dpi.customer_order_id AND ci.deleted_at IS NULL
    JOIN bom_items bi ON bi.bom_id = ci.bom_id AND bi.deleted_at IS NULL
    SET dpi.order_item_id = ci.id
    WHERE dpi.deleted_at IS NULL AND ${missing}
      AND dpi.customer_order_id IS NOT NULL
      AND TRIM(COALESCE(dpi.material_code, '')) <> ''
      AND TRIM(COALESCE(bi.material_code, '')) = TRIM(dpi.material_code)
  `)

  const dpiRows = await query<any>(`
    SELECT id, customer_order_id, bom_id, bom_code, material_code, material_name, bom_name
    FROM delivery_progress_items
    WHERE deleted_at IS NULL AND ${missing} AND customer_order_id IS NOT NULL
  `, [], db)
  for (const row of dpiRows) {
    const resolved = await resolveOrderItemIdForDnLine(Number(row.customer_order_id), {
      bomId: row.bom_id,
      materialCode: row.bom_code || row.material_code,
      itemName: row.bom_name || row.material_name,
    }, db)
    if (resolved) {
      await execute('UPDATE delivery_progress_items SET order_item_id=? WHERE id=?', [resolved, row.id], db)
      stats.delivery_progress_items.js += 1
    }
  }
  stats.delivery_progress_items.unresolved = await countMissingOrderItemId('delivery_progress_items', db)

  // Prefer PO-specific match (fixes wrong order_item_id when multiple POs share the same bom_code).
  stats.delivery_note_items.sql += await runSql(`
    UPDATE delivery_note_items dni
    JOIN delivery_notes dn ON dn.id = dni.dn_id AND dn.deleted_at IS NULL AND dn.progress_id IS NOT NULL
    JOIN delivery_progress_items dpi ON dpi.progress_id = dn.progress_id AND dpi.deleted_at IS NULL
      AND dpi.order_item_id IS NOT NULL AND dpi.order_item_id > 0
      AND ${dnProgressMaterialMatchSql}
      AND TRIM(COALESCE(dni.po_ref, '')) <> ''
      AND TRIM(COALESCE(dpi.order_po_number, '')) = TRIM(COALESCE(dni.po_ref, ''))
    LEFT JOIN customer_order_items ci ON ci.id = dni.order_item_id AND ci.deleted_at IS NULL
    LEFT JOIN customer_orders co ON co.id = ci.order_id AND co.deleted_at IS NULL
    SET dni.order_item_id = dpi.order_item_id
    WHERE dni.deleted_at IS NULL
      AND (dni.order_item_id IS NULL OR dni.order_item_id = 0 OR co.po_number IS NULL OR TRIM(co.po_number) <> TRIM(dni.po_ref))
  `)

  stats.delivery_note_items.sql += await runSql(`
    UPDATE delivery_note_items dni
    JOIN delivery_notes dn ON dn.id = dni.dn_id AND dn.deleted_at IS NULL AND dn.progress_id IS NOT NULL
    JOIN delivery_progress_items dpi ON dpi.progress_id = dn.progress_id AND dpi.deleted_at IS NULL
      AND dpi.order_item_id IS NOT NULL AND dpi.order_item_id > 0
      AND ${dnProgressMaterialMatchSql}
      AND ${dnProgressPoMatchSql}
    SET dni.order_item_id = dpi.order_item_id
    WHERE dni.deleted_at IS NULL AND ${missing}
  `)

  stats.delivery_note_items.sql += await runSql(`
    UPDATE delivery_note_items dni
    JOIN delivery_notes dn ON dn.id = dni.dn_id AND dn.deleted_at IS NULL AND dn.customer_order_id IS NOT NULL
    JOIN customer_order_items ci ON ci.order_id = dn.customer_order_id AND ci.deleted_at IS NULL
    JOIN bom b ON b.id = ci.bom_id AND b.deleted_at IS NULL
    SET dni.order_item_id = ci.id
    WHERE dni.deleted_at IS NULL AND ${missing}
      AND TRIM(COALESCE(dni.material_code, '')) <> ''
      AND TRIM(COALESCE(b.product_sku, '')) = TRIM(dni.material_code)
  `)

  stats.delivery_note_items.sql += await runSql(`
    UPDATE delivery_note_items dni
    JOIN delivery_notes dn ON dn.id = dni.dn_id AND dn.deleted_at IS NULL AND dn.customer_order_id IS NOT NULL
    JOIN customer_order_items ci ON ci.order_id = dn.customer_order_id AND ci.deleted_at IS NULL
    JOIN bom_items bi ON bi.bom_id = ci.bom_id AND bi.deleted_at IS NULL
    SET dni.order_item_id = ci.id
    WHERE dni.deleted_at IS NULL AND ${missing}
      AND TRIM(COALESCE(dni.material_code, '')) <> ''
      AND TRIM(COALESCE(bi.material_code, '')) = TRIM(dni.material_code)
  `)

  const dniRows = await query<any>(`
    SELECT dni.id, dni.material_code, dni.item_name, dn.customer_order_id
    FROM delivery_note_items dni
    JOIN delivery_notes dn ON dn.id = dni.dn_id AND dn.deleted_at IS NULL
    LEFT JOIN customer_order_items ci ON ci.id = dni.order_item_id AND ci.deleted_at IS NULL
    LEFT JOIN customer_orders co ON co.id = ci.order_id AND co.deleted_at IS NULL
    WHERE dni.deleted_at IS NULL
      AND (
        (${missing} AND dn.customer_order_id IS NOT NULL)
        OR (
          dn.progress_id IS NOT NULL
          AND TRIM(COALESCE(dni.po_ref, '')) <> ''
          AND (co.po_number IS NULL OR TRIM(co.po_number) <> TRIM(dni.po_ref))
        )
      )
  `, [], db)
  for (const row of dniRows) {
    let resolved = await resolveOrderItemIdFromProgress(Number(row.id), db)
    if (!resolved) {
      resolved = await resolveOrderItemIdForDnLine(Number(row.customer_order_id), {
        materialCode: row.material_code,
        itemName: row.item_name,
      }, db)
    }
    if (resolved) {
      await execute('UPDATE delivery_note_items SET order_item_id=? WHERE id=?', [resolved, row.id], db)
      stats.delivery_note_items.js += 1
    }
  }
  stats.delivery_note_items.unresolved = await countMissingOrderItemId('delivery_note_items', db)

  stats.shipment_reconciliation_items.sql += await runSql(`
    UPDATE shipment_reconciliation_items sri
    JOIN delivery_note_items dni ON dni.id = sri.delivery_note_item_id AND dni.deleted_at IS NULL
    SET sri.order_item_id = dni.order_item_id
    WHERE sri.deleted_at IS NULL AND ${missing}
      AND dni.order_item_id IS NOT NULL AND dni.order_item_id > 0
  `)

  stats.shipment_reconciliation_items.sql += await runSql(`
    UPDATE shipment_reconciliation_items sri
    JOIN customer_order_items ci ON ci.order_id = sri.customer_order_id AND ci.deleted_at IS NULL
    JOIN bom b ON b.id = ci.bom_id AND b.deleted_at IS NULL
    SET sri.order_item_id = ci.id
    WHERE sri.deleted_at IS NULL AND ${missing}
      AND sri.customer_order_id IS NOT NULL
      AND TRIM(COALESCE(sri.material_code, '')) <> ''
      AND TRIM(COALESCE(b.product_sku, '')) = TRIM(sri.material_code)
  `)

  stats.shipment_reconciliation_items.sql += await runSql(`
    UPDATE shipment_reconciliation_items sri
    JOIN customer_order_items ci ON ci.order_id = sri.customer_order_id AND ci.deleted_at IS NULL
    JOIN bom_items bi ON bi.bom_id = ci.bom_id AND bi.deleted_at IS NULL
    SET sri.order_item_id = ci.id
    WHERE sri.deleted_at IS NULL AND ${missing}
      AND sri.customer_order_id IS NOT NULL
      AND TRIM(COALESCE(sri.material_code, '')) <> ''
      AND TRIM(COALESCE(bi.material_code, '')) = TRIM(sri.material_code)
  `)

  const sriRows = await query<any>(`
    SELECT id, customer_order_id, material_code, material_name
    FROM shipment_reconciliation_items
    WHERE deleted_at IS NULL AND ${missing} AND customer_order_id IS NOT NULL
  `, [], db)
  for (const row of sriRows) {
    const resolved = await resolveOrderItemIdForDnLine(Number(row.customer_order_id), {
      materialCode: row.material_code,
      itemName: row.material_name,
    }, db)
    if (resolved) {
      await execute('UPDATE shipment_reconciliation_items SET order_item_id=? WHERE id=?', [resolved, row.id], db)
      stats.shipment_reconciliation_items.js += 1
    }
  }
  stats.shipment_reconciliation_items.unresolved = await countMissingOrderItemId('shipment_reconciliation_items', db)

  stats.invoice_items.sql += await runSql(`
    UPDATE invoice_items ii
    JOIN shipment_reconciliation_items sri ON sri.id = ii.reconciliation_item_id AND sri.deleted_at IS NULL
    SET ii.order_item_id = sri.order_item_id
    WHERE ii.deleted_at IS NULL AND ${missing}
      AND sri.order_item_id IS NOT NULL AND sri.order_item_id > 0
  `)

  stats.invoice_items.sql += await runSql(`
    UPDATE invoice_items ii
    JOIN customer_order_items ci ON ci.order_id = ii.customer_order_id AND ci.deleted_at IS NULL
    JOIN bom b ON b.id = ci.bom_id AND b.deleted_at IS NULL
    SET ii.order_item_id = ci.id
    WHERE ii.deleted_at IS NULL AND ${missing}
      AND ii.customer_order_id IS NOT NULL
      AND TRIM(COALESCE(ii.material_code, '')) <> ''
      AND TRIM(COALESCE(b.product_sku, '')) = TRIM(ii.material_code)
  `)

  const iiRows = await query<any>(`
    SELECT id, customer_order_id, material_code, material_name
    FROM invoice_items
    WHERE deleted_at IS NULL AND ${missing} AND customer_order_id IS NOT NULL
  `, [], db)
  for (const row of iiRows) {
    const resolved = await resolveOrderItemIdForDnLine(Number(row.customer_order_id), {
      materialCode: row.material_code,
      itemName: row.material_name,
    }, db)
    if (resolved) {
      await execute('UPDATE invoice_items SET order_item_id=? WHERE id=?', [resolved, row.id], db)
      stats.invoice_items.js += 1
    }
  }
  stats.invoice_items.unresolved = await countMissingOrderItemId('invoice_items', db)

  stats.delivery_progress.sql += await runSql(`
    UPDATE delivery_progress dp
    JOIN (
      SELECT progress_id, MIN(order_item_id) as order_item_id
      FROM delivery_progress_items
      WHERE deleted_at IS NULL AND order_item_id IS NOT NULL AND order_item_id > 0
      GROUP BY progress_id
    ) linked ON linked.progress_id = dp.id
    SET dp.order_item_id = linked.order_item_id
    WHERE dp.deleted_at IS NULL AND (dp.order_item_id IS NULL OR dp.order_item_id = 0)
  `)

  stats.delivery_progress.sql += await runSql(`
    UPDATE delivery_progress dp
    JOIN customer_order_items ci ON ci.order_id = dp.customer_order_id AND ci.deleted_at IS NULL
    JOIN bom b ON b.id = ci.bom_id AND b.deleted_at IS NULL
    SET dp.order_item_id = ci.id
    WHERE dp.deleted_at IS NULL AND (dp.order_item_id IS NULL OR dp.order_item_id = 0)
      AND dp.customer_order_id IS NOT NULL
      AND TRIM(COALESCE(dp.material_code, '')) <> ''
      AND TRIM(COALESCE(b.product_sku, '')) = TRIM(dp.material_code)
  `)
  stats.delivery_progress.unresolved = Number((await queryOne<any>(
    'SELECT COUNT(*) as cnt FROM delivery_progress WHERE deleted_at IS NULL AND (order_item_id IS NULL OR order_item_id = 0) AND customer_order_id IS NOT NULL',
    [],
    db,
  ))?.cnt || 0)

  const syncResult = await syncAllCustomerOrdersArrivedFromShippedDns(db)
  stats.arrived_qty_orders_synced = syncResult.orders_synced

  return stats
}

let ensureOrderItemIdBackfillPromise: Promise<OrderItemIdBackfillStats> | null = null
const ensureOrderItemIdBackfill = async () => {
  if (!ensureOrderItemIdBackfillPromise) {
    ensureOrderItemIdBackfillPromise = (async () => {
      await ensureDeliveryProgressTable()
      await ensureShipmentReconciliationTables()
      await ensureInvoiceTables()
      await ensureDeliveryNoteProgressIdColumn()
      const stats = await backfillAllOrderItemIds()
      const unresolvedTotal =
        stats.delivery_progress_items.unresolved
        + stats.delivery_note_items.unresolved
        + stats.shipment_reconciliation_items.unresolved
        + stats.invoice_items.unresolved
        + stats.delivery_progress.unresolved
      if (unresolvedTotal > 0) {
        console.warn('[order_item_id backfill] remaining rows without order_item_id:', stats)
      } else {
        console.log('[order_item_id backfill] complete:', stats)
      }
      return stats
    })().catch((e) => {
      ensureOrderItemIdBackfillPromise = null
      throw e
    })
  }
  await ensureOrderItemIdBackfillPromise
}

// ── Audit ────────────────────────────────────────────────────────────────────
async function audit(user: any, action: string, resource: string, resourceId: any, detail?: string, db?: DbExecutor) {
  try {
    await execute(
      'INSERT INTO audit_logs (user_id, user_name, user_email, action, resource, resource_id, detail, created_at) VALUES (?,?,?,?,?,?,?,?)',
      [user?.userId || 0, user?.name || 'system', user?.email || '', action, resource, String(resourceId), detail || '', now8()],
      db,
    )
  } catch (e) {
    // Audit failure must not block the business operation, but it must be visible
    // to operators instead of silently losing the trace.
    console.error('[audit] failed to write operation log', { action, resource, resourceId, error: e })
  }
}

app.get('/', c => c.json({ name: 'RUBBER MES Backend', version: '2.0.0' }))

// ── All Permissions (defined early, used in login + role-permissions) ─────────
const ALL_PERMISSIONS = [
  { key: 'customer_order.create', label: '新增客戶訂單' },
  { key: 'customer_order.delete', label: '刪除客戶訂單' },
  { key: 'quotation.approve', label: '審核報價單' },
  { key: 'bom.create', label: '新增BOM' },
  { key: 'bom.edit', label: '編輯BOM' },
  { key: 'bom.delete', label: '刪除BOM' },
  { key: 'po.create', label: '新增採購單' },
  { key: 'po.approve', label: '審核採購單（送出→審核）' },
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

// ── Auth ─────────────────────────────────────────────────────────────────────
app.post('/api/auth/login', async c => {
  try {
    const { email, password } = await c.req.json()
    const normalizedEmail = String(email || '').trim().toLowerCase()
    if (!normalizedEmail || !password) {
      if (normalizedEmail) await audit({ email: normalizedEmail, name: 'unknown' }, 'LOGIN_FAILED', '系統登入', '-', '缺少登入欄位')
      return c.json({ error: 'Missing fields' }, 400)
    }
    const user = await queryOne<any>('SELECT * FROM users WHERE email=? AND deleted_at IS NULL', [normalizedEmail])
    if (!user) {
      await audit({ email: normalizedEmail, name: 'unknown' }, 'LOGIN_FAILED', '系統登入', '-', '帳號或密碼錯誤')
      return c.json({ error: 'Invalid credentials' }, 401)
    }
    if (hashPw(password) !== user.password_hash) {
      await audit({ userId: user.id, email: user.email, name: user.name }, 'LOGIN_FAILED', '系統登入', user.id, '帳號或密碼錯誤')
      return c.json({ error: 'Invalid credentials' }, 401)
    }
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
    await audit({ userId: user.id, email: user.email, name: user.name }, 'LOGIN', '系統登入', user.id, '登入成功')
    return c.json({ token, user: { id: user.id, email: user.email, name: user.name, role: normalizedRole, signature_url: user.signature_url || null }, permissions })
  } catch (e: any) { return c.json({ error: String(e.message) }, 500) }
})

app.post('/api/auth/logout', authMiddleware, async c => {
  const u = c.get('user')
  await audit(u, 'LOGOUT', '系統登入', u.userId, '安全登出')
  return c.json({ ok: true })
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
    await audit(u, 'UPDATE', '個人簽名', u.userId, signature_url ? '更新電子簽名' : '移除電子簽名')
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
  const blockedBy = await blockIfReferenced(id, [
    { label: '材料', sql: 'SELECT COUNT(*) as cnt FROM materials WHERE supplier_id=? AND deleted_at IS NULL' },
    { label: 'BOM', sql: 'SELECT COUNT(*) as cnt FROM bom WHERE supplier_id=? AND deleted_at IS NULL' },
    { label: '採購單', sql: 'SELECT COUNT(*) as cnt FROM purchase_orders WHERE supplier_id=? AND deleted_at IS NULL' },
    { label: '進貨單', sql: 'SELECT COUNT(*) as cnt FROM goods_receipts WHERE supplier_id=? AND deleted_at IS NULL' },
    { label: '應付發票', sql: "SELECT COUNT(*) as cnt FROM invoice_headers WHERE invoice_type='supplier' AND party_id=? AND deleted_at IS NULL" },
  ])
  if (blockedBy) return c.json({ error: blockedBy }, 400)
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
  const blockedBy = await blockIfReferenced(id, [
    { label: '客戶訂單', sql: 'SELECT COUNT(*) as cnt FROM customer_orders WHERE customer_id=? AND deleted_at IS NULL' },
    { label: '報價單', sql: 'SELECT COUNT(*) as cnt FROM quotations WHERE customer_id=? AND deleted_at IS NULL' },
    { label: '出貨單', sql: 'SELECT COUNT(*) as cnt FROM delivery_notes WHERE customer_id=? AND deleted_at IS NULL' },
    { label: '送貨單', sql: 'SELECT COUNT(*) as cnt FROM delivery_sheets WHERE customer_id=? AND deleted_at IS NULL' },
    { label: '交期進度', sql: 'SELECT COUNT(*) as cnt FROM delivery_progress WHERE customer_id=? AND deleted_at IS NULL' },
    { label: '應收發票', sql: "SELECT COUNT(*) as cnt FROM invoice_headers WHERE invoice_type='customer' AND party_id=? AND deleted_at IS NULL" },
  ])
  if (blockedBy) return c.json({ error: blockedBy }, 400)
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
    const result = await withTransaction(async tx => {
      const existing = await queryOne<any>('SELECT material_code FROM materials WHERE id=? AND deleted_at IS NULL FOR UPDATE', [id], tx)
      if (!existing) throw Object.assign(new Error('Not found'), { status: 404 })

      const currentMaterialCode = String(existing.material_code || '').trim()
      const nextMaterialCode = String(b.material_code ?? currentMaterialCode).trim()
      if (!nextMaterialCode) throw Object.assign(new Error('material_code required'), { status: 400 })

      if (nextMaterialCode !== currentMaterialCode) {
        const duplicate = await queryOne<any>(
          'SELECT id FROM materials WHERE material_code=? AND id<>? AND deleted_at IS NULL LIMIT 1',
          [nextMaterialCode, id],
          tx,
        )
        if (duplicate) throw Object.assign(new Error('新的物料編號已存在，請更換後再試'), { status: 409 })

        const bomConflict = await queryOne<any>(
          `SELECT id, product_sku
           FROM bom
           WHERE product_sku=? AND deleted_at IS NULL AND COALESCE(material_id, 0)<>?
           LIMIT 1`,
          [nextMaterialCode, id],
          tx,
        )
        if (bomConflict) {
          throw Object.assign(
            new Error(`新的物料編號與 BOM SKU「${bomConflict.product_sku}」衝突，請先處理 BOM ${bomConflict.id}`),
            { status: 409 },
          )
        }
      }

      const moqTiers = normalizeMoqTiers(b.moq_tiers)
      const singleMoq = moqTiers.length ? moqTiers[0].moq : (b.moq ? Number(b.moq) : null)
      const leadtimeText = String(b.leadtime_text ?? b.leadtime ?? '').trim()
      const leadtimeDays = leadtimeText
        ? (/^\d+$/.test(leadtimeText) ? Number(leadtimeText) : null)
        : (b.leadtime_days ? Number(b.leadtime_days) : null)
      await execute(
        'UPDATE materials SET material_code=?,material_name=?,spec=?,unit=?,category=?,product_category=?,supplier_id=?,supplier_price=?,company_price=?,currency=?,stock=?,image_url=?,color=?,leadtime_days=?,leadtime_text=?,moq=?,moq_tiers=?,remark=? WHERE id=?',
        [
          nextMaterialCode, b.material_name, b.spec || '', b.unit || 'PCS', b.category || '', b.product_category || '',
          b.supplier_id || null, b.supplier_price || 0, b.company_price || 0, b.currency || 'VND', b.stock || 0, b.image_url || '',
          b.color || '', leadtimeDays, leadtimeText || null, singleMoq, moqTiers.length ? JSON.stringify(moqTiers) : null, b.remark || '', id,
        ],
        tx,
      )

      if (nextMaterialCode !== currentMaterialCode) {
        await syncActiveMaterialCodeReferences(tx, id, currentMaterialCode, nextMaterialCode)
      }

      return { currentMaterialCode, nextMaterialCode }
    })

    const auditDetail = result.currentMaterialCode === result.nextMaterialCode
      ? result.nextMaterialCode
      : `${result.currentMaterialCode} → ${result.nextMaterialCode}`
    await audit(c.get('user'), 'UPDATE', '材料', id, auditDetail)
    return c.json({ ok: true, material_code: result.nextMaterialCode })
  } catch (e: any) {
    const status = Number(e?.status)
    const responseStatus = status >= 400 && status < 600 ? status : 500
    return c.json({ error: String(e.message) }, responseStatus as any)
  }
})
app.delete('/api/materials/:id', authMiddleware, requirePerm('bom.delete'), async c => {
  const id = c.req.param('id')
  const blockedBy = await blockIfReferenced(id, [
    { label: 'BOM 用料', sql: 'SELECT COUNT(*) as cnt FROM bom_items bi JOIN bom b ON b.id = bi.bom_id WHERE bi.material_id=? AND bi.deleted_at IS NULL AND b.deleted_at IS NULL' },
    { label: '採購單', sql: 'SELECT COUNT(*) as cnt FROM po_items pi JOIN purchase_orders po ON po.id = pi.po_id WHERE pi.material_id=? AND pi.deleted_at IS NULL AND po.deleted_at IS NULL' },
    { label: '報價單', sql: 'SELECT COUNT(*) as cnt FROM quotation_items qi JOIN quotations q ON q.id = qi.quotation_id WHERE qi.material_id=? AND qi.deleted_at IS NULL AND q.deleted_at IS NULL' },
    { label: '出貨單', sql: 'SELECT COUNT(*) as cnt FROM delivery_note_items dni JOIN delivery_notes dn ON dn.id = dni.dn_id WHERE dni.material_id=? AND dni.deleted_at IS NULL AND dn.deleted_at IS NULL' },
    { label: '送貨單', sql: 'SELECT COUNT(*) as cnt FROM delivery_sheet_items dsi JOIN delivery_sheets ds ON ds.id = dsi.ds_id WHERE dsi.material_id=? AND dsi.deleted_at IS NULL AND ds.deleted_at IS NULL' },
    { label: '進貨單', sql: 'SELECT COUNT(*) as cnt FROM goods_receipt_items gri JOIN goods_receipts gr ON gr.id = gri.gr_id WHERE gri.material_id=? AND gri.deleted_at IS NULL AND gr.deleted_at IS NULL' },
    { label: '生產領料', sql: 'SELECT COUNT(*) as cnt FROM production_materials pm JOIN production_orders po ON po.id = pm.prod_id WHERE pm.material_id=? AND pm.deleted_at IS NULL AND po.deleted_at IS NULL' },
    { label: '庫存調整', sql: 'SELECT COUNT(*) as cnt FROM stock_adjustment_items sai JOIN stock_adjustments sa ON sa.id = sai.adj_id WHERE sai.material_id=? AND sai.deleted_at IS NULL AND sa.deleted_at IS NULL' },
  ])
  if (blockedBy) return c.json({ error: blockedBy }, 400)
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
    LEFT JOIN materials m ON b.material_id IS NOT NULL AND b.material_id > 0 AND m.id = b.material_id AND m.deleted_at IS NULL
    LEFT JOIN suppliers ms ON m.supplier_id = ms.id AND ms.deleted_at IS NULL
    LEFT JOIN (
      SELECT
        bom_id,
        COUNT(*) as item_count,
        COALESCE(SUM(COALESCE(m2.supplier_price, bi.supplier_price, 0) * COALESCE(NULLIF(bi.quantity, 0), 1)), 0) as agg_supplier_price,
        COALESCE(SUM(COALESCE(m2.company_price, bi.company_price, 0) * COALESCE(NULLIF(bi.quantity, 0), 1)), 0) as agg_company_price
      FROM bom_items bi
      LEFT JOIN materials m2
        ON bi.material_id IS NOT NULL
        AND bi.material_id > 0
        AND m2.id = bi.material_id
        AND m2.deleted_at IS NULL
      WHERE bi.deleted_at IS NULL
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
    LEFT JOIN materials m ON b.material_id IS NOT NULL AND b.material_id > 0 AND m.id = b.material_id AND m.deleted_at IS NULL
    LEFT JOIN suppliers ms ON m.supplier_id = ms.id AND ms.deleted_at IS NULL
    LEFT JOIN (
      SELECT
        bom_id,
        COUNT(*) as item_count,
        COALESCE(SUM(COALESCE(m2.supplier_price, bi.supplier_price, 0) * COALESCE(NULLIF(bi.quantity, 0), 1)), 0) as agg_supplier_price,
        COALESCE(SUM(COALESCE(m2.company_price, bi.company_price, 0) * COALESCE(NULLIF(bi.quantity, 0), 1)), 0) as agg_company_price
      FROM bom_items bi
      LEFT JOIN materials m2
        ON bi.material_id IS NOT NULL
        AND bi.material_id > 0
        AND m2.id = bi.material_id
        AND m2.deleted_at IS NULL
      WHERE bi.deleted_at IS NULL
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
    LEFT JOIN materials m
      ON bi.material_id IS NOT NULL
      AND bi.material_id > 0
      AND m.id = bi.material_id
      AND m.deleted_at IS NULL
    LEFT JOIN suppliers ms ON m.supplier_id = ms.id AND ms.deleted_at IS NULL
    WHERE bi.bom_id=? AND bi.deleted_at IS NULL`, [c.req.param('id')])
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
    await ensureMaterialReferenceColumns()
    const b = await c.req.json()
    const productSku = normalizeRequiredText(b.product_sku)
    const productName = normalizeRequiredText(b.product_name)
    const headerMaterial = await resolveMaterialSnapshot(b.material_id, null)
    const unit = normalizeRequiredText(b.unit)
    const currency = normalizeRequiredText(b.currency)
    const totals = calcBomTotals(b.items)
    const supplierPrice = totals.hasItems ? totals.supplierTotal : parseRequiredMoney(b.supplier_price)
    const companyPrice = totals.hasItems ? totals.companyTotal : parseRequiredMoney(b.company_price)
    if (!productSku) return c.json({ error: 'product_sku required' }, 400)
    if (!productName) return c.json({ error: 'product_name required' }, 400)
    if (!headerMaterial.resolvedId || !headerMaterial.material) return c.json({ error: 'material_id required' }, 400)
    if (!unit) return c.json({ error: 'unit required' }, 400)
    if (!currency) return c.json({ error: 'currency required' }, 400)
    if (supplierPrice === null) return c.json({ error: 'supplier_price required and must be >= 0' }, 400)
    if (companyPrice === null) return c.json({ error: 'company_price required and must be >= 0' }, 400)
    const existing = await queryOne<any>('SELECT id FROM bom WHERE product_sku=? AND deleted_at IS NULL', [productSku])
    if (existing) return c.json({ error: `SKU「${productSku}」已存在，請使用不同的 SKU` }, 409)
    const u = c.get('user')
    const moqTiers = normalizeMoqTiers(b.moq_tiers)
    const r = await execute(`INSERT INTO bom (product_sku,product_name,material_id,material_name,spec,unit,supplier_id,supplier_name,supplier_price,company_price,currency,category,color,lt,moq,cert_code,brand,image_url,version,moq_tiers,status,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [productSku, productName, headerMaterial.resolvedId,
       headerMaterial.material?.material_name || b.material_name || '',
       headerMaterial.material?.spec || b.spec || '',
       headerMaterial.material?.unit || unit,
       headerMaterial.material?.supplier_id || b.supplier_id || null,
       headerMaterial.material?.supplier_name || b.supplier_name || '',
       supplierPrice, companyPrice,
       headerMaterial.material?.currency || currency, b.category||'', headerMaterial.material?.color || b.color || '', headerMaterial.material?.leadtime_text || b.lt || '', headerMaterial.material?.moq ?? b.moq ?? null, b.cert_code||'', b.brand||'', b.image_url||'', b.version||'V1',
       moqTiers.length ? JSON.stringify(moqTiers) : null,
       'active', u.userId, now8()])
    const bomId = r.insertId
    if (b.items?.length) {
      for (const item of b.items) {
        const { resolvedId: materialId, material } = await resolveMaterialSnapshot(item.material_id, null)
        if (!materialId || !material) return c.json({ error: 'BOM 組合材料必須選擇有效材料' }, 400)
        await execute('INSERT INTO bom_items (bom_id,material_id,material_code,material_name,spec,unit,quantity,supplier_name,supplier_price,company_price,currency,remark,color,lt,moq) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
          [
            bomId,
            materialId,
            material?.material_code || item.material_code,
            material?.material_name || item.material_name,
            material?.spec || item.spec || '',
            material?.unit || item.unit || 'PCS',
            item.quantity || null,
            material?.supplier_name || item.supplier_name || '',
            material?.supplier_price || item.supplier_price || 0,
            material?.company_price || item.company_price || 0,
            material?.currency || item.currency || 'VND',
            item.remark || '',
            material?.color || item.color || '',
            material?.leadtime_text || item.lt || '',
            material?.moq ?? item.moq ?? null,
          ])
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
    await ensureMaterialReferenceColumns()
    const id = c.req.param('id'); const b = await c.req.json(); const u = c.get('user')
    const existing = await queryOne<any>('SELECT product_sku FROM bom WHERE id=? AND deleted_at IS NULL', [id])
    if (!existing) return c.json({ error: 'Not found' }, 404)
    const productName = normalizeRequiredText(b.product_name)
    const headerMaterial = await resolveMaterialSnapshot(b.material_id, null)
    const unit = normalizeRequiredText(b.unit)
    const currency = normalizeRequiredText(b.currency)
    const totals = calcBomTotals(b.items)
    const supplierPrice = totals.hasItems ? totals.supplierTotal : parseRequiredMoney(b.supplier_price)
    const companyPrice = totals.hasItems ? totals.companyTotal : parseRequiredMoney(b.company_price)
    if (!productName) return c.json({ error: 'product_name required' }, 400)
    if (!headerMaterial.resolvedId || !headerMaterial.material) return c.json({ error: 'material_id required' }, 400)
    if (!unit) return c.json({ error: 'unit required' }, 400)
    if (!currency) return c.json({ error: 'currency required' }, 400)
    if (supplierPrice === null) return c.json({ error: 'supplier_price required and must be >= 0' }, 400)
    if (companyPrice === null) return c.json({ error: 'company_price required and must be >= 0' }, 400)
    const moqTiers = normalizeMoqTiers(b.moq_tiers)
    await execute(`UPDATE bom SET product_sku=?,product_name=?,material_id=?,material_name=?,spec=?,unit=?,supplier_id=?,supplier_name=?,supplier_price=?,company_price=?,currency=?,category=?,color=?,lt=?,moq=?,cert_code=?,brand=?,image_url=?,version=?,moq_tiers=? WHERE id=?`,
      [existing.product_sku, productName, headerMaterial.resolvedId,
       headerMaterial.material?.material_name || b.material_name || '',
       headerMaterial.material?.spec || b.spec || '',
       headerMaterial.material?.unit || unit,
       headerMaterial.material?.supplier_id || b.supplier_id || null,
       headerMaterial.material?.supplier_name || b.supplier_name || '',
       supplierPrice, companyPrice,
       headerMaterial.material?.currency || currency, b.category||'', headerMaterial.material?.color || b.color || '', headerMaterial.material?.leadtime_text || b.lt || '', headerMaterial.material?.moq ?? b.moq ?? null, b.cert_code||'', b.brand||'', b.image_url||'', b.version||'V1',
       moqTiers.length ? JSON.stringify(moqTiers) : null,
       id])
    await softDeleteByWhere('bom_items', 'bom_id=?', [id], c.get('user')?.userId)
    if (b.items?.length) {
      for (const item of b.items) {
        const { resolvedId: materialId, material } = await resolveMaterialSnapshot(item.material_id, null)
        if (!materialId || !material) return c.json({ error: 'BOM 組合材料必須選擇有效材料' }, 400)
        await execute('INSERT INTO bom_items (bom_id,material_id,material_code,material_name,spec,unit,quantity,supplier_name,supplier_price,company_price,currency,remark,color,lt,moq) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
          [
            id,
            materialId,
            material?.material_code || item.material_code,
            material?.material_name || item.material_name,
            material?.spec || item.spec || '',
            material?.unit || item.unit || 'PCS',
            item.quantity || null,
            material?.supplier_name || item.supplier_name || '',
            material?.supplier_price || item.supplier_price || 0,
            material?.company_price || item.company_price || 0,
            material?.currency || item.currency || 'VND',
            item.remark || '',
            material?.color || item.color || '',
            material?.leadtime_text || item.lt || '',
            material?.moq ?? item.moq ?? null,
          ])
      }
    }
    await audit(u, 'UPDATE', 'BOM', id, `${existing.product_sku} ${productName}`)
    return c.json({ ok: true })
  } catch (e: any) { return c.json({ error: String(e.message) }, 500) }
})
app.delete('/api/bom/:id', authMiddleware, requirePerm('bom.delete'), async c => {
  const id = c.req.param('id')
  const blockedBy = await blockIfReferenced(id, [
    { label: '客戶訂單', sql: 'SELECT COUNT(*) as cnt FROM customer_order_items coi JOIN customer_orders co ON co.id = coi.order_id WHERE coi.bom_id=? AND coi.deleted_at IS NULL AND co.deleted_at IS NULL' },
    { label: '生產單', sql: 'SELECT COUNT(*) as cnt FROM production_orders WHERE bom_id=? AND deleted_at IS NULL' },
  ])
  if (blockedBy) return c.json({ error: blockedBy }, 400)
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
  let sql = `SELECT po.*, COALESCE(s.name, po.supplier_name) as supplier_name, s.supplier_code
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
    SELECT po.*, COALESCE(s.name, po.supplier_name) as supplier_name, s.supplier_code
    FROM purchase_orders po LEFT JOIN suppliers s ON po.supplier_id = s.id AND s.deleted_at IS NULL
    WHERE po.id=? AND po.deleted_at IS NULL`, [c.req.param('id')])
  if (!po) return c.json({ error: 'Not found' }, 404)
  const items = await query(`
    SELECT pi.*,
           COALESCE(NULLIF(m.material_name, ''), NULLIF(pi.material_name, ''), '') as material_name,
           COALESCE(NULLIF(m.spec, ''), NULLIF(pi.spec, ''), '') as spec,
           COALESCE(NULLIF(m.unit, ''), NULLIF(pi.unit, ''), 'PCS') as unit,
           COALESCE(m.image_url, '') as image_url
    FROM po_items pi 
    LEFT JOIN materials m
      ON pi.material_id IS NOT NULL
      AND pi.material_id > 0
      AND pi.material_id = m.id
      AND m.deleted_at IS NULL
    WHERE pi.po_id=? AND pi.deleted_at IS NULL
    ORDER BY pi.id ASC`, [c.req.param('id')])
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
      WHERE ci.order_id=? AND ci.deleted_at IS NULL
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
        LEFT JOIN materials m
          ON bi.material_id IS NOT NULL
          AND bi.material_id > 0
          AND bi.material_id = m.id
          AND m.deleted_at IS NULL
        LEFT JOIN suppliers s ON m.supplier_id = s.id AND s.deleted_at IS NULL
        WHERE bi.bom_id=? AND bi.deleted_at IS NULL
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
    if (!['draft', 'pending_review'].includes(po.status)) return c.json({ error: '只能編輯草稿或待審核狀態的採購單' }, 400)
    const subTotal = (b.items||[]).reduce((s: number, i: any) => s + (i.total_price||0), 0)
    const taxRate = Math.min(25, Math.max(1, Number(b.tax_rate) || 8))
    const total = Math.round(subTotal * (1 + taxRate / 100) * 100) / 100
    await execute('UPDATE purchase_orders SET supplier_id=?,supplier_name=?,total_amount=?,tax_rate=?,currency=?,remark=? WHERE id=?',
      [b.supplier_id||null, b.supplier_name, total, taxRate, b.currency||'VND', b.remark||'', id])
    await softDeleteByWhere('po_items', 'po_id=?', [id], u?.userId)
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
    const row = await queryOne<any>('SELECT po_number, status, supplier_name, total_amount, currency FROM purchase_orders WHERE id=? AND deleted_at IS NULL', [id])
    if (!row) return c.json({ error: 'Not found' }, 404)
    if (row.status !== 'pending_review') return c.json({ error: '只有待審核狀態的採購單才能審核通過' }, 400)
    await execute('UPDATE purchase_orders SET status=?,approved_by=?,approved_at=? WHERE id=?', ['approved',u.userId,now8(),id])
    await audit(u, 'APPROVE', '採購單', id, `${row.po_number}: ${row.status} → approved`)
    return c.json({ ok: true })
  } catch (e: any) { return c.json({ error: String(e.message) }, 500) }
})
app.patch('/api/po/:id/status', authMiddleware, requirePerm('po.create'), async c => {
  try {
    const id = c.req.param('id'); const { status } = await c.req.json(); const u = c.get('user')
    const validStatuses = ['pending_review', 'sent', 'cancelled']
    if (!validStatuses.includes(status)) return c.json({ error: 'Invalid status' }, 400)
    const row = await queryOne<any>('SELECT po_number, status, supplier_name, total_amount, currency FROM purchase_orders WHERE id=? AND deleted_at IS NULL', [id])
    if (!row) return c.json({ error: 'Not found' }, 404)

    if (status === 'pending_review') {
      if (row.status !== 'draft') return c.json({ error: '只有草稿狀態的採購單才能提交審核' }, 400)
    } else if (status === 'sent') {
      if (row.status !== 'approved') return c.json({ error: '只有已審核的採購單才能送出' }, 400)
    }

    await execute('UPDATE purchase_orders SET status=? WHERE id=?', [status, id])
    await audit(u, 'STATUS_CHANGE', '採購單', id, `${row.po_number}: ${row.status} → ${status}`)

    // 提交審核時發通知郵件（非阻塞）
    if (status === 'pending_review') {
      ;(async () => {
        try {
          const co = await queryOne<any>('SELECT notification_email FROM company_settings WHERE id=1')
          const notifyEmail = co?.notification_email?.trim()
          if (notifyEmail) {
            const { subject, html } = buildPendingApprovalEmail({
              type: '採購單',
              number: row.po_number,
              name: row.supplier_name,
              createdBy: u.username || u.email || String(u.userId),
              amount: row.total_amount,
              currency: row.currency || 'VND',
            })
            await sendNotificationEmail({ to: notifyEmail, subject, html })
          }
        } catch {}
      })()
    }

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
app.patch('/api/po/:id/receive', authMiddleware, requirePerm('po.receive'), async c => {
  try {
    const id = c.req.param('id'); const u = c.get('user')
    const po = await queryOne<any>('SELECT * FROM purchase_orders WHERE id=? AND deleted_at IS NULL', [id])
    if (!po) return c.json({ error: 'Not found' }, 404)
    if (po.status === 'received') return c.json({ error: '此採購單已收貨，不可重複操作' }, 400)
    if (!['approved', 'sent'].includes(po.status)) return c.json({ error: '只有已審核或已送出的採購單才能收貨' }, 400)
    const items = await query<any>('SELECT * FROM po_items WHERE po_id=? AND deleted_at IS NULL', [id])
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
    await audit(u, 'RECEIVE', '採購單', id, `${po.po_number}: ${po.status} → received；收貨完成，庫存已更新`)
    return c.json({ ok: true })
  } catch (e: any) { return c.json({ error: String(e.message) }, 500) }
})

// ── Customer Orders ───────────────────────────────────────────────────────────
app.get('/api/customer-orders', authMiddleware, async c => {
  try {
    await ensureDeliveryProgressTable()
    const url = new URL(c.req.url)
    const status = url.searchParams.get('status') || ''
    const scheduleStatus = url.searchParams.get('schedule_status') || ''
    const customerId = url.searchParams.get('customer_id') || ''
    const dateFrom = url.searchParams.get('date_from') || ''
    const dateTo = url.searchParams.get('date_to') || ''
    const where: string[] = []
    const params: any[] = []
    if (status) { where.push('co.status=?'); params.push(status) }
    if (scheduleStatus === 'scheduled') where.push('COALESCE(progress_links.has_delivery_progress, 0) = 1')
    if (scheduleStatus === 'unscheduled') where.push('COALESCE(progress_links.has_delivery_progress, 0) = 0')
    if (customerId) { where.push('co.customer_id=?'); params.push(customerId) }
    if (dateFrom) { where.push('co.po_date>=?'); params.push(dateFrom) }
    if (dateTo) { where.push('co.po_date<=?'); params.push(dateTo) }
    where.unshift('co.deleted_at IS NULL')
    const whereClause = where.length ? ' WHERE ' + where.join(' AND ') : ''
    const listCustomerOrders = () => query(`
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
             COALESCE(SUM(ci.arrived_qty), 0) as arrived_total_qty,
	             GREATEST(0, COALESCE(SUM(ci.qty), 0) - COALESCE(SUM(ci.arrived_qty), 0)) as balance_total_qty,
	             CASE
	               WHEN COALESCE(SUM(ci.qty), 0) <= 0 THEN 0
	               ELSE ROUND(COALESCE(SUM(ci.arrived_qty), 0) / COALESCE(SUM(ci.qty), 0) * 100, 2)
	             END as completion_rate,
	             COALESCE(MAX(progress_stats.progress_created_qty), 0) as progress_created_qty,
	             GREATEST(0, COALESCE(SUM(ci.qty), 0) - COALESCE(MAX(progress_stats.progress_created_qty), 0)) as progress_remaining_qty,
	             CASE
	               WHEN COALESCE(SUM(ci.qty), 0) <= 0 THEN 0
	               ELSE ROUND(LEAST(COALESCE(MAX(progress_stats.progress_created_qty), 0), COALESCE(SUM(ci.qty), 0)) / COALESCE(SUM(ci.qty), 0) * 100, 2)
	             END as progress_created_rate,
	             COALESCE(MAX(progress_links.has_delivery_progress), 0) as has_delivery_progress,
	             CASE
	               WHEN COALESCE(MAX(progress_links.has_delivery_progress), 0) = 1 THEN 'scheduled'
	               ELSE 'unscheduled'
	             END as schedule_status,
             COALESCE(c.customer_name, co.customer_name) as customer_name, c.customer_code
      FROM customer_orders co
      LEFT JOIN customers c ON co.customer_id = c.id AND c.deleted_at IS NULL
      LEFT JOIN customer_order_items ci ON ci.order_id = co.id AND ci.deleted_at IS NULL
	      LEFT JOIN (
	        SELECT customer_order_id, 1 as has_delivery_progress
	        FROM delivery_progress_po_links
	        WHERE deleted_at IS NULL
	          AND customer_order_id IS NOT NULL
	        GROUP BY customer_order_id
	      ) progress_links ON progress_links.customer_order_id = co.id
	      LEFT JOIN (
	        SELECT
	          dpi.customer_order_id,
	          COALESCE(SUM(dpi.planned_qty), 0) as progress_created_qty
	        FROM delivery_progress_items dpi
	        WHERE dpi.deleted_at IS NULL
	          AND dpi.line_type='bom'
	          AND dpi.customer_order_id IS NOT NULL
	        GROUP BY dpi.customer_order_id
	      ) progress_stats ON progress_stats.customer_order_id = co.id
	      ${whereClause}
	      GROUP BY co.id
      ORDER BY co.created_at DESC
    `, params.length ? params : undefined)

    let orders = await listCustomerOrders()
    const staleIds = orders
      .filter((o: any) => toQty(o.completion_rate) === 0 && toQty(o.order_total_qty) > 0)
      .map((o: any) => Number(o.id))
      .filter((id: number) => id > 0)
    if (staleIds.length) {
      try {
        const batchSize = 100
        let needsSyncCount = 0
        for (let i = 0; i < staleIds.length; i += batchSize) {
          const batch = staleIds.slice(i, i + batchSize)
          const placeholders = batch.map(() => '?').join(',')
          const needsSync = await queryOne<any>(`
            SELECT COUNT(*) as cnt FROM (
              SELECT DISTINCT co.id
              FROM customer_orders co
              JOIN customer_order_items ci ON ci.order_id = co.id AND ci.deleted_at IS NULL
              JOIN delivery_note_items dni ON dni.order_item_id = ci.id AND dni.deleted_at IS NULL
              JOIN delivery_notes dn ON dn.id = dni.dn_id AND dn.status='shipped' AND dn.deleted_at IS NULL
              WHERE co.id IN (${placeholders}) AND co.deleted_at IS NULL
              UNION
              SELECT DISTINCT dn.customer_order_id
              FROM delivery_notes dn
              WHERE dn.status='shipped' AND dn.deleted_at IS NULL AND dn.customer_order_id IN (${placeholders})
            ) t
          `, [...batch, ...batch])
          needsSyncCount += Number(needsSync?.cnt || 0)
        }
        if (needsSyncCount > 0) {
          await syncAllCustomerOrdersArrivedFromShippedDns()
          orders = await listCustomerOrders()
        }
      } catch (syncError: any) {
        console.error('Customer order shipped-qty sync skipped:', syncError?.message || syncError)
      }
    }

    return c.json(orders)
  } catch (e: any) {
    console.error('Error fetching customer orders:', e.message)
    try {
      const orders = await query(`
        SELECT co.id, co.po_date, co.po_number, co.customer_id, co.status, co.remark, co.created_at,
               COALESCE(c.customer_name, co.customer_name) as customer_name, c.customer_code
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
           COALESCE(c.customer_name, co.customer_name) as customer_name,
           GROUP_CONCAT(b.product_name ORDER BY ci.id SEPARATOR ', ') as items_summary
    FROM customer_orders co
    LEFT JOIN customers c ON co.customer_id = c.id AND c.deleted_at IS NULL
    LEFT JOIN customer_order_items ci ON ci.order_id = co.id AND ci.deleted_at IS NULL
    LEFT JOIN bom b ON ci.bom_id = b.id AND b.deleted_at IS NULL
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
    JOIN bom_items bi ON bi.bom_id = b.id AND bi.deleted_at IS NULL
    LEFT JOIN materials m
      ON bi.material_id IS NOT NULL
      AND bi.material_id > 0
      AND bi.material_id = m.id
      AND m.deleted_at IS NULL
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
app.get('/api/customer-orders/bom-material-tree', authMiddleware, async c => {
  const orderIds = uniqueNumberList(String(c.req.query('order_ids') || '').split(','))
  if (!orderIds.length) return c.json([])
  const excludeProgressId = Number(c.req.query('exclude_progress_id') || 0) || null

  const rows = await query<any>(`
    SELECT
      co.id as order_id,
      co.po_number as order_po_number,
      co.status as order_status,
      COALESCE(c.customer_name, co.customer_name, '') as customer_name,
      ci.id as order_item_id,
      ci.qty as order_qty,
      ci.rta_date,
      ci.po_no as customer_po_number,
      b.id as bom_id,
      TRIM(COALESCE(b.product_sku, '')) as bom_sku,
      TRIM(COALESCE(b.product_name, '')) as bom_name,
      COALESCE(bi.id, 0) as bom_item_id,
      COALESCE(bi.material_id, 0) as material_id,
      TRIM(COALESCE(bi.material_code, '')) as material_code,
      TRIM(COALESCE(NULLIF(m.material_name, ''), bi.material_name, '')) as material_name,
      TRIM(COALESCE(NULLIF(m.spec, ''), bi.spec, '')) as spec,
      TRIM(COALESCE(NULLIF(m.unit, ''), NULLIF(bi.unit, ''), 'PCS')) as unit,
      COALESCE(bi.quantity, 0) as bom_unit_qty,
      COALESCE(ci.qty, 0) * COALESCE(bi.quantity, 0) as suggested_qty,
      m.supplier_id,
      COALESCE(s.name, m.supplier_name, '') as supplier_name
    FROM customer_order_items ci
    JOIN customer_orders co ON co.id = ci.order_id AND co.deleted_at IS NULL
    LEFT JOIN customers c ON co.customer_id = c.id AND c.deleted_at IS NULL
    JOIN bom b ON b.id = ci.bom_id AND b.deleted_at IS NULL
    JOIN bom_items bi ON bi.bom_id = b.id AND bi.deleted_at IS NULL
    LEFT JOIN materials m
      ON bi.material_id IS NOT NULL
      AND bi.material_id > 0
      AND bi.material_id = m.id
      AND m.deleted_at IS NULL
    LEFT JOIN suppliers s ON s.id = m.supplier_id AND s.deleted_at IS NULL
    WHERE ci.order_id IN (${orderIds.map(() => '?').join(',')})
      AND ci.deleted_at IS NULL
    ORDER BY co.created_at DESC, ci.id ASC, bi.id ASC
  `, orderIds)
  const allocatedByOrderItem = await loadAllocatedBomQtyByOrderItems(
    rows.map((row) => Number(row.order_item_id || 0)),
    excludeProgressId,
  )

  const grouped = new Map<string, any>()
  for (const row of rows) {
    const orderId = Number(row.order_id || 0)
    const orderItemId = Number(row.order_item_id || 0)
    const bomId = Number(row.bom_id || 0)
    const key = `${orderId}::${orderItemId}::${bomId}`
    if (!grouped.has(key)) {
      const orderQty = toQty(row.order_qty)
      const allocatedQty = toQty(allocatedByOrderItem.get(`${orderItemId}::${bomId}`) || 0)
      const remainingQty = toQty(Math.max(0, orderQty - allocatedQty))
      grouped.set(key, {
        id: key,
        order_id: orderId,
        order_po_number: String(row.order_po_number || ''),
        order_status: String(row.order_status || ''),
        customer_name: String(row.customer_name || ''),
        order_item_id: orderItemId,
        order_qty: orderQty,
        allocated_qty: allocatedQty,
        remaining_qty: remainingQty,
        due_date: row.rta_date || null,
        customer_po_number: String(row.customer_po_number || ''),
        bom_id: bomId,
        bom_sku: String(row.bom_sku || ''),
        bom_name: String(row.bom_name || ''),
        materials: [] as any[],
      })
    }
    grouped.get(key).materials.push({
      id: `${key}::${Number(row.bom_item_id || 0)}::${Number(row.material_id || 0)}`,
      bom_item_id: Number(row.bom_item_id || 0) || null,
      material_id: Number(row.material_id || 0) || null,
      material_code: String(row.material_code || '').trim(),
      material_name: String(row.material_name || '').trim(),
      spec: String(row.spec || '').trim(),
      unit: String(row.unit || 'PCS').trim() || 'PCS',
      bom_unit_qty: toQty(row.bom_unit_qty),
      suggested_qty: toQty(row.suggested_qty),
      supplier_id: Number(row.supplier_id || 0) || null,
      supplier_name: String(row.supplier_name || '').trim(),
      due_date: row.rta_date || null,
      order_po_number: String(row.order_po_number || '').trim(),
      customer_po_number: String(row.customer_po_number || '').trim(),
    })
  }
  return c.json(Array.from(grouped.values()))
})
app.get('/api/customer-orders/:id', authMiddleware, async c => {
  const orderId = Number(c.req.param('id') || 0)
  if (orderId > 0) {
    const hasShipped = await queryOne<any>(
      `SELECT id FROM delivery_notes WHERE customer_order_id=? AND status='shipped' AND deleted_at IS NULL LIMIT 1`,
      [orderId],
    )
    if (hasShipped) await syncCustomerOrderArrivedFromShippedDns(orderId)
  }
  const order = await queryOne<any>(`
    SELECT co.id, co.po_date, co.po_number, co.customer_id, co.status, co.remark, co.created_at,
           co.tax_rate, co.tax_amount, co.total_amount, co.currency,
           co.delivery_date, co.delivery_address, co.person_in_charge, co.payment_terms,
           co.received_amount, co.payment_status, co.payment_date, co.payment_note,
           COALESCE(c.customer_name, co.customer_name) as customer_name, c.customer_code, c.address, c.phone, c.fax, c.email, c.tax_id
    FROM customer_orders co LEFT JOIN customers c ON co.customer_id = c.id AND c.deleted_at IS NULL
    WHERE co.id=? AND co.deleted_at IS NULL`, [c.req.param('id')])
  if (!order) return c.json({ error: 'Not found' }, 404)
  const items = await query(`
    SELECT ci.id, ci.order_id, ci.bom_id, ci.qty, ci.unit_price, ci.rta_date, ci.po_no, ci.remark,
           ci.arrived_qty, ci.arrived_date, ci.balance, ci.status,
           b.product_sku, COALESCE(b.product_name, '') as product_name, b.version, COALESCE(b.spec, '') as spec, COALESCE(b.unit, 'PCS') as unit
    FROM customer_order_items ci
    LEFT JOIN bom b ON ci.bom_id = b.id AND b.deleted_at IS NULL
    WHERE ci.order_id=? AND ci.deleted_at IS NULL`, [c.req.param('id')])
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
    return c.json({ id: orderId }, 201)
  } catch (e: any) { return c.json({ error: String(e.message) }, 500) }
})
app.patch('/api/customer-orders/:id/status', authMiddleware, requirePerm('customer_order.create'), async c => {
  try {
    const id = c.req.param('id')
    const { status } = await c.req.json()
    const valid = ['pending', 'partial', 'completed', 'delay']
    if (!valid.includes(status)) return c.json({ error: 'Invalid status' }, 400)
    const orderId = Number(id)
    const row = await queryOne<any>('SELECT po_number,status FROM customer_orders WHERE id=? AND deleted_at IS NULL', [id])
    if (!row) return c.json({ error: 'Not found' }, 404)
    if (status === 'completed') {
      // Mark all order items as fully arrived so metrics are consistent
      await execute(
        `UPDATE customer_order_items SET arrived_qty=qty, balance=0, status='completed' WHERE order_id=? AND deleted_at IS NULL`,
        [orderId]
      )
      await execute('UPDATE customer_orders SET status=? WHERE id=?', [status, orderId])
    } else {
      // Revert: recompute arrived_qty from actual shipped DNs, then let recalc set order status
      await syncCustomerOrderArrivedFromShippedDns(orderId)
      // If no shipped DNs exist the sync leaves items at 0; honour the user's explicit status choice
      await execute('UPDATE customer_orders SET status=? WHERE id=?', [status, orderId])
    }
    await audit(c.get('user'), 'STATUS_CHANGE', '客戶訂單', id, `${row.po_number}: ${row.status} → ${status}`)
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
    // Upsert items: UPDATE existing (preserve arrived_qty etc.), INSERT new, soft-delete removed
    const submittedIds = new Set<number>()
    if (b.items?.length) {
      for (const item of b.items) {
        if (!item.bom_id) continue
        if (item.id) {
          // Existing item: update only editable fields, preserve arrival/settlement data
          await execute(
            `UPDATE customer_order_items SET bom_id=?,qty=?,unit_price=?,rta_date=?,po_no=?,remark=?,balance=GREATEST(0,qty-arrived_qty) WHERE id=? AND order_id=? AND deleted_at IS NULL`,
            [item.bom_id, item.qty||0, item.unit_price||0, item.rta_date||null, item.po_no||'', item.remark||'', item.id, id]
          )
          submittedIds.add(Number(item.id))
        } else {
          // New item
          const result: any = await execute(
            'INSERT INTO customer_order_items (order_id,bom_id,qty,unit_price,rta_date,po_no,remark,arrived_qty,balance,status) VALUES (?,?,?,?,?,?,?,?,?,?)',
            [id, item.bom_id, item.qty||0, item.unit_price||0, item.rta_date||null, item.po_no||'', item.remark||'', 0, item.qty||0, 'pending']
          )
          if (result?.insertId) submittedIds.add(Number(result.insertId))
        }
      }
    }
    // Soft-delete items that were removed by the user
    const dbItems = await query<any>('SELECT id FROM customer_order_items WHERE order_id=? AND deleted_at IS NULL', [id])
    for (const row of dbItems) {
      if (!submittedIds.has(Number(row.id))) {
        await softDeleteById('customer_order_items', row.id, u?.userId)
      }
    }
    await recalcCustomerOrderStatus([Number(id)])
    await audit(u, 'UPDATE', '客戶訂單', id, existing.po_number)
    return c.json({ ok: true })
  } catch (e: any) { return c.json({ error: String(e.message) }, 500) }
})
app.delete('/api/customer-orders/:id', authMiddleware, requirePerm('customer_order.delete'), async c => {
  try {
    const id = c.req.param('id')
    const row = await queryOne<any>(`
      SELECT co.po_number, ${liveFirst('NULLIF(c.customer_name, \'\')', 'NULLIF(co.customer_name, \'\')', '\'\'')} as customer_name
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
             COALESCE(c.customer_name, co.customer_name) as customer_name, c.customer_code
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
      WHERE ci.order_id IN (${idPlaceholders}) AND ci.deleted_at IS NULL
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
             ${liveFirst('NULLIF(c.customer_name, \'\')', 'NULLIF(co.customer_name, \'\')', '\'\'')} as customer_name,
             c.customer_code
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
      WHERE ci.order_id=? AND ci.deleted_at IS NULL
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
      WHERE ci.order_id=? AND ci.deleted_at IS NULL
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
    LEFT JOIN materials m
      ON qi.material_id IS NOT NULL
      AND qi.material_id > 0
      AND qi.material_id = m.id
      AND m.deleted_at IS NULL
    WHERE qi.quotation_id=? AND qi.deleted_at IS NULL
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
    const createdAt = now8()
    const issueDate = toDateStr(createdAt)
    const validUntil = b.valid_until ? toDateStr(b.valid_until) : addMonthsDateStr(issueDate, 6)
    const r = await execute('INSERT INTO quotations (quotation_number,customer_id,customer_name,status,total_amount,currency,valid_until,remark,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
      [qNum,b.customer_id||null,b.customer_name,'draft',total,b.currency||'VND',validUntil,b.remark||'',u.userId,createdAt])
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
    if (!['draft', 'pending_review'].includes(existing.status)) return c.json({ error: '只能編輯草稿或待審核狀態的報價單' }, 400)
    const total = (b.items||[]).reduce((s: number, i: any) => s + (i.total_price||0), 0)
    await execute('UPDATE quotations SET customer_id=?,customer_name=?,currency=?,valid_until=?,remark=?,total_amount=? WHERE id=?',
      [b.customer_id||null, b.customer_name, b.currency||'VND', b.valid_until||null, b.remark||'', total, id])
    await softDeleteByWhere('quotation_items', 'quotation_id=?', [id], u?.userId)
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
app.patch('/api/quotations/:id/status', authMiddleware, async c => {
  try {
    const id = c.req.param('id'); const { status } = await c.req.json(); const user = c.get('user')
    const validStatuses = ['pending_review', 'approved', 'sent', 'accepted', 'rejected', 'draft']
    if (!validStatuses.includes(status)) return c.json({ error: 'Invalid status' }, 400)
    const row = await queryOne<any>('SELECT quotation_number,customer_name,status,total_amount,currency FROM quotations WHERE id=? AND deleted_at IS NULL', [id])
    if (!row) return c.json({ error: 'Not found' }, 404)

    if (status === 'pending_review') {
      // 任何有 create 權限的人可以提交審核，只有 draft 可以提交
      if (!await hasPermission(user, 'customer_order.create')) return c.json({ error: '無此操作權限（customer_order.create）' }, 403)
      if (row.status !== 'draft') return c.json({ error: '只有草稿狀態的報價單才能提交審核' }, 400)
    } else if (status === 'approved') {
      if (!await hasPermission(user, 'quotation.approve')) return c.json({ error: '無此操作權限（quotation.approve）' }, 403)
      if (row.status !== 'pending_review') return c.json({ error: '只有待審核狀態的報價單才能審核通過' }, 400)
    } else if (status === 'sent') {
      if (!await hasPermission(user, 'customer_order.create')) return c.json({ error: '無此操作權限（customer_order.create）' }, 403)
      if (row.status !== 'approved') return c.json({ error: '只有已審核的報價單才能送出' }, 400)
    } else {
      if (!await hasPermission(user, 'customer_order.create')) return c.json({ error: '無此操作權限（customer_order.create）' }, 403)
      if (row.status !== 'sent') return c.json({ error: '只有已送出的報價單才能更新結果' }, 400)
    }

    await execute('UPDATE quotations SET status=? WHERE id=?', [status, id])
    await audit(user, 'STATUS_CHANGE', '報價單', id, `${row?.quotation_number} ${row?.status} → ${status}`)

    // 提交審核時發通知郵件（非阻塞）
    if (status === 'pending_review') {
      ;(async () => {
        try {
          const co = await queryOne<any>('SELECT notification_email FROM company_settings WHERE id=1')
          const notifyEmail = co?.notification_email?.trim()
          if (notifyEmail) {
            const { subject, html } = buildPendingApprovalEmail({
              type: '報價單',
              number: row.quotation_number,
              name: row.customer_name,
              createdBy: user.username || user.email || String(user.userId),
              amount: row.total_amount,
              currency: row.currency || 'VND',
            })
            await sendNotificationEmail({ to: notifyEmail, subject, html })
          }
        } catch {}
      })()
    }

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
      where.push('(COALESCE(po_links.po_numbers, dp.order_po_number, \'\') LIKE ? OR dp.customer_name LIKE ? OR dp.progress_no LIKE ?)')
      const term = `%${search}%`
      params.push(term, term, term)
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
      WHERE ${where.join(' AND ')}
      ORDER BY dp.created_at DESC, dp.id DESC
      LIMIT ${pageSize} OFFSET ${offset}
    `, params)
    const progressIds = uniqueNumberList(rows.map((row: any) => row.id))
    const rawItems = progressIds.length
      ? await query<any>(
          `SELECT *
           FROM delivery_progress_items
           WHERE deleted_at IS NULL
             AND progress_id IN (${progressIds.map(() => '?').join(',')})
           ORDER BY id ASC`,
          progressIds,
        )
      : []
    const normalizedItems = await enrichDeliveryProgressItems(rawItems)
    const itemGroups = new Map<number, any[]>()
    for (const item of normalizedItems) {
      const progressId = Number(item.progress_id || 0)
      if (!itemGroups.has(progressId)) itemGroups.set(progressId, [])
      itemGroups.get(progressId)?.push(item)
    }

    return c.json(rows.map((row: any) => {
      const progressItems = itemGroups.get(Number(row.id || 0)) || []
      const itemNames = Array.from(new Set(progressItems.map((item) => String(item.display_name || '').trim()).filter(Boolean)))
      const itemPoNumbers = uniquePoNumbers(progressItems.map((item) => item.order_po_number))
      const plannedQty = progressItems.reduce((sum, item) => sum + toQty(item.planned_qty), 0)
      const purchasedQty = progressItems.reduce((sum, item) => sum + toQty(item.purchased_qty), 0)
      const purchaseGapQty = progressItems.reduce((sum, item) => sum + toQty(item.purchase_gap_qty), 0)
      const dueDates = progressItems.map((item) => item.due_date).filter(Boolean)
      const fallbackPoCount = uniquePoNumbers([row.po_number]).length
      const fallbackOrderCount = Number(row.customer_order_id || 0) > 0 ? 1 : 0
      return {
        ...row,
        material_name: itemNames.join(', '),
        po_number: itemPoNumbers.join(', ') || String(row.po_number || '').trim(),
        material_code: '',
        spec: '',
        unit: '',
        planned_qty: toQty(plannedQty),
        purchased_qty: toQty(purchasedQty),
        purchase_gap_qty: toQty(purchaseGapQty),
        linked_po_count: Math.max(Number(row.linked_po_count || 0), fallbackPoCount),
        order_count: Math.max(Number(row.order_count || 0), fallbackOrderCount),
        item_count: progressItems.length,
        due_date: dueDates.length ? dueDates.sort()[0] : null,
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
    SELECT *
    FROM delivery_progress_items
    WHERE progress_id=? AND deleted_at IS NULL
    ORDER BY id ASC
  `, [id])
  const poNumbers = uniquePoNumbers(poLinks.map((it) => it.order_po_number).concat(row.order_po_number ? [row.order_po_number] : []))
  const customerOrderIds = uniqueNumberList(poLinks.map((it) => it.customer_order_id))
  const normalizedItems = await enrichDeliveryProgressItems(items)
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
    await ensureDeliveryNoteProgressIdColumn()
    const b = await c.req.json()
    const u = c.get('user')
    if (!await hasPermission(u, 'po.create')) return c.json({ error: '無此操作權限（po.create）' }, 403)
    const customerOrderIds: number[] = Array.isArray(b?.customer_order_ids)
      ? Array.from(new Set<number>(b.customer_order_ids.map((it: any) => Number(it)).filter((it: number) => Number.isFinite(it) && it > 0)))
      : []
    let customerId: number | null = b?.customer_id ? Number(b.customer_id) : null
    let customerName = String(b?.customer_name || '').trim()
    const itemsInput = Array.isArray(b?.items) ? b.items : []
    const items = itemsInput
      .map((item: any) => ({
        line_type: normalizeProgressItemLineType(item?.line_type || (item?.bom_id ? 'bom' : 'material')),
        customer_order_id: item?.customer_order_id == null ? null : Number(item.customer_order_id) || null,
        order_item_id: item?.order_item_id == null ? null : Number(item.order_item_id) || null,
        order_po_number: String(item?.order_po_number || '').trim(),
        customer_po_number: String(item?.customer_po_number || '').trim(),
        bom_id: item?.bom_id == null ? null : Number(item.bom_id) || null,
        bom_code: String(item?.bom_code || '').trim(),
        bom_name: String(item?.bom_name || '').trim(),
        material_id: item?.material_id == null ? null : Number(item.material_id) || null,
        material_code: String(item?.material_code || item?.material_name || '').trim(),
        material_name: String(item?.material_name || '').trim(),
        spec: String(item?.spec || '').trim(),
        unit: String(item?.unit || 'PCS').trim() || 'PCS',
        planned_qty: toQty(item?.planned_qty),
        due_date: item?.due_date || null,
        status: ['pending', 'partial', 'completed'].includes(String(item?.status || '')) ? String(item?.status) : 'pending',
        remark: String(item?.remark || '').trim(),
      }))
      .filter((item: any) => item.planned_qty > 0 && (
        (item.line_type === 'bom' && item.bom_id && item.order_item_id)
        || (item.line_type !== 'bom' && item.material_name)
      ))
    let poNumbers = uniquePoNumbers(items.map((item: any) => item.order_po_number))

    if (!items.length) return c.json({ error: 'items required' }, 400)
    const itemLinkedOrderIds = uniqueNumberList(items.map((item: any) => item.customer_order_id))
    const mergedCustomerOrderIds = uniqueNumberList([...customerOrderIds, ...itemLinkedOrderIds])
    if (!customerName && customerId) {
      const cust = await queryOne<any>('SELECT customer_name FROM customers WHERE id=? AND deleted_at IS NULL', [customerId])
      customerName = String(cust?.customer_name || '')
    }
    if (!customerName) return c.json({ error: 'customer_name 必填' }, 400)

    if (mergedCustomerOrderIds.length) {
      const linkedOrders = await query<any>(
        `SELECT id, po_number, customer_id FROM customer_orders WHERE id IN (${mergedCustomerOrderIds.map(() => '?').join(',')}) AND deleted_at IS NULL`,
        mergedCustomerOrderIds,
      )
      if (linkedOrders.length !== mergedCustomerOrderIds.length) return c.json({ error: '部分客戶訂單不存在' }, 400)
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
    const firstDisplayCode = firstItem.line_type === 'bom' ? (firstItem.bom_code || firstItem.material_code || '') : (firstItem.material_code || '')
    const firstDisplayName = firstItem.line_type === 'bom' ? (firstItem.bom_name || firstItem.material_name || '') : (firstItem.material_name || '')
    const result = await withTransaction(async (tx) => {
      const r = await execute(`
        INSERT INTO delivery_progress
          (progress_no, customer_id, customer_name, customer_order_id, order_item_id, order_po_number, delivery_location, material_code, material_name, spec, unit, planned_qty, due_date, status, remark, created_by, created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `, [
        progressNo,
        customerId,
        customerName,
        mergedCustomerOrderIds[0] || null,
        null,
        firstItem.order_po_number || poNumbers[0] || '',
        '',
        firstDisplayCode,
        firstDisplayName,
        firstItem.line_type === 'bom' ? '' : (firstItem.spec || ''),
        firstItem.unit || 'PCS',
        items.reduce((sum: number, item: any) => sum + toQty(item.planned_qty), 0),
        firstItem.due_date ? toDateStr(firstItem.due_date) : null,
        'pending',
        String(b?.remark || ''),
        u?.userId || null,
        now8(),
      ], tx)
      await syncDeliveryProgressPoLinks(
        r.insertId,
        mergedCustomerOrderIds,
        poNumbers,
        u?.userId || null,
        tx,
      )
      await syncDeliveryProgressItems(r.insertId, items, u?.userId || null, tx)
      const deliveryNote = await syncDeliveryNoteFromProgress(r.insertId, u, tx)
      const poResult = await generatePurchaseOrdersFromProgress(r.insertId, u, {}, tx)
      await audit(u, 'CREATE', '交期進度', r.insertId, `${progressNo} / ${customerName}`, tx)
      return {
        id: r.insertId,
        progress_no: progressNo,
        dn_id: deliveryNote?.id || null,
        dn_number: deliveryNote?.dn_number || null,
        po_created: poResult.created,
        po_count: poResult.count,
      }
    })
    return c.json(result, 201)
  } catch (e: any) {
    const message = String(e.message)
    return c.json({ error: message }, businessErrorStatus(message))
  }
})

app.put('/api/order-intake/:id', authMiddleware, requirePerm('customer_order.create'), async c => {
  try {
    await ensureDeliveryNoteProgressIdColumn()
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
        id: item?.id == null ? null : Number(item.id) || null,
        line_type: normalizeProgressItemLineType(item?.line_type || (item?.bom_id ? 'bom' : 'material')),
        customer_order_id: item?.customer_order_id == null ? null : Number(item.customer_order_id) || null,
        order_item_id: item?.order_item_id == null ? null : Number(item.order_item_id) || null,
        order_po_number: String(item?.order_po_number || '').trim(),
        customer_po_number: String(item?.customer_po_number || '').trim(),
        bom_id: item?.bom_id == null ? null : Number(item.bom_id) || null,
        bom_code: String(item?.bom_code || '').trim(),
        bom_name: String(item?.bom_name || '').trim(),
        material_id: item?.material_id == null ? null : Number(item.material_id) || null,
        material_code: String(item?.material_code || item?.material_name || '').trim(),
        material_name: String(item?.material_name || '').trim(),
        spec: String(item?.spec || '').trim(),
        unit: String(item?.unit || 'PCS').trim() || 'PCS',
        planned_qty: toQty(item?.planned_qty),
        due_date: item?.due_date || null,
        status: ['pending', 'partial', 'completed'].includes(String(item?.status || '')) ? String(item?.status) : 'pending',
        remark: String(item?.remark || '').trim(),
      }))
      .filter((item: any) => item.planned_qty > 0 && (
        (item.line_type === 'bom' && item.bom_id && item.order_item_id)
        || (item.line_type !== 'bom' && item.material_name)
      ))
    const poNumbers = uniquePoNumbers(items.map((item: any) => item.order_po_number))
    if (!items.length) return c.json({ error: 'items required' }, 400)
    const mergedCustomerOrderIds = uniqueNumberList([...customerOrderIds, ...items.map((item: any) => item.customer_order_id)])
    const firstItem = items[0]
    const firstDisplayCode = firstItem.line_type === 'bom' ? (firstItem.bom_code || firstItem.material_code || '') : (firstItem.material_code || '')
    const firstDisplayName = firstItem.line_type === 'bom' ? (firstItem.bom_name || firstItem.material_name || '') : (firstItem.material_name || '')
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
      firstDisplayName,
      firstItem.line_type === 'bom' ? '' : (firstItem.spec || ''),
      firstItem.unit || 'PCS',
      '',
      id,
    ])
    await syncDeliveryProgressPoLinks(Number(id), mergedCustomerOrderIds, poNumbers, c.get('user')?.userId || null)
    await syncDeliveryProgressItems(Number(id), items, c.get('user')?.userId || null)
    await syncDeliveryNoteFromProgress(Number(id), c.get('user'))
    await audit(c.get('user'), 'UPDATE', '交期進度', id, `id=${id}`)
    return c.json({ ok: true })
  } catch (e: any) {
    const message = String(e.message)
    return c.json({ error: message }, businessErrorStatus(message))
  }
})

app.delete('/api/order-intake/:id', authMiddleware, requirePerm('customer_order.delete'), async c => {
  await ensureDeliveryNoteProgressIdColumn()
  const id = c.req.param('id')
  const userId = c.get('user')?.userId || null
  const row = await queryOne<any>('SELECT progress_no, customer_name FROM delivery_progress WHERE id=? AND deleted_at IS NULL', [id])
  if (!row) return c.json({ error: 'Not found' }, 404)
  await softDeleteById('delivery_progress', id, userId)
  await execute('UPDATE delivery_progress_po_links SET deleted_at=?, deleted_by=? WHERE progress_id=? AND deleted_at IS NULL', [now8(), userId, id])
  await execute('UPDATE delivery_progress_items SET deleted_at=?, deleted_by=? WHERE progress_id=? AND deleted_at IS NULL', [now8(), userId, id])
  await execute(
    `UPDATE delivery_notes
     SET deleted_at=?, deleted_by=?
     WHERE progress_id=? AND status='draft' AND deleted_at IS NULL`,
    [now8(), userId, id],
  )
  await audit(c.get('user'), 'DELETE', '交期進度', id, `${row?.progress_no} / ${row?.customer_name}`)
  return c.json({ ok: true })
})

const generatePurchaseOrdersFromProgress = async (
  progressId: string | number,
  user: any,
  payload: any = {},
  db?: DbExecutor,
) => {
  const id = String(progressId)
  const progress = await queryOne<any>(`
    SELECT *
    FROM delivery_progress
    WHERE id=? AND deleted_at IS NULL
  `, [id], db)
  if (!progress) throw new Error('交期進度不存在')

  const progressItemsRaw = await query<any>(`
    SELECT *
    FROM delivery_progress_items
    WHERE progress_id=? AND deleted_at IS NULL
    ORDER BY id ASC
  `, [id], db)
  const progressItems = await enrichDeliveryProgressItems(progressItemsRaw, db)
  if (!progressItems.length) throw new Error('交期進度明細不存在')

  const poBaseNumber = String(payload?.po_number_base || '').trim()
  const poRefs = await query<any>(
    'SELECT order_po_number FROM delivery_progress_po_links WHERE progress_id=? AND deleted_at IS NULL ORDER BY id ASC',
    [id],
    db,
  )
  const poRef = uniquePoNumbers(poRefs.map((it) => it.order_po_number).concat(progress.order_po_number ? [progress.order_po_number] : [])).join(', ') || String(progress.progress_no || '')
  const grouped = new Map<string, { supplierId: number | null; supplierName: string; items: any[] }>()
  const snapshotPurchasedMap = await loadPurchasedQtyByProgressItemMaterialIds(
    uniqueNumberList(progressItems.flatMap((item: any) => (item.material_snapshots || []).map((snapshot: any) => snapshot.id))),
    db,
  )

  for (const item of progressItems) {
    if (normalizeProgressItemLineType(item.line_type) === 'bom') {
      const linePlannedQty = toQty(item.planned_qty)
      if (linePlannedQty <= 0) continue
      for (const snapshot of item.material_snapshots || []) {
        const bomUnitQty = toQty(snapshot.bom_unit_qty)
        if (bomUnitQty <= 0) continue
        const requiredQty = toQty(linePlannedQty * bomUnitQty)
        const purchasedQty = toQty(snapshotPurchasedMap.get(Number(snapshot.id || 0)) || 0)
        const remainingQty = toQty(Math.max(0, requiredQty - purchasedQty))
        if (remainingQty <= 0) continue
        const materialId = await resolveMaterialId(snapshot.material_id, snapshot.material_code, db)
        const material = materialId ? await queryOne<any>(`
          SELECT
            m.id,
            m.supplier_id,
            COALESCE(ms.name, m.supplier_name, '') as supplier_name,
            m.supplier_price,
            m.company_price
          FROM materials m
          LEFT JOIN suppliers ms ON ms.id = m.supplier_id AND ms.deleted_at IS NULL
          WHERE m.id=? AND m.deleted_at IS NULL
          LIMIT 1
        `, [materialId], db) : null
        const supplierId = material?.supplier_id ? Number(material.supplier_id) : (Number(snapshot.supplier_id || 0) || null)
        const supplierName = String(material?.supplier_name || snapshot.supplier_name || '待分配供應商')
        const unitPrice = toMoney(material?.supplier_price || material?.company_price || 0)
        const key = `${supplierId || 0}::${supplierName}`
        const group = grouped.get(key) || { supplierId, supplierName, items: [] }
        group.items.push({
          progressItemId: Number(item.id),
          progressItemMaterialId: Number(snapshot.id || 0) || null,
          materialId,
          materialCode: String(snapshot.material_code || ''),
          materialName: String(snapshot.material_name || ''),
          spec: String(snapshot.spec || ''),
          unit: String(snapshot.unit || 'PCS') || 'PCS',
          quantity: remainingQty,
          unitPrice,
          totalPrice: toMoney(remainingQty * unitPrice),
        })
        grouped.set(key, group)
      }
      continue
    }

    const plannedQty = toQty(item.planned_qty)
    const purchasedQty = toQty(item.purchased_qty)
    const remainingQty = toQty(Math.max(0, plannedQty - purchasedQty))
    if (remainingQty <= 0) continue

    const materialId = await resolveMaterialId(item.material_id, item.material_code, db)
    const material = materialId ? await queryOne<any>(`
      SELECT
        m.id,
        m.supplier_id,
        COALESCE(ms.name, m.supplier_name, '') as supplier_name,
        m.supplier_price,
        m.company_price
      FROM materials m
      LEFT JOIN suppliers ms ON ms.id = m.supplier_id AND ms.deleted_at IS NULL
      WHERE m.id=? AND m.deleted_at IS NULL
      LIMIT 1
    `, [materialId], db) : null
    const supplierId = material?.supplier_id ? Number(material.supplier_id) : null
    const supplierName = String(material?.supplier_name || '待分配供應商')
    const unitPrice = toMoney(material?.supplier_price || material?.company_price || 0)
    const key = `${supplierId || 0}::${supplierName}`
    const group = grouped.get(key) || { supplierId, supplierName, items: [] }
    group.items.push({
      progressItemId: Number(item.id),
      progressItemMaterialId: null,
      materialId,
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

  if (!grouped.size) throw new Error(`進度 ${progress.progress_no} 已採購完成`)

  const created: Array<{ id: number; po_number: string; supplier_name: string }> = []
  let seq = 1
  for (const group of grouped.values()) {
    const poNum = grouped.size > 1
      ? `${poBaseNumber || `PO${Date.now()}`}-${String(seq).padStart(2, '0')}`
      : (poBaseNumber || `PO${Date.now()}`)
    seq += 1
    const duplicated = await queryOne<any>('SELECT id FROM purchase_orders WHERE po_number=? AND deleted_at IS NULL', [poNum], db)
    if (duplicated) throw new Error(`採購單號「${poNum}」已存在，請更換編號`)
    const taxRate = 8
    const totalPrice = toMoney(group.items.reduce((sum, item) => sum + toMoney(item.totalPrice), 0))
    const total = toMoney(totalPrice * (1 + taxRate / 100))
    const remark = `由交期進度自動生成，來源 ${progress.progress_no}`
    const r = await execute(
      'INSERT INTO purchase_orders (po_number,supplier_id,supplier_name,status,total_amount,tax_rate,currency,created_by,remark,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
      [poNum, group.supplierId, group.supplierName, 'draft', total, taxRate, 'VND', user.userId, remark, now8()],
      db,
    )
    const poId = r.insertId
    for (const item of group.items) {
      await execute(
        'INSERT INTO po_items (po_id,progress_id,progress_item_id,progress_item_material_id,material_id,material_code,material_name,spec,unit,quantity,unit_price,total_price,currency,remark,po_ref,thickness) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        [poId, id, item.progressItemId, item.progressItemMaterialId, item.materialId, item.materialCode, item.materialName, item.spec, item.unit, item.quantity, item.unitPrice, item.totalPrice, 'VND', remark, poRef, null],
        db,
      )
    }
    created.push({ id: poId, po_number: poNum, supplier_name: group.supplierName })
    await audit(user, 'CREATE', '採購單', poId, `${poNum} ← ${progress.progress_no}`, db)
  }

  return { created, count: created.length }
}

app.post('/api/order-intake/:id/generate-po', authMiddleware, requirePerm('po.create'), async c => {
  try {
    let payload: any = {}
    try { payload = await c.req.json() } catch { payload = {} }
    const result = await generatePurchaseOrdersFromProgress(c.req.param('id'), c.get('user'), payload)
    return c.json(result, 201)
  } catch (e: any) {
    const message = String(e.message)
    const status = message.includes('不存在')
      ? 404
      : (message.includes('已採購完成') || message.includes('已存在'))
        ? 409
        : 500
    return c.json({ error: message }, status)
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

/**
 * A reconciliation is an immutable record of a completed shipment, not a
 * second approval gate. Create the header and every line atomically so a
 * duplicate/invalid line can never leave an empty header behind.
 */
const createShipmentReconciliationRecord = async (deliveryNoteId: number, user: any, db?: DbExecutor) => {
  const createRecord = async (tx: DbExecutor) => {
    const deliveryNote = await queryOne<any>(`
      SELECT id, dn_number, delivery_date
      FROM delivery_notes
      WHERE id=? AND status='shipped' AND deleted_at IS NULL
      FOR UPDATE
    `, [deliveryNoteId], tx)
    if (!deliveryNote) throw new Error('已出貨單不存在')

    const sources = await query<any>(`
      SELECT
        dni.id as delivery_note_item_id,
        dni.order_item_id,
        dn.id as delivery_note_id,
        dn.customer_order_id,
        dni.po_ref,
        COALESCE(NULLIF(TRIM(dni.po_ref), ''), co.po_number) as po_number,
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
      LEFT JOIN materials m ON dni.material_id=m.id AND m.deleted_at IS NULL
      LEFT JOIN (
        SELECT product_sku, MAX(NULLIF(product_name, '')) as product_name, MAX(supplier_id) as supplier_id
        FROM bom
        WHERE deleted_at IS NULL
        GROUP BY product_sku
      ) b ON b.product_sku=dni.material_code
      LEFT JOIN suppliers ms ON ms.id=m.supplier_id AND ms.deleted_at IS NULL
      LEFT JOIN suppliers s ON s.id=b.supplier_id AND s.deleted_at IS NULL
      WHERE dni.dn_id=? AND dni.deleted_at IS NULL AND sri.id IS NULL
      ORDER BY dni.id ASC
      FOR UPDATE
    `, [deliveryNoteId], tx)

    // Idempotent: a repeated request for an already-recorded shipment is OK.
    if (!sources.length) return null

    const reconciliationNo = `RC${Date.now()}`
    const createdAt = now8()
    const header = await execute(`
      INSERT INTO shipment_reconciliations
        (reconciliation_no, reconcile_date, status, remark, created_by, confirmed_by, confirmed_at, created_at)
      VALUES (?,?,?,?,?,?,?,?)
    `, [
      reconciliationNo,
      deliveryNote.delivery_date ? toDateStr(deliveryNote.delivery_date) : null,
      'confirmed',
      `系統依出貨單 ${deliveryNote.dn_number || deliveryNoteId} 自動建立`,
      user?.userId || null,
      user?.userId || null,
      createdAt,
      createdAt,
    ], tx)

    const orderItemIdMap = await buildOrderItemIdMap(sources.map((src: any) => ({
      customer_order_id: Number(src.customer_order_id || 0),
      material_code: String(src.material_code || ''),
    })), tx)

    for (const src of sources) {
      const resolvedFromProgress = String(src.po_ref || '').trim()
        ? await resolveOrderItemIdFromProgress(Number(src.delivery_note_item_id), tx)
        : null
      const orderItemId = resolvedFromProgress
        || Number(src.order_item_id || 0)
        || orderItemIdMap.get(`${Number(src.customer_order_id || 0)}::${String(src.material_code || '').trim()}`)
        || null
      if (resolvedFromProgress && resolvedFromProgress !== Number(src.order_item_id || 0)) {
        await execute('UPDATE delivery_note_items SET order_item_id=? WHERE id=?', [resolvedFromProgress, src.delivery_note_item_id], tx)
      }
      const shippedQty = toQty(src.shipped_qty)
      await execute(`
        INSERT INTO shipment_reconciliation_items
          (reconciliation_id, delivery_note_id, delivery_note_item_id, customer_order_id, order_item_id, po_number,
           material_code, material_name, supplier_id, supplier_name, unit, shipped_qty, accepted_qty,
           difference_qty, difference_reason, created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `, [
        header.insertId, src.delivery_note_id, src.delivery_note_item_id, src.customer_order_id || null,
        orderItemId, src.po_number || '', src.material_code || '', src.material_name || '',
        src.supplier_id || null, src.supplier_name || '', src.unit || 'PCS', shippedQty, shippedQty,
        0, '', createdAt,
      ], tx)
    }

    await audit(user, 'CREATE', '出貨核對紀錄', header.insertId, `${reconciliationNo} / ${deliveryNote.dn_number}`, tx)
    return { id: header.insertId, reconciliation_no: reconciliationNo }
  }
  return db ? createRecord(db) : withTransaction(createRecord)
}

app.get('/api/reconciliations/pending-items', authMiddleware, async c => {
  try {
    const page = parsePositiveInt(c.req.query('page'), 1, 1000000)
    const pageSize = parsePositiveInt(c.req.query('page_size'), 200, 1000)
    const offset = (page - 1) * pageSize
    const rows = await query<any>(`
      SELECT
        dni.id as delivery_note_item_id,
        dni.order_item_id,
        dn.id as delivery_note_id,
        dn.dn_number,
        dn.delivery_date,
        dn.customer_order_id,
        dni.po_ref,
        COALESCE(NULLIF(TRIM(dni.po_ref), ''), co.po_number) as po_number,
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
      LEFT JOIN materials m
        ON dni.material_id IS NOT NULL
        AND dni.material_id > 0
        AND dni.material_id = m.id
        AND m.deleted_at IS NULL
      WHERE dn.status = 'shipped'
        AND dn.deleted_at IS NULL
        AND dni.deleted_at IS NULL
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
      const progressOrderItemId = String(row.po_ref || '').trim()
        ? await resolveOrderItemIdFromProgress(Number(row.delivery_note_item_id))
        : null
      const orderItemId = progressOrderItemId
        || Number(row.order_item_id || 0)
        || orderItemIdMap.get(key)
        || null
      if (progressOrderItemId && progressOrderItemId !== Number(row.order_item_id || 0)) {
        await execute(
          'UPDATE delivery_note_items SET order_item_id=? WHERE id=?',
          [progressOrderItemId, row.delivery_note_item_id]
        )
      }
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
    HAVING COUNT(sri.id) > 0
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
  let reconciliationId = 0
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
    const createdAt = now8()
    const r = await execute(`
      INSERT INTO shipment_reconciliations
        (reconciliation_no, reconcile_date, status, remark, created_by, confirmed_by, confirmed_at, created_at)
      VALUES (?,?,?,?,?,?,?,?)
    `, [
      reconciliationNo, reconcileDate, 'confirmed', b.remark || '', c.get('user')?.userId || null,
      c.get('user')?.userId || null, createdAt, createdAt,
    ])
    reconciliationId = r.insertId

    const placeholders = deliveryNoteItemIds.map(() => '?').join(',')
    const sources = await query<any>(`
      SELECT
        dni.id as delivery_note_item_id,
        dni.order_item_id,
        dn.id as delivery_note_id,
        dn.customer_order_id,
        dni.po_ref,
        COALESCE(NULLIF(TRIM(dni.po_ref), ''), co.po_number) as po_number,
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
      LEFT JOIN materials m
        ON dni.material_id IS NOT NULL
        AND dni.material_id > 0
        AND dni.material_id = m.id
        AND m.deleted_at IS NULL
      LEFT JOIN (
        SELECT product_sku, MAX(NULLIF(product_name, '')) as product_name, MAX(supplier_id) as supplier_id
        FROM bom
        WHERE deleted_at IS NULL
        GROUP BY product_sku
      ) b ON b.product_sku = dni.material_code
      LEFT JOIN suppliers ms ON ms.id = m.supplier_id AND ms.deleted_at IS NULL
      LEFT JOIN suppliers s ON s.id = b.supplier_id AND s.deleted_at IS NULL
      WHERE dni.id IN (${placeholders})
        AND dn.status = 'shipped'
        AND dn.deleted_at IS NULL
        AND dni.deleted_at IS NULL
        AND sri.id IS NULL
    `, deliveryNoteItemIds)
    const sourceMap = new Map<number, any>()
    for (const src of sources) {
      // Repair historical multi-PO lines before creating the reconciliation.
      // A line-level PO reference is more precise than the delivery-note header.
      const resolvedFromProgress = String(src.po_ref || '').trim()
        ? await resolveOrderItemIdFromProgress(Number(src.delivery_note_item_id))
        : null
      if (resolvedFromProgress && resolvedFromProgress !== Number(src.order_item_id || 0)) {
        src.order_item_id = resolvedFromProgress
        await execute('UPDATE delivery_note_items SET order_item_id=? WHERE id=?', [resolvedFromProgress, src.delivery_note_item_id])
      }
      sourceMap.set(Number(src.delivery_note_item_id), src)
    }
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
      const orderItemId = Number(src.order_item_id || 0)
        || orderItemIdMap.get(`${Number(src.customer_order_id || 0)}::${String(src.material_code || '').trim()}`)
        || null

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
    // Legacy/manual callers must not be able to leave an orphan header when a
    // selected delivery line was already recorded concurrently.
    if (reconciliationId > 0) {
      await softDeleteById('shipment_reconciliations', reconciliationId, c.get('user')?.userId).catch(() => {})
    }
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

app.patch('/api/reconciliations/:id/confirm', authMiddleware, requirePerm('reconciliation.approve'), async c => {
  try {
    const id = c.req.param('id')
    const u = c.get('user')
    const header = await queryOne<any>('SELECT id, status, reconciliation_no FROM shipment_reconciliations WHERE id=? AND deleted_at IS NULL', [id])
    if (!header) return c.json({ error: 'Not found' }, 404)
    if (header.status !== 'draft') return c.json({ ok: true })
    const itemCount = await queryOne<any>(
      'SELECT COUNT(*) as cnt FROM shipment_reconciliation_items WHERE reconciliation_id=? AND deleted_at IS NULL',
      [id]
    )
    if (Number(itemCount?.cnt || 0) <= 0) return c.json({ error: '核對紀錄沒有出貨明細，請刪除此異常紀錄' }, 400)

    // Legacy compatibility only: old drafts can be marked as recorded, but this
    // endpoint no longer mutates order quantities. Shipment is the sole source.
    await execute(
      'UPDATE shipment_reconciliations SET status=?, confirmed_by=?, confirmed_at=? WHERE id=?',
      ['confirmed', u?.userId || null, now8(), id]
    )
    await audit(u, 'STATUS_CHANGE', '出貨核對紀錄', id, `${header.reconciliation_no || `id=${id}`}: ${header.status} → confirmed`)
    return c.json({ ok: true })
  } catch (e: any) {
    return c.json({ error: String(e.message) }, 500)
  }
})

app.delete('/api/reconciliations/:id', authMiddleware, requirePerm('delivery.create'), async c => {
  try {
    const id = Number(c.req.param('id') || 0)
    await deleteReconciliationWithRollback(id, c.get('user'))
    return c.json({ ok: true })
  } catch (e: any) {
    const msg = String(e.message || 'delete failed')
    if (msg === 'Not found') return c.json({ error: 'Not found' }, 404)
    if (msg.includes('請先刪除關聯發票')) return c.json({ error: msg }, 400)
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

const markDeletedByWhere = async (table: string, whereSql: string, params: any[], userId?: number | null) =>
  softDeleteByWhere(table, whereSql, params, userId)

const deleteInvoiceWithRollback = async (invoiceId: number, user: any) => {
  const header = await queryOne<any>(
    'SELECT id, invoice_no, status, invoice_type FROM invoice_headers WHERE id=? AND deleted_at IS NULL',
    [invoiceId]
  )
  if (!header) throw new Error('Not found')

  const items = await query<any>(
    'SELECT id, order_item_id, qty FROM invoice_items WHERE invoice_id=? AND deleted_at IS NULL',
    [invoiceId]
  )

  if (header.status === 'confirmed' && header.invoice_type === 'customer') {
    const settleMap = new Map<number, number>()
    for (const item of items) {
      const orderItemId = Number(item.order_item_id || 0)
      const qty = toQty(item.qty)
      if (!orderItemId || qty <= 0) continue
      settleMap.set(orderItemId, toQty((settleMap.get(orderItemId) || 0) + qty))
    }

    for (const [orderItemId, qty] of settleMap.entries()) {
      await execute(
        'UPDATE customer_order_items SET settled_qty = GREATEST(0, COALESCE(settled_qty, 0) - ?) WHERE id=?',
        [qty, orderItemId]
      )
    }
  }

  await markDeletedByWhere('invoice_items', 'invoice_id=?', [invoiceId], user?.userId)
  await softDeleteById('invoice_headers', invoiceId, user?.userId)
  await audit(user, 'DELETE', header.invoice_type === 'supplier' ? '供應商發票' : '客戶發票', invoiceId, header.invoice_no)
}

const deleteReconciliationWithRollback = async (reconciliationId: number, user: any) => {
  const header = await queryOne<any>(
    'SELECT id, status, reconciliation_no FROM shipment_reconciliations WHERE id=? AND deleted_at IS NULL',
    [reconciliationId]
  )
  if (!header) throw new Error('Not found')

  const linkedInvoices = await query<any>(`
    SELECT DISTINCT ih.invoice_no
    FROM invoice_items ii
    JOIN invoice_headers ih ON ih.id = ii.invoice_id
    WHERE ii.reconciliation_id=?
      AND ii.deleted_at IS NULL
      AND ih.deleted_at IS NULL
    LIMIT 5
  `, [reconciliationId])
  if (linkedInvoices.length) {
    throw new Error(`請先刪除關聯發票：${linkedInvoices.map((r: any) => r.invoice_no).join('、')}`)
  }

  // 核對單只是出貨事實的投影。刪除投影不可反向改變出貨單或客戶訂單數量。
  await markDeletedByWhere('shipment_reconciliation_items', 'reconciliation_id=?', [reconciliationId], user?.userId)
  await softDeleteById('shipment_reconciliations', reconciliationId, user?.userId)
  await audit(user, 'DELETE', '出貨核對單', reconciliationId, header.reconciliation_no || `id=${reconciliationId}`)
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
      LEFT JOIN customer_order_items ci ON ci.id = sri.order_item_id AND ci.deleted_at IS NULL
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

app.patch('/api/invoices/:id/confirm', authMiddleware, requirePerm('invoice.approve'), async c => {
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
    await audit(u, 'CONFIRM', header.invoice_type === 'supplier' ? '供應商發票' : '客戶發票', id, `${header.invoice_no || `id=${id}`}: ${header.status} → confirmed`)
    return c.json({ ok: true })
  } catch (e: any) {
    return c.json({ error: String(e.message) }, 500)
  }
})

app.delete('/api/invoices/:id', authMiddleware, requirePerm('customer_order.create'), async c => {
  try {
    const id = Number(c.req.param('id') || 0)
    await deleteInvoiceWithRollback(id, c.get('user'))
    return c.json({ ok: true })
  } catch (e: any) {
    if (String(e.message) === 'Not found') return c.json({ error: 'Not found' }, 404)
    return c.json({ error: String(e.message) }, 500)
  }
})

// ── Delivery Notes ────────────────────────────────────────────────────────────
app.get('/api/delivery-notes', authMiddleware, async c => {
  await ensureDeliveryNoteProgressIdColumn()
  return c.json(await query(`
    SELECT dn.*, COALESCE(c.customer_name, dn.customer_name) as customer_name, c.customer_code,
           COALESCE(progress_links.po_numbers, co.po_number, '') as order_po_number
    FROM delivery_notes dn 
    LEFT JOIN customers c ON dn.customer_id = c.id AND c.deleted_at IS NULL
    LEFT JOIN customer_orders co ON dn.customer_order_id = co.id AND co.deleted_at IS NULL
    LEFT JOIN (
      SELECT progress_id, GROUP_CONCAT(DISTINCT order_po_number ORDER BY order_po_number SEPARATOR ', ') as po_numbers
      FROM delivery_progress_po_links
      WHERE deleted_at IS NULL
      GROUP BY progress_id
    ) progress_links ON progress_links.progress_id = dn.progress_id
    WHERE dn.deleted_at IS NULL
    ORDER BY dn.created_at DESC
  `))
})
app.get('/api/delivery-notes/:id', authMiddleware, async c => {
  await ensureDeliveryNoteProgressIdColumn()
  const dn = await queryOne<any>(`
    SELECT dn.*, COALESCE(c.customer_name, dn.customer_name) as customer_name, c.customer_code, c.address,
           COALESCE(progress_links.po_numbers, co.po_number, '') as po_ref
    FROM delivery_notes dn 
    LEFT JOIN customers c ON dn.customer_id = c.id AND c.deleted_at IS NULL
    LEFT JOIN customer_orders co ON dn.customer_order_id = co.id AND co.deleted_at IS NULL
    LEFT JOIN (
      SELECT progress_id, GROUP_CONCAT(DISTINCT order_po_number ORDER BY order_po_number SEPARATOR ', ') as po_numbers
      FROM delivery_progress_po_links
      WHERE deleted_at IS NULL
      GROUP BY progress_id
    ) progress_links ON progress_links.progress_id = dn.progress_id
    WHERE dn.id=? AND dn.deleted_at IS NULL`, [c.req.param('id')])
  if (!dn) return c.json({ error: 'Not found' }, 404)
  const items = await query(`
    SELECT dni.*, 
           COALESCE(NULLIF(m.material_name,''), NULLIF(dni.item_name,''), b.product_name, '') as item_name,
           COALESCE(NULLIF(m.spec,''), NULLIF(dni.spec,''), b.spec) as spec,
           COALESCE(NULLIF(m.unit,''), NULLIF(dni.unit,''), b.unit, 'PCS') as unit
    FROM delivery_note_items dni
    LEFT JOIN materials m
      ON dni.material_id IS NOT NULL
      AND dni.material_id > 0
      AND dni.material_id = m.id
      AND m.deleted_at IS NULL
    LEFT JOIN (
      SELECT bom.product_sku,
             MAX(NULLIF(bom.product_name, '')) as product_name,
             COALESCE(MAX(NULLIF(bom.spec, '')), GROUP_CONCAT(DISTINCT NULLIF(bi.spec, '') SEPARATOR ', ')) as spec,
             COALESCE(MAX(NULLIF(bom.unit, '')), MAX(NULLIF(bi.unit, ''))) as unit
      FROM bom
      LEFT JOIN bom_items bi ON bom.id = bi.bom_id
      WHERE bom.deleted_at IS NULL AND (bi.deleted_at IS NULL OR bi.id IS NULL)
      GROUP BY bom.product_sku
    ) b ON dni.material_code = b.product_sku
    WHERE dni.dn_id=? AND dni.deleted_at IS NULL`, [c.req.param('id')])
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
        const orderItemId = Number(item.order_item_id || 0) || null
        await execute('INSERT INTO delivery_note_items (dn_id,order_item_id,material_id,item_name,material_code,spec,unit,qty,remark,po_ref,thickness) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
          [dnId, orderItemId, materialId, item.item_name||'', item.material_code||'', item.spec||'', item.unit||'PCS', item.qty||0, item.remark||'', item.po_ref||'', item.thickness||null])
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
    // 在 softDelete 前先保存舊 items 的 order_item_id（按 material_code 建立映射）
    const oldItems = await query<any>(
      'SELECT material_code, order_item_id FROM delivery_note_items WHERE dn_id=? AND deleted_at IS NULL AND order_item_id IS NOT NULL AND order_item_id > 0',
      [id]
    )
    const oldOrderItemIdByCode = new Map<string, number>()
    for (const oi of oldItems) {
      if (oi.material_code && oi.order_item_id) oldOrderItemIdByCode.set(String(oi.material_code), Number(oi.order_item_id))
    }
    await softDeleteByWhere('delivery_note_items', 'dn_id=?', [id], u?.userId)
    if (b.items?.length) {
      const dnRow = await queryOne<any>('SELECT customer_order_id FROM delivery_notes WHERE id=? AND deleted_at IS NULL', [id])
      const customerOrderId = Number(dnRow?.customer_order_id || 0)
      for (const item of b.items) {
        const materialId = await resolveMaterialId(item.material_id, item.material_code)
        let orderItemId = Number(item.order_item_id || 0) || null
        if (!orderItemId && item.material_code) {
          // 嘗試從舊 items 中按 material_code 找回
          orderItemId = oldOrderItemIdByCode.get(String(item.material_code)) || null
        }
        if (!orderItemId && customerOrderId > 0) {
          // 嘗試自動解析
          orderItemId = await resolveOrderItemIdForDnLine(customerOrderId, { materialCode: item.material_code, itemName: item.item_name }) || null
        }
        await execute('INSERT INTO delivery_note_items (dn_id,order_item_id,material_id,item_name,material_code,spec,unit,qty,remark,po_ref,thickness) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
          [id, orderItemId, materialId, item.item_name||'', item.material_code||'', item.spec||'', item.unit||'PCS', item.qty||0, item.remark||'', item.po_ref||'', item.thickness||null])
      }
    }
    await audit(u, 'UPDATE', '出貨單', id, `id=${id}`)
    return c.json({ ok: true })
  } catch (e: any) { return c.json({ error: String(e.message) }, 500) }
})
app.patch('/api/delivery-notes/:id/status', authMiddleware, async c => {
  try {
    const id = Number(c.req.param('id') || 0); const { status } = await c.req.json()
    const u = c.get('user')
    if (!id || !status) return c.json({ error: 'Invalid status' }, 400)
    const requiredPerm =
      status === 'confirmed' ? 'delivery.approve'
      : status === 'shipped' ? 'delivery.create'
      : null
    if (!requiredPerm) return c.json({ error: 'Invalid status' }, 400)
    if (!await hasPermission(u, requiredPerm)) return c.json({ error: `無此操作權限（${requiredPerm}）` }, 403)
    const result = await withTransaction(async (tx) => {
      const row = await queryOne<any>(`
        SELECT dn_number, customer_name, customer_order_id, progress_id, status as current_status
        FROM delivery_notes
        WHERE id=? AND deleted_at IS NULL
        FOR UPDATE
      `, [id], tx)
      if (!row) throw new Error('DN_NOT_FOUND')

      const { idempotent: isRepeatedRequest } = validateDeliveryStatusTransition(String(row.current_status), String(status))

      if (!isRepeatedRequest) {
        await execute('UPDATE delivery_notes SET status=? WHERE id=?', [status, id], tx)
      }

      // Shipping, order quantity synchronization and reconciliation projection
      // form one atomic operation. A repeated shipped request safely repairs a
      // historical half-completed record without double-counting quantities.
      if (status === 'shipped') {
        const customerOrderId = Number(row.customer_order_id || 0)
        if (customerOrderId > 0) {
          await syncCustomerOrderArrivedFromShippedDns(customerOrderId, tx)
        }
        const dniRows = await query<any>(
          'SELECT id, order_item_id, material_code, item_name FROM delivery_note_items WHERE dn_id=? AND deleted_at IS NULL',
          [id],
          tx,
        )
        const extraOrderIds = new Set<number>()
        for (const dni of dniRows) {
          let orderItemId = Number(dni.order_item_id || 0)
          const resolvedFromProgress = await resolveOrderItemIdFromProgress(Number(dni.id), tx)
          if (resolvedFromProgress && resolvedFromProgress !== orderItemId) {
            orderItemId = resolvedFromProgress
            await execute('UPDATE delivery_note_items SET order_item_id=? WHERE id=?', [orderItemId, dni.id], tx)
          } else if (!orderItemId) {
            orderItemId = (await resolveOrderItemIdForDnLine(customerOrderId, {
              materialCode: dni.material_code,
              itemName: dni.item_name,
            }, tx)) || 0
            if (orderItemId) {
              await execute('UPDATE delivery_note_items SET order_item_id=? WHERE id=?', [orderItemId, dni.id], tx)
            }
          }
          if (!orderItemId) continue
          const oi = await queryOne<any>('SELECT order_id FROM customer_order_items WHERE id=? AND deleted_at IS NULL', [orderItemId], tx)
          const orderId = Number(oi?.order_id || 0)
          if (orderId > 0 && orderId !== customerOrderId) extraOrderIds.add(orderId)
        }
        if (extraOrderIds.size > 0) {
          const shippedMap = await buildShippedQtyByOrderItemId(tx)
          await applyShippedQtyToOrderItems(shippedMap, Array.from(extraOrderIds), tx)
        }
        await createShipmentReconciliationRecord(id, u, tx)
        const progressId = Number(row.progress_id || 0)
        if (progressId > 0) {
          await execute(
            "UPDATE delivery_progress SET status='completed' WHERE id=? AND deleted_at IS NULL",
            [progressId],
            tx,
          )
          await execute(
            "UPDATE delivery_progress_items SET status='completed' WHERE progress_id=? AND deleted_at IS NULL",
            [progressId],
            tx,
          )
        }
      }

      await audit(
        u,
        isRepeatedRequest ? 'STATUS_REPAIR' : 'STATUS_CHANGE',
        '出貨單',
        id,
        `${row.dn_number}: ${row.current_status} → ${status}${isRepeatedRequest ? '（重複請求，已修復關聯資料）' : ''}`,
        tx,
      )
      return { idempotent: isRepeatedRequest }
    })
    return c.json({ ok: true, ...result })
  } catch (e: any) {
    const message = String(e.message || '')
    if (message === 'DN_NOT_FOUND') return c.json({ error: 'Not found' }, 404)
    if (message === 'INVALID_CONFIRM_TRANSITION') return c.json({ error: '只有草稿出貨單可以審核' }, 400)
    if (message === 'INVALID_SHIP_TRANSITION') return c.json({ error: '出貨前需先審核出貨單' }, 400)
    return c.json({ error: message }, 500)
  }
})
app.delete('/api/delivery-notes/:id', authMiddleware, requirePerm('delivery.delete'), async c => {
  const id = c.req.param('id')
  const row = await queryOne<any>('SELECT dn_number,customer_name,customer_order_id FROM delivery_notes WHERE id=? AND deleted_at IS NULL', [id])
  if (!row) return c.json({ error: 'Not found' }, 404)

  // Collect all affected customer order IDs before deletion
  const affectedOrderIds = new Set<number>()
  if (Number(row.customer_order_id) > 0) affectedOrderIds.add(Number(row.customer_order_id))
  const dniRows = await query<any>(
    `SELECT ci.order_id FROM delivery_note_items dni
     JOIN customer_order_items ci ON ci.id = dni.order_item_id AND ci.deleted_at IS NULL
     WHERE dni.dn_id=? AND dni.deleted_at IS NULL AND dni.order_item_id IS NOT NULL AND dni.order_item_id > 0`,
    [id]
  )
  for (const r of dniRows) if (Number(r.order_id) > 0) affectedOrderIds.add(Number(r.order_id))

  await softDeleteById('delivery_notes', id, c.get('user')?.userId)

  // Re-sync arrived_qty for all affected orders
  for (const orderId of affectedOrderIds) {
    await syncCustomerOrderArrivedFromShippedDns(orderId)
  }

  await audit(c.get('user'), 'DELETE', '出貨單', id, `${row?.dn_number} / ${row?.customer_name}`)
  return c.json({ ok: true })
})

// ── Delivery Sheets (送貨單) ────────────────────────────────────────────────
app.get('/api/delivery-sheets', authMiddleware, async c => c.json(await query(`
  SELECT ds.*, COALESCE(c.customer_name, ds.customer_name) as customer_name, c.customer_code,
         co.po_number as order_po_number
  FROM delivery_sheets ds
  LEFT JOIN customers c ON ds.customer_id = c.id AND c.deleted_at IS NULL
  LEFT JOIN customer_orders co ON ds.customer_order_id = co.id AND co.deleted_at IS NULL
  WHERE ds.deleted_at IS NULL
  ORDER BY ds.created_at DESC
`)))
app.get('/api/delivery-sheets/:id', authMiddleware, async c => {
  const ds = await queryOne<any>(`
    SELECT ds.*, COALESCE(c.customer_name, ds.customer_name) as customer_name, c.customer_code, c.address,
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
    LEFT JOIN materials m
      ON dsi.material_id IS NOT NULL
      AND dsi.material_id > 0
      AND dsi.material_id = m.id
      AND m.deleted_at IS NULL
    LEFT JOIN (
      SELECT bom.id, bom.product_sku, bom.product_name,
             COALESCE(bom.spec, GROUP_CONCAT(DISTINCT bi.spec SEPARATOR ', ')) as spec,
             COALESCE(bom.unit, MAX(bi.unit)) as unit
      FROM bom
      LEFT JOIN bom_items bi ON bom.id = bi.bom_id
      WHERE bi.deleted_at IS NULL
      GROUP BY bom.id, bom.product_sku, bom.product_name
    ) b ON dsi.material_code = b.product_sku
    WHERE dsi.ds_id=? AND dsi.deleted_at IS NULL`, [c.req.param('id')])
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
    await softDeleteByWhere('delivery_sheet_items', 'ds_id=?', [id], u?.userId)
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
         b.category, ${liveFirst('NULLIF(s.name, \'\')', 'NULLIF(b.supplier_name, \'\')', '\'\'')} as supplier_name, b.currency, b.image_url
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
         ${liveFirst('NULLIF(s.name, \'\')', 'NULLIF(b.supplier_name, \'\')', '\'\'')} as supplier_name, b.currency,
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
    const u = c.get('user')
    const { role, permission, allowed } = await c.req.json()
    if (role !== 'employee') return c.json({ error: 'Only employee role can be modified' }, 400)
    await execute('INSERT INTO role_permissions (role,permission,allowed) VALUES (?,?,?) ON DUPLICATE KEY UPDATE allowed=?', ['employee',permission,allowed?1:0,allowed?1:0])
    await audit(u, 'UPDATE', '權限設定', permission, `員工權限「${permission}」${allowed ? '啟用' : '停用'}`)
    return c.json({ ok: true })
  } catch (e: any) { return c.json({ error: String(e.message) }, 500) }
})

// ── Audit Logs ────────────────────────────────────────────────────────────────
app.get('/api/audit-logs', authMiddleware, requireManager, async c => {
  try {
    const url = new URL(c.req.url)
    const parsedLimit = Number.parseInt(url.searchParams.get('limit') || '20', 10)
    const parsedOffset = Number.parseInt(url.searchParams.get('offset') || '0', 10)
    const limit = Math.min(Math.max(Number.isFinite(parsedLimit) ? parsedLimit : 20, 1), 100)
    const offset = Math.max(Number.isFinite(parsedOffset) ? parsedOffset : 0, 0)
    const resource = (url.searchParams.get('resource') || '').trim()
    const action = (url.searchParams.get('action') || '').trim()
    const userEmail = (url.searchParams.get('user_email') || '').trim()
    const search = (url.searchParams.get('search') || '').trim()
    const dateFrom = (url.searchParams.get('date_from') || '').trim()
    const dateTo = (url.searchParams.get('date_to') || '').trim()
    const params: any[] = []
    const where: string[] = []
    if (resource) { where.push('resource=?'); params.push(resource) }
    if (action) { where.push('action=?'); params.push(action) }
    if (userEmail) { where.push('user_email LIKE ?'); params.push(`%${userEmail}%`) }
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateFrom)) { where.push('created_at >= ?'); params.push(`${dateFrom} 00:00:00`) }
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateTo)) { where.push('created_at <= ?'); params.push(`${dateTo} 23:59:59`) }
    if (search) {
      const value = `%${search}%`
      where.push('(user_name LIKE ? OR user_email LIKE ? OR action LIKE ? OR resource LIKE ? OR resource_id LIKE ? OR detail LIKE ?)')
      params.push(value, value, value, value, value, value)
    }
    const whereClause = where.length ? ' WHERE ' + where.join(' AND ') : ''
    // Embed LIMIT/OFFSET directly to avoid mysql2 prepared statement issues
    const sql = `SELECT * FROM audit_logs${whereClause} ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`
    const countSql = `SELECT COUNT(*) as cnt FROM audit_logs${whereClause}`
    const [logs, totalRow, resourceRows, actionRows] = await Promise.all([
      query(sql, params),
      queryOne<any>(countSql, params),
      query<any>('SELECT DISTINCT resource FROM audit_logs WHERE resource IS NOT NULL AND resource <> \'\' ORDER BY resource'),
      query<any>('SELECT DISTINCT action FROM audit_logs WHERE action IS NOT NULL AND action <> \'\' ORDER BY action'),
    ])
    return c.json({
      logs,
      total: totalRow?.cnt || 0,
      options: {
        resources: resourceRows.map((row: any) => row.resource),
        actions: actionRows.map((row: any) => row.action),
      },
    })
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
        COALESCE(c.customer_name, ih.party_name) as customer_name,
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
      LEFT JOIN customers c ON c.id = ih.party_id AND c.deleted_at IS NULL
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
        COALESCE(c.customer_name, ih.party_name) as customer_name,
        ih.invoice_date,
        ih.grand_total as invoice_amount,
        ih.received_amount,
        ih.payment_status,
        ih.payment_date,
        ih.payment_note
      FROM invoice_headers ih
      LEFT JOIN customers c ON c.id = ih.party_id AND c.deleted_at IS NULL
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
        COALESCE(s.name, ih.party_name) as supplier_name,
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
      LEFT JOIN suppliers s ON s.id = ih.party_id AND s.deleted_at IS NULL
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
app.delete('/api/payables/:id', authMiddleware, requirePerm('customer_order.create'), async c => {
  try {
    const id = Number(c.req.param('id') || 0)
    const row = await queryOne<any>(
      'SELECT id FROM invoice_headers WHERE id=? AND invoice_type=\'supplier\' AND status=\'confirmed\' AND deleted_at IS NULL',
      [id]
    )
    if (!row) return c.json({ error: 'Not found' }, 404)
    await deleteInvoiceWithRollback(id, c.get('user'))
    return c.json({ ok: true })
  } catch (e: any) {
    return c.json({ error: String(e.message) }, 500)
  }
})

app.get('/api/payables/export/csv', authMiddleware, async c => {
  try {
    const rows = await query<any>(`
      SELECT
        ih.invoice_no,
        COALESCE(s.name, ih.party_name) as supplier_name,
        ih.invoice_date,
        ih.grand_total as payable_amount,
        ih.paid_amount,
        ih.payment_status,
        ih.payment_date,
        ih.payment_note
      FROM invoice_headers ih
      LEFT JOIN suppliers s ON s.id = ih.party_id AND s.deleted_at IS NULL
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
          AND dni.deleted_at IS NULL
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

app.get('/api/daily-patrol-report', authMiddleware, async c => {
  try {
    const user = c.get('user')
    if (!user) return c.json({ error: 'Unauthorized' }, 401)
    const report = await buildDailyPatrolReport()
    return c.json(report)
  } catch (e: any) {
    return c.json({ error: String(e.message) }, 500)
  }
})

// ── Goods Receipts (進貨單) ───────────────────────────────────────────────────
app.get('/api/goods-receipts', authMiddleware, async c => {
  const rows = await query(`
    SELECT gr.*, COALESCE(s.name, gr.supplier_name) as supplier_name, s.supplier_code
    FROM goods_receipts gr LEFT JOIN suppliers s ON gr.supplier_id = s.id AND s.deleted_at IS NULL
    WHERE gr.deleted_at IS NULL
    ORDER BY gr.created_at DESC`)
  return c.json(rows)
})
app.get('/api/goods-receipts/:id', authMiddleware, async c => {
  const gr = await queryOne<any>(`
    SELECT gr.*, COALESCE(s.name, gr.supplier_name) as supplier_name
    FROM goods_receipts gr LEFT JOIN suppliers s ON gr.supplier_id = s.id AND s.deleted_at IS NULL
    WHERE gr.id=? AND gr.deleted_at IS NULL`, [c.req.param('id')])
  if (!gr) return c.json({ error: 'Not found' }, 404)
  const items = await query(`
    SELECT gri.*,
           COALESCE(NULLIF(m.material_name,''), NULLIF(gri.material_name,''), b.product_name, '') as material_name,
           COALESCE(NULLIF(m.spec,''), NULLIF(gri.spec,''), b.spec) as spec,
           COALESCE(NULLIF(m.unit,''), NULLIF(gri.unit,''), b.unit, 'PCS') as unit
    FROM goods_receipt_items gri
    LEFT JOIN materials m
      ON gri.material_id IS NOT NULL
      AND gri.material_id > 0
      AND gri.material_id = m.id
      AND m.deleted_at IS NULL
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
app.patch('/api/goods-receipts/:id/confirm', authMiddleware, requirePerm('goods_receipt.approve'), async c => {
  try {
    const id = c.req.param('id'); const u = c.get('user')
    const gr = await queryOne<any>('SELECT * FROM goods_receipts WHERE id=? AND deleted_at IS NULL', [id])
    if (!gr) return c.json({ error: 'Not found' }, 404)
    if (gr.status === 'confirmed') return c.json({ error: 'Already confirmed' }, 400)
    const items = await query<any>('SELECT * FROM goods_receipt_items WHERE gr_id=? AND deleted_at IS NULL', [id])
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
    await audit(u, 'CONFIRM', '進貨單', id, `${gr.gr_number}: ${gr.status} → confirmed`)
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
    const bomItems = await query<any>('SELECT * FROM bom_items WHERE bom_id=? AND deleted_at IS NULL', [bom_id])
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
  const materials = await query('SELECT * FROM production_materials WHERE prod_id=? AND deleted_at IS NULL', [c.req.param('id')])
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
      await softDeleteByWhere('production_materials', 'prod_id=?', [id], u?.userId)
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
      const mats = await query<any>('SELECT * FROM production_materials WHERE prod_id=? AND deleted_at IS NULL', [id])
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
    await audit(u, 'STATUS_CHANGE', '生產單', id, `${prod.prod_number}: ${prod.status} → ${status}`)
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
  const items = await query('SELECT * FROM stock_adjustment_items WHERE adj_id=? AND deleted_at IS NULL', [c.req.param('id')])
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
app.patch('/api/stock-adjustments/:id/approve', authMiddleware, requirePerm('stock.approve'), async c => {
  try {
    const id = c.req.param('id'); const u = c.get('user')
    const adj = await queryOne<any>('SELECT * FROM stock_adjustments WHERE id=? AND deleted_at IS NULL', [id])
    if (!adj) return c.json({ error: 'Not found' }, 404)
    if (adj.status === 'approved') return c.json({ error: 'Already approved' }, 400)
    const items = await query<any>('SELECT * FROM stock_adjustment_items WHERE adj_id=? AND deleted_at IS NULL', [id])
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
    await audit(u, 'APPROVE', '庫存調整', id, `${adj.adj_number}: ${adj.status} → approved`)
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
app.get('/api/company', async c => {
  try {
    await ensureCompanySignatureColumn()
    await ensureCompanySignaturePrintColumns()
    await ensureCompanyNotificationEmail()
    const row = await queryOne<any>('SELECT * FROM company_settings WHERE id=1')
    if (!row) {
      return c.json({
        id: 1,
        company_name: 'KUNYI CO., LTD',
        company_name_local: 'CÔNG TY TNHH KUNYI VIỆT NAM',
        address: '',
        phone: '',
        contact_person: '',
        email: '',
        tax_id: '',
        logo_url: null,
        signature_url: null,
        signature_print_width: 220,
        signature_print_height: 72,
        notification_email: '',
      })
    }
    return c.json(row)
  } catch (e: any) { return c.json({ error: String(e.message) }, 500) }
})
app.put('/api/company', authMiddleware, requireManager, async c => {
  try {
    await ensureCompanySignatureColumn()
    await ensureCompanySignaturePrintColumns()
    await ensureCompanyNotificationEmail()
    const b = await c.req.json(); const u = c.get('user')
    const signaturePrintWidth = Math.max(120, Math.min(320, Number(b.signature_print_width) || 220))
    const signaturePrintHeight = Math.max(48, Math.min(140, Number(b.signature_print_height) || 72))
    const notificationEmail = String(b.notification_email || '').trim()
    // Upsert
    await execute(`INSERT INTO company_settings (id,company_name,company_name_local,address,phone,contact_person,email,tax_id,logo_url,signature_url,signature_print_width,signature_print_height,notification_email)
      VALUES (1,?,?,?,?,?,?,?,?,?,?,?,?)
      ON DUPLICATE KEY UPDATE company_name=?,company_name_local=?,address=?,phone=?,contact_person=?,email=?,tax_id=?,logo_url=?,signature_url=?,signature_print_width=?,signature_print_height=?,notification_email=?`,
      [b.company_name,b.company_name_local||'',b.address||'',b.phone||'',b.contact_person||'',b.email||'',b.tax_id||'',b.logo_url||null,b.signature_url||null,signaturePrintWidth,signaturePrintHeight,notificationEmail,
       b.company_name,b.company_name_local||'',b.address||'',b.phone||'',b.contact_person||'',b.email||'',b.tax_id||'',b.logo_url||null,b.signature_url||null,signaturePrintWidth,signaturePrintHeight,notificationEmail])
    await audit(u, 'UPDATE', '公司設定', 1, b.company_name)
    return c.json({ ok: true })
  } catch (e: any) { return c.json({ error: String(e.message) }, 500) }
})

// ── Stats ─────────────────────────────────────────────────────────────────────
app.get('/api/stats', authMiddleware, async c => {
  try {
    const now = new Date()
    const monthStart = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-01`
    const [materials, suppliers, customers, po, poTotalsByCurrency, orders, progress, deliveryNotes, reconciliations, monthOrders, allSales, lowStock] = await Promise.all([
      queryOne<any>('SELECT COUNT(*) as cnt FROM bom WHERE deleted_at IS NULL'),
      queryOne<any>('SELECT COUNT(*) as cnt FROM suppliers WHERE deleted_at IS NULL'),
      queryOne<any>('SELECT COUNT(*) as cnt FROM customers WHERE deleted_at IS NULL'),
      queryOne<any>("SELECT COUNT(*) as cnt FROM purchase_orders WHERE status IN ('approved','sent','received') AND deleted_at IS NULL"),
      query<any>(`
        SELECT COALESCE(NULLIF(TRIM(currency), ''), 'VND') as currency, COALESCE(SUM(total_amount), 0) as total
        FROM purchase_orders
        WHERE status IN ('approved','sent','received') AND deleted_at IS NULL
        GROUP BY COALESCE(NULLIF(TRIM(currency), ''), 'VND')
        ORDER BY currency ASC
      `),
      queryOne<any>('SELECT COUNT(*) as cnt FROM customer_orders WHERE deleted_at IS NULL'),
      queryOne<any>("SELECT COUNT(*) as cnt FROM delivery_progress WHERE deleted_at IS NULL AND status IN ('pending','partial','completed')"),
      queryOne<any>('SELECT COUNT(*) as cnt FROM delivery_notes WHERE deleted_at IS NULL'),
      queryOne<any>(`
        SELECT COUNT(*) as cnt
        FROM shipment_reconciliations sr
        WHERE sr.deleted_at IS NULL
          AND EXISTS (
            SELECT 1 FROM shipment_reconciliation_items sri
            WHERE sri.reconciliation_id=sr.id AND sri.deleted_at IS NULL
          )
      `),
      queryOne<any>('SELECT COUNT(DISTINCT co.id) as cnt, COALESCE(SUM(ci.qty*ci.unit_price),0) as total FROM customer_orders co JOIN customer_order_items ci ON ci.order_id=co.id WHERE co.deleted_at IS NULL AND ci.deleted_at IS NULL AND co.po_date>=?', [monthStart]),
      queryOne<any>('SELECT COALESCE(SUM(ci.qty*ci.unit_price),0) as total, MIN(co.po_date) as earliest, MAX(co.po_date) as latest FROM customer_orders co JOIN customer_order_items ci ON ci.order_id=co.id WHERE co.deleted_at IS NULL AND ci.deleted_at IS NULL'),
      queryOne<any>('SELECT COUNT(*) as cnt FROM bom WHERE deleted_at IS NULL AND COALESCE(current_stock,0) <= 0'),
    ])
    const normalizedPoTotals = poTotalsByCurrency.map((row: any) => ({
      currency: String(row.currency || 'VND'),
      total: toMoney(row.total || 0),
    }))
    return c.json({
      materials: materials?.cnt||0, suppliers: suppliers?.cnt||0, customers: customers?.cnt||0,
      po_count: po?.cnt||0,
      po_total: normalizedPoTotals.length === 1 ? normalizedPoTotals[0].total : 0,
      po_totals_by_currency: normalizedPoTotals,
      orders_count: orders?.cnt||0,
      progress_count: progress?.cnt||0,
      delivery_count: deliveryNotes?.cnt||0,
      reconciliation_count: reconciliations?.cnt||0,
      month_orders: monthOrders?.cnt||0, month_sales: monthOrders?.total||0,
      total_sales: allSales?.total||0,
      sales_date_range: allSales?.earliest ? `${allSales.earliest} ~ ${allSales.latest}` : '',
      low_stock_count: lowStock?.cnt||0,
    })
  } catch (e: any) { return c.json({ error: String(e.message) }, 500) }
})

// ── Admin maintenance ─────────────────────────────────────────────────────────
app.post('/api/admin/backfill-order-item-ids', authMiddleware, isAdmin, async c => {
  try {
    const stats = await backfillAllOrderItemIds()
    await audit(c.get('user'), 'BACKFILL', 'order_item_id', 0, JSON.stringify(stats))
    return c.json({ ok: true, stats })
  } catch (e: any) {
    return c.json({ error: String(e.message) }, 500)
  }
})

app.post('/api/admin/fix-completion-rates', authMiddleware, isAdmin, async c => {
  try {
    const orders = await query<any>(
      `SELECT id, status FROM customer_orders WHERE deleted_at IS NULL ORDER BY id`,
      []
    )
    const stats = { total: orders.length, completed: 0, partial: 0, pending_synced: 0, skipped: 0 }

    for (let i = 0; i < orders.length; i++) {
      const { id: orderId, status } = orders[i]

      if (status === 'completed') {
        const preview = await query<any>(
          `SELECT id, qty, arrived_qty FROM customer_order_items WHERE order_id=? AND deleted_at IS NULL`,
          [orderId]
        )
        const toFix = preview.filter((r: any) => toQty(r.arrived_qty) !== toQty(r.qty))
        if (toFix.length > 0) {
          await execute(
            `UPDATE customer_order_items SET arrived_qty=qty, balance=0, status='completed' WHERE order_id=? AND deleted_at IS NULL`,
            [orderId]
          )
          stats.completed++
          console.log(`[fix-completion] completed order ${orderId}: fixed ${toFix.length} items`)
        } else {
          stats.skipped++
        }
      } else if (status === 'partial') {
        await syncCustomerOrderArrivedFromShippedDns(orderId)
        stats.partial++
        console.log(`[fix-completion] partial order ${orderId}: synced from shipped DNs`)
      } else if (status === 'pending') {
        const row = await queryOne<any>(
          `SELECT COALESCE(SUM(arrived_qty),0) as total_arrived FROM customer_order_items WHERE order_id=? AND deleted_at IS NULL`,
          [orderId]
        )
        if (toQty(row?.total_arrived || 0) > 0) {
          await syncCustomerOrderArrivedFromShippedDns(orderId)
          stats.pending_synced++
          console.log(`[fix-completion] pending order ${orderId}: had arrived_qty > 0, synced`)
        } else {
          stats.skipped++
        }
      }

      if ((i + 1) % 10 === 0 || i === orders.length - 1) {
        console.log(`[fix-completion] progress: ${i + 1}/${orders.length}`)
      }
    }

    console.log('[fix-completion] done:', JSON.stringify(stats))
    await audit(c.get('user'), 'FIX', 'completion_rates', 0, JSON.stringify(stats))
    return c.json({ ok: true, ...stats })
  } catch (e: any) {
    return c.json({ error: String(e.message) }, 500)
  }
})

app.post('/api/admin/sync-shipped-arrived-qty', authMiddleware, isAdmin, async c => {
  try {
    const result = await syncAllCustomerOrdersArrivedFromShippedDns()
    await audit(c.get('user'), 'SYNC', 'shipped_arrived_qty', 0, JSON.stringify(result))
    return c.json({ ok: true, ...result })
  } catch (e: any) {
    return c.json({ error: String(e.message) }, 500)
  }
})

app.post('/api/admin/delivery-notes/:id/sync-arrived-qty', authMiddleware, isAdmin, async c => {
  try {
    const deliveryNoteId = Number(c.req.param('id') || 0)
    const deliveryNote = await queryOne<any>(
      `SELECT id, dn_number, status
       FROM delivery_notes
       WHERE id=? AND deleted_at IS NULL`,
      [deliveryNoteId],
    )
    if (!deliveryNote) return c.json({ error: 'Not found' }, 404)
    if (deliveryNote.status !== 'shipped') return c.json({ error: '只能同步已出貨的出貨單' }, 400)

    const lines = await query<any>(
      `SELECT id, order_item_id
       FROM delivery_note_items
       WHERE dn_id=? AND deleted_at IS NULL`,
      [deliveryNoteId],
    )
    const affectedOrderIds = new Set<number>()
    for (const line of lines) {
      let orderItemId = Number(line.order_item_id || 0)
      const resolvedOrderItemId = await resolveOrderItemIdFromProgress(Number(line.id))
      if (resolvedOrderItemId && resolvedOrderItemId !== orderItemId) {
        orderItemId = resolvedOrderItemId
        await execute('UPDATE delivery_note_items SET order_item_id=? WHERE id=?', [orderItemId, line.id])
      }
      if (!orderItemId) continue
      const orderItem = await queryOne<any>(
        'SELECT order_id FROM customer_order_items WHERE id=? AND deleted_at IS NULL',
        [orderItemId],
      )
      const orderId = Number(orderItem?.order_id || 0)
      if (orderId > 0) affectedOrderIds.add(orderId)
    }
    if (!affectedOrderIds.size) return c.json({ error: '出貨單沒有可同步的客戶訂單明細' }, 400)

    const shippedMap = await buildShippedQtyByOrderItemId()
    const updatedOrderIds = await applyShippedQtyToOrderItems(shippedMap, Array.from(affectedOrderIds))
    const result = {
      ok: true,
      delivery_note_id: deliveryNoteId,
      delivery_note_number: deliveryNote.dn_number,
      linked_orders: affectedOrderIds.size,
      updated_orders: updatedOrderIds.length,
    }
    await audit(c.get('user'), 'SYNC', 'delivery_note_arrived_qty', deliveryNoteId, JSON.stringify(result))
    return c.json(result)
  } catch (e: any) {
    return c.json({ error: String(e.message) }, 500)
  }
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
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`✓ Server running at http://localhost:${info.port}`)
  void ensureOrderItemIdBackfill().catch((e) => {
    console.error('[order_item_id backfill] startup failed:', e)
  })
})
