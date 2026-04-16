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
