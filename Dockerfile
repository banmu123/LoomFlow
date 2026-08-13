# =====================================================
# LoomFlow 生产镜像（多阶段构建）
# 运行：docker compose up -d（推荐）或：
#   docker build -t loomflow .
#   docker run -p 5000:5000 --env-file .env loomflow
# =====================================================

# ---- Stage 1: 依赖安装 + 构建 ----
FROM node:20-slim AS builder
WORKDIR /app

# pnpm 通过 corepack 启用（packageManager: pnpm@9.0.0 锁定版本）
RUN corepack enable

# 先复制依赖清单，利用 Docker 层缓存
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# 复制源码并构建（next build + tsup）
COPY . .
# 构建期占位环境变量（无 NEXT_PUBLIC 依赖；dotenv 兜底不会失败）
ENV COZE_SUPABASE_URL=https://placeholder.invalid \
    COZE_SUPABASE_SERVICE_ROLE_KEY=placeholder \
    DEEPSEEK_API_KEY=placeholder \
    AUTH_SECRET=placeholder-build-secret
RUN pnpm build

# ---- Stage 2: 运行 ----
FROM node:20-slim AS runner
WORKDIR /app
ENV NODE_ENV=production

# 仅复制运行所需产物
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/public ./public
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
COPY --from=builder /app/next.config.ts ./
COPY --from=builder /app/tsconfig.json ./
COPY --from=builder /app/.env.example ./

EXPOSE 5000

# 健康检查（/api/health 已实现）
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:5000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# 生产模式启动（COZE_PROJECT_ENV=PROD 由 compose 环境注入）
CMD ["node", "dist/server.js"]
