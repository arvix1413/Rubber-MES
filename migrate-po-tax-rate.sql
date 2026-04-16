-- Add purchase order tax rate field (1-25%)
ALTER TABLE purchase_orders
  ADD COLUMN tax_rate DECIMAL(5,2) DEFAULT 8.00 AFTER total_amount;
