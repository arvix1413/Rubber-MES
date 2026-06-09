import 'dotenv/config'
import pool, { query } from '../src/db.js'

async function main() {
  const rows = await query(`
    SELECT 'delivery_progress_items' AS tbl, COUNT(*) AS missing FROM delivery_progress_items WHERE deleted_at IS NULL AND (order_item_id IS NULL OR order_item_id = 0) AND customer_order_id IS NOT NULL
    UNION ALL SELECT 'delivery_note_items', COUNT(*) FROM delivery_note_items dni JOIN delivery_notes dn ON dn.id = dni.dn_id AND dn.deleted_at IS NULL WHERE dni.deleted_at IS NULL AND (dni.order_item_id IS NULL OR dni.order_item_id = 0) AND dn.customer_order_id IS NOT NULL
    UNION ALL SELECT 'shipment_reconciliation_items', COUNT(*) FROM shipment_reconciliation_items WHERE deleted_at IS NULL AND (order_item_id IS NULL OR order_item_id = 0) AND customer_order_id IS NOT NULL
    UNION ALL SELECT 'invoice_items', COUNT(*) FROM invoice_items WHERE deleted_at IS NULL AND (order_item_id IS NULL OR order_item_id = 0) AND customer_order_id IS NOT NULL
    UNION ALL SELECT 'delivery_progress', COUNT(*) FROM delivery_progress WHERE deleted_at IS NULL AND (order_item_id IS NULL OR order_item_id = 0) AND customer_order_id IS NOT NULL
  `)
  console.log(rows)
  await pool.end()
}

main()
