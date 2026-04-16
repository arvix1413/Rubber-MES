# 订单创建问题调试指南

## 问题描述
用户反馈无法创建采购单和客户订单。

## 可能的原因

### 1. 前端问题
- SearchableSelect组件选择BOM后未正确更新表单状态
- 表单验证失败
- 必填字段未填写
- BOM选择器被禁用（采购单需要先选择供应商）

### 2. 后端问题
- API端点返回错误
- 数据库连接问题
- 权限验证失败
- 数据验证失败

### 3. 网络问题
- 服务器无法访问
- CORS配置问题
- 请求超时

## 调试步骤

### 步骤1: 检查服务器状态

```bash
# SSH到服务器
ssh ubuntu@43.133.56.234

# 检查Docker容器状态
docker ps

# 检查前端容器日志
docker logs oms-frontend --tail 50

# 检查后端容器日志
docker logs oms-backend --tail 50

# 检查数据库容器日志
docker logs oms-mysql --tail 50
```

### 步骤2: 本地测试

```bash
# 1. 启动后端
cd oms-instance-v2/backend
npm run dev

# 2. 启动前端（新终端）
cd oms-instance-v2/frontend
npm run dev

# 3. 运行手动测试（新终端）
cd oms-instance-v2/frontend
npx playwright test manual-test-orders.spec.ts --headed
```

### 步骤3: 浏览器手动测试

1. 打开浏览器开发者工具（F12）
2. 访问 http://localhost:3000/login
3. 登录系统（admin / admin123）
4. 进入采购单页面
5. 点击"建立採購單"
6. 观察以下内容：

#### 采购单创建检查清单：
- [ ] 供应商下拉框是否有选项？
- [ ] 选择供应商后，BOM下拉框是否启用？
- [ ] 点击BOM下拉框，是否弹出选项列表？
- [ ] 选择BOM后，是否自动填充材料名称、规格、单位等字段？
- [ ] 填写数量和单价后，小计是否自动计算？
- [ ] 点击"建立採購單"按钮后，Network标签中是否有POST请求？
- [ ] POST请求的响应状态码是什么？（200表示成功）
- [ ] Console中是否有错误信息？

#### 客户订单创建检查清单：
- [ ] 客户下拉框是否有选项？
- [ ] 采购单号是否必填？
- [ ] BOM下拉框是否正常工作？
- [ ] 选择BOM后，是否自动填充规格、单位、单价？
- [ ] 填写数量后，小计是否自动计算？
- [ ] 税率计算是否正确？
- [ ] 点击"建立訂單"按钮后，是否有POST请求？
- [ ] 响应状态码是什么？

### 步骤4: API测试

使用提供的测试脚本：

```bash
cd oms-instance-v2
node test-order-creation.js
```

或者使用curl手动测试：

```bash
# 1. 登录获取token
TOKEN=$(curl -s -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin","password":"admin123"}' | jq -r '.token')

echo "Token: $TOKEN"

# 2. 获取供应商列表
curl -s -X GET http://localhost:3001/api/suppliers \
  -H "Authorization: Bearer $TOKEN" | jq '.[0]'

# 3. 获取BOM列表
curl -s -X GET http://localhost:3001/api/bom \
  -H "Authorization: Bearer $TOKEN" | jq '.[0]'

# 4. 创建采购单
curl -s -X POST http://localhost:3001/api/po \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "supplier_id": 1,
    "supplier_name": "Test Supplier",
    "currency": "VND",
    "remark": "Test PO",
    "items": [{
      "material_code": "TEST001",
      "material_name": "Test Material",
      "spec": "Test Spec",
      "unit": "PCS",
      "quantity": 100,
      "unit_price": 50,
      "total_price": 5000,
      "currency": "VND",
      "remark": "",
      "po_ref": "TEST-REF",
      "thickness": ""
    }]
  }' | jq '.'
```

## 常见问题和解决方案

