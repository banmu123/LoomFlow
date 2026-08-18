#!/bin/bash
# =====================================================
# LoomFlow Docker 一键部署（在 Mac 本地执行）
# 用法: SERVER_IP=xxx ./scripts/deploy-docker.sh
# 前置: SSH 免密登录已配置；服务器上已有一份可用的 docker compose 环境（.env 等）
# 特性:
#   - 自动执行数据库迁移（supabase-updates.sql，幂等）
#   - 迁移后自动做「权限自检」（新表缺 GRANT 会在构建前暴露，不再返工）
#   - 构建镜像 + 重启 + 健康验证
# =====================================================
set -euo pipefail

SERVER_USER="${SERVER_USER:-ubuntu}"
SERVER_IP="${SERVER_IP:?请设置服务器 IP，如 SERVER_IP=175.178.241.210}"
APP_DIR="${APP_DIR:-/opt/loomflow}"

echo "▶ 1/6 打包代码（排除 node_modules/.next/.env/.git 等）..."
tar -czf /tmp/loomflow-deploy.tar.gz \
  --exclude='node_modules' --exclude='.next' --exclude='dist' \
  --exclude='.env' --exclude='.env.local' --exclude='.git' \
  --exclude='tsconfig.tsbuildinfo' --exclude='.DS_Store' \
  .

echo "▶ 2/6 上传并解压到服务器 ${SERVER_USER}@${SERVER_IP}:${APP_DIR}"
scp /tmp/loomflow-deploy.tar.gz "${SERVER_USER}@${SERVER_IP}:/tmp/"
ssh "${SERVER_USER}@${SERVER_IP}" "cd ${APP_DIR} && tar -xzf /tmp/loomflow-deploy.tar.gz --overwrite"

echo "▶ 3/6 数据库迁移 + 权限自检..."
ssh "${SERVER_USER}@${SERVER_IP}" "cd ${APP_DIR} && docker compose run --rm migration > /dev/null 2>&1 && bash scripts/check-grants.sh"

echo "▶ 4/6 构建镜像并重启服务（代码有变更时约 10-20 分钟）..."
ssh "${SERVER_USER}@${SERVER_IP}" "cd ${APP_DIR} && docker compose up -d --build > /tmp/loomflow-compose.log 2>&1 && echo '  compose 完成'"

echo "▶ 5/6 等待应用健康（最长 5 分钟）..."
ssh "${SERVER_USER}@${SERVER_IP}" 'for i in $(seq 1 60); do
  if docker exec loomflow-app node -e "fetch(\"http://127.0.0.1:5000/api/health\").then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" > /dev/null 2>&1; then
    echo "  ✅ 健康检查通过"; exit 0
  fi
  sleep 5
done; echo "  ❌ 应用未在 5 分钟内变健康，查看日志: docker logs loomflow-app --tail 50"; exit 1'

echo "▶ 6/6 验证版本与数据层..."
ssh "${SERVER_USER}@${SERVER_IP}" "curl -s http://localhost:5000/api/health && echo"

echo ""
echo "✅ 部署完成！http://${SERVER_IP}:5000"
