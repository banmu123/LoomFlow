#!/bin/bash
# =====================================================
# LoomFlow 一键部署脚本（在 Mac 本地执行）
# 用法: ./deploy.sh
# 前置: 已配置 SSH 免密登录服务器（见 docs/deploy.md）
# =====================================================
set -e

# ===== 配置区（改成你的服务器） =====
SERVER_USER="ubuntu"
SERVER_IP="your-server-ip"
APP_DIR="/opt/forgeflow"
# =====================================

echo "▶ 1/4 打包代码..."
tar -czf /tmp/forgeflow-deploy.tar.gz \
  --exclude='node_modules' \
  --exclude='.next' \
  --exclude='dist' \
  --exclude='.env.local' \
  --exclude='.env' \
  --exclude='tsconfig.tsbuildinfo' \
  .

echo "▶ 2/4 上传到服务器..."
scp /tmp/forgeflow-deploy.tar.gz "${SERVER_USER}@${SERVER_IP}:/tmp/"

echo "▶ 3/4 服务器解压..."
ssh "${SERVER_USER}@${SERVER_IP}" "cd ${APP_DIR} && tar -xzf /tmp/forgeflow-deploy.tar.gz --overwrite"

echo "▶ 4/4 服务器安装依赖 + 构建 + 重启..."
# nvm 多版本：把所有 node 版本 bin 加进 PATH，确保 pnpm/pm2 可用
ssh "${SERVER_USER}@${SERVER_IP}" "for d in ~/.nvm/versions/node/*/bin; do export PATH=\"\$d:\$PATH\"; done; cd ${APP_DIR} && pnpm install --prefer-frozen-lockfile && pnpm build && pm2 restart forgeflow"

echo ""
echo "✅ 部署完成！http://${SERVER_IP}:5000 或你的域名"
