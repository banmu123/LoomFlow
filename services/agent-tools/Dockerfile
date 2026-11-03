# =====================================================
# LoomFlow Agent Tools（FastAPI 工具服务）
# 构建上下文：services/agent-tools
# =====================================================
FROM ghcr.io/astral-sh/uv:python3.11-bookworm-slim AS builder

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON=3.11

WORKDIR /app

COPY pyproject.toml uv.lock README.md ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev --no-install-project

COPY app ./app

FROM python:3.11-slim-bookworm AS runtime

# pandas 的 OpenMP 运行时依赖
RUN apt-get update \
    && apt-get install -y --no-install-recommends libgomp1 \
    && rm -rf /var/lib/apt/lists/*

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PATH="/app/.venv/bin:$PATH"

WORKDIR /app

RUN groupadd --system --gid 1001 loomflow \
    && useradd --system --uid 1001 --gid loomflow --home-dir /app --shell /usr/sbin/nologin loomflow

COPY --from=builder --chown=loomflow:loomflow /app/.venv ./.venv
COPY --chown=loomflow:loomflow app ./app

USER loomflow

EXPOSE 8090

HEALTHCHECK --interval=20s --timeout=8s --start-period=15s --retries=5 \
  CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8090/health', timeout=5)"]

CMD ["python", "-m", "app"]
