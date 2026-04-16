# BOM选择自动填充Bug报告

## 问题描述

用户反馈：选择BOM后，表单字段没有自动填充材料名称、规格等信息。

## 测试结果

### E2E测试确认

运行了完整的E2E测试，确认了以下问题：

#### 采购单页面 (PO)
- ✗ 材料名称 - 未填充
- ✗ 规格 - 未填充  
- ✓ 单位 - 已填充 (PCS)
- ✓ 单价 - 已填充 (1)

#### 客户订单页面 (Customer Orders)
- ✗ 规格 - 未填充
- ✓ 单位 - 已填充 (PCS)
- ✗ 单价 - 未填充

## 问题分析

### 可能原因

1. **生产环境代码未更新** ⚠️
   - 本地代码中的`selectBOM`和`onSelectBom`函数看起来是正确的
   - 但生产环境可能还在运行旧版本的代码
   
2. **BOM数据结构问题**
   - BOM表中可能缺少某些字段
   - 字段名称可能不匹配

3. **React状态更新问题**
   - `setForm`可能没有正确触发重新渲染
   - 状态更新可能被其他代码覆盖

4. **SearchableSelect组件的onChange回调**
   - 可能bomId传递不正确
   - 可能onChange没有被正确调用

## 调试步骤

### 已添加的调试日志

在以下文件中添加了console.log：

1. `frontend/app/dashboard/po/page.tsx` - `selectBOM`函数
2. `frontend/app/dashboard/customer-orders/page.tsx` - `onSelectBom`函数

调试日志会输出：
- 函数是否被调用
- 传入的参数（索引和BOM ID）
- 找到的BOM数据
- 更新的字段值

### 如何查看调试日志

1. 等待GitHub Actions自动部署完成（约5-10分钟）
2. 访问 http://43.133.56.234
3. 打开浏览器开发者工具（F12）
4. 切换到Console标签
5. 创建采购单或客户订单
6. 选择供应商
7. 选择BOM
8. 查看Console中的日志输出

### 预期的日志输出

如果函数正常工作，应该看到：

```
selectBOM called: { i: 0, bomId: "123", filteredBomsCount: 6 }
Found BOM: { id: 123, product_sku: "YBCZKA01268", product_name: "WGDP109 吊卡", ... }
Updating form with BOM data: { material_code: "YBCZKA01268", material_name: "WGDP109 吊卡", ... }
```

如果函数没有被调用，不会看到任何日志。

## 测试文件

创建了以下测试文件来验证问题：

1. `test-bom-selection.spec.ts` - 测试BOM选择和自动填充
2. `debug-bom-selection.spec.ts` - 详细调试BOM选择过程
3. `e2e-final.spec.ts` - 完整的E2E测试

运行测试：
```bash
cd oms-instance-v2
npx playwright test test-bom-selection.spec.ts
```

## 代码检查

### 采购单页面 - selectBOM函数

```typescript
const selectBOM = (i: number, bomId: string) => {
  console.log('selectBOM called:', { i, bomId, filteredBomsCount: getFilteredBoms().length })
  const bom = getFilteredBoms().find(b => String(b.id) === bomId)
  console.log('Found BOM:', bom)
  if (!bom) {
    console.log('BOM not found!')
    return
  }
  
  console.log('Updating form with BOM data:', {
    material_code: bom.product_sku,
    material_name: bom.product_name,
    spec: bom.spec,
    unit: bom.unit,
    unit_price: bom.supplier_price
  })
  
  setForm(p => ({
    ...p,
    items: p.items.map((item, idx) => idx !== i ? item : {
      ...item,
      bom_id: Number(bomId),
      material_code: bom.product_sku,
      material_name: bom.product_name,
      spec: bom.spec || '',
      unit: bom.unit || 'PCS',
      unit_price: bom.supplier_price || 0,
      currency: bom.currency || form.currency,
      image_url: bom.image_url || '',
      total_price: (item.quantity || 0) * (bom.supplier_price || 0),
    })
  }))
}
```

### SearchableSelect使用

```typescript
<SearchableSelect
  options={getFilteredBoms()}
  value={item.bom_id ? String(item.bom_id) : ''}
  onChange={val => selectBOM(i, val)}  // ← 这里调用selectBOM
  placeholder="-- 選擇 BOM --"
  disabled={!form.supplier_id}
  renderOption={b => `${b.product_sku} — ${b.product_name}${b.spec ? ` (${b.spec})` : ''}`}
  filterFn={(b, search) => 
    b.product_sku.toLowerCase().includes(search) ||
    b.product_name.toLowerCase().includes(search) ||
    (b.spec||'').toLowerCase().includes(search) ||
    (b.material_name||'').toLowerCase().includes(search)
  }
/>
```

## 下一步

### 1. 等待部署完成

GitHub Actions正在自动部署新代码。可以在这里查看进度：
https://github.com/arvix1413/oms-instance-v2/actions

### 2. 验证部署

部署完成后，运行验证脚本：
```bash
cd oms-instance-v2
./verify-deployment.sh
```

### 3. 手动测试

1. 访问 http://43.133.56.234
2. 登录（admin@oms.com / admin123）
3. 创建采购单
4. 打开开发者工具Console
5. 选择供应商
6. 选择BOM
7. 查看Console日志
8. 检查表单是否自动填充

### 4. 运行E2E测试

```bash
npx playwright test test-bom-selection.spec.ts --reporter=list
```

### 5. 根据日志分析问题

根据Console日志的输出，可以判断：

- 如果看到"selectBOM called"但没有"Found BOM" → BOM查找失败，检查bomId
- 如果看到"Found BOM"但字段为空 → BOM数据不完整
- 如果看到"Updating form"但表单没更新 → React状态更新问题
- 如果完全没有日志 → onChange回调没有被调用

## 临时解决方案

如果问题持续存在，可以考虑：

1. **手动填写** - 用户暂时手动填写材料名称和规格
2. **使用旧版本** - 回滚到之前工作的版本
3. **直接修复数据** - 如果是数据问题，直接在数据库中修复BOM表

## 相关文件

- `frontend/app/dashboard/po/page.tsx` - 采购单页面
- `frontend/app/dashboard/customer-orders/page.tsx` - 客户订单页面
- `frontend/components/SearchableSelect.tsx` - 可搜索下拉框组件
- `test-bom-selection.spec.ts` - BOM选择测试
- `E2E-TEST-REPORT.md` - 完整E2E测试报告

## 更新日志

- 2026-04-09: 添加调试日志，推送到GitHub
- 2026-04-09: E2E测试确认bug存在
- 2026-04-09: 创建测试文件和调试工具
