-- Add delivery sheets (送貨單) module tables

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