### 问题1: BOM下拉框被禁用
**原因**: 采购单页面需要先选择供应商，才能选择BOM
**解决**: 确保先选择供应商

### 问题2: 选择BOM后字段未自动填充
**原因**: 
- BOM数据中缺少必要字段
- SearchableSelect组件的onChange回调未正确触发
**解决**: 
- 检查BOM表数据完整性
- 检查浏览器Console是否有JavaScript错误

### 问题3: 点击"建立"按钮无反应
**原因**:
- 表单验证失败
- API请求失败
- 权限不足
**解决**:
- 检查浏览器Console错误
- 检查Network标签中的请求响应
- 确认用户角色有创建权限

### 问题4: API返回401 Unauthorized
**原因**: Token过期或无效
**解决**: 重新登录

### 问题5: API返回403 Forbidden
**原因**: 用户角色权限不足
**解决**: 确认用户角色为admin、manager或purchaser

### 问题6: API返回400 Bad Request
**原因**: 请求数据格式错误或缺少必填字段
**解决**: 检查请求payload，确保所有必填字段都已填写

### 问题7: 下拉框选项为空
**原因**:
- 数据库中没有数据
- API请求失败
**解决**:
- 检查数据库中是否有供应商、客户、BOM数据
- 检查API响应

## 数据库检查

```sql
-- 检查供应商数量
SELECT COUNT(*) FROM suppliers;

-- 检查客户数量
SELECT COUNT(*) FROM customers;

-- 检查BOM数量
SELECT COUNT(*) FROM bom;

-- 检查BOM和供应商的关联
SELECT b.id, b.product_sku, b.product_name, b.supplier_id, s.name as supplier_name
FROM bom b
LEFT JOIN suppliers s ON b.supplier_id = s.id
LIMIT 10;

-- 检查最近的采购单
SELECT * FROM purchase_orders ORDER BY created_at DESC LIMIT 5;

-- 检查最近的客户订单
SELECT * FROM customer_orders ORDER BY created_at DESC LIMIT 5;
```

## 前端代码关键点

### SearchableSelect组件
位置: `oms-instance-v2/frontend/components/SearchableSelect.tsx`

关键功能:
- Fixed定位确保下拉框不被遮挡
- 智能方向判断（向上/向下）
- 搜索过滤
- 点击外部关闭

### 采购单页面
位置: `oms-instance-v2/frontend/app/dashboard/po/page.tsx`

关键逻辑:
- `onSelectSupplier`: 选择供应商后重置items
- `getFilteredBoms`: 根据供应商过滤BOM
- `selectBOM`: 选择BOM后自动填充字段
- `save`: 提交表单到后端

### 客户订单页面
位置: `oms-instance-v2/frontend/app/dashboard/customer-orders/page.tsx`

关键逻辑:
- `onSelectBom`: 选择BOM后自动填充字段
- `save`: 提交表单到后端，包含税率计算

## 后端代码关键点

### 采购单创建
位置: `oms-instance-v2/backend/src/index.ts` (line 302)

验证:
- 必须有items
- 自动生成PO编号
- 计算总金额

### 客户订单创建
位置: `oms-instance-v2/backend/src/index.ts` (line 453)

验证:
- po_number必填
- customer_id必填
- 自动计算税额和总金额
- 自动创建出货单草稿

## 测试文件

1. `tests/create-orders.spec.ts` - 完整的自动化测试
2. `tests/manual-test-orders.spec.ts` - 手动测试和调试
3. `test-order-creation.js` - API测试脚本

## 下一步

如果以上步骤都无法解决问题，请：

1. 提供浏览器Console的完整错误信息
2. 提供Network标签中失败请求的详细信息（请求URL、请求体、响应体）
3. 提供后端日志中的错误信息
4. 提供数据库中相关表的数据样本

## 联系信息

如需进一步协助，请提供：
- 错误截图
- 浏览器Console日志
- Network请求/响应详情
- 后端日志
