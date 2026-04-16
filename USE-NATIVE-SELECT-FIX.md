# 临时修复方案：使用原生Select

由于SearchableSelect组件的onClick事件无法触发，建议暂时使用原生select作为临时解决方案。

## 修改采购单页面

文件：`frontend/app/dashboard/po/page.tsx`

将SearchableSelect替换为原生select：

```typescript
// 替换这部分代码
<SearchableSelect
  options={getFilteredBoms()}
  value={item.bom_id ? String(item.bom_id) : ''}
  onChange={val => selectBOM(i, val)}
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

// 替换为
<select
  className="oms-input text-xs py-1.5 w-full"
  value={item.bom_id || ''}
  onChange={e => selectBOM(i, e.target.value)}
  disabled={!form.supplier_id}
>
  <option value="">-- 選擇 BOM --</option>
  {getFilteredBoms().map(b => (
    <option key={b.id} value={b.id}>
      {b.product_sku} — {b.product_name}{b.spec ? ` (${b.spec})` : ''}
    </option>
  ))}
</select>
```

## 修改客户订单页面

文件：`frontend/app/dashboard/customer-orders/page.tsx`

同样替换SearchableSelect为原生select：

```typescript
// 替换这部分代码
<SearchableSelect
  options={boms}
  value={item.bom_id ? String(item.bom_id) : ''}
  onChange={val => onSelectBom(i, val)}
  placeholder="-- 選擇成品 BOM --"
  renderOption={b => `${b.product_sku} — ${b.product_name}${b.spec ? ` (${b.spec})` : ''}`}
  filterFn={(b, search) => 
    b.product_sku.toLowerCase().includes(search) ||
    b.product_name.toLowerCase().includes(search) ||
    (b.spec||'').toLowerCase().includes(search)
  }
/>

// 替换为
<select
  className="oms-input text-xs py-1.5 w-full"
  value={item.bom_id || ''}
  onChange={e => onSelectBom(i, e.target.value)}
>
  <option value="">-- 選擇成品 BOM --</option>
  {boms.map(b => (
    <option key={b.id} value={b.id}>
      {b.product_sku} — {b.product_name}{b.spec ? ` (${b.spec})` : ''}
    </option>
  ))}
</select>
```

## 优点

1. ✅ 简单可靠，原生select不会有事件问题
2. ✅ 立即可用，无需调试
3. ✅ 性能更好
4. ✅ 兼容性好

## 缺点

1. ❌ 没有搜索功能
2. ❌ 如果选项很多，用户体验不如SearchableSelect
3. ❌ 样式可能不如自定义组件美观

## 后续改进

等SearchableSelect的问题解决后，可以再切换回去。或者使用成熟的第三方库，如：
- react-select
- downshift
- @headlessui/react (Combobox)

这些库都经过充分测试，不会有事件处理问题。
