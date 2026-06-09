-- Rubber MES: backfill order_item_id on historical rows
-- Run against rubber_db (e.g. mysql -h HOST -P 10103 -u rubber_user -p rubber_db < scripts/backfill-order-item-ids.sql)
-- Safe to re-run (only updates rows where order_item_id IS NULL OR 0)

SET @missing := '(order_item_id IS NULL OR order_item_id = 0)';

-- delivery_progress_items: BOM line by bom_id
UPDATE delivery_progress_items dpi
JOIN customer_order_items ci
  ON ci.order_id = dpi.customer_order_id AND ci.bom_id = dpi.bom_id AND ci.deleted_at IS NULL
SET dpi.order_item_id = ci.id
WHERE dpi.deleted_at IS NULL AND (dpi.order_item_id IS NULL OR dpi.order_item_id = 0)
  AND dpi.customer_order_id IS NOT NULL AND dpi.bom_id IS NOT NULL;

-- delivery_progress_items: BOM code = product_sku
UPDATE delivery_progress_items dpi
JOIN customer_order_items ci ON ci.order_id = dpi.customer_order_id AND ci.deleted_at IS NULL
JOIN bom b ON b.id = ci.bom_id AND b.deleted_at IS NULL
SET dpi.order_item_id = ci.id
WHERE dpi.deleted_at IS NULL AND (dpi.order_item_id IS NULL OR dpi.order_item_id = 0)
  AND dpi.customer_order_id IS NOT NULL
  AND TRIM(COALESCE(dpi.bom_code, '')) <> ''
  AND TRIM(COALESCE(b.product_sku, '')) = TRIM(dpi.bom_code);

-- delivery_progress_items: material_code in bom_items
UPDATE delivery_progress_items dpi
JOIN customer_order_items ci ON ci.order_id = dpi.customer_order_id AND ci.deleted_at IS NULL
JOIN bom_items bi ON bi.bom_id = ci.bom_id AND bi.deleted_at IS NULL
SET dpi.order_item_id = ci.id
WHERE dpi.deleted_at IS NULL AND (dpi.order_item_id IS NULL OR dpi.order_item_id = 0)
  AND dpi.customer_order_id IS NOT NULL
  AND TRIM(COALESCE(dpi.material_code, '')) <> ''
  AND TRIM(COALESCE(bi.material_code, '')) = TRIM(dpi.material_code);

-- delivery_note_items: from linked progress
UPDATE delivery_note_items dni
JOIN delivery_notes dn ON dn.id = dni.dn_id AND dn.deleted_at IS NULL AND dn.progress_id IS NOT NULL
JOIN delivery_progress_items dpi ON dpi.progress_id = dn.progress_id AND dpi.deleted_at IS NULL
  AND dpi.order_item_id IS NOT NULL AND dpi.order_item_id > 0
  AND TRIM(COALESCE(dpi.bom_code, dpi.material_code, '')) = TRIM(COALESCE(dni.material_code, ''))
SET dni.order_item_id = dpi.order_item_id
WHERE dni.deleted_at IS NULL AND (dni.order_item_id IS NULL OR dni.order_item_id = 0);

-- delivery_note_items: material = BOM SKU
UPDATE delivery_note_items dni
JOIN delivery_notes dn ON dn.id = dni.dn_id AND dn.deleted_at IS NULL AND dn.customer_order_id IS NOT NULL
JOIN customer_order_items ci ON ci.order_id = dn.customer_order_id AND ci.deleted_at IS NULL
JOIN bom b ON b.id = ci.bom_id AND b.deleted_at IS NULL
SET dni.order_item_id = ci.id
WHERE dni.deleted_at IS NULL AND (dni.order_item_id IS NULL OR dni.order_item_id = 0)
  AND TRIM(COALESCE(dni.material_code, '')) <> ''
  AND TRIM(COALESCE(b.product_sku, '')) = TRIM(dni.material_code);

-- delivery_note_items: material in bom_items
UPDATE delivery_note_items dni
JOIN delivery_notes dn ON dn.id = dni.dn_id AND dn.deleted_at IS NULL AND dn.customer_order_id IS NOT NULL
JOIN customer_order_items ci ON ci.order_id = dn.customer_order_id AND ci.deleted_at IS NULL
JOIN bom_items bi ON bi.bom_id = ci.bom_id AND bi.deleted_at IS NULL
SET dni.order_item_id = ci.id
WHERE dni.deleted_at IS NULL AND (dni.order_item_id IS NULL OR dni.order_item_id = 0)
  AND TRIM(COALESCE(dni.material_code, '')) <> ''
  AND TRIM(COALESCE(bi.material_code, '')) = TRIM(dni.material_code);

