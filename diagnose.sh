#!/bin/bash

echo "==================================="
echo "OMS 订单创建问题诊断工具"
echo "==================================="
echo ""

# 检查是否提供了服务器地址
SERVER=${1:-"43.133.56.234"}
BACKEND_PORT=${2:-"3001"}
FRONTEND_PORT=${3:-"3000"}

echo "服务器地址: $SERVER"
echo "后端端口: $BACKEND_PORT"
echo "前端端口: $FRONTEND_PORT"
echo ""

# 1. 检查服务器连通性
echo "1. 检查服务器连通性..."
if ping -c 1 $SERVER &> /dev/null; then
    echo "   ✓ 服务器可以ping通"
else
    echo "   ✗ 服务器无法ping通"
fi
echo ""

# 2. 检查后端端口
echo "2. 检查后端端口 $BACKEND_PORT..."
if nc -z -w5 $SERVER $BACKEND_PORT 2>/dev/null; then
    echo "   ✓ 后端端口 $BACKEND_PORT 开放"
    
    # 尝试访问后端API
    echo "   测试后端API..."
    RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" http://$SERVER:$BACKEND_PORT/ 2>/dev/null)
    if [ "$RESPONSE" = "200" ]; then
        echo "   ✓ 后端API响应正常 (HTTP $RESPONSE)"
    else
        echo "   ⚠ 后端API响应异常 (HTTP $RESPONSE)"
    fi
else
    echo "   ✗ 后端端口 $BACKEND_PORT 未开放或无法访问"
fi
echo ""

# 3. 检查前端端口
echo "3. 检查前端端口 $FRONTEND_PORT..."
if nc -z -w5 $SERVER $FRONTEND_PORT 2>/dev/null; then
    echo "   ✓ 前端端口 $FRONTEND_PORT 开放"
    
    # 尝试访问前端
    echo "   测试前端页面..."
    RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" http://$SERVER:$FRONTEND_PORT/ 2>/dev/null)
    if [ "$RESPONSE" = "200" ] || [ "$RESPONSE" = "307" ] || [ "$RESPONSE" = "308" ]; then
        echo "   ✓ 前端页面响应正常 (HTTP $RESPONSE)"
    else
        echo "   ⚠ 前端页面响应异常 (HTTP $RESPONSE)"
    fi
else
    echo "   ✗ 前端端口 $FRONTEND_PORT 未开放或无法访问"
fi
echo ""

# 4. 测试登录API
echo "4. 测试登录API..."
LOGIN_RESPONSE=$(curl -s -X POST http://$SERVER:$BACKEND_PORT/api/auth/login \
    -H "Content-Type: application/json" \
    -d '{"email":"admin","password":"admin123"}' 2>/dev/null)

if echo "$LOGIN_RESPONSE" | grep -q "token"; then
    echo "   ✓ 登录API正常"
    TOKEN=$(echo "$LOGIN_RESPONSE" | grep -o '"token":"[^"]*"' | cut -d'"' -f4)
    echo "   Token: ${TOKEN:0:20}..."
    
    # 5. 测试获取供应商
    echo ""
    echo "5. 测试获取供应商列表..."
    SUPPLIERS=$(curl -s -X GET http://$SERVER:$BACKEND_PORT/api/suppliers \
        -H "Authorization: Bearer $TOKEN" 2>/dev/null)
    
    if echo "$SUPPLIERS" | grep -q "\["; then
        SUPPLIER_COUNT=$(echo "$SUPPLIERS" | grep -o '"id"' | wc -l)
        echo "   ✓ 供应商API正常，共 $SUPPLIER_COUNT 个供应商"
    else
        echo "   ✗ 供应商API异常"
        echo "   响应: $SUPPLIERS"
    fi
    
    # 6. 测试获取客户
    echo ""
    echo "6. 测试获取客户列表..."
    CUSTOMERS=$(curl -s -X GET http://$SERVER:$BACKEND_PORT/api/customers \
        -H "Authorization: Bearer $TOKEN" 2>/dev/null)
    
    if echo "$CUSTOMERS" | grep -q "\["; then
        CUSTOMER_COUNT=$(echo "$CUSTOMERS" | grep -o '"id"' | wc -l)
        echo "   ✓ 客户API正常，共 $CUSTOMER_COUNT 个客户"
    else
        echo "   ✗ 客户API异常"
        echo "   响应: $CUSTOMERS"
    fi
    
    # 7. 测试获取BOM
    echo ""
    echo "7. 测试获取BOM列表..."
    BOMS=$(curl -s -X GET http://$SERVER:$BACKEND_PORT/api/bom \
        -H "Authorization: Bearer $TOKEN" 2>/dev/null)
    
    if echo "$BOMS" | grep -q "\["; then
        BOM_COUNT=$(echo "$BOMS" | grep -o '"id"' | wc -l)
        echo "   ✓ BOM API正常，共 $BOM_COUNT 个BOM"
    else
        echo "   ✗ BOM API异常"
        echo "   响应: $BOMS"
    fi
    
    # 8. 测试创建采购单
    echo ""
    echo "8. 测试创建采购单API..."
    PO_RESPONSE=$(curl -s -X POST http://$SERVER:$BACKEND_PORT/api/po \
        -H "Authorization: Bearer $TOKEN" \
        -H "Content-Type: application/json" \
        -d '{
            "supplier_id": 1,
            "supplier_name": "Test Supplier",
            "currency": "VND",
            "remark": "诊断测试",
            "items": [{
                "material_code": "TEST001",
                "material_name": "Test Material",
                "spec": "Test Spec",
                "unit": "PCS",
                "quantity": 1,
                "unit_price": 1,
                "total_price": 1,
                "currency": "VND",
                "remark": "",
                "po_ref": "DIAG-TEST",
                "thickness": ""
            }]
        }' 2>/dev/null)
    
    if echo "$PO_RESPONSE" | grep -q '"id"'; then
        echo "   ✓ 采购单创建API正常"
        PO_ID=$(echo "$PO_RESPONSE" | grep -o '"id":[0-9]*' | cut -d':' -f2)
        echo "   创建的采购单ID: $PO_ID"
        
        # 清理测试数据
        if [ ! -z "$PO_ID" ]; then
            curl -s -X DELETE http://$SERVER:$BACKEND_PORT/api/po/$PO_ID \
                -H "Authorization: Bearer $TOKEN" > /dev/null 2>&1
            echo "   ✓ 已清理测试数据"
        fi
    else
        echo "   ✗ 采购单创建API异常"
        echo "   响应: $PO_RESPONSE"
    fi
    
else
    echo "   ✗ 登录API异常"
    echo "   响应: $LOGIN_RESPONSE"
fi

echo ""
echo "==================================="
echo "诊断完成"
echo "==================================="
echo ""
echo "如果所有检查都通过，但仍无法创建订单，请："
echo "1. 打开浏览器开发者工具（F12）"
echo "2. 查看Console标签中的错误信息"
echo "3. 查看Network标签中的请求/响应详情"
echo "4. 参考 DEBUGGING-ORDER-CREATION.md 文档"
echo ""
