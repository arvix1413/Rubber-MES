# BOM 选择编辑检查报告

## 检查日期
2026-05-20

## 检查范围
全局检查 Rubber-MES 项目中所有涉及 BOM 选择的页面,确认编辑时是否正确带入已选择的 BOM ID。

## 检查结果

### ✅ 报价单 (quotations/page.tsx)
**状态**: 已修复
- 编辑时 BOM 下拉框保持可选
- `bom_id` 通过 `value={item.bom_id ? String(item.bom_id) : ''}` 正确绑定
- 用户可以重新选择其他 BOM
- 从 BOM 带入的字段(品名、规格、单位)为只读

### ✅ 客户订单 (customer-orders/page.tsx)
**状态**: 正常
- `startEdit` 函数中正确带入 `bom_id: i.bom_id ?? null`
- 使用 SearchableSelect 组件,通过 `value={item.bom_id ? String(item.bom_id) : ''}` 绑定
- 编辑时自动选中已绑定的 BOM

### ✅ 交期进度 (order-intake/page.tsx)
**状态**: 正常
- `startEdit` 函数中正确构建 `bomNodeId`
- 格式: `${item.customer_order_id}::${item.order_item_id}::${item.bom_id}`
- 编辑时自动选中已绑定的 BOM 节点

### ✅ 出货单 (delivery-notes/page.tsx)
**状态**: 正常
- `startEditDN` 函数中直接使用 `d.items`
- items 中包含 `bom_id` 字段
- 编辑时保留原有的 BOM 信息

### ✅ 采购单 (po/page.tsx)
**状态**: 正常
- 使用 `material_id` 而非 `bom_id`
- `startEdit` 函数中正确带入 `material_id`
- 编辑时自动选中已绑定的材料

## 结论

所有页面的编辑逻辑都已正确实现:
1. 编辑时自动带入已选择的 ID (bom_id / material_id / bomNodeId)
2. 下拉框/选择器自动选中对应项
3. 用户可以重新选择(如果业务允许)
4. 从关联数据带入的字段保持只读

**无需额外修复**
