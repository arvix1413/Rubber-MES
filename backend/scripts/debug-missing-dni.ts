import 'dotenv/config'
import pool, { query } from '../src/db.js'

async function main() {
  const rows = await query(`
    SELECT dni.id, dni.material_code, dni.item_name, dn.customer_order_id, dn.dn_number, dn.status, dn.progress_id
    FROM delivery_note_items dni
    JOIN delivery_notes dn ON dn.id = dni.dn_id AND dn.deleted_at IS NULL
    WHERE dni.deleted_at IS NULL AND (dni.order_item_id IS NULL OR dni.order_item_id = 0)
      AND dn.customer_order_id IS NOT NULL
    LIMIT 15
  `)
  console.log(JSON.stringify(rows, null, 2))
  await pool.end()
}

main()
