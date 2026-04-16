-- Customer Orders: no-tax mode + item remark field

-- 1) customer_order_items add remark column (idempotent)
ALTER TABLE customer_order_items
ADD COLUMN IF NOT EXISTS remark TEXT COMMENT '品項備註';

-- 2) customer_orders switch to no-tax defaults
ALTER TABLE customer_orders
MODIFY COLUMN tax_rate DECIMAL(5,2) DEFAULT 0.00 COMMENT '税率(%)';

-- 3) normalize existing rows to no-tax totals
UPDATE customer_orders
SET tax_rate = 0, tax_amount = 0;

UPDATE customer_orders co
SET total_amount = (
  SELECT COALESCE(SUM(ci.qty * ci.unit_price), 0)
  FROM customer_order_items ci
  WHERE ci.order_id = co.id
);
