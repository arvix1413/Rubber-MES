-- Add image_url field to bom table
USE oms_db;

ALTER TABLE bom 
ADD COLUMN image_url TEXT COMMENT '产品图片' AFTER brand;
