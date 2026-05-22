# Rubber MES

Rubber MES 是橡胶业务用的制造执行 / 订单执行系统。它和 `oms-instance-v2` 有明显的同源关系，但已经不是简单复制品，业务模块、页面命名、数据库扩展和部署端口都已经分叉。

这份 README 面向新接手的工程师或 AI，重点是让接手者立刻理解：系统主线是什么、关键逻辑文件在哪里、部署怎么走、哪些地方已经做过全局统一。

## 1. Current Environment

当前仅保留 **PRD** 环境，服务器 `43.160.199.226`，部署目录 `/opt/rubber`。

### Online URLs
- 前端: `http://43.160.199.226:10101`
- 后端: `http://43.160.199.226:10102`
- MySQL: `43.160.199.226:10103`

### Account Access
- 请使用个人账号登录
- 共享排查账号: `admin@rubber.local`
- 当前密码: `Make$45617`
- 上述共享账号仅限内部排查、回归测试、紧急部署验证
- 如需开通或重置个人账号，请由管理员处理

## 2. Tech Stack

### Frontend
- Next.js 14 App Router
- TypeScript
- Tailwind CSS

### Backend
- Hono
- Node.js
- MySQL 8
- TypeScript

### Deployment
- Docker Compose
- GitHub Actions
- Docker Hub
- Telegram 部署通知

### Testing
- Playwright
- 项目内保留了多套实际业务测试和排查脚本

## 3. Repository Layout

```text
Rubber-MES/
├── frontend/
│   ├── app/dashboard/
│   ├── components/
│   ├── lib/
│   ├── Dockerfile
│   └── Dockerfile.rubber
├── backend/
│   ├── src/index.ts
│   ├── src/db.ts
│   └── src/auth.ts
├── scripts/
├── docker-compose.yml
├── docker-compose.rubber.yml
├── deploy-local.sh
├── verify-deployment.sh
├── init.sql
└── init-rubber.sql
```

## 4. Frontend Main Routes

### Core Business Pages
- [frontend/app/dashboard/customer-orders/page.tsx](/Users/leo_w/Workspace/codes/ern-projects/Rubber-MES/frontend/app/dashboard/customer-orders/page.tsx)
- [frontend/app/dashboard/order-intake/page.tsx](/Users/leo_w/Workspace/codes/ern-projects/Rubber-MES/frontend/app/dashboard/order-intake/page.tsx)
- [frontend/app/dashboard/po/page.tsx](/Users/leo_w/Workspace/codes/ern-projects/Rubber-MES/frontend/app/dashboard/po/page.tsx)
- [frontend/app/dashboard/delivery-notes/page.tsx](/Users/leo_w/Workspace/codes/ern-projects/Rubber-MES/frontend/app/dashboard/delivery-notes/page.tsx)
- [frontend/app/dashboard/shipment-reconciliation/page.tsx](/Users/leo_w/Workspace/codes/ern-projects/Rubber-MES/frontend/app/dashboard/shipment-reconciliation/page.tsx)
- [frontend/app/dashboard/invoices/page.tsx](/Users/leo_w/Workspace/codes/ern-projects/Rubber-MES/frontend/app/dashboard/invoices/page.tsx)
- [frontend/app/dashboard/payables/page.tsx](/Users/leo_w/Workspace/codes/ern-projects/Rubber-MES/frontend/app/dashboard/payables/page.tsx)
- [frontend/app/dashboard/materials/page.tsx](/Users/leo_w/Workspace/codes/ern-projects/Rubber-MES/frontend/app/dashboard/materials/page.tsx)
- [frontend/app/dashboard/bom/page.tsx](/Users/leo_w/Workspace/codes/ern-projects/Rubber-MES/frontend/app/dashboard/bom/page.tsx)
- [frontend/app/dashboard/customers/page.tsx](/Users/leo_w/Workspace/codes/ern-projects/Rubber-MES/frontend/app/dashboard/customers/page.tsx)
- [frontend/app/dashboard/suppliers/page.tsx](/Users/leo_w/Workspace/codes/ern-projects/Rubber-MES/frontend/app/dashboard/suppliers/page.tsx)
- [frontend/app/dashboard/company/page.tsx](/Users/leo_w/Workspace/codes/ern-projects/Rubber-MES/frontend/app/dashboard/company/page.tsx)
- [frontend/app/dashboard/users/page.tsx](/Users/leo_w/Workspace/codes/ern-projects/Rubber-MES/frontend/app/dashboard/users/page.tsx)

