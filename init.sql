CREATE DATABASE IF NOT EXISTS oms_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE oms_db;

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
  FOREIGN KEY (po_id) REFERENCES purchase_orders(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS customer_orders (
  id INT AUTO_INCREMENT PRIMARY KEY,
  po_date DATE,
  po_number VARCHAR(100) NOT NULL,
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
  item_name VARCHAR(255),
  material_code VARCHAR(100),
  spec TEXT,
  unit VARCHAR(50) DEFAULT 'PCS',
  qty DECIMAL(15,4) DEFAULT 0,
  unit_price DECIMAL(15,2) DEFAULT 0,
  total_price DECIMAL(15,2) DEFAULT 0,
  remark TEXT,
  moq DECIMAL(15,2) DEFAULT NULL,
  image_url TEXT DEFAULT NULL,
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
  item_name VARCHAR(255),
  material_code VARCHAR(100),
  spec TEXT,
  unit VARCHAR(50) DEFAULT 'PCS',
  qty DECIMAL(15,4) DEFAULT 0,
  remark TEXT,
  po_ref VARCHAR(100) COMMENT '订单编号',
  thickness DECIMAL(10,2) COMMENT '厚度',
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
  item_name VARCHAR(255),
  material_code VARCHAR(100),
  spec TEXT,
  unit VARCHAR(50) DEFAULT 'PCS',
  qty DECIMAL(15,4) DEFAULT 0,
  remark TEXT,
  po_ref VARCHAR(100) COMMENT '訂單編號',
  thickness DECIMAL(10,2) COMMENT '厚度',
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
  address TEXT DEFAULT '152 Hà Huy Tập, P. Tân Hưng, TP. HCM',
  phone VARCHAR(255) DEFAULT '0909883372',
  contact_person VARCHAR(255) DEFAULT 'Danny Lin',
  email VARCHAR(255) DEFAULT '',
  tax_id VARCHAR(100) DEFAULT '',
  logo_url TEXT DEFAULT NULL,
  operating_cost_rate DECIMAL(8,4) NOT NULL DEFAULT 0 COMMENT '營運成本比例(%)',
  vat_rate DECIMAL(8,4) NOT NULL DEFAULT 0 COMMENT '營業稅比例(%)',
  cit_rate DECIMAL(8,4) NOT NULL DEFAULT 0 COMMENT '所得稅比例(%)',
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Default company settings
INSERT IGNORE INTO company_settings (id, company_name, company_name_local, address, phone, contact_person) VALUES
(1, 'FAN YONG CO., LTD', 'CÔNG TY TNHH FAN YONG VIỆT NAM', '152 Hà Huy Tập, P. Tân Hưng, TP. HCM', '0909883372 Danny Lin / 0909042239 Mỹ Linh', 'Danny Lin / Mỹ Linh Ellachen');

-- Default manager user (password: admin123)
INSERT IGNORE INTO users (email, password_hash, name, role) VALUES
('admin@oms.com', SHA2('admin123', 256), 'Admin', 'manager');
