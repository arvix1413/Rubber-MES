// Test script to check customer orders data
const mysql = require('mysql2/promise');

async function test() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'root',
    database: process.env.DB_NAME || 'oms'
  });

  console.log('✅ Connected to database');

  // Check table structure
  console.log('\n📋 Checking customer_orders table structure:');
  const [columns] = await connection.query(`
    SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'customer_orders'
    ORDER BY ORDINAL_POSITION
  `, [process.env.DB_NAME || 'oms']);
  
  console.table(columns);

  // Check if there's any data
  console.log('\n📊 Checking customer_orders data:');
  const [orders] = await connection.query(`
    SELECT co.id, co.po_date, co.po_number, co.customer_id, co.status,
           co.tax_rate, co.tax_amount, co.total_amount, co.currency,
           c.customer_name
    FROM customer_orders co 
    LEFT JOIN customers c ON co.customer_id = c.id
    LIMIT 5
  `);
  
  console.log(`Found ${orders.length} orders`);
  if (orders.length > 0) {
    console.table(orders);
  }

  // Check for missing columns
  const requiredColumns = [
    'tax_rate', 'tax_amount', 'total_amount', 'currency',
    'delivery_date', 'delivery_address', 'person_in_charge', 'payment_terms'
  ];
  
  const existingColumns = columns.map(c => c.COLUMN_NAME);
  const missingColumns = requiredColumns.filter(col => !existingColumns.includes(col));
  
  if (missingColumns.length > 0) {
    console.log('\n⚠️  Missing columns:', missingColumns);
    console.log('Run migration: mysql < migrate-customer-orders-fields.sql');
  } else {
    console.log('\n✅ All required columns exist');
  }

  await connection.end();
}

test().catch(console.error);