-- shipment_reconciliation_items: from delivery_note_item
UPDATE shipment_reconciliation_items sri
JOIN delivery_note_items dni ON dni.id = sri.delivery_note_item_id AND dni.deleted_at IS NULL
SET sri.order_item_id = dni.order_item_id
WHERE sri.deleted_at IS NULL AND (sri.order_item_id IS NULL OR sri.order_item_id = 0)
  AND dni.order_item_id IS NOT NULL AND dni.order_item_id > 0;

-- shipment_reconciliation_items: material = BOM SKU / bom_items
UPDATE shipment_reconciliation_items sri
JOIN customer_order_items ci ON ci.order_id = sri.customer_order_id AND ci.deleted_at IS NULL
JOIN bom b ON b.id = ci.bom_id AND b.deleted_at IS NULL
SET sri.order_item_id = ci.id
WHERE sri.deleted_at IS NULL AND (sri.order_item_id IS NULL OR sri.order_item_id = 0)
  AND sri.customer_order_id IS NOT NULL
  AND TRIM(COALESCE(sri.material_code, '')) <> ''
  AND TRIM(COALESCE(b.product_sku, '')) = TRIM(sri.material_code);

UPDATE shipment_reconciliation_items sri
JOIN customer_order_items ci ON ci.order_id = sri.customer_order_id AND ci.deleted_at IS NULL
JOIN bom_items bi ON bi.bom_id = ci.bom_id AND bi.deleted_at IS NULL
SET sri.order_item_id = ci.id
WHERE sri.deleted_at IS NULL AND (sri.order_item_id IS NULL OR sri.order_item_id = 0)
  AND sri.customer_order_id IS NOT NULL
  AND TRIM(COALESCE(sri.material_code, '')) <> ''
  AND TRIM(COALESCE(bi.material_code, '')) = TRIM(sri.material_code);

-- invoice_items
UPDATE invoice_items ii
JOIN shipment_reconciliation_items sri ON sri.id = ii.reconciliation_item_id AND sri.deleted_at IS NULL
SET ii.order_item_id = sri.order_item_id
WHERE ii.deleted_at IS NULL AND (ii.order_item_id IS NULL OR ii.order_item_id = 0)
  AND sri.order_item_id IS NOT NULL AND sri.order_item_id > 0;

UPDATE invoice_items ii
JOIN customer_order_items ci ON ci.order_id = ii.customer_order_id AND ci.deleted_at IS NULL
JOIN bom b ON b.id = ci.bom_id AND b.deleted_at IS NULL
SET ii.order_item_id = ci.id
WHERE ii.deleted_at IS NULL AND (ii.order_item_id IS NULL OR ii.order_item_id = 0)
  AND ii.customer_order_id IS NOT NULL
  AND TRIM(COALESCE(ii.material_code, '')) <> ''
  AND TRIM(COALESCE(b.product_sku, '')) = TRIM(ii.material_code);

-- delivery_progress header
UPDATE delivery_progress dp
JOIN (
  SELECT progress_id, MIN(order_item_id) AS order_item_id
  FROM delivery_progress_items
  WHERE deleted_at IS NULL AND order_item_id IS NOT NULL AND order_item_id > 0
  GROUP BY progress_id
) linked ON linked.progress_id = dp.id
SET dp.order_item_id = linked.order_item_id
WHERE dp.deleted_at IS NULL AND (dp.order_item_id IS NULL OR dp.order_item_id = 0);

-- Remaining gaps (for manual review)
SELECT 'delivery_progress_items' AS tbl, COUNT(*) AS missing FROM delivery_progress_items WHERE deleted_at IS NULL AND (order_item_id IS NULL OR order_item_id = 0) AND customer_order_id IS NOT NULL
UNION ALL
SELECT 'delivery_note_items', COUNT(*) FROM delivery_note_items dni JOIN delivery_notes dn ON dn.id = dni.dn_id AND dn.deleted_at IS NULL WHERE dni.deleted_at IS NULL AND (dni.order_item_id IS NULL OR dni.order_item_id = 0) AND dn.customer_order_id IS NOT NULL
UNION ALL
SELECT 'shipment_reconciliation_items', COUNT(*) FROM shipment_reconciliation_items WHERE deleted_at IS NULL AND (order_item_id IS NULL OR order_item_id = 0) AND customer_order_id IS NOT NULL
UNION ALL
SELECT 'invoice_items', COUNT(*) FROM invoice_items WHERE deleted_at IS NULL AND (order_item_id IS NULL OR order_item_id = 0) AND customer_order_id IS NOT NULL
UNION ALL
SELECT 'delivery_progress', COUNT(*) FROM delivery_progress WHERE deleted_at IS NULL AND (order_item_id IS NULL OR order_item_id = 0) AND customer_order_id IS NOT NULL;