### Frontend Shell And Shared Logic
- [frontend/app/dashboard/layout.tsx](/Users/leo_w/Workspace/codes/ern-projects/Rubber-MES/frontend/app/dashboard/layout.tsx)
  - 负责导航分组、角色拦截、移动端侧栏、页面主壳。
- [frontend/lib/api.ts](/Users/leo_w/Workspace/codes/ern-projects/Rubber-MES/frontend/lib/api.ts)
  - 所有 API 调用的统一入口。
  - 统一注入 token、错误翻译、日期格式整理、mutation 事件。
- [frontend/components/StickyTableHeaderBridge.tsx](/Users/leo_w/Workspace/codes/ern-projects/Rubber-MES/frontend/components/StickyTableHeaderBridge.tsx)
  - 统一处理“往下滚时表头仍可见”。

## 5. Backend Entry Points

### Core Files
- [backend/src/index.ts](/Users/leo_w/Workspace/codes/ern-projects/Rubber-MES/backend/src/index.ts)
- [backend/src/db.ts](/Users/leo_w/Workspace/codes/ern-projects/Rubber-MES/backend/src/db.ts)
- [backend/src/auth.ts](/Users/leo_w/Workspace/codes/ern-projects/Rubber-MES/backend/src/auth.ts)

### Critical Backend Characteristic
和 OMS 一样，Rubber MES 的后端也高度集中在 `backend/src/index.ts`。API、业务规则、运行时补表结构逻辑都在这里。

接手时必须知道：
- 这不是纯净的 migration-first 项目
- 很多 schema 由 `ensure*` 系列函数在运行时自动创建或补齐
- 你改业务前，先搜索相关表名、字段名和 `ensure` 方法

特别重要的运行时补结构包括：
- `delivery_progress` 相关表
- `shipment_reconciliation` 相关表
- `invoice` 相关表
- 客户订单追踪字段
- BOM / 材料扩展字段
- `stock_ledger`
- `soft delete` 字段

## 6. Core Business Logic

### 6.1 Order Intake / 交期進度
这是 Rubber MES 最关键的定制模块之一。

它不是简单列表，而是围绕交期、订单、PO、材料明细、数量状态做的一层执行视图。近期已经做过多轮需求调整，接手时要特别注意：
- 客户订单与明细的组织方式
- PO 字段应该放在哪一层展示
- 日期格式统一要求
- 列表摘要与编辑弹窗摘要条的设计
- 老数据没有 PO link 时的回退展示策略

### 6.2 Shipment Reconciliation / 数量核对
- 用于对客户订单、出货、结算数量做核对
- 与订单追踪字段联动

### 6.3 Invoices / Payables
- 发票和应付是橡胶业务中的后续结算模块
- 这些页面通常依赖前面订单、对账、收货的数据

### 6.4 Materials / BOM
- 材料管理和 BOM 是大多数业务页面的基础数据源
- 材料、BOM、采购、订单 intake 之间的联动比较强

### 6.5 Customers / Suppliers / Company / Users
- 客户和供应商是主档
- 公司设定用于打印、税率、基础配置
- 用户管理和权限仍是 `manager / employee` 两级主导

## 7. Important Frontend Conventions

### Local Storage Keys
- token: `rubber_token`
- user: `rubber_user`
- permissions: `rubber_permissions`

### Shared Mutation Event
- 事件名: `rubber:mutation`
- 页面如果有“提交后局部刷新”或“状态提示”联动，优先复用现有机制

### Date Handling
- API 层会把午夜时间串自动规范成 `YYYY-MM-DD`
- 同类页面不要混用多种日期格式

### Table UX
这个项目已经做过多轮表格统一，接手时默认要保持，而不是局部另起一套。

已有统一点包括：
- 宽表允许左右滑动
- 页面下滚时表头跟随
- 某些页面做冻结列或等价的可读性处理
- 视觉风格尽量与现有主页面保持一致

## 8. Local Development

### Install
```bash
cd Rubber-MES/frontend && npm install
cd ../backend && npm install
```

