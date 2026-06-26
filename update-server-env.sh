#!/bin/bash
# 更新服务器上的环境变量（添加 Resend 邮件配置）

set -e

SERVER_HOST="43.160.199.226"
SERVER_USER="ubuntu"
SERVER_PASSWORD="Www.950pp.com"
SERVER_PORT="22"

echo "📧 正在更新服务器邮件配置..."

# 使用 sshpass 连接服务器并更新 .env 文件
sshpass -p "${SERVER_PASSWORD}" ssh -o StrictHostKeyChecking=no -p ${SERVER_PORT} ${SERVER_USER}@${SERVER_HOST} << 'EOF'
cd /opt/rubber

# 备份原 .env 文件
if [ -f .env ]; then
  cp .env .env.backup.$(date +%Y%m%d_%H%M%S)
fi

# 检查是否已有 RESEND_API_KEY
if grep -q "RESEND_API_KEY" .env 2>/dev/null; then
  echo "✅ RESEND_API_KEY 已存在"
else
  echo "" >> .env
  echo "# Resend 邮件服务" >> .env
  echo "RESEND_API_KEY=re_A7ZCKEBK_G7w4r4msGkYskcET6CEESnEV" >> .env
  echo "RESEND_FROM=MES System <onboarding@resend.dev>" >> .env
  echo "✅ 已添加 RESEND_API_KEY 到 .env"
fi

echo ""
echo "当前 .env 内容："
cat .env
EOF

echo ""
echo "✅ 服务器环境变量更新完成"
echo "⚠️  需要重启后端容器才能生效："
echo "   ssh ubuntu@43.160.199.226"
echo "   cd /opt/rubber"
echo "   docker-compose restart rubber-backend"
