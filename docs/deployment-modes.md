# LoomFlow 部署模式

LoomFlow 支持两种部署模式，通过 `RUNTIME_MODE` 环境变量切换。

## 模式对比

| 功能 | Docker 自托管 | Vercel Serverless |
|------|-------------|-------------------|
| 工作流编辑器 | ✅ | ✅ |
| AI 节点 | ✅ | ✅ |
| 工作流执行 | ✅ | ✅ |
| 回归检测 | ✅ | ✅ |
| Quality Gate | ✅ | ✅ |
| 演化系统 | ✅ | ✅ |
| 定时任务 | 内置 scheduler | Vercel Cron |
| 演化自动触发 | 内置 scheduler | Vercel Cron |
| 长任务执行 | ✅ | 受 Function 超时限制 |
| Webhook 回调 | ✅ | ⚠️ 依赖外部调用 |

## Docker 自托管（生产推荐）

适用于：生产部署、完整功能、长任务执行。

```bash
# 默认模式，无需设置 RUNTIME_MODE
docker compose up -d
```

- `server.ts` 启动时自动初始化 scheduler
- 定时任务和演化调度器常驻运行
- 支持长任务、Webhook 回调等完整能力

## Vercel Serverless（在线体验）

适用于：在线 Demo、快速体验、Codex for OSS 审核展示。

### 环境变量

```bash
RUNTIME_MODE=serverless
CRON_SECRET=your_random_secret    # Vercel Cron 认证
COZE_SUPABASE_URL=https://xxx.supabase.co
COZE_SUPABASE_SERVICE_ROLE_KEY=xxx
AUTH_SECRET=xxx
```

### 工作原理

1. `server.ts` 检测到 `RUNTIME_MODE=serverless`，跳过 scheduler 初始化
2. Vercel Cron 每 10 分钟调用 `/api/cron/scheduler`（定时任务）
3. Vercel Cron 每 30 分钟调用 `/api/cron/evolution`（演化触发）
4. Cron 端点验证 `Authorization: Bearer ${CRON_SECRET}`

### 限制

- Vercel Function 默认超时 10s（Pro 计划 60s）
- 不支持长任务执行
- Webhook 回调依赖外部调用时机

## 功能矩阵

| 能力 | Docker | Vercel |
|------|--------|--------|
| Workflow 编辑 | ✅ | ✅ |
| AI 节点 | ✅ | ✅ |
| 简单执行 | ✅ | ✅ |
| 长任务 | ✅ | ❌ |
| Scheduler | ✅ 内置 | ⚠️ Cron |
| Worker | ✅ | ❌ |
| Evolution Engine | ✅ 完整 | ⚠️ 部分 |
| Regression Detection | ✅ | ✅ |
| Quality Gate | ✅ | ✅ |