### Run Frontend
```bash
cd frontend
npm run dev
```

### Run Backend
```bash
cd backend
npm run dev
```

### Build
```bash
cd frontend && npm run build
cd ../backend && npm run build
```

## 9. Deployment

### Source Of Truth
发布以 GitHub Actions 为准。

### Release Rule
- 需要发布时，向 `prd` 分支做 `git push`
- 不要手工跑 `deploy-local.sh`
- 不要手工 SSH 到服务器执行部署
- `push prd` 会自动发布到 PRD

### Workflow
- 文件: [/.github/workflows/deploy-rubber.yml](/Users/leo_w/Workspace/codes/ern-projects/Rubber-MES/.github/workflows/deploy-rubber.yml)
- 触发条件: push 到 `prd`
- 流程:
  1. checkout
  2. 登录 Docker Hub
  3. 构建并推送 `rubber-backend:<branch>`
  4. 使用 `frontend/Dockerfile.rubber` 构建并推送 `rubber-frontend:<branch>`
  5. 上传 `docker-compose.yml` 到服务器 `/opt/rubber/`
  6. SSH 执行 `/opt/rubber/deploy.sh`
  7. 成功失败都发 Telegram

### Runtime Containers
- `rubber-mysql`
- `rubber-backend`
- `rubber-frontend`

### Compose Files
- 主部署文件: [docker-compose.yml](/Users/leo_w/Workspace/codes/ern-projects/Rubber-MES/docker-compose.yml)
- 历史/专用版本: [docker-compose.rubber.yml](/Users/leo_w/Workspace/codes/ern-projects/Rubber-MES/docker-compose.rubber.yml)

### Legacy Scripts
- [deploy-local.sh](/Users/leo_w/Workspace/codes/ern-projects/Rubber-MES/deploy-local.sh)
- [verify-deployment.sh](/Users/leo_w/Workspace/codes/ern-projects/Rubber-MES/verify-deployment.sh)

它们只保留作排障/历史参考，不是正常发布流程的一部分。

## 10. Validation After Changes

### Minimum Build Check
```bash
cd frontend && npm run build
cd ../backend && npm run build
```

### High-Value Page Checks
如果改动影响主流程，至少手动验证：
- 登录
- 客户订单
- 交期進度
- 材料管理
- BOM
- 採購下單
- 出貨單
- 數量核對
- 發票管理
- 使用者管理

### Existing Test Scripts
项目里已经有很多可复用脚本，例如：
- `test-flow-all-crud.spec.ts`
- `test-prod-crud-sweep.spec.ts`
- `test-prod-full.spec.ts`
- `test-rbac.spec.ts`
- `debug-prod-inventory.spec.ts`

## 11. Common Pitfalls

### Rubber 和 OMS 不是完全同步
虽然它们很像，但不要把一个项目的假设生搬到另一个项目。

### 后端是单文件主逻辑
先定位 `backend/src/index.ts` 里的真实规则，再动。

### 交期進度页面是高敏感区域
需求多、改动频繁、客户反馈密集。任何改动都应做真实页面走查。

### 列表和表格风格不要随意分叉
这个项目已经在往“全局一致”方向整理，尤其是表头跟随、宽表阅读和页面密度。

## 12. AI Handoff Checklist

建议阅读顺序：
1. [README.md](/Users/leo_w/Workspace/codes/ern-projects/Rubber-MES/README.md)
2. [frontend/app/dashboard/layout.tsx](/Users/leo_w/Workspace/codes/ern-projects/Rubber-MES/frontend/app/dashboard/layout.tsx)
3. [frontend/lib/api.ts](/Users/leo_w/Workspace/codes/ern-projects/Rubber-MES/frontend/lib/api.ts)
4. [backend/src/index.ts](/Users/leo_w/Workspace/codes/ern-projects/Rubber-MES/backend/src/index.ts)
5. 当前目标页面的 `page.tsx`
6. 对应 Playwright 脚本
7. [/.github/workflows/deploy-rubber.yml](/Users/leo_w/Workspace/codes/ern-projects/Rubber-MES/.github/workflows/deploy-rubber.yml)

如果要改交期、数量核对、发票、库存、软删除或部署，请默认这是系统级改动，而不是单页改动。
