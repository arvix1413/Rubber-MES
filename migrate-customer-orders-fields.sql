-- 添加客户订单缺少的字段
-- Migration for customer_orders table

-- 添加税率、税额、总金额字段
ALTER TABLE customer_orders 
ADD COLUMN IF NOT EXISTS tax_rate DECIMAL(5,2) DEFAULT 8.00 COMMENT '税率(%)';

ALTER TABLE customer_orders 
ADD COLUMN IF NOT EXISTS tax_amount DECIMAL(15,2) DEFAULT 0 COMMENT '税额';

ALTER TABLE customer_orders 
ADD COLUMN IF NOT EXISTS total_amount DECIMAL(15,2) DEFAULT 0 COMMENT '含税总计';

-- 添加币种字段
ALTER TABLE customer_orders 
ADD COLUMN IF NOT EXISTS currency VARCHAR(20) DEFAULT 'VND' COMMENT '币种';

-- 添加交货日期、交货地点、负责人、付款方式
ALTER TABLE customer_orders 
ADD COLUMN IF NOT EXISTS delivery_date DATE COMMENT '预计交货日期';

ALTER TABLE customer_orders 
ADD COLUMN IF NOT EXISTS delivery_address TEXT COMMENT '交货地点';

ALTER TABLE customer_orders 
ADD COLUMN IF NOT EXISTS person_in_charge VARCHAR(100) COMMENT '负责人';

ALTER TABLE customer_orders 
ADD COLUMN IF NOT EXISTS payment_terms VARCHAR(100) COMMENT '付款方式';

-- 添加付款相关字段
ALTER TABLE customer_orders 
ADD COLUMN IF NOT EXISTS received_amount DECIMAL(15,2) DEFAULT 0 COMMENT '已收金额';

ALTER TABLE customer_orders 
ADD COLUMN IF NOT EXISTS payment_status VARCHAR(50) DEFAULT 'unpaid' COMMENT '付款状态: unpaid, partial, paid';

ALTER TABLE customer_orders 
ADD COLUMN IF NOT EXISTS payment_date DATE COMMENT '付款日期';

ALTER TABLE customer_orders 
ADD COLUMN IF NOT EXISTS payment_note TEXT COMMENT '付款备注';

-- 添加 customer_order_items 表的 bom_id 字段
ALTER TABLE customer_order_items 
ADD COLUMN IF NOT EXISTS bom_id INT COMMENT 'BOM ID';

-- 添加 customers 表的 fax 字段
ALTER TABLE customers 
ADD COLUMN IF NOT EXISTS fax VARCHAR(100) COMMENT '传真';

-- 添加外键约束（如果需要）
-- ALTER TABLE customer_order_items 
-- ADD CONSTRAINT fk_customer_order_items_bom 
-- FOREIGN KEY (bom_id) REFERENCES bom(id) ON DELETE SET NULL;

-- 更新现有数据的税率为默认值8%
UPDATE customer_orders 
SET tax_rate = 8.00 
WHERE tax_rate IS NULL OR tax_rate = 0;

-- 更新现有数据的币种为默认值VND
UPDATE customer_orders 
SET currency = 'VND' 
WHERE currency IS NULL OR currency = '';

-- 计算并更新现有订单的税额和总金额
UPDATE customer_orders co
SET 
  tax_amount = (
    SELECT ROUND(SUM(qty * unit_price) * (co.tax_rate / 100), 2)
    FROM customer_order_items
    WHERE order_id = co.id
  ),
  total_amount = (
    SELECT ROUND(SUM(qty * unit_price) * (1 + co.tax_rate / 100), 2)
    FROM customer_order_items
    WHERE order_id = co.id
  )
WHERE EXISTS (
  SELECT 1 FROM customer_order_items WHERE order_id = co.id
);
