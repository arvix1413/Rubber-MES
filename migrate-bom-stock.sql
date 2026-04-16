-- 给bom表添加current_stock字段，用于替代materials表的库存管理
ALTER TABLE bom ADD COLUMN IF NOT EXISTS current_stock DECIMAL(15,4) DEFAULT 0;

-- 从materials表迁移现有库存数据到bom表（通过product_sku = material_code关联）
UPDATE bom b
JOIN materials m ON m.material_code = b.product_sku
SET b.current_stock = COALESCE(m.current_stock, 0)
WHERE m.current_stock IS NOT NULL AND m.current_stock != 0;
