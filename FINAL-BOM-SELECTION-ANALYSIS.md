# BOM选择问题 - 最终分析报告

## 问题描述
用户反馈：选择BOM后，表单字段（材料名称、规格等）没有自动填充。

## E2E测试结果

### 采购单页面
- ✗ 材料名称 - 未填充
- ✗ 规格 - 未填充
- ✓ 单位 - 已填充 (PCS)
- ✓ 单价 - 已填充 (但值可能不对)

### 客户订单页面
- ✗ 规格 - 未填充
- ✓ 单位 - 已填充 (PCS)
- ✗ 单价 - 未填充

## 调试过程

### 1. 添加Console日志
在以下位置添加了console.log：
- `SearchableSelect.tsx` - onClick事件
- `po/page.tsx` - selectBOM函数
- `customer-orders/page.tsx` - onSelectBom函数

### 2. 测试结果
**没有任何console日志输出**

这说明：
- `selectBOM`函数没有被调用
- SearchableSelect的onClick事件没有被触发

### 3. 部署验证
- ✅ 代码已推送到GitHub
- ✅ GitHub Actions构建成功
- ✅ Docker镜像已拉取
- ✅ 容器已重启
- ❌ 但测试仍然失败，没有console日志

## 可能的原因分析

### 原因1: Playwright的click事件问题
Playwright的click可能没有正确触发React的onClick事件，特别是对于fixed定位的元素。

**验证方法**：手动在浏览器中点击，查看Console

### 原因2: 事件冒泡被阻止
SearchableSelect使用fixed定位，可能导致事件处理有问题。

**代码位置**：
```typescript
// SearchableSelect.tsx
{isOpen && !disabled && (
  <div 
    className="fixed bg-white border..."  // ← fixed定位
    style={{ zIndex: 9999, ... }}
  >
    <div onClick={() => {
      onChange(String(opt.id))  // ← 这里应该调用onChange
      ...
    }}>
```

### 原因3: onChange回调没有正确传递
虽然代码看起来是对的，但可能有作用域或闭包问题。

**代码位置**：
```typescript
// po/page.tsx
<SearchableSelect
  onChange={val => selectBOM(i, val)}  // ← 这里传递onChange
  ...
/>
```

### 原因4: React状态更新问题
即使selectBOM被调用，setForm可能没有正确更新状态。

## 建议的修复方案

### 方案1: 使用onMouseDown代替onClick
```typescript
<div
  onMouseDown={(e) => {
    e.preventDefault()
    console.log('onMouseDown triggered')
    onChange(String(opt.id))
    setIsOpen(false)
    setSearchTerm('')
  }}
>
```

### 方案2: 添加data属性并使用原生事件
```typescript
<div
  data-bom-id={opt.id}
  onClick={() => {
    const bomId = String(opt.id)
    console.log('Clicked BOM:', bomId)
    onChange(bomId)
    setIsOpen(false)
    setSearchTerm('')
  }}
>
```

### 方案3: 使用Portal渲染下拉框
使用React Portal确保事件正确传递：
```typescript
import { createPortal } from 'react-dom'

// 在组件中
{isOpen && !disabled && createPortal(
  <div className="fixed...">
    ...
  </div>,
  document.body
)}
```

### 方案4: 简化SearchableSelect，移除fixed定位
回到相对定位，但确保父容器没有overflow:hidden：
```typescript
<div className="absolute top-full mt-1 left-0 right-0 z-50">
  ...
</div>
```

## 立即可行的解决方案

### 临时方案：使用原生select
如果SearchableSelect有问题，暂时回退到原生select：

```typescript
<select 
  value={item.bom_id || ''}
  onChange={e => selectBOM(i, e.target.value)}
  disabled={!form.supplier_id}
>
  <option value="">-- 選擇 BOM --</option>
  {getFilteredBoms().map(b => (
    <option key={b.id} value={b.id}>
      {b.product_sku} — {b.product_name}
    </option>
  ))}
</select>
```

### 永久方案：修复SearchableSelect

1. **添加更多调试信息**
```typescript
const handleOptionClick = (opt: T) => {
  console.log('=== Option Clicked ===')
  console.log('Option:', opt)
  console.log('onChange function:', onChange)
  console.log('Calling onChange with:', String(opt.id))
  
  try {
    onChange(String(opt.id))
    console.log('onChange called successfully')
  } catch (e) {
    console.error('onChange failed:', e)
  }
  
  setIsOpen(false)
  setSearchTerm('')
}

// 在JSX中
<div onClick={() => handleOptionClick(opt)}>
```

2. **确保事件不被阻止**
```typescript
<div 
  onClick={(e) => {
    e.stopPropagation()  // 阻止冒泡
    handleOptionClick(opt)
  }}
  onMouseDown={(e) => e.preventDefault()}  // 防止失焦
>
```

## 下一步行动

### 立即执行
1. 等待最新代码部署（150秒）
2. 手动在浏览器中测试，打开Console查看日志
3. 如果还是没有日志，说明代码确实没有被执行

### 如果手动测试也失败
1. 使用临时方案：回退到原生select
2. 或者使用方案3：React Portal
3. 或者完全重写SearchableSelect组件

### 如果手动测试成功
说明是Playwright的问题，需要调整测试脚本的点击方式。

## 测试命令

```bash
# 等待部署
sleep 150

# SSH部署
sshpass -p 'Www.950pp.com' ssh ubuntu@43.133.56.234 "cd /opt/oms && docker compose pull && docker compose up -d --force-recreate"

# 等待启动
sleep 10

# 运行测试
npx playwright test test-with-console-logs.spec.ts --reporter=list

# 或者手动测试
# 1. 访问 http://43.133.56.234
# 2. 登录 (admin@oms.com / admin123)
# 3. 创建采购单
# 4. 打开Console (F12)
# 5. 选择供应商
# 6. 选择BOM
# 7. 查看Console输出
```

## 结论

问题已经定位到：**SearchableSelect的onClick事件没有被触发**

可能的根本原因：
1. Fixed定位导致的事件处理问题
2. React事件系统的问题
3. 或者Playwright测试的问题

建议：
1. 先手动测试确认问题
2. 如果确认是代码问题，使用临时方案（原生select）
3. 然后重写SearchableSelect组件，使用React Portal或其他方案
