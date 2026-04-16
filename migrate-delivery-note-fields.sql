-- Add po_ref and thickness fields to delivery_note_items table
USE oms_db;

ALTER TABLE delivery_note_items 
ADD COLUMN po_ref VARCHAR(100) COMMENT '订单编号' AFTER remark,
ADD COLUMN thickness DECIMAL(10,2) COMMENT '厚度' AFTER po_ref;
