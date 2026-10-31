# =====================================================
# LoomFlow Knowledge AI（FastAPI 独立服务）
# 构建上下文：services/knowledge-ai
#   docker build -t loomflow-ai .
#   docker run --rm -p 127.0.0.1:8000:8000 \
#     -e APP_ENV=production -e KNOWLEDGE_SERVICE_TOKEN=... loomflow-ai
# 通常由 docker compose --profile python-ai up -d 启动
# =====================================================

# ---- Stage 1: 依赖安装（uv 按 lock 精确还原）----
FROM ghcr.io/astral-sh/uv:python3.11-bookworm-slim AS builder

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON=3.11

WORKDIR /app

# 先只复制依赖清单，最大化层缓存命中
COPY pyproject.toml uv.lock README.md ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev --no-install-project

COPY app ./app

# ---- Stage 2: 运行 ----
FROM python:3.11-slim-bookworm AS runtime

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PATH="/app/.venv/bin:$PATH"

WORKDIR /app

# 非 root 运行
RUN groupadd --system --gid 1001 loomflow \
    && useradd --system --uid 1001 --gid loomflow --home-dir /app --shell /usr/sbin/nologin loomflow

COPY --from=builder --chown=loomflow:loomflow /app/.venv ./.venv
COPY --chown=loomflow:loomflow app ./app

USER loomflow

EXPOSE 8000

# 健康检查复用 /health（镜像内没有 curl，直接用标准库）
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=5 \
  CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=3)"]

CMD ["python", "-m", "app"]
