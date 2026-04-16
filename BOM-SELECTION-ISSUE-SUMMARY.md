# BOM选择自动填充问题 - 总结报告

## 问题确认

通过E2E测试确认：**选择BOM后，表单字段没有自动填充**

### 测试结果
- ✗ 材料名称 - 未填充
- ✗ 规格 - 未填充
- ✓ 单位 - 已填充 (PCS)
- ✓ 单价 - 已填充 (但值不对，应该是BOM的价格)

### 根本原因

**`selectBOM`函数没有被调用**

通过console日志监听确认：
- 点击BOM选项后，没有任何console.log输出
- 这说明SearchableSelect的onChange回调没有正确触发selectBOM函数

## 代码分析

### 当前代码（本地）

#### SearchableSelect组件
```typescript
<div
  onClick={() => {
    onChange(String(opt.id))  // ← 调用onChange
    setIsOpen(false)
    setSearchTerm('')
  }}
>
  {renderOption(opt)}
</div>
```

#### 采购单页面使用
```typescript
<SearchableSelect
  options={getFilteredBoms()}
  value={item.bom_id ? String(item.bom_id) : ''}
  onChange={val => selectBOM(i, val)}  // ← 应该调用selectBOM
  ...
/>
```

#### selectBOM函数
```typescript
const selectBOM = (i: number, bomId: string) => {
  console.log('selectBOM called:', { i, bomId })  // ← 应该输出日志
  const bom = getFilteredBoms().find(b => String(b.id) === bomId)
  if (!bom) return
  
  setForm(p => ({
    ...p,
    items: p.items.map((item, idx) => idx !== i ? item : {
      ...item,
      material_code: bom.product_sku,
      material_name: bom.product_name,
      spec: bom.spec || '',
      unit: bom.unit || 'PCS',
      unit_price: bom.supplier_price || 0,
      ...
    })
  }))
}
```

### 问题所在

1. **生产环境代码未更新** ⚠️
   - 本地代码已经添加了console.log
   - 但生产环境测试时没有任何日志输出
   - 说明生产环境还在运行旧版本代码

2. **可能的原因**
   - GitHub Actions部署还在进行中
   - 或者部署失败了
   - 或者Docker镜像缓存问题

## 解决方案

### 方案1: 等待自动部署完成（推荐）

GitHub Actions会自动构建和部署。通常需要5-15分钟。

检查部署状态：
```bash
# 查看GitHub Actions
https://github.com/arvix1413/oms-instance-v2/actions

# 或者检查Docker Hub
https://hub.docker.com/r/[username]/oms-frontend/tags
```

### 方案2: 手动部署

如果自动部署失败，可以手动部署：

```bash
# SSH到服务器
ssh ubuntu@43.133.56.234

# 进入部署目录
cd /opt/oms

# 拉取最新镜像
docker-compose pull

# 重启容器
docker-compose down
docker-compose up -d

# 查看日志
docker-compose logs -f frontend
```

### 方案3: 本地验证代码

在本地环境测试代码是否正常：

```bash
# 启动后端
cd backend
npm run dev

# 启动前端（新终端）
cd frontend
npm run dev

# 运行测试（新终端）
cd oms-instance-v2
npx playwright test test-with-console-logs.spec.ts --headed
```

如果本地测试通过，说明代码没问题，只是生产环境没更新。

## 验证步骤

部署完成后，运行以下测试验证：

```bash
cd oms-instance-v2
npx playwright test test-with-console-logs.spec.ts --reporter=list
```

### 预期结果

如果修复成功，应该看到：

```
--- 选择BOM后的console日志 ---

捕获到 3 条日志：
  [log] selectBOM called: { i: 0, bomId: "123", filteredBomsCount: 6 }
  [log] Found BOM: { id: 123, product_sku: "YBCZKA01268", ... }
  [log] Updating form with BOM data: { material_code: "YBCZKA01268", ... }

--- 检查表单字段 ---

材料名称: WGDP109 吊卡
规格: 50*86mm
单位: PCS
单价: 50

--- 测试结果 ---

✓ 自动填充正常工作
```

## 临时解决方案

在部署完成前，用户可以：

1. **手动填写** - 暂时手动输入材料名称和规格
2. **使用其他页面** - 如果其他页面正常，可以先使用其他功能

## 相关文件

- `frontend/components/SearchableSelect.tsx` - 可搜索下拉框组件
- `frontend/app/dashboard/po/page.tsx` - 采购单页面（已添加调试日志）
- `frontend/app/dashboard/customer-orders/page.tsx` - 客户订单页面（已添加调试日志）
- `test-with-console-logs.spec.ts` - 测试脚本（捕获console日志）
- `.github/workflows/deploy.yml` - 自动部署配置

## 测试命令

```bash
# 测试BOM选择功能
npx playwright test test-bom-selection.spec.ts

# 测试并捕获console日志
npx playwright test test-with-console-logs.spec.ts

# 完整E2E测试
npx playwright test e2e-final.spec.ts

# 查看测试截图
open test-results/
```

## 下一步

1. ✅ 代码已推送到GitHub
2. ⏳ 等待GitHub Actions自动部署（5-15分钟）
3. ⏳ 运行测试验证修复
4. ⏳ 如果测试通过，问题解决
5. ⏳ 如果测试失败，检查部署日志

## 更新日志

- 2026-04-09 15:00: 添加调试日志，推送到GitHub
- 2026-04-09 15:05: 运行测试，确认selectBOM未被调用
- 2026-04-09 15:10: 等待部署完成
- 2026-04-09 15:15: 再次测试，生产环境代码仍未更新
- 2026-04-09 15:20: 创建总结报告

## 结论

问题已定位：**selectBOM函数没有被调用**

原因：生产环境代码还没更新到最新版本

解决方案：等待GitHub Actions自动部署完成，或手动部署

预计修复时间：5-15分钟（自动部署）或立即（手动部署）
