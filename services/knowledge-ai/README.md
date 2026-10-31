# LoomFlow Knowledge AI

LoomFlow 的可选 Python 知识服务（FastAPI）。**M1 阶段只有骨架**：健康检查 + 能力探测，不含解析、切分、Embedding、向量检索与 Reranker。

- 作为独立进程运行，只被 Node.js 服务端调用
- 不建立用户体系，不重复创建业务表，不执行用户提交的 Python 代码
- 默认不启动；LoomFlow 默认仍走 Legacy 知识库检索

完整说明见 [`docs/config/python-ai-service.md`](../../docs/config/python-ai-service.md)，架构背景见 [`docs/config/python-ai-architecture.md`](../../docs/config/python-ai-architecture.md)。

## 快速开始

```bash
cp .env.example .env
uv sync
uv run uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

```bash
curl http://127.0.0.1:8000/health

curl -H "X-Loomflow-Service-Token: dev-only-token-change-me-0123456789" \
  http://127.0.0.1:8000/api/v1/knowledge/capabilities
```

## 测试

```bash
uv run pytest
```

## Docker

```bash
# 在仓库根目录执行
docker compose --profile python-ai up -d --build
docker compose logs -f loomflow-ai
```

## 环境变量

| 变量 | 默认 | 说明 |
|------|------|------|
| `APP_ENV` | `development` | `production` 时强制校验内部密钥 |
| `LOG_LEVEL` | `INFO` | `CRITICAL` / `ERROR` / `WARNING` / `INFO` / `DEBUG` |
| `API_PREFIX` | `/api/v1` | 业务路由前缀（`/health` 不受影响） |
| `HOST` / `PORT` | `0.0.0.0` / `8000` | `python -m app` 启动时使用 |
| `KNOWLEDGE_SERVICE_TOKEN` | 空 | 内部服务密钥；`production` 下缺失或短于 16 字符则启动失败 |
| `ENABLE_DOCS` | `true` | 是否暴露 `/docs` 与 `/openapi.json` |

## 端点

| 方法 | 路径 | 认证 |
|------|------|------|
| GET | `/health` | 否 |
| GET | `/api/v1/knowledge/capabilities` | `X-Loomflow-Service-Token` |
| GET | `/docs` | 否（`ENABLE_DOCS=true` 时） |
