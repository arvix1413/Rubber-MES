-- 將 admin@oms.com 角色從 admin 改為 manager
-- 執行方式：在伺服器上 docker exec -i oms-mysql mysql -u root -p oms_db < migrate-admin-to-manager.sql

USE oms_db;

UPDATE users SET role = 'manager' WHERE email = 'admin@oms.com' AND role = 'admin';

-- 確認 manager 角色在 role_permissions 表有全部權限
INSERT INTO role_permissions (role, permission, allowed) VALUES
  ('manager', 'customer_order.create', 1),
  ('manager', 'customer_order.delete', 1),
  ('manager', 'bom.create', 1),
  ('manager', 'bom.edit', 1),
  ('manager', 'bom.delete', 1),
  ('manager', 'po.create', 1),
  ('manager', 'po.approve', 1),
  ('manager', 'po.delete', 1),
  ('manager', 'production.create', 1),
  ('manager', 'production.delete', 1),
  ('manager', 'delivery.create', 1),
  ('manager', 'delivery.delete', 1),
  ('manager', 'customer.manage', 1),
  ('manager', 'supplier.manage', 1),
  ('manager', 'stock.adjust', 1),
  ('manager', 'user.manage', 1),
  ('manager', 'audit.view', 1)
ON DUPLICATE KEY UPDATE allowed = 1;

SELECT email, role FROM users WHERE email = 'admin@oms.com';
