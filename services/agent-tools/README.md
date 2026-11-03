# LoomFlow Agent Tools

LoomFlow 的内部数据处理服务（FastAPI）：表格分析、文档解析、文本清洗、结构化提取。

- 只提供**预定义工具**，不执行用户提交的 Python 代码，也不接受自定义正则
- 仅接受带 `X-Loomflow-Service-Token` 的服务间调用
- 与 `knowledge-ai` 相互独立，可单独部署/扩缩容

完整契约见 [docs/config/python-tools.md](../../docs/config/python-tools.md)。

## 本地启动

```bash
cp .env.example .env
uv sync
uv run uvicorn app.main:app --reload --host 127.0.0.1 --port 8090
```

```bash
curl -s http://127.0.0.1:8090/health

curl -s -X POST http://127.0.0.1:8090/api/v1/tools/data/analyze \
  -H 'content-type: application/json' \
  -H 'X-Loomflow-Service-Token: dev-only-token-change-me-0123456789' \
  -d '{"content":"name,amount\nA,10\nB,20\n","operation":"summary"}'
```

## 测试

```bash
uv run pytest
```

## Docker

```bash
# 仓库根目录
docker compose --profile ai-tools up -d --build
docker compose logs -f agent-tools
```

| 变量 | 默认 | 说明 |
|------|------|------|
| `APP_ENV` | `development` | `production` 时强制校验内部密钥 |
| `KNOWLEDGE_SERVICE_TOKEN` | 空 | 内部服务密钥（与 Node 侧 `AGENT_TOOLS_TOKEN` 一致） |
| `MAX_INPUT_BYTES` | `8388608` | 单次输入上限 |
| `MAX_ROWS` | `200000` | 表格最大行数 |
| `MAX_TEXT_CHARS` | `400000` | 文本最大字符数 |
| `TOOL_TIMEOUT_SECONDS` | `25` | 服务端执行超时 |
