#!/bin/bash
# =====================================================
# LoomFlow 部署环境初始化（一次性）
# 用法：bash scripts/init-env.sh
# 自动完成：复制 .env → 生成随机 POSTGRES_PASSWORD / PGRST_JWT_SECRET
#          → 生成匹配的 SERVICE_ROLE_KEY（写入 .env）
# 完成后仅需手动填写：DEEPSEEK_API_KEY（AI 对话必需）
# 然后：docker compose up -d
# =====================================================
set -euo pipefail

ROOT="${LOOMFLOW_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
cd "$ROOT"
ENV_FILE=".env"

# 1. 无 .env 时从模板复制
if [ ! -f "$ENV_FILE" ]; then
  cp .env.example "$ENV_FILE"
  echo "✅ 已从 .env.example 创建 .env"
fi

# 2. 生成随机强密码（占位值或为空时替换）
rand_secret() { openssl rand -hex 32; }

is_placeholder() {
  local value="$1"
  [ -z "$value" ] \
    || [ "$value" = "change_me_strong_password" ] \
    || [ "$value" = "change_me_at_least_32_chars_random" ] \
    || [[ "$value" == your_* ]] \
    || [[ "$value" == change_me* ]]
}

update_var() {
  local key="$1" value="$2"
  local current=""
  if grep -qE "^${key}=" "$ENV_FILE"; then
    current="$(grep -E "^${key}=" "$ENV_FILE" | head -1 | cut -d= -f2-)"
  fi
  if is_placeholder "$current"; then
    if grep -qE "^${key}=" "$ENV_FILE"; then
      sed -i '' "s|^${key}=.*|${key}=${value}|" "$ENV_FILE"
    else
      echo "${key}=${value}" >> "$ENV_FILE"
    fi
    echo "✅ ${key} 已生成随机值"
  else
    echo "⏭️  ${key} 已配置，跳过"
  fi
}

if command -v openssl >/dev/null 2>&1; then
  update_var "POSTGRES_PASSWORD" "$(rand_secret)"
  update_var "PGRST_JWT_SECRET" "$(rand_secret)"
else
  echo "⚠️ 未找到 openssl，POSTGRES_PASSWORD / PGRST_JWT_SECRET 请手动填写"
fi

# 3. 生成匹配 service_role key（与 PGRST_JWT_SECRET 同源）
PGRST_JWT_SECRET="$(grep -E '^PGRST_JWT_SECRET=' "$ENV_FILE" | cut -d= -f2-)"
if [ -z "$PGRST_JWT_SECRET" ] || [ "$PGRST_JWT_SECRET" = "change_me_at_least_32_chars_random" ]; then
  echo "⚠️ 请先在 .env 中填写 PGRST_JWT_SECRET（至少 32 字符），再运行本脚本生成 SERVICE_ROLE_KEY"
  exit 1
fi

SR_KEY="$(grep -E '^COZE_SUPABASE_SERVICE_ROLE_KEY=' "$ENV_FILE" | cut -d= -f2-)"
if [ -z "$SR_KEY" ] || [ "$SR_KEY" = "your_service_role_key" ]; then
  if command -v node >/dev/null 2>&1; then
    NEW_KEY="$(node "$ROOT/docker/generate-service-role-key.mjs" "$PGRST_JWT_SECRET")"
    if grep -qE '^COZE_SUPABASE_SERVICE_ROLE_KEY=' "$ENV_FILE"; then
      sed -i '' "s|^COZE_SUPABASE_SERVICE_ROLE_KEY=.*|COZE_SUPABASE_SERVICE_ROLE_KEY=${NEW_KEY}|" "$ENV_FILE"
    else
      echo "COZE_SUPABASE_SERVICE_ROLE_KEY=${NEW_KEY}" >> "$ENV_FILE"
    fi
    echo "✅ COZE_SUPABASE_SERVICE_ROLE_KEY 已生成（与 PGRST_JWT_SECRET 匹配）"
  else
    echo "⚠️ 未找到 node，请手动运行：node docker/generate-service-role-key.mjs \$PGRST_JWT_SECRET"
  fi
else
  echo "⏭️  COZE_SUPABASE_SERVICE_ROLE_KEY 已配置，跳过"
fi

echo ""
echo "=============================================="
echo "🎉 环境初始化完成！启动："
echo "  docker compose up -d"
echo ""
echo "部署后配置 AI 模型（无需在 .env 填 key）："
echo "  1. 登录 http://localhost:5000（默认账号 admin / 123456，请立即修改）"
echo "  2. 管理后台 → 模型配置 → 添加模型"
echo "     （如 DeepSeek：填模型 ID + API Key，或任意 OpenAI 兼容端点）"
echo "  3. 可选：管理后台 → 搜索配置 / 存储设置 等"
echo "=============================================="
