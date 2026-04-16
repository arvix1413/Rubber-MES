# Rubber MES 系统设计（基于 `oms-instance-v2` 改造）

## 1. 目标与结论

根据 `referenceFiles` 中的流程图与三类单据（訂單、採購單、出貨單），建议采用 **“在 instance-v2 基础上改造”** 的方案，而不是完全重写。

原因：
- 现有系统已具备核心模块：客户订单、采购单、出货单、库存、应收应付、权限、审计。
- 与参考流程重合度高，主要缺口是“按 PO/编码/数量联动”和“出货后对供应商结算/发票”闭环。
- 改造成本低，能更快上线第一版。

最终要实现的业务主线：
1. 客户下单（订单池）
2. 收集订单并按客户进度分配采购
3. 按 PO 编码/数量向供应商下单
4. 出货（可分批）
5. 核对出货数量
6. 供应商发票登记/审核
7. 按“当天各 PO 出货数量”生成并冲减供应商应付

## 2. 参考文件解读（字段抽取）

### 2.1 流程图
主流程文字：
- 客户下单 -> 收集订单 -> 按客户进度 PO 编码 数量开始下单给供应商 -> 出货 -> 核对数量 -> 给供应商开发票 -> 根据当天各PO的出货数量，扣除

系统含义：
- 业务主键不是单纯“物料”，而是 **PO 编码 + MTL 编码 + 数量节奏**。
- 需要“出货驱动的供应商结算（应付）”机制。

### 2.2 訂單（Purchase Order 样式）
可识别核心字段：
- Slip No、PO Date、Currency
- 行字段：PO No、Mtl No、Description/Spec/Color、Qty、Unit、Price、Amount、RTA

### 2.3 採購單（Purchase Sheet）
可识别核心字段：
- 公司信息、供应商、联系人、采购单号、Issue Date
- 行字段：PO NO、MTL NO、Products、Color、Spec、Thickness(mm)、Unit、QTY、Unit Price、Total(VND)、Remark
- 汇总：Total、VAT、含税总额

### 2.4 出貨單（PHIẾU GIAO HÀNG）
可识别核心字段：
- No、日期、交货公司编码
- 行字段：Mã số(编码)、Tên vật liệu(品名)、Số lượng、Đơn vị、Số đơn đặt hàng(订单号/PO)

## 3. 系统蓝图（To-Be）

## 3.1 模块结构
保留并改造：
- 客户订单（`customer-orders`）
- 采购单（`po`）
- 出货单（`delivery-notes`）
- 应付（`payables`）
- 报表（`reports`）

新增模块：
- 订单收集池（Order Intake Board）
- 出货核对（Shipment Reconciliation）
- 供应商发票（Supplier Invoice）
- 结算引擎（Daily Settlement Job）

## 3.2 关键业务对象
- 客户订单头（Customer Order）
- 客户订单行（按 PO No + MTL No 维度）
- 供应商采购单头/行
- 出货单头/行
- 出货核对记录
- 供应商发票头/行
- 供应商应付台账（按 PO 行累计）

## 3.3 状态机（建议）
- 客户订单：`pending -> partial -> completed -> closed`
- 采购单：`draft -> approved -> sent -> received -> settled`
- 出货单：`draft -> confirmed -> shipped -> reconciled`
- 供应商发票：`draft -> submitted -> approved -> posted -> paid`

## 4. 数据模型改造（在现有库上增量）

## 4.1 现有表复用
直接复用：
- `customer_orders` / `customer_order_items`
- `purchase_orders` / `po_items`
- `delivery_notes` / `delivery_note_items`
- `payables`

## 4.2 建议新增字段
`customer_order_items`：
- `po_no` VARCHAR(100) NOT NULL
- `mtl_no` VARCHAR(100) NOT NULL
- `color` VARCHAR(100)
- `thickness_mm` DECIMAL(10,2)
- `rta_date` DATE
- `ordered_qty` DECIMAL(15,4)
- `shipped_qty` DECIMAL(15,4) DEFAULT 0
- `reconciled_qty` DECIMAL(15,4) DEFAULT 0
- `settled_qty` DECIMAL(15,4) DEFAULT 0

`po_items`：
- `customer_order_item_id` INT NULL
- `po_no_ref` VARCHAR(100)
- `mtl_no_ref` VARCHAR(100)

