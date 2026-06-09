CREATE DATABASE IF NOT EXISTS rubber_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE rubber_db;
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  name VARCHAR(255) NOT NULL,
  role VARCHAR(50) DEFAULT 'viewer',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS suppliers (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  supplier_code VARCHAR(100),
  tax_id VARCHAR(100),
  contact VARCHAR(255),
  phone VARCHAR(100),
  email VARCHAR(255),
  address TEXT,
  main_items TEXT,
  payment_terms VARCHAR(255),
  currency VARCHAR(20) DEFAULT 'VND',
  status VARCHAR(50) DEFAULT 'active',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS customers (
  id INT AUTO_INCREMENT PRIMARY KEY,
  customer_code VARCHAR(100) NOT NULL,
  customer_name VARCHAR(255) NOT NULL,
  tax_id VARCHAR(100),
  contact VARCHAR(255),
  phone VARCHAR(100),
  fax VARCHAR(100) COMMENT '传真',
  email VARCHAR(255),
  address TEXT,
  main_products TEXT,
  payment_terms VARCHAR(255),
  status VARCHAR(50) DEFAULT 'active',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS materials (
  id INT AUTO_INCREMENT PRIMARY KEY,
  material_code VARCHAR(100) NOT NULL UNIQUE,
  material_name VARCHAR(255) NOT NULL,
  spec TEXT,
  unit VARCHAR(50) DEFAULT 'PCS',
  category VARCHAR(255),
  product_category VARCHAR(255),
  supplier_id INT,
  supplier_name VARCHAR(255),
  supplier_price DECIMAL(15,2) DEFAULT 0,
  company_price DECIMAL(15,2) DEFAULT 0,
  currency VARCHAR(20) DEFAULT 'VND',
  stock INT DEFAULT 0,
  image_url TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS bom (
  id INT AUTO_INCREMENT PRIMARY KEY,
  product_sku VARCHAR(100) NOT NULL,
  product_name VARCHAR(255) NOT NULL,
  version VARCHAR(50) DEFAULT 'V1',
  status VARCHAR(50) DEFAULT 'active',
  created_by INT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  spec TEXT,
  unit VARCHAR(50) DEFAULT 'PCS',
  supplier_id INT,
  supplier_name VARCHAR(255),
  supplier_price DECIMAL(15,2) DEFAULT 0,
  company_price DECIMAL(15,2) DEFAULT 0,
  currency VARCHAR(20) DEFAULT 'VND',
  category VARCHAR(100),
  cert_code VARCHAR(100),
  brand VARCHAR(100),
  moq_tiers TEXT COMMENT 'MOQ阶梯价格(JSON)',
  image_url TEXT COMMENT '产品图片',
  material_name VARCHAR(255)
);

CREATE TABLE IF NOT EXISTS bom_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  bom_id INT NOT NULL,
  material_id INT NULL,
  material_code VARCHAR(100) NOT NULL,
  material_name VARCHAR(255) NOT NULL,
  spec TEXT,
  unit VARCHAR(50) DEFAULT 'PCS',
  quantity DECIMAL(15,4) DEFAULT 1,
  supplier_name VARCHAR(255),
  supplier_price DECIMAL(15,2) DEFAULT 0,
  company_price DECIMAL(15,2) DEFAULT 0,
  currency VARCHAR(20) DEFAULT 'VND',
  remark TEXT,
  INDEX idx_bom_items_material_id (material_id),
  FOREIGN KEY (bom_id) REFERENCES bom(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS purchase_orders (
  id INT AUTO_INCREMENT PRIMARY KEY,
  po_number VARCHAR(100) NOT NULL UNIQUE,
  supplier_id INT,
  supplier_name VARCHAR(255) NOT NULL,
  status VARCHAR(50) DEFAULT 'draft',
  total_amount DECIMAL(15,2) DEFAULT 0,
  tax_rate DECIMAL(5,2) DEFAULT 8.00,
  currency VARCHAR(20) DEFAULT 'VND',
  created_by INT,
  approved_by INT,
  approved_at DATETIME,
  remark TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS po_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  po_id INT NOT NULL,
  material_id INT NULL,
  material_code VARCHAR(100) NOT NULL,
  material_name VARCHAR(255) NOT NULL,
  spec TEXT,
  unit VARCHAR(50) DEFAULT 'PCS',
  quantity DECIMAL(15,4) NOT NULL,
  moq DECIMAL(15,4) DEFAULT 0,
  unit_price DECIMAL(15,2) DEFAULT 0,
  total_price DECIMAL(15,2) DEFAULT 0,
  currency VARCHAR(20) DEFAULT 'VND',
  remark TEXT,
  po_ref TEXT COMMENT '订单编号',
  INDEX idx_po_items_material_id (material_id),
  FOREIGN KEY (po_id) REFERENCES purchase_orders(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS customer_orders (
  id INT AUTO_INCREMENT PRIMARY KEY,
  po_date DATE,
  po_number VARCHAR(255) NOT NULL,
  customer_id INT,
  customer_name VARCHAR(255) NOT NULL,
  status VARCHAR(50) DEFAULT 'pending',
  remark TEXT,
  tax_rate DECIMAL(5,2) DEFAULT 0.00 COMMENT '税率(%)',
  tax_amount DECIMAL(15,2) DEFAULT 0 COMMENT '税额',
  total_amount DECIMAL(15,2) DEFAULT 0 COMMENT '总计',
  currency VARCHAR(20) DEFAULT 'VND' COMMENT '币种',
  delivery_date DATE COMMENT '预计交货日期',
  delivery_address TEXT COMMENT '交货地点',
  person_in_charge VARCHAR(100) COMMENT '负责人',
  payment_terms VARCHAR(100) COMMENT '付款方式',
  received_amount DECIMAL(15,2) DEFAULT 0 COMMENT '已收金额',
  payment_status VARCHAR(50) DEFAULT 'unpaid' COMMENT '付款状态',
  payment_date DATE COMMENT '付款日期',
  payment_note TEXT COMMENT '付款备注',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS customer_order_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  order_id INT NOT NULL,
  bom_id INT COMMENT 'BOM ID',
  po_no VARCHAR(255) NOT NULL DEFAULT '',
  item_name VARCHAR(255),
  material_code VARCHAR(100),
  spec TEXT,
  thickness DECIMAL(10,2),
  unit VARCHAR(50) DEFAULT 'PCS',
  qty DECIMAL(15,4) DEFAULT 0,
  unit_price DECIMAL(15,2) DEFAULT 0,
  rta_date DATE,
  remark TEXT,
  arrived_qty DECIMAL(15,4) DEFAULT 0,
  arrived_date DATE,
  balance DECIMAL(15,4),
  status VARCHAR(50) DEFAULT 'pending',
  FOREIGN KEY (order_id) REFERENCES customer_orders(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS order_profit_entries (
  id INT AUTO_INCREMENT PRIMARY KEY,
  order_id INT NOT NULL,
  category VARCHAR(50) NOT NULL,
  description VARCHAR(255) DEFAULT '',
  amount DECIMAL(15,2) NOT NULL DEFAULT 0,
  remark TEXT,
  created_by INT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_order_profit_entries_order_id (order_id),
  CONSTRAINT fk_order_profit_entries_order FOREIGN KEY (order_id) REFERENCES customer_orders(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS quotations (
  id INT AUTO_INCREMENT PRIMARY KEY,
  quotation_number VARCHAR(100) NOT NULL UNIQUE,
  customer_id INT,
  customer_name VARCHAR(255) NOT NULL,
  status VARCHAR(50) DEFAULT 'draft',
  total_amount DECIMAL(15,2) DEFAULT 0,
  currency VARCHAR(20) DEFAULT 'VND',
  valid_until DATE,
  remark TEXT,
  created_by INT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS quotation_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  quotation_id INT NOT NULL,
  material_id INT NULL,
  item_name VARCHAR(255),
  material_code VARCHAR(100),
  spec TEXT,
  unit VARCHAR(50) DEFAULT 'PCS',
  qty DECIMAL(15,4) DEFAULT 0,
  unit_price DECIMAL(15,2) DEFAULT 0,
  total_price DECIMAL(15,2) DEFAULT 0,
  remark TEXT,
  moq TEXT DEFAULT NULL,
  image_url TEXT DEFAULT NULL,
  INDEX idx_quotation_items_material_id (material_id),
  FOREIGN KEY (quotation_id) REFERENCES quotations(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS delivery_notes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  dn_number VARCHAR(100) NOT NULL UNIQUE,
  customer_id INT,
  customer_name VARCHAR(255) NOT NULL,
  customer_order_id INT,
  delivery_date DATE,
  status VARCHAR(50) DEFAULT 'draft',
  remark TEXT,
  created_by INT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS delivery_note_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  dn_id INT NOT NULL,
  material_id INT NULL,
  item_name VARCHAR(255),
  material_code VARCHAR(100),
  spec TEXT,
  unit VARCHAR(50) DEFAULT 'PCS',
  qty DECIMAL(15,4) DEFAULT 0,
  remark TEXT,
  po_ref TEXT COMMENT '订单编号',
  thickness DECIMAL(10,2) COMMENT '厚度',
  INDEX idx_delivery_note_items_material_id (material_id),
  FOREIGN KEY (dn_id) REFERENCES delivery_notes(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS delivery_sheets (
  id INT AUTO_INCREMENT PRIMARY KEY,
  ds_number VARCHAR(100) NOT NULL UNIQUE,
  customer_id INT,
  customer_name VARCHAR(255) NOT NULL,
  customer_order_id INT,
  delivery_date DATE,
  status VARCHAR(50) DEFAULT 'draft',
  remark TEXT,
  created_by INT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS delivery_sheet_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  ds_id INT NOT NULL,
  material_id INT NULL,
  item_name VARCHAR(255),
  material_code VARCHAR(100),
  spec TEXT,
  unit VARCHAR(50) DEFAULT 'PCS',
  qty DECIMAL(15,4) DEFAULT 0,
  remark TEXT,
  po_ref TEXT COMMENT '訂單編號',
  thickness DECIMAL(10,2) COMMENT '厚度',
  INDEX idx_delivery_sheet_items_material_id (material_id),
  FOREIGN KEY (ds_id) REFERENCES delivery_sheets(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS inventory (
  id INT AUTO_INCREMENT PRIMARY KEY,
  product_code VARCHAR(100) NOT NULL,
  product_name VARCHAR(255) NOT NULL,
  spec TEXT,
  unit VARCHAR(50) DEFAULT 'PCS',
  opening_balance DECIMAL(15,4) DEFAULT 0,
  inbound_qty DECIMAL(15,4) DEFAULT 0,
  outbound_qty DECIMAL(15,4) DEFAULT 0,
  closing_balance DECIMAL(15,4) DEFAULT 0,
  warehouse_location VARCHAR(255),
  remark TEXT,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS role_permissions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  role VARCHAR(50) NOT NULL,
  permission VARCHAR(100) NOT NULL,
  allowed TINYINT(1) DEFAULT 0,
  UNIQUE KEY role_perm (role, permission)
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT,
  user_name VARCHAR(255),
  user_email VARCHAR(255),
  action VARCHAR(100) NOT NULL,
  resource VARCHAR(100) NOT NULL,
  resource_id VARCHAR(100),
  detail TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS products (
  id INT AUTO_INCREMENT PRIMARY KEY,
  sku VARCHAR(100) NOT NULL UNIQUE,
  name VARCHAR(255) NOT NULL,
  category VARCHAR(255),
  description TEXT,
  image_url TEXT,
  price DECIMAL(15,2) DEFAULT 0,
  stock INT DEFAULT 0,
  unit VARCHAR(50) DEFAULT 'PCS',
  status VARCHAR(50) DEFAULT 'active',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Company settings table
CREATE TABLE IF NOT EXISTS company_settings (
  id INT AUTO_INCREMENT PRIMARY KEY,
  company_name VARCHAR(255) NOT NULL DEFAULT 'FAN YONG CO., LTD',
  company_name_local VARCHAR(255) DEFAULT 'CÔNG TY TNHH FAN YONG VIỆT NAM',
  address TEXT,
  phone VARCHAR(255) DEFAULT '0909883372',
  contact_person VARCHAR(255) DEFAULT 'Danny Lin',
  email VARCHAR(255) DEFAULT '',
  tax_id VARCHAR(100) DEFAULT '',
  logo_url TEXT,
  signature_url TEXT,
  signature_print_width INT NOT NULL DEFAULT 220,
  signature_print_height INT NOT NULL DEFAULT 72,
  operating_cost_rate DECIMAL(8,4) NOT NULL DEFAULT 0 COMMENT '營運成本比例(%)',
  vat_rate DECIMAL(8,4) NOT NULL DEFAULT 0 COMMENT '營業稅比例(%)',
  cit_rate DECIMAL(8,4) NOT NULL DEFAULT 0 COMMENT '所得稅比例(%)',
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Default company settings (from reference orders)
INSERT INTO company_settings (id, company_name, company_name_local, address, phone, contact_person, tax_id)
VALUES
(1, 'VUNG TAU ORIENT CO., LTD. - TO2', 'CÔNG TY TNHH ĐÔNG PHƯƠNG VŨNG TÀU', 'Road No.11, Dong Xuyen Industrial Zone, Rach Dua ward, Ho Chi Minh City, Vietnam', '0254 3978000', 'NGUYEN NGOC PHUONG TRINH', '3500690808')
ON DUPLICATE KEY UPDATE
  company_name = VALUES(company_name),
  company_name_local = VALUES(company_name_local),
  address = VALUES(address),
  phone = VALUES(phone),
  contact_person = VALUES(contact_person),
  tax_id = VALUES(tax_id);

-- Default manager user (password: admin123)
INSERT IGNORE INTO users (email, password_hash, name, role) VALUES
('admin@rubber.local', SHA2('admin123', 256), 'Admin', 'manager');

-- ============================================================================
-- Seed data (aligned with referenceFiles/訂單.jpg, 採購單.jpg, 出貨單.jpg)
-- ============================================================================

INSERT INTO suppliers (
  id, name, supplier_code, tax_id, contact, phone, email, address, payment_terms, currency, status
) VALUES (
  2211, 'CÔNG TY TNHH KUN YI', '2211', '0316674823', 'Danny Lin / Buu Buu', '0909883372 / 0933223927', '',
  '152 Hà Huy Tập, P. Tân Hưng, TP. Hồ Chí Minh', 'Payment way according by sales contract', 'VND', 'active'
)
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  supplier_code = VALUES(supplier_code),
  tax_id = VALUES(tax_id),
  contact = VALUES(contact),
  phone = VALUES(phone),
  address = VALUES(address),
  payment_terms = VALUES(payment_terms),
  currency = VALUES(currency),
  status = VALUES(status);

INSERT INTO customers (
  id, customer_code, customer_name, tax_id, contact, phone, email, address, payment_terms, status
) VALUES (
  1202, 'TO2', 'CÔNG TY TNHH ĐÔNG PHƯƠNG VŨNG TÀU (TO2)', '3500690808', 'NGUYEN NGOC PHUONG TRINH', '0254 3978000', '',
  'Road No.11, Dong Xuyen Industrial Zone, Rach Dua ward, Ho Chi Minh City, Vietnam', 'Payment way according by sales contract', 'active'
)
ON DUPLICATE KEY UPDATE
  customer_code = VALUES(customer_code),
  customer_name = VALUES(customer_name),
  tax_id = VALUES(tax_id),
  contact = VALUES(contact),
  phone = VALUES(phone),
  address = VALUES(address),
  payment_terms = VALUES(payment_terms),
  status = VALUES(status);

INSERT INTO bom (
  id, product_sku, product_name, material_name, spec, unit, supplier_id, supplier_name, supplier_price, company_price,
  currency, category, version, status, cert_code, brand
) VALUES
  (5100, '5100X', 'WHITE EVA', '32C WHITE EVA', '110CMX270CM 12MM', 'SH', 2211, 'CÔNG TY TNHH KUN YI', 328548.00, 361402.80, 'VND', 'EVA', 'V1', 'active', '', 'KUNYI'),
  (5101, '5100Y', 'WHITE EVA', '32C WHITE EVA', '110CMX270CM 14MM', 'SH', 2211, 'CÔNG TY TNHH KUN YI', 383306.00, 421636.60, 'VND', 'EVA', 'V1', 'active', '', 'KUNYI'),
  (5102, '5106R', 'BLACK EVA(EXPOSED)', '42C BLACK EVA(EXPOSED)', '130CMX215CM 14MM', 'SH', 2211, 'CÔNG TY TNHH KUN YI', 958272.00, 1054099.20, 'VND', 'EVA', 'V1', 'active', '', 'KUNYI'),
  (5103, '5107N', 'BLU EVA(EXPOSED)', '42C 300C BLU EVA(EXPOSED)', '130X215CM 14MM', 'SH', 2211, 'CÔNG TY TNHH KUN YI', 958272.00, 1054099.20, 'VND', 'EVA', 'V1', 'active', '', 'KUNYI'),
  (5104, '5109E', 'BLU EVA(EXPOSED)', '42C 282C BLU EVA(EXPOSED)', '130X215CM 14MM', 'SH', 2211, 'CÔNG TY TNHH KUN YI', 958272.00, 1054099.20, 'VND', 'EVA', 'V1', 'active', '', 'KUNYI'),
  (5105, '510A5', 'WHITE EVA', '32C WHITE EVA', '110X270CM 20MM', 'SH', 2211, 'CÔNG TY TNHH KUN YI', 547580.00, 602338.00, 'VND', 'EVA', 'V1', 'active', '', 'KUNYI'),
  (5114, '51114', 'BLACK EVA', '32C BLACK EVA', '110x270CM 3MM', 'SH', 2211, 'CÔNG TY TNHH KUN YI', 56715.00, 62386.50, 'VND', 'EVA', 'V1', 'active', '', 'KUNYI'),
  (5115, '51115', 'BLACK EVA', '32C BLACK EVA', '110x270CM 5MM', 'SH', 2211, 'CÔNG TY TNHH KUN YI', 94525.00, 103977.50, 'VND', 'EVA', 'V1', 'active', '', 'KUNYI'),
  (5116, '51116', 'BLACK EVA', '32C BLACK EVA', '110x270CM 6MM', 'SH', 2211, 'CÔNG TY TNHH KUN YI', 113430.00, 124773.00, 'VND', 'EVA', 'V1', 'active', '', 'KUNYI'),
  (5118, '51118', 'BLACK EVA', '32C BLACK EVA', '110x270CM 8MM', 'SH', 2211, 'CÔNG TY TNHH KUN YI', 151240.00, 166364.00, 'VND', 'EVA', 'V1', 'active', '', 'KUNYI'),
  (5119, '51119', 'BLACK EVA', '32C BLACK EVA', '110x270CM 10MM', 'SH', 2211, 'CÔNG TY TNHH KUN YI', 189050.00, 207955.00, 'VND', 'EVA', 'V1', 'active', '', 'KUNYI'),
  (5120, '51120', 'BLACK EVA', '32C BLACK EVA', '110x270CM 12MM', 'SH', 2211, 'CÔNG TY TNHH KUN YI', 226860.00, 249546.00, 'VND', 'EVA', 'V1', 'active', '', 'KUNYI'),
  (5121, '51121', 'BLACK EVA', '32C BLACK EVA', '110x270CM 14MM', 'SH', 2211, 'CÔNG TY TNHH KUN YI', 264670.00, 291137.00, 'VND', 'EVA', 'V1', 'active', '', 'KUNYI'),
  (5122, '51122', 'BLACK EVA', '32C BLACK EVA', '110x270CM 18MM', 'SH', 2211, 'CÔNG TY TNHH KUN YI', 340290.00, 374319.00, 'VND', 'EVA', 'V1', 'active', '', 'KUNYI'),
  (5123, '51123', 'BLACK EVA', '32C BLACK EVA', '110x270CM 20MM', 'SH', 2211, 'CÔNG TY TNHH KUN YI', 378100.00, 415910.00, 'VND', 'EVA', 'V1', 'active', '', 'KUNYI'),
  (5130, '5103M', 'BLACK EVA', '32C BLACK EVA', '110x270CM 15MM', 'SH', 2211, 'CÔNG TY TNHH KUN YI', 283575.00, 311932.50, 'VND', 'EVA', 'V1', 'active', '', 'KUNYI')
ON DUPLICATE KEY UPDATE
  product_name = VALUES(product_name),
  material_name = VALUES(material_name),
  spec = VALUES(spec),
  unit = VALUES(unit),
  supplier_id = VALUES(supplier_id),
  supplier_name = VALUES(supplier_name),
  supplier_price = VALUES(supplier_price),
  company_price = VALUES(company_price),
  currency = VALUES(currency),
  category = VALUES(category),
  status = VALUES(status),
  brand = VALUES(brand);

INSERT INTO customer_orders (
  id, po_date, po_number, customer_id, customer_name, status, remark, total_amount, currency, delivery_date, delivery_address, person_in_charge, payment_terms
) VALUES
  (3001, '2026-04-08', '6908661', 1202, 'CÔNG TY TNHH ĐÔNG PHƯƠNG VŨNG TÀU (TO2)', 'partial', 'Reference from PHIẾU GIAO HÀNG', 20998650.00, 'VND', '2026-04-08', 'TO2 Warehouse', 'NGUYEN NGOC PHUONG TRINH', 'Payment way according by sales contract'),
  (3002, '2026-04-08', 'A001RVM', 1202, 'CÔNG TY TNHH ĐÔNG PHƯƠNG VŨNG TÀU (TO2)', 'pending', 'Reference from PHIẾU GIAO HÀNG', 5749632.00, 'VND', '2026-04-08', 'TO2 Warehouse', 'NGUYEN NGOC PHUONG TRINH', 'Payment way according by sales contract')
ON DUPLICATE KEY UPDATE
  customer_id = VALUES(customer_id),
  customer_name = VALUES(customer_name),
  status = VALUES(status),
  remark = VALUES(remark),
  total_amount = VALUES(total_amount),
  currency = VALUES(currency),
  delivery_date = VALUES(delivery_date),
  delivery_address = VALUES(delivery_address),
  person_in_charge = VALUES(person_in_charge),
  payment_terms = VALUES(payment_terms);

INSERT INTO customer_order_items (
  id, order_id, bom_id, item_name, material_code, spec, thickness, unit, qty, unit_price, rta_date, remark, arrived_qty, balance, status
) VALUES
  (31001, 3001, 5130, '32C BLACK EVA', '5103M', '110X270CM 15MM', 15, 'SH', 67, 283575.00, '2026-04-08', 'from delivery note row#1', 67, 0, 'completed'),
  (31002, 3002, 5102, '42C WHITE EVA(EXPOSED)', '5106V', '130CMX215CM 14MM', 14, 'SH', 6, 958272.00, '2026-04-08', 'from delivery note row#2', 0, 6, 'pending')
ON DUPLICATE KEY UPDATE
  order_id = VALUES(order_id),
  bom_id = VALUES(bom_id),
  item_name = VALUES(item_name),
  material_code = VALUES(material_code),
  spec = VALUES(spec),
  thickness = VALUES(thickness),
  unit = VALUES(unit),
  qty = VALUES(qty),
  unit_price = VALUES(unit_price),
  rta_date = VALUES(rta_date),
  remark = VALUES(remark),
  arrived_qty = VALUES(arrived_qty),
  balance = VALUES(balance),
  status = VALUES(status);

INSERT INTO purchase_orders (
  id, po_number, supplier_id, supplier_name, status, total_amount, tax_rate, currency, approved_at, remark
) VALUES
  (4001, '000056055', 2211, 'CÔNG TY TNHH KUN YI', 'received', 104396190.00, 8.00, 'VND', '2026-03-18 09:00:00', 'Reference from 訂單.jpg Slip No 000056055'),
  (4002, '20260331', 2211, 'CÔNG TY TNHH KUN YI', 'approved', 97701040.00, 8.00, 'VND', '2026-03-31 09:00:00', 'Reference from 採購單.jpg KY-TT-20260331 01')
ON DUPLICATE KEY UPDATE
  supplier_id = VALUES(supplier_id),
  supplier_name = VALUES(supplier_name),
  status = VALUES(status),
  total_amount = VALUES(total_amount),
  tax_rate = VALUES(tax_rate),
  currency = VALUES(currency),
  approved_at = VALUES(approved_at),
  remark = VALUES(remark);

INSERT INTO po_items (
  id, po_id, material_code, material_name, spec, unit, quantity, unit_price, total_price, currency, remark
) VALUES
  (41001, 4001, '5100X', '32C WHITE EVA', '110CMX270CM 12MM', 'SH', 114, 328548.00, 37454472.00, 'VND', 'RTA 2026/04/11'),
  (41002, 4001, '5100X', '32C WHITE EVA', '110CMX270CM 12MM', 'SH', 100, 328548.00, 32854800.00, 'VND', 'RTA 2026/03/28'),
  (41003, 4001, '5100Y', '32C WHITE EVA', '110CMX270CM 14MM', 'SH', 35, 383306.00, 13415710.00, 'VND', 'RTA 2026/03/28'),
  (41004, 4001, '5106R', '42C BLACK EVA(EXPOSED)', '130CMX215CM 14MM', 'SH', 5, 958272.00, 4791360.00, 'VND', 'RTA 2026/04/18'),
  (41005, 4001, '5107N', '42C 300C BLU EVA(EXPOSED)', '130CMX215CM 14MM', 'SH', 2, 958272.00, 1916544.00, 'VND', 'RTA 2026/04/18'),
  (41006, 4001, '5109E', '42C 282C BLU EVA(EXPOSED)', '130CMX215CM 14MM', 'SH', 2, 958272.00, 1916544.00, 'VND', 'RTA 2026/04/18'),
  (41007, 4001, '510A5', '32C WHITE EVA', '110X270CM 20MM', 'SH', 22, 547580.00, 12046760.00, 'VND', 'RTA 2026/03/28'),
  (42001, 4002, '51114', '32C BLACK EVA', '110x270CM 3MM', 'SH', 7, 56715.00, 397005.00, 'VND', ''),
  (42002, 4002, '51115', '32C BLACK EVA', '110x270CM 5MM', 'SH', 105, 94525.00, 9925125.00, 'VND', ''),
  (42003, 4002, '51116', '32C BLACK EVA', '110x270CM 6MM', 'SH', 28, 113430.00, 3176040.00, 'VND', ''),
  (42004, 4002, '51118', '32C BLACK EVA', '110x270CM 8MM', 'SH', 140, 151240.00, 21173600.00, 'VND', ''),
  (42005, 4002, '51119', '32C BLACK EVA', '110x270CM 10MM', 'SH', 66, 189050.00, 12477300.00, 'VND', ''),
  (42006, 4002, '51120', '32C BLACK EVA', '110x270CM 12MM', 'SH', 62, 226860.00, 14065320.00, 'VND', ''),
  (42007, 4002, '51121', '32C BLACK EVA', '110x270CM 14MM', 'SH', 23, 264670.00, 6087410.00, 'VND', ''),
  (42008, 4002, '51122', '32C BLACK EVA', '110x270CM 18MM', 'SH', 46, 340290.00, 15653340.00, 'VND', ''),
  (42009, 4002, '51123', '32C BLACK EVA', '110x270CM 20MM', 'SH', 18, 378100.00, 6805800.00, 'VND', ''),
  (42010, 4002, '5103M', '32C BLACK EVA', '110x270CM 15MM', 'SH', 28, 283575.00, 7940100.00, 'VND', '')
ON DUPLICATE KEY UPDATE
  po_id = VALUES(po_id),
  material_code = VALUES(material_code),
  material_name = VALUES(material_name),
  spec = VALUES(spec),
  unit = VALUES(unit),
  quantity = VALUES(quantity),
  unit_price = VALUES(unit_price),
  total_price = VALUES(total_price),
  currency = VALUES(currency),
  remark = VALUES(remark);

INSERT INTO delivery_notes (
  id, dn_number, customer_id, customer_name, customer_order_id, delivery_date, status, remark
) VALUES
  (5001, 'DN-20260408-001', 1202, 'CÔNG TY TNHH ĐÔNG PHƯƠNG VŨNG TÀU (TO2)', 3001, '2026-04-08', 'shipped', 'Reference from PHIẾU GIAO HÀNG'),
  (5002, 'DN-20260408-002', 1202, 'CÔNG TY TNHH ĐÔNG PHƯƠNG VŨNG TÀU (TO2)', 3002, '2026-04-08', 'confirmed', 'Reference from PHIẾU GIAO HÀNG')
ON DUPLICATE KEY UPDATE
  customer_id = VALUES(customer_id),
  customer_name = VALUES(customer_name),
  customer_order_id = VALUES(customer_order_id),
  delivery_date = VALUES(delivery_date),
  status = VALUES(status),
  remark = VALUES(remark);

INSERT INTO delivery_note_items (
  id, dn_id, item_name, material_code, spec, unit, qty, remark, po_ref, thickness
) VALUES
  (51001, 5001, '32C BLACK EVA', '5103M', '110X270CM 15MM', 'SH', 67, '', '6908661', 15),
  (51002, 5002, '42C WHITE EVA(EXPOSED)', '5106V', '130CMX215CM 14MM', 'SH', 6, '', 'A001RVM', 14)
ON DUPLICATE KEY UPDATE
  dn_id = VALUES(dn_id),
  item_name = VALUES(item_name),
  material_code = VALUES(material_code),
  spec = VALUES(spec),
  unit = VALUES(unit),
  qty = VALUES(qty),
  remark = VALUES(remark),
  po_ref = VALUES(po_ref),
  thickness = VALUES(thickness);

INSERT INTO inventory (
  id, product_code, product_name, spec, unit, opening_balance, inbound_qty, outbound_qty, closing_balance, warehouse_location, remark
) VALUES
  (61001, '5103M', '32C BLACK EVA', '110X270CM 15MM', 'SH', 20, 28, 7, 41, 'Raw Material W/H', 'From purchase sheet + delivery note'),
  (61002, '51114', '32C BLACK EVA', '110x270CM 3MM', 'SH', 0, 7, 0, 7, 'Raw Material W/H', 'From purchase sheet 20260331'),
  (61003, '51115', '32C BLACK EVA', '110x270CM 5MM', 'SH', 0, 105, 0, 105, 'Raw Material W/H', 'From purchase sheet 20260331'),
  (61004, '5100X', '32C WHITE EVA', '110CMX270CM 12MM', 'SH', 0, 214, 0, 214, 'Raw Material W/H', 'From order slip 000056055')
ON DUPLICATE KEY UPDATE
  product_name = VALUES(product_name),
  spec = VALUES(spec),
  unit = VALUES(unit),
  opening_balance = VALUES(opening_balance),
  inbound_qty = VALUES(inbound_qty),
  outbound_qty = VALUES(outbound_qty),
  closing_balance = VALUES(closing_balance),
  warehouse_location = VALUES(warehouse_location),
  remark = VALUES(remark);

-- Reconciliation + invoice base tables (for payables/invoices pages)
CREATE TABLE IF NOT EXISTS shipment_reconciliations (
  id INT AUTO_INCREMENT PRIMARY KEY,
  reconciliation_no VARCHAR(100) NOT NULL UNIQUE,
  reconcile_date DATE,
  status VARCHAR(50) NOT NULL DEFAULT 'draft',
  remark TEXT,
  created_by INT,
  confirmed_by INT,
  confirmed_at DATETIME NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS shipment_reconciliation_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  reconciliation_id INT NOT NULL,
  delivery_note_id INT,
  delivery_note_item_id INT,
  customer_order_id INT,
  order_item_id INT NULL,
  po_number VARCHAR(255),
  material_code VARCHAR(100),
  material_name VARCHAR(255),
  supplier_id INT NULL,
  supplier_name VARCHAR(255),
  unit VARCHAR(50) DEFAULT 'PCS',
  shipped_qty DECIMAL(15,4) NOT NULL DEFAULT 0,
  accepted_qty DECIMAL(15,4) NOT NULL DEFAULT 0,
  difference_qty DECIMAL(15,4) NOT NULL DEFAULT 0,
  difference_reason TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS invoice_headers (
  id INT AUTO_INCREMENT PRIMARY KEY,
  invoice_no VARCHAR(100) NOT NULL UNIQUE,
  invoice_type VARCHAR(50) NOT NULL DEFAULT 'customer',
  invoice_period CHAR(6) NULL,
  invoice_seq INT NULL,
  invoice_date DATE,
  status VARCHAR(50) NOT NULL DEFAULT 'draft',
  party_id INT NULL,
  party_name VARCHAR(255),
  currency VARCHAR(20) DEFAULT 'VND',
  total_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
  tax_rate DECIMAL(8,4) NOT NULL DEFAULT 0,
  tax_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
  grand_total DECIMAL(15,2) NOT NULL DEFAULT 0,
  payment_status VARCHAR(50) NOT NULL DEFAULT 'pending',
  received_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
  paid_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
  payment_date DATE NULL,
  payment_note TEXT,
  verification_code VARCHAR(32) NULL,
  qr_payload TEXT NULL,
  remark TEXT,
  created_by INT,
  confirmed_by INT,
  confirmed_at DATETIME NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS invoice_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  invoice_id INT NOT NULL,
  reconciliation_id INT NULL,
  reconciliation_item_id INT NULL,
  customer_order_id INT NULL,
  order_item_id INT NULL,
  po_number VARCHAR(255),
  delivery_note_id INT NULL,
  delivery_note_item_id INT NULL,
  material_code VARCHAR(100),
  material_name VARCHAR(255),
  spec TEXT,
  unit VARCHAR(50) DEFAULT 'PCS',
  qty DECIMAL(15,4) NOT NULL DEFAULT 0,
  unit_price DECIMAL(15,2) NOT NULL DEFAULT 0,
  amount DECIMAL(15,2) NOT NULL DEFAULT 0,
  supplier_id INT NULL,
  supplier_name VARCHAR(255),
  customer_id INT NULL,
  customer_name VARCHAR(255),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO shipment_reconciliations (
  id, reconciliation_no, reconcile_date, status, remark, created_by, confirmed_by, confirmed_at
) VALUES
  (7001, 'SR-20260408-001', '2026-04-08', 'confirmed', 'Auto seed from delivery note', 1, 1, '2026-04-08 17:00:00')
ON DUPLICATE KEY UPDATE
  reconcile_date = VALUES(reconcile_date),
  status = VALUES(status),
  remark = VALUES(remark),
  confirmed_at = VALUES(confirmed_at);

INSERT INTO shipment_reconciliation_items (
  id, reconciliation_id, delivery_note_id, delivery_note_item_id, customer_order_id, order_item_id, po_number,
  material_code, material_name, supplier_id, supplier_name, unit, shipped_qty, accepted_qty, difference_qty, difference_reason
) VALUES
  (71001, 7001, 5001, 51001, 3001, 31001, '6908661', '5103M', '32C BLACK EVA', 2211, 'CÔNG TY TNHH KUN YI', 'SH', 67, 67, 0, '')
ON DUPLICATE KEY UPDATE
  shipped_qty = VALUES(shipped_qty),
  accepted_qty = VALUES(accepted_qty),
  difference_qty = VALUES(difference_qty),
  difference_reason = VALUES(difference_reason);

INSERT INTO invoice_headers (
  id, invoice_no, invoice_type, invoice_period, invoice_seq, invoice_date, status, party_id, party_name, currency,
  total_amount, tax_rate, tax_amount, grand_total, payment_status, paid_amount, payment_date, payment_note,
  verification_code, qr_payload, remark, created_by, confirmed_by, confirmed_at
) VALUES
  (8001, 'INV-C-202604-0001', 'customer', '202604', 1, '2026-04-08', 'confirmed', 1202, 'CÔNG TY TNHH ĐÔNG PHƯƠNG VŨNG TÀU (TO2)', 'VND',
    18999525.00, 8.00, 1519962.00, 20519487.00, 'pending', 0, NULL, '', 'VC-C-2026040001', 'INV-C-202604-0001|20519487', 'Customer invoice seed', 1, 1, '2026-04-08 18:00:00'),
  (8002, 'INV-S-202604-0001', 'supplier', '202604', 1, '2026-04-08', 'confirmed', 2211, 'CÔNG TY TNHH KUN YI', 'VND',
    97701040.00, 8.00, 7816083.00, 105517123.00, 'partial', 30000000.00, '2026-04-10', 'first payment', 'VC-S-2026040001', 'INV-S-202604-0001|105517123', 'Supplier invoice seed', 1, 1, '2026-04-08 18:30:00')
ON DUPLICATE KEY UPDATE
  invoice_type = VALUES(invoice_type),
  invoice_date = VALUES(invoice_date),
  status = VALUES(status),
  party_id = VALUES(party_id),
  party_name = VALUES(party_name),
  total_amount = VALUES(total_amount),
  tax_rate = VALUES(tax_rate),
  tax_amount = VALUES(tax_amount),
  grand_total = VALUES(grand_total),
  payment_status = VALUES(payment_status),
  paid_amount = VALUES(paid_amount),
  payment_date = VALUES(payment_date),
  payment_note = VALUES(payment_note),
  verification_code = VALUES(verification_code),
  qr_payload = VALUES(qr_payload),
  remark = VALUES(remark);

INSERT INTO invoice_items (
  id, invoice_id, reconciliation_id, reconciliation_item_id, customer_order_id, order_item_id, po_number,
  delivery_note_id, delivery_note_item_id, material_code, material_name, spec, unit, qty, unit_price, amount,
  supplier_id, supplier_name, customer_id, customer_name
) VALUES
  (81001, 8001, 7001, 71001, 3001, 31001, '6908661', 5001, 51001, '5103M', '32C BLACK EVA', '110X270CM 15MM', 'SH', 67, 283575.00, 18999525.00, 2211, 'CÔNG TY TNHH KUN YI', 1202, 'CÔNG TY TNHH ĐÔNG PHƯƠNG VŨNG TÀU (TO2)'),
  (81002, 8002, NULL, NULL, NULL, NULL, '20260331', NULL, NULL, '51114', '32C BLACK EVA', '110x270CM 3MM', 'SH', 523, 186808.87, 97701040.00, 2211, 'CÔNG TY TNHH KUN YI', NULL, NULL)
ON DUPLICATE KEY UPDATE
  qty = VALUES(qty),
  unit_price = VALUES(unit_price),
  amount = VALUES(amount),
  supplier_name = VALUES(supplier_name),
  customer_name = VALUES(customer_name);
