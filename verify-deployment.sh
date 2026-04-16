#!/bin/bash
# Verify Rubber MES deployment and database connectivity

SERVER="ubuntu@43.133.56.234"
SERVER_PASS="Www.950pp.com"

echo "🔍 Verifying Rubber MES Deployment..."
echo ""

echo "1. Checking Rubber DB connectivity..."
sshpass -p "$SERVER_PASS" ssh -o StrictHostKeyChecking=no $SERVER << 'ENDSSH'
docker exec rubber-mysql mysql -urubber_user -prubber_db_2026 rubber_db -e "
SELECT 
  CASE WHEN COUNT(*) > 0 THEN '✅ Rubber DB reachable' ELSE '❌ Rubber DB issue' END as status
FROM information_schema.tables
WHERE table_schema='rubber_db'
" 2>/dev/null
ENDSSH

echo ""
echo "2. Checking sample customer orders..."
sshpass -p "$SERVER_PASS" ssh -o StrictHostKeyChecking=no $SERVER << 'ENDSSH'
docker exec rubber-mysql mysql -urubber_user -prubber_db_2026 rubber_db -e "
SELECT 
  co.id, 
  co.po_number, 
  c.customer_name,
  co.currency,
  co.total_amount
FROM customer_orders co 
LEFT JOIN customers c ON co.customer_id = c.id
LIMIT 3
" 2>/dev/null
ENDSSH

echo ""
echo "3. Checking Docker containers..."
sshpass -p "$SERVER_PASS" ssh -o StrictHostKeyChecking=no $SERVER "docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Image}}' | egrep 'rubber|NAMES'"

echo ""
echo "4. Testing frontend..."
FRONTEND_STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://43.133.56.234:10101)
if [ "$FRONTEND_STATUS" = "200" ]; then
  echo "✅ Frontend is accessible (HTTP $FRONTEND_STATUS)"
else
  echo "❌ Frontend error (HTTP $FRONTEND_STATUS)"
fi

echo ""
echo "5. Testing backend..."
BACKEND_STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://43.133.56.234:10102/)
if [ "$BACKEND_STATUS" = "200" ] || [ "$BACKEND_STATUS" = "401" ]; then
  echo "✅ Backend is running (HTTP $BACKEND_STATUS)"
else
  echo "⚠️  Backend status: HTTP $BACKEND_STATUS"
fi

echo ""
echo "6. Testing MySQL port..."
if nc -vz -w 5 43.133.56.234 10103 >/dev/null 2>&1; then
  echo "✅ MySQL port 10103 is reachable"
else
  echo "❌ MySQL port 10103 is not reachable"
fi

echo ""
echo "✅ Verification complete!"
echo "Visit: http://43.133.56.234:10101"
