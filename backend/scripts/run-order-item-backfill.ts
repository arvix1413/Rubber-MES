/**
 * Run order_item_id backfill + arrived_qty sync directly against DB (no HTTP).
 *
 *   cd backend
 *   DB_HOST=43.160.199.226 DB_PORT=10103 DB_NAME=rubber_db DB_USER=rubber_user DB_PASSWORD=rubber_db_2026 npx tsx scripts/run-order-item-backfill.ts
 */
import 'dotenv/config'
import pool, { execute, query, queryOne } from '../src/db.js'

const toQty = (value: unknown): number => {
  const n = Number(value)
  return Number.isFinite(n) ? Math.max(0, n) : 0
}

const resolveOrderItemIdForDnLine = async (
  customerOrderId: number,
  params: { orderItemId?: number | null; materialCode?: string; itemName?: string; bomId?: number | null },
): Promise<number | null> => {
  const direct = Number(params.orderItemId || 0)
  if (direct > 0) return direct
  const orderId = Number(customerOrderId || 0)
  if (orderId <= 0) return null
  const bomId = Number(params.bomId || 0)
  if (bomId > 0) {
    const byBom = await queryOne<{ id: number }>(`
      SELECT ci.id FROM customer_order_items ci
      WHERE ci.order_id=? AND ci.bom_id=? AND ci.deleted_at IS NULL ORDER BY ci.id LIMIT 1
    `, [orderId, bomId])
    if (byBom?.id) return Number(byBom.id)
  }
  const code = String(params.materialCode || '').trim()
  const name = String(params.itemName || '').trim()
  if (code) {
    const bySku = await queryOne<{ id: number }>(`
      SELECT ci.id FROM customer_order_items ci
      JOIN bom b ON b.id = ci.bom_id AND b.deleted_at IS NULL
      WHERE ci.order_id=? AND ci.deleted_at IS NULL AND TRIM(COALESCE(b.product_sku, '')) = ?
      ORDER BY ci.id LIMIT 1
    `, [orderId, code])
    if (bySku?.id) return Number(bySku.id)
    const byMat = await queryOne<{ id: number }>(`
      SELECT ci.id FROM customer_order_items ci
      JOIN bom_items bi ON bi.bom_id = ci.bom_id AND bi.deleted_at IS NULL
      WHERE ci.order_id=? AND ci.deleted_at IS NULL AND TRIM(COALESCE(bi.material_code, '')) = ?
      ORDER BY ci.id LIMIT 1
    `, [orderId, code])
    if (byMat?.id) return Number(byMat.id)
  }
  if (name) {
    const byName = await queryOne<{ id: number }>(`
      SELECT ci.id FROM customer_order_items ci
      JOIN bom b ON b.id = ci.bom_id AND b.deleted_at IS NULL
      WHERE ci.order_id=? AND ci.deleted_at IS NULL AND TRIM(COALESCE(b.product_name, '')) = ?
      ORDER BY ci.id LIMIT 1
    `, [orderId, name])
    if (byName?.id) return Number(byName.id)
  }
  return null
}

