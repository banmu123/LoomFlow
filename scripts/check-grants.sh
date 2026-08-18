#!/bin/bash
# =====================================================
# 权限自检：确认 public schema 所有表对 service_role 可读写
# 用法（服务器上）：bash scripts/check-grants.sh
# 部署脚本自动调用；发现缺权限表时列出并返回非零退出码。
# =====================================================
set -uo pipefail

PG="docker exec loomflow-postgres psql -U postgres -d loomflow -tAc"
if ! $PG "SELECT 1" > /dev/null 2>&1; then
  echo "❌ 无法连接 loomflow-postgres 容器（先 docker compose up -d postgres）"
  exit 2
fi

MISSING=$($PG "SELECT tablename FROM pg_tables WHERE schemaname='public'
  AND NOT has_table_privilege('service_role', tablename, 'SELECT,INSERT,UPDATE,DELETE')
  ORDER BY tablename;" 2>/dev/null)

if [ -n "$MISSING" ]; then
  echo "❌ 以下表缺少 service_role 授权（部署后 PostgREST 将拒绝访问）："
  echo "$MISSING"
  echo ""
  echo "修复：bash scripts/supabase-updates.sql 至数据库，或手动执行："
  echo "  docker exec loomflow-postgres psql -U postgres -d loomflow -c \"GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, service_role;\""
  exit 1
fi

echo "✅ 权限自检通过：所有表对 service_role 可读写"
