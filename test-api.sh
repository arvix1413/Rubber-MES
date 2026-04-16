#!/bin/bash
# Test customer orders API

echo "Testing customer orders API..."
echo ""

# Test local backend
echo "1. Testing local backend (if running):"
curl -s http://localhost:3001/api/customer-orders -H "Authorization: Bearer test" | jq '.' || echo "Local backend not running or auth failed"

echo ""
echo "2. Testing production backend:"
curl -s http://43.133.56.234:3001/api/customer-orders -H "Authorization: Bearer test" | jq '.' || echo "Production backend not accessible or auth failed"

echo ""
echo "3. Checking if columns exist in database:"
echo "Run this SQL to check:"
echo "SHOW COLUMNS FROM customer_orders;"