const SQL_UPDATES = [
  `UPDATE delivery_progress_items dpi
    JOIN customer_order_items ci ON ci.order_id = dpi.customer_order_id AND ci.bom_id = dpi.bom_id AND ci.deleted_at IS NULL
    SET dpi.order_item_id = ci.id
    WHERE dpi.deleted_at IS NULL AND (dpi.order_item_id IS NULL OR dpi.order_item_id = 0)
      AND dpi.customer_order_id IS NOT NULL AND dpi.bom_id IS NOT NULL`,
  `UPDATE delivery_note_items dni
    JOIN delivery_notes dn ON dn.id = dni.dn_id AND dn.deleted_at IS NULL AND dn.progress_id IS NOT NULL
    JOIN delivery_progress_items dpi ON dpi.progress_id = dn.progress_id AND dpi.deleted_at IS NULL
      AND dpi.order_item_id IS NOT NULL AND dpi.order_item_id > 0
      AND TRIM(COALESCE(dpi.bom_code, dpi.material_code, '')) = TRIM(COALESCE(dni.material_code, ''))
    SET dni.order_item_id = dpi.order_item_id
    WHERE dni.deleted_at IS NULL AND (dni.order_item_id IS NULL OR dni.order_item_id = 0)`,
  `UPDATE delivery_note_items dni
    JOIN delivery_notes dn ON dn.id = dni.dn_id AND dn.deleted_at IS NULL AND dn.customer_order_id IS NOT NULL
    JOIN customer_order_items ci ON ci.order_id = dn.customer_order_id AND ci.deleted_at IS NULL
    JOIN bom b ON b.id = ci.bom_id AND b.deleted_at IS NULL
    SET dni.order_item_id = ci.id
    WHERE dni.deleted_at IS NULL AND (dni.order_item_id IS NULL OR dni.order_item_id = 0)
      AND TRIM(COALESCE(dni.material_code, '')) <> ''
      AND TRIM(COALESCE(b.product_sku, '')) = TRIM(dni.material_code)`,
  `UPDATE delivery_note_items dni
    JOIN delivery_notes dn ON dn.id = dni.dn_id AND dn.deleted_at IS NULL AND dn.customer_order_id IS NOT NULL
    JOIN customer_order_items ci ON ci.order_id = dn.customer_order_id AND ci.deleted_at IS NULL
    JOIN bom_items bi ON bi.bom_id = ci.bom_id AND bi.deleted_at IS NULL
    SET dni.order_item_id = ci.id
    WHERE dni.deleted_at IS NULL AND (dni.order_item_id IS NULL OR dni.order_item_id = 0)
      AND TRIM(COALESCE(dni.material_code, '')) <> ''
      AND TRIM(COALESCE(bi.material_code, '')) = TRIM(dni.material_code)`,
  `UPDATE shipment_reconciliation_items sri
    JOIN delivery_note_items dni ON dni.id = sri.delivery_note_item_id AND dni.deleted_at IS NULL
    SET sri.order_item_id = dni.order_item_id
    WHERE sri.deleted_at IS NULL AND (sri.order_item_id IS NULL OR sri.order_item_id = 0)
      AND dni.order_item_id IS NOT NULL AND dni.order_item_id > 0`,
  `UPDATE delivery_progress dp
    JOIN (
      SELECT progress_id, MIN(order_item_id) AS order_item_id
      FROM delivery_progress_items
      WHERE deleted_at IS NULL AND order_item_id IS NOT NULL AND order_item_id > 0
      GROUP BY progress_id
    ) linked ON linked.progress_id = dp.id
    SET dp.order_item_id = linked.order_item_id
    WHERE dp.deleted_at IS NULL AND (dp.order_item_id IS NULL OR dp.order_item_id = 0)`,
]

async function runSqlUpdates() {
  for (const sql of SQL_UPDATES) {
    const r = await execute(sql)
    if (r.affectedRows > 0) console.log(`SQL affected ${r.affectedRows}`)
  }
}

async function jsPass() {
  const missing = '(order_item_id IS NULL OR order_item_id = 0)'
  let js = 0

  const dpiRows = await query<any>(`
    SELECT id, customer_order_id, bom_id, bom_code, material_code, material_name, bom_name
    FROM delivery_progress_items
    WHERE deleted_at IS NULL AND ${missing} AND customer_order_id IS NOT NULL
  `)
  for (const row of dpiRows) {
    const resolved = await resolveOrderItemIdForDnLine(Number(row.customer_order_id), {
      bomId: row.bom_id,
      materialCode: row.bom_code || row.material_code,
      itemName: row.bom_name || row.material_name,
    })
    if (resolved) {
      await execute('UPDATE delivery_progress_items SET order_item_id=? WHERE id=?', [resolved, row.id])
      js += 1
    }
  }

  const dniRows = await query<any>(`
    SELECT dni.id, dni.material_code, dni.item_name, dn.customer_order_id
    FROM delivery_note_items dni
    JOIN delivery_notes dn ON dn.id = dni.dn_id AND dn.deleted_at IS NULL
    WHERE dni.deleted_at IS NULL AND ${missing} AND dn.customer_order_id IS NOT NULL
  `)
  for (const row of dniRows) {
    let resolved: number | null = null
    const fromProgress = await queryOne<{ order_item_id: number }>(`
      SELECT dpi.order_item_id
      FROM delivery_note_items dni
      JOIN delivery_notes dn ON dn.id = dni.dn_id AND dn.deleted_at IS NULL AND dn.progress_id IS NOT NULL
      JOIN delivery_progress_items dpi ON dpi.progress_id = dn.progress_id AND dpi.deleted_at IS NULL
        AND dpi.order_item_id IS NOT NULL AND dpi.order_item_id > 0
        AND TRIM(COALESCE(dpi.bom_code, dpi.material_code, '')) = TRIM(COALESCE(dni.material_code, ''))
      WHERE dni.id=? AND dni.deleted_at IS NULL
      ORDER BY dpi.id ASC LIMIT 1
    `, [row.id])
    if (fromProgress?.order_item_id) resolved = Number(fromProgress.order_item_id)
    if (!resolved) {
      resolved = await resolveOrderItemIdForDnLine(Number(row.customer_order_id), {
        materialCode: row.material_code,
        itemName: row.item_name,
      })
    }
    if (resolved) {
      await execute('UPDATE delivery_note_items SET order_item_id=? WHERE id=?', [resolved, row.id])
      js += 1
    }
  }

  for (const table of ['shipment_reconciliation_items', 'invoice_items'] as const) {
    const rows = await query<any>(`
      SELECT id, customer_order_id, material_code, material_name
      FROM ${table}
      WHERE deleted_at IS NULL AND ${missing} AND customer_order_id IS NOT NULL
    `)
    for (const row of rows) {
      const resolved = await resolveOrderItemIdForDnLine(Number(row.customer_order_id), {
        materialCode: row.material_code,
        itemName: row.material_name,
      })
      if (resolved) {
        await execute(`UPDATE ${table} SET order_item_id=? WHERE id=?`, [resolved, row.id])
        js += 1
      }
    }
  }
  console.log(`JS pass updated ${js} rows`)
}

