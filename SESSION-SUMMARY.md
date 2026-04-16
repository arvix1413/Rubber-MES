# OMS-Instance-V2 開發記錄 — Session Summary

## 項目基本信息

- **項目**：FAN YONG CO., LTD 內部訂單管理系統
- **倉庫**：`oms-instance-v2/` (GitHub: arvix1413/oms-instance-v2)
- **線上地址**：http://43.133.56.234
- **後端 API**：http://43.133.56.234/api
- **預設帳號**：`admin@oms.com` / `admin123`（角色：manager）
- **伺服器**：43.133.56.234，SSH user: ubuntu，密碼在 `.env.server`
- **部署方式**：push main → GitHub Actions → Docker Hub → 伺服器 `bash /opt/oms/deploy.sh`

## 技術棧

- **前端**：Next.js 14 靜態導出 + TypeScript + Tailwind CSS
- **後端**：Hono + Node.js + MySQL（Docker）
- **部署**：Docker Compose（oms-frontend, oms-backend, oms-mysql）

## 角色系統

| 角色 | 說明 |
|------|------|
| admin | 最高權限（不建議日常使用） |
| manager | 全部 17 個權限，包含用戶管理、公司設定 |
| employee | 依 RBAC 表動態配置 |

- **RBAC 動態權限**：後端 `requirePerm(permKey)` 函數，admin/manager 直接放行，其他角色查 `role_permissions` 表
- manager 不能看到/操作 admin 帳號
- 登入時從後端獲取 permissions 陣列存入 localStorage

## 主要功能模組

### 業務流程
1. **客戶訂單** — 建立/編輯（展開行內編輯）/刪除/狀態流程/打印
2. **材料明細（BOM）** — CRUD，含圖片上傳
3. **採購單** — 草稿→核准→發送→收貨，展開行內編輯/刪除
4. **生產單** — 多狀態流程，庫存檢查
5. **出貨單** — 自動從客戶訂單建立，出貨後自動扣庫存並更新客戶訂單狀態
6. **報價單** — 5 階梯 MOQ 定價，展開行內編輯，打印格式參考實體報價單

### 基礎資料
- 客戶管理、供應商管理（刪除前檢查關聯訂單）

### 倉庫管理
- 庫存查詢（BOM current_stock）、庫存流水、庫存調整（需核准）

### 系統管理（僅 manager）
- 公司設定（logo、地址、電話等，全局應用到所有打印表單）
- 角色管理（動態 RBAC）
- 用戶管理
- 操作日誌

## 重要業務邏輯

### 庫存流向
| 操作 | 庫存變化 |
|------|---------|
| 採購單收貨 | +採購數量（bom.current_stock） |
| 出貨單確認出貨 | -出貨數量，同時更新客戶訂單 arrived_qty |
| 生產單完工 | -原材料用量 |
| 庫存調整核准 | ±差異數量 |

### 出貨單 shipped 後自動更新客戶訂單
- 計算所有已出貨 DN 的 material_code 累計數量
- 更新 customer_order_items.arrived_qty
- 判斷全部出貨→completed，部分→partial

### 稅率
- 客戶訂單支持 0%~25% 下拉選擇，預設 8%

## 打印表單

所有打印函數都從 `/api/company` 讀取公司信息（`getCompany()` 帶緩存）：
- `printOrder.ts` — 客戶訂單
- `printDeliveryNote.ts` — 出貨單
- `po/page.tsx` 內聯 — 採購單
- `quotations/page.tsx` 內聯 — 報價單（5 階梯 MOQ 叠加顯示）

## 報價單 MOQ 阶梯定價

```typescript
type MoqTier = { moq: number; price: number }
// 存儲：moq 字段存 JSON 字符串 "[{moq:1000,price:1230},...]"
// 後端 GET 時解析為 moq_tiers 陣列返回
// 前端表單：5 組 (MOQ, 單價) 輸入框
// 打印：MOQ 列和單價列各自叠加顯示
```

## 已知問題 / 待修復

1. **報價單 hydration 問題**（已修復）：Next.js 靜態導出 + localStorage 讀取導致 React #418 錯誤，用 `mounted` state 解決
2. **出貨單規格**（已修復）：自動建立 DN 時從 BOM 取 spec/unit
3. **採購單編輯按鈕**（已修復）：展開行 items.length > 0 條件移除
4. **報價單乱码**（已修復）：歷史數據 Latin-1 誤存 UTF-8，用 CONVERT 修復

## 數據庫重要表

```sql
-- 主要表
users, suppliers, customers, bom, bom_items
purchase_orders, po_items
customer_orders, customer_order_items
delivery_notes, delivery_note_items
quotations, quotation_items (moq TEXT 存 JSON)
production_orders, production_materials
stock_ledger, stock_adjustments, stock_adjustment_items
role_permissions, audit_logs
company_settings (id=1, 單行配置)
```

## 部署流程

```bash
# 手動部署（SSH）
sshpass -p 'Www.950pp.com' ssh ubuntu@43.133.56.234 "cd /opt/oms && bash deploy.sh"

# 數據庫操作
docker exec oms-mysql mysql -u root -poms_mysql_2026 oms_db -e "SQL..."

# 本地開發
cd oms-instance-v2/backend && npm run dev   # port 3001
cd oms-instance-v2/frontend && npm run dev  # port 3000
```

## 下次開發待辦

- [ ] 出貨單出貨後更新客戶訂單「已出貨數量」（已部分實現）
- [ ] 生產單原材料配置與庫存聯動
- [ ] 報表模組（月度銷售/採購統計）
- [ ] 多語言支援（繁中/越南文）
- [ ] 手機版 RWD 優化
- [ ] 批量匯入客戶/供應商（Excel）
- [ ] 採購單 PDF 匯出
