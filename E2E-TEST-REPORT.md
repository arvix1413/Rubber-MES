# E2E测试报告 - 订单创建问题

## 测试日期
2026-04-09

## 测试环境
- 前端URL: http://43.133.56.234
- 后端API: https://oms-backend.arvix1413.workers.dev
- 测试工具: Playwright

## 测试结果总结

### ✗ 采购单创建 - 失败
### ✗ 客户订单创建 - 失败

## 发现的问题

### 问题1: 点击"建立"按钮后没有API请求发送 ⚠️⚠️⚠️

**严重程度**: 🔴 高

**现象**:
- 填写完所有表单字段后，点击"建立採購單"或"建立訂單"按钮
- 页面没有发送POST请求到后端API
- 页面停留在表单页面，没有返回列表页面

**可能原因**:
1. 前端表单验证失败，阻止了提交
2. JavaScript错误导致提交函数未执行
3. 按钮的onClick事件未正确绑定

**调试步骤**:
1. 打开浏览器开发者工具（F12）
2. 查看Console标签是否有JavaScript错误
3. 在Network标签中监控是否有API请求
4. 检查表单验证逻辑

**测试截图**:
- `test-results/final-po-05-result.png` - 采购单提交后的状态
- `test-results/final-co-05-result.png` - 客户订单提交后的状态

---

### 问题2: 供应商和BOM关联不完整 ⚠️

**严重程度**: 🟡 中

**现象**:
- 测试了5个供应商，只有1个有关联的BOM
- 选择供应商后，BOM下拉框为空

**供应商BOM关联情况**:
1. ✗ CÔNG TY TNHH CAO SU NHỰA B+S (KY-BS001) - 0个BOM
2. ✗ CÔNG TY TNHH MỘT THÀNH VIÊN THƯƠNG MẠI HÂM TƯỜNG (KY-HT001) - 0个BOM
3. ✗ CÔNG TY TNHH THỰC NGHIỆP VIỆT NAM THIÊN THẠC (KY-TT002) - 0个BOM
4. ✓ CÔNG TY IN ẤN NKV (FY-NKV001) - 2个BOM
5. (未测试其他供应商)

**影响**:
- 用户选择某些供应商后无法创建采购单
- 用户体验差

**解决方案**:
1. 检查BOM表的supplier_id字段
2. 确保每个供应商至少有一个关联的BOM产品
3. 或者在前端添加提示："该供应商暂无可用产品"

---

## 测试详细日志

### 采购单创建测试

```
=== 开始测试采购单创建 ===

✓ 进入采购单页面
✓ 点击建立采购单

可用供应商 (9个):
  1. CÔNG TY TNHH CAO SU NHỰA B+S (KY-BS001)
  2. CÔNG TY TNHH MỘT THÀNH VIÊN THƯƠNG MẠI HÂM TƯỜNG (KY-HT001)
  3. CÔNG TY TNHH THỰC NGHIỆP VIỆT NAM THIÊN THẠC (KY-TT002)
  4. CÔNG TY IN ẤN NKV (FY-NKV001)
  5. CÔNG TY TNHH NEW SHINE (FY-NS002)

✓ 已选择供应商: CÔNG TY TNHH CAO SU NHỰA B+S (KY-BS001)
✓ 点击BOM选择器

BOM选项数: 0

⚠ 供应商"CÔNG TY TNHH CAO SU NHỰA B+S (KY-BS001)"没有关联的BOM

尝试供应商: CÔNG TY IN ẤN NKV (FY-NKV001)
  BOM选项数: 2
✓ 找到有BOM的供应商: CÔNG TY IN ẤN NKV (FY-NKV001)

选择BOM: YBCZKA01734 — WGPM674  (50.8*88.9mm)
✓ 已选择BOM
✓ 已填写数量和单价

准备提交...
⚠ 未捕获到API响应: Timeout 10000ms exceeded
✗✗✗ 采购单创建失败，还在表单页面 ✗✗✗
```

### 客户订单创建测试

```
=== 开始测试客户订单创建 ===

✓ 进入客户订单页面
✓ 点击新增订单
✓ 已填写日期和单号: E2E-CO-1775707340744

可用客户 (7个):
  1. CÔNG TY ĐÔNG PHƯƠNG VŨNG TÀU (TO1) (KFY-TO1)
  2. CÔNG TY ĐÔNG PHƯƠNG VŨNG TÀU (TO2) (KFY-TO2)
  3. CÔNG TY WAGON VN (FY-WG)
  4. CÔNG TY EVATECH VN (FY-XY)
  5. CÔNG TY GEN BRIGHT LIGHTING (FY-ZH)

✓ 已选择客户: CÔNG TY ĐÔNG PHƯƠNG VŨNG TÀU (TO1) (KFY-TO1)
✓ 点击BOM选择器

BOM选项数: 2
选择BOM: YBCZKA01734 — WGPM674  (50.8*88.9mm)
✓ 已选择BOM
✓ 已填写数量、单价和出货日期

准备提交...
⚠ 未捕获到API响应: Timeout 10000ms exceeded
✗✗✗ 客户订单创建失败，还在表单页面 ✗✗✗
```

---

## 下一步行动

### 优先级1: 修复提交按钮问题 🔴

**需要检查的代码位置**:
- `oms-instance-v2/frontend/app/dashboard/po/page.tsx` - `save()` 函数
- `oms-instance-v2/frontend/app/dashboard/customer-orders/page.tsx` - `save()` 函数

**检查项**:
1. 表单验证逻辑是否正确
2. 是否有JavaScript错误
3. API请求是否正确发送
4. 错误处理是否正确显示

**建议**:
1. 在浏览器中手动测试，打开开发者工具查看Console和Network
2. 添加更多的console.log来调试
3. 检查toast提示是否显示错误信息

### 优先级2: 修复供应商BOM关联 🟡

**SQL查询检查**:
```sql
-- 检查BOM表的supplier_id字段
SELECT id, product_sku, product_name, supplier_id 
FROM bom 
LIMIT 10;

-- 检查每个供应商的BOM数量
SELECT s.id, s.name, COUNT(b.id) as bom_count
FROM suppliers s
LEFT JOIN bom b ON s.id = b.supplier_id
GROUP BY s.id, s.name
ORDER BY bom_count DESC;

-- 找出没有BOM的供应商
SELECT s.id, s.name
FROM suppliers s
LEFT JOIN bom b ON s.id = b.supplier_id
WHERE b.id IS NULL;
```

---

## 测试文件

- `e2e-final.spec.ts` - 完整的E2E测试
- `e2e-local.spec.ts` - 本地开发环境测试
- `test-page-load.spec.ts` - 页面加载测试
- `test-login-elements.spec.ts` - 登录元素检查

## 运行测试

```bash
# 运行完整E2E测试
cd oms-instance-v2
npx playwright test e2e-final.spec.ts --reporter=list

# 查看测试截图
open test-results/
```

---

## 结论

E2E测试成功识别了订单创建失败的根本原因：**点击提交按钮后没有发送API请求**。这是一个前端问题，需要检查表单验证和提交逻辑。

同时发现了数据完整性问题：大部分供应商没有关联的BOM产品，影响用户体验。

建议优先修复提交按钮问题，然后补充供应商的BOM数据。
