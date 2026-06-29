# 服务器环境变量更新指南

## 问题描述
报价单邮件通知功能未生效，原因是服务器上缺少 `RESEND_API_KEY` 环境变量。

## 解决方案

### 方案 1：手动 SSH 更新（推荐，立即生效）

```bash
# 1. SSH 登录服务器
ssh ubuntu@43.160.199.226

# 2. 切换到部署目录
cd /opt/rubber

# 3. 备份当前 .env
cp .env .env.backup.$(date +%Y%m%d_%H%M%S)

# 4. 编辑 .env 文件，添加以下内容到文件末尾
nano .env

# 添加这两行：
RESEND_API_KEY=re_A7ZCKEBK_G7w4r4msGkYskcET6CEESnEV
RESEND_FROM=MES System <onboarding@resend.dev>

# 保存并退出（Ctrl+O, Enter, Ctrl+X）

# 5. 重启后端容器使环境变量生效
docker-compose restart rubber-backend

# 6. 验证环境变量已加载
docker exec rubber-backend printenv | grep RESEND

# 应该看到：
# RESEND_API_KEY=re_A7ZCKEBK_G7w4r4msGkYskcET6CEESnEV
# RESEND_FROM=MES System <onboarding@resend.dev>

# 7. 查看后端日志确认
docker logs rubber-backend --tail 50
```

### 方案 2：等待下次部署（较慢）

下次 push 代码到 main 分支时，CI/CD 会自动部署。但服务器的 `.env` 文件仍需手动更新（见方案 1）。

## 验证邮件功能

更新完成后，测试步骤：

1. 登录系统 http://43.160.199.226:10101
2. 进入「公司设定」页面
3. 确认「通知邮箱」字段已填写：`wxfaigl@gmail.com`
4. 创建一个测试报价单
5. 点击「提交审核」按钮
6. 查看后端日志：
   ```bash
   docker logs rubber-backend --tail 100 | grep mailer
   ```
   应该看到：`[mailer] Email sent to wxfaigl@gmail.com: [待審核] 報價單 QT...`
7. 检查邮箱是否收到通知邮件

## 后续维护

所有环境变量的标准配置已更新到：
- `/Rubber-MES/.env.server` （服务器环境变量模板）
- `/Rubber-MES/docker-compose.rubber.yml` （Docker Compose 配置）

但服务器上的实际 `.env` 文件需要手动同步。

## 当前 CI/CD 状态

最近两次提交：
- `b2190dc` - fix: 统一报价单状态按钮样式
- `d26ee95` - fix: 添加邮件服务环境变量到docker-compose配置

GitHub Actions 正在自动部署，约 3-5 分钟完成。
部署完成后，仍需执行「方案 1」手动更新服务器 .env 文件。