async function resolveFromProgress(dniId: number): Promise<number | null> {
  const row = await queryOne<{ order_item_id: number }>(`
    SELECT dpi.order_item_id
    FROM delivery_note_items dni
    JOIN delivery_notes dn ON dn.id = dni.dn_id AND dn.deleted_at IS NULL AND dn.progress_id IS NOT NULL
    JOIN delivery_progress_items dpi ON dpi.progress_id = dn.progress_id AND dpi.deleted_at IS NULL
      AND dpi.order_item_id IS NOT NULL AND dpi.order_item_id > 0
      AND TRIM(COALESCE(dpi.bom_code, dpi.material_code, '')) = TRIM(COALESCE(dni.material_code, ''))
    WHERE dni.id=? AND dni.deleted_at IS NULL
    ORDER BY dpi.id ASC LIMIT 1
  `, [dniId])
  const id = Number(row?.order_item_id || 0)
  return id > 0 ? id : null
}

/** Aggregate by order_item_id across ALL shipped DNs (multi-order progress). */
async function syncArrivedQty() {
  const shippedBy = new Map<number, number>()
  const dniRows = await query<any>(`
    SELECT dni.id, dni.order_item_id, dni.material_code, dni.item_name, COALESCE(dni.qty, 0) AS qty, dn.customer_order_id
    FROM delivery_note_items dni
    JOIN delivery_notes dn ON dn.id = dni.dn_id AND dn.deleted_at IS NULL
    WHERE dn.status='shipped' AND dni.deleted_at IS NULL
  `)
  for (const row of dniRows) {
    let oid = Number(row.order_item_id || 0)
    if (!oid) {
      oid = (await resolveFromProgress(row.id))
        || (await resolveOrderItemIdForDnLine(Number(row.customer_order_id), { materialCode: row.material_code, itemName: row.item_name }))
        || 0
    }
    if (!oid) continue
    shippedBy.set(oid, toQty((shippedBy.get(oid) || 0) + toQty(row.qty)))
  }

  const touchedOrders = new Set<number>()
  let updated = 0
  for (const [itemId, shippedSum] of shippedBy.entries()) {
    const ci = await queryOne<any>(
      'SELECT id, order_id, qty, COALESCE(arrived_qty,0) AS arrived_qty, COALESCE(reconciled_qty,0) AS reconciled_qty FROM customer_order_items WHERE id=? AND deleted_at IS NULL',
      [itemId],
    )
    if (!ci) continue
    const total = toQty(ci.qty)
    const next = toQty(Math.min(total, Math.max(shippedSum, toQty(ci.reconciled_qty))))
    if (toQty(ci.arrived_qty) === next) continue
    const balance = toQty(Math.max(0, total - next))
    const st = next >= total && total > 0 ? 'completed' : next > 0 ? 'partial' : 'pending'
    await execute('UPDATE customer_order_items SET arrived_qty=?, balance=?, status=? WHERE id=?', [next, balance, st, itemId])
    touchedOrders.add(Number(ci.order_id))
    updated += 1
  }

  for (const orderId of touchedOrders) {
    const sum = await queryOne<{ t: number; a: number }>(
      'SELECT COALESCE(SUM(qty),0) AS t, COALESCE(SUM(arrived_qty),0) AS a FROM customer_order_items WHERE order_id=? AND deleted_at IS NULL',
      [orderId],
    )
    const t = toQty(sum?.t), a = toQty(sum?.a)
    const os = t <= 0 ? 'pending' : a >= t ? 'completed' : a > 0 ? 'partial' : 'pending'
    await execute('UPDATE customer_orders SET status=? WHERE id=? AND deleted_at IS NULL', [os, orderId])
  }
  console.log(`Synced arrived_qty: ${updated} lines updated, ${touchedOrders.size} orders`)
}

async function main() {
  console.log('DB', process.env.DB_HOST, process.env.DB_PORT, process.env.DB_NAME)
  await runSqlUpdates()
  await jsPass()
  await syncArrivedQty()
  await pool.end()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