`delivery_note_items`：
- `customer_order_item_id` INT NULL
- `po_no_ref` VARCHAR(100)
- `mtl_no_ref` VARCHAR(100)

## 4.3 建议新增表
`supplier_invoices`
- `id`, `invoice_no`, `supplier_id`, `invoice_date`, `currency`, `total_amount`, `tax_amount`, `status`, `remark`, `created_by`, `created_at`

`supplier_invoice_items`
- `id`, `invoice_id`, `po_item_id`, `customer_order_item_id`, `po_no`, `mtl_no`, `qty`, `unit_price`, `amount`, `remark`

`shipment_reconciliations`
- `id`, `reconcile_date`, `supplier_id`, `status`, `remark`, `created_by`, `created_at`

`shipment_reconciliation_items`
- `id`, `reconcile_id`, `delivery_note_item_id`, `customer_order_item_id`, `po_no`, `mtl_no`, `shipped_qty`, `accepted_qty`, `difference_qty`, `difference_reason`

## 5. 核心规则（必须系统化）

1. 出货扣减规则：
- 仅当出货单状态变为 `shipped` 时，才写入扣减流水。
- 扣减维度：`supplier + po_no + mtl_no`。
- 数量来源：`delivery_note_items.qty`。

2. 对数规则：
- 核对单确认后，`accepted_qty` 才计入 `reconciled_qty`。
- 若有差异，必须填写差异原因并进入待处理列表。

3. 发票过账规则：
- 供应商发票 `approved` 后才可 `posted`。
- `posted` 时按发票行冲减应付余额，防止超冲（`posted_qty <= reconciled_qty - settled_qty`）。

4. 防重与并发：
- 单据号唯一索引（订单号、采购单号、发票号）。
- 所有“状态迁移 + 库存/应付写入”必须在事务内。

## 6. API 设计（新增/改造）

新增 API：
- `GET /api/order-intake`（订单收集池）
- `POST /api/order-intake/import`（Excel/CSV 导入）
- `POST /api/reconciliations`
- `PATCH /api/reconciliations/:id/confirm`
- `GET /api/supplier-invoices`
- `POST /api/supplier-invoices`
- `PATCH /api/supplier-invoices/:id/approve`
- `PATCH /api/supplier-invoices/:id/post`

改造 API：
- `POST /api/customer-orders`：支持 `po_no + mtl_no + thickness + rta` 字段。
- `POST /api/po`：支持关联 `customer_order_item_id`。
- `PATCH /api/delivery-notes/:id/status`：在 `shipped` 时调用结算写入逻辑。

## 7. 前端页面规划

1. 订单收集池（新）
- 看板视图：按客户/交期/进度分组。
- 可一键生成采购建议（按供应商聚合）。

2. 客户订单（改）
- 明细行必须显示：PO No、MTL No、Thickness、RTA、已出货、已核对、已结算、余额。

3. 采购单（改）
- 选择订单行后自动带出 PO/MTL/规格/厚度。
- 显示与订单行的“剩余待采数量”。

4. 出货单（改）
- 出货行强制绑定订单行。
- 出货后自动回写订单行 `shipped_qty`。

5. 出货核对（新）
- 批量核对、差异标记、差异原因。

6. 供应商发票（新）
- 从“可结算余额”自动带行。
- 支持审核、过账、付款登记。

## 8. 权限与审计

建议新增权限键：
- `reconciliation.create`
- `reconciliation.approve`
- `supplier_invoice.create`
- `supplier_invoice.approve`
- `supplier_invoice.post`

关键动作必须写审计：
- 状态变更
- 数量改动
- 发票过账
- 反过账/冲销

## 9. 实施计划（4 阶段）

阶段 1（先上线最小闭环）：
- 改订单行字段 + 改出货扣减逻辑 + 出货后自动回写。

阶段 2：
- 上线“出货核对”模块，建立 `reconciled_qty`。

阶段 3：
- 上线“供应商发票 + 过账”，打通应付。

阶段 4：
- 报表与预警：
  - PO 履约率
  - 出货/核对差异率
  - 供应商对账差异
  - 应付账龄

## 10. 技术决策

- 结论：**不重写，基于 instance-v2 迭代。**
- 原因：
  - 现有功能覆盖 70% 以上。
  - 数据迁移和权限体系可直接继承。
  - 风险最低、交付最快。

